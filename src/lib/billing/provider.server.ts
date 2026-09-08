// Registro do provedor de pagamentos — server-only.
//
// ESTADO ATUAL: nenhum gateway foi escolhido pelo produto, portanto nenhum
// adapter está registrado e toda operação de cobrança falha com
// BILLING_NOT_CONFIGURED. NÃO existe mock, checkout falso ou webhook falso.
//
// Para ligar um provedor no futuro:
// 1. criar `src/lib/billing/providers/<nome>.server.ts` implementando
//    `BillingProvider` (único lugar que conhece o SDK/API externo);
// 2. registrar o adapter em `resolveProvider()`;
// 3. cadastrar os secrets server-side (ver docs/BILLING.md).
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { BillingProvider } from "./types";

/** Nome (não valor) do secret que indica qual provedor está ativo. */
export const BILLING_PROVIDER_ENV = "BILLING_PROVIDER";

export function billingProviderName(): string | null {
  const v = process.env[BILLING_PROVIDER_ENV];
  return v && v.trim().length > 0 ? v.trim().toLowerCase() : null;
}

export function isBillingConfigured(): boolean {
  return resolveProvider() !== null;
}

/** Retorna o adapter ativo — hoje sempre `null` (nenhum gateway definido). */
export function resolveProvider(): BillingProvider | null {
  // Nenhum adapter registrado. Ver docs/BILLING.md.
  return null;
}

/** Uso obrigatório antes de qualquer operação financeira. */
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
