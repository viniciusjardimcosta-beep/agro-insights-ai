/**
 * Rateio de um custo da fazenda entre talhões, proporcional à área (ha).
 * Função pura. Trabalha em centavos e usa o método do maior resto, então a
 * soma das partes é SEMPRE igual ao total (sem sobra nem falta de centavos).
 */
export type SplitField = { id: string; area: number };
export type SplitShare = { field_id: string; amount: number };

export function splitByArea(totalAmount: number, fields: SplitField[]): SplitShare[] {
  const valid = fields.filter((f) => Number.isFinite(Number(f.area)) && Number(f.area) > 0);
  const totalArea = valid.reduce((s, f) => s + Number(f.area), 0);
  const totalCents = Math.round(Number(totalAmount) * 100);
  if (valid.length === 0 || totalArea <= 0 || !Number.isFinite(totalCents) || totalCents <= 0) return [];

  const raw = valid.map((f) => (totalCents * Number(f.area)) / totalArea);
  const cents = raw.map((r) => Math.floor(r));
  let remainder = totalCents - cents.reduce((s, c) => s + c, 0);

  // Os centavos que sobraram vão para quem tem a maior parte fracionária (desempate: ordem da lista).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    cents[i] += 1;
    remainder -= 1;
  }

  return valid
    .map((f, i) => ({ field_id: f.id, amount: cents[i] / 100 }))
    .filter((s) => s.amount > 0);
}
