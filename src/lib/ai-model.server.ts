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
// A regra de escolha fica em ai-config.ts (pura e testada).

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { resolveAiConfig } from "@/lib/ai-config";

/** Modelo pronto para generateText/streamText, ou a mensagem do que falta configurar. */
export function createAiModel(env: Record<string, string | undefined> = process.env) {
  const resolved = resolveAiConfig(env);
  if ("error" in resolved) return { error: resolved.error } as const;
  const { config } = resolved;
  if (config.provider === "lovable") {
    const gateway = createLovableAiGatewayProvider(config.apiKey);
    return { model: gateway(config.modelId), provider: config.provider } as const;
  }
  const custom = createOpenAICompatible({
    name: "custom",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  return { model: custom(config.modelId), provider: config.provider } as const;
}
