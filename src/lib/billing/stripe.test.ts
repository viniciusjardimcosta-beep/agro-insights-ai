import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { findPlanVariant } from "./plans";
import { reconcile, type SubState } from "./reconcile";
import {
  STRIPE_MIN_TRIAL_LEAD_MS,
  buildCheckoutParams,
  invoicePeriodStartIso,
  invoiceSubscriptionId,
  normalizeStripeEvent,
  readStripeConfig,
  resolveTrialEndUnix,
  verifyStripeSignature,
} from "./providers/stripe";
import { resolveProvider } from "./provider.server";
import { activeTrialEndsAt } from "./billing.server";

const NOW = Date.parse("2026-10-17T15:00:00.000Z");
const iso = (unix: number) => new Date(unix * 1000).toISOString();

const TEST_ENV = {
  BILLING_PROVIDER: "stripe",
  STRIPE_ENVIRONMENT: "test",
  STRIPE_SECRET_KEY: "sk_test_abc123XYZ",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123XYZ",
};

describe("Stripe — configuração fail-closed", () => {
  it("aceita ambiente de teste com chave de teste e segredo de webhook", () => {
    expect(readStripeConfig(TEST_ENV)).toEqual({
      environment: "test",
      secretKey: "sk_test_abc123XYZ",
      webhookSecret: "whsec_abc123XYZ",
    });
  });
  it("aceita chave restrita (rk_) e ambiente live com chave live", () => {
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_SECRET_KEY: "rk_test_abc" })?.environment).toBe("test");
    expect(
      readStripeConfig({ ...TEST_ENV, STRIPE_ENVIRONMENT: "live", STRIPE_SECRET_KEY: "sk_live_abc" })?.environment,
    ).toBe("live");
  });
  it("recusa qualquer configuração incompleta ou inconsistente", () => {
    expect(readStripeConfig({})).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_ENVIRONMENT: undefined })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_ENVIRONMENT: "sandbox" })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_ENVIRONMENT: "" })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_SECRET_KEY: "" })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_WEBHOOK_SECRET: "" })).toBeNull();
    // chave live com ambiente test (e o inverso): nunca cobrar de verdade por engano
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_SECRET_KEY: "sk_live_abc" })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_ENVIRONMENT: "live" })).toBeNull();
    // segredo de webhook com formato errado / chave publicável no lugar da secreta
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_WEBHOOK_SECRET: "abc123" })).toBeNull();
    expect(readStripeConfig({ ...TEST_ENV, STRIPE_SECRET_KEY: "pk_test_abc" })).toBeNull();
  });
  it("resolveProvider: stripe configurado, sem configuração e provedor desconhecido", () => {
    const p = resolveProvider(TEST_ENV);
    expect(p?.id).toBe("stripe");
    expect(p?.hasCustomerPortal).toBe(false);
    expect(resolveProvider({ BILLING_PROVIDER: "stripe" })).toBeNull();
    expect(resolveProvider({ ...TEST_ENV, BILLING_PROVIDER: "outro" })).toBeNull();
    expect(resolveProvider({ ...TEST_ENV, BILLING_PROVIDER: "" })).toBeNull();
    // o Asaas continua exigindo a própria configuração
    expect(resolveProvider({ ...TEST_ENV, BILLING_PROVIDER: "asaas" })).toBeNull();
  });
});

describe("Stripe — trial no checkout", () => {
  it("sem trial, inválido ou curto demais: cobra imediatamente (null)", () => {
    expect(resolveTrialEndUnix(null, NOW)).toBeNull();
    expect(resolveTrialEndUnix(undefined, NOW)).toBeNull();
    expect(resolveTrialEndUnix("não é data", NOW)).toBeNull();
    expect(resolveTrialEndUnix(new Date(NOW - 1000).toISOString(), NOW)).toBeNull();
    expect(resolveTrialEndUnix(new Date(NOW + 24 * 3600_000).toISOString(), NOW)).toBeNull();
    expect(resolveTrialEndUnix(new Date(NOW + STRIPE_MIN_TRIAL_LEAD_MS - 1).toISOString(), NOW)).toBeNull();
  });
  it("com trial suficiente: repassa o fim exato em segundos Unix", () => {
    const end = new Date(NOW + 5 * 24 * 3600_000 + 123).toISOString();
    expect(resolveTrialEndUnix(end, NOW)).toBe(Math.floor((NOW + 5 * 24 * 3600_000 + 123) / 1000));
    const edge = new Date(NOW + STRIPE_MIN_TRIAL_LEAD_MS).toISOString();
    expect(resolveTrialEndUnix(edge, NOW)).toBe(Math.floor((NOW + STRIPE_MIN_TRIAL_LEAD_MS) / 1000));
  });
  it("activeTrialEndsAt: só durante o trial em curso", () => {
    const now = new Date(NOW);
    const future = new Date(NOW + 3 * 24 * 3600_000).toISOString();
    expect(activeTrialEndsAt({ status: "trialing", trial_ends_at: future }, now)).toBe(future);
    expect(activeTrialEndsAt({ status: "trialing", trial_ends_at: new Date(NOW - 1).toISOString() }, now)).toBeNull();
    expect(activeTrialEndsAt({ status: "active", trial_ends_at: future }, now)).toBeNull();
    expect(activeTrialEndsAt({ status: "trialing", trial_ends_at: null }, now)).toBeNull();
  });
});

describe("Stripe — montagem do checkout", () => {
  const base = {
    externalReference: "11111111-2222-4333-8444-555555555555",
    successUrl: "https://app.exemplo.com/assinatura/sucesso",
    cancelUrl: "https://app.exemplo.com/assinatura/cancelado",
    minutesToExpire: 30,
  };
  const params = (planCode: string, extra: { trialEndsAt?: string | null; minutesToExpire?: number } = {}) =>
    Object.fromEntries(
      buildCheckoutParams({ ...base, ...extra, variant: findPlanVariant(planCode)! }, NOW),
    );

  it("mensal: valor, moeda, ciclo e nome vêm do catálogo do servidor", () => {
    const p = params("pro_monthly");
    expect(p["mode"]).toBe("subscription");
    expect(p["line_items[0][price_data][unit_amount]"]).toBe("9990");
    expect(p["line_items[0][price_data][currency]"]).toBe("brl");
    expect(p["line_items[0][price_data][recurring][interval]"]).toBe("month");
    expect(p["line_items[0][price_data][product_data][name]"]).toBe("AgroIntel Pro Mensal");
    expect(p["line_items[0][quantity]"]).toBe("1");
  });
  it("anual e fundador", () => {
    const y = params("pro_yearly");
    expect(y["line_items[0][price_data][unit_amount]"]).toBe("99900");
    expect(y["line_items[0][price_data][recurring][interval]"]).toBe("year");
    expect(params("pro_founder_monthly")["line_items[0][price_data][unit_amount]"]).toBe("6990");
  });
  it("somente cartão, português do Brasil e referência opaca do checkout", () => {
    const p = params("pro_monthly");
    expect(p["payment_method_types[0]"]).toBe("card");
    expect(p["locale"]).toBe("pt-BR");
    expect(p["client_reference_id"]).toBe(base.externalReference);
    expect(p["success_url"]).toBe(base.successUrl);
    expect(p["cancel_url"]).toBe(base.cancelUrl);
    expect(p["subscription_data[metadata][plan_code]"]).toBe("pro_monthly");
  });
  it("sem trial em curso não envia trial_end (cobra já)", () => {
    expect("subscription_data[trial_end]" in params("pro_monthly")).toBe(false);
    const curto = new Date(NOW + 24 * 3600_000).toISOString();
    expect("subscription_data[trial_end]" in params("pro_monthly", { trialEndsAt: curto })).toBe(false);
  });
  it("com trial suficiente envia o trial_end exato", () => {
    const end = new Date(NOW + 5 * 24 * 3600_000).toISOString();
    expect(params("pro_monthly", { trialEndsAt: end })["subscription_data[trial_end]"]).toBe(
      String(Math.floor((NOW + 5 * 24 * 3600_000) / 1000)),
    );
  });
  it("expiração respeita o mínimo de 30 min do Stripe (usa 31) e nunca passa de 24 h por conta própria", () => {
    const nowSec = Math.floor(NOW / 1000);
    expect(Number(params("pro_monthly")["expires_at"])).toBe(nowSec + 31 * 60);
    expect(Number(params("pro_monthly", { minutesToExpire: 60 })["expires_at"])).toBe(nowSec + 60 * 60);
  });
});

describe("Stripe — assinatura do webhook", () => {
  const secret = "whsec_testsecret123";
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } });
  // Implementação independente (node:crypto) do esquema documentado: HMAC-SHA256 de `${t}.${corpo}`.
  const sign = (b: string, s: string, t: number) => createHmac("sha256", s).update(`${t}.${b}`).digest("hex");
  const header = (t: number, ...sigs: string[]) => `t=${t},${sigs.map((s) => `v1=${s}`).join(",")}`;
  const t0 = Math.floor(NOW / 1000);
  const verify = (over: Partial<Parameters<typeof verifyStripeSignature>[0]> = {}) =>
    verifyStripeSignature({ rawBody: body, header: header(t0, sign(body, secret, t0)), secret, nowMs: NOW, ...over });

  it("aceita assinatura válida", async () => {
    expect(await verify()).toBe(true);
  });
  it("recusa corpo adulterado, segredo errado e assinatura trocada", async () => {
    expect(await verify({ rawBody: body.replace("evt_1", "evt_2") })).toBe(false);
    expect(await verify({ secret: "whsec_outro" })).toBe(false);
    expect(await verify({ header: header(t0, "0".repeat(64)) })).toBe(false);
    expect(await verify({ header: header(t0 + 1, sign(body, secret, t0)) })).toBe(false);
  });
  it("tolerância de 5 minutos para passado e futuro", async () => {
    const dentro = t0 - 299;
    expect(await verify({ header: header(dentro, sign(body, secret, dentro)) })).toBe(true);
    const velho = t0 - 301;
    expect(await verify({ header: header(velho, sign(body, secret, velho)) })).toBe(false);
    const futuro = t0 + 301;
    expect(await verify({ header: header(futuro, sign(body, secret, futuro)) })).toBe(false);
  });
  it("com várias assinaturas v1, basta uma válida", async () => {
    expect(await verify({ header: header(t0, "a".repeat(64), sign(body, secret, t0)) })).toBe(true);
    expect(await verify({ header: header(t0, sign(body, secret, t0), "a".repeat(64)) })).toBe(true);
  });
  it("recusa cabeçalho ausente, vazio, sem t, sem v1, só v0 ou lixo", async () => {
    expect(await verify({ header: null })).toBe(false);
    expect(await verify({ header: "" })).toBe(false);
    expect(await verify({ header: `v1=${sign(body, secret, t0)}` })).toBe(false);
    expect(await verify({ header: `t=${t0}` })).toBe(false);
    expect(await verify({ header: `t=${t0},v0=${sign(body, secret, t0)}` })).toBe(false);
    expect(await verify({ header: "lixo" })).toBe(false);
    expect(await verify({ header: `t=abc,v1=${sign(body, secret, t0)}` })).toBe(false);
    expect(await verify({ secret: "" })).toBe(false);
  });
});

describe("Stripe — normalização de eventos", () => {
  const created = 1_792_000_000;
  const evt = (type: string, object: Record<string, unknown>) => ({
    id: "evt_x",
    type,
    created,
    data: { object },
  });
  const at = iso(created);
  const periodStart = 1_792_100_000;

  const invoiceNew = (over: Record<string, unknown> = {}) => ({
    id: "in_1",
    customer: "cus_1",
    amount_paid: 9990,
    amount_due: 9990,
    period_start: 1_700_000_000, // NÃO é o período da assinatura — deve ser ignorado
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    lines: { data: [{ parent: { type: "subscription_item_details" }, period: { start: periodStart, end: periodStart + 2_592_000 } }] },
    ...over,
  });
  const invoiceLegacy = (over: Record<string, unknown> = {}) => ({
    id: "in_1",
    customer: "cus_1",
    amount_paid: 9990,
    amount_due: 9990,
    subscription: "sub_1",
    lines: { data: [{ type: "subscription", period: { start: periodStart, end: periodStart + 2_592_000 } }] },
    ...over,
  });

  it("checkout concluído com trial (no_payment_required) e com cobrança imediata (paid)", () => {
    for (const payment_status of ["no_payment_required", "paid"]) {
      expect(
        normalizeStripeEvent(
          evt("checkout.session.completed", {
            id: "cs_1",
            mode: "subscription",
            payment_status,
            customer: "cus_1",
            subscription: "sub_1",
          }),
        ),
      ).toEqual({
        kind: "checkout_paid",
        providerCheckoutId: "cs_1",
        providerCustomerId: "cus_1",
        providerSubscriptionId: "sub_1",
        occurredAt: at,
      });
    }
  });
  it("aceita customer/subscription expandidos (objeto com id)", () => {
    const e = normalizeStripeEvent(
      evt("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        payment_status: "paid",
        customer: { id: "cus_9" },
        subscription: { id: "sub_9" },
      }),
    );
    expect(e).toMatchObject({ kind: "checkout_paid", providerCustomerId: "cus_9", providerSubscriptionId: "sub_9" });
  });
  it("checkout não pago, de outro modo ou sem id é ignorado", () => {
    const ign = (o: Record<string, unknown>) => normalizeStripeEvent(evt("checkout.session.completed", o)).kind;
    expect(ign({ id: "cs_1", mode: "subscription", payment_status: "unpaid" })).toBe("ignored");
    expect(ign({ id: "cs_1", mode: "payment", payment_status: "paid" })).toBe("ignored");
    expect(ign({ mode: "subscription", payment_status: "paid" })).toBe("ignored");
  });
  it("checkout expirado", () => {
    expect(normalizeStripeEvent(evt("checkout.session.expired", { id: "cs_1", mode: "subscription" }))).toEqual({
      kind: "checkout_closed",
      providerCheckoutId: "cs_1",
      status: "expired",
      occurredAt: at,
    });
    expect(normalizeStripeEvent(evt("checkout.session.expired", { id: "cs_1", mode: "payment" })).kind).toBe("ignored");
  });
  it("fatura paga — formato novo (parent) e legado (subscription) dão o mesmo resultado", () => {
    const expected = {
      kind: "payment_confirmed",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      periodStart: iso(periodStart),
      occurredAt: at,
    };
    expect(normalizeStripeEvent(evt("invoice.paid", invoiceNew()))).toEqual(expected);
    expect(normalizeStripeEvent(evt("invoice.paid", invoiceLegacy()))).toEqual(expected);
  });
  it("fatura de R$ 0 (início do trial) e fatura sem assinatura NÃO são pagamento", () => {
    expect(normalizeStripeEvent(evt("invoice.paid", invoiceNew({ amount_paid: 0 }))).kind).toBe("ignored");
    expect(normalizeStripeEvent(evt("invoice.paid", invoiceLegacy({ amount_paid: 0 }))).kind).toBe("ignored");
    expect(
      normalizeStripeEvent(evt("invoice.paid", { id: "in_2", customer: "cus_1", amount_paid: 9990, lines: { data: [] } })).kind,
    ).toBe("ignored");
  });
  it("usa o período da linha da assinatura, não o período da fatura", () => {
    expect(invoicePeriodStartIso(invoiceNew())).toBe(iso(periodStart));
    expect(invoicePeriodStartIso({ period_start: 1_700_000_000, lines: { data: [] } })).toBe(iso(1_700_000_000));
    expect(invoicePeriodStartIso({})).toBeNull();
    expect(invoiceSubscriptionId(invoiceNew())).toBe("sub_1");
    expect(invoiceSubscriptionId(invoiceLegacy())).toBe("sub_1");
    expect(invoiceSubscriptionId({ parent: { type: "quote_details" } })).toBeNull();
  });
  it("falha de pagamento só quando havia valor a cobrar", () => {
    expect(normalizeStripeEvent(evt("invoice.payment_failed", invoiceNew()))).toEqual({
      kind: "payment_failed",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      periodStart: iso(periodStart),
      occurredAt: at,
    });
    expect(normalizeStripeEvent(evt("invoice.payment_failed", invoiceNew({ amount_due: 0 }))).kind).toBe("ignored");
  });
  it("assinatura encerrada", () => {
    expect(
      normalizeStripeEvent(evt("customer.subscription.deleted", { id: "sub_1", customer: "cus_1" })),
    ).toEqual({ kind: "subscription_ended", providerSubscriptionId: "sub_1", providerCustomerId: "cus_1", occurredAt: at });
  });
  it("evento desconhecido ou payload vazio é ignorado sem lançar", () => {
    expect(normalizeStripeEvent(evt("customer.created", { id: "cus_1" })).kind).toBe("ignored");
    expect(normalizeStripeEvent({}).kind).toBe("ignored");
    expect(normalizeStripeEvent({ type: "invoice.paid" }).kind).toBe("ignored");
  });
});

describe("Stripe — do evento ao estado da assinatura", () => {
  const trialing: SubState = {
    status: "trialing",
    plan_code: "pro_monthly",
    provider_customer_id: "cus_1",
    provider_subscription_id: "sub_1",
    current_period_ends_at: null,
    cancel_at_period_end: false,
    updated_at: "2026-10-01T00:00:00.000Z",
  };
  const periodStart = 1_792_100_000;
  const invoice = (over: Record<string, unknown> = {}) => ({
    id: "in_1",
    customer: "cus_1",
    amount_paid: 9990,
    amount_due: 9990,
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    lines: { data: [{ parent: { type: "subscription_item_details" }, period: { start: periodStart, end: periodStart + 1 } }] },
    ...over,
  });
  const e = (type: string, object: Record<string, unknown>) =>
    normalizeStripeEvent({ id: "evt_1", type, created: periodStart, data: { object } });

  it("primeira cobrança paga ativa a assinatura por um ciclo a partir do início do período", () => {
    const r = reconcile(trialing, e("invoice.paid", invoice()));
    expect(r.audit).toBe("subscription_activated");
    expect(r.patch).toMatchObject({ status: "active", current_period_started_at: iso(periodStart) });
    expect(r.patch?.current_period_ends_at).toBe(
      (() => {
        const d = new Date(periodStart * 1000);
        d.setUTCMonth(d.getUTCMonth() + 1);
        return d.toISOString();
      })(),
    );
  });
  it("fatura de R$ 0 do início do trial jamais ativa a assinatura", () => {
    const ev = e("invoice.paid", invoice({ amount_paid: 0 }));
    expect(ev.kind).toBe("ignored");
    expect(reconcile(trialing, ev).patch).toBeNull();
  });
  it("cobrança de outra assinatura (antiga) não sobrescreve a atual", () => {
    const outra = invoice({ parent: { type: "subscription_details", subscription_details: { subscription: "sub_OLD" } } });
    expect(reconcile(trialing, e("invoice.paid", outra)).patch).toBeNull();
  });
  it("falha de pagamento coloca em atraso; encerramento cancela mantendo o período pago", () => {
    const ativa: SubState = { ...trialing, status: "active", current_period_ends_at: "2026-10-05T00:00:00.000Z" };
    expect(reconcile(ativa, e("invoice.payment_failed", invoice())).patch).toMatchObject({ status: "past_due" });
    const fim = reconcile(ativa, e("customer.subscription.deleted", { id: "sub_1", customer: "cus_1" }));
    expect(fim.patch).toMatchObject({ status: "canceled", cancel_at_period_end: true });
    expect(fim.patch && "current_period_ends_at" in fim.patch).toBe(false);
  });
  it("assinatura encerrada após o cancelamento feito pelo próprio app não gera efeito duplicado", () => {
    const jaCancelada: SubState = { ...trialing, status: "canceled", cancel_at_period_end: true };
    expect(reconcile(jaCancelada, e("customer.subscription.deleted", { id: "sub_1", customer: "cus_1" })).patch).toBeNull();
  });
});
