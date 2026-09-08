// Server-only: auditoria operacional do AgroIntel.
//
// PRIVACIDADE (regras invioláveis):
// - Nunca armazenar JWT, senha, service role, prompts, respostas da IA,
//   conteúdo de mensagens, documentos ou snapshots financeiros da fazenda.
// - `metadata` aceita SOMENTE chaves operacionais (allowlist abaixo).
// - A identidade NUNCA vem do cliente: a função `public.record_audit_event`
//   é SECURITY DEFINER e usa `auth.uid()`.
// - Falha ao gravar auditoria nunca derruba a operação principal.
import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabase = SupabaseClient<any, any, any>;

export const AUDIT_EVENTS = [
  // Autenticação
  "login_success",
  "login_failure",
  "logout",
  // Propriedade
  "property_created",
  "property_updated",
  "property_deleted",
  // Talhão
  "field_created",
  "field_updated",
  "field_deleted",
  // Custos
  "cost_created",
  "cost_updated",
  "cost_deleted",
  // Preços
  "price_created",
  "price_updated",
  "price_deleted",
  // Diagnóstico
  "diagnostic_started",
  "diagnostic_completed",
  "diagnostic_failed",
  "diagnostic_rate_limited",
  // Consultor IA
  "ai_request_started",
  "ai_request_completed",
  "ai_request_failed",
  "ai_request_timeout",
  "ai_rate_limited",
  // Cenários
  "scenario_created",
  "scenario_deleted",
  // Relatório executivo
  "executive_report_generated",
  "executive_report_failed",
  // Alertas
  "alert_acknowledged",
  "alert_resolved_automatically",
  "alert_reactivated",
  // LGPD / conta
  "data_export_started",
  "data_export_completed",
  "data_export_failed",
  "account_deletion_started",
  "account_deletion_completed",
  "account_deletion_failed",
  "terms_accepted",
  // Assinatura / entitlements
  "trial_started",
  "trial_expired",
  "subscription_access_denied",
  "privacy_accepted",
  // Cobrança (Sprint 3.4B) — nunca com valores, cartão ou payload do gateway
  "checkout_started",
  "checkout_failed",
  "subscription_activated",
  "subscription_renewed",
  "subscription_cancel_scheduled",
  "subscription_canceled",
  "subscription_expired",
  "payment_failed",
  "billing_portal_opened",
  "webhook_invalid_signature",
  "webhook_processing_failed",
] as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[number];
export type AuditStatus = "success" | "failure" | "started" | "blocked";

export type AuditMetadata = Record<string, unknown>;

/**
 * Allowlist de chaves operacionais. Qualquer outra chave é descartada —
 * inclusive `token`, `authorization`, `amount`, `email`, `message`, etc.
 */
export const ALLOWED_METADATA_KEYS = [
  "duration_ms",
  "http_status",
  "error_code",
  "source",
  "scope",
  "count",
  "created",
  "updated",
  "resolved",
  "severity",
  "operation",
  "retry",
  "fallback_used",
  "page_count",
  "reason",
] as const;

const ALLOWED = new Set<string>(ALLOWED_METADATA_KEYS as readonly string[]);

/** Tamanho máximo de valores textuais operacionais (códigos curtos, não conteúdo). */
const MAX_STRING_LEN = 64;

/**
 * Mantém apenas chaves da allowlist e valores escalares curtos.
 * Objetos/arrays são descartados: metadados são operacionais, nunca payloads.
 */
export function sanitizeAuditMetadata(metadata: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return out;
  for (const [key, value] of Object.entries(metadata as AuditMetadata)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = trimmed.slice(0, MAX_STRING_LEN);
    }
    // null/undefined/objetos/arrays: descartados de propósito.
  }
  return out;
}

/** Identificador que liga as etapas de uma mesma operação (ex.: diagnóstico). */
export function createCorrelationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback determinístico-o-suficiente para runtimes sem WebCrypto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type AuditEventInput = {
  eventType: AuditEventType;
  status?: AuditStatus;
  entityType?: string | null;
  entityId?: string | null;
  propertyId?: string | null;
  metadata?: AuditMetadata;
  correlationId?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

/**
 * Grava um evento de auditoria. Nunca lança: auditoria é observabilidade,
 * não pode quebrar a operação de negócio.
 */
export async function recordAuditEvent(
  supabase: AnySupabase,
  input: AuditEventInput,
): Promise<{ ok: boolean }> {
  try {
    const { error } = await supabase.rpc("record_audit_event", {
      _event_type: input.eventType,
      _status: input.status ?? "success",
      _entity_type: input.entityType ?? null,
      _entity_id: asUuid(input.entityId),
      _property_id: asUuid(input.propertyId),
      _metadata: sanitizeAuditMetadata(input.metadata),
      _correlation_id: asUuid(input.correlationId),
    });
    if (error) {
      console.error("[auditoria] falha ao gravar evento", {
        event_type: input.eventType,
        error_code: error.code ?? "unknown",
      });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[auditoria] exceção ao gravar evento", {
      event_type: input.eventType,
      error_code: (err as { code?: string })?.code ?? "exception",
    });
    return { ok: false };
  }
}

/** Açúcar sintático: mede duração de uma operação sem expor conteúdo. */
export function startTimer() {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
