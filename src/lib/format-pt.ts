/**
 * Troca o ponto decimal por vírgula em percentuais de textos já prontos
 * (ex.: "Margem líquida 53.2% (acima de 50%)" → "Margem líquida 53,2% (...)").
 * Aplicado só na exibição, para que diagnósticos antigos (guardados com ponto)
 * e novos apareçam do mesmo jeito. Não mexe em valores em R$ nem em outros números.
 */
export function ptPercentDecimals(text: string): string {
  return text.replace(/(\d)\.(\d+)(?=\s?%)/g, "$1,$2");
}

/**
 * Data no padrão brasileiro. Recebe "AAAA-MM-DD" (ou um ISO com hora) e devolve "DD/MM/AAAA".
 * Trabalha só com o texto, sem criar Date, para não deslocar o dia por fuso horário.
 * Se o texto não for uma data no formato esperado, devolve o original.
 */
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Número com 1 casa decimal e vírgula (ex.: 98,6). */
export function pt1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

/** Rótulo de eixo em reais, curto e sem repetição: R$ 500, R$ 1 mil, R$ 2,5 mil, −R$ 3 mil, R$ 1,2 mi. */
export function axisBRL(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const nf = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `${sign}R$ ${nf(abs / 1_000_000)} mi`;
  if (abs >= 1000) return `${sign}R$ ${nf(abs / 1000)} mil`;
  return `${sign}R$ ${Math.round(abs).toLocaleString("pt-BR")}`;
}
