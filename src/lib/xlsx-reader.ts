/**
 * Leitor mínimo de .xlsx, sem dependências: um .xlsx é um zip de XMLs.
 * Roda no navegador (e no Node 18+) usando DecompressionStream. Devolve cada aba como linhas de texto,
 * igual ao CSV. Células com formato de data viram "AAAA-MM-DD". Fórmulas: lê o último valor calculado.
 * Limites: sem ZIP64, sem arquivos protegidos por senha, sem .xls antigo.
 */

export type SheetData = { name: string; rows: string[][] };

const MAX_ENTRY_BYTES = 30 * 1024 * 1024; // proteção contra zip "bomba"
const MAX_ROWS = 5000;
const MAX_COLS = 60;

const decoder = new TextDecoder("utf-8");

function u16(v: DataView, o: number) { return v.getUint16(o, true); }
function u32(v: DataView, o: number) { return v.getUint32(o, true); }

type ZipEntry = { method: number; compSize: number; uncompSize: number; localOffset: number };

function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Arquivo não parece ser uma planilha Excel (.xlsx).");
  const total = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || u32(v, p) !== 0x02014b50) throw new Error("Planilha corrompida.");
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method: u16(v, p + 10),
      compSize: u32(v, p + 20),
      uncompSize: u32(v, p + 24),
      localOffset: u32(v, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (e.uncompSize > MAX_ENTRY_BYTES) throw new Error("Planilha grande demais.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.localOffset + 30 > bytes.length || u32(v, e.localOffset) !== 0x04034b50) throw new Error("Planilha corrompida.");
  const start = e.localOffset + 30 + u16(v, e.localOffset + 26) + u16(v, e.localOffset + 28);
  const data = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error("Compressão da planilha não suportada.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ENTRY_BYTES) { await reader.cancel(); throw new Error("Planilha grande demais."); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(c) && !/^general$/i.test(c.trim());
}

function parseStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = Number(attr(m[1], "numFmtId"));
    const code = attr(m[1], "formatCode");
    if (Number.isFinite(id) && code !== null) custom.set(id, code);
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!block) return [];
  const result: boolean[] = [];
  for (const m of block[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    result.push(BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!)));
  }
  return result;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function serialToIso(serial: number, date1904: boolean): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseSheet(xml: string, shared: string[], dateStyles: boolean[], date1904: boolean): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rIndex = Number(attr(rm[1], "r")) - 1;
    if (!Number.isFinite(rIndex) || rIndex < 0) continue;
    if (rIndex >= MAX_ROWS) break;
    const body = rm[2] ?? "";
    const row: string[] = [];
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      if (!ref) continue;
      const ci = colIndex(ref);
      if (ci >= MAX_COLS) continue;
      const t = attr(cm[1], "t");
      const s = Number(attr(cm[1], "s") ?? 0);
      const inner = cm[2] ?? "";
      const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      const raw = vMatch ? decodeXml(vMatch[1]) : "";
      let val = "";
      if (t === "s") val = shared[Number(raw)] ?? "";
      else if (t === "inlineStr") val = textOf(inner);
      else if (t === "str") val = raw;
      else if (t === "b") val = raw === "1" ? "Sim" : "Não";
      else if (t === "e") val = "";
      else if (raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) val = dateStyles[s] && n > 0 ? serialToIso(n, date1904) : String(Math.round(n * 1e6) / 1e6);
        else val = raw;
      }
      while (row.length < ci) row.push("");
      row[ci] = val;
    }
    while (rows.length < rIndex) rows.push([]);
    rows[rIndex] = row;
  }
  return rows.map((r) => r.map((c) => c ?? ""));
}

export async function readXlsx(buffer: ArrayBuffer): Promise<SheetData[]> {
  const bytes = new Uint8Array(buffer);
  const entries = readCentralDirectory(bytes);
  const text = async (name: string): Promise<string | null> => {
    const e = entries.get(name);
    return e ? decoder.decode(await readEntry(bytes, e)) : null;
  };

  const workbook = await text("xl/workbook.xml");
  if (!workbook) throw new Error("Arquivo não parece ser uma planilha Excel (.xlsx).");
  const rels = (await text("xl/_rels/workbook.xml.rels")) ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) relTarget.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sharedXml = await text("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXml) for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const dateStyles = parseStyles(await text("xl/styles.xml"));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);

  const sheets: SheetData[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], "name") ?? `Aba ${sheets.length + 1}`;
    const rid = attr(m[1], "r:id");
    const path = (rid && relTarget.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = await text(path);
    if (!xml) continue;
    sheets.push({ name, rows: parseSheet(xml, shared, dateStyles, date1904) });
  }
  return sheets;
}
