// Catálogo central de planos — o servidor é a única autoridade de preço.
// Valores aprovados comercialmente (Sprint 3.4B — Asaas).
import type { PlanVariant } from "./types";

export const PLAN_CATALOG: readonly PlanVariant[] = [
  {
    planCode: "pro_monthly",
    interval: "month",
    label: "AgroIntel Pro Mensal",
    amountCents: 9990,
    currency: "BRL",
    requiresFounderEligibility: false,
    available: true,
  },
  {
    planCode: "pro_yearly",
    interval: "year",
    label: "AgroIntel Pro Anual",
    amountCents: 99900,
    currency: "BRL",
    requiresFounderEligibility: false,
    available: true,
  },
  {
    planCode: "pro_founder_monthly",
    interval: "month",
    label: "AgroIntel Pro Fundador",
    amountCents: 6990,
    currency: "BRL",
    requiresFounderEligibility: true,
    available: true,
  },
];

export const PAID_PLAN_CODES = PLAN_CATALOG.map((p) => p.planCode);

/** Resolve pelo plan_code. Qualquer outra string (price id, valor, etc.) → null. */
export function findPlanVariant(planCode: string): PlanVariant | null {
  return PLAN_CATALOG.find((v) => v.planCode === planCode) ?? null;
}

export function availablePlanVariants(): readonly PlanVariant[] {
  return PLAN_CATALOG.filter((v) => v.available);
}

/** Economia do anual versus 12 mensalidades, em centavos (exato, sem arredondar %). */
export function annualSavingsCents(): number {
  const monthly = findPlanVariant("pro_monthly")!.amountCents;
  const yearly = findPlanVariant("pro_yearly")!.amountCents;
  return monthly * 12 - yearly;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Soma o ciclo do plano a uma data ISO (fim do período coberto). */
export function addInterval(isoStart: string, interval: "month" | "year"): string {
  const d = new Date(isoStart);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/**
 * Elegibilidade ao Plano Fundador: concedida apenas pelo servidor/admin e
 * consumida na primeira ativação. Nova assinatura após encerramento não recebe
 * o preço fundador de novo.
 */
export function isFounderEligible(
  row: { founder_eligible: boolean; consumed_at: string | null } | null,
): boolean {
  return !!row && row.founder_eligible === true && row.consumed_at === null;
}
