/**
 * Importação de custos a partir de planilha (CSV ou Excel).
 * Tudo aqui é função pura: nada de rede, banco ou navegador. A tela mostra o resultado
 * como RASCUNHOS e o usuário confirma antes de qualquer gravação.
 */

export const COST_CATEGORY_NAMES = [
  "Sementes",
  "Fertilizantes",
  "Defensivos",
  "Diesel",
  "Arrendamento",
  "Mão de obra",
  "Máquinas",
  "Sanidade",
  "Alimentação",
  "Cercas e infraestrutura",
  "Serviços contratados",
  "Impostos e taxas",
  "Outros",
] as const;

export const MAX_IMPORT_ROWS = 1000;
/** Texto gravado na nota de todo custo importado; identifica lançamentos de importação. */
export const IMPORT_NOTE_MARK = "Importado de planilha";

/** minúsculas, sem acento, espaços colapsados */
export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- CSV

/** Decodifica bytes de CSV: UTF-8 e, se não for válido, Windows-1252 (padrão do Excel brasileiro). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 5);
  let best = ",";
  let bestScore = -1;
  for (const d of [";", ",", "\t"]) {
    const counts = lines.map((l) => {
      let inQ = false;
      let n = 0;
      for (const ch of l) {
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) n++;
      }
      return n;
    });
    const min = Math.min(...counts, Infinity);
    const score = Number.isFinite(min) ? min : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** CSV simples: aspas, aspas escapadas (""), quebras de linha dentro de aspas, delimitador automático. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const d = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------- valores

/** "R$ 1.234,56" | "1234.56" | "1.234" (milhar) | "12,5" -> número >= 0, ou null se inválido. */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  let s = String(raw ?? "").trim();
  if (s === "") return null;
  s = s.replace(/r\$/gi, "").replace(/[\s ]/g, "");
  if (s === "" || /^[-(]/.test(s)) return null; // negativo não é custo
  if (!/^[\d.,]+$/.test(s)) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  let normalized: string;
  if (hasDot && hasComma) {
    const decimalIsComma = s.lastIndexOf(",") > s.lastIndexOf(".");
    normalized = decimalIsComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    normalized = s.replace(",", ".");
  } else if (hasDot) {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) normalized = s.replace(/\./g, "");
    else {
      const [ints, decs] = s.split(".");
      const looksThousands = decs.length === 3 && ints.length >= 1 && ints.length <= 3 && ints !== "0";
      normalized = looksThousands ? ints + decs : s;
    }
  } else normalized = s;

  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * dd/mm/aaaa, dd-mm-aa e aaaa-mm-dd -> "AAAA-MM-DD", ou null. Datas ambíguas são lidas no padrão brasileiro (dia primeiro).
 * O número serial do Excel (ex.: 45000) só é aceito com allowSerial, e só deve ser usado numa coluna JÁ marcada como
 * data: fora dela, um valor como 32000 é dinheiro, não data.
 */
export function parseDateBR(raw: unknown, allowSerial = false): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validIso(y, Number(m[2]), Number(m[1]));
  }
  if (allowSerial && /^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= 32874 && serial <= 73415) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return validIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  return null;
}

// ---------------------------------------------------------------- categoria

const CATEGORY_KEYWORDS: [(typeof COST_CATEGORY_NAMES)[number], string[]][] = [
  ["Sementes", ["semente", "hibrido", "cultivar", "sementes"]],
  ["Fertilizantes", ["adubo", "fertiliz", "ureia", "npk", "calcario", "calagem", "gesso", "potassio", "fosfato", "superfosfato", "nitrogenio"]],
  ["Defensivos", ["defensiv", "herbicida", "fungicida", "inseticida", "veneno", "agrotoxico", "glifosato", "acaricida", "dessecacao"]],
  ["Diesel", ["diesel", "combustivel", "s10", "s500", "oleo combust"]],
  ["Arrendamento", ["arrend", "aluguel de terra", "aluguel da terra", "parceria"]],
  ["Mão de obra", ["mao de obra", "salario", "funcionario", "diaria", "empregado", "trabalhador", "equipe", "encargo", "folha", "pagamento de pessoal"]],
  ["Cercas e infraestrutura", ["cerca", "arame", "moirao", "mourao", "porteira", "tabua", "esticador", "rocada", "rocad", "rocag", "rocao", "curral", "brete", "galpao", "bebedouro", "cocho", "mangueira", "limpeza de campo", "limpeza de pasto", "benfeitoria", "infraestrutura", "dobradica"]],
  ["Sanidade", ["vacina", "vermifug", "medicament", "remedio", "veterinari", "carrapat", "antibiotic", "vitamina", "ivermectina", "brucelose", "aftosa", "sanidade", "seringa", "sanitari"]],
  ["Alimentação", ["sal mineral", "mineral", "proteinado", "racao", "silagem", "suplement", "farelo", "feno", "capim", "alimentacao", "nutricao", "trato dos animais"]],
  ["Serviços contratados", ["servico", "terceiriz", "empreit", "alambrador", "contratad", "frete", "prestador"]],
  ["Impostos e taxas", ["imposto", "taxa", "georreferenc", "=itr", "=ccir", "=car", "funrural", "licenciamento", "cartorio", "escritura", "contabilidade", "iptu"]],
  ["Máquinas", ["maquina", "trator", "colheitadeira", "pulverizador", "manutencao", "peca", "reparo", "implemento", "plantadeira", "pneu"]],
];

export function normalizeCategory(text: unknown): { category: string; confident: boolean } {
  const t = norm(text);
  if (t === "") return { category: "Outros", confident: false };
  for (const c of COST_CATEGORY_NAMES) if (norm(c) === t) return { category: c, confident: true };
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => (w.startsWith("=") ? t.split(" ").includes(w.slice(1)) : t.includes(w)))) return { category: cat, confident: true };
  }
  return { category: "Outros", confident: false };
}

// ---------------------------------------------------------------- colunas

export type ColumnRole = "ignore" | "date" | "amount" | "category" | "description" | "field";

const HEADER_HINTS: [ColumnRole, string[]][] = [
  ["date", ["data", "dt", "dia", "emissao", "vencimento", "quando"]],
  ["amount", ["valor", "total", "custo", "montante", "importe", "r$", "gasto", "preco total"]],
  ["category", ["categoria", "tipo", "grupo", "classe", "natureza", "conta", "rubrica"]],
  ["description", ["descricao", "historico", "item", "produto", "detalhe", "obs", "observacao", "discriminacao", "lancamento"]],
  ["field", ["talhao", "gleba", "lote", "campo", "local", "area plantada"]],
];

function headerRole(h: string): ColumnRole {
  const t = norm(h);
  if (t === "") return "ignore";
  if (/unit|unid|quant|qtd|saca|hectare|\bha\b/.test(t)) return "ignore";
  for (const [role, hints] of HEADER_HINTS) {
    if (hints.some((k) => (k.length <= 3 ? t === k || t.split(" ").includes(k) : t.includes(k)))) return role;
  }
  return "ignore";
}

/** A primeira linha é cabeçalho? Sim quando quase nenhuma célula parece data ou valor. */
export function hasHeaderRow(rows: string[][]): boolean {
  const first = rows[0];
  if (!first) return false;
  const filled = first.filter((c) => c.trim() !== "");
  if (filled.length === 0) return false;
  const dataLike = filled.filter((c) => parseDateBR(c) !== null || parseMoney(c) !== null).length;
  return dataLike / filled.length < 0.5;
}

/** Sugere o papel de cada coluna pelo título e, se faltar, pelo conteúdo. Cada papel (exceto "ignore") é usado no máximo uma vez. */
export function detectRoles(headers: string[], body: string[][]): ColumnRole[] {
  const roles: ColumnRole[] = headers.map(headerRole);
  const used = new Set<ColumnRole>();
  roles.forEach((r, i) => {
    if (r === "ignore") return;
    if (used.has(r)) roles[i] = "ignore";
    else used.add(r);
  });

  const sample = body.slice(0, 50);
  const score = (col: number, test: (v: string) => boolean) => {
    const vals = sample.map((r) => (r[col] ?? "").trim()).filter((v) => v !== "");
    return vals.length === 0 ? 0 : vals.filter(test).length / vals.length;
  };
  if (!used.has("date")) {
    let best = -1;
    let bestScore = 0.6;
    roles.forEach((r, i) => {
      if (r !== "ignore") return;
      const sc = score(i, (v) => parseDateBR(v) !== null);
      if (sc > bestScore) { best = i; bestScore = sc; }
    });
    if (best >= 0) { roles[best] = "date"; used.add("date"); }
  }
  if (!used.has("amount")) {
    let best = -1;
    let bestScore = 0.6;
    roles.forEach((r, i) => {
      if (r !== "ignore") return;
      const sc = score(i, (v) => parseMoney(v) !== null && parseDateBR(v) === null);
      if (sc > bestScore) { best = i; bestScore = sc; }
    });
    if (best >= 0) { roles[best] = "amount"; used.add("amount"); }
  }
  return roles;
}

// ---------------------------------------------------------------- rascunhos

export type TargetField = { id: string; name: string };
export type ExistingCost = { field_id: string; date: string; category: string; amount: number };

export type Draft = {
  row: number; // número da linha na planilha (1 = primeira)
  date: string | null;
  amount: number | null;
  category: string;
  description: string;
  /** id do talhão, "all" (dividir pela área) ou null (não definido) */
  target: string | null;
  issues: string[];
  status: "ok" | "review" | "error";
  duplicate: boolean;
};

export type BuildOptions = {
  roles: ColumnRole[];
  fields: TargetField[];
  /** usado quando a planilha não tem coluna de talhão, ou o nome não bate */
  defaultTarget: string | null;
  existing: ExistingCost[];
  /** a primeira linha é cabeçalho (será pulada) */
  skipFirst: boolean;
};

const amountKey = (a: number) => Math.round(a * 100);

export function buildDrafts(rows: string[][], opts: BuildOptions): { drafts: Draft[]; skipped: { row: number; reason: string }[]; truncated: boolean } {
  const { roles, fields, defaultTarget, existing, skipFirst } = opts;
  const col = (role: ColumnRole) => roles.indexOf(role);
  const iDate = col("date");
  const iAmount = col("amount");
  const iCat = col("category");
  const iDesc = col("description");
  const iField = col("field");

  const fieldByName = new Map<string, string>();
  for (const f of fields) fieldByName.set(norm(f.name), f.id);
  const existingKeys = new Set(existing.map((e) => `${e.field_id}|${e.date}|${norm(e.category)}|${amountKey(Number(e.amount))}`));
  // Custos divididos entre talhões ("todos") ficam salvos em partes; somamos por data e categoria para reconhecê-los.
  const groupTotals = new Map<string, number>();
  for (const e of existing) {
    const k = `${e.date}|${norm(e.category)}`;
    groupTotals.set(k, (groupTotals.get(k) ?? 0) + amountKey(Number(e.amount)));
  }
  const seenInFile = new Set<string>();

  const drafts: Draft[] = [];
  const skipped: { row: number; reason: string }[] = [];
  let truncated = false;
  const start = skipFirst ? 1 : 0;

  for (let r = start; r < rows.length; r++) {
    const cells = rows[r];
    const rowNo = r + 1;
    if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue;
    if (drafts.length >= MAX_IMPORT_ROWS) { truncated = true; break; }

    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const date = iDate >= 0 ? parseDateBR(get(iDate), true) : null;
    const amount = iAmount >= 0 ? parseMoney(get(iAmount)) : null;

    // Linhas de total/subtotal no rodapé não são lançamentos.
    if (date === null && cells.some((c) => /^(sub)?total\b/.test(norm(c)))) {
      skipped.push({ row: rowNo, reason: "linha de total" });
      continue;
    }

    const issues: string[] = [];
    let status: Draft["status"] = "ok";
    const bump = (s: Draft["status"]) => { if (s === "error" || (s === "review" && status === "ok")) status = s; };

    if (iDate < 0) { issues.push("Sem coluna de data"); bump("error"); }
    else if (date === null) { issues.push(get(iDate) === "" ? "Data vazia" : "Data inválida"); bump("error"); }
    if (iAmount < 0) { issues.push("Sem coluna de valor"); bump("error"); }
    else if (amount === null) { issues.push(get(iAmount) === "" ? "Valor vazio" : "Valor inválido"); bump("error"); }
    else if (amount === 0) { issues.push("Valor zero"); bump("error"); }

    const rawCat = get(iCat);
    const desc = get(iDesc);
    // A categoria vem da coluna de categoria; sem ela, tenta pela descrição.
    const cat = normalizeCategory(rawCat !== "" ? rawCat : desc);
    if (!cat.confident) { issues.push("Categoria não reconhecida"); bump("review"); }

    let target: string | null = null;
    if (iField >= 0 && get(iField) !== "") {
      const id = fieldByName.get(norm(get(iField)));
      if (id) target = id;
      else { issues.push(`Talhão "${get(iField)}" não encontrado`); bump("review"); }
    }
    if (target === null) target = defaultTarget;
    if (target === null) { issues.push("Talhão não definido"); bump("error"); }

    let duplicate = false;
    if (status !== "error" && target && date && amount !== null) {
      duplicate = target === "all"
        ? groupTotals.get(`${date}|${norm(cat.category)}`) === amountKey(amount)
        : existingKeys.has(`${target}|${date}|${norm(cat.category)}|${amountKey(amount)}`);
      if (duplicate) { issues.push("Parece já lançado"); bump("review"); }
      else {
        // Mesma linha repetida dentro do próprio arquivo.
        const k = `${target}|${date}|${norm(cat.category)}|${amountKey(amount)}|${norm(desc)}`;
        if (seenInFile.has(k)) { duplicate = true; issues.push("Repetido na planilha"); bump("review"); }
        seenInFile.add(k);
      }
    }

    drafts.push({
      row: rowNo,
      date,
      amount,
      category: cat.category,
      description: desc !== "" ? desc : rawCat !== "" && !cat.confident ? rawCat : "",
      target,
      issues,
      status,
      duplicate,
    });
  }
  return { drafts, skipped, truncated };
}
