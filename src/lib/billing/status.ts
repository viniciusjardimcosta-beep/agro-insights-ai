// Mapeamento central de status do provedor → status canônico interno.
//
// Nomes específicos de gateway NÃO circulam pela aplicação: tudo passa aqui.
// Cada adapter pode sobrescrever, mas deve documentar a correspondência.
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from "@/lib/entitlements";

/**
 * Vocabulário comum entre provedores recorrentes.
 *
 * | Provedor (exemplos)                          | Interno       |
 * | -------------------------------------------- | ------------- |
 * | trialing / in_trial                          | trialing      |
 * | active / authorized / paid / approved        | active        |
 * | past_due / unpaid / payment_failed / overdue | past_due      |
 * | canceled / cancelled / ended                 | canceled      |
 * | expired                                      | expired       |
 * | incomplete / pending / paused / desconhecido | incomplete    |
 */
export function mapProviderStatus(raw: string): SubscriptionStatus {
  const v = (raw ?? "").trim().toLowerCase();
  if (["trialing", "in_trial", "trial"].includes(v)) return SUBSCRIPTION_STATUS.TRIALING;
  if (["active", "authorized", "paid", "approved", "renewed"].includes(v))
    return SUBSCRIPTION_STATUS.ACTIVE;
  if (["past_due", "unpaid", "payment_failed", "overdue", "suspended"].includes(v))
    return SUBSCRIPTION_STATUS.PAST_DUE;
  if (["canceled", "cancelled", "ended", "closed"].includes(v)) return SUBSCRIPTION_STATUS.CANCELED;
  if (["expired"].includes(v)) return SUBSCRIPTION_STATUS.EXPIRED;
  return SUBSCRIPTION_STATUS.INCOMPLETE;
}

/**
 * Eventos fora de ordem: um webhook antigo nunca pode sobrescrever um estado
 * financeiro mais novo. A regra é comparar o fim do período conhecido com o do
 * evento; se o evento for anterior ao estado atual, ele é descartado.
 */
export function shouldApplyUpdate(args: {
  currentPeriodEndsAt: string | null;
  currentUpdatedAt: string | null;
  incomingPeriodEndsAt: string | null;
  incomingOccurredAt: string;
}): boolean {
  const t = (v: string | null) => {
    if (!v) return null;
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const curPeriod = t(args.currentPeriodEndsAt);
  const inPeriod = t(args.incomingPeriodEndsAt);
  if (curPeriod !== null && inPeriod !== null && inPeriod < curPeriod) return false;

  const curUpdated = t(args.currentUpdatedAt);
  const occurred = t(args.incomingOccurredAt);
  if (curUpdated !== null && occurred !== null && occurred < curUpdated && inPeriod === null) {
    return false;
  }
  return true;
}
