// Server functions de cobrança (autenticadas).
//
// SEGURANÇA:
// - Identidade sempre do token validado (`requireSupabaseAuth`); o cliente
//   nunca envia user_id, email, customer_id, price, amount, moeda, desconto,
//   trial ou status.
// - O plano é resolvido no catálogo server-side a partir de um `planKey`.
// - Enquanto nenhum gateway estiver configurado, todas falham com
//   BILLING_NOT_CONFIGURED — não há checkout falso.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillingStatusInfo = {
  configured: boolean;
  /** Variantes que já podem ser contratadas (vazio até definição comercial). */
  plans: { key: string; label: string; interval: string; amountCents: number | null }[];
};

/** Estado da cobrança para a UI decidir entre "Ver planos" e "Assinar". */
export const getBillingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BillingStatusInfo> => {
    const { isBillingConfigured } = await import("./provider.server");
    const { availablePlanVariants } = await import("./plans");
    const configured = isBillingConfigured();
    return {
      configured,
      plans: configured
        ? availablePlanVariants().map((v) => ({
            key: v.key,
            label: v.label,
            interval: v.interval,
            amountCents: v.amountCents,
          }))
        : [],
    };
  });

/** Inicia o checkout do plano escolhido. Retorna apenas a URL do provedor. */
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { planKey: string }) => ({ planKey: String(input?.planKey ?? "") }))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    const { findPlanVariant } = await import("./plans");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { AppError, ERROR_CODES } = await import("@/lib/errors");

    const variant = findPlanVariant(data.planKey);
    if (!variant || !variant.available || !variant.providerPriceId) {
      await recordAuditEvent(context.supabase, {
        eventType: "checkout_failed",
        status: "blocked",
        metadata: { error_code: "INVALID_PLAN" },
      });
      throw new AppError({
        code: ERROR_CODES.INVALID_PLAN,
        status: 400,
        userMessage: "Este plano não está disponível para contratação.",
      });
    }

    // requireProvider() lança BILLING_NOT_CONFIGURED enquanto não houver gateway.
    requireProvider();
    throw new AppError({
      code: ERROR_CODES.CHECKOUT_FAILED,
      status: 503,
      userMessage: "Não foi possível iniciar a contratação agora. Tente novamente mais tarde.",
    });
  });

/** Abre o portal oficial do provedor (cartão, faturas, cancelamento). */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ url: string }> => {
    const { requireProvider } = await import("./provider.server");
    requireProvider();
    throw new Error("unreachable");
  });

/** Agenda o cancelamento para o fim do período pago. */
export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ cancelAtPeriodEnd: boolean }> => {
    const { requireProvider } = await import("./provider.server");
    requireProvider();
    throw new Error("unreachable");
  });
