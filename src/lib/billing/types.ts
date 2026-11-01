// Contratos provider-agnostic de cobrança do AgroIntel.
//
// REGRAS:
// - Módulo PURO: nenhum SDK, nenhuma chamada de rede, nenhum segredo.
// - `subscriptions` é a fonte de verdade comercial. Fluxo:
//   gateway → webhook autenticado → subscriptions → entitlement engine.
// - O frontend nunca ativa assinatura; o redirect de sucesso não é prova de pagamento.

/** Provedores com adapter. Nesta fase, somente Stripe em TEST MODE. */
export const BILLING_PROVIDERS = {
  STRIPE: "stripe",
} as const;

export type BillingProviderId = (typeof BILLING_PROVIDERS)[keyof typeof BILLING_PROVIDERS];

export type BillingInterval = "month" | "year";

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

/** Estado autoritativo de uma assinatura, buscado no gateway pelo ID persistido. */
export type SubscriptionSnapshot = {
  providerSubscriptionId: string;
  providerCustomerId: string;
  /** Status bruto do gateway (ex.: trialing, active, past_due, canceled). */
  providerStatus: string;
  /** plan_code resolvido pelo Price ID autorizado (null = preço desconhecido). */
  planCode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  livemode: boolean;
};

export type WebhookVerification =
  | { ok: false; reason: "invalid_signature" | "malformed" | "live_mode" }
  | {
      ok: true;
      providerEventId: string;
      eventType: string;
      checkoutSessionId: string | null;
      subscriptionId: string | null;
      customerId: string | null;
    };

/** Adapter do provedor. SOMENTE ele conhece a API externa. */
export type BillingProvider = {
  id: BillingProviderId;
  hasCustomerPortal: boolean;
  /** Cria o Customer no gateway (idempotente por usuário). */
  createCustomer(args: { userId: string; email: string | null }): Promise<string>;
  /** Valida o Price configurado contra o catálogo e devolve o Price ID autorizado. */
  resolvePrice(variant: PlanVariant): Promise<string>;
  planCodeForPrice(priceId: string): string | null;
  createCheckoutSession(args: {
    variant: PlanVariant;
    priceId: string;
    customerId: string;
    /** Referência interna opaca (id de `billing_checkouts`), nunca o user_id. */
    checkoutRef: string;
    /** Fim do trial interno (unix) quando deve ser preservado; null = cobra já. */
    trialEnd: number | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<string>;
  /** Agenda (true) ou desfaz (false) o cancelamento no fim do período. */
  setCancelAtPeriodEnd(args: { providerSubscriptionId: string; cancel: boolean }): Promise<SubscriptionSnapshot>;
  /** Encerra IMEDIATAMENTE todas as recorrências do customer (exclusão de conta). Lança se não confirmar. */
  cancelAllImmediately(args: { providerCustomerId: string }): Promise<void>;
  fetchSubscription(providerSubscriptionId: string): Promise<SubscriptionSnapshot | null>;
  /** Autentica o webhook sobre o raw body e extrai somente referências. */
  verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;
};
