import { describe, expect, it, vi } from "vitest";
import {
  CHAT_LIMITS,
  RATE_LIMITS,
  checkRateLimit,
  evaluateLimit,
  isMessageTooLong,
  recordUsage,
  trimContext,
} from "./rate-limit.server";

/** Simulador do estado do banco, replicando a atomicidade da função SQL. */
function makeDb() {
  const rows: { user_id: string; event_type: string; at: number }[] = [];
  let now = Date.now();
  let lock = Promise.resolve();
  return {
    rows,
    advance: (ms: number) => (now += ms),
    clientFor(userId: string | null) {
      return {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (!userId) return { data: null, error: { message: "Não autenticado" } };
          if (fn === "record_usage_event") {
            rows.push({ user_id: userId, event_type: args["_event_type"] as string, at: now });
            return { data: null, error: null };
          }
          // serializa como o pg_advisory_xact_lock
          let release!: () => void;
          const prev = lock;
          lock = new Promise<void>((r) => (release = r));
          await prev;
          try {
            const type = args["_event_type"] as string;
            const mine = rows.filter((r) => r.user_id === userId && r.event_type === type);
            const hour = mine.filter((r) => r.at > now - 3600_000).length;
            const day = mine.filter((r) => r.at > now - 86_400_000).length;
            const res = evaluateLimit(hour, day, {
              hour: args["_hour_limit"] as number,
              day: args["_day_limit"] as number,
            });
            if (res.allowed) rows.push({ user_id: userId, event_type: type, at: now });
            return { data: res, error: null };
          } finally {
            release();
          }
        },
      } as never;
    },
  };
}

describe("evaluateLimit", () => {
  const L = RATE_LIMITS.ai_message;
  it("permite abaixo do limite", () => {
    expect(evaluateLimit(29, 100, L)).toEqual({ allowed: true, scope: null });
  });
  it("bloqueia exatamente no limite por hora", () => {
    expect(evaluateLimit(30, 100, L)).toEqual({ allowed: false, scope: "hour" });
  });
  it("bloqueia acima do limite por hora", () => {
    expect(evaluateLimit(31, 100, L)).toEqual({ allowed: false, scope: "hour" });
  });
  it("bloqueia no limite diário", () => {
    expect(evaluateLimit(0, 120, L)).toEqual({ allowed: false, scope: "day" });
  });
  it("ignora limite zerado (diagnóstico só tem limite diário)", () => {
    const D = RATE_LIMITS.diagnostic_ai_generation;
    expect(evaluateLimit(999, 9, D)).toEqual({ allowed: true, scope: null });
    expect(evaluateLimit(0, 10, D)).toEqual({ allowed: false, scope: "day" });
  });
});

describe("checkRateLimit (consumo atômico)", () => {
  it("permite 30 mensagens/hora e bloqueia a 31ª", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    for (let i = 0; i < 30; i++) {
      expect((await checkRateLimit(c, "ai_message")).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(c, "ai_message");
    expect(blocked).toEqual({ allowed: false, scope: "hour" });
    expect(db.rows.length).toBe(30); // tentativa bloqueada não registra uso
  });

  it("libera após a janela de 1 hora, mas respeita o limite diário", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < 30; i++) await checkRateLimit(c, "ai_message");
      db.advance(3600_001);
    }
    expect(db.rows.length).toBe(120);
    expect(await checkRateLimit(c, "ai_message")).toEqual({ allowed: false, scope: "day" });
    db.advance(86_400_001);
    expect((await checkRateLimit(c, "ai_message")).allowed).toBe(true);
  });

  it("mantém usuários independentes", async () => {
    const db = makeDb();
    const a = db.clientFor("user-a");
    const b = db.clientFor("user-b");
    for (let i = 0; i < 30; i++) await checkRateLimit(a, "ai_message");
    expect((await checkRateLimit(a, "ai_message")).allowed).toBe(false);
    expect((await checkRateLimit(b, "ai_message")).allowed).toBe(true);
  });

  it("não ultrapassa o limite com requisições simultâneas", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    const results = await Promise.all(
      Array.from({ length: 50 }, () => checkRateLimit(c, "ai_message")),
    );
    expect(results.filter((r) => r.allowed).length).toBe(30);
    expect(db.rows.length).toBe(30);
  });

  it("diagnóstico: 9/10 permitido, 10º permitido, 11º bloqueado", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    for (let i = 0; i < 10; i++) {
      expect((await checkRateLimit(c, "diagnostic_ai_generation")).allowed).toBe(true);
    }
    expect(await checkRateLimit(c, "diagnostic_ai_generation")).toEqual({
      allowed: false,
      scope: "day",
    });
  });

  it("diagnóstico simultâneo não ultrapassa o limite", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    const r = await Promise.all(
      Array.from({ length: 25 }, () => checkRateLimit(c, "diagnostic_ai_generation")),
    );
    expect(r.filter((x) => x.allowed).length).toBe(10);
  });

  it("rejeita quando não há usuário autenticado", async () => {
    const db = makeDb();
    await expect(checkRateLimit(db.clientFor(null), "ai_message")).rejects.toThrow();
  });

  it("consumo de tipos diferentes não se mistura", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    for (let i = 0; i < 30; i++) await checkRateLimit(c, "ai_message");
    expect((await checkRateLimit(c, "diagnostic_ai_generation")).allowed).toBe(true);
  });
});

describe("entrada e contexto", () => {
  it("rejeita mensagem acima de 4.000 caracteres", () => {
    expect(isMessageTooLong("a".repeat(4000))).toBe(false);
    expect(isMessageTooLong("a".repeat(4001))).toBe(true);
  });
  it("envia ao modelo apenas as mensagens mais recentes", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => i);
    const ctx = trimContext(msgs);
    expect(ctx.length).toBe(CHAT_LIMITS.maxContextMessages);
    expect(ctx.at(-1)).toBe(49);
  });
  it("mantém histórico curto intacto", () => {
    expect(trimContext([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("timeout", () => {
  it("registra apenas o evento técnico, sem conteúdo", async () => {
    const db = makeDb();
    const c = db.clientFor("user-a");
    await recordUsage(c, "ai_timeout");
    expect(db.rows).toEqual([{ user_id: "user-a", event_type: "ai_timeout", at: expect.any(Number) }]);
  });
  it("não quebra o fluxo se o registro falhar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as never;
    await expect(recordUsage(failing, "ai_timeout")).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it("timeout configurado é finito e razoável", () => {
    expect(CHAT_LIMITS.timeoutMs).toBeGreaterThan(5000);
    expect(CHAT_LIMITS.timeoutMs).toBeLessThanOrEqual(60_000);
  });
});
