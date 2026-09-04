// Server-only: fonte de verdade da assinatura e da autorização comercial.
//
// REGRAS:
// - A identidade vem SEMPRE do token validado (`requireSupabaseAuth`) e, no
//   banco, de `auth.uid()`. O cliente nunca informa user_id, plano ou datas.
// - `now` é o relógio do servidor. O navegador nunca decide validade de trial.
// - Entitlement e rate limit são independentes: o entitlement é checado ANTES,
//   para não consumir quota de IA quando o recurso já está bloqueado.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAccess,
  hasEntitlement,
  blockedMessage,
  blockedReason,
  type Feature,
  type SubscriptionAccess,
  type SubscriptionRow,
} from "@/lib/entitlements";
import { AppError, ERROR_CODES } from "@/lib/errors";

type AnySupabase = SupabaseClient<any, any, any>;

const SUB_COLUMNS =
  "plan_code, status, trial_started_at, trial_ends_at, current_period_started_at, current_period_ends_at, cancel_at_period_end, canceled_at";

/**
 * Garante que o usuário autenticado tenha uma assinatura.
 * Idempotente e protegida contra concorrência dentro da RPC
 * `public.ensure_subscription()` (advisory lock + UNIQUE(user_id)).
 * Se já existir assinatura, apenas retorna a existente — nunca um novo trial.
 */
export async function ensureSubscription(
  supabase: AnySupabase,
): Promise<{ row: SubscriptionRow | null; created: boolean }> {
  const before = await getSubscriptionRow(supabase);
  const { data, error } = await supabase.rpc("ensure_subscription");
  if (error) {
    console.error("[assinatura] falha ao garantir assinatura", { error_code: error.code ?? "unknown" });
    return { row: before, created: false };
  }
  const row = (data ?? null) as SubscriptionRow | null;
  return { row, created: before === null && row !== null };
}

export async function getSubscriptionRow(supabase: AnySupabase): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUB_COLUMNS)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as SubscriptionRow | null;
}

/** Estado de acesso do usuário autenticado, calculado com o relógio do servidor. */
export async function getSubscriptionAccess(supabase: AnySupabase): Promise<SubscriptionAccess> {
  return computeAccess(await getSubscriptionRow(supabase), new Date());
}

/**
 * Bloqueia a operação quando não há entitlement.
 * Lança `AppError` comercial (402) — distinto de 429 (rate limit).
 */
export async function requireEntitlement(
  supabase: AnySupabase,
  feature: Feature,
  correlationId?: string | null,
): Promise<SubscriptionAccess> {
  const access = await getSubscriptionAccess(supabase);
  if (hasEntitlement(access, feature)) return access;

  const reason = blockedReason(access);
  const { recordAuditEvent } = await import("@/lib/audit.server");
  await recordAuditEvent(supabase, {
    eventType: "subscription_access_denied",
    status: "blocked",
    correlationId: correlationId ?? null,
    metadata: { error_code: reason, operation: feature },
  });

  throw new AppError({
    code: ERROR_CODES[reason],
    status: 402,
    correlationId: correlationId ?? null,
    userMessage: blockedMessage(access),
  });
}
