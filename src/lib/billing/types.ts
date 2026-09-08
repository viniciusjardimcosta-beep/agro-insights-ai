// Contratos provider-agnostic de cobrança do AgroIntel.
//
// REGRAS:
// - Este módulo é PURO: nenhum SDK, nenhuma chamada de rede, nenhum segredo.
// - `subscriptions` continua sendo a fonte de verdade comercial. O gateway
//   nunca decide acesso diretamente: gateway → webhook autenticado →
//   subscriptions → entitlement engine → recursos premium.
// - Nada aqui altera score, fórmulas financeiras, diagnóstico, simulador,
//   inteligência, alertas, rate limits ou o trial de 7 dias.
import type { PlanCode, SubscriptionStatus } from "@/lib/entitlements";

/** Provedores tecnicamente compatíveis com esta arquitetura. Nenhum está escolhido. */
export const BILLING_PROVIDERS = {
  STRIPE: "stripe",
  MERCADO_PAGO: "mercado_pago",
  PAGARME: "pagarme",
  ASAAS: "asaas",
} as const;

export type BillingProviderId = (typeof BILLING_PROVIDERS)[keyof typeof BILLING_PROVIDERS];

/** Ciclo de cobrança de uma variante comercial. */
export type BillingInterval = "month" | "year";

/**
 * Variante comercial de um plano.
 *
 * `providerPriceId` NUNCA é enviado pelo cliente: é resolvido server-side a
 * partir do catálogo. Enquanto não houver preço aprovado, a variante fica
 * `available: false` e sem `providerPriceId`.
 */
export type PlanVariant = {
  /** Chave interna estável usada pelo frontend (ex.: "pro_monthly"). */
  key: string;
  planCode: PlanCode;
  interval: BillingInterval;
  label: string;
  /** Preço comercial ainda não definido → `null`. Nunca inventar valor. */
  amountCents: number | null;
  currency: "BRL";
  /** ID de preço no provedor — só existe quando o gateway estiver configurado. */
  providerPriceId: string | null;
  /** Só pode iniciar checkout quando `true`. */
  available: boolean;
};

export type CheckoutSession = {
  /** URL para onde o navegador deve ser redirecionado. */
  url: string;
  /** Identificador da sessão no provedor (uso interno/auditoria). */
  providerSessionId: string;
};

export type PortalSession = { url: string };

export type CancelResult = {
  /** `true` quando o acesso permanece até o fim do período pago. */
  cancelAtPeriodEnd: boolean;
  currentPeriodEndsAt: string | null;
};

/** Dados normalizados que um webhook validado pode aplicar em `subscriptions`. */
export type NormalizedSubscriptionUpdate = {
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  /** Momento do evento no provedor — usado para descartar eventos atrasados. */
  occurredAt: string;
};

/** Resultado da verificação + normalização de um webhook. */
export type WebhookVerification =
  | { ok: false; reason: "invalid_signature" | "unsupported_event" | "malformed" }
  | {
      ok: true;
      providerEventId: string;
      eventType: string;
      /** Ausente quando o evento não altera assinatura (ex.: ping). */
      update: NormalizedSubscriptionUpdate | null;
      /** Evento de falha de pagamento, para auditoria específica. */
      paymentFailed: boolean;
    };

/**
 * Adapter do provedor. SOMENTE o adapter conhece o SDK/API externo;
 * o resto da aplicação fala apenas esta interface.
 */
export type BillingProvider = {
  id: BillingProviderId;
  createCheckoutSession(args: {
    userId: string;
    email: string;
    variant: PlanVariant;
    providerCustomerId: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createCustomerPortalSession(args: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<PortalSession>;
  cancelSubscription(args: {
    providerSubscriptionId: string;
    atPeriodEnd: boolean;
  }): Promise<CancelResult>;
  /** Valida criptograficamente a assinatura do webhook e normaliza o evento. */
  verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;
  /** Traduz o status bruto do provedor para o status canônico interno. */
  mapProviderStatus(raw: string): SubscriptionStatus;
};
