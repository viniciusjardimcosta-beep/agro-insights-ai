// Server functions administrativas. TODAS: requireSupabaseAuth + requireAdmin
// antes de qualquer leitura com service role. Somente leitura, exceto
// conceder/revogar elegibilidade ao Plano Fundador.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_PAGE_SIZE, ADMIN_SUBSCRIPTION_FIELDS, clampPage, isUuid, sanitizeAdminSearch } from "@/lib/admin";

/** Usado só para UX (menu/rota). A autorização real fica em cada função abaixo. */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isAdmin } = await import("@/lib/admin.server");
    return { isAdmin: await isAdmin(context.supabase, context.userId) };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const sub = () => db.from("subscriptions").select("id", { count: "exact", head: true });
    const [users, trials, active, pastDue, ended, founders, founderEligible, pending] = await Promise.all([
      count(db.from("profiles").select("id", { count: "exact", head: true })),
      count(sub().eq("status", "trialing").gt("trial_ends_at", now)),
      count(sub().eq("status", "active").gt("current_period_ends_at", now)),
      count(sub().eq("status", "past_due")),
      count(sub().in("status", ["canceled", "expired"])),
      count(sub().eq("plan_code", "pro_founder_monthly").eq("status", "active")),
      count(
        db.from("billing_eligibility").select("user_id", { count: "exact", head: true }).eq("founder_eligible", true),
      ),
      count(
        db.from("billing_checkouts").select("id", { count: "exact", head: true }).eq("status", "pending").gt("expires_at", now),
      ),
    ]);
    return { users, trials, active, pastDue, ended, founders, founderEligible, pending };
  });

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  subscription: {
    plan_code: string;
    status: string;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    current_period_ends_at: string | null;
    cancel_at_period_end: boolean;
    provider: string | null;
  } | null;
  founderEligible: boolean;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => {
    const r = (raw ?? {}) as { page?: unknown; search?: unknown };
    return { page: clampPage(r.page), search: sanitizeAdminSearch(r.search) };
  })
  .handler(async ({ context, data }): Promise<{ rows: AdminUserRow[]; total: number; pageSize: number }> => {
    const { requireAdmin } = await import("@/lib/admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    let q = db.from("profiles").select("id, name, email, created_at", { count: "exact" });
    if (data.search) q = q.or(`name.ilike.%${data.search}%,email.ilike.%${data.search}%`);
    const from = data.page * ADMIN_PAGE_SIZE;
    const { data: profiles, count, error } = await q
      .order("created_at", { ascending: false })
      .range(from, from + ADMIN_PAGE_SIZE - 1);
    if (error) throw new Error("Não foi possível carregar os usuários.");

    const ids = (profiles ?? []).map((p) => p.id);
    const [{ data: subs }, { data: elig }] = await Promise.all([
      ids.length
        ? db.from("subscriptions").select(ADMIN_SUBSCRIPTION_FIELDS.join(", ")).in("user_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? db.from("billing_eligibility").select("user_id, founder_eligible").in("user_id", ids)
        : Promise.resolve({ data: [] }),
    ]);
    const subBy = new Map(((subs ?? []) as unknown as (AdminUserRow["subscription"] & { user_id: string })[]).map((s) => [s.user_id, s]));
    const eligBy = new Map(((elig ?? []) as { user_id: string; founder_eligible: boolean }[]).map((e) => [e.user_id, e.founder_eligible]));

    return {
      total: count ?? 0,
      pageSize: ADMIN_PAGE_SIZE,
      rows: (profiles ?? []).map((p) => {
        const s = subBy.get(p.id);
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          createdAt: p.created_at,
          subscription: s
            ? {
                plan_code: s.plan_code,
                status: s.status,
                trial_started_at: s.trial_started_at,
                trial_ends_at: s.trial_ends_at,
                current_period_ends_at: s.current_period_ends_at,
                cancel_at_period_end: s.cancel_at_period_end,
                provider: s.provider,
              }
            : null,
          founderEligible: eligBy.get(p.id) === true,
        };
      }),
    };
  });

/**
 * Concede/revoga elegibilidade ao Plano Fundador.
 * Revogar NÃO altera assinatura fundador já ativa: só afeta contratações futuras.
 */
export const setFounderEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => {
    const r = (raw ?? {}) as { targetUserId?: unknown; eligible?: unknown };
    return { targetUserId: r.targetUserId, eligible: r.eligible === true };
  })
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("@/lib/admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    if (!isUuid(data.targetUserId)) {
      throw new AppError({ code: ERROR_CODES.VALIDATION, status: 400, userMessage: "Usuário inválido." });
    }
    const target = data.targetUserId;
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: exists } = await db.from("profiles").select("id").eq("id", target).maybeSingle();
    if (!exists) throw new AppError({ code: ERROR_CODES.NOT_FOUND, status: 404, userMessage: "Usuário não encontrado." });

    const now = new Date().toISOString();
    const { error } = await db.from("billing_eligibility").upsert(
      data.eligible
        ? { user_id: target, founder_eligible: true, granted_at: now, consumed_at: null }
        : { user_id: target, founder_eligible: false },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("Não foi possível atualizar a elegibilidade.");

    const { recordAuditEvent, createCorrelationId } = await import("@/lib/audit.server");
    // Ator = auth.uid() (gravado pela RPC); alvo = entity_id. Sem nome/email.
    await recordAuditEvent(context.supabase, {
      eventType: data.eligible ? "admin_founder_granted" : "admin_founder_revoked",
      entityType: "user",
      entityId: target,
      correlationId: createCorrelationId(),
      metadata: { source: "admin" },
    });
    return { ok: true, eligible: data.eligible };
  });

export const getAdminBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [{ data: checkouts }, { data: events }] = await Promise.all([
      db.from("billing_checkouts").select("id, plan_code, status, created_at, expires_at").order("created_at", { ascending: false }).limit(20),
      db.from("billing_events").select("id, provider, event_type, status, error_code, created_at, processed_at").order("created_at", { ascending: false }).limit(30),
    ]);
    return { checkouts: checkouts ?? [], events: events ?? [] };
  });

const OPS_EVENTS = [
  "ai_request_failed",
  "ai_request_timeout",
  "ai_rate_limited",
  "diagnostic_failed",
  "diagnostic_rate_limited",
  "executive_report_failed",
  "checkout_failed",
  "payment_failed",
  "webhook_invalid_signature",
  "webhook_processing_failed",
  "account_deletion_failed",
  "data_export_failed",
];

export const getAdminObservability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await db
      .from("audit_events")
      .select("event_type, status, metadata, created_at")
      .in("event_type", OPS_EVENTS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = data ?? [];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
    return {
      counts: Object.entries(counts).map(([eventType, total]) => ({ eventType, total })).sort((a, b) => b.total - a.total),
      // Somente tipo, status, data e código de erro — nunca conteúdo.
      recent: rows.slice(0, 20).map((r) => ({
        eventType: r.event_type,
        status: r.status,
        createdAt: r.created_at,
        errorCode: (r.metadata as Record<string, unknown> | null)?.["error_code"] ?? null,
      })),
    };
  });
