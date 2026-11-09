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
