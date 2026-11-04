// Escolha do provedor de IA por variáveis de ambiente (sem mudar código).
//
//   AI_PROVIDER = "lovable" (padrão) | "custom"
//
// lovable: usa o gateway de IA do Lovable.  Precisa de LOVABLE_API_KEY.
// custom:  qualquer API compatível com OpenAI (ex.: a da Anthropic em
//          https://api.anthropic.com/v1/, OpenAI, OpenRouter).
//          Precisa de AI_API_KEY, AI_BASE_URL (https) e AI_MODEL.
// AI_MODEL também pode ser usada com "lovable" para trocar o modelo.
//
// Este arquivo é puro (sem rede, sem pacotes) para ser testável.

export const DEFAULT_LOVABLE_MODEL = "google/gemini-3-flash-preview";

export type AiConfig =
  | { provider: "lovable"; apiKey: string; modelId: string }
  | { provider: "custom"; apiKey: string; baseURL: string; modelId: string };

type Env = Record<string, string | undefined>;

export function resolveAiConfig(env: Env): { config: AiConfig } | { error: string } {
  const provider = (env.AI_PROVIDER ?? "").trim().toLowerCase() || "lovable";

  if (provider === "lovable") {
    const apiKey = env.LOVABLE_API_KEY?.trim();
    if (!apiKey) return { error: "LOVABLE_API_KEY não configurada" };
    const modelId = env.AI_MODEL?.trim() || DEFAULT_LOVABLE_MODEL;
    return { config: { provider: "lovable", apiKey, modelId } };
  }

  if (provider === "custom") {
    const apiKey = env.AI_API_KEY?.trim();
    const baseURL = env.AI_BASE_URL?.trim().replace(/\/+$/, "");
    const modelId = env.AI_MODEL?.trim();
    if (!apiKey) return { error: "AI_API_KEY não configurada" };
    if (!baseURL) return { error: "AI_BASE_URL não configurada" };
    if (!/^https:\/\//i.test(baseURL)) return { error: "AI_BASE_URL deve começar com https://" };
    if (!modelId) return { error: "AI_MODEL não configurada" };
    return { config: { provider: "custom", apiKey, baseURL, modelId } };
  }

  return { error: `AI_PROVIDER inválido: use "lovable" ou "custom"` };
}
