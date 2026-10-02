# Cobrança (Sprint 3.4B) — arquitetura provider-agnostic

**Estado:** nenhum gateway de pagamento está definido nem configurado. Nenhum SDK
instalado, nenhum checkout real, nenhum webhook público, nenhuma cobrança.

## Auditoria inicial
- Dependências de pagamento: nenhuma.
- Secrets de pagamento: nenhum (existentes: LOVABLE_API_KEY, SUPABASE_*).
- Checkout: não existe. Webhook: não existe. Tabelas de pagamento: não existiam.
- Referências a Stripe/Mercado Pago/Pagar.me/Asaas/Nexano/PagSeguro: nenhuma.

## Fluxo de autoridade
Gateway → webhook com assinatura validada → `subscriptions` → entitlement engine → recursos premium.
O redirect de sucesso do checkout NUNCA ativa assinatura. O frontend nunca grava status.

## Módulos
- `src/lib/billing/types.ts` — contratos (`BillingProvider`, `PlanVariant`, eventos normalizados).
- `src/lib/billing/plans.ts` — `PLAN_CATALOG` (`pro_monthly`, `pro_yearly`) **sem preço e sem price ID**; `available: false`.
- `src/lib/billing/status.ts` — `mapProviderStatus()` e `shouldApplyUpdate()` (ordem dos eventos).
- `src/lib/billing/provider.server.ts` — registro do adapter; hoje `resolveProvider()` = `null` → `BILLING_NOT_CONFIGURED`.
- `src/lib/billing/webhook.server.ts` — idempotência (`claimWebhookEvent`) e localização por IDs persistidos.
- `src/lib/billing/billing.functions.ts` — `getBillingStatus`, `createCheckout`, `openBillingPortal`, `cancelMySubscription` (autenticadas; hoje bloqueiam).

## Checkout (quando houver gateway)
1. `requireSupabaseAuth` → `context.userId`. 2. Carregar subscription server-side.
3. Localizar/criar customer; persistir `provider_customer_id` server-side. 4. Resolver variante só pelo catálogo.
5. Criar sessão e devolver apenas a URL. O cliente envia só `planKey`; preço, moeda, desconto, trial, status e IDs são ignorados.
Sem segundo trial no gateway: o trial de 7 dias interno é a única fonte.

## Webhook (quando houver gateway)
Rota `src/routes/api/public/billing/<provider>.ts`: valida assinatura com secret server-side **antes** de tocar no banco
(inválida → 401 + `webhook_invalid_signature`), reserva o evento em `billing_events`, localiza a assinatura por
`provider_subscription_id`/`provider_customer_id` (metadata nunca é prova isolada), aplica com service role apenas se
`shouldApplyUpdate` permitir, finaliza o evento e audita.

## Idempotência
`billing_events` com `UNIQUE(provider, provider_event_id)`. Repetição → violação única → ignorado sem efeito.
Não guarda payload, apenas tipo, status e código de erro curto.

## Eventos fora de ordem
Evento cujo `current_period_ends_at` é anterior ao já conhecido é descartado; evento sem período e mais antigo
que o último `updated_at` também.

## Mapeamento de status
| Provedor | Interno |
|---|---|
| trialing, in_trial | trialing |
| active, authorized, paid, approved | active |
| past_due, unpaid, payment_failed, overdue, suspended | past_due |
| canceled, cancelled, ended | canceled |
| expired | expired |
| incomplete, pending, desconhecido | incomplete |

Falha de pagamento → `past_due` + `payment_failed`, sem grace period inventado (o engine já mantém acesso até o fim do período pago).

## Cancelamento e portal
Preferência `cancel_at_period_end = true`; acesso até `current_period_ends_at`. Portal oficial do gateway para cartão/faturas — sem tela própria de cartão.

## RLS
`subscriptions`: cliente só lê a própria linha. `billing_events`: nenhum acesso do cliente (sem GRANT para anon/authenticated); só service role.

## LGPD
Exportação já remove `provider`, `provider_customer_id`, `provider_subscription_id`; `billing_events` não é exportado.
Exclusão de conta (quando houver gateway): cancelar a recorrência no gateway antes de excluir; se o cancelamento não puder ser confirmado, a exclusão é **interrompida** com mensagem ao usuário — nunca deixar cobrança órfã. Hoje não há recorrência possível, então a exclusão segue inalterada.

## Erros
`BILLING_NOT_CONFIGURED`, `INVALID_PLAN`, `CHECKOUT_FAILED`, `WEBHOOK_INVALID`, `PAYMENT_PENDING`, `SUBSCRIPTION_PAST_DUE` — mensagens PT-BR, nunca erro cru do SDK.

## Secrets necessários (futuros, só nomes)
`BILLING_PROVIDER` + do provedor escolhido, por exemplo:
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Mercado Pago: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`
- Pagar.me: `PAGARME_SECRET_KEY`, `PAGARME_WEBHOOK_SECRET`
- Asaas: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`
Nunca com prefixo `VITE_`.

## Sandbox
Ciclo completo (checkout → webhook → active → renovação → falha → cancelamento) só será testado no ambiente de teste do gateway escolhido.
