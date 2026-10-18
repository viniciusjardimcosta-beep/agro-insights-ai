// Adapter Stripe — server-only. Único módulo que fala com a API do Stripe.
//
// FAIL-CLOSED: sem STRIPE_ENVIRONMENT (test|live), chave secreta compatível com o
// ambiente e segredo de webhook, nenhuma cobrança é iniciada (ver readStripeConfig).
// Sem SDK: chamadas REST com fetch e assinatura de webhook por Web Crypto, que funcionam
// no runtime Cloudflare Workers usado pelo app.
import type { BillingProvider } from "../types";
import {
  STRIPE_API_BASE_URL,
  buildCheckoutParams,
  normalizeStripeEvent,
  verifyStripeSignature,
  type StripeConfig,
} from "./stripe";

export { readStripeConfig, STRIPE_ENV_NAMES } from "./stripe";

class StripeRequestError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number) {
    super(`stripe_http_${httpStatus}`);
    this.httpStatus = httpStatus;
  }
}

type Obj = Record<string, unknown>;

export function createStripeProvider(cfg: StripeConfig): BillingProvider {
  const call = async (
    path: string,
    init: { method?: "GET" | "POST" | "DELETE"; params?: [string, string][]; idempotencyKey?: string } = {},
  ): Promise<Obj> => {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${cfg.secretKey}`,
      "user-agent": "AgroIntel",
    };
    let body: string | undefined;
    if (init.params) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.params).toString();
    }
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    const res = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Corpo do erro nunca é repassado ao usuário nem logado por inteiro.
      throw new StripeRequestError(res.status);
    }
    return (await res.json()) as Obj;
  };

  return {
    id: "stripe",
    // Portal do cliente (trocar cartão/faturas) ainda não integrado — ver docs/BILLING.md.
    hasCustomerPortal: false,

    async createCheckoutSession(args) {
      const data = await call("/checkout/sessions", {
        method: "POST",
        params: buildCheckoutParams(
          {
            variant: args.variant,
            externalReference: args.externalReference,
            trialEndsAt: args.trialEndsAt,
            successUrl: args.successUrl,
            cancelUrl: args.cancelUrl,
            minutesToExpire: args.minutesToExpire,
          },
          Date.now(),
        ),
        // Reenvio da mesma tentativa nunca cria uma segunda sessão.
        idempotencyKey: `agrointel_checkout_${args.externalReference}`,
      });
      const id = typeof data["id"] === "string" ? data["id"] : null;
      const url = typeof data["url"] === "string" ? data["url"] : null;
      if (!id || !url) throw new StripeRequestError(502);
      return { url, providerCheckoutId: id };
    },

    async cancelSubscription({ providerSubscriptionId }) {
      try {
        const data = await call(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: "DELETE" });
        if (data["status"] !== "canceled") throw new StripeRequestError(502);
      } catch (err) {
        // 404: a assinatura já não existe no Stripe — o objetivo (nenhuma cobrança futura) está cumprido.
        if (err instanceof StripeRequestError && err.httpStatus === 404) return;
        throw err;
      }
    },

    async findActiveSubscriptionId({ providerCustomerId }) {
      // Sem filtro de status o Stripe devolve as não canceladas (inclui trialing).
      const data = await call(`/subscriptions?customer=${encodeURIComponent(providerCustomerId)}&limit=10`);
      const list = Array.isArray(data["data"]) ? (data["data"] as Obj[]) : [];
      const live = list.find(
        (s) => typeof s["id"] === "string" && ["trialing", "active", "past_due"].includes(String(s["status"])),
      );
      return live ? String(live["id"]) : null;
    },

    async verifyWebhook({ rawBody, headers }) {
      const valid = await verifyStripeSignature({
        rawBody,
        header: headers.get("stripe-signature"),
        secret: cfg.webhookSecret,
        nowMs: Date.now(),
      });
      if (!valid) return { ok: false, reason: "invalid_signature" };
      let payload: Obj;
      try {
        payload = JSON.parse(rawBody) as Obj;
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const id = typeof payload["id"] === "string" ? payload["id"] : null;
      const eventType = typeof payload["type"] === "string" ? payload["type"] : null;
      if (!id || !eventType || id.length > 200) return { ok: false, reason: "malformed" };
      return { ok: true, providerEventId: id, eventType: eventType.slice(0, 64), event: normalizeStripeEvent(payload) };
    },
  };
}
