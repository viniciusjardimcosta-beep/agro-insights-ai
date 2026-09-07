import { describe, it, expect, vi } from "vitest";
import {
  FEATURES,
  SUBSCRIPTION_STATUS,
  computeAccess,
  type SubscriptionRow,
} from "@/lib/entitlements";
import { assertEntitlement, canUse } from "@/lib/premium-guard";
import { generateExecutiveReport } from "@/lib/report";
import { isAppError } from "@/lib/errors";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-10T12:00:00.000Z");

function row(endsAt: Date): SubscriptionRow {
  return {
    plan_code: "trial",
    status: SUBSCRIPTION_STATUS.TRIALING,
    trial_started_at: new Date(endsAt.getTime() - 7 * DAY).toISOString(),
    trial_ends_at: endsAt.toISOString(),
    current_period_started_at: null,
    current_period_ends_at: endsAt.toISOString(),
    cancel_at_period_end: false,
    canceled_at: null,
  };
}

const VALID = computeAccess(row(new Date(NOW.getTime() + 3 * DAY)), NOW);
const EXPIRED = computeAccess(row(new Date(NOW.getTime() - DAY)), NOW);

const REPORT_DATA = {
  properties: [{ name: "Fazenda Teste", city: "Sorriso", state: "MT", total_area: 100 }],
  fields: [
    {
      id: "f1",
      name: "T1",
      area: 100,
      crop: "Soja",
      estimated_yield: 60,
      real_yield: null,
      property_id: "p1",
      season: "2025/26",
      planting_date: null,
    },
  ] as never,
  costs: [{ id: "c1", field_id: "f1", category: "Insumos", amount: 100000, date: "2026-01-01" }] as never,
  prices: [{ id: "pr1", crop: "Soja", price_per_bag: 130, date: "2026-01-01" }] as never,
  producerName: "Produtor Teste",
};

describe("assertEntitlement", () => {
  it("trial válido libera recursos premium", () => {
    expect(() => assertEntitlement(VALID, FEATURES.INTELLIGENCE)).not.toThrow();
    expect(canUse(VALID, FEATURES.SIMULATOR)).toBe(true);
  });

  it("trial vencido bloqueia com TRIAL_EXPIRED", () => {
    try {
      assertEntitlement(EXPIRED, FEATURES.INTELLIGENCE);
      throw new Error("deveria ter bloqueado");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e.code).toBe("TRIAL_EXPIRED");
        expect(e.status).toBe(402);
      }
    }
  });

  it("sem assinatura bloqueia com SUBSCRIPTION_REQUIRED", () => {
    try {
      assertEntitlement(null, FEATURES.ALERTS);
      throw new Error("deveria ter bloqueado");
    } catch (e) {
      expect(isAppError(e) && e.code).toBe("SUBSCRIPTION_REQUIRED");
    }
  });

  it("usuário expirado mantém CRUD básico e direitos LGPD", () => {
    for (const f of [
      FEATURES.PROPERTIES,
      FEATURES.FIELDS,
      FEATURES.COSTS,
      FEATURES.PRICES,
      FEATURES.SETTINGS,
      FEATURES.ACCOUNT_DATA,
    ]) {
      expect(() => assertEntitlement(EXPIRED, f)).not.toThrow();
    }
  });

  it("estados de dois usuários não se contaminam", () => {
    expect(canUse(VALID, FEATURES.SIMULATOR)).toBe(true);
    expect(canUse(EXPIRED, FEATURES.SIMULATOR)).toBe(false);
    // objetos independentes: bloquear um não altera o outro
    expect(() => assertEntitlement(EXPIRED, FEATURES.SIMULATOR)).toThrow();
    expect(canUse(VALID, FEATURES.SIMULATOR)).toBe(true);
  });
});

describe("Relatório Executivo (PDF client-side)", () => {
  it("com trial válido o guard libera a geração (bloqueio comercial não ocorre)", () => {
    // Em ambiente de teste não há DOM para o download; o que importa aqui é
    // que a execução passa do guard comercial sem AppError 402.
    try {
      generateExecutiveReport({ ...REPORT_DATA, access: VALID });
    } catch (e) {
      expect(isAppError(e)).toBe(false);
    }
  });

  it("chamada direta do gerador com trial vencido é bloqueada", () => {
    try {
      generateExecutiveReport({ ...REPORT_DATA, access: EXPIRED });
      throw new Error("deveria ter bloqueado");
    } catch (e) {
      expect(isAppError(e) && e.code).toBe("TRIAL_EXPIRED");
    }
  });

  it("chamada direta sem estado de assinatura é bloqueada", () => {
    expect(() => generateExecutiveReport({ ...REPORT_DATA, access: null })).toThrow();
  });
});

describe("guard server-side vem antes do rate limit", () => {
  async function fakeSupabase(sub: SubscriptionRow | null) {
    return {
      from: () => ({ select: () => ({ maybeSingle: async () => ({ data: sub, error: null }) }) }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };
  }

  it("bloqueia sem entitlement e nunca chama RPC de rate limit", async () => {
    const { requireEntitlement } = await import("@/lib/subscription.server");
    const sb = await fakeSupabase(row(new Date(Date.now() - DAY)));
    await expect(
      requireEntitlement(sb as never, FEATURES.SIMULATOR),
    ).rejects.toMatchObject({ status: 402 });
    // a única RPC usada aqui é a de auditoria; consume_rate_limit nunca é chamada
    const calls = sb.rpc.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("consume_rate_limit");
  });

  it("libera com trial válido", async () => {
    const { requireEntitlement } = await import("@/lib/subscription.server");
    const sb = await fakeSupabase(row(new Date(Date.now() + 3 * DAY)));
    const access = await requireEntitlement(sb as never, FEATURES.ALERTS);
    expect(access.accessLevel).toBe("full");
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
