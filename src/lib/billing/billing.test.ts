import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PLAN_CATALOG,
  addInterval,
  annualSavingsCents,
  findPlanVariant,
  formatBRL,
  isFounderEligible,
} from "./plans";
import { mapProviderStatus, shouldApplyUpdate } from "./status";
import { reconcile, type SubState } from "./reconcile";
import { asaasDateToIso, buildCheckoutBody, normalizeAsaasEvent, tokensMatch } from "./providers/asaas";
import { readAsaasConfig } from "./providers/asaas.server";
import { resolveProvider } from "./provider.server";
import { firstChargeDate, hasLiveRecurrence } from "./billing.server";
import { TRIAL_DAYS } from "@/lib/entitlements";

const base: SubState = {
  status: "trialing",
  plan_code: "pro_monthly",
  provider_customer_id: "cus_A",
  provider_subscription_id: null,
  current_period_ends_at: null,
  cancel_at_period_end: false,
  updated_at: "2026-10-01T00:00:00.000Z",
};
const paid = (over: Partial<Extract<Parameters<typeof reconcile>[1], { kind: "payment_confirmed" }>> = {}) => ({
  kind: "payment_confirmed" as const,
  providerCustomerId: "cus_A",
  providerSubscriptionId: "sub_A",
  periodStart: "2026-10-08T03:00:00.000Z",
  occurredAt: "2026-10-08T12:00:00.000Z",
  ...over,
});

describe("catálogo", () => {
  it("R$99,90 / R$999,00 / R$69,90 definidos no servidor", () => {
    expect(findPlanVariant("pro_monthly")?.amountCents).toBe(9990);
    expect(findPlanVariant("pro_yearly")?.amountCents).toBe(99900);
    expect(findPlanVariant("pro_founder_monthly")?.amountCents).toBe(6990);
    expect(PLAN_CATALOG).toHaveLength(3);
  });
  it("economia anual exata R$199,80", () => {
    expect(annualSavingsCents()).toBe(19980);
    expect(formatBRL(19980).replace(/\s/g, " ")).toContain("199,80");
  });
  it("plan_code arbitrário / price ID / valor são rejeitados", () => {
    expect(findPlanVariant("price_123")).toBeNull();
    expect(findPlanVariant("9.90")).toBeNull();
    expect(findPlanVariant("PRO_MONTHLY")).toBeNull();
  });
  it("trial continua 7 dias", () => expect(TRIAL_DAYS).toBe(7));
  it("addInterval mensal e anual", () => {
    expect(addInterval("2026-01-31T03:00:00.000Z", "year")).toBe("2027-01-31T03:00:00.000Z");
    expect(addInterval("2026-10-08T03:00:00.000Z", "month")).toBe("2026-11-08T03:00:00.000Z");
  });
});

describe("fundador", () => {
  it("elegível apenas se concedido e não consumido", () => {
    expect(isFounderEligible(null)).toBe(false);
    expect(isFounderEligible({ founder_eligible: false, consumed_at: null })).toBe(false);
    expect(isFounderEligible({ founder_eligible: true, consumed_at: null })).toBe(true);
    expect(isFounderEligible({ founder_eligible: true, consumed_at: "2026-01-01" })).toBe(false);
  });
  it("primeira ativação consome a elegibilidade", () => {
    const r = reconcile({ ...base, plan_code: "pro_founder_monthly" }, paid());
    expect(r.audit).toBe("subscription_activated");
    expect(r.consumeFounder).toBe(true);
  });
  it("renovação mantém founder sem depender de elegibilidade", () => {
    const active: SubState = {
      ...base,
      status: "active",
      plan_code: "pro_founder_monthly",
      provider_subscription_id: "sub_A",
      current_period_ends_at: "2026-11-08T03:00:00.000Z",
    };
    const r = reconcile(active, paid({ periodStart: "2026-11-08T03:00:00.000Z", occurredAt: "2026-11-08T12:00:00.000Z" }));
    expect(r.audit).toBe("subscription_renewed");
    expect(r.consumeFounder).toBe(false);
    expect(r.patch?.current_period_ends_at).toBe("2026-12-08T03:00:00.000Z");
    expect(r.patch).not.toHaveProperty("plan_code");
  });
});

describe("reconciliação", () => {
  it("pagamento confirmado ativa", () => {
    const r = reconcile(base, paid());
    expect(r.patch?.status).toBe("active");
    expect(r.patch?.provider_subscription_id).toBe("sub_A");
  });
  it("duplicado do mesmo período não renova duas vezes", () => {
    const after = { ...base, status: "active", provider_subscription_id: "sub_A", current_period_ends_at: "2026-11-08T03:00:00.000Z" };
    expect(reconcile(after, paid()).patch).toBeNull();
  });
  it("evento antigo fora de ordem não sobrescreve período mais novo", () => {
    const after = { ...base, status: "active", provider_subscription_id: "sub_A", current_period_ends_at: "2026-12-08T03:00:00.000Z" };
    expect(reconcile(after, paid()).patch).toBeNull();
    expect(reconcile(after, { ...paid(), kind: "payment_failed" }).patch).toBeNull();
  });
  it("cobrança de outra assinatura não altera usuário", () => {
    const s = { ...base, provider_subscription_id: "sub_B" };
    expect(reconcile(s, paid()).patch).toBeNull();
  });
  it("falha de pagamento → past_due + payment_failed", () => {
    const active = { ...base, status: "active", provider_subscription_id: "sub_A", current_period_ends_at: "2026-11-08T03:00:00.000Z" };
    const r = reconcile(active, { ...paid({ periodStart: "2026-11-08T03:00:00.000Z" }), kind: "payment_failed" });
    expect(r.patch?.status).toBe("past_due");
    expect(r.audit).toBe("payment_failed");
  });
  it("cancelamento mantém período pago", () => {
    const active = { ...base, status: "active", provider_subscription_id: "sub_A", current_period_ends_at: "2026-11-08T03:00:00.000Z" };
    const r = reconcile(active, { kind: "subscription_ended", providerCustomerId: "cus_A", providerSubscriptionId: "sub_A", occurredAt: "2026-10-20T00:00:00.000Z" });
    expect(r.patch).toEqual({ status: "canceled", cancel_at_period_end: true, canceled_at: "2026-10-20T00:00:00.000Z" });
    expect(reconcile({ ...active, status: "canceled" }, { kind: "subscription_ended", providerCustomerId: "cus_A", providerSubscriptionId: "sub_A", occurredAt: "x" }).patch).toBeNull();
  });
  it("encerramento durante o trial não derruba o trial interno", () => {
    const r = reconcile({ ...base, provider_subscription_id: "sub_A" }, { kind: "subscription_ended", providerCustomerId: "cus_A", providerSubscriptionId: "sub_A", occurredAt: "2026-10-03T00:00:00.000Z" });
    expect(r.patch).not.toHaveProperty("status");
    expect(r.patch?.cancel_at_period_end).toBe(true);
  });
  it("status desconhecido nunca libera acesso", () => {
    expect(mapProviderStatus("whatever")).toBe("incomplete");
    expect(shouldApplyUpdate({ currentPeriodEndsAt: null, currentUpdatedAt: null, incomingPeriodEndsAt: null, incomingOccurredAt: "2026-01-01" })).toBe(true);
  });
});

describe("adapter Asaas (puro)", () => {
  it("checkout: cartão recorrente, ciclo correto e 1ª cobrança no fim do trial", () => {
    const b = buildCheckoutBody({
      variant: findPlanVariant("pro_yearly")!,
      externalReference: "ref",
      firstChargeDate: "2026-10-09",
      successUrl: "s",
      cancelUrl: "c",
      expiredUrl: "e",
      minutesToExpire: 30,
    });
    expect(b.billingTypes).toEqual(["CREDIT_CARD"]);
    expect(b.chargeTypes).toEqual(["RECURRENT"]);
    expect(b.subscription).toEqual({ cycle: "YEARLY", nextDueDate: "2026-10-09 00:00:00" });
    expect(b.items[0]!.value).toBe(999);
  });
  it("firstChargeDate preserva trial (sem trial duplo)", () => {
    const now = new Date("2026-10-02T15:00:00Z");
    expect(firstChargeDate({ status: "trialing", trial_ends_at: "2026-10-09T15:00:00Z" }, now)).toBe("2026-10-09");
    expect(firstChargeDate({ status: "trialing", trial_ends_at: "2026-10-01T15:00:00Z" }, now)).toBe("2026-10-02");
    expect(firstChargeDate({ status: "expired", trial_ends_at: null }, now)).toBe("2026-10-02");
  });
  it("token do webhook: ausente/errado rejeitado", () => {
    expect(tokensMatch(null, "abc")).toBe(false);
    expect(tokensMatch("abd", "abc")).toBe(false);
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "")).toBe(false);
  });
  it("normaliza eventos e ignora metadata.user_id", () => {
    const e = normalizeAsaasEvent({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-10-08 10:00:00",
      payment: { customer: "cus_A", subscription: "sub_A", dueDate: "2026-10-08", metadata: { user_id: "hacker" } },
    });
    expect(e).toMatchObject({ kind: "payment_confirmed", providerCustomerId: "cus_A", providerSubscriptionId: "sub_A" });
    expect(JSON.stringify(e)).not.toContain("hacker");
    expect(normalizeAsaasEvent({ event: "PAYMENT_CONFIRMED", payment: { customer: "x" } }).kind).toBe("ignored");
    expect(normalizeAsaasEvent({ event: "CHECKOUT_PAID", checkout: { id: "co", customer: "cus" } }).kind).toBe("checkout_paid");
    expect(normalizeAsaasEvent({ event: "SUBSCRIPTION_DELETED", subscription: { id: "sub" } }).kind).toBe("subscription_ended");
    expect(asaasDateToIso("2026-10-08 10:00:00")).toBe("2026-10-08T13:00:00.000Z");
  });
});

describe("fail-closed", () => {
  it("sem sandbox ou sem secrets não há provedor", () => {
    expect(readAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t" })).toBeNull();
    expect(readAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "", ASAAS_WEBHOOK_TOKEN: "t" })).toBeNull();
    expect(resolveProvider({ BILLING_PROVIDER: "stripe", ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t" })).toBeNull();
    expect(resolveProvider({ BILLING_PROVIDER: "asaas", ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t" })?.id).toBe("asaas");
  });
  it("nenhuma URL de produção do Asaas no código", () => {
    const src = readFileSync(join(__dirname, "providers/asaas.ts"), "utf8") + readFileSync(join(__dirname, "providers/asaas.server.ts"), "utf8");
    expect(src).not.toMatch(/https:\/\/api\.asaas\.com/);
  });
});

describe("exclusão de conta com cobrança", () => {
  it("recorrência viva exige cancelamento antes de excluir", () => {
    const row = { status: "active", plan_code: "pro_monthly", provider_customer_id: "cus", provider_subscription_id: "sub", cancel_at_period_end: false, trial_ends_at: null };
    expect(hasLiveRecurrence(row)).toBe(true);
    expect(hasLiveRecurrence({ ...row, cancel_at_period_end: true })).toBe(false);
    expect(hasLiveRecurrence({ ...row, provider_customer_id: null })).toBe(false);
    expect(hasLiveRecurrence({ ...row, status: "expired" })).toBe(false);
  });
  it("deleteMyAccount aborta quando o cancelamento não é confirmado", () => {
    const src = readFileSync(join(__dirname, "../account.functions.ts"), "utf8");
    expect(src).toContain("Sua conta não foi excluída para evitar uma cobrança futura.");
    expect(src.indexOf("cancelRecurrence")).toBeLessThan(src.indexOf("deleteUser"));
  });
});

describe("segredos fora do cliente", () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  it("nenhum VITE_ para segredos de cobrança e adapters são *.server.ts", () => {
    const files = walk(join(__dirname, "../..")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/VITE_(ASAAS|BILLING|SUPABASE_SERVICE)/);
      if (/ASAAS_API_KEY|ASAAS_WEBHOOK_TOKEN/.test(s) && !f.includes("/routes/api/")) {
        expect(f.endsWith(".server.ts")).toBe(true);
      }
    }
  });
});
