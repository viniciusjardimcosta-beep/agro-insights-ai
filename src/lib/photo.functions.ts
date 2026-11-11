import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createCorrelationId } from "@/lib/audit.server";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { createAiModel } from "@/lib/ai-model.server";
import {
  MAX_PHOTO_BYTES,
  NOTEBOOK_SYSTEM,
  NOTEBOOK_USER,
  PHOTO_MONTHLY_LIMIT,
  monthlyAllowed,
  parseNotebookResponse,
  sniffImage,
} from "@/lib/notebook-photo";

/** Quantas leituras de foto o usuário já usou nos últimos 30 dias. */
export const getPhotoUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { countUsageSince } = await import("@/lib/rate-limit.server");
    const used = await countUsageSince(context.supabase, "photo_ai_read", 30);
    return { used, limit: PHOTO_MONTHLY_LIMIT };
  });

/**
 * Lê uma foto de caderno e devolve os lançamentos encontrados. NÃO grava nada: o usuário confere e só então importa.
 * Ordem: autenticação -> assinatura -> validação da imagem -> limites -> IA. A imagem não é guardada nem registrada.
 */
export const readNotebookPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ image: z.string().min(100).max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const correlationId = createCorrelationId();

    const { requireEntitlement } = await import("@/lib/subscription.server");
    const { FEATURES } = await import("@/lib/entitlements");
    await requireEntitlement(context.supabase, FEATURES.AI_CONSULTANT, correlationId);

    const bytes = new Uint8Array(Buffer.from(data.image, "base64"));
    const mime = sniffImage(bytes);
    if (!mime || bytes.length > MAX_PHOTO_BYTES) {
      throw new Error("Não consegui abrir essa imagem. Tire a foto de novo ou escolha um arquivo JPG ou PNG.");
    }

    const ai = createAiModel();
    if ("error" in ai) throw new Error(ai.error);

    const { checkRateLimit, countUsageSince, PHOTO_MONTHLY_LIMIT_MESSAGE, PHOTO_RATE_LIMIT_MESSAGE } = await import(
      "@/lib/rate-limit.server"
    );

    // 1) limite mensal (só lê); 2) limite por hora/dia, que também registra o uso de forma atômica.
    const used = await countUsageSince(context.supabase, "photo_ai_read", 30);
    if (!monthlyAllowed(used)) {
      throw new AppError({
        code: ERROR_CODES.AI_RATE_LIMITED,
        status: 429,
        correlationId,
        userMessage: PHOTO_MONTHLY_LIMIT_MESSAGE,
      });
    }
    const limit = await checkRateLimit(context.supabase, "photo_ai_read");
    if (!limit.allowed) {
      throw new AppError({
        code: ERROR_CODES.AI_RATE_LIMITED,
        status: 429,
        correlationId,
        userMessage: PHOTO_RATE_LIMIT_MESSAGE,
      });
    }

    try {
      const { text } = await generateText({
        model: ai.model,
        system: NOTEBOOK_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: NOTEBOOK_USER },
              { type: "image", image: bytes, mediaType: mime },
            ],
          },
        ],
        abortSignal: AbortSignal.timeout(45_000),
      });
      const parsed = parseNotebookResponse(text);
      return { ...parsed, used: used + 1, limit: PHOTO_MONTHLY_LIMIT };
    } catch (err) {
      // Nada da imagem nem da resposta da IA vai para o log: só o tipo do erro.
      console.error("[foto-caderno] falha na leitura", { name: (err as Error)?.name });
      throw new Error("Não consegui ler essa foto. Tente de novo com mais luz e a página inteira enquadrada.");
    }
  });
