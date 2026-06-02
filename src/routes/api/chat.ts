import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { aggregateFarm, BRL, NUM, latestPriceByCrop } from "@/lib/calc";

type Body = { messages?: unknown; threadId?: string };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Backend não configurado", { status: 500 });
        }
        if (!LOVABLE_API_KEY) {
          return new Response("LOVABLE_API_KEY não configurada", { status: 500 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Não autenticado", { status: 401 });
        }
        const token = authHeader.slice(7);

        const body = (await request.json()) as Body;
        const { messages, threadId } = body;
        if (!Array.isArray(messages) || !threadId) {
          return new Response("Requisição inválida", { status: 400 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: claims } = await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return new Response("Token inválido", { status: 401 });

        // Verify thread ownership
        const { data: thread } = await supabase
          .from("ai_threads")
          .select("id, title")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread) return new Response("Conversa não encontrada", { status: 404 });

        // Load farm snapshot
        const [props, fields, costs, prices] = await Promise.all([
          supabase.from("properties").select("name, city, state, total_area"),
          supabase.from("fields").select("*"),
          supabase.from("costs").select("field_id, category, amount, date, description"),
          supabase.from("prices").select("crop, price_per_bag, date"),
        ]);

        const farm = aggregateFarm(
          (fields.data ?? []) as never,
          (costs.data ?? []) as never,
          (prices.data ?? []) as never,
        );
        const priceByCrop = latestPriceByCrop((prices.data ?? []) as never);

        const summary = [
          `Propriedades: ${(props.data ?? []).map((p) => `${p.name} (${p.city ?? "-"}/${p.state ?? "-"}, ${p.total_area} ha)`).join("; ") || "nenhuma cadastrada"}`,
          `Total: área ${NUM.format(farm.totalArea)} ha | custo ${BRL.format(farm.totalCost)} | receita estimada ${BRL.format(farm.totalRevenue)} | lucro estimado ${BRL.format(farm.totalProfit)} | lucro/ha ${BRL.format(farm.profitPerHa)}`,
          `Preços atuais por saca: ${Object.entries(priceByCrop).map(([c, p]) => `${c} ${BRL.format(p)}`).join(", ") || "sem preços cadastrados"}`,
          "Talhões:",
          ...farm.perField.map(
            (f) =>
              `- ${f.field.name} (${f.field.crop}, ${NUM.format(f.area)} ha): yield ${NUM.format(f.yieldBag)} sc/ha, custo ${BRL.format(f.totalCost)} (${BRL.format(f.costPerHa)}/ha), receita estimada ${BRL.format(f.revenue)}, lucro ${BRL.format(f.profit)} (${BRL.format(f.profitPerHa)}/ha), ponto de equilíbrio ${NUM.format(f.breakevenBagPerHa)} sc/ha`,
          ),
        ].join("\n");

        const system = `Você é o Consultor IA do AgroIntel AI, um copiloto financeiro para produtores rurais brasileiros (soja, milho, trigo, arroz).

Responda em português do Brasil, de forma direta, prática e objetiva. Use linguagem do campo, sem jargão financeiro desnecessário.
Use Markdown leve (negrito, listas curtas, valores em R$).
Quando o usuário perguntar sobre lucro, prejuízo, ponto de equilíbrio, sensibilidade de preço ou qual talhão está melhor, use os dados abaixo. Mostre cálculos resumidos quando ajudar.
Se faltar dado (sem preço, sem produtividade, etc.), diga claramente o que cadastrar.

DADOS DA FAZENDA DO USUÁRIO (atualizados agora):
${summary}`;

        const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
          onFinish: async ({ messages: finalMessages }) => {
            try {
              // Persist any new messages not yet stored
              const { data: existing } = await supabase
                .from("ai_messages")
                .select("content, role, created_at")
                .eq("thread_id", threadId);
              const existingKeys = new Set(
                (existing ?? []).map((m) => `${m.role}::${m.content}`),
              );
              const toInsert = finalMessages
                .map((m) => {
                  const text = m.parts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("");
                  return { role: m.role, content: text };
                })
                .filter((m) => m.content && !existingKeys.has(`${m.role}::${m.content}`))
                .map((m) => ({ ...m, thread_id: threadId, user_id: userId }));
              if (toInsert.length) {
                await supabase.from("ai_messages").insert(toInsert);
              }
              // Update thread title from first user message if still default
              if (thread.title === "Nova conversa") {
                const firstUser = finalMessages.find((m) => m.role === "user");
                if (firstUser) {
                  const text = firstUser.parts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("")
                    .slice(0, 80);
                  await supabase
                    .from("ai_threads")
                    .update({ title: text || "Nova conversa", updated_at: new Date().toISOString() })
                    .eq("id", threadId);
                }
              } else {
                await supabase
                  .from("ai_threads")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", threadId);
              }
            } catch (e) {
              console.error("[chat onFinish] persist error", e);
            }
          },
        });
      },
    },
  },
});