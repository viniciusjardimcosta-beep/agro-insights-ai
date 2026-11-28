// Atividade por fazenda e filtro por fazenda. Funções puras (sem tela, sem servidor).
export const FARM_ACTIVITIES = ["plantio", "pecuaria", "ilp"] as const;
export type FarmActivity = (typeof FARM_ACTIVITIES)[number];
export const FARM_ACTIVITY_LABEL: Record<FarmActivity, string> = { plantio: "Plantio", pecuaria: "Pecuária", ilp: "Plantio e pecuária (ILP)" };
export const ALL_FARMS = "todas";

export type Flags = { lavoura: boolean; pecuaria: boolean };

export function isFarmActivity(v: unknown): v is FarmActivity {
  return v === "plantio" || v === "pecuaria" || v === "ilp";
}

/** O que a fazenda faz. Sem atividade definida (fazenda antiga), vale o que a conta tem ligado. */
export function farmFlags(activity: unknown, account: Flags): Flags {
  if (!isFarmActivity(activity)) return account;
  return { lavoura: activity !== "pecuaria", pecuaria: activity !== "plantio" };
}

/** Atividade da conta a partir das fazendas: usada para manter o menu coerente ao criar fazenda de outro tipo. */
export function accountFlagsFor(activity: FarmActivity, account: Flags): Flags {
  const f = farmFlags(activity, account);
  return { lavoura: account.lavoura || f.lavoura, pecuaria: account.pecuaria || f.pecuaria };
}

/** Fazenda escolhida no seletor; se ela não existe mais, volta para "todas". */
export function resolveSelected<T extends { id: string }>(farms: T[], selectedId: string): T | null {
  if (selectedId === ALL_FARMS) return null;
  return farms.find((f) => f.id === selectedId) ?? null;
}

/** Lote da fazenda escolhida. Em "todas" entram todos (inclusive os sem fazenda). */
export function inFarm(propertyId: string | null | undefined, selectedId: string | null): boolean {
  return selectedId === null || propertyId === selectedId;
}

/**
 * Pecuária de uma fazenda só: os lotes dela e o que é dos lotes dela (custos, vendas, baixas).
 * Custos gerais (sem lote) não pertencem a uma fazenda ainda: aparecem só em "todas".
 */
export function cattleOfFarm<L extends { id: string; property_id?: string | null }, C extends { lot_id: string | null }, S extends { lot_id: string }, X extends { lot_id: string }>(
  data: { lots: L[]; costs: C[]; sales: S[]; losses: X[] },
  farmId: string | null,
) {
  if (farmId === null) return data;
  const lots = data.lots.filter((l) => l.property_id === farmId);
  const ids = new Set(lots.map((l) => l.id));
  return {
    lots,
    costs: data.costs.filter((c) => c.lot_id !== null && ids.has(c.lot_id)),
    sales: data.sales.filter((s) => ids.has(s.lot_id)),
    losses: data.losses.filter((x) => ids.has(x.lot_id)),
  };
}

/**
 * Recorta o retrato da fazenda para a fazenda escolhida: só os talhões dela, os custos desses talhões e ela mesma.
 * Sem fazenda escolhida (null), devolve tudo como veio. Os preços valem para a conta toda.
 */
export function snapshotOfFarm<
  P extends { id?: string },
  F extends { id: string; property_id?: string | null },
  C extends { field_id: string },
  S extends { properties?: P[] | null; fields?: F[] | null; costs?: C[] | null },
>(snapshot: S, selectedId: string | null): S {
  if (selectedId === null) return snapshot;
  const fields = (snapshot.fields ?? []).filter((f) => f.property_id === selectedId);
  const ids = new Set(fields.map((f) => f.id));
  return {
    ...snapshot,
    properties: (snapshot.properties ?? []).filter((p) => p.id === selectedId),
    fields,
    costs: (snapshot.costs ?? []).filter((c) => ids.has(c.field_id)),
  };
}

/** Fazendas em que a soma das áreas dos talhões passa da área cadastrada da fazenda. */
export function areaOverruns<P extends { id: string; name: string; total_area?: number | string | null }, F extends { property_id?: string | null; area?: number | string | null }>(
  props: P[],
  fields: F[],
): { id: string; name: string; total: number; sum: number }[] {
  const out: { id: string; name: string; total: number; sum: number }[] = [];
  for (const p of props) {
    const total = Number(p.total_area ?? 0);
    if (!(total > 0)) continue;
    const sum = Math.round(fields.filter((f) => f.property_id === p.id).reduce((a, f) => a + Number(f.area ?? 0), 0) * 100) / 100;
    if (sum > total) out.push({ id: p.id, name: p.name, total, sum });
  }
  return out;
}

export function areaOverrunText(o: { name: string; total: number; sum: number }, showName: boolean): string {
  const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${showName ? `${o.name}: o` : "O"}s talhões somam ${n(o.sum)} ha e a fazenda tem ${n(o.total)} ha. Confira a área da fazenda ou a dos talhões.`;
}
