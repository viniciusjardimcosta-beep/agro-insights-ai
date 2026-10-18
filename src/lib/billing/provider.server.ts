// Registro do provedor de pagamentos — server-only.
//
// Fail-closed: sem BILLING_PROVIDER válido (asaas | stripe) e a configuração
// completa do respectivo provedor, NENHUMA cobrança é iniciada (BILLING_NOT_CONFIGURED).
//   - asaas:  ASAAS_ENVIRONMENT=sandbox + ASAAS_API_KEY + ASAAS_WEBHOOK_TOKEN
//   - stripe: STRIPE_ENVIRONMENT=test|live + STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { BillingProvider } from "./types";
import { createAsaasProvider, readAsaasConfig } from "./providers/asaas.server";
import { createStripeProvider, readStripeConfig } from "./providers/stripe.server";

export const BILLING_PROVIDER_ENV = "BILLING_PROVIDER";

export function resolveProvider(env: Record<string, string | undefined> = process.env): BillingProvider | null {
  const name = (env[BILLING_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (name === "asaas") {
    const cfg = readAsaasConfig(env);
    return cfg ? createAsaasProvider(cfg) : null;
  }
  if (name === "stripe") {
    const cfg = readStripeConfig(env);
    return cfg ? createStripeProvider(cfg) : null;
  }
  return null;
}

export function isBillingConfigured(): boolean {
  return resolveProvider() !== null;
}

export function requireProvider(): BillingProvider {
  const provider = resolveProvider();
  if (!provider) {
    throw new AppError({
      code: ERROR_CODES.BILLING_NOT_CONFIGURED,
      status: 503,
      userMessage:
        "Os planos ainda não estão disponíveis para contratação. Você continua com acesso normal enquanto isso.",
    });
  }
  return provider;
}
