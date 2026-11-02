import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLAN_CATALOG, addInterval, annualSavingsCents, findPlanVariant, formatBRL, isFounderEligible } from "./plans";
import { mapProviderStatus } from "./status";
import { mapStripeStatus, reconcile, type SubState } from "./reconcile";
import {
  MIN_TRIAL_SECONDS,
  buildCheckoutParams,
  computeSignature,
  encodeForm,
  extractEventRefs,
  isTestSecretKey,
  priceMatchesVariant,
  subscriptionToSnapshot,
  trialEndForCheckout,
  verifyStripeSignature,
} from "./providers/stripe";
import { readStripeConfig } from "./providers/stripe.server";
import { resolveProvider } from "./provider.server";
import { hasLiveRecurrence, hasOpenSubscription } from "./billing.server";
import { TRIAL_DAYS } from "@/lib/entitlements";
import type { SubscriptionSnapshot } from "./types";

const base: SubState = {
  status: "trialing",
  plan_code: "trial",
  provider_customer_id: "cus_A",
  provider_subscription_id: null,
  current_period_ends_at: null,
  cancel_at_period_end: false,
  updated_at: "2026-10-01T00:00:00.000Z",
};
const snap = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  providerSubscriptionId: "sub_A",
  providerCustomerId: "cus_A",
  providerStatus: "active",
  planCode: "pro_monthly",
  periodStart: "2026-10-08T03:00:00.000Z",
  periodEnd: "2026-11-08T03:00:00.000Z",
  cancelAtPeriodEnd: false,
  canceledAt: null,
  livemode: false,
  ...over,
});
const active: SubState = {
  ...base,
  status: "active",
  plan_code: "pro_monthly",
  provider_subscription_id: "sub_A",
  current_period_ends_at: "2026-11-08T03:00:00.000Z",
};

const ENV_OK = {
  BILLING_PROVIDER: "stripe",
  STRIPE_ENVIRONMENT: "test",
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc",
  STRIPE_PRICE_PRO_MONTHLY: "price_m1",
};

describe("catálogo", () => {
  it("R$99,90 / R$999,00 / R$69,90 em BRL definidos no servidor", () => {
    expect(findPlanVariant("pro_monthly")?.amountCents).toBe(9990);
    expect(findPlanVariant("pro_yearly")?.amountCents).toBe(99900);
    expect(findPlanVariant("pro_founder_monthly")?.amountCents).toBe(6990);
    expect(PLAN_CATALOG.every((p) => p.currency === "BRL")).toBe(true);
    expect(PLAN_CATALOG).toHaveLength(3);
  });
  it("economia anual exata R$199,80", () => {
    expect(annualSavingsCents()).toBe(19980);
    expect(formatBRL(19980).replace(/\s/g, " ")).toContain("199,80");
  });
  it("plan_code arbitrário / Price ID / valor são rejeitados", () => {
    expect(findPlanVariant("price_123")).toBeNull();
    expect(findPlanVariant("9.90")).toBeNull();
    expect(findPlanVariant("PRO_MONTHLY")).toBeNull();
  });
  it("trial continua 7 dias", () => expect(TRIAL_DAYS).toBe(7));
  it("addInterval mensal e anual", () => {
    expect(addInterval("2026-10-08T03:00:00.000Z", "month")).toBe("2026-11-08T03:00:00.000Z");
  });
});

describe("Price Stripe x catálogo (fail-closed)", () => {
  const v = findPlanVariant("pro_monthly")!;
  const ok = { active: true, livemode: false, type: "recurring", currency: "brl", unit_amount: 9990, recurring: { interval: "month", interval_count: 1, trial_period_days: null } };
  it("price correto é aceito", () => expect(priceMatchesVariant(ok, v)).toBe(true));
  it("valor, moeda, ciclo, live ou trial do Price divergentes são recusados", () => {
    expect(priceMatchesVariant({ ...ok, unit_amount: 100 }, v)).toBe(false);
    expect(priceMatchesVariant({ ...ok, currency: "usd" }, v)).toBe(false);
    expect(priceMatchesVariant({ ...ok, recurring: { interval: "year" } }, v)).toBe(false);
    expect(priceMatchesVariant({ ...ok, livemode: true }, v)).toBe(false);
    expect(priceMatchesVariant({ ...ok, active: false }, v)).toBe(false);
    expect(priceMatchesVariant({ ...ok, recurring: { interval: "month", trial_period_days: 7 } }, v)).toBe(false);
  });
  it("anual e fundador conferem com R$999/ano e R$69,90/mês", () => {
    expect(priceMatchesVariant({ ...ok, unit_amount: 99900, recurring: { interval: "year" } }, findPlanVariant("pro_yearly")!)).toBe(true);
    expect(priceMatchesVariant({ ...ok, unit_amount: 6990 }, findPlanVariant("pro_founder_monthly")!)).toBe(true);
    expect(priceMatchesVariant({ ...ok, unit_amount: 9990 }, findPlanVariant("pro_founder_monthly")!)).toBe(false);
  });
});

describe("test mode / fail-closed", () => {
  it("só chaves de teste", () => {
    expect(isTestSecretKey("sk_test_abc")).toBe(true);
    expect(isTestSecretKey("rk_test_abc")).toBe(true);
    expect(isTestSecretKey("sk_live_abc")).toBe(false);
    expect(isTestSecretKey("")).toBe(false);
  });
  it("live, ambiente errado, ou secrets ausentes → sem provedor", () => {
    expect(resolveProvider(ENV_OK)?.id).toBe("stripe");
    expect(resolveProvider({ ...ENV_OK, STRIPE_SECRET_KEY: "sk_live_abc" })).toBeNull();
    expect(resolveProvider({ ...ENV_OK, STRIPE_ENVIRONMENT: "live" })).toBeNull();
    expect(resolveProvider({ ...ENV_OK, STRIPE_WEBHOOK_SECRET: "" })).toBeNull();
    expect(resolveProvider({ ...ENV_OK, BILLING_PROVIDER: "asaas" })).toBeNull();
  });
  it("Price IDs vêm só do servidor e são mapeados de volta para plan_code", () => {
    const cfg = readStripeConfig({ ...ENV_OK, STRIPE_PRICE_PRO_YEARLY: "not-a-price" })!;
    expect(cfg.prices).toEqual({ pro_monthly: "price_m1" });
    const p = resolveProvider(ENV_OK)!;
    expect(p.planCodeForPrice("price_m1")).toBe("pro_monthly");
    expect(p.planCodeForPrice("price_attacker")).toBeNull();
  });
});

describe("checkout", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("preserva o trial interno (sem trial duplo)", () => {
    const end = "2026-10-14T12:00:00.000Z";
    expect(trialEndForCheckout({ status: "trialing", trial_ends_at: end }, now)).toBe(Date.parse(end) / 1000);
  });
  it("trial com < 49h ou vencido → cobrança imediata", () => {
    const soon = new Date(now + (MIN_TRIAL_SECONDS - 60) * 1000).toISOString();
    expect(trialEndForCheckout({ status: "trialing", trial_ends_at: soon }, now)).toBeNull();
    expect(trialEndForCheckout({ status: "expired", trial_ends_at: "2026-10-01T00:00:00Z" }, now)).toBeNull();
  });
  it("parâmetros: subscription, customer do servidor, price autorizado, sem dados de cartão", () => {
    const p = buildCheckoutParams({ priceId: "price_m1", customerId: "cus_A", checkoutRef: "ref1", planCode: "pro_monthly", trialEnd: 123, successUrl: "s", cancelUrl: "c", nowMs: now });
    expect(p.mode).toBe("subscription");
    expect(p.customer).toBe("cus_A");
    expect(p.line_items).toEqual([{ price: "price_m1", quantity: 1 }]);
    expect(p.subscription_data.trial_end).toBe(123);
    expect(p.expires_at - now / 1000).toBeGreaterThanOrEqual(30 * 60);
    expect(JSON.stringify(p)).not.toMatch(/card|cvc|amount|user_id/);
  });
  it("form-encoding aninhado", () => {
    expect(encodeForm({ a: { b: [{ c: 1 }] }, d: true })).toBe("a%5Bb%5D%5B0%5D%5Bc%5D=1&d=true");
  });
});

describe("webhook: assinatura sobre o RAW BODY", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1","type":"invoice.paid","livemode":false,"data":{"object":{"customer":"cus_A","subscription":"sub_A"}}}';
  const t = 1_800_000_000;
  it("assinatura válida passa", async () => {
    const sig = await computeSignature(secret, String(t), body);
    expect(await verifyStripeSignature({ rawBody: body, header: `t=${t},v1=${sig}`, secret, nowSeconds: t })).toBe(true);
  });
  it("sem header, assinatura errada, secret errado ou timestamp velho → rejeita", async () => {
    const sig = await computeSignature(secret, String(t), body);
    expect(await verifyStripeSignature({ rawBody: body, header: null, secret, nowSeconds: t })).toBe(false);
    expect(await verifyStripeSignature({ rawBody: body, header: `t=${t},v1=deadbeef`, secret, nowSeconds: t })).toBe(false);
    expect(await verifyStripeSignature({ rawBody: body, header: `t=${t},v1=${sig}`, secret: "whsec_other", nowSeconds: t })).toBe(false);
    expect(await verifyStripeSignature({ rawBody: body, header: `t=${t},v1=${sig}`, secret, nowSeconds: t + 301 })).toBe(false);
  });
  it("payload modificado ou re-serializado após assinatura → rejeita", async () => {
    const sig = await computeSignature(secret, String(t), body);
    const tampered = body.replace("cus_A", "cus_B");
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    expect(await verifyStripeSignature({ rawBody: tampered, header: `t=${t},v1=${sig}`, secret, nowSeconds: t })).toBe(false);
    expect(await verifyStripeSignature({ rawBody: reserialized, header: `t=${t},v1=${sig}`, secret, nowSeconds: t })).toBe(false);
  });
  it("provider.verifyWebhook rejeita evento live mesmo com assinatura válida", async () => {
    const p = resolveProvider({ ...ENV_OK, STRIPE_WEBHOOK_SECRET: secret })!;
    const live = body.replace('"livemode":false', '"livemode":true');
    const now = Math.floor(Date.now() / 1000);
    const sig = await computeSignature(secret, String(now), live);
    const r = await p.verifyWebhook({ rawBody: live, headers: new Headers({ "stripe-signature": `t=${now},v1=${sig}` }) });
    expect(r).toEqual({ ok: false, reason: "live_mode" });
    const sig2 = await computeSignature(secret, String(now), body);
    const ok = await p.verifyWebhook({ rawBody: body, headers: new Headers({ "stripe-signature": `t=${now},v1=${sig2}` }) });
    expect(ok.ok && ok.subscriptionId).toBe("sub_A");
  });
  it("refs: invoice (API nova via parent) e metadata.user_id ignorado", () => {
    const r = extractEventRefs({ type: "invoice.payment_failed", data: { object: { customer: "cus_A", parent: { subscription_details: { subscription: "sub_X" } }, metadata: { user_id: "victim" } } } });
    expect(r.subscriptionId).toBe("sub_X");
    expect(JSON.stringify(r)).not.toContain("victim");
  });
  it("snapshot lê períodos de items (API nova) e preço desconhecido vira planCode null", () => {
    const s = subscriptionToSnapshot(
      { id: "sub_A", customer: "cus_A", status: "active", items: { data: [{ price: { id: "price_x" }, current_period_start: 1, current_period_end: 2 }] } },
      () => null,
    )!;
    expect(s.planCode).toBeNull();
    expect(s.periodEnd).toBe(new Date(2000).toISOString());
  });
});

describe("reconciliação", () => {
  it("status Stripe mapeado; desconhecido nunca libera acesso", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("incomplete")).toBeNull();
    expect(mapStripeStatus("whatever")).toBeNull();
    expect(mapProviderStatus("whatever")).toBe("incomplete");
  });
  it("trialing na Stripe só vincula; trial interno intacto", () => {
    const r = reconcile(base, snap({ providerStatus: "trialing" }));
    expect(r.patch).toEqual({ provider_subscription_id: "sub_A", plan_code: "pro_monthly", cancel_at_period_end: false });
  });
  it("pagamento confirmado ativa com datas da Stripe", () => {
    const r = reconcile(base, snap());
    expect(r.patch?.status).toBe("active");
    expect(r.patch?.current_period_ends_at).toBe("2026-11-08T03:00:00.000Z");
    expect(r.audits).toEqual(["subscription_activated"]);
  });
  it("evento duplicado / mesmo estado → no-op", () => {
    expect(reconcile(active, snap()).patch).toBeNull();
  });
  it("renovação avança período e mantém plan_code", () => {
    const r = reconcile(active, snap({ periodStart: "2026-11-08T03:00:00.000Z", periodEnd: "2026-12-08T03:00:00.000Z" }));
    expect(r.audits).toEqual(["subscription_renewed"]);
    expect(r.patch?.plan_code).toBe("pro_monthly");
  });
  it("fora de ordem: período mais antigo não regride", () => {
    const newer = { ...active, current_period_ends_at: "2026-12-08T03:00:00.000Z" };
    expect(reconcile(newer, snap()).patch).toBeNull();
  });
  it("past_due + payment_failed sem reiniciar trial", () => {
    const r = reconcile(active, snap({ providerStatus: "past_due" }));
    expect(r.patch?.status).toBe("past_due");
    expect(r.audits).toContain("payment_failed");
    expect(r.patch).not.toHaveProperty("trial_ends_at");
  });
  it("cancel_at_period_end agenda sem cortar acesso", () => {
    const r = reconcile(active, snap({ cancelAtPeriodEnd: true }));
    expect(r.patch?.status).toBe("active");
    expect(r.patch?.cancel_at_period_end).toBe(true);
    expect(r.audits).toEqual(["subscription_cancel_scheduled"]);
  });
  it("encerramento → canceled mantendo fim do período", () => {
    const r = reconcile(active, snap({ providerStatus: "canceled", canceledAt: "2026-11-08T03:00:00.000Z" }));
    expect(r.patch?.status).toBe("canceled");
    expect(r.patch).not.toHaveProperty("current_period_ends_at");
    expect(r.audits).toEqual(["subscription_canceled"]);
  });
  it("assinatura encerrada não revive por evento antigo", () => {
    expect(reconcile({ ...active, status: "canceled" }, snap()).patch).toBeNull();
  });
  it("customer de outro usuário / snapshot live / Price não autorizado → ignorado", () => {
    expect(reconcile(active, snap({ providerCustomerId: "cus_C" })).patch).toBeNull();
    expect(reconcile(active, snap({ livemode: true })).patch).toBeNull();
    expect(reconcile(active, snap({ planCode: null })).patch).toBeNull();
  });
  it("outra assinatura não substitui uma viva", () => {
    expect(reconcile(active, snap({ providerSubscriptionId: "sub_B", periodEnd: "2027-01-01T00:00:00Z" })).patch).toBeNull();
  });
});

describe("fundador", () => {
  it("elegível apenas se concedido e não consumido", () => {
    expect(isFounderEligible(null)).toBe(false);
    expect(isFounderEligible({ founder_eligible: true, consumed_at: null })).toBe(true);
    expect(isFounderEligible({ founder_eligible: true, consumed_at: "2026-01-01" })).toBe(false);
  });
  it("primeira ativação consome a elegibilidade; renovação não depende dela", () => {
    expect(reconcile(base, snap({ planCode: "pro_founder_monthly" })).consumeFounder).toBe(true);
    const f = { ...active, plan_code: "pro_founder_monthly" };
    const r = reconcile(f, snap({ planCode: "pro_founder_monthly", periodEnd: "2026-12-08T03:00:00.000Z" }));
    expect(r.consumeFounder).toBe(false);
    expect(r.patch?.plan_code).toBe("pro_founder_monthly");
  });
  it("desfazer cancelamento mantém founder", () => {
    const f = { ...active, plan_code: "pro_founder_monthly", cancel_at_period_end: true };
    const r = reconcile(f, snap({ planCode: "pro_founder_monthly" }));
    expect(r.patch?.cancel_at_period_end).toBe(false);
    expect(r.patch?.plan_code).toBe("pro_founder_monthly");
  });
});

describe("exclusão de conta com cobrança", () => {
  const row = { status: "active", plan_code: "pro_monthly", provider_customer_id: "cus", provider_subscription_id: "sub", cancel_at_period_end: false, trial_ends_at: null };
  it("assinatura aberta (mesmo com cancelamento agendado) exige encerramento", () => {
    expect(hasLiveRecurrence(row)).toBe(true);
    expect(hasLiveRecurrence({ ...row, cancel_at_period_end: true })).toBe(false);
    expect(hasOpenSubscription({ ...row, cancel_at_period_end: true })).toBe(true);
    expect(hasOpenSubscription({ ...row, status: "canceled" })).toBe(false);
  });
  it("deleteMyAccount encerra na Stripe antes de excluir e aborta se não confirmar", () => {
    const src = readFileSync(join(__dirname, "../account.functions.ts"), "utf8");
    expect(src).toContain("Sua conta não foi excluída para evitar uma cobrança futura.");
    expect(src.indexOf("cancelForAccountDeletion(")).toBeLessThan(src.indexOf("deleteUser"));
    const adapter = readFileSync(join(__dirname, "providers/stripe.server.ts"), "utf8");
    expect(adapter).toMatch(/cancelAllImmediately[\s\S]*method: "DELETE"[\s\S]*remaining\.length > 0/);
  });
});

describe("segurança das server functions", () => {
  const src = readFileSync(join(__dirname, "billing.functions.ts"), "utf8");
  it("checkout lê só planCode e customer vem do banco", () => {
    expect(src).toMatch(/planCode: String\(/);
    expect(src).not.toMatch(/data\.(priceId|amount|currency|customerId|trial)/);
    expect(src).toMatch(/resolvePrice\(variant\)/);
  });
  it("portal usa o customer da conta autenticada", () => {
    expect(src).toMatch(/openBillingPortal[\s\S]*context\.supabase\.from\("subscriptions"\)\.select\("provider_customer_id"\)/);
  });
  it("webhook Asaas removido; Stripe ativo", () => {
    const routes = readdirSync(join(__dirname, "../../routes/api/public/billing"));
    expect(routes).toEqual(["stripe.ts"]);
  });
});

describe("segredos fora do cliente", () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  it("nenhum VITE_ para segredos e STRIPE_SECRET só em *.server.ts", () => {
    const files = walk(join(__dirname, "../..")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/VITE_(STRIPE|BILLING|SUPABASE_SERVICE)/);
      expect(s).not.toMatch(/sk_live_[A-Za-z0-9]{6,}|sk_test_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}/);
      if (/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/.test(s) && !f.includes("/routes/api/")) expect(f.endsWith(".server.ts")).toBe(true);
      expect(s).not.toMatch(/ASAAS_/);
    }
  });
});
