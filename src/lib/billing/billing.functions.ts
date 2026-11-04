// Server functions de cobrança (autenticadas).
//
// SEGURANÇA:
// - Identidade sempre do token (`requireSupabaseAuth`). O cliente envia apenas
//   `planCode`; preço, moeda, ciclo, desconto, trial, Price ID, Customer e status
//   são resolvidos no servidor e qualquer campo extra é descartado.
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
  /** Assinatura contratada aguardando 1ª cobrança (durante o trial interno). */
  recurrenceScheduled: boolean;
  /** Assinatura vinculada e ainda não encerrada (inclui cancelamento agendado). */
  hasSubscription: boolean;
  cancelScheduled: boolean;
  checkoutPending: boolean;
  hasCustomerPortal: boolean;
  /** Plano contratado (para exibição), sem IDs técnicos. */
  planCode: string;
};

const SUB_SELECT =
  "status, plan_code, provider_customer_id, provider_subscription_id, cancel_at_period_end, trial_ends_at, current_period_ends_at";

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
    const { hasLiveRecurrence, hasOpenSubscription } = await import("./billing.server");
    const provider = resolveProvider();

    const [{ data: elig }, { data: sub }] = await Promise.all([
      context.supabase.from("billing_eligibility").select("founder_eligible, consumed_at").maybeSingle(),
      context.supabase.from("subscriptions").select(SUB_SELECT).maybeSingle(),
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
      hasSubscription: hasOpenSubscription(sub ?? null),
      cancelScheduled: hasOpenSubscription(sub ?? null) && sub?.cancel_at_period_end === true,
      checkoutPending,
      hasCustomerPortal: !!provider?.hasCustomerPortal && !!sub?.provider_customer_id,
      planCode: sub?.plan_code ?? "trial",
    };
  });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // Apenas planCode é lido; amount/price/currency/discount/trialDays/customerId são descartados.
  .inputValidator((input: unknown) => ({
    planCode: String((input as { planCode?: unknown } | null)?.planCode ?? "").slice(0, 64),
  }))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    const { findPlanVariant, isFounderEligible } = await import("./plans");
    const { hasOpenSubscription } = await import("./billing.server");
    const { checkoutStrategyForTrial } = await import("./providers/stripe");
    const { ensureSubscription } = await import("@/lib/subscription.server");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    const { checkRateLimit, BILLING_RATE_LIMIT_MESSAGE } = await import("@/lib/rate-limit.server");

    const fail = async (code: string, userMessage: string, status: number, errCode: keyof typeof ERROR_CODES) => {
      await recordAuditEvent(context.supabase, {
        eventType: "checkout_failed",
        status: "blocked",
        metadata: { error_code: code },
      });
      return new AppError({ code: ERROR_CODES[errCode], status, userMessage });
    };

    const limit = await checkRateLimit(context.supabase, "billing_action");
    if (!limit.allowed) {
      throw await fail("BILLING_RATE_LIMITED", BILLING_RATE_LIMIT_MESSAGE, 429, "CHECKOUT_FAILED");
    }

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

    const provider = requireProvider(); // fail-closed (test mode obrigatório)
    await ensureSubscription(context.supabase);
    const { data: sub } = await context.supabase.from("subscriptions").select(SUB_SELECT).maybeSingle();
    if (!sub) throw await fail("NO_SUBSCRIPTION", "Não foi possível iniciar a contratação.", 500, "CHECKOUT_FAILED");
    if (hasOpenSubscription(sub)) {
      throw await fail("ALREADY_SUBSCRIBED", "Você já possui uma assinatura contratada.", 409, "CHECKOUT_FAILED");
    }

    // Price autorizado + validação contra o catálogo (BRL, valor, ciclo, test mode).
    let priceId: string;
    try {
      priceId = await provider.resolvePrice(variant);
    } catch {
      throw await fail("PRICE_MISMATCH", "Este plano não está disponível para contratação agora.", 503, "BILLING_NOT_CONFIGURED");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Customer: reutiliza o persistido; cria uma única vez (Idempotency-Key por usuário
    // + gravação condicional) — nunca aceita customer vindo do navegador.
    let customerId = sub.provider_customer_id;
    if (!customerId) {
      try {
        const created = await provider.createCustomer({ userId: context.userId, email: (context.claims as { email?: string })?.email ?? null });
        await supabaseAdmin
          .from("subscriptions")
          .update({ provider: provider.id, provider_customer_id: created })
          .eq("user_id", context.userId)
          .is("provider_customer_id", null);
        const { data: again } = await supabaseAdmin
          .from("subscriptions")
          .select("provider_customer_id")
          .eq("user_id", context.userId)
          .single();
        customerId = again?.provider_customer_id ?? null;
      } catch {
        customerId = null;
      }
      if (!customerId) throw await fail("CUSTOMER_FAILED", "Não foi possível iniciar a contratação agora. Tente novamente.", 502, "CHECKOUT_FAILED");
    }

    const nowIso = new Date().toISOString();
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
    if (pending) await supabaseAdmin.from("billing_checkouts").update({ status: "canceled" }).eq("id", pending.id);

    const { CHECKOUT_EXPIRES_MINUTES } = await import("./providers/stripe");
    // Regra dos 7 dias: < 49h de trial → modo setup (cartão sem cobrança);
    // a assinatura é criada no servidor após o setup, com o fim original do trial.
    const strategy = checkoutStrategyForTrial(sub);
    const expiresAt = new Date(Date.now() + (CHECKOUT_EXPIRES_MINUTES - 1) * 60_000).toISOString();
    const { data: row, error: insErr } = await supabaseAdmin
      .from("billing_checkouts")
      .insert({ user_id: context.userId, provider: provider.id, plan_code: variant.planCode, status: "pending", mode: strategy.mode, expires_at: expiresAt })
      .select("id")
      .single();
    if (insErr || !row) {
      throw await fail("CONCURRENT_CHECKOUT", "Já existe uma contratação em andamento. Tente novamente em instantes.", 409, "CHECKOUT_FAILED");
    }

    const origin = safeOrigin();
    try {
      const successUrl = `${origin}/assinatura/sucesso`;
      const cancelUrl = `${origin}/assinatura/cancelado`;
      const session =
        strategy.mode === "setup"
          ? await provider.createSetupCheckoutSession({
              customerId,
              checkoutRef: row.id,
              planCode: variant.planCode,
              successUrl,
              cancelUrl,
            })
          : await provider.createCheckoutSession({
              variant,
              priceId,
              customerId,
              checkoutRef: row.id,
              trialEnd: strategy.trialEnd,
              successUrl,
              cancelUrl,
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

/** Customer Portal oficial da Stripe. O customer vem SEMPRE da conta autenticada. */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    const provider = requireProvider();
    const { data: sub } = await context.supabase.from("subscriptions").select("provider_customer_id").maybeSingle();
    if (!sub?.provider_customer_id) {
      throw new AppError({ code: ERROR_CODES.VALIDATION, status: 400, userMessage: "Você ainda não possui assinatura para gerenciar." });
    }
    try {
      const url = await provider.createPortalSession({
        customerId: sub.provider_customer_id,
        returnUrl: `${safeOrigin()}/configuracoes/assinatura`,
      });
      await recordAuditEvent(context.supabase, { eventType: "billing_portal_opened", metadata: { source: provider.id } });
      return { url };
    } catch {
      await recordAuditEvent(context.supabase, {
        eventType: "billing_portal_opened",
        status: "failure",
        metadata: { source: provider.id, error_code: "PORTAL_FAILED" },
      });
      throw new AppError({ code: ERROR_CODES.CHECKOUT_FAILED, status: 502, userMessage: "Não foi possível abrir o gerenciamento agora. Tente novamente." });
    }
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setCancel(context: { supabase: any; userId: string }, cancel: boolean) {
  const { requireProvider } = await import("./provider.server");
  const { hasOpenSubscription, persistCancelFlag } = await import("./billing.server");
  const { recordAuditEvent } = await import("@/lib/audit.server");
  const { AppError, ERROR_CODES } = await import("@/lib/errors");
  const provider = requireProvider();
  const { data: sub } = await context.supabase.from("subscriptions").select(SUB_SELECT).maybeSingle();
  if (!hasOpenSubscription(sub ?? null) || (cancel && sub.cancel_at_period_end) || (!cancel && !sub.cancel_at_period_end)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION,
      status: 400,
      userMessage: cancel ? "Não há assinatura ativa para cancelar." : "Não há cancelamento agendado para desfazer.",
    });
  }
  try {
    await provider.setCancelAtPeriodEnd({ providerSubscriptionId: sub.provider_subscription_id, cancel });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await persistCancelFlag(supabaseAdmin, context.userId, cancel);
  } catch {
    await recordAuditEvent(context.supabase, {
      eventType: "subscription_cancel_scheduled",
      status: "failure",
      metadata: { error_code: cancel ? "CANCEL_FAILED" : "RESUME_FAILED" },
    });
    throw new AppError({ code: ERROR_CODES.CHECKOUT_FAILED, status: 502, userMessage: "Não foi possível concluir agora. Tente novamente em instantes." });
  }
  await recordAuditEvent(context.supabase, {
    eventType: "subscription_cancel_scheduled",
    metadata: { source: provider.id, operation: cancel ? "schedule" : "undo" },
  });
  return { ok: true as const };
}

/** Agenda o cancelamento no fim do período (acesso mantido até lá). */
export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => setCancel(context, true));

/** Desfaz o cancelamento agendado (mesma assinatura e mesmo preço; fundador preservado). */
export const resumeMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => setCancel(context, false));
