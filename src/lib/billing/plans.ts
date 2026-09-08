// Catálogo central de planos — server-side é a única autoridade.
//
// NENHUM preço foi inventado. Enquanto os valores comerciais não forem
// aprovados, as variantes ficam indisponíveis e sem `providerPriceId`.
import { PLAN_CODES } from "@/lib/entitlements";
import type { PlanVariant } from "./types";

export const PLAN_CATALOG: readonly PlanVariant[] = [
  {
    key: "pro_monthly",
    planCode: PLAN_CODES.PRO,
    interval: "month",
    label: "Pro mensal",
    amountCents: null,
    currency: "BRL",
    providerPriceId: null,
    available: false,
  },
  {
    key: "pro_yearly",
    planCode: PLAN_CODES.PRO,
    interval: "year",
    label: "Pro anual",
    amountCents: null,
    currency: "BRL",
    providerPriceId: null,
    available: false,
  },
];

/** Resolve a variante pelo `key` interno. Price ID arbitrário do cliente é ignorado. */
export function findPlanVariant(key: string): PlanVariant | null {
  return PLAN_CATALOG.find((v) => v.key === key) ?? null;
}

/** Variantes que podem ir a checkout hoje (vazio até o gateway/preços existirem). */
export function availablePlanVariants(): readonly PlanVariant[] {
  return PLAN_CATALOG.filter((v) => v.available && v.providerPriceId !== null);
}
