// Partes PURAS do adapter Asaas (sem rede, sem segredos) — testáveis.
//
// Documentação oficial consultada (out/2026):
// - Checkout hospedado: POST /v3/checkouts (chargeTypes RECURRENT, billingTypes CREDIT_CARD)
// - Eventos de Checkout: CHECKOUT_PAID / CHECKOUT_CANCELED / CHECKOUT_EXPIRED
// - Eventos de cobrança: PAYMENT_CONFIRMED / PAYMENT_RECEIVED / PAYMENT_OVERDUE /
//   PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
// - Eventos de assinatura: SUBSCRIPTION_DELETED / SUBSCRIPTION_INACTIVATED
// - Autenticação do webhook: header `asaas-access-token` = authToken configurado
import type { BillingEvent, PlanVariant } from "../types";

export const ASAAS_SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3";

/** PNG 1x1 transparente — o Checkout exige imagem por item. */
const ITEM_IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

/** Asaas usa "YYYY-MM-DD HH:mm:ss" (horário de Brasília) — normaliza para ISO. */
export function asaasDateToIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(s);
  if (!m) return null;
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(s) && s.includes("T")) {
    const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(`${m[1]}T${m[2] ?? "00:00:00"}-03:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function buildCheckoutBody(args: {
  variant: PlanVariant;
  externalReference: string;
  firstChargeDate: string;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  minutesToExpire: number;
}) {
  return {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: args.minutesToExpire,
    externalReference: args.externalReference,
    callback: { successUrl: args.successUrl, cancelUrl: args.cancelUrl, expiredUrl: args.expiredUrl },
    items: [
      {
        externalReference: args.variant.planCode,
        name: args.variant.label,
        description: args.variant.label,
        quantity: 1,
        value: args.variant.amountCents / 100,
        imageBase64: ITEM_IMAGE,
      },
    ],
    subscription: {
      cycle: args.variant.interval === "year" ? "YEARLY" : "MONTHLY",
      nextDueDate: `${args.firstChargeDate} 00:00:00`,
    },
  };
}

/** Comparação em tempo constante do token do webhook. */
export function tokensMatch(received: string | null, expected: string): boolean {
  if (!received || !expected) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Converte o payload do Asaas em evento provider-agnostic. */
export function normalizeAsaasEvent(payload: Record<string, unknown>): BillingEvent {
  const type = String(payload["event"] ?? "");
  const occurredAt = asaasDateToIso(payload["dateCreated"]) ?? new Date().toISOString();

  if (type.startsWith("CHECKOUT_")) {
    const c = (payload["checkout"] ?? {}) as Record<string, unknown>;
    const id = str(c["id"]);
    if (!id) return { kind: "ignored", occurredAt };
    if (type === "CHECKOUT_PAID")
      return { kind: "checkout_paid", providerCheckoutId: id, providerCustomerId: str(c["customer"]), occurredAt };
    if (type === "CHECKOUT_CANCELED" || type === "CHECKOUT_EXPIRED")
      return {
        kind: "checkout_closed",
        providerCheckoutId: id,
        status: type === "CHECKOUT_CANCELED" ? "canceled" : "expired",
        occurredAt,
      };
    return { kind: "ignored", occurredAt };
  }

  if (type.startsWith("PAYMENT_")) {
    const p = (payload["payment"] ?? {}) as Record<string, unknown>;
    const providerSubscriptionId = str(p["subscription"]);
    // Só interessam cobranças de assinatura.
    if (!providerSubscriptionId) return { kind: "ignored", occurredAt };
    const providerCustomerId = str(p["customer"]);
    const periodStart = asaasDateToIso(p["dueDate"]) ?? occurredAt;
    if (type === "PAYMENT_CONFIRMED" || type === "PAYMENT_RECEIVED")
      return { kind: "payment_confirmed", providerCustomerId, providerSubscriptionId, periodStart, occurredAt };
    if (type === "PAYMENT_OVERDUE" || type === "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED")
      return { kind: "payment_failed", providerCustomerId, providerSubscriptionId, periodStart, occurredAt };
    return { kind: "ignored", occurredAt };
  }

  if (type === "SUBSCRIPTION_DELETED" || type === "SUBSCRIPTION_INACTIVATED") {
    const s = (payload["subscription"] ?? {}) as Record<string, unknown>;
    return {
      kind: "subscription_ended",
      providerSubscriptionId: str(s["id"]),
      providerCustomerId: str(s["customer"]),
      occurredAt,
    };
  }

  return { kind: "ignored", occurredAt };
}
