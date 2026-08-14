// Server-only: controle central de uso e rate limiting.
// Nenhuma lógica de contagem deve ser duplicada nos endpoints.
//
// Estratégia contra race condition:
// a checagem e o registro acontecem dentro da MESMA função do banco
// (`public.consume_rate_limit`), que serializa requisições concorrentes do
// mesmo (usuário, tipo de evento) com `pg_advisory_xact_lock` antes de contar
// e inserir. O cliente nunca informa user_id — a função usa `auth.uid()`.
import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabase = SupabaseClient<any, any, any>;

export type UsageEventType = "ai_message" | "ai_timeout" | "diagnostic_ai_generation";

/** Limites centrais — ajustáveis sem alterar a arquitetura. */
export const RATE_LIMITS = {
  ai_message: { hour: 30, day: 120 },
  diagnostic_ai_generation: { hour: 0, day: 10 },
} as const satisfies Record<string, { hour: number; day: number }>;

/** Limites de entrada / contexto do Consultor IA. */
export const CHAT_LIMITS = {
  /** Máximo de caracteres por mensagem do usuário. */
  maxUserMessageChars: 4000,
  /**
   * Contexto enviado ao modelo: apenas as N mensagens mais recentes.
   * O histórico persistido NÃO é apagado — só o contexto é limitado.
   */
  maxContextMessages: 12,
  /** Timeout da chamada ao gateway de IA. */
  timeoutMs: 45_000,
} as const;

export const RATE_LIMIT_MESSAGE =
  "Você atingiu o limite temporário de mensagens. Tente novamente mais tarde.";
export const DIAGNOSTIC_RATE_LIMIT_MESSAGE =
  "Você atingiu o limite de diagnósticos deste período. Tente novamente mais tarde.";
export const TOO_LONG_MESSAGE =
  "Sua mensagem está muito longa. Resuma a pergunta e tente novamente.";
export const AI_TIMEOUT_MESSAGE =
  "O Consultor está demorando mais que o esperado. Tente novamente.";

export type RateLimitResult = { allowed: boolean; scope: "hour" | "day" | null };

/**
 * Verifica e consome uma unidade do limite, atomicamente.
 * Retorna `allowed: false` quando o limite já foi atingido — nesse caso
 * NENHUM uso é registrado e o modelo não deve ser chamado.
 */
export async function checkRateLimit(
  supabase: AnySupabase,
  eventType: Exclude<UsageEventType, "ai_timeout">,
): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[eventType];
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    _event_type: eventType,
    _hour_limit: limits.hour,
    _day_limit: limits.day,
  });
  if (error) {
    // Falha de infraestrutura não deve virar erro fatal silencioso.
    console.error("[rate-limit] falha ao verificar limite", error.message);
    throw new Error("Não foi possível validar o uso agora. Tente novamente.");
  }
  const res = (data ?? {}) as { allowed?: boolean; scope?: "hour" | "day" | null };
  return { allowed: res.allowed === true, scope: res.scope ?? null };
}

/** Registra um evento técnico (ex.: ai_timeout). Nunca quebra o fluxo principal. */
export async function recordUsage(supabase: AnySupabase, eventType: UsageEventType) {
  const { error } = await supabase.rpc("record_usage_event", { _event_type: eventType });
  if (error) console.error("[rate-limit] falha ao registrar uso", error.message);
}

/** Uso agregado do usuário autenticado — server-side apenas. */
export async function getUsageStatus(
  supabase: AnySupabase,
  eventType: UsageEventType,
): Promise<{ hour: number; day: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("usage_events")
    .select("created_at")
    .eq("event_type", eventType)
    .gte("created_at", since);
  if (error) return { hour: 0, day: 0 };
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const rows = (data ?? []) as { created_at: string }[];
  return {
    hour: rows.filter((r) => new Date(r.created_at).getTime() > hourAgo).length,
    day: rows.length,
  };
}
