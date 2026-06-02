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
};

export function latestPriceByCrop(prices: PriceRow[]): Record<string, number> {
  const sorted = [...prices].sort((a, b) => (a.date < b.date ? 1 : -1));
  const out: Record<string, number> = {};
  for (const p of sorted) if (!(p.crop in out)) out[p.crop] = Number(p.price_per_bag);
  return out;
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