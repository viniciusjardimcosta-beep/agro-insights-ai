// Reconciliação PURA: evento normalizado + estado atual → patch em subscriptions.
// Determinística, sem rede e sem banco — coberta por testes.
import { SUBSCRIPTION_STATUS } from "@/lib/entitlements";
import { addInterval, findPlanVariant } from "./plans";
import { shouldApplyUpdate } from "./status";
import type { BillingEvent } from "./types";

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
  | "subscription_canceled";

export type ReconcileResult = { patch: SubPatch | null; audit: ReconcileAudit | null; consumeFounder: boolean };

const NOOP: ReconcileResult = { patch: null, audit: null, consumeFounder: false };
const ms = (v: string | null) => (v ? new Date(v).getTime() : null);

export function reconcile(current: SubState, event: BillingEvent): ReconcileResult {
  const variant = findPlanVariant(current.plan_code);

  if (event.kind === "payment_confirmed") {
    if (!variant) return NOOP; // plan_code não pago: nada a aplicar
    if (
      current.provider_subscription_id &&
      event.providerSubscriptionId &&
      current.provider_subscription_id !== event.providerSubscriptionId
    ) {
      return NOOP; // cobrança de outra assinatura (antiga) — não sobrescreve
    }
    const periodEnd = addInterval(event.periodStart, variant.interval);
    if (
      !shouldApplyUpdate({
        currentPeriodEndsAt: current.current_period_ends_at,
        currentUpdatedAt: current.updated_at,
        incomingPeriodEndsAt: periodEnd,
        incomingOccurredAt: event.occurredAt,
      })
    ) {
      return NOOP;
    }
    const cur = ms(current.current_period_ends_at);
    if (current.status === SUBSCRIPTION_STATUS.ACTIVE && cur !== null && ms(periodEnd)! <= cur) {
      return NOOP; // mesmo período já aplicado (ex.: CONFIRMED seguido de RECEIVED)
    }
    const wasActive = current.status === SUBSCRIPTION_STATUS.ACTIVE;
    return {
      patch: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        current_period_started_at: event.periodStart,
        current_period_ends_at: periodEnd,
        provider_subscription_id: event.providerSubscriptionId ?? current.provider_subscription_id,
      },
      audit: wasActive ? "subscription_renewed" : "subscription_activated",
      consumeFounder: !wasActive && variant.requiresFounderEligibility,
    };
  }

  if (event.kind === "payment_failed") {
    if (!variant) return NOOP;
    if (current.status === SUBSCRIPTION_STATUS.CANCELED || current.status === SUBSCRIPTION_STATUS.PAST_DUE)
      return NOOP;
    if (
      current.provider_subscription_id &&
      event.providerSubscriptionId &&
      current.provider_subscription_id !== event.providerSubscriptionId
    ) {
      return NOOP;
    }
    const periodEnd = ms(addInterval(event.periodStart, variant.interval))!;
    const cur = ms(current.current_period_ends_at);
    if (cur !== null && periodEnd <= cur) return NOOP; // período já pago / evento antigo
    return {
      patch: {
        status: SUBSCRIPTION_STATUS.PAST_DUE,
        provider_subscription_id: event.providerSubscriptionId ?? current.provider_subscription_id,
      },
      audit: "payment_failed",
      consumeFounder: false,
    };
  }

  if (event.kind === "subscription_ended") {
    if (
      current.provider_subscription_id &&
      event.providerSubscriptionId &&
      current.provider_subscription_id !== event.providerSubscriptionId
    ) {
      return NOOP;
    }
    if (current.status === SUBSCRIPTION_STATUS.TRIALING) {
      // Encerrada antes da primeira cobrança: o trial interno segue intacto.
      if (current.cancel_at_period_end && !current.provider_subscription_id) return NOOP;
      return {
        patch: { provider_subscription_id: null, cancel_at_period_end: true, canceled_at: event.occurredAt },
        audit: "subscription_canceled",
        consumeFounder: false,
      };
    }
    if (current.status === SUBSCRIPTION_STATUS.CANCELED) return NOOP;
    // Mantém current_period_ends_at: acesso até o fim do período pago.
    return {
      patch: { status: SUBSCRIPTION_STATUS.CANCELED, cancel_at_period_end: true, canceled_at: event.occurredAt },
      audit: "subscription_canceled",
      consumeFounder: false,
    };
  }

  return NOOP;
}
