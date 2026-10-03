// Registro do provedor de pagamentos — server-only.
//
// Fail-closed: sem BILLING_PROVIDER=asaas, ASAAS_ENVIRONMENT=sandbox e os
// secrets do Asaas, NENHUMA cobrança é iniciada (BILLING_NOT_CONFIGURED).
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { BillingProvider } from "./types";
import { createAsaasProvider, readAsaasConfig } from "./providers/asaas.server";

export const BILLING_PROVIDER_ENV = "BILLING_PROVIDER";

export function resolveProvider(env: Record<string, string | undefined> = process.env): BillingProvider | null {
  const name = (env[BILLING_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (name !== "asaas") return null;
  const cfg = readAsaasConfig(env);
  return cfg ? createAsaasProvider(cfg) : null;
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
