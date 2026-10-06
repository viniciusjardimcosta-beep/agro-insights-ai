import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampPage, isUuid, rolesIncludeAdmin, sanitizeAdminSearch, ADMIN_SUBSCRIPTION_FIELDS } from "./admin";
import { isAdmin, requireAdmin } from "./admin.server";
import { reconcile } from "./billing/reconcile";
import { isFounderEligible, findPlanVariant } from "./billing/plans";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/** Simula o client do usuário: RLS devolve só as linhas do próprio auth.uid(). */
function fakeSupabase(authUid: string, table: { user_id: string; role: string }[]) {
  return {
    from: () => {
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: string) => {
          filters[k] = v;
          return q;
        },
        then: (res: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(
            res({
              data: table.filter(
                (r) => r.user_id === authUid && Object.entries(filters).every(([k, v]) => (r as Record<string, string>)[k] === v),
              ),
              error: null,
            }),
          ),
      };
      return q;
    },
  } as never;
}

describe("autorização admin", () => {
  const roles = [{ user_id: A, role: "admin" }];
  it("admin permitido", async () => {
    expect(await isAdmin(fakeSupabase(A, roles), A)).toBe(true);
    await expect(requireAdmin(fakeSupabase(A, roles), A)).resolves.toBeUndefined();
  });
  it("usuário comum bloqueado (403)", async () => {
    await expect(requireAdmin(fakeSupabase(B, roles), B)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
  it("B alegando ser A não passa: RLS só mostra linhas do próprio token", async () => {
    expect(await isAdmin(fakeSupabase(B, roles), A)).toBe(false);
  });
  it("sem sessão bloqueado", async () => {
    await expect(requireAdmin(fakeSupabase("", roles), "")).rejects.toMatchObject({ status: 403 });
  });
  it("rolesIncludeAdmin exige mesmo uid", () => {
    expect(rolesIncludeAdmin([{ user_id: A, role: "admin" }], B)).toBe(false);
    expect(rolesIncludeAdmin(null, A)).toBe(false);
  });
});

describe("entrada do admin", () => {
  it("busca remove curingas e sintaxe de filtro", () => {
    expect(sanitizeAdminSearch("a%b_c,or(id.eq.x)")).toBe("a b c or id eq x");
    expect(sanitizeAdminSearch("x".repeat(200))).toHaveLength(80);
  });
  it("página e target validados", () => {
    expect(clampPage(-1)).toBe(0);
    expect(clampPage("abc")).toBe(0);
    expect(clampPage(3)).toBe(3);
    expect(isUuid("1 or 1=1")).toBe(false);
    expect(isUuid(A)).toBe(true);
  });
});

describe("todas as funções admin exigem requireAdmin", () => {
  const src = readFileSync(join(__dirname, "admin.functions.ts"), "utf8");
  const blocks = src.split("export const ").slice(1);
  it("cada função (exceto amIAdmin) chama requireAdmin antes do service role", () => {
    for (const b of blocks) {
      const name = b.slice(0, b.indexOf(" "));
      expect(b).toContain("requireSupabaseAuth");
      if (name === "amIAdmin") {
        expect(b).not.toContain("client.server");
        continue;
      }
      const ra = b.indexOf("requireAdmin(");
      const sr = b.indexOf("client.server");
      expect(ra, name).toBeGreaterThan(-1);
      expect(ra, name).toBeLessThan(sr);
    }
  });
  it("nenhuma função de alterar papel/assinatura/trial existe", () => {
    expect(src).not.toMatch(/grantAdmin|setRole|updateRole|user_roles"\)\.(insert|update|upsert|delete)/);
    expect(src).not.toMatch(/from\("subscriptions"\)\.(update|insert|upsert|delete)/);
    expect(src).not.toMatch(/ai_messages|ai_threads|costs|fields|diagnostics|properties/);
  });
  it("painel não expõe IDs do gateway nem segredos", () => {
    expect(ADMIN_SUBSCRIPTION_FIELDS).not.toContain("provider_customer_id" as never);
    expect(ADMIN_SUBSCRIPTION_FIELDS).not.toContain("provider_subscription_id" as never);
    expect(src).not.toMatch(/checkout_url|ASAAS_|payload/);
  });
});

describe("Plano Fundador", () => {
  it("revogar não altera assinatura fundador ativa", () => {
    // Revogação só mexe em billing_eligibility; a renovação usa o plan_code gravado.
    expect(isFounderEligible({ founder_eligible: false, consumed_at: null })).toBe(false);
    const r = reconcile(
      {
        status: "active",
        plan_code: "pro_founder_monthly",
        provider_customer_id: "c",
        provider_subscription_id: "s",
        current_period_ends_at: "2026-11-08T03:00:00.000Z",
        cancel_at_period_end: false,
        updated_at: "2026-10-08T00:00:00.000Z",
      },
      {
        kind: "payment_confirmed",
        providerCustomerId: "c",
        providerSubscriptionId: "s",
        periodStart: "2026-11-08T03:00:00.000Z",
        occurredAt: "2026-11-08T12:00:00.000Z",
      },
    );
    expect(r.audit).toBe("subscription_renewed");
    expect(r.patch).not.toHaveProperty("plan_code");
    expect(findPlanVariant("pro_founder_monthly")?.amountCents).toBe(6990);
  });
  it("revogação não toca subscriptions", () => {
    const src = readFileSync(join(__dirname, "admin.functions.ts"), "utf8");
    const block = src.slice(src.indexOf("setFounderEligibility"), src.indexOf("getAdminBilling"));
    expect(block).not.toContain('"subscriptions"');
  });
});

describe("cache na troca de conta", () => {
  it("logout limpa todo o cache (inclui chaves admin)", () => {
    const layout = readFileSync(join(__dirname, "../routes/_authenticated.tsx"), "utf8");
    expect(layout.indexOf("queryClient.clear()")).toBeLessThan(layout.indexOf("supabase.auth.signOut()"));
    const root = readFileSync(join(__dirname, "../routes/__root.tsx"), "utf8");
    expect(root).toContain("queryClient.clear()");
  });
  it("vi disponível", () => expect(vi).toBeDefined());
});
