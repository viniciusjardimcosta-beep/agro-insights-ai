// Partes PURAS do adapter Stripe (sem rede, sem segredos) — testáveis.
//
// Documentação oficial consultada (out/2026):
// - Checkout Sessions (mode=subscription): https://docs.stripe.com/api/checkout/sessions/create
//   `subscription_data.trial_end` precisa estar ≥ 48h no futuro.
// - Webhook signatures: https://docs.stripe.com/webhooks#verify-manually
//   header `Stripe-Signature: t=<ts>,v1=<hex>`; HMAC-SHA256 de `${t}.${rawBody}`.
// - Subscriptions: https://docs.stripe.com/api/subscriptions/object
//   (a partir de 2025-03-31 os períodos ficam em `items.data[].current_period_*`).
// - Customer Portal: https://docs.stripe.com/api/customer_portal/sessions/create
import type { PlanVariant, SubscriptionSnapshot } from "../types";

export const STRIPE_API_BASE = "https://api.stripe.com/v1";
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** Stripe exige trial_end ≥ 48h no futuro; margem de 1h para latência. */
export const MIN_TRIAL_SECONDS = 49 * 3600;
/** Stripe exige expires_at do Checkout entre 30 min e 24 h. */
export const CHECKOUT_EXPIRES_MINUTES = 31;

/** Chaves de teste começam com sk_test_ / rk_test_. Qualquer outra coisa → recusada. */
export function isTestSecretKey(key: string): boolean {
  return /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key.trim());
}

/** Codifica objeto aninhado no formato application/x-www-form-urlencoded da Stripe. */
export function encodeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  const walk = (val: unknown, key: string) => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) val.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
    } else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  };
  walk(obj, prefix);
  return parts.join("&");
}

/**
 * Estratégia de contratação conforme o trial INTERNO (única fonte de verdade).
 * REGRA DOS 7 DIAS: ninguém é cobrado antes do fim do período gratuito prometido.
 * - ≥ 49h restantes → Checkout mode=subscription com trial_end = trial_ends_at;
 * - < 49h restantes (Stripe não aceita trial_end < 48h no Checkout) → Checkout
 *   mode=setup (só cadastra o cartão, sem cobrança) e a assinatura é criada no
 *   SERVIDOR após o setup, com trial_end = trial_ends_at original;
 * - trial já vencido → Checkout mode=subscription sem trial (cobrança imediata
 *   é correta: o período gratuito já terminou).
 * O cliente NUNCA informa a data de fim do trial.
 */
export type CheckoutStrategy =
  | { mode: "subscription"; trialEnd: number }
  | { mode: "setup"; trialEnd: number }
  | { mode: "subscription"; trialEnd: null };

export function checkoutStrategyForTrial(
  row: { status: string; trial_ends_at: string | null },
  nowMs = Date.now(),
): CheckoutStrategy {
  if (row.status !== "trialing" || !row.trial_ends_at) return { mode: "subscription", trialEnd: null };
  const end = Math.floor(new Date(row.trial_ends_at).getTime() / 1000);
  if (!Number.isFinite(end)) return { mode: "subscription", trialEnd: null };
  const now = Math.floor(nowMs / 1000);
  if (end <= now) return { mode: "subscription", trialEnd: null };
  if (end - now >= MIN_TRIAL_SECONDS) return { mode: "subscription", trialEnd: end };
  return { mode: "setup", trialEnd: end };
}

export function buildCheckoutParams(args: {
  priceId: string;
  customerId: string;
  checkoutRef: string;
  planCode: string;
  trialEnd: number | null;
  successUrl: string;
  cancelUrl: string;
  nowMs?: number;
}) {
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  return {
    mode: "subscription",
    customer: args.customerId,
    client_reference_id: args.checkoutRef,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    locale: "pt-BR",
    expires_at: now + CHECKOUT_EXPIRES_MINUTES * 60,
    metadata: { checkout_ref: args.checkoutRef, plan_code: args.planCode },
    subscription_data: {
      metadata: { checkout_ref: args.checkoutRef, plan_code: args.planCode },
      ...(args.trialEnd ? { trial_end: args.trialEnd } : {}),
    },
  };
}

/**
 * Checkout em modo SETUP: cadastra o cartão SEM nenhuma cobrança.
 * Usado quando o trial interno tem < 49h restantes — a assinatura é criada
 * depois, no servidor, respeitando o fim original do trial.
 */
export function buildSetupCheckoutParams(args: {
  customerId: string;
  checkoutRef: string;
  planCode: string;
  successUrl: string;
  cancelUrl: string;
  nowMs?: number;
}) {
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  return {
    mode: "setup",
    customer: args.customerId,
    client_reference_id: args.checkoutRef,
    payment_method_types: ["card"],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    locale: "pt-BR",
    expires_at: now + CHECKOUT_EXPIRES_MINUTES * 60,
    metadata: { checkout_ref: args.checkoutRef, plan_code: args.planCode },
    setup_intent_data: {
      metadata: { checkout_ref: args.checkoutRef, plan_code: args.planCode },
    },
  };
}

/** Confere o Price da Stripe contra o catálogo interno. Divergência → false (fail-closed). */
export function priceMatchesVariant(price: Record<string, unknown>, variant: PlanVariant): boolean {
  const rec = (price["recurring"] ?? null) as Record<string, unknown> | null;
  return (
    price["active"] === true &&
    price["livemode"] === false &&
    price["type"] === "recurring" &&
    String(price["currency"] ?? "").toLowerCase() === variant.currency.toLowerCase() &&
    price["unit_amount"] === variant.amountCents &&
    !!rec &&
    rec["interval"] === variant.interval &&
    (rec["interval_count"] ?? 1) === 1 &&
    (rec["trial_period_days"] ?? null) === null
  );
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function computeSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
}

/** Verificação oficial (manual) do Stripe-Signature sobre o RAW BODY, com tolerância de 5 min. */
export async function verifyStripeSignature(args: {
  rawBody: string;
  header: string | null;
  secret: string;
  nowSeconds?: number;
}): Promise<boolean> {
  if (!args.header || !args.secret) return false;
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of args.header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t" && v) t = v;
    if (k === "v1" && v) v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = await computeSignature(args.secret, t, args.rawBody);
  return v1.some((sig) => constantTimeEqual(sig, expected));
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const idOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>)["id"]) : null);
const isoFromUnix = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null;

/** Eventos tratados. Os demais são registrados como ignorados. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export type StripeEventRefs = {
  type: string;
  livemode: boolean;
  checkoutSessionId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
};

/** Extrai apenas referências (IDs) do evento. Metadata NUNCA é usada como autoridade. */
export function extractEventRefs(event: Record<string, unknown>): StripeEventRefs {
  const type = String(event["type"] ?? "");
  const obj = (((event["data"] ?? {}) as Record<string, unknown>)["object"] ?? {}) as Record<string, unknown>;
  const refs: StripeEventRefs = {
    type,
    livemode: event["livemode"] === true,
    checkoutSessionId: null,
    subscriptionId: null,
    customerId: idOf(obj["customer"]),
  };
  if (type.startsWith("checkout.session.")) {
    refs.checkoutSessionId = str(obj["id"]);
    refs.subscriptionId = idOf(obj["subscription"]);
  } else if (type.startsWith("customer.subscription.")) {
    refs.subscriptionId = str(obj["id"]);
  } else if (type.startsWith("invoice.")) {
    const parent = (obj["parent"] ?? {}) as Record<string, unknown>;
    const details = (parent["subscription_details"] ?? {}) as Record<string, unknown>;
    refs.subscriptionId = idOf(obj["subscription"]) ?? idOf(details["subscription"]);
  }
  return refs;
}

/** Converte o objeto Subscription (estado autoritativo buscado na Stripe) em snapshot neutro. */
export function subscriptionToSnapshot(
  sub: Record<string, unknown>,
  planCodeForPrice: (priceId: string) => string | null,
): SubscriptionSnapshot | null {
  const id = str(sub["id"]);
  const customer = idOf(sub["customer"]);
  const status = str(sub["status"]);
  if (!id || !customer || !status) return null;
  const items = (((sub["items"] ?? {}) as Record<string, unknown>)["data"] ?? []) as Record<string, unknown>[];
  const item = items[0] ?? {};
  const price = (item["price"] ?? {}) as Record<string, unknown>;
  const priceId = str(price["id"]);
  return {
    providerSubscriptionId: id,
    providerCustomerId: customer,
    providerStatus: status,
    planCode: priceId ? planCodeForPrice(priceId) : null,
    periodStart: isoFromUnix(item["current_period_start"] ?? sub["current_period_start"]),
    periodEnd: isoFromUnix(item["current_period_end"] ?? sub["current_period_end"]),
    cancelAtPeriodEnd: sub["cancel_at_period_end"] === true || typeof sub["cancel_at"] === "number",
    canceledAt: isoFromUnix(sub["ended_at"] ?? sub["canceled_at"]),
    livemode: sub["livemode"] === true,
  };
}
