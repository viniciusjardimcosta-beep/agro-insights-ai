// Montagem (pura) do pacote de exportação de dados do usuário — LGPD.
//
// REGRAS:
// - Somente dados do próprio usuário (as consultas já são filtradas por RLS).
// - Nunca inclui: JWT, tokens, service role, correlation_id, logs técnicos,
//   usage_events, audit_events ou dados de terceiros.
// - `user_id` interno é removido de cada registro: o dono já é identificado
//   uma única vez no bloco `profile`.

export const EXPORT_VERSION = "1.0";

/** Chaves nunca exportadas, mesmo que existam nas linhas do banco. */
export const FORBIDDEN_EXPORT_KEYS = [
  "user_id",
  "correlation_id",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "jwt",
  "service_role",
  "password",
  "senha",
  "secret",
] as const;

const FORBIDDEN = new Set<string>(FORBIDDEN_EXPORT_KEYS as readonly string[]);

type Row = Record<string, unknown>;

export function stripForbidden<T extends Row>(row: T): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (FORBIDDEN.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

const clean = (rows: Row[] | null | undefined) => (rows ?? []).map(stripForbidden);

export type ExportSource = {
  profile: Row | null;
  properties: Row[] | null;
  fields: Row[] | null;
  costs: Row[] | null;
  prices: Row[] | null;
  diagnostics: Row[] | null;
  scenarios: Row[] | null;
  alerts: Row[] | null;
  threads: Row[] | null;
  messages: Row[] | null;
};

export type ExportPayload = {
  export_version: string;
  generated_at: string;
  profile: Row;
  properties: Row[];
  fields: Row[];
  costs: Row[];
  prices: Row[];
  diagnostics: Row[];
  scenarios: Row[];
  alerts: Row[];
  ai_threads: Row[];
};

/** Monta o JSON estruturado e versionado entregue ao usuário. */
export function buildExportPayload(src: ExportSource, generatedAt = new Date().toISOString()): ExportPayload {
  const messagesByThread = new Map<string, Row[]>();
  for (const m of src.messages ?? []) {
    const tid = String((m as Row)["thread_id"] ?? "");
    const list = messagesByThread.get(tid) ?? [];
    const row = stripForbidden(m);
    delete row["thread_id"];
    list.push(row);
    messagesByThread.set(tid, list);
  }

  const threads = (src.threads ?? []).map((t) => {
    const row = stripForbidden(t);
    row["messages"] = messagesByThread.get(String(t["id"] ?? "")) ?? [];
    return row;
  });

  return {
    export_version: EXPORT_VERSION,
    generated_at: generatedAt,
    profile: src.profile ? stripForbidden(src.profile) : {},
    properties: clean(src.properties),
    fields: clean(src.fields),
    costs: clean(src.costs),
    prices: clean(src.prices),
    diagnostics: clean(src.diagnostics),
    scenarios: clean(src.scenarios),
    alerts: clean(src.alerts),
    ai_threads: threads,
  };
}

export function exportFileName(generatedAt = new Date()): string {
  const iso = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `agrointel-meus-dados-${iso}.json`;
}
