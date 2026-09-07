// Guard comercial reutilizável (puro, cliente + servidor).
//
// REGRAS:
// - Fonte de verdade única: `subscriptions` + entitlement engine.
//   Nada de localStorage, cookie, flag em profiles ou novo status comercial.
// - No servidor, a autoridade é `requireEntitlement()` (subscription.server.ts).
// - No cliente, este helper protege operações que executam localmente
//   (ex.: geração do PDF), para que esconder o botão nunca seja a única barreira.

import {
  blockedMessage,
  blockedReason,
  hasEntitlement,
  type Feature,
  type SubscriptionAccess,
} from "@/lib/entitlements";
import { AppError, ERROR_CODES } from "@/lib/errors";

/** Lança AppError comercial (402) quando não há entitlement. Não consome rate limit. */
export function assertEntitlement(
  access: SubscriptionAccess | null | undefined,
  feature: Feature,
): SubscriptionAccess {
  if (access && hasEntitlement(access, feature)) return access;

  if (!access) {
    throw new AppError({
      code: ERROR_CODES.SUBSCRIPTION_REQUIRED,
      status: 402,
      userMessage: "Assinatura necessária para usar este recurso.",
    });
  }

  const reason = blockedReason(access);
  throw new AppError({
    code: ERROR_CODES[reason],
    status: 402,
    userMessage: blockedMessage(access),
  });
}

/** Versão booleana, para UI. Nunca substitui `assertEntitlement`. */
export function canUse(
  access: SubscriptionAccess | null | undefined,
  feature: Feature,
): boolean {
  return !!access && hasEntitlement(access, feature);
}
