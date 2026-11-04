import { describe, expect, it } from "vitest";
import { DEFAULT_LOVABLE_MODEL, resolveAiConfig } from "@/lib/ai-config";

describe("resolveAiConfig", () => {
  it("padrão: gateway do Lovable com o modelo atual (comportamento inalterado)", () => {
    expect(resolveAiConfig({ LOVABLE_API_KEY: "k" })).toEqual({
      config: { provider: "lovable", apiKey: "k", modelId: DEFAULT_LOVABLE_MODEL },
    });
  });

  it("lovable sem chave: erro com o nome da variável", () => {
    expect(resolveAiConfig({})).toEqual({ error: "LOVABLE_API_KEY não configurada" });
  });

  it("AI_MODEL troca o modelo no gateway do Lovable", () => {
    const r = resolveAiConfig({ LOVABLE_API_KEY: "k", AI_MODEL: "google/outro" });
    expect("config" in r && r.config.modelId).toBe("google/outro");
  });

  it("custom: usa chave, endereço e modelo próprios (barra final removida)", () => {
    expect(
      resolveAiConfig({
        AI_PROVIDER: "custom",
        AI_API_KEY: "sk-x",
        AI_BASE_URL: "https://api.exemplo.com/v1/",
        AI_MODEL: "modelo-1",
      }),
    ).toEqual({
      config: { provider: "custom", apiKey: "sk-x", baseURL: "https://api.exemplo.com/v1", modelId: "modelo-1" },
    });
  });

  it("custom: aponta o que falta", () => {
    expect(resolveAiConfig({ AI_PROVIDER: "custom" })).toEqual({ error: "AI_API_KEY não configurada" });
    expect(resolveAiConfig({ AI_PROVIDER: "custom", AI_API_KEY: "k" })).toEqual({ error: "AI_BASE_URL não configurada" });
    expect(
      resolveAiConfig({ AI_PROVIDER: "custom", AI_API_KEY: "k", AI_BASE_URL: "https://a.com" }),
    ).toEqual({ error: "AI_MODEL não configurada" });
  });

  it("custom: recusa endereço sem https", () => {
    expect(
      resolveAiConfig({ AI_PROVIDER: "custom", AI_API_KEY: "k", AI_BASE_URL: "http://a.com", AI_MODEL: "m" }),
    ).toEqual({ error: "AI_BASE_URL deve começar com https://" });
  });

  it("provedor desconhecido é recusado", () => {
    const r = resolveAiConfig({ AI_PROVIDER: "foo" });
    expect("error" in r).toBe(true);
  });

  it("AI_PROVIDER não diferencia maiúsculas e ignora espaços", () => {
    const r = resolveAiConfig({ AI_PROVIDER: " Lovable ", LOVABLE_API_KEY: "k" });
    expect("config" in r).toBe(true);
  });
});
