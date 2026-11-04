// Adapter Stripe — server-only. Único módulo que fala com a API da Stripe.
//
// FAIL-CLOSED: nesta fase só opera com STRIPE_ENVIRONMENT=test e chave sk_test_/rk_test_.
// Objetos livemode=true (prices, subscriptions, eventos) são sempre recusados.
import type { BillingProvider, PlanVariant } from "../types";
import {
  STRIPE_API_BASE,
  buildCheckoutParams,
  buildSetupCheckoutParams,
  encodeForm,
  extractEventRefs,
  isTestSecretKey,
  priceMatchesVariant,
  subscriptionToSnapshot,
  verifyStripeSignature,
} from "./stripe";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const idOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>)["id"]) : null);

export const STRIPE_ENV_NAMES = {
  environment: "STRIPE_ENVIRONMENT",
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  prices: {
    pro_monthly: "STRIPE_PRICE_PRO_MONTHLY",
    pro_yearly: "STRIPE_PRICE_PRO_YEARLY",
    pro_founder_monthly: "STRIPE_PRICE_PRO_FOUNDER_MONTHLY",
  },
} as const;

export type StripeConfig = { secretKey: string; webhookSecret: string; prices: Record<string, string> };

/** Lê a configuração; null (fail-closed) se não for test mode ou faltar secret. */
export function readStripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  if ((env[STRIPE_ENV_NAMES.environment] ?? "").trim().toLowerCase() !== "test") return null;
  const secretKey = (env[STRIPE_ENV_NAMES.secretKey] ?? "").trim();
  const webhookSecret = (env[STRIPE_ENV_NAMES.webhookSecret] ?? "").trim();
  if (!isTestSecretKey(secretKey) || !webhookSecret.startsWith("whsec_")) return null;
  const prices: Record<string, string> = {};
  for (const [plan, name] of Object.entries(STRIPE_ENV_NAMES.prices)) {
    const v = (env[name] ?? "").trim();
    if (/^price_[A-Za-z0-9]+$/.test(v)) prices[plan] = v;
  }
  return { secretKey, webhookSecret, prices };
}

export class StripeRequestError extends Error {
  constructor(readonly httpStatus: number) {
    super(`stripe_http_${httpStatus}`);
  }
}

const PORTAL_CONFIG_MARKER = "agrointel_v1";

export function createStripeProvider(cfg: StripeConfig): BillingProvider {
  const call = async (
    path: string,
    init: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown>; idempotencyKey?: string } = {},
  ) => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${cfg.secretKey}`,
      accept: "application/json",
    };
    if (init.body) headers["content-type"] = "application/x-www-form-urlencoded";
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    const res = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers,
      body: init.body ? encodeForm(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    // Corpo de erro nunca é repassado ao usuário nem logado.
    if (!res.ok) throw new StripeRequestError(res.status);
    const data = (await res.json()) as Record<string, unknown>;
    if (data["livemode"] === true) throw new StripeRequestError(403); // nunca live nesta sprint
    return data;
  };

  const planCodeForPrice = (priceId: string) =>
    Object.entries(cfg.prices).find(([, id]) => id === priceId)?.[0] ?? null;

  const snapshot = (data: Record<string, unknown>) => subscriptionToSnapshot(data, planCodeForPrice);

  async function portalConfigurationId(): Promise<string> {
    const list = await call("/billing_portal/configurations?active=true&limit=100");
    const found = ((list["data"] ?? []) as Record<string, unknown>[]).find(
      (c) => ((c["metadata"] ?? {}) as Record<string, unknown>)["agrointel"] === PORTAL_CONFIG_MARKER,
    );
    if (found && typeof found["id"] === "string") return found["id"];
    // Portal: troca de cartão, faturas e cancelamento SEMPRE no fim do período.
    // Troca de plano desabilitada (preço só muda via catálogo do servidor).
    const created = await call("/billing_portal/configurations", {
      idempotencyKey: `portal-config-${PORTAL_CONFIG_MARKER}`,
      body: {
        business_profile: { headline: "AgroIntel AI — gerencie sua assinatura" },
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          customer_update: { enabled: false },
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
        },
        metadata: { agrointel: PORTAL_CONFIG_MARKER },
      },
    });
    return String(created["id"]);
  }

  return {
    id: "stripe",
    hasCustomerPortal: true,
    planCodeForPrice,

    async createCustomer({ userId, email }) {
      // Idempotency-Key por usuário: chamadas concorrentes retornam o MESMO customer.
      const data = await call("/customers", {
        idempotencyKey: `agrointel-customer-${userId}`,
        body: { ...(email ? { email } : {}), metadata: { agrointel_ref: userId.slice(0, 8) } },
      });
      if (typeof data["id"] !== "string") throw new StripeRequestError(502);
      return data["id"];
    },

    async resolvePrice(variant: PlanVariant) {
      const priceId = cfg.prices[variant.planCode];
      if (!priceId) throw new StripeRequestError(412);
      const price = await call(`/prices/${encodeURIComponent(priceId)}`);
      if (!priceMatchesVariant(price, variant)) throw new StripeRequestError(409);
      return priceId;
    },

    async createCheckoutSession(args) {
      const data = await call("/checkout/sessions", {
        idempotencyKey: `agrointel-checkout-${args.checkoutRef}`,
        body: buildCheckoutParams({
          priceId: args.priceId,
          customerId: args.customerId,
          checkoutRef: args.checkoutRef,
          planCode: args.variant.planCode,
          trialEnd: args.trialEnd,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
        }),
      });
      const id = typeof data["id"] === "string" ? data["id"] : null;
      const url = typeof data["url"] === "string" ? data["url"] : null;
      if (!id || !url || !url.startsWith("https://checkout.stripe.com/")) throw new StripeRequestError(502);
      return { url, providerCheckoutId: id };
    },

    async createSetupCheckoutSession(args) {
      const data = await call("/checkout/sessions", {
        idempotencyKey: `agrointel-setup-${args.checkoutRef}`,
        body: buildSetupCheckoutParams({
          customerId: args.customerId,
          checkoutRef: args.checkoutRef,
          planCode: args.planCode,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
        }),
      });
      const id = typeof data["id"] === "string" ? data["id"] : null;
      const url = typeof data["url"] === "string" ? data["url"] : null;
      if (!id || !url || !url.startsWith("https://checkout.stripe.com/")) throw new StripeRequestError(502);
      return { url, providerCheckoutId: id };
    },

    async createSubscriptionFromSetup({ checkoutSessionId, checkoutRef, priceId, customerId, trialEnd }) {
      // Re-busca a sessão na Stripe (estado autoritativo) — nunca confia no evento.
      const session = await call(`/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`);
      if (session["mode"] !== "setup" || session["status"] !== "complete") throw new StripeRequestError(409);
      if (idOf(session["customer"]) !== customerId) throw new StripeRequestError(409);
      const setupIntentId = str(session["setup_intent"]);
      if (!setupIntentId) throw new StripeRequestError(502);
      const si = await call(`/setup_intents/${encodeURIComponent(setupIntentId)}`);
      const paymentMethod = str(si["payment_method"]);
      if (!paymentMethod || si["status"] !== "succeeded") throw new StripeRequestError(502);
      const now = Math.floor(Date.now() / 1000);
      const body: Record<string, unknown> = {
        customer: customerId,
        items: [{ price: priceId }],
        default_payment_method: paymentMethod,
        metadata: { checkout_ref: checkoutRef },
      };
      // Trial interno preservado: só cobra imediatamente se o trial JÁ venceu.
      if (trialEnd && trialEnd > now) body["trial_end"] = trialEnd;
      const sub = await call("/subscriptions", {
        idempotencyKey: `agrointel-setup-sub-${checkoutRef}`,
        body,
      });
      const id = str(sub["id"]);
      if (!id) throw new StripeRequestError(502);
      return { providerSubscriptionId: id };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const configuration = await portalConfigurationId();
      const data = await call("/billing_portal/sessions", {
        body: { customer: customerId, return_url: returnUrl, configuration, locale: "pt-BR" },
      });
      if (typeof data["url"] !== "string") throw new StripeRequestError(502);
      return data["url"];
    },

    async setCancelAtPeriodEnd({ providerSubscriptionId, cancel }) {
      const data = await call(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
        body: { cancel_at_period_end: cancel ? "true" : "false" },
      });
      const snap = snapshot(data);
      if (!snap || snap.cancelAtPeriodEnd !== cancel) throw new StripeRequestError(502);
      return snap;
    },

    async cancelAllImmediately({ providerCustomerId }) {
      const list = await call(
        `/subscriptions?customer=${encodeURIComponent(providerCustomerId)}&status=all&limit=100`,
      );
      const subs = (list["data"] ?? []) as Record<string, unknown>[];
      for (const s of subs) {
        const st = String(s["status"] ?? "");
        if (st === "canceled" || st === "incomplete_expired") continue;
        const res = await call(`/subscriptions/${encodeURIComponent(String(s["id"]))}`, { method: "DELETE" });
        if (res["status"] !== "canceled") throw new StripeRequestError(502);
      }
      // Confirmação: nenhuma recorrência capaz de cobrar pode restar.
      const after = await call(
        `/subscriptions?customer=${encodeURIComponent(providerCustomerId)}&status=all&limit=100`,
      );
      const remaining = ((after["data"] ?? []) as Record<string, unknown>[]).filter(
        (s) => !["canceled", "incomplete_expired"].includes(String(s["status"])),
      );
      if (remaining.length > 0) throw new StripeRequestError(409);
    },

    async fetchSubscription(id) {
      return snapshot(await call(`/subscriptions/${encodeURIComponent(id)}`));
    },

    async verifyWebhook({ rawBody, headers }) {
      const valid = await verifyStripeSignature({
        rawBody,
        header: headers.get("stripe-signature"),
        secret: cfg.webhookSecret,
      });
      if (!valid) return { ok: false, reason: "invalid_signature" };
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const id = typeof event["id"] === "string" ? event["id"] : null;
      if (!id || !id.startsWith("evt_") || id.length > 200) return { ok: false, reason: "malformed" };
      const refs = extractEventRefs(event);
      if (refs.livemode) return { ok: false, reason: "live_mode" };
      return {
        ok: true,
        providerEventId: id,
        eventType: refs.type.slice(0, 64),
        checkoutSessionId: refs.checkoutSessionId,
        subscriptionId: refs.subscriptionId,
        customerId: refs.customerId,
      };
    },
  };
}
