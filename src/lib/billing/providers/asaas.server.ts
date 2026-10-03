// Adapter Asaas — server-only. Único módulo que fala com a API do Asaas.
//
// FAIL-CLOSED: nesta fase só opera com ASAAS_ENVIRONMENT=sandbox e sempre
// contra a URL de sandbox. Não existe URL de produção neste código.
import type { BillingProvider } from "../types";
import {
  ASAAS_SANDBOX_BASE_URL,
  buildCheckoutBody,
  normalizeAsaasEvent,
  tokensMatch,
} from "./asaas";

export const ASAAS_ENV_NAMES = {
  environment: "ASAAS_ENVIRONMENT",
  apiKey: "ASAAS_API_KEY",
  webhookToken: "ASAAS_WEBHOOK_TOKEN",
} as const;

export type AsaasConfig = { apiKey: string; webhookToken: string };

/** Lê a configuração; retorna null (fail-closed) se não for sandbox ou faltar secret. */
export function readAsaasConfig(env: Record<string, string | undefined> = process.env): AsaasConfig | null {
  if ((env[ASAAS_ENV_NAMES.environment] ?? "").trim().toLowerCase() !== "sandbox") return null;
  const apiKey = (env[ASAAS_ENV_NAMES.apiKey] ?? "").trim();
  const webhookToken = (env[ASAAS_ENV_NAMES.webhookToken] ?? "").trim();
  if (!apiKey || !webhookToken) return null;
  return { apiKey, webhookToken };
}

class AsaasRequestError extends Error {
  constructor(readonly httpStatus: number) {
    super(`asaas_http_${httpStatus}`);
  }
}

export function createAsaasProvider(cfg: AsaasConfig): BillingProvider {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${ASAAS_SANDBOX_BASE_URL}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "User-Agent": "AgroIntel",
        access_token: cfg.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Corpo do erro nunca é repassado ao usuário nem logado por inteiro.
      throw new AsaasRequestError(res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  };

  return {
    id: "asaas",
    hasCustomerPortal: false,

    async createCheckoutSession(args) {
      const data = await call("/checkouts", { method: "POST", body: JSON.stringify(buildCheckoutBody(args)) });
      const id = typeof data["id"] === "string" ? data["id"] : null;
      const link = typeof data["link"] === "string" ? data["link"] : null;
      if (!id || !link) throw new AsaasRequestError(502);
      return { url: link, providerCheckoutId: id };
    },

    async cancelSubscription({ providerSubscriptionId }) {
      const data = await call(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: "DELETE" });
      if (data["deleted"] !== true) throw new AsaasRequestError(502);
    },

    async findActiveSubscriptionId({ providerCustomerId }) {
      const data = await call(
        `/subscriptions?customer=${encodeURIComponent(providerCustomerId)}&status=ACTIVE&limit=10`,
      );
      const list = Array.isArray(data["data"]) ? (data["data"] as Record<string, unknown>[]) : [];
      const first = list.find((s) => typeof s["id"] === "string");
      return first ? String(first["id"]) : null;
    },

    async verifyWebhook({ rawBody, headers }) {
      if (!tokensMatch(headers.get("asaas-access-token"), cfg.webhookToken)) {
        return { ok: false, reason: "invalid_signature" };
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const id = typeof payload["id"] === "string" ? payload["id"] : null;
      const eventType = typeof payload["event"] === "string" ? payload["event"] : null;
      if (!id || !eventType || id.length > 200) return { ok: false, reason: "malformed" };
      return { ok: true, providerEventId: id, eventType: eventType.slice(0, 64), event: normalizeAsaasEvent(payload) };
    },
  };
}
