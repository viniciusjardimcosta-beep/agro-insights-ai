/**
 * Troca o ponto decimal por vírgula em percentuais de textos já prontos
 * (ex.: "Margem líquida 53.2% (acima de 50%)" → "Margem líquida 53,2% (...)").
 * Aplicado só na exibição, para que diagnósticos antigos (guardados com ponto)
 * e novos apareçam do mesmo jeito. Não mexe em valores em R$ nem em outros números.
 */
export function ptPercentDecimals(text: string): string {
  return text.replace(/(\d)\.(\d+)(?=\s?%)/g, "$1,$2");
}
