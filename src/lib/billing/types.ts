// Contratos provider-agnostic de cobrança do AgroIntel.
//
// REGRAS:
// - Módulo PURO: nenhum SDK, nenhuma chamada de rede, nenhum segredo.
// - `subscriptions` é a fonte de verdade comercial. Fluxo:
//   gateway → webhook autenticado → subscriptions → entitlement engine.
// - O frontend nunca ativa assinatura; o redirect de sucesso não é prova de pagamento.

/** Provedores com adapter. Nesta fase, somente Asaas em SANDBOX. */
export const BILLING_PROVIDERS = {
  ASAAS: "asaas",
} as const;

export type BillingProviderId = (typeof BILLING_PROVIDERS)[keyof typeof BILLING_PROVIDERS];

export type BillingInterval = "month" | "year";

/** Métodos de pagamento. Primeira versão: somente cartão recorrente. */
export type BillingMethod = "credit_card";

/**
 * Variante comercial. `planCode` é o valor gravado em `subscriptions.plan_code`.
 * Valores definidos exclusivamente no servidor — o cliente envia só o `planCode`.
 */
export type PlanVariant = {
  planCode: string;
  interval: BillingInterval;
  label: string;
  amountCents: number;
  currency: "BRL";
  /** Exige elegibilidade server-side (Plano Fundador). */
  requiresFounderEligibility: boolean;
  available: boolean;
};

export type CheckoutSession = { url: string; providerCheckoutId: string };

/**
 * Evento normalizado — o resto da aplicação nunca vê nomes de eventos do gateway.
 * Datas em ISO 8601.
 */
export type BillingEvent =
  | { kind: "checkout_paid"; providerCheckoutId: string; providerCustomerId: string | null; occurredAt: string }
  | {
      kind: "checkout_closed";
      providerCheckoutId: string;
      status: "canceled" | "expired";
      occurredAt: string;
    }
  | {
      kind: "payment_confirmed";
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      /** Data de vencimento da cobrança paga — início do período coberto. */
      periodStart: string;
      occurredAt: string;
    }
  | {
      kind: "payment_failed";
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      periodStart: string;
      occurredAt: string;
    }
  | {
      kind: "subscription_ended";
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      occurredAt: string;
    }
  | { kind: "ignored"; occurredAt: string };

export type WebhookVerification =
  | { ok: false; reason: "invalid_signature" | "malformed" }
  | { ok: true; providerEventId: string; eventType: string; event: BillingEvent };

/** Adapter do provedor. SOMENTE ele conhece a API externa. */
export type BillingProvider = {
  id: BillingProviderId;
  createCheckoutSession(args: {
    variant: PlanVariant;
    /** Referência interna opaca (id de `billing_checkouts`), nunca o user_id. */
    externalReference: string;
    /** Data (YYYY-MM-DD) da primeira cobrança — preserva o trial interno. */
    firstChargeDate: string;
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
    minutesToExpire: number;
  }): Promise<CheckoutSession>;
  /** Cancela a recorrência no gateway (cobranças futuras deixam de existir). */
  cancelSubscription(args: { providerSubscriptionId: string }): Promise<void>;
  /** Localiza a assinatura ativa de um cliente (necessário quando o checkout não a informa). */
  findActiveSubscriptionId(args: { providerCustomerId: string }): Promise<string | null>;
  /** Autentica o webhook e normaliza o evento. */
  verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;
  /** O gateway oferece portal hospedado para cartão/faturas? */
  hasCustomerPortal: boolean;
};
