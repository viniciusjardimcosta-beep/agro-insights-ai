/**
 * Interpreta uma frase falada (ou digitada) de custo, ex.: "diesel 450 reais talhão 1 ontem".
 * Tudo por regras, sem IA e sem rede: o resultado é só uma SUGESTÃO que o usuário confere antes de salvar.
 */
import { norm, normalizeCategory, COST_CATEGORY_NAMES } from "@/lib/cost-import";

export type SpokenField = { id: string; name: string };

export type SpokenCost = {
  amount: number | null;
  date: string; // AAAA-MM-DD
  category: string;
  /** id do talhão, "all" ou null quando não foi dito */
  target: string | null;
  description: string;
  issues: string[];
};

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};
const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600,
  setecentos: 700, oitocentos: 800, novecentos: 900,
};

/** Converte "mil e quinhentos", "quatrocentos e cinquenta", "dois mil" em número. Devolve null se não houver número por extenso. */
export function wordsToNumber(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (t === "e") continue;
    if (t in UNITS) { current += UNITS[t]; seen = true; }
    else if (t in TENS) { current += TENS[t]; seen = true; }
    else if (t in HUNDREDS) { current += HUNDREDS[t]; seen = true; }
    else if (t === "mil") { total += (current === 0 ? 1 : current) * 1000; current = 0; seen = true; }
    else return seen ? total + current : null;
  }
  return seen ? total + current : null;
}

const NUMBER_WORDS = new Set(["e", "mil", ...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(HUNDREDS)]);

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function validDate(y: number, m: number, d: number): boolean {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** Procura data na frase; devolve a data e o texto sem o trecho da data. */
function extractDate(text: string, today: Date): { iso: string; rest: string; found: boolean; invalid?: boolean } {
  let t = text;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => Date | null) => {
    const m = re.exec(t);
    if (!m) return null;
    const d = fn(m);
    t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ");
    return d ?? "invalid";
  };

  const r1 = take(/\banteontem\b/, () => addDays(today, -2));
  if (r1 && r1 !== "invalid") return { iso: isoOf(r1), rest: t, found: true };
  const r2 = take(/\bontem\b/, () => addDays(today, -1));
  if (r2 && r2 !== "invalid") return { iso: isoOf(r2), rest: t, found: true };
  const r3 = take(/\bhoje\b/, () => today);
  if (r3 && r3 !== "invalid") return { iso: isoOf(r3), rest: t, found: true };

  // 05/10, 5/10/2026, 5-10
  const r4 = take(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
    const d = Number(m[1]); const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : today.getFullYear();
    if (y < 100) y += 2000;
    return validDate(y, mo, d) ? new Date(y, mo - 1, d) : null;
  });
  if (r4) return r4 === "invalid" ? { iso: isoOf(today), rest: t, found: true, invalid: true } : { iso: isoOf(r4), rest: t, found: true };

  // "dia 5 de outubro" / "5 de outubro" / "dia 5"
  const monthRe = MONTHS.join("|");
  const r5 = take(new RegExp(`\\b(?:dia )?(\\d{1,2}) de (${monthRe})(?: de (\\d{4}))?\\b`), (m) => {
    const d = Number(m[1]); const mo = MONTHS.indexOf(m[2]) + 1;
    const y = m[3] ? Number(m[3]) : today.getFullYear();
    return validDate(y, mo, d) ? new Date(y, mo - 1, d) : null;
  });
  if (r5) return r5 === "invalid" ? { iso: isoOf(today), rest: t, found: true, invalid: true } : { iso: isoOf(r5), rest: t, found: true };

  const r6 = take(/\bdia (\d{1,2})\b/, (m) => {
    const d = Number(m[1]);
    // dia ainda no futuro neste mês: assume mês anterior (lançamento é sempre do passado)
    let y = today.getFullYear(); let mo = today.getMonth() + 1;
    if (d > today.getDate()) { mo -= 1; if (mo === 0) { mo = 12; y -= 1; } }
    return validDate(y, mo, d) ? new Date(y, mo - 1, d) : null;
  });
  if (r6) return r6 === "invalid" ? { iso: isoOf(today), rest: t, found: true, invalid: true } : { iso: isoOf(r6), rest: t, found: true };

  return { iso: isoOf(today), rest: t, found: false };
}

/** Procura o valor; devolve o número e o texto sem o trecho. */
function extractAmount(text: string): { amount: number | null; rest: string } {
  let t = text;
  // "1,5 mil" / "2 mil"
  let m = /(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*mil\b(?:\s*reais)?/.exec(t);
  if (m) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n)) return { amount: Math.round(n * 1000 * 100) / 100, rest: (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ") };
  }
  // 1.234,56 | 450 | 450,50 | 450.5  (com ou sem R$ / reais)
  m = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|real|conto|contos))?/.exec(t);
  if (m) {
    const raw = m[1];
    const n = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(raw) ? Number(raw.replace(/\./g, "")) : Number(raw);
    if (Number.isFinite(n)) return { amount: n, rest: (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ") };
  }
  // por extenso: "quatrocentos e cinquenta reais"
  const tokens = t.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    if (!NUMBER_WORDS.has(tokens[i]) || tokens[i] === "e") continue;
    let j = i;
    while (j < tokens.length && NUMBER_WORDS.has(tokens[j])) j++;
    const slice = tokens.slice(i, j);
    while (slice[slice.length - 1] === "e") { slice.pop(); j--; }
    const n = wordsToNumber(slice);
    if (n !== null && n > 0) {
      let end = j;
      if (/^(reais|real|conto|contos)$/.test(tokens[end] ?? "")) end++;
      return { amount: n, rest: [...tokens.slice(0, i), ...tokens.slice(end)].join(" ") };
    }
  }
  return { amount: null, rest: t };
}

export function parseSpokenCost(input: string, fields: SpokenField[], now: Date = new Date()): SpokenCost {
  const issues: string[] = [];
  let t = ` ${norm(input).replace(/[,;]+(?=\s|$)/g, " ").replace(/\bpor cento\b/g, "%")} `.replace(/\s+/g, " ").trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Talhão: nome exato (maior primeiro) ou "talhão N", ou "todos".
  let target: string | null = null;
  const sorted = [...fields].sort((a, b) => b.name.length - a.name.length);
  for (const f of sorted) {
    const n = norm(f.name);
    if (n && new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(t)) {
      target = f.id;
      t = t.replace(n, " ").replace(/\s+/g, " ");
      break;
    }
  }
  if (target === null) {
    // O reconhecimento de voz erra a palavra ("talião", "tarhão"...), então aceitamos variações.
    const m = /\b(?:ta[lr][hi]a?o(?:es|s)?|talhado|talhau|tailao|gleba|lote) (\w+)/.exec(t);
    if (m) {
      const num = m[1] in UNITS ? String(UNITS[m[1]]) : m[1];
      const hit = fields.find((f) => norm(f.name).split(" ").pop() === num);
      if (hit) { target = hit.id; t = t.replace(m[0], " ").replace(/\s+/g, " "); }
      else { issues.push(`Não achei o talhão "${m[1]}"`); t = t.replace(m[0], " ").replace(/\s+/g, " "); }
    }
  }
  if (target === null && /\b(todos os talhoes|todos talhoes|fazenda toda|fazenda inteira|todos|geral)\b/.test(t)) {
    target = "all";
    t = t.replace(/\b(todos os talhoes|todos talhoes|fazenda toda|fazenda inteira|todos|geral)\b/, " ").replace(/\s+/g, " ");
  }

  const dt = extractDate(t, today);
  if (dt.invalid) issues.push("Data não reconhecida, usei hoje");
  const am = extractAmount(dt.rest);
  if (am.amount === null) issues.push("Não entendi o valor");
  else if (am.amount <= 0) issues.push("Valor zero");

  const cat = normalizeCategory(input);
  if (!cat.confident) issues.push("Categoria não reconhecida");

  // Descrição: a própria frase (com acentos), para o usuário poder ajustar.
  const raw = input.trim().replace(/\s+/g, " ");
  const description = raw.charAt(0).toUpperCase() + raw.slice(1);

  return {
    amount: am.amount,
    date: dt.iso,
    category: COST_CATEGORY_NAMES.includes(cat.category as (typeof COST_CATEGORY_NAMES)[number]) ? cat.category : "Outros",
    target,
    description,
    issues,
  };
}
