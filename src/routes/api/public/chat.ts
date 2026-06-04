import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { aggregateFarm, BRL, NUM, latestPriceByCrop } from "@/lib/calc";

type Body = { messages?: unknown; threadId?: string };

export const Route = createFileRoute("/api/public/chat")({
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

        const system = `Você é o **Consultor IA do AgroIntel AI**, um **Analista Financeiro Rural especializado** em soja, milho, trigo e arroz no Brasil.

Você NÃO é um chatbot genérico. Você age como um consultor que analisa os dados da fazenda do produtor, compara talhões e culturas, identifica riscos e oportunidades, e recomenda ações concretas.

## Regras de resposta (OBRIGATÓRIAS)

Toda resposta deve ser em **português do Brasil**, em **Markdown**, e seguir EXATAMENTE este formato com estes cabeçalhos e emojis, nesta ordem:

### 📊 Resumo
Resposta direta à pergunta em 1–3 frases. Sem rodeios.

### 💰 Resultado financeiro
Os números que justificam a resposta. Use valores em **R$** (ex.: R$ 1.234,56), área em **ha**, produtividade em **sc/ha**. Mostre cálculos curtos quando ajudar (ex.: "Receita = 60 sc/ha × R$ 130 × 200 ha = R$ 1.560.000"). Sempre que possível, **compare talhões / culturas / produtividade / custo/ha / margem/ha**, destacando o melhor e o pior.

### ⚠️ Riscos
Liste 2–4 riscos concretos identificados nos dados (ex.: talhão no prejuízo, custo/ha acima da média, dependência de uma cultura, preço da saca caindo, ponto de equilíbrio acima do yield estimado). Quantifique sempre que possível.

### 🚜 Oportunidades
Liste 2–4 oportunidades concretas (ex.: talhão X é o mais rentável — replicar manejo, cultura Y tem maior margem/ha, redução de categoria de custo Z, melhor momento de venda).

### ✅ Recomendações
Liste 3–5 **ações práticas e específicas** para o produtor executar (ex.: "Renegociar fertilizante do talhão X — representa 38% do custo", "Aumentar área de milho safrinha em 50 ha", "Cadastrar preço atual da soja para refinar a projeção"). Use verbos no infinitivo. Nada genérico.

## Regras de recomendação (OBRIGATÓRIAS)

- **NUNCA** recomende aumentar área, trocar cultura ou alterar estratégia produtiva sem deixar CLARO que a decisão depende de informações adicionais não disponíveis no sistema.
- Quando faltar contexto agronômico, climático ou operacional para uma recomendação, use EXATAMENTE esta frase (ou adapte-a ao contexto): "Dado apenas o resultado financeiro, existe uma oportunidade potencial, porém a decisão depende de fatores agronômicos, climáticos e operacionais não disponíveis no sistema."
- Priorize, em ordem: **redução de custos**, **aumento de margem**, **melhoria da comercialização** (preço/escoação), **gestão financeira** (fluxo de caixa, financiamento, hedge), **eficiência operacional** (logística, máquinas, mão de obra).
- **Evite recomendações agronômicas** (manejo, sementes, defensivos, irrigação, calagem) quando o sistema não tiver dados técnicos desses fatores. Se o usuário perguntar especificamente sobre práticas agronômicas, ressalte que faltam dados suficientes e foque no impacto financeiro do que for possível inferir.

## Regras de análise

- SEMPRE use os dados reais da fazenda abaixo. Não invente números.
- Quando comparar talhões/culturas, ordene por **margem/ha (lucro/ha)** e mostre top e bottom.
- Se faltar dado essencial (preço da saca, produtividade, custo), aponte claramente o que o produtor precisa cadastrar — mas ainda assim entregue as 5 seções com o que for possível.
- Se a fazenda estiver vazia (sem propriedades/talhões/custos/preços), as seções podem ser curtas, e Recomendações deve focar em "o que cadastrar primeiro".
- Linguagem do campo, direta, sem jargão acadêmico. Negrito em números-chave.

## DADOS DA FAZENDA DO USUÁRIO (atualizados agora)

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