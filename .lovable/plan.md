## AgroIntel AI — Plano de construção

SaaS para produtores rurais controlarem talhões, custos e lucro, com Consultor IA conectado aos dados via Lovable AI Gateway.

### Stack
- TanStack Start + React + Tailwind (template atual)
- Lovable Cloud (Supabase) — auth email/senha, Postgres com RLS
- Lovable AI Gateway (Gemini) para o Consultor IA
- shadcn/ui + AI Elements para o chat
- Recharts para gráficos

### Identidade visual
- Paleta: verde campo (#2F7D32 base), verde escuro, off-white, cinza neutro
- Tipografia: Plus Jakarta Sans (display) + Inter (corpo)
- Estilo: limpo, financeiro/agro, cards com sombras suaves, ícones Lucide (sprout, tractor, banknote, bar-chart)
- Responsivo: sidebar no desktop, bottom-nav no mobile

### Estrutura de rotas
```
/                           landing pública
/auth                       login + cadastro (tabs)
/_authenticated/dashboard   KPIs + alertas
/_authenticated/propriedades   CRUD propriedades
/_authenticated/talhoes        CRUD talhões
/_authenticated/custos         CRUD lançamentos de custo
/_authenticated/precos         preços de saca por cultura
/_authenticated/relatorios     gráficos e comparações
/_authenticated/consultor             lista de threads do Consultor IA
/_authenticated/consultor/$threadId   conversa específica
/api/chat                   stream do Consultor IA
```

### Banco de dados (migrations)
Tabelas com `user_id uuid not null` e RLS `auth.uid() = user_id`:
- `profiles` (id=auth.users, email, name)
- `properties` (name, city, state, total_area)
- `fields` (property_id, name, area, crop, season, planting_date, estimated_yield, real_yield)
- `costs` (field_id, category, description, amount, date, notes)
- `prices` (crop, price_per_bag, date)
- `ai_threads` (id, user_id, title, updated_at)
- `ai_messages` (id, thread_id, role, content, created_at)

Trigger `handle_new_user` cria profile automático. GRANTs explícitos para `authenticated` em todas as tabelas. Trigger updates `updated_at` em ai_threads.

### Funcionalidades

**1. Landing (`/`)**
Hero "AgroIntel AI — O copiloto inteligente do produtor rural", CTA "Começar agora" → `/auth`. Seções: Controle de custos, Lucro por hectare, Gestão de talhões, Consultor IA. SEO completo (title, description, og).

**2. Auth (`/auth`)**
Email + senha (signUp com `emailRedirectTo`, signIn, signOut). Listener `onAuthStateChange` no root invalida queries. Layout `_authenticated/route.tsx` (`ssr:false`) gateia com `getUser()` → redirect `/auth`.

**3. Dashboard**
Cards: Área total, Custo total, Receita estimada, Lucro estimado, Lucro/ha, Nº talhões. Alertas calculados (custo/ha alto vs receita/ha, ponto de equilíbrio em sacas/ha). Botão "Carregar dados de demonstração" (insere Fazenda Santa Maria + 2 talhões + custos + preços via server fn).

**4–7. CRUDs** (propriedades, talhões, custos, preços)
Dialogs do shadcn com react-hook-form + zod. Listagens em tabela responsiva (cards no mobile). Todos via `createServerFn` com `requireSupabaseAuth`.

**8. Relatórios**
Recharts: barras (custo por categoria), barras (lucro por talhão), tabela "mais/menos lucrativo". Cálculos no servidor.

**9. Consultor IA (threads)**
- Sidebar com lista de threads + botão "Nova conversa"
- Rota `/consultor/$threadId` com chat keyed por threadId
- AI Elements: Conversation, Message, MessageResponse, PromptInput, Shimmer
- Server route `/api/chat` (stream): carrega snapshot dos dados do usuário (resumo de talhões, custos, preços) e injeta no system prompt; usa `google/gemini-3-flash-preview` via helper `createLovableAiGatewayProvider`
- Persiste mensagens em `ai_messages` no `onFinish` (UUID do DB, não IDs `msg_...`)
- Mensagens assistant sem fundo, user com bubble `primary`
- Logo do agente: ícone "sprout" estilizado (gerado), não Sparkles

**10. Cálculos (helpers compartilhados)**
- custoTotal, custoHa, receitaEstimada (área × yield × preço), lucroEstimado, lucroHa, breakeven (custoHa / preço)

**11. Dados demo**
Server fn `seedDemoData`: cria Fazenda Santa Maria (Sorriso/MT, 35ha), Talhão 1 (20ha soja, yield 65), Talhão 2 (15ha milho, yield 180), ~6 custos por talhão, preços soja R$125 / milho R$60.

### Segurança
- RLS habilitado em todas as tabelas, policies por `auth.uid() = user_id`
- GRANTs explícitos para `authenticated`
- `attachSupabaseAuth` em `src/start.ts` functionMiddleware
- LOVABLE_API_KEY apenas server-side; chat route valida thread pertence ao usuário antes de stream

### Entregáveis
- Migrations SQL completas
- ~25 arquivos: rotas, server fns (`.functions.ts`), helper AI gateway (`.server.ts`), componentes de UI, layout app com sidebar/bottom-nav
- AI Elements instalados (`conversation message prompt-input shimmer`)
- Logo gerado para o agente

Primeira versão funcional pronta para demo a produtores.
