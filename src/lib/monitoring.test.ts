import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  captureError,
  captureMessage,
  clearMonitoringUser,
  getMonitoringUserId,
  setMonitoringProvider,
  setMonitoringUser,
  type MonitoringProvider,
} from "@/lib/monitoring";
import { AppError, ERROR_CODES } from "@/lib/errors";

function fakeProvider() {
  const errors: unknown[] = [];
  const messages: string[] = [];
  const users: (string | null)[] = [];
  const provider: MonitoringProvider = {
    captureError: (e) => errors.push(e),
    captureMessage: (m) => messages.push(m),
    setUser: (u) => users.push(u?.id ?? null),
  };
  return { provider, errors, messages, users };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setMonitoringProvider(null);
  clearMonitoringUser();
  vi.restoreAllMocks();
});

describe("monitoring", () => {
  it("funciona sem fornecedor externo instalado", () => {
    expect(() => captureError(new Error("x"), { route: "/dashboard" })).not.toThrow();
    expect(() => captureMessage("login_failure", { errorCode: "AUTH" })).not.toThrow();
  });

  it("encaminha erros ao fornecedor quando configurado", () => {
    const { provider, errors } = fakeProvider();
    setMonitoringProvider(provider);
    captureError(new AppError({ code: ERROR_CODES.AI_TIMEOUT, userMessage: "demorou" }), {});
    expect(errors).toHaveLength(1);
  });

  it("logout limpa o contexto de monitoramento", () => {
    const { provider, users } = fakeProvider();
    setMonitoringProvider(provider);
    setMonitoringUser({ id: "user-a" });
    expect(getMonitoringUserId()).toBe("user-a");
    clearMonitoringUser();
    expect(getMonitoringUserId()).toBeNull();
    expect(users.at(-1)).toBeNull();
  });

  it("não envia conteúdo financeiro, mensagens ou tokens no contexto", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setMonitoringUser({ id: "user-a" });
    captureError(new Error("falhou"), {
      errorCode: "AI_FAILED",
      route: "/consultor",
      durationMs: 12,
    });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toMatch(/token|Authorization|password|amount|profit|@/i);
    expect(logged).toContain("AI_FAILED");
  });
});
