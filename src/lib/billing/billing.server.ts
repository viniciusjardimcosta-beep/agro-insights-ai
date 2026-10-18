// Operações de cobrança do usuário autenticado — server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBSCRIPTION_STATUS } from "@/lib/entitlements";
import type { BillingProvider } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export type BillingRow = {
  status: string;
  plan_code: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
};

/** Existe recorrência no gateway que pode gerar cobrança futura? */
export function hasLiveRecurrence(row: BillingRow | null): boolean {
  if (!row || !row.provider_customer_id) return false;
  if (row.cancel_at_period_end) return false;
  return (
    row.status === SUBSCRIPTION_STATUS.ACTIVE ||
    row.status === SUBSCRIPTION_STATUS.PAST_DUE ||
    row.status === SUBSCRIPTION_STATUS.TRIALING ||
    row.status === SUBSCRIPTION_STATUS.INCOMPLETE
  );
}

/**
 * Cancela a recorrência no gateway e registra o cancelamento agendado.
 * O Asaas não tem "cancelar no fim do período": a assinatura é removida
 * no gateway (nenhuma cobrança futura) e o AgroIntel mantém o acesso até
 * `current_period_ends_at` via entitlement engine (status canceled).
 * Lança em qualquer falha — quem chama decide (ex.: abortar exclusão).
 */
export async function cancelRecurrence(
  admin: AnySupabase,
  provider: BillingProvider,
  userId: string,
  row: BillingRow,
): Promise<void> {
  let subscriptionId = row.provider_subscription_id;
  if (!subscriptionId && row.provider_customer_id) {
    subscriptionId = await provider.findActiveSubscriptionId({ providerCustomerId: row.provider_customer_id });
  }
  if (subscriptionId) {
    await provider.cancelSubscription({ providerSubscriptionId: subscriptionId });
  }
  const now = new Date().toISOString();
  const patch =
    row.status === SUBSCRIPTION_STATUS.TRIALING
      ? { cancel_at_period_end: true, canceled_at: now, provider_subscription_id: null }
      : { status: SUBSCRIPTION_STATUS.CANCELED, cancel_at_period_end: true, canceled_at: now };
  const { error } = await admin.from("subscriptions").update(patch).eq("user_id", userId);
  if (error) throw error;
}

/** Instante (ISO) em que o trial interno termina, se ainda estiver em curso; senão null. */
export function activeTrialEndsAt(
  row: { status: string; trial_ends_at: string | null },
  now = new Date(),
): string | null {
  if (row.status !== SUBSCRIPTION_STATUS.TRIALING || !row.trial_ends_at) return null;
  const end = new Date(row.trial_ends_at);
  return end.getTime() > now.getTime() ? end.toISOString() : null;
}

/** Data (YYYY-MM-DD, America/Sao_Paulo) da 1ª cobrança: fim do trial interno, ou hoje. */
export function firstChargeDate(row: { status: string; trial_ends_at: string | null }, now = new Date()): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  if (row.status === SUBSCRIPTION_STATUS.TRIALING && row.trial_ends_at) {
    const end = new Date(row.trial_ends_at);
    if (end.getTime() > now.getTime()) return fmt(end);
  }
  return fmt(now);
}
