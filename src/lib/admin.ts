// Regras PURAS da área administrativa (testáveis, seguras para o cliente).

export const ADMIN_PAGE_SIZE = 20;

/** Há o papel admin nas linhas lidas de user_roles (já filtradas por auth.uid() via RLS)? */
export function rolesIncludeAdmin(rows: { role: string; user_id: string }[] | null, uid: string): boolean {
  return !!rows && rows.some((r) => r.role === "admin" && r.user_id === uid);
}

/** Busca operacional: remove curingas do LIKE e caracteres de filtro do PostgREST. */
export function sanitizeAdminSearch(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[%_\\,().*"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function clampPage(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 && n < 10_000 ? n : 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Campos de assinatura exibidos ao admin — sem IDs técnicos do gateway. */
export const ADMIN_SUBSCRIPTION_FIELDS = [
  "user_id",
  "plan_code",
  "status",
  "trial_started_at",
  "trial_ends_at",
  "current_period_ends_at",
  "cancel_at_period_end",
  "provider",
] as const;
