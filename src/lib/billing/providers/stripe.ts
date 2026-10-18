// Partes PURAS do adapter Stripe (sem rede, sem segredos) — testáveis.
//
// Documentação oficial consultada (out/2026):
// - Checkout Session (modo subscription): POST /v1/checkout/sessions
//   · expires_at: de 30 minutos a 24 horas após a criação
//   · client_reference_id: até 200 caracteres; locale "pt-BR" é válido
//   · payment_method_collection = "always" (padrão): o cartão é coletado mesmo com trial
// - Assinatura do webhook: header `Stripe-Signature` = `t=<unix>,v1=<hex>[,v1=<hex>…]`,
//   HMAC-SHA256 do texto `${t}.${corpoBruto}` com o segredo `whsec_…`; basta uma assinatura v1 válida.
// - Faturas (API ≥ 2025-03-31 "basil"): a assinatura fica em
//   `invoice.parent.subscription_details.subscription` (antes: `invoice.subscription`).
//   Este adapter lê os DOIS formatos, pois a versão da API do endpoint de webhook é definida no painel.
//
// NÃO verificado contra a API real (sem acesso de rede no ambiente de desenvolvimento):
// o prazo mínimo de `subscription_data.trial_end` no Checkout (48 h, segundo o conhecimento
// do autor). Por isso o adapter é conservador: com menos de 48 h de trial restante,
// a cobrança começa imediatamente em vez de enviar um `trial_end` que o Stripe poderia recusar.
import type { BillingEvent, PlanVariant } from "../types";

export const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

/** Tolerância do relógio na assinatura do webhook (5 min, padrão recomendado pelo Stripe). */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

/** Trial restante mínimo para repassar `trial_end` ao Stripe: 48 h + 5 min de folga. */
export const STRIPE_MIN_TRIAL_LEAD_MS = 48 * 60 * 60 * 1000 + 5 * 60 * 1000;

/** Expiração mínima da sessão aceita pelo Stripe é 30 min; 31 evita falha por atraso de relógio. */
export const STRIPE_MIN_SESSION_MINUTES = 31;

// ───────────────────────────── Configuração (fail-closed) ─────────────────────────────

export const STRIPE_ENV_NAMES = {
  environment: "STRIPE_ENVIRONMENT",
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
} as const;

export type StripeEnvironment = "test" | "live";
export type StripeConfig = { secretKey: string; webhookSecret: string; environment: StripeEnvironment };

/**
 * Lê a configuração; retorna null (fail-closed) se faltar qualquer item ou se o ambiente
 * declarado não combinar com o tipo da chave (chave de teste com `live` e vice-versa).
 * Cobrança real só existe com STRIPE_ENVIRONMENT=live E uma chave `sk_live_`/`rk_live_`.
 */
export function readStripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const environment = (env[STRIPE_ENV_NAMES.environment] ?? "").trim().toLowerCase();
  if (environment !== "test" && environment !== "live") return null;
  const secretKey = (env[STRIPE_ENV_NAMES.secretKey] ?? "").trim();
  const webhookSecret = (env[STRIPE_ENV_NAMES.webhookSecret] ?? "").trim();
  if (!secretKey || !webhookSecret) return null;
  const keyPattern = environment === "test" ? /^(sk|rk)_test_[A-Za-z0-9]+$/ : /^(sk|rk)_live_[A-Za-z0-9]+$/;
  if (!keyPattern.test(secretKey)) return null;
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) return null;
  return { secretKey, webhookSecret, environment };
}

// ───────────────────────────── Checkout ─────────────────────────────

/**
 * `trial_end` (segundos Unix) a repassar ao Stripe, ou null para cobrar imediatamente.
 * Cobra já quando não há trial em curso ou quando resta menos que o mínimo aceito.
 */
export function resolveTrialEndUnix(trialEndsAt: string | null | undefined, nowMs: number): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  if (end - nowMs < STRIPE_MIN_TRIAL_LEAD_MS) return null;
  return Math.floor(end / 1000);
}

export type StripeCheckoutArgs = {
  variant: PlanVariant;
  externalReference: string;
  trialEndsAt?: string | null;
  successUrl: string;
  cancelUrl: string;
  minutesToExpire: number;
};

/**
 * Parâmetros do POST /v1/checkout/sessions (formato form-encoded com colchetes).
 * O preço é enviado inline (`price_data`): não é preciso criar Produtos/Preços no painel.
 * Valor, ciclo e nome vêm SEMPRE do catálogo do servidor.
 */
export function buildCheckoutParams(args: StripeCheckoutArgs, nowMs: number): [string, string][] {
  const minutes = Math.max(Math.floor(args.minutesToExpire), STRIPE_MIN_SESSION_MINUTES);
  const params: [string, string][] = [
    ["mode", "subscription"],
    ["client_reference_id", args.externalReference],
    ["success_url", args.successUrl],
    ["cancel_url", args.cancelUrl],
    ["locale", "pt-BR"],
    ["payment_method_types[0]", "card"],
    ["expires_at", String(Math.floor(nowMs / 1000) + minutes * 60)],
    ["line_items[0][quantity]", "1"],
    ["line_items[0][price_data][currency]", args.variant.currency.toLowerCase()],
    ["line_items[0][price_data][unit_amount]", String(args.variant.amountCents)],
    ["line_items[0][price_data][recurring][interval]", args.variant.interval],
    ["line_items[0][price_data][product_data][name]", args.variant.label],
    // Metadados apenas para conferência no painel do Stripe — nunca são autoridade no webhook.
    ["subscription_data[metadata][plan_code]", args.variant.planCode],
    ["subscription_data[metadata][checkout_ref]", args.externalReference],
  ];
  const trialEnd = resolveTrialEndUnix(args.trialEndsAt, nowMs);
  if (trialEnd !== null) params.push(["subscription_data[trial_end]", String(trialEnd)]);
  return params;
}

// ───────────────────────────── Assinatura do webhook ─────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  // Web Crypto: disponível no Node e no runtime Cloudflare Workers (alvo de build do app).
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valida o header `Stripe-Signature` contra o CORPO BRUTO (sem reserializar o JSON). */
export async function verifyStripeSignature(args: {
  rawBody: string;
  header: string | null;
  secret: string;
  nowMs: number;
  toleranceSec?: number;
}): Promise<boolean> {
  const { rawBody, header, secret, nowMs } = args;
  const tolerance = args.toleranceSec ?? STRIPE_SIGNATURE_TOLERANCE_SEC;
  if (!header || !secret) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") signatures.push(v);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > tolerance) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  // Avalia todas (sem curto-circuito) para não vazar posição da assinatura que casou.
  let ok = false;
  for (const s of signatures) if (constantTimeEqual(s, expected)) ok = true;
  return ok;
}

// ───────────────────────────── Normalização de eventos ─────────────────────────────

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** O Stripe devolve ids como string ou, se expandido, como objeto com `id`. */
const idOf = (v: unknown): string | null => str(v) ?? str(asObj(v)["id"]);
const unixToIso = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : new Date(n * 1000).toISOString();
};

/** Assinatura da fatura: formato novo (`parent`) e legado (`subscription`). */
export function invoiceSubscriptionId(invoice: Obj): string | null {
  const parent = asObj(invoice["parent"]);
  if (parent["type"] === "subscription_details") {
    const id = idOf(asObj(parent["subscription_details"])["subscription"]);
    if (id) return id;
  }
  return idOf(invoice["subscription"]);
}

/** Início do período coberto pela fatura = início do período da linha de assinatura. */
export function invoicePeriodStartIso(invoice: Obj): string | null {
  const lines = Array.isArray(asObj(invoice["lines"])["data"]) ? (asObj(invoice["lines"])["data"] as unknown[]) : [];
  const isSubscriptionLine = (l: Obj): boolean =>
    asObj(l["parent"])["type"] === "subscription_item_details" || l["type"] === "subscription";
  const objs = lines.map(asObj);
  const line = objs.find((l) => isSubscriptionLine(l) && num(asObj(l["period"])["start"]) !== null)
    ?? objs.find((l) => num(asObj(l["period"])["start"]) !== null);
  return unixToIso(asObj(line?.["period"])["start"]) ?? unixToIso(invoice["period_start"]);
}

/** Converte o evento do Stripe em evento provider-agnostic. */
export function normalizeStripeEvent(event: Obj): BillingEvent {
  const type = String(event["type"] ?? "");
  const occurredAt = unixToIso(event["created"]) ?? new Date().toISOString();
  const object = asObj(asObj(event["data"])["object"]);

  if (type === "checkout.session.completed") {
    if (object["mode"] !== "subscription") return { kind: "ignored", occurredAt };
    const id = str(object["id"]);
    if (!id) return { kind: "ignored", occurredAt };
    // "no_payment_required" = trial (cartão registrado, 1ª cobrança futura); "paid" = cobrança imediata.
    const status = object["payment_status"];
    if (status !== "paid" && status !== "no_payment_required") return { kind: "ignored", occurredAt };
    return {
      kind: "checkout_paid",
      providerCheckoutId: id,
      providerCustomerId: idOf(object["customer"]),
      providerSubscriptionId: idOf(object["subscription"]),
      occurredAt,
    };
  }

  if (type === "checkout.session.expired") {
    if (object["mode"] !== "subscription") return { kind: "ignored", occurredAt };
    const id = str(object["id"]);
    if (!id) return { kind: "ignored", occurredAt };
    return { kind: "checkout_closed", providerCheckoutId: id, status: "expired", occurredAt };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const providerSubscriptionId = invoiceSubscriptionId(object);
    // Só interessam faturas de assinatura.
    if (!providerSubscriptionId) return { kind: "ignored", occurredAt };
    const providerCustomerId = idOf(object["customer"]);
    const periodStart = invoicePeriodStartIso(object) ?? occurredAt;

    if (type === "invoice.paid") {
      // Fatura de R$ 0 (início do trial) NÃO é pagamento: ativaria a assinatura de graça.
      if (!((num(object["amount_paid"]) ?? 0) > 0)) return { kind: "ignored", occurredAt };
      return { kind: "payment_confirmed", providerCustomerId, providerSubscriptionId, periodStart, occurredAt };
    }
    if (!((num(object["amount_due"]) ?? 0) > 0)) return { kind: "ignored", occurredAt };
    return { kind: "payment_failed", providerCustomerId, providerSubscriptionId, periodStart, occurredAt };
  }

  if (type === "customer.subscription.deleted") {
    return {
      kind: "subscription_ended",
      providerSubscriptionId: str(object["id"]),
      providerCustomerId: idOf(object["customer"]),
      occurredAt,
    };
  }

  return { kind: "ignored", occurredAt };
}
