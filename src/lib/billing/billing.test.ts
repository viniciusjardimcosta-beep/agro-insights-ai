import { describe, expect, it } from "vitest";
import { PLAN_CATALOG, availablePlanVariants, findPlanVariant } from "./plans";
import { mapProviderStatus, shouldApplyUpdate } from "./status";
import { SUBSCRIPTION_STATUS } from "@/lib/entitlements";

describe("catálogo de planos", () => {
  it("não contém preços inventados nem price IDs fictícios", () => {
    for (const v of PLAN_CATALOG) {
      expect(v.amountCents).toBeNull();
      expect(v.providerPriceId).toBeNull();
      expect(v.available).toBe(false);
    }
  });

  it("nenhuma variante pode ir a checkout enquanto não houver preço aprovado", () => {
    expect(availablePlanVariants()).toHaveLength(0);
  });

  it("plan_code/price arbitrário do cliente não resolve variante", () => {
    expect(findPlanVariant("price_1AbCdEf")).toBeNull();
    expect(findPlanVariant("pro_lifetime_grátis")).toBeNull();
    expect(findPlanVariant("pro_monthly")?.planCode).toBe("pro");
  });
});

describe("mapeamento de status do provedor", () => {
  it("traduz vocabulário comum para status canônico", () => {
    expect(mapProviderStatus("trialing")).toBe(SUBSCRIPTION_STATUS.TRIALING);
    expect(mapProviderStatus("authorized")).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapProviderStatus("PAID")).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapProviderStatus("unpaid")).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
    expect(mapProviderStatus("cancelled")).toBe(SUBSCRIPTION_STATUS.CANCELED);
    expect(mapProviderStatus("expired")).toBe(SUBSCRIPTION_STATUS.EXPIRED);
  });

  it("status desconhecido nunca vira acesso liberado", () => {
    expect(mapProviderStatus("qualquer_coisa")).toBe(SUBSCRIPTION_STATUS.INCOMPLETE);
    expect(mapProviderStatus("")).toBe(SUBSCRIPTION_STATUS.INCOMPLETE);
  });
});

describe("eventos fora de ordem", () => {
  const base = { currentUpdatedAt: "2026-03-01T00:00:00.000Z", incomingOccurredAt: "2026-03-02T00:00:00.000Z" };

  it("aplica evento mais novo", () => {
    expect(
      shouldApplyUpdate({
        ...base,
        currentPeriodEndsAt: "2026-04-01T00:00:00.000Z",
        incomingPeriodEndsAt: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("descarta evento atrasado que encurtaria o período já conhecido", () => {
    expect(
      shouldApplyUpdate({
        ...base,
        currentPeriodEndsAt: "2026-05-01T00:00:00.000Z",
        incomingPeriodEndsAt: "2026-04-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("descarta evento sem período cujo horário é anterior ao estado atual", () => {
    expect(
      shouldApplyUpdate({
        currentUpdatedAt: "2026-03-10T00:00:00.000Z",
        incomingOccurredAt: "2026-03-01T00:00:00.000Z",
        currentPeriodEndsAt: "2026-05-01T00:00:00.000Z",
        incomingPeriodEndsAt: null,
      }),
    ).toBe(false);
  });

  it("aplica quando não há estado anterior", () => {
    expect(
      shouldApplyUpdate({
        currentUpdatedAt: null,
        incomingOccurredAt: "2026-03-01T00:00:00.000Z",
        currentPeriodEndsAt: null,
        incomingPeriodEndsAt: "2026-04-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("nenhum gateway configurado", () => {
  it("resolveProvider() não devolve adapter e requireProvider() bloqueia", async () => {
    const { resolveProvider, requireProvider } = await import("./provider.server");
    expect(resolveProvider()).toBeNull();
    expect(() => requireProvider()).toThrowError();
    try {
      requireProvider();
    } catch (err) {
      expect((err as { code: string }).code).toBe("BILLING_NOT_CONFIGURED");
    }
  });
});
