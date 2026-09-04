import { describe, it, expect } from "vitest";
import {
  BASELINE_FEATURES,
  FEATURES,
  PREMIUM_FEATURES,
  SUBSCRIPTION_STATUS,
  TRIAL_DAYS,
  blockedMessage,
  blockedReason,
  computeAccess,
  hasEntitlement,
  type SubscriptionRow,
} from "@/lib/entitlements";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-10T12:00:00.000Z");

function trialRow(endsAt: Date, startedAt = new Date(endsAt.getTime() - TRIAL_DAYS * DAY)): SubscriptionRow {
  return {
    plan_code: "trial",
    status: SUBSCRIPTION_STATUS.TRIALING,
    trial_started_at: startedAt.toISOString(),
    trial_ends_at: endsAt.toISOString(),
    current_period_started_at: startedAt.toISOString(),
    current_period_ends_at: endsAt.toISOString(),
    cancel_at_period_end: false,
    canceled_at: null,
  };
}

describe("trial", () => {
  it("dura 7 dias e é centralizado em TRIAL_DAYS", () => {
    expect(TRIAL_DAYS).toBe(7);
    const start = NOW;
    const end = new Date(start.getTime() + TRIAL_DAYS * DAY);
    const access = computeAccess(trialRow(end, start), NOW);
    expect(access.trialDaysRemaining).toBe(7);
    expect(access.accessLevel).toBe("full");
  });

  it("trial_ends_at no futuro libera recursos premium", () => {
    const access = computeAccess(trialRow(new Date(NOW.getTime() + 3 * DAY)), NOW);
    expect(access.isTrial).toBe(true);
    expect(access.trialDaysRemaining).toBe(3);
    for (const f of PREMIUM_FEATURES) expect(hasEntitlement(access, f)).toBe(true);
  });

  it("trial_ends_at exatamente agora já bloqueia (sem cron)", () => {
    const access = computeAccess(trialRow(NOW), NOW);
    expect(access.accessLevel).toBe("baseline");
    expect(access.effectiveStatus).toBe(SUBSCRIPTION_STATUS.EXPIRED);
    expect(access.status).toBe(SUBSCRIPTION_STATUS.TRIALING);
    expect(hasEntitlement(access, FEATURES.AI_CONSULTANT)).toBe(false);
  });

  it("trial_ends_at no passado bloqueia mesmo com status ainda gravado como trialing", () => {
    const access = computeAccess(trialRow(new Date(NOW.getTime() - 1000)), NOW);
    expect(access.accessLevel).toBe("baseline");
    expect(access.trialDaysRemaining).toBe(0);
    expect(blockedReason(access)).toBe("TRIAL_EXPIRED");
    expect(blockedMessage(access)).toContain("período de teste terminou");
  });

  it("usa UTC/timestamptz sem depender do fuso do ambiente", () => {
    const end = new Date("2026-05-11T00:00:00.000Z");
    expect(computeAccess(trialRow(end), new Date("2026-05-10T23:59:59.000Z")).accessLevel).toBe("full");
    expect(computeAccess(trialRow(end), new Date("2026-05-11T00:00:01.000Z")).accessLevel).toBe("baseline");
  });
});

describe("matriz de entitlement", () => {
  it("sem assinatura: apenas recursos básicos", () => {
    const access = computeAccess(null, NOW);
    expect(access.accessLevel).toBe("baseline");
    for (const f of BASELINE_FEATURES) expect(hasEntitlement(access, f)).toBe(true);
    for (const f of PREMIUM_FEATURES) expect(hasEntitlement(access, f)).toBe(false);
  });

  it("usuário expirado mantém Configurações, exportação e exclusão (LGPD)", () => {
    const access = computeAccess(trialRow(new Date(NOW.getTime() - 10 * DAY)), NOW);
    expect(hasEntitlement(access, FEATURES.SETTINGS)).toBe(true);
    expect(hasEntitlement(access, FEATURES.ACCOUNT_DATA)).toBe(true);
    expect(hasEntitlement(access, FEATURES.PROPERTIES)).toBe(true);
  });

  it("assinatura ativa dentro do período libera tudo", () => {
    const access = computeAccess(
      {
        plan_code: "pro",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_started_at: new Date(NOW.getTime() - DAY).toISOString(),
        current_period_ends_at: new Date(NOW.getTime() + 20 * DAY).toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
      },
      NOW,
    );
    expect(access.accessLevel).toBe("full");
    expect(access.isTrial).toBe(false);
    expect(access.planCode).toBe("pro");
  });

  it("assinatura ativa com período vencido perde premium", () => {
    const access = computeAccess(
      {
        plan_code: "pro",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_started_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
        current_period_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
      },
      NOW,
    );
    expect(access.accessLevel).toBe("baseline");
    expect(blockedReason(access)).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("cancelado com período em curso mantém acesso até o fim", () => {
    const access = computeAccess(
      {
        plan_code: "pro",
        status: SUBSCRIPTION_STATUS.CANCELED,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_started_at: new Date(NOW.getTime() - DAY).toISOString(),
        current_period_ends_at: new Date(NOW.getTime() + 5 * DAY).toISOString(),
        cancel_at_period_end: true,
        canceled_at: new Date(NOW.getTime() - DAY).toISOString(),
      },
      NOW,
    );
    expect(access.accessLevel).toBe("full");
    expect(access.cancelAtPeriodEnd).toBe(true);
  });

  it("status desconhecido é tratado como sem acesso", () => {
    const access = computeAccess({ ...trialRow(new Date(NOW.getTime() + DAY)), status: "hacked" }, NOW);
    expect(access.accessLevel).toBe("baseline");
  });

  it("nunca expõe provider IDs no estado enviado ao frontend", () => {
    const access = computeAccess(trialRow(new Date(NOW.getTime() + DAY)), NOW);
    const keys = Object.keys(access).join(",");
    expect(keys).not.toContain("provider");
    expect(access.serverNow).toBe(NOW.toISOString());
  });
});
