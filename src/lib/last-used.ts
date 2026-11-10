/** Guarda no aparelho o último talhão e a última categoria usados, para o próximo lançamento já vir preenchido. */
const KEY_TARGET = "agrointel:last-target";
const KEY_CATEGORY = "agrointel:last-category";

function read(key: string): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch { /* sem armazenamento: segue sem lembrar */ }
}

/** Devolve o último destino só se ele ainda existir ("all" ou um talhão atual). */
export function lastTarget(validFieldIds: string[]): string | null {
  const v = read(KEY_TARGET);
  return v && (v === "all" || validFieldIds.includes(v)) ? v : null;
}
export function lastCategory(validCategories: readonly string[]): string | null {
  const v = read(KEY_CATEGORY);
  return v && validCategories.includes(v) ? v : null;
}
export function rememberLast(target: string, category: string) {
  if (target === "all" || /^[0-9a-f-]{36}$/i.test(target)) write(KEY_TARGET, target);
  if (category) write(KEY_CATEGORY, category);
}
