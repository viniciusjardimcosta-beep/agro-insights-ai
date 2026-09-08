// Idempotência e reconciliação de webhooks — server-only.
//
// AUTORIDADE: somente um evento com assinatura criptográfica válida do
// provedor pode alterar `subscriptions`. Redirect de sucesso do checkout NUNCA
// ativa assinatura.
//
// Nenhum endpoint de webhook existe hoje, porque nenhum gateway está definido.
// Este módulo entrega as peças provider-agnostic que o endpoint futuro usará.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedSubscriptionUpdate } from "./types";
import { shouldApplyUpdate } from "./status";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

/**
 * Reserva o evento. Retorna `false` quando ele já foi recebido antes —
 * garantido pelo UNIQUE(provider, provider_event_id) no banco.
 * O mesmo webhook pode chegar N vezes sem duplicar efeito.
 */
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
  // 23505 = unique_violation → evento repetido, já processado ou em processamento.
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

export async function finishWebhookEvent(
  admin: AnySupabase,
  args: {
    provider: string;
    providerEventId: string;
    status: "processed" | "ignored" | "failed";
    errorCode?: string | null;
  },
): Promise<void> {
  await admin
    .from("billing_events")
    .update({
      status: args.status,
      error_code: args.errorCode ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("provider", args.provider)
    .eq("provider_event_id", args.providerEventId);
}

/**
 * Localiza a assinatura pelos IDs já persistidos server-side.
 * `metadata.user_id` do payload NUNCA é autoridade isolada de identidade.
 */
export async function findSubscriptionByProviderIds(
  admin: AnySupabase,
  args: { providerSubscriptionId: string | null; providerCustomerId: string | null },
): Promise<{ user_id: string; current_period_ends_at: string | null; updated_at: string | null } | null> {
  const cols = "user_id, current_period_ends_at, updated_at";
  if (args.providerSubscriptionId) {
    const { data } = await admin
      .from("subscriptions")
      .select(cols)
      .eq("provider_subscription_id", args.providerSubscriptionId)
      .maybeSingle();
    if (data) return data as never;
  }
  if (args.providerCustomerId) {
    const { data } = await admin
      .from("subscriptions")
      .select(cols)
      .eq("provider_customer_id", args.providerCustomerId)
      .maybeSingle();
    if (data) return data as never;
  }
  return null;
}

/** Decide se o evento normalizado deve ser aplicado (protege contra evento atrasado). */
export function canApply(
  current: { current_period_ends_at: string | null; updated_at: string | null },
  update: NormalizedSubscriptionUpdate,
): boolean {
  return shouldApplyUpdate({
    currentPeriodEndsAt: current.current_period_ends_at,
    currentUpdatedAt: current.updated_at,
    incomingPeriodEndsAt: update.currentPeriodEndsAt,
    incomingOccurredAt: update.occurredAt,
  });
}
