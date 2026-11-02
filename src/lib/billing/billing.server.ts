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

/** Existe assinatura no gateway que pode gerar cobrança futura? */
export function hasLiveRecurrence(row: BillingRow | null): boolean {
  if (!row || !row.provider_subscription_id) return false;
  if (row.cancel_at_period_end) return false;
  return (
    row.status === SUBSCRIPTION_STATUS.ACTIVE ||
    row.status === SUBSCRIPTION_STATUS.PAST_DUE ||
    row.status === SUBSCRIPTION_STATUS.TRIALING ||
    row.status === SUBSCRIPTION_STATUS.INCOMPLETE
  );
}

/** Há assinatura vinculada que ainda não terminou (inclui cancelamento agendado)? */
export function hasOpenSubscription(row: BillingRow | null): boolean {
  return !!row?.provider_subscription_id && row.status !== SUBSCRIPTION_STATUS.CANCELED && row.status !== SUBSCRIPTION_STATUS.EXPIRED;
}

/**
 * Exclusão de conta: encerra IMEDIATAMENTE toda recorrência do customer na Stripe
 * (cancel_at_period_end não basta — ainda existiria uma assinatura viva).
 * Lança em qualquer falha — quem chama aborta a exclusão.
 */
export async function cancelForAccountDeletion(provider: BillingProvider, row: BillingRow | null): Promise<void> {
  if (!row?.provider_customer_id) return;
  await provider.cancelAllImmediately({ providerCustomerId: row.provider_customer_id });
}

/** Aplica o snapshot devolvido pela Stripe após agendar/desfazer cancelamento. */
export async function persistCancelFlag(admin: AnySupabase, userId: string, cancel: boolean): Promise<void> {
  const { error } = await admin
    .from("subscriptions")
    .update({ cancel_at_period_end: cancel, canceled_at: cancel ? new Date().toISOString() : null })
    .eq("user_id", userId);
  if (error) throw error;
}
