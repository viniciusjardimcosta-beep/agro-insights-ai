// Registro do provedor de pagamentos — server-only.
//
// Fail-closed: sem BILLING_PROVIDER=stripe, STRIPE_ENVIRONMENT=test, chave sk_test_
// e STRIPE_WEBHOOK_SECRET, NENHUMA cobrança é iniciada (BILLING_NOT_CONFIGURED).
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { BillingProvider } from "./types";
import { createStripeProvider, readStripeConfig } from "./providers/stripe.server";

export const BILLING_PROVIDER_ENV = "BILLING_PROVIDER";

export function resolveProvider(env: Record<string, string | undefined> = process.env): BillingProvider | null {
  const name = (env[BILLING_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (name !== "stripe") return null;
  const cfg = readStripeConfig(env);
  return cfg ? createStripeProvider(cfg) : null;
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
