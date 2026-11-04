export type FieldRow = {
  id: string;
  name: string;
  area: number;
  crop: string;
  estimated_yield: number | null;
  real_yield: number | null;
};

export type CostRow = {
  field_id: string;
  category: string;
  amount: number;
};

export type PriceRow = {
  crop: string;
  price_per_bag: number;
  date: string;
  created_at?: string | null;
};

export function latestPriceByCrop(prices: PriceRow[]): Record<string, number> {
  // Mais recente primeiro. Empate de data: o registro criado por último vence
  // (resultado determinístico, independente da ordem em que o banco devolve).
  const sorted = [...prices].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    return 0;
  });
  const out: Record<string, number> = {};
  for (const p of sorted) if (!(p.crop in out)) out[p.crop] = Number(p.price_per_bag);
  return out;
}

/** Culturas com talhão cadastrado mas sem nenhum preço (receita fica R$ 0). */
export function cropsMissingPrice(
  fields: Pick<FieldRow, "crop">[],
  priceByCrop: Record<string, number>,
): string[] {
  return [...new Set(fields.map((f) => f.crop))].filter((c) => !(c in priceByCrop));
}

export function fieldMetrics(
  field: FieldRow,
  costs: CostRow[],
  priceByCrop: Record<string, number>,
) {
  const area = Number(field.area || 0);
  const yieldBag = Number(field.real_yield ?? field.estimated_yield ?? 0);
  const price = priceByCrop[field.crop] ?? 0;
  const totalCost = costs
    .filter((c) => c.field_id === field.id)
    .reduce((s, c) => s + Number(c.amount || 0), 0);
  const revenue = area * yieldBag * price;
  const profit = revenue - totalCost;
  const costPerHa = area > 0 ? totalCost / area : 0;
  const profitPerHa = area > 0 ? profit / area : 0;
  const breakevenBagPerHa = price > 0 ? costPerHa / price : 0;
  return { area, yieldBag, price, totalCost, revenue, profit, costPerHa, profitPerHa, breakevenBagPerHa };
}

/**
 * Custo médio por hectare da fazenda, PONDERADO PELA ÁREA:
 * soma dos custos ÷ soma das áreas (só talhões com área > 0).
 * Usado como referência no alerta e na nota ("custo/ha acima da média").
 * A média simples dos talhões trata um talhão pequeno igual a um grande.
 */
export function weightedCostPerHa(
  perField: { area: number; totalCost: number }[],
): number {
  const withArea = perField.filter((f) => f.area > 0);
  const area = withArea.reduce((s, f) => s + f.area, 0);
  if (area <= 0) return 0;
  return withArea.reduce((s, f) => s + f.totalCost, 0) / area;
}

export function aggregateFarm(
  fields: FieldRow[],
  costs: CostRow[],
  prices: PriceRow[],
) {
  const priceByCrop = latestPriceByCrop(prices);
  const perField = fields.map((f) => ({ field: f, ...fieldMetrics(f, costs, priceByCrop) }));
  const totalArea = perField.reduce((s, x) => s + x.area, 0);
  const totalCost = perField.reduce((s, x) => s + x.totalCost, 0);
  const totalRevenue = perField.reduce((s, x) => s + x.revenue, 0);
  const totalProfit = totalRevenue - totalCost;
  return {
    totalArea,
    totalCost,
    totalRevenue,
    totalProfit,
    costPerHa: totalArea > 0 ? totalCost / totalArea : 0,
    profitPerHa: totalArea > 0 ? totalProfit / totalArea : 0,
    perField,
    priceByCrop,
  };
}

export const CROPS = ["soja", "milho", "trigo", "arroz", "outra"] as const;
export const COST_CATEGORIES = [
  "Sementes",
  "Fertilizantes",
  "Defensivos",
  "Diesel",
  "Arrendamento",
  "Mão de obra",
  "Máquinas",
  "Outros",
] as const;

export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });