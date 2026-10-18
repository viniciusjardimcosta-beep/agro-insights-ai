// Server functions de cobrança (autenticadas).
//
// SEGURANÇA:
// - Identidade sempre do token (`requireSupabaseAuth`). O cliente envia apenas
//   `planCode`; preço, ciclo, desconto, trial, status e IDs do gateway são
//   resolvidos no servidor e qualquer campo extra é descartado.
// - Retorno de checkout nunca ativa assinatura: só o webhook validado.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillingPlanDTO = {
  planCode: string;
  label: string;
  interval: "month" | "year";
  amountCents: number;
  founder: boolean;
};

export type BillingStatusInfo = {
  configured: boolean;
  plans: BillingPlanDTO[];
  founderEligible: boolean;
  /** Contratação concluída no gateway aguardando 1ª cobrança (ex.: durante o trial). */
  recurrenceScheduled: boolean;
  checkoutPending: boolean;
  hasCustomerPortal: boolean;
  /** Plano contratado (para exibição), sem IDs técnicos. */
  planCode: string;
};

function safeOrigin(): string {
  const raw = getRequestHeader("origin") ?? "";
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || u.hostname === "localhost") return u.origin;
  } catch {
    /* noop */
  }
  const host = getRequestHeader("host") ?? "";
  return `https://${host}`;
}

export const getBillingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingStatusInfo> => {
    const { resolveProvider } = await import("./provider.server");
    const { availablePlanVariants, isFounderEligible } = await import("./plans");
    const { hasLiveRecurrence } = await import("./billing.server");
    const provider = resolveProvider();

    const [{ data: elig }, { data: sub }] = await Promise.all([
      context.supabase.from("billing_eligibility").select("founder_eligible, consumed_at").maybeSingle(),
      context.supabase
        .from("subscriptions")
        .select("status, plan_code, provider_customer_id, provider_subscription_id, cancel_at_period_end, trial_ends_at")
        .maybeSingle(),
    ]);
    const founderEligible = isFounderEligible(elig ?? null);

    let checkoutPending = false;
    if (provider) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: co } = await supabaseAdmin
        .from("billing_checkouts")
        .select("id")
        .eq("user_id", context.userId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      checkoutPending = !!co;
    }

    return {
      configured: !!provider,
      plans: provider
        ? availablePlanVariants()
            .filter((v) => !v.requiresFounderEligibility || founderEligible)
            .map((v) => ({
              planCode: v.planCode,
              label: v.label,
              interval: v.interval,
              amountCents: v.amountCents,
              founder: v.requiresFounderEligibility,
            }))
        : [],
      founderEligible,
      recurrenceScheduled: sub?.status === "trialing" && hasLiveRecurrence(sub ?? null),
      checkoutPending,
      hasCustomerPortal: provider?.hasCustomerPortal ?? false,
      planCode: sub?.plan_code ?? "trial",
    };
  });

const CHECKOUT_MINUTES = 30;

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // Apenas planCode é lido; amount/price/discount/trialDays/customerId são descartados.
  .inputValidator((input: unknown) => ({
    planCode: String((input as { planCode?: unknown } | null)?.planCode ?? "").slice(0, 64),
  }))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    const { findPlanVariant, isFounderEligible } = await import("./plans");
    const { hasLiveRecurrence, firstChargeDate, activeTrialEndsAt } = await import("./billing.server");
    const { ensureSubscription } = await import("@/lib/subscription.server");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");

    const fail = async (code: string, userMessage: string, status: number, errCode: keyof typeof ERROR_CODES) => {
      await recordAuditEvent(context.supabase, {
        eventType: "checkout_failed",
        status: "blocked",
        metadata: { error_code: code },
      });
      return new AppError({ code: ERROR_CODES[errCode], status, userMessage });
    };

    const variant = findPlanVariant(data.planCode);
    if (!variant || !variant.available) {
      throw await fail("INVALID_PLAN", "Este plano não está disponível para contratação.", 400, "INVALID_PLAN");
    }
    if (variant.requiresFounderEligibility) {
      const { data: elig } = await context.supabase
        .from("billing_eligibility")
        .select("founder_eligible, consumed_at")
        .maybeSingle();
      if (!isFounderEligible(elig ?? null)) {
        throw await fail(
          "FOUNDER_PLAN_NOT_ELIGIBLE",
          "O Plano Fundador não está disponível para a sua conta.",
          403,
          "FOUNDER_PLAN_NOT_ELIGIBLE",
        );
      }
    }

    const provider = requireProvider(); // fail-closed (configuração completa obrigatória)
    await ensureSubscription(context.supabase);
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("status, plan_code, provider_customer_id, provider_subscription_id, cancel_at_period_end, trial_ends_at, current_period_ends_at")
      .maybeSingle();
    if (!sub) throw await fail("NO_SUBSCRIPTION", "Não foi possível iniciar a contratação.", 500, "CHECKOUT_FAILED");
    if (hasLiveRecurrence(sub)) {
      throw await fail("ALREADY_SUBSCRIBED", "Você já possui uma assinatura contratada.", 409, "CHECKOUT_FAILED");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    // Expira tentativas antigas e reaproveita a pendente do mesmo plano.
    await supabaseAdmin
      .from("billing_checkouts")
      .update({ status: "expired" })
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .lt("expires_at", nowIso);
    const { data: pending } = await supabaseAdmin
      .from("billing_checkouts")
      .select("id, plan_code, checkout_url")
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .maybeSingle();
    if (pending?.checkout_url && pending.plan_code === variant.planCode) return { url: pending.checkout_url };
    if (pending) {
      await supabaseAdmin.from("billing_checkouts").update({ status: "canceled" }).eq("id", pending.id);
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_MINUTES * 60_000).toISOString();
    const { data: row, error: insErr } = await supabaseAdmin
      .from("billing_checkouts")
      .insert({
        user_id: context.userId,
        provider: provider.id,
        plan_code: variant.planCode,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (insErr || !row) {
      // 23505: outra aba criou um checkout ao mesmo tempo (índice único parcial).
      throw await fail("CONCURRENT_CHECKOUT", "Já existe uma contratação em andamento. Tente novamente em instantes.", 409, "CHECKOUT_FAILED");
    }

    const origin = safeOrigin();
    try {
      const session = await provider.createCheckoutSession({
        variant,
        externalReference: row.id,
        firstChargeDate: firstChargeDate(sub),
        trialEndsAt: activeTrialEndsAt(sub),
        successUrl: `${origin}/assinatura/sucesso`,
        cancelUrl: `${origin}/assinatura/cancelado`,
        expiredUrl: `${origin}/assinatura/cancelado`,
        minutesToExpire: CHECKOUT_MINUTES,
      });
      await supabaseAdmin
        .from("billing_checkouts")
        .update({ provider_checkout_id: session.providerCheckoutId, checkout_url: session.url })
        .eq("id", row.id);
      await recordAuditEvent(context.supabase, {
        eventType: "checkout_started",
        status: "started",
        metadata: { source: provider.id, operation: variant.planCode },
      });
      return { url: session.url };
    } catch (err) {
      await supabaseAdmin.from("billing_checkouts").update({ status: "failed" }).eq("id", row.id);
      console.error("[billing] checkout falhou", { error_code: err instanceof Error ? err.message.slice(0, 40) : "unknown" });
      throw await fail("CHECKOUT_FAILED", "Não foi possível iniciar a contratação agora. Tente novamente.", 502, "CHECKOUT_FAILED");
    }
  });

/** Portal hospedado de assinatura ainda não integrado (Asaas não oferece; Stripe: ver docs/BILLING.md). */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    requireProvider();
    throw new AppError({
      code: ERROR_CODES.BILLING_NOT_CONFIGURED,
      status: 501,
      userMessage: "O gerenciamento de cartão ainda não está disponível. Você pode cancelar pela própria tela de assinatura.",
    });
  });

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { requireProvider } = await import("./provider.server");
    const { hasLiveRecurrence, cancelRecurrence } = await import("./billing.server");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    const provider = requireProvider();
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("status, plan_code, provider_customer_id, provider_subscription_id, cancel_at_period_end, trial_ends_at")
      .maybeSingle();
    if (!hasLiveRecurrence(sub ?? null)) {
      throw new AppError({ code: ERROR_CODES.VALIDATION, status: 400, userMessage: "Não há assinatura ativa para cancelar." });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await cancelRecurrence(supabaseAdmin, provider, context.userId, sub!);
    } catch {
      await recordAuditEvent(context.supabase, {
        eventType: "subscription_cancel_scheduled",
        status: "failure",
        metadata: { error_code: "CANCEL_FAILED" },
      });
      throw new AppError({
        code: ERROR_CODES.CHECKOUT_FAILED,
        status: 502,
        userMessage: "Não foi possível cancelar agora. Tente novamente em instantes.",
      });
    }
    await recordAuditEvent(context.supabase, { eventType: "subscription_cancel_scheduled", metadata: { source: provider.id } });
    return { ok: true };
  });
