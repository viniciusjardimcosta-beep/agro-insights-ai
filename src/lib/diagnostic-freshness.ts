/**
 * Detecta diagnóstico desatualizado: o diagnóstico guarda a receita e os custos
 * usados no momento em que foi gerado (`report.finance`). Se os dados atuais
 * da fazenda divergem desses valores, o diagnóstico foi gerado com dados antigos.
 * Função pura — sem rede, sem banco.
 */
export type SavedFinance = { revenue?: unknown; costs?: unknown } | null | undefined;
export type LiveTotals = { totalRevenue: number; totalCost: number };

export type FreshnessChange = { label: string; saved: number; live: number };
export type Freshness = { stale: boolean; changes: FreshnessChange[] };

// Tolerância de R$ 1,00: absorve arredondamentos de centavos sem mascarar mudanças reais.
const TOLERANCE = 1;

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function diagnosticFreshness(saved: SavedFinance, live: LiveTotals): Freshness {
  const changes: FreshnessChange[] = [];
  const savedRevenue = toNum(saved?.revenue);
  const savedCosts = toNum(saved?.costs);
  // Sem valores guardados (diagnóstico muito antigo): não dá para afirmar nada, não alarma.
  if (savedRevenue !== null && Math.abs(savedRevenue - live.totalRevenue) > TOLERANCE) {
    changes.push({ label: "Receita", saved: savedRevenue, live: live.totalRevenue });
  }
  if (savedCosts !== null && Math.abs(savedCosts - live.totalCost) > TOLERANCE) {
    changes.push({ label: "Custos", saved: savedCosts, live: live.totalCost });
  }
  return { stale: changes.length > 0, changes };
}
