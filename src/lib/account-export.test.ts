import { describe, expect, it } from "vitest";
import {
  buildExportPayload,
  exportFileName,
  stripForbidden,
  EXPORT_VERSION,
  type ExportSource,
} from "./account-export";

const empty: ExportSource = {
  profile: null,
  properties: null,
  fields: null,
  costs: null,
  prices: null,
  diagnostics: null,
  scenarios: null,
  alerts: null,
  threads: null,
  messages: null,
};

describe("exportação de dados do usuário", () => {
  it("usuário sem dados gera pacote válido e vazio", () => {
    const out = buildExportPayload(empty, "2026-01-01T00:00:00.000Z");
    expect(out.export_version).toBe(EXPORT_VERSION);
    expect(out.generated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(out.profile).toEqual({});
    expect(out.properties).toEqual([]);
    expect(out.ai_threads).toEqual([]);
  });

  it("remove user_id, correlation_id e qualquer chave sensível", () => {
    const row = stripForbidden({
      id: "1",
      user_id: "u1",
      correlation_id: "c1",
      access_token: "abc",
      Authorization: "Bearer x",
      password: "y",
      amount: 100,
    });
    expect(row).toEqual({ id: "1", amount: 100 });
  });

  it("não inclui user_id em nenhuma coleção exportada", () => {
    const out = buildExportPayload({
      ...empty,
      profile: { id: "u1", name: "Ana", email: "a@x.com" },
      properties: [{ id: "p1", user_id: "u1", name: "Santa Maria" }],
      fields: [{ id: "f1", user_id: "u1", property_id: "p1", crop: "soja" }],
      costs: [{ id: "c1", user_id: "u1", field_id: "f1", amount: 10 }],
      prices: [{ id: "pr1", user_id: "u1", crop: "soja", price_per_bag: 130 }],
      diagnostics: [{ id: "d1", user_id: "u1", health_score: 70 }],
      scenarios: [{ id: "s1", user_id: "u1", name: "Cenário" }],
      alerts: [{ id: "a1", user_id: "u1", alert_key: "k" }],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain("user_id");
    expect(json).not.toContain("correlation_id");
    expect(out.costs[0]).toMatchObject({ field_id: "f1", amount: 10 });
  });

  it("agrupa mensagens dentro da conversa correspondente", () => {
    const out = buildExportPayload({
      ...empty,
      threads: [
        { id: "t1", user_id: "u1", title: "Custos" },
        { id: "t2", user_id: "u1", title: "Preços" },
      ],
      messages: [
        { id: "m1", user_id: "u1", thread_id: "t1", role: "user", content: "oi" },
        { id: "m2", user_id: "u1", thread_id: "t1", role: "assistant", content: "olá" },
        { id: "m3", user_id: "u1", thread_id: "t2", role: "user", content: "preço?" },
      ],
    });
    expect((out.ai_threads[0]!["messages"] as unknown[]).length).toBe(2);
    expect((out.ai_threads[1]!["messages"] as unknown[]).length).toBe(1);
    expect(out.ai_threads[0]!["messages"]).not.toHaveProperty("0.thread_id");
  });

  it("descarta mensagens órfãs de conversas de outra origem", () => {
    const out = buildExportPayload({
      ...empty,
      threads: [{ id: "t1", title: "Minha" }],
      messages: [
        { id: "m1", thread_id: "t1", content: "minha" },
        { id: "m2", thread_id: "t-outro", content: "de outro" },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("de outro");
  });

  it("suporta volume grande sem perder registros", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `c${i}`, user_id: "u1", amount: i }));
    const out = buildExportPayload({ ...empty, costs: many });
    expect(out.costs.length).toBe(5000);
    expect(out.costs[4999]).toEqual({ id: "c4999", amount: 4999 });
  });

  it("nome do arquivo é estável e sem caracteres inválidos", () => {
    const name = exportFileName(new Date("2026-03-04T05:06:07.000Z"));
    expect(name).toBe("agrointel-meus-dados-2026-03-04-05-06-07.json");
    expect(name).not.toMatch(/[:/\\]/);
  });
});
