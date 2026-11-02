// Reconciliação PURA: snapshot autoritativo do gateway + estado atual → patch em subscriptions.
// Determinística, sem rede e sem banco — coberta por testes.
//
// O webhook nunca aplica o payload do evento: ele busca a Subscription atual na
// Stripe pelo ID e aplica o snapshot. Assim, eventos fora de ordem não regridem estado.
import { SUBSCRIPTION_STATUS } from "@/lib/entitlements";
import { findPlanVariant } from "./plans";
import type { SubscriptionSnapshot } from "./types";

export type SubState = {
  status: string;
  plan_code: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  updated_at: string | null;
};

export type SubPatch = Partial<{
  status: string;
  plan_code: string;
  current_period_started_at: string;
  current_period_ends_at: string;
  provider_subscription_id: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
}>;

export type ReconcileAudit =
  | "subscription_activated"
  | "subscription_renewed"
  | "payment_failed"
  | "subscription_cancel_scheduled"
  | "subscription_canceled";

export type ReconcileResult = { patch: SubPatch | null; audits: ReconcileAudit[]; consumeFounder: boolean };

const NOOP: ReconcileResult = { patch: null, audits: [], consumeFounder: false };
const ms = (v: string | null) => (v ? new Date(v).getTime() : null);
const TERMINAL = ["canceled", "incomplete_expired"];

/** Mapa Stripe → interno. Desconhecido nunca libera acesso. */
export function mapStripeStatus(s: string): string | null {
  if (s === "trialing") return SUBSCRIPTION_STATUS.TRIALING;
  if (s === "active") return SUBSCRIPTION_STATUS.ACTIVE;
  if (s === "past_due" || s === "unpaid") return SUBSCRIPTION_STATUS.PAST_DUE;
  if (TERMINAL.includes(s)) return SUBSCRIPTION_STATUS.CANCELED;
  return null; // incomplete / paused / desconhecido → não altera status
}

export function reconcile(current: SubState, snap: SubscriptionSnapshot): ReconcileResult {
  if (snap.livemode) return NOOP;
  // Ownership: customer do snapshot precisa ser o customer persistido do usuário.
  if (!current.provider_customer_id || current.provider_customer_id !== snap.providerCustomerId) return NOOP;
  if (!snap.planCode || !findPlanVariant(snap.planCode)) return NOOP; // Price não autorizado

  const sameSub = current.provider_subscription_id === snap.providerSubscriptionId;
  const target = mapStripeStatus(snap.providerStatus);

  if (!sameSub && current.provider_subscription_id) {
    // Outra assinatura do mesmo customer: só substitui a antiga se ela já terminou
    // e a nova não é terminal (nunca troca uma assinatura viva).
    const oldEnded = current.status === SUBSCRIPTION_STATUS.CANCELED || current.status === SUBSCRIPTION_STATUS.EXPIRED;
    if (!oldEnded || target === SUBSCRIPTION_STATUS.CANCELED) return NOOP;
  }
  if (sameSub && current.status === SUBSCRIPTION_STATUS.CANCELED && target !== SUBSCRIPTION_STATUS.CANCELED) {
    return NOOP; // assinatura encerrada não "revive" por evento antigo
  }
  if (sameSub) {
    const cur = ms(current.current_period_ends_at);
    const inc = ms(snap.periodEnd);
    if (cur !== null && inc !== null && inc < cur) return NOOP; // período regrediria
  }

  const patch: SubPatch = {
    provider_subscription_id: snap.providerSubscriptionId,
    plan_code: snap.planCode,
    cancel_at_period_end: snap.cancelAtPeriodEnd,
  };
  const audits: ReconcileAudit[] = [];
  let consumeFounder = false;
  const founder = findPlanVariant(snap.planCode)!.requiresFounderEligibility;

  if (target === SUBSCRIPTION_STATUS.TRIALING) {
    // Trial interno é a fonte: só registramos o vínculo; datas internas intocadas.
    if (current.status !== SUBSCRIPTION_STATUS.TRIALING) return NOOP;
  } else if (target === SUBSCRIPTION_STATUS.ACTIVE) {
    if (!snap.periodStart || !snap.periodEnd) return NOOP;
    patch.status = SUBSCRIPTION_STATUS.ACTIVE;
    patch.current_period_started_at = snap.periodStart;
    patch.current_period_ends_at = snap.periodEnd;
    patch.canceled_at = null;
    const wasActive = current.status === SUBSCRIPTION_STATUS.ACTIVE && sameSub;
    if (!wasActive && current.status !== SUBSCRIPTION_STATUS.PAST_DUE) {
      audits.push("subscription_activated");
      consumeFounder = founder;
    } else if (current.status === SUBSCRIPTION_STATUS.PAST_DUE) {
      audits.push("subscription_renewed");
    } else if ((ms(snap.periodEnd) ?? 0) > (ms(current.current_period_ends_at) ?? 0)) {
      audits.push("subscription_renewed");
    }
  } else if (target === SUBSCRIPTION_STATUS.PAST_DUE) {
    patch.status = SUBSCRIPTION_STATUS.PAST_DUE;
    if (current.status !== SUBSCRIPTION_STATUS.PAST_DUE) audits.push("payment_failed");
  } else if (target === SUBSCRIPTION_STATUS.CANCELED) {
    patch.cancel_at_period_end = true;
    patch.canceled_at = snap.canceledAt ?? current.updated_at;
    if (current.status === SUBSCRIPTION_STATUS.TRIALING) {
      // Encerrada antes da 1ª cobrança: o trial interno continua intacto.
      patch.provider_subscription_id = null;
      if (!current.provider_subscription_id) return NOOP;
    } else {
      if (current.status === SUBSCRIPTION_STATUS.CANCELED) return NOOP;
      patch.status = SUBSCRIPTION_STATUS.CANCELED; // mantém current_period_ends_at
    }
    audits.push("subscription_canceled");
  } else if (!(sameSub || !current.provider_subscription_id)) {
    return NOOP;
  }

  if (
    target !== SUBSCRIPTION_STATUS.CANCELED &&
    snap.cancelAtPeriodEnd &&
    !(sameSub && current.cancel_at_period_end)
  ) {
    audits.push("subscription_cancel_scheduled");
  }

  // Nada mudou de fato → no-op (eventos duplicados / reentrega).
  const changed = (Object.keys(patch) as (keyof SubPatch)[]).some((k) => {
    const cur = (current as unknown as Record<string, unknown>)[k];
    if (cur === undefined) return false; // campos não rastreados no estado (derivados) não indicam mudança
    const a = patch[k];
    if (typeof a === "string" && typeof cur === "string" && ms(a) !== null && !Number.isNaN(ms(a)) && /T/.test(a))
      return ms(a) !== ms(cur);
    return a !== cur;
  });
  if (!changed && audits.length === 0) return NOOP;
  return { patch, audits, consumeFounder };
}
