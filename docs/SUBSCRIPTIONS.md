# Assinaturas, Trial e Entitlements — AgroIntel AI

> **Nenhum gateway financeiro está conectado nesta etapa.**
> Não há checkout, cobrança, cartão ou webhook de pagamento. Esta é a fundação
> de autorização comercial (Sprint 3.4A); a cobrança real vem na Sprint 3.4B.

## Modelo de dados

Tabela `public.subscriptions` — **uma linha por usuário** (`UNIQUE(user_id)`):

| Campo | Uso |
| --- | --- |
| `plan_code` | código técnico do plano (`trial`, `pro`, …) — sem preço |
| `status` | status canônico (ver abaixo) |
| `trial_started_at` / `trial_ends_at` | janela do teste gratuito |
| `current_period_started_at` / `current_period_ends_at` | período contratado |
| `cancel_at_period_end` / `canceled_at` | cancelamento |
| `provider`, `provider_customer_id`, `provider_subscription_id` | reservados para o gateway (Sprint 3.4B) |

Nunca armazenamos: cartão, CVV, dados bancários, payload de gateway, secrets.

## Estados canônicos

`trialing` · `active` · `past_due` · `canceled` · `expired` · `incomplete`

Definidos em `src/lib/entitlements.ts` (`SUBSCRIPTION_STATUS`). Não usar
strings soltas na aplicação.

## Trial

- `TRIAL_DAYS = 7`, valor único e central.
- Criado pela RPC `public.ensure_subscription()` (SECURITY DEFINER,
  `search_path` fixo, identidade de `auth.uid()`, sem parâmetros).
- Idempotência: `SELECT` prévio + `pg_advisory_xact_lock` por usuário +
  `UNIQUE(user_id)` com `ON CONFLICT DO NOTHING`.
- O trial começa quando o usuário entra no produto pela primeira vez
  (`ensureMySubscription()` no layout autenticado).
- **Novo trial é impossível** por logout/login, mudança de `plan_code`,
  chamadas repetidas ou manipulação do frontend: a linha nunca é apagada
  (só na exclusão da conta) e o cliente não tem permissão de escrita.

## Entitlement engine

- `src/lib/entitlements.ts` — puro: catálogo `FEATURES`, matriz
  (`full` / `baseline`), `computeAccess()`, `hasEntitlement()`,
  `blockedReason()`, `blockedMessage()`.
- `src/lib/subscription.server.ts` — `ensureSubscription()`,
  `getSubscriptionAccess()`, `requireEntitlement()` (server-only).
- `src/lib/subscription.functions.ts` — `ensureMySubscription()`,
  `getMySubscription()` (nunca retornam provider IDs).
- `src/hooks/use-subscription.ts` — apenas UX.

Baseline (sempre disponível, inclusive expirado): dashboard, propriedades,
talhões, custos, preços, configurações e **direitos LGPD** (exportar/excluir).

Premium: Diagnóstico por IA, Consultor IA, Central de Inteligência, Simulador,
Alertas inteligentes, Relatório Executivo PDF.

## Ordem de autorização

```
autenticação → entitlement → validação da requisição → rate limit → chamada externa
```

Entitlement vem **antes** do rate limit: um usuário sem assinatura não consome
quota de IA. Erros são distintos:

| Situação | HTTP | Código |
| --- | --- | --- |
| Trial vencido | 402 | `TRIAL_EXPIRED` |
| Assinatura inativa/cancelada/pendente | 402 | `SUBSCRIPTION_INACTIVE` |
| Sem assinatura | 402 | `SUBSCRIPTION_REQUIRED` |
| Limite de uso | 429 | `AI_RATE_LIMITED` / `DIAGNOSTIC_RATE_LIMITED` |

Rate limits permanecem inalterados: Consultor 30/h e 120/dia; Diagnóstico 10/24h.

## Guards server-side

- `generateDiagnostic` (`FEATURES.DIAGNOSTIC`)
- `POST /api/public/chat` (`FEATURES.AI_CONSULTANT`, responde 402)
- `createScenario` (`FEATURES.SIMULATOR`)
- `syncAlerts` (`FEATURES.ALERTS`)

Central de Inteligência e Relatório Executivo são derivações determinísticas de
dados já lidos pelo usuário (sem chamada paga); o bloqueio comercial é aplicado
na geração/sincronização que produz custo ou escrita, e na UX. Esconder botão
nunca é a autoridade.

## Expiração sem cron

Um acesso é válido enquanto `server_now < trial_ends_at` (ou
`current_period_ends_at`). Não existe job: `computeAccess()` compara datas a
cada requisição, então um `status = trialing` vencido já é negado.

## RLS e permissões

- `SELECT` apenas da própria linha (`auth.uid() = user_id`).
- Sem políticas de `INSERT`/`UPDATE`/`DELETE` para `authenticated` — o cliente
  não pode definir `status`, `trial_ends_at`, `plan_code` ou provider IDs.
- `ensure_subscription()`: `REVOKE` de `PUBLIC`/`anon`, `GRANT` a
  `authenticated`/`service_role`, e não aceita `user_id` arbitrário.

## LGPD

- Exportação inclui um bloco `subscription` (plano, status, datas) e remove
  `provider`, `provider_customer_id` e `provider_subscription_id`.
- Exclusão de conta: `subscriptions.user_id` tem `ON DELETE CASCADE` para
  `auth.users`, então a assinatura é removida junto com a conta.

## Auditoria

Eventos: `trial_started`, `trial_expired`, `subscription_access_denied`
(metadata apenas operacional: `error_code`, `operation`). Nada financeiro,
nenhum payload.

## Como testar

- `bunx vitest run` — `src/lib/entitlements.test.ts` cobre trial de 7 dias,
  bordas (futuro / exatamente agora / passado, em UTC), matriz, expiração sem
  cron e ausência de provider IDs.
- Cross-tenant/RLS: validado em banco simulando dois usuários — leitura
  isolada, `INSERT` rejeitado pela RLS e `UPDATE`/`DELETE` sem efeito.
- Para ativar Pro em desenvolvimento: `UPDATE` administrativo direto no banco
  (service role). **Não existe botão "Ativar Pro" no produto.**

## O que falta para cobrança real (Sprint 3.4B)

1. Escolher o gateway e definir preços comerciais.
2. Endpoint de webhook assinado em `src/routes/api/public/` atualizando
   `provider*`, `status`, período e `cancel_at_period_end` via service role.
3. Checkout a partir do CTA "Ver planos".
4. Eventos `subscription_activated`, `subscription_renewed`,
   `subscription_canceled`, `payment_failed`.
