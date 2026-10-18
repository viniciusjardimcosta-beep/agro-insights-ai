// Processamento de webhooks — server-only (service role).
//
// Ordem: autenticar → reservar evento (idempotência) → reconciliar → finalizar.
// Identidade: SEMPRE pelos IDs persistidos server-side (checkout criado por nós,
// provider_customer_id / provider_subscription_id). Metadata do payload nunca
// é autoridade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeAuditMetadata, type AuditEventType } from "@/lib/audit.server";
import type { BillingEvent, BillingProvider } from "./types";
import { reconcile, type SubState } from "./reconcile";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export class RetryLaterError extends Error {}

/** Auditoria sem sessão de usuário (webhook): grava direto com service role. */
export async function recordSystemAudit(
  admin: AnySupabase,
  input: { userId: string | null; eventType: AuditEventType; status?: string; metadata?: Record<string, unknown> },
) {
  try {
    await admin.from("audit_events").insert({
      user_id: input.userId,
      event_type: input.eventType,
      status: input.status ?? "success",
      metadata: sanitizeAuditMetadata(input.metadata),
    });
  } catch {
    console.error("[billing] falha ao auditar", { event_type: input.eventType });
  }
}

export async function claimWebhookEvent(
  admin: AnySupabase,
  args: { provider: string; providerEventId: string; eventType: string },
): Promise<boolean> {
  const { error } = await admin.from("billing_events").insert({
    provider: args.provider,
    provider_event_id: args.providerEventId,
    event_type: args.eventType,
    status: "received",
  });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

export async function finishWebhookEvent(
  admin: AnySupabase,
  args: { provider: string; providerEventId: string; status: "processed" | "ignored" | "failed"; errorCode?: string },
) {
  await admin
    .from("billing_events")
    .update({ status: args.status, error_code: args.errorCode ?? null, processed_at: new Date().toISOString() })
    .eq("provider", args.provider)
    .eq("provider_event_id", args.providerEventId);
}

/** Libera a reserva para que a retentativa do gateway possa processar. */
export async function releaseWebhookEvent(admin: AnySupabase, args: { provider: string; providerEventId: string }) {
  await admin
    .from("billing_events")
    .delete()
    .eq("provider", args.provider)
    .eq("provider_event_id", args.providerEventId)
    .eq("status", "received");
}

const SUB_COLS =
  "user_id, status, plan_code, provider_customer_id, provider_subscription_id, current_period_ends_at, cancel_at_period_end, updated_at";

type SubRow = SubState & { user_id: string };

export async function findSubscriptionByProviderIds(
  admin: AnySupabase,
  args: { providerSubscriptionId: string | null; providerCustomerId: string | null },
): Promise<SubRow | null> {
  if (args.providerSubscriptionId) {
    const { data } = await admin
      .from("subscriptions")
      .select(SUB_COLS)
      .eq("provider_subscription_id", args.providerSubscriptionId)
      .maybeSingle();
    if (data) return data as SubRow;
  }
  if (args.providerCustomerId) {
    const { data } = await admin
      .from("subscriptions")
      .select(SUB_COLS)
      .eq("provider_customer_id", args.providerCustomerId)
      .maybeSingle();
    if (data) return data as SubRow;
  }
  return null;
}

/** Aplica um evento normalizado. Retorna "processed" | "ignored". */
export async function applyBillingEvent(
  admin: AnySupabase,
  provider: BillingProvider,
  event: BillingEvent,
): Promise<"processed" | "ignored"> {
  if (event.kind === "ignored") return "ignored";

  if (event.kind === "checkout_closed") {
    await admin
      .from("billing_checkouts")
      .update({ status: event.status })
      .eq("provider", provider.id)
      .eq("provider_checkout_id", event.providerCheckoutId)
      .eq("status", "pending");
    return "processed";
  }

  if (event.kind === "checkout_paid") {
    // Vínculo usuário ⇄ cliente: pelo checkout que NÓS criamos e persistimos.
    const { data: co } = await admin
      .from("billing_checkouts")
      .select("id, user_id, plan_code, status")
      .eq("provider", provider.id)
      .eq("provider_checkout_id", event.providerCheckoutId)
      .maybeSingle();
    if (!co) return "ignored"; // checkout desconhecido: não é nosso
    if (co.status === "paid") return "ignored";
    if (!event.providerCustomerId) throw new RetryLaterError("checkout sem customer");

    // Um customer do gateway nunca pode ser associado a dois usuários.
    const { data: other } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("provider_customer_id", event.providerCustomerId)
      .neq("user_id", co.user_id)
      .maybeSingle();
    if (other) throw new Error("customer_already_bound");

    // Se o gateway já informou a assinatura no próprio evento (Stripe), usa-a;
    // senão procura pelo cliente (Asaas).
    let subscriptionId: string | null = event.providerSubscriptionId ?? null;
    if (!subscriptionId) {
      try {
        subscriptionId = await provider.findActiveSubscriptionId({ providerCustomerId: event.providerCustomerId });
      } catch {
        subscriptionId = null; // será obtido no primeiro evento de cobrança
      }
    }

    await admin
      .from("subscriptions")
      .update({
        provider: provider.id,
        provider_customer_id: event.providerCustomerId,
        provider_subscription_id: subscriptionId,
        plan_code: co.plan_code,
        cancel_at_period_end: false,
        canceled_at: null,
      })
      .eq("user_id", co.user_id);
    await admin.from("billing_checkouts").update({ status: "paid" }).eq("id", co.id);
    await recordSystemAudit(admin, {
      userId: co.user_id,
      eventType: "checkout_started",
      metadata: { operation: "checkout_paid", source: provider.id },
    });
    return "processed";
  }

  const sub = await findSubscriptionByProviderIds(admin, {
    providerSubscriptionId: event.providerSubscriptionId,
    providerCustomerId: event.providerCustomerId,
  });
  if (!sub) {
    // Cobrança chegou antes do CHECKOUT_PAID: pede retentativa ao gateway.
    if (event.kind === "payment_confirmed") throw new RetryLaterError("subscription not bound yet");
    return "ignored";
  }

  const result = reconcile(sub, event);
  if (!result.patch) return "ignored";

  const { error } = await admin
    .from("subscriptions")
    .update(result.patch)
    .eq("user_id", sub.user_id)
    // Concorrência otimista: só aplica se ninguém alterou a linha no meio.
    .eq("updated_at", sub.updated_at);
  if (error) throw error;

  if (result.consumeFounder) {
    await admin
      .from("billing_eligibility")
      .update({ founder_eligible: false, consumed_at: new Date().toISOString() })
      .eq("user_id", sub.user_id);
  }
  if (result.audit) {
    await recordSystemAudit(admin, {
      userId: sub.user_id,
      eventType: result.audit,
      status: result.audit === "payment_failed" ? "failure" : "success",
      metadata: { source: provider.id },
    });
  }
  return "processed";
}
