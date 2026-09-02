import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createCorrelationId,
  recordAuditEvent,
  sanitizeAuditMetadata,
  startTimer,
} from "@/lib/audit.server";
import { AppError, ERROR_CODES, toUserMessage, errorCodeOf } from "@/lib/errors";

function fakeSupabase(impl?: (args: Record<string, unknown>) => { error: unknown }) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return impl ? impl(args) : { data: "id", error: null };
    }),
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("sanitizeAuditMetadata", () => {
  it("mantém apenas chaves operacionais permitidas", () => {
    expect(sanitizeAuditMetadata({ duration_ms: 850, http_status: 200 })).toEqual({
      duration_ms: 850,
      http_status: 200,
    });
    expect(sanitizeAuditMetadata({ source: "dashboard" })).toEqual({ source: "dashboard" });
    expect(sanitizeAuditMetadata({ error_code: "AI_TIMEOUT" })).toEqual({ error_code: "AI_TIMEOUT" });
  });

  it("descarta tokens e credenciais", () => {
    const out = sanitizeAuditMetadata({
      token: "abc",
      access_token: "abc",
      refresh_token: "abc",
      Authorization: "Bearer x.y.z",
      authorization: "Bearer x.y.z",
      password: "123456",
      service_role: "secret",
      jwt: "x.y.z",
      cookie: "sb-auth=1",
      duration_ms: 10,
    });
    expect(out).toEqual({ duration_ms: 10 });
  });

  it("descarta conteúdo financeiro e PII", () => {
    const out = sanitizeAuditMetadata({
      amount: 15000,
      revenue: 100000,
      profit: -2000,
      description: "Adubo NPK",
      message: "quanto lucro tive?",
      email: "produtor@fazenda.com",
      name: "João da Silva",
      report: { risks: ["x"] },
      http_status: 200,
    });
    expect(out).toEqual({ http_status: 200 });
  });

  it("descarta objetos, arrays e valores não escalares e trunca strings longas", () => {
    const out = sanitizeAuditMetadata({
      source: "x".repeat(500),
      reason: { nested: true },
      count: [1, 2],
      scope: null,
    });
    expect((out['source'] as string).length).toBe(64);
    expect(out).not.toHaveProperty("reason");
    expect(out).not.toHaveProperty("count");
    expect(out).not.toHaveProperty("scope");
  });

  it("é resiliente a entradas inválidas", () => {
    expect(sanitizeAuditMetadata(null)).toEqual({});
    expect(sanitizeAuditMetadata("token=abc")).toEqual({});
    expect(sanitizeAuditMetadata([1, 2, 3])).toEqual({});
  });
});

describe("createCorrelationId", () => {
  it("gera UUIDs distintos no formato esperado", () => {
    const a = createCorrelationId();
    const b = createCorrelationId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});

describe("recordAuditEvent", () => {
  it("cria evento com identidade derivada do servidor (nunca user_id do cliente)", async () => {
    const sb = fakeSupabase();
    await recordAuditEvent(sb as never, {
      eventType: "property_created",
      entityType: "property",
      entityId: "11111111-1111-4111-8111-111111111111",
      metadata: { source: "propriedades" },
    });
    const args = sb.calls[0]!;
    expect(sb.rpc).toHaveBeenCalledWith("record_audit_event", expect.any(Object));
    expect(args['_event_type']).toBe("property_created");
    expect(args['_metadata']).toEqual({ source: "propriedades" });
    expect(Object.keys(args)).not.toContain("_user_id");
  });

  it("compartilha o mesmo correlation_id entre as etapas de uma operação", async () => {
    const sb = fakeSupabase();
    const correlationId = createCorrelationId();
    await recordAuditEvent(sb as never, { eventType: "diagnostic_started", correlationId });
    await recordAuditEvent(sb as never, { eventType: "diagnostic_completed", correlationId });
    expect(sb.calls.map((c) => c['_correlation_id'])).toEqual([correlationId, correlationId]);
  });

  it("sanitiza a metadata antes de enviar ao banco", async () => {
    const sb = fakeSupabase();
    await recordAuditEvent(sb as never, {
      eventType: "ai_request_completed",
      metadata: { Authorization: "Bearer abc", access_token: "t", duration_ms: 120 },
    });
    expect(sb.calls[0]!['_metadata']).toEqual({ duration_ms: 120 });
  });

  it("ignora ids que não sejam UUID (nenhum dado arbitrário chega ao banco)", async () => {
    const sb = fakeSupabase();
    await recordAuditEvent(sb as never, {
      eventType: "cost_created",
      entityId: "'; drop table audit_events; --",
      propertyId: "abc",
      correlationId: "nao-uuid",
    });
    expect(sb.calls[0]!['_entity_id']).toBeNull();
    expect(sb.calls[0]!['_property_id']).toBeNull();
    expect(sb.calls[0]!['_correlation_id']).toBeNull();
  });

  it("falha do audit log não derruba a operação principal", async () => {
    const sb = fakeSupabase(() => ({ error: { message: "permission denied", code: "42501" } }));
    await expect(
      recordAuditEvent(sb as never, { eventType: "price_created" }),
    ).resolves.toEqual({ ok: false });
  });

  it("exceção do cliente supabase também é contida", async () => {
    const sb = { rpc: vi.fn(async () => { throw new Error("network down"); }) };
    await expect(
      recordAuditEvent(sb as never, { eventType: "price_deleted" }),
    ).resolves.toEqual({ ok: false });
  });

  it("startTimer mede duração não negativa", () => {
    const elapsed = startTimer();
    expect(elapsed()).toBeGreaterThanOrEqual(0);
  });
});

describe("erros estruturados", () => {
  it("expõe code/status/correlationId/timestamp sem stack", () => {
    const err = new AppError({
      code: ERROR_CODES.AI_TIMEOUT,
      status: 504,
      correlationId: "c1",
      userMessage: "O Consultor está demorando mais que o esperado.",
      cause: new Error("socket hang up"),
    });
    const s = err.toStructured();
    expect(s.code).toBe("AI_TIMEOUT");
    expect(s.status).toBe(504);
    expect(s.correlationId).toBe("c1");
    expect(s.timestamp).toMatch(/^\d{4}-/);
    expect(JSON.stringify(s)).not.toContain("socket hang up");
    expect(JSON.stringify(s)).not.toContain("stack");
  });

  it("nunca expõe stack trace ou detalhe técnico ao usuário", () => {
    const technical = new Error("TypeError: undefined is not a function\n    at foo (bar.ts:1:1)");
    expect(toUserMessage(technical)).toBe(
      "Não foi possível concluir a operação. Tente novamente.",
    );
    expect(toUserMessage(new Error("Recurso não encontrado"))).toBe("Recurso não encontrado");
    expect(errorCodeOf(technical)).toBe("UNKNOWN");
  });
});
