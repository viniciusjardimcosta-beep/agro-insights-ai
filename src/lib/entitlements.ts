// Núcleo puro de autorização comercial (entitlements) do AgroIntel.
//
// REGRAS:
// - Este módulo é PURO e determinístico: recebe a assinatura e o "agora" do
//   servidor e devolve o acesso. Nunca lê relógio do navegador nem storage.
// - A autorização real acontece server-side (`subscription.server.ts`).
//   O frontend usa este módulo apenas para UX.
// - Nada aqui altera score, fórmulas financeiras ou rate limiting.

/** Duração única e central do teste gratuito. */
export const TRIAL_DAYS = 7;

/** Status canônicos — nunca usar strings soltas na aplicação. */
export const SUBSCRIPTION_STATUS = {
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired",
  INCOMPLETE: "incomplete",
} as const;

export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

/** Códigos técnicos de plano. Preços comerciais NÃO são definidos aqui. */
export const PLAN_CODES = {
  TRIAL: "trial",
  PRO: "pro",
} as const;

export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES];

/** Catálogo central de funcionalidades. */
export const FEATURES = {
  DASHBOARD: "dashboard",
  PROPERTIES: "properties",
  FIELDS: "fields",
  COSTS: "costs",
  PRICES: "prices",
  SETTINGS: "settings",
  ACCOUNT_DATA: "account_data",
  SIMULATOR: "simulator",
  DIAGNOSTIC: "diagnostic",
  AI_CONSULTANT: "ai_consultant",
  INTELLIGENCE: "intelligence",
  ALERTS: "alerts",
  EXECUTIVE_REPORT: "executive_report",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/**
 * Funcionalidades sempre disponíveis, mesmo sem assinatura válida.
 * Direitos LGPD (exportar/excluir) NUNCA dependem de pagamento.
 */
export const BASELINE_FEATURES: readonly Feature[] = [
  FEATURES.DASHBOARD,
  FEATURES.PROPERTIES,
  FEATURES.FIELDS,
  FEATURES.COSTS,
  FEATURES.PRICES,
  FEATURES.SETTINGS,
  FEATURES.ACCOUNT_DATA,
];

/** Funcionalidades comercialmente protegidas nesta sprint. */
export const PREMIUM_FEATURES: readonly Feature[] = [
  FEATURES.SIMULATOR,
  FEATURES.DIAGNOSTIC,
  FEATURES.AI_CONSULTANT,
  FEATURES.INTELLIGENCE,
  FEATURES.ALERTS,
  FEATURES.EXECUTIVE_REPORT,
];

/** Matriz de entitlement por nível de acesso efetivo. */
export const ENTITLEMENT_MATRIX = {
  /** Trial válido ou assinatura ativa: acesso equivalente ao Pro. */
  full: [...BASELINE_FEATURES, ...PREMIUM_FEATURES] as readonly Feature[],
  /** Sem assinatura válida: apenas o essencial (inclui direitos LGPD). */
  baseline: BASELINE_FEATURES,
} as const;

export type AccessLevel = keyof typeof ENTITLEMENT_MATRIX;

/** Linha da assinatura (apenas os campos usados na autorização). */
export type SubscriptionRow = {
  plan_code: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_started_at: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
};

/**
 * Estado da assinatura exposto ao frontend.
 * NÃO contém provider IDs — são internos e não interessam ao titular.
 */
export type SubscriptionAccess = {
  planCode: string;
  /** Status gravado no banco. */
  status: SubscriptionStatus;
  /** Status efetivo considerando `serverNow` (trial vencido vira `expired`). */
  effectiveStatus: SubscriptionStatus;
  accessLevel: AccessLevel;
  isTrial: boolean;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** Dias inteiros restantes de trial (0 quando expirado). */
  trialDaysRemaining: number;
  features: readonly Feature[];
  /** Sempre gerado pelo servidor: o frontend não é fonte de verdade do tempo. */
  serverNow: string;
};

const MS_DAY = 24 * 60 * 60 * 1000;

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

function isStatus(value: string): value is SubscriptionStatus {
  return (Object.values(SUBSCRIPTION_STATUS) as string[]).includes(value);
}

/**
 * Deriva o acesso efetivo. A expiração é calculada por comparação de data —
 * não depende de cron: `trial_ends_at <= now` já nega acesso.
 */
export function computeAccess(
  sub: SubscriptionRow | null,
  now: Date = new Date(),
): SubscriptionAccess {
  const nowMs = now.getTime();
  const serverNow = new Date(nowMs).toISOString();

  if (!sub) {
    return {
      planCode: PLAN_CODES.TRIAL,
      status: SUBSCRIPTION_STATUS.EXPIRED,
      effectiveStatus: SUBSCRIPTION_STATUS.EXPIRED,
      accessLevel: "baseline",
      isTrial: false,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      trialDaysRemaining: 0,
      features: ENTITLEMENT_MATRIX.baseline,
      serverNow,
    };
  }

  const status: SubscriptionStatus = isStatus(sub.status)
    ? sub.status
    : SUBSCRIPTION_STATUS.EXPIRED;

  const trialEnd = time(sub.trial_ends_at);
  const periodEnd = time(sub.current_period_ends_at);

  const trialValid =
    status === SUBSCRIPTION_STATUS.TRIALING && trialEnd !== null && nowMs < trialEnd;

  // `active` e `past_due`/`canceled` com período pago em curso mantêm acesso
  // até o fim do período contratado.
  const periodValid =
    (status === SUBSCRIPTION_STATUS.ACTIVE ||
      status === SUBSCRIPTION_STATUS.PAST_DUE ||
      status === SUBSCRIPTION_STATUS.CANCELED) &&
    periodEnd !== null &&
    nowMs < periodEnd;

  const hasAccess = trialValid || periodValid;

  let effectiveStatus: SubscriptionStatus = status;
  if (!hasAccess) {
    effectiveStatus =
      status === SUBSCRIPTION_STATUS.TRIALING
        ? SUBSCRIPTION_STATUS.EXPIRED
        : status === SUBSCRIPTION_STATUS.ACTIVE || status === SUBSCRIPTION_STATUS.PAST_DUE
          ? SUBSCRIPTION_STATUS.EXPIRED
          : status;
  }

  const trialDaysRemaining =
    trialValid && trialEnd !== null ? Math.max(0, Math.ceil((trialEnd - nowMs) / MS_DAY)) : 0;

  return {
    planCode: sub.plan_code,
    status,
    effectiveStatus,
    accessLevel: hasAccess ? "full" : "baseline",
    isTrial: trialValid,
    trialEndsAt: sub.trial_ends_at,
    currentPeriodEndsAt: sub.current_period_ends_at,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    trialDaysRemaining,
    features: hasAccess ? ENTITLEMENT_MATRIX.full : ENTITLEMENT_MATRIX.baseline,
    serverNow,
  };
}

/** O acesso derivado permite usar a funcionalidade? */
export function hasEntitlement(access: SubscriptionAccess, feature: Feature): boolean {
  return access.features.includes(feature);
}

export function isPremiumFeature(feature: Feature): boolean {
  return PREMIUM_FEATURES.includes(feature);
}

/** Motivo comercial do bloqueio, para erro estruturado. */
export type BlockedReason = "TRIAL_EXPIRED" | "SUBSCRIPTION_INACTIVE" | "SUBSCRIPTION_REQUIRED";

export function blockedReason(access: SubscriptionAccess): BlockedReason {
  if (access.status === SUBSCRIPTION_STATUS.TRIALING) return "TRIAL_EXPIRED";
  if (
    access.status === SUBSCRIPTION_STATUS.CANCELED ||
    access.status === SUBSCRIPTION_STATUS.PAST_DUE ||
    access.status === SUBSCRIPTION_STATUS.EXPIRED ||
    access.status === SUBSCRIPTION_STATUS.ACTIVE
  ) {
    return "SUBSCRIPTION_INACTIVE";
  }
  return "SUBSCRIPTION_REQUIRED";
}

/** Mensagem PT-BR adequada ao motivo do bloqueio. Nunca expõe detalhes internos. */
export function blockedMessage(access: SubscriptionAccess): string {
  switch (blockedReason(access)) {
    case "TRIAL_EXPIRED":
      return "Seu período de teste terminou. Escolha um plano para continuar usando este recurso.";
    case "SUBSCRIPTION_INACTIVE":
      return access.status === SUBSCRIPTION_STATUS.PAST_DUE
        ? "Sua assinatura está com pendência. Regularize para continuar usando este recurso."
        : "Sua assinatura não está ativa. Escolha um plano para continuar usando este recurso.";
    default:
      return "Este recurso faz parte do plano. Escolha um plano para continuar.";
  }
}
