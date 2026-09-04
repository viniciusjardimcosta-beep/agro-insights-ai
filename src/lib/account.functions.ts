import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildExportPayload, type ExportSource } from "@/lib/account-export";

/**
 * Conta do usuário: exportação (portabilidade), aceite de termos e exclusão.
 *
 * SEGURANÇA:
 * - Toda operação passa por `requireSupabaseAuth`; o `user_id` NUNCA vem do cliente.
 * - Leitura da exportação usa o client do usuário (RLS ativa).
 * - O service role é usado apenas no passo que exige privilégio real:
 *   remover o usuário do Auth (Admin API), depois de a identidade ser validada.
 */

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { recordAuditEvent, startTimer, createCorrelationId } = await import("@/lib/audit.server");
    const correlationId = createCorrelationId();
    const elapsed = startTimer();
    const sb = context.supabase;

    await recordAuditEvent(sb, {
      eventType: "data_export_started",
      status: "started",
      correlationId,
      metadata: { source: "settings" },
    });

    try {
      const [profile, properties, fields, costs, prices, diagnostics, scenarios, alerts, threads, messages, subscription] =
        await Promise.all([
          sb.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
          sb.from("properties").select("*").order("created_at", { ascending: true }),
          sb.from("fields").select("*").order("created_at", { ascending: true }),
          sb.from("costs").select("*").order("date", { ascending: true }),
          sb.from("prices").select("*").order("date", { ascending: true }),
          sb.from("diagnostics").select("*").order("created_at", { ascending: true }),
          sb.from("simulated_scenarios").select("*").order("created_at", { ascending: true }),
          sb.from("intelligence_alerts").select("*").order("created_at", { ascending: true }),
          sb.from("ai_threads").select("*").order("created_at", { ascending: true }),
          sb.from("ai_messages").select("*").order("created_at", { ascending: true }),
          sb.from("subscriptions").select("*").maybeSingle(),
        ]);

      const src: ExportSource = {
        profile: (profile.data ?? null) as ExportSource["profile"],
        properties: properties.data as ExportSource["properties"],
        fields: fields.data as ExportSource["fields"],
        costs: costs.data as ExportSource["costs"],
        prices: prices.data as ExportSource["prices"],
        diagnostics: diagnostics.data as ExportSource["diagnostics"],
        scenarios: scenarios.data as ExportSource["scenarios"],
        alerts: alerts.data as ExportSource["alerts"],
        threads: threads.data as ExportSource["threads"],
        messages: messages.data as ExportSource["messages"],
        subscription: (subscription.data ?? null) as ExportSource["subscription"],
      };

      const payload = buildExportPayload(src);

      await recordAuditEvent(sb, {
        eventType: "data_export_completed",
        correlationId,
        // Nenhum conteúdo exportado é registrado — apenas métricas operacionais.
        metadata: { duration_ms: elapsed(), count: payload.properties.length, source: "settings" },
      });

      return payload;
    } catch (err) {
      await recordAuditEvent(sb, {
        eventType: "data_export_failed",
        status: "failure",
        correlationId,
        metadata: { duration_ms: elapsed(), error_code: "EXPORT_FAILED" },
      });
      console.error("[exportacao] falha", { correlation_id: correlationId, error_code: "EXPORT_FAILED" });
      throw new Error("Não foi possível exportar seus dados agora. Tente novamente.");
    }
  });

const acceptInput = z.object({
  termsVersion: z.string().min(1).max(16),
  privacyVersion: z.string().min(1).max(16),
});

/** Registra o aceite dos documentos legais no perfil do usuário autenticado. */
export const acceptLegalTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => acceptInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("profiles")
      .update({
        terms_accepted_at: now,
        privacy_accepted_at: now,
        terms_version: data.termsVersion,
        privacy_version: data.privacyVersion,
      })
      .eq("id", context.userId);
    if (error) throw new Error("Não foi possível registrar o aceite dos termos.");

    await recordAuditEvent(context.supabase, { eventType: "terms_accepted", metadata: { source: "signup" } });
    await recordAuditEvent(context.supabase, { eventType: "privacy_accepted", metadata: { source: "signup" } });
    return { ok: true, acceptedAt: now };
  });

const deleteInput = z.object({ confirmation: z.string() });

/**
 * Exclusão definitiva da conta.
 *
 * Ordem: dados sem FK (diagnostics) → usuário no Auth (cascade remove o resto).
 * `audit_events.user_id` é ON DELETE SET NULL: os eventos permanecem
 * ANONIMIZADOS para retenção operacional (ver docs/DATA_RETENTION.md).
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => deleteInput.parse(raw))
  .handler(async ({ context, data }) => {
    if (data.confirmation.trim().toUpperCase() !== "EXCLUIR") {
      throw new Error('Digite EXCLUIR para confirmar a exclusão da conta.');
    }

    const { recordAuditEvent, startTimer, createCorrelationId } = await import("@/lib/audit.server");
    const correlationId = createCorrelationId();
    const elapsed = startTimer();
    const userId = context.userId;

    await recordAuditEvent(context.supabase, {
      eventType: "account_deletion_started",
      status: "started",
      correlationId,
      metadata: { source: "settings" },
    });

    try {
      // 1) Tabelas sem FK para auth.users precisam de exclusão explícita.
      const { error: diagErr } = await context.supabase.from("diagnostics").delete().eq("user_id", userId);
      if (diagErr) throw new Error(diagErr.message);

      // 2) Dados operacionais de uso: removidos junto com a conta.
      await context.supabase.from("usage_events").delete().eq("user_id", userId);

      // 3) Auditoria do encerramento ANTES de perder a identidade.
      await recordAuditEvent(context.supabase, {
        eventType: "account_deletion_completed",
        correlationId,
        metadata: { duration_ms: elapsed(), source: "settings" },
      });

      // 4) Remoção do usuário no Auth — cascata apaga profiles, properties,
      //    fields, costs, prices, ai_threads, ai_messages, cenários e alertas.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authErr) throw new Error(authErr.message);

      return { ok: true };
    } catch (err) {
      await recordAuditEvent(context.supabase, {
        eventType: "account_deletion_failed",
        status: "failure",
        correlationId,
        metadata: { duration_ms: elapsed(), error_code: "ACCOUNT_DELETE_FAILED" },
      });
      console.error("[exclusao-conta] falha", {
        correlation_id: correlationId,
        error_code: "ACCOUNT_DELETE_FAILED",
      });
      throw new Error("Não foi possível excluir a conta agora. Nenhuma alteração parcial foi confirmada no seu login.");
    }
  });
