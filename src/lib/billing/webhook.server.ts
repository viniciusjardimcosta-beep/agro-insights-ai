// Processamento de webhooks — server-only (service role).
//
// Ordem: autenticar (raw body) → reservar evento (idempotência) → buscar estado
// autoritativo na Stripe pelo ID → reconciliar → finalizar.
// Identidade: SEMPRE pelos IDs persistidos server-side (checkout criado por nós,
// provider_customer_id criado por nós antes do checkout, provider_subscription_id).
// Metadata do payload nunca é autoridade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeAuditMetadata, type AuditEventType } from "@/lib/audit.server";
import type { BillingProvider, WebhookVerification } from "./types";
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

async function findRow(admin: AnySupabase, col: string, value: string): Promise<SubRow | null> {
  const { data } = await admin.from("subscriptions").select(SUB_COLS).eq(col, value).maybeSingle();
  return (data as SubRow | null) ?? null;
}

/** Busca o estado atual da assinatura na Stripe e aplica em `subscriptions`. */
export async function syncSubscription(
  admin: AnySupabase,
  provider: BillingProvider,
  providerSubscriptionId: string,
): Promise<"processed" | "ignored"> {
  const snap = await provider.fetchSubscription(providerSubscriptionId);
  if (!snap) return "ignored";
  const row =
    (await findRow(admin, "provider_subscription_id", snap.providerSubscriptionId)) ??
    (await findRow(admin, "provider_customer_id", snap.providerCustomerId));
  if (!row) return "ignored"; // customer não criado por nós: não é nosso
  if (row.provider_customer_id !== snap.providerCustomerId) {
    throw new Error("customer_mismatch"); // nunca associa assinatura de A ao usuário B
  }

  const result = reconcile(row, snap);
  if (!result.patch) return "ignored";

  const { data: updated, error } = await admin
    .from("subscriptions")
    .update({ ...result.patch, provider: provider.id })
    .eq("user_id", row.user_id)
    // Concorrência otimista: só aplica se ninguém alterou a linha no meio.
    .eq("updated_at", row.updated_at)
    .select("user_id");
  if (error) throw error;
  if (!updated || updated.length === 0) throw new RetryLaterError("concurrent update");

  if (result.consumeFounder) {
    await admin
      .from("billing_eligibility")
      .update({ founder_eligible: false, consumed_at: new Date().toISOString() })
      .eq("user_id", row.user_id)
      .is("consumed_at", null);
  }
  for (const audit of result.audits) {
    await recordSystemAudit(admin, {
      userId: row.user_id,
      eventType: audit,
      status: audit === "payment_failed" ? "failure" : "success",
      metadata: { source: provider.id, operation: result.patch.plan_code },
    });
  }
  return "processed";
}

type Verified = Extract<WebhookVerification, { ok: true }>;

/** Aplica um evento verificado. Retorna "processed" | "ignored". */
export async function applyWebhookEvent(
  admin: AnySupabase,
  provider: BillingProvider,
  ev: Verified,
): Promise<"processed" | "ignored"> {
  const t = ev.eventType;

  if (t === "checkout.session.expired" && ev.checkoutSessionId) {
    await admin
      .from("billing_checkouts")
      .update({ status: "expired" })
      .eq("provider", provider.id)
      .eq("provider_checkout_id", ev.checkoutSessionId)
      .eq("status", "pending");
    return "processed";
  }

  if (t === "checkout.session.completed") {
    if (!ev.checkoutSessionId) return "ignored";
    const { data: co } = await admin
      .from("billing_checkouts")
      .select("id, user_id, status, mode, plan_code")
      .eq("provider", provider.id)
      .eq("provider_checkout_id", ev.checkoutSessionId)
      .maybeSingle();
    if (!co) return "ignored"; // checkout desconhecido: não é nosso
    const { data: sub } = await admin
      .from("subscriptions")
      .select("provider_customer_id, provider_subscription_id, trial_ends_at")
      .eq("user_id", co.user_id)
      .maybeSingle();
    if (!sub?.provider_customer_id || sub.provider_customer_id !== ev.customerId) {
      throw new Error("customer_mismatch");
    }
    if (co.status === "pending") await admin.from("billing_checkouts").update({ status: "paid" }).eq("id", co.id);

    // Modo SETUP (trial < 49h): o checkout só cadastrou o cartão. A assinatura
    // é criada AQUI, no servidor, com o fim original do trial interno.
    if (!ev.subscriptionId && co.mode === "setup") {
      if (sub.provider_subscription_id) return "processed"; // já criada (retentativa)
      const { findPlanVariant } = await import("./plans");
      const variant = findPlanVariant(co.plan_code);
      if (!variant) throw new RetryLaterError("unknown_plan");
      const priceId = await provider.resolvePrice(variant);
      const trialEndMs = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : null;
      const trialEnd = trialEndMs && trialEndMs > Date.now() ? Math.floor(trialEndMs / 1000) : null;
      try {
        const created = await provider.createSubscriptionFromSetup({
          checkoutSessionId: ev.checkoutSessionId,
          checkoutRef: co.id,
          priceId,
          customerId: sub.provider_customer_id,
          trialEnd,
        });
        return syncSubscription(admin, provider, created.providerSubscriptionId);
      } catch (err) {
        await recordSystemAudit(admin, {
          userId: co.user_id,
          eventType: "webhook_processing_failed",
          status: "failure",
          metadata: { source: provider.id, error_code: "SETUP_SUBSCRIPTION_FAILED" },
        });
        // Libera a reserva: a retentativa da Stripe pode concluir a criação.
        throw new RetryLaterError(err instanceof Error ? err.message.slice(0, 40) : "setup_failed");
      }
    }

    // Checkout concluído NÃO ativa nada: o status vem do estado da Subscription.
    return ev.subscriptionId ? syncSubscription(admin, provider, ev.subscriptionId) : "processed";
  }

  if (
    (t.startsWith("customer.subscription.") || t === "invoice.paid" || t === "invoice.payment_failed") &&
    ev.subscriptionId
  ) {
    return syncSubscription(admin, provider, ev.subscriptionId);
  }

  return "ignored";
}
