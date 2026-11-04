# Cobrança — Stripe (TEST MODE)

**Estado:** adapter Stripe implementado, **somente test mode** (fail-closed). Nenhuma cobrança real.
A integração Asaas foi removida (nunca recebeu credenciais nem processou cobrança; banco sem dados Asaas:
`provider_customer_id`, `provider_subscription_id`, `billing_checkouts` e `billing_events` estavam vazios).

## Documentação oficial consultada (out/2026)
- Checkout Sessions: https://docs.stripe.com/api/checkout/sessions/create (`mode=subscription`, `subscription_data.trial_end` ≥ 48h no futuro, `expires_at` 30 min–24 h)
- Subscriptions: https://docs.stripe.com/api/subscriptions/object (desde 2025-03-31 os períodos ficam em `items.data[].current_period_*` — o adapter lê os dois formatos)
- Customer Portal: https://docs.stripe.com/api/customer_portal/sessions/create e /configurations
- Webhooks e assinatura: https://docs.stripe.com/webhooks#verify-manually
- Idempotência: https://docs.stripe.com/api/idempotent_requests
- Test Clocks: https://docs.stripe.com/billing/testing/test-clocks

## Endpoints usados (`https://api.stripe.com/v1`, sem SDK — fetch + WebCrypto, compatível com o runtime)
| Uso | Endpoint |
|---|---|
| Validar Price | `GET /prices/{id}` |
| Customer | `POST /customers` (Idempotency-Key por usuário) |
| Checkout | `POST /checkout/sessions` (Idempotency-Key = id interno do checkout) |
| Estado autoritativo | `GET /subscriptions/{id}` |
| Agendar/desfazer cancelamento | `POST /subscriptions/{id}` `cancel_at_period_end` |
| Exclusão de conta | `GET /subscriptions?customer=…&status=all` + `DELETE /subscriptions/{id}` |
| Portal | `POST /billing_portal/configurations` (uma vez) + `POST /billing_portal/sessions` |

## Configuração
| Nome | Valor |
|---|---|
| `BILLING_PROVIDER` | `stripe` |
| `STRIPE_ENVIRONMENT` | `test` (qualquer outro valor desliga a cobrança) |
| `STRIPE_SECRET_KEY` | `sk_test_…` ou `rk_test_…` — chave `sk_live_` é recusada |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` do endpoint de webhook |
| `STRIPE_PRICE_PRO_MONTHLY` / `_PRO_YEARLY` / `_PRO_FOUNDER_MONTHLY` | `price_…` de test mode |

Nenhum com `VITE_`. Não há chave publicável: o Checkout é hospedado (redirect), então ela não é necessária.

## Products/Prices (criar no Dashboard em Test mode)
| plan_code | Price |
|---|---|
| pro_monthly | BRL 99,90, recorrente mensal |
| pro_yearly | BRL 999,00, recorrente anual |
| pro_founder_monthly | BRL 69,90, recorrente mensal |
Sem trial no Price. Antes de cada checkout o servidor confere moeda, valor, ciclo, `active`, `livemode=false` e ausência de trial; divergência → contratação recusada.

## Webhook
URL: `https://project--997eb3bd-6a18-4733-81ce-d1f75d24208f-dev.lovable.app/api/public/billing/stripe`

| Evento | Por quê |
|---|---|
| `checkout.session.completed` | marca o checkout como concluído e sincroniza a assinatura criada (não ativa sozinho) |
| `checkout.session.expired` | encerra o checkout pendente |
| `customer.subscription.created/updated/deleted` | trial, ativação, past_due, cancelamento agendado, encerramento |
| `invoice.paid` | pagamento/renovação confirmados |
| `invoice.payment_failed` | falha → past_due |

Processamento: corpo bruto lido como texto → `Stripe-Signature` verificado (HMAC-SHA256, tolerância 5 min, comparação em tempo constante) → evento `livemode` recusado → reserva `billing_events(provider, provider_event_id)` UNIQUE (duplicado = 200 sem efeito) → **busca a Subscription atual na Stripe pelo ID** e reconcilia (`reconcile.ts`, puro). Como sempre aplicamos o estado mais recente, eventos fora de ordem não regridem nada; ainda assim um período mais antigo nunca sobrescreve um mais novo e assinatura encerrada não "revive". Atualização com concorrência otimista; conflito → 503 (Stripe retenta).

Identidade: o Customer é criado pelo servidor antes do Checkout e gravado em `subscriptions.provider_customer_id` (índice único). Toda assinatura só é aplicada se o customer dela for o customer gravado do usuário. `metadata` nunca é autoridade.

## Trial
Trial interno de 7 dias continua a única fonte e NINGUÉM é cobrado antes do fim dele (Sprint 3.5). Se restarem ≥ 49h, o Checkout recebe `subscription_data.trial_end = trial_ends_at` (a Stripe exige ≥ 48h): cartão registrado agora, 1ª cobrança no fim do teste, sem trial extra. Com menos de 49h de trial restante, o Checkout roda em `mode=setup` (cadastra o cartão SEM cobrança) e, após o `checkout.session.completed` verificado, o servidor cria a assinatura via API com `trial_end = trial_ends_at` original (Idempotency-Key por checkout; se o trial já tiver vencido nesse meio-tempo, a cobrança imediata é correta). Fora do trial, a cobrança acontece na conclusão do Checkout. Status `trialing` na Stripe só vincula IDs; datas internas intocadas.

## Status
| Stripe | Interno | Auditoria |
|---|---|---|
| trialing | trialing (inalterado) | — |
| active (1ª vez) | active + período da Stripe | subscription_activated (consome Fundador) |
| active (período avança) | active | subscription_renewed |
| past_due / unpaid | past_due | payment_failed |
| cancel_at_period_end=true | mantém status | subscription_cancel_scheduled |
| canceled / incomplete_expired | canceled, mantém fim do período | subscription_canceled |
| incomplete / paused | sem mudança de status | — |

## Cancelamento, reativação e Portal
- Botão "Cancelar" e Portal resultam no mesmo estado: `cancel_at_period_end`. A configuração do Portal criada pelo AgroIntel (`metadata.agrointel=agrointel_v1`) permite cancelamento **somente no fim do período**, troca de cartão e faturas; troca de plano e edição de dados desabilitadas.
- "Manter assinatura" desfaz o agendamento na mesma assinatura (mesmo preço; Fundador preservado).
- Portal: o customer vem sempre da conta autenticada.

## Exclusão de conta
`deleteMyAccount` encerra **imediatamente** todas as assinaturas do customer na Stripe e confere que nenhuma restou (cancel_at_period_end não basta). Falha → exclusão abortada com a mensagem "Não foi possível confirmar o cancelamento da assinatura. Sua conta não foi excluída para evitar uma cobrança futura."

## Admin
Continua só lendo billing (eventos sanitizados: provider, event_type, status, processed_at, error_code) e concedendo/revogando elegibilidade Fundador. Não ativa assinatura, não aprova pagamento, não edita IDs nem preço.

## Test Clocks
Compatíveis: um customer criado em um test clock permite avançar o tempo (trial, renovação, falha, fim de período). Como o servidor cria o customer, o uso exige criar o customer de teste manualmente no clock e associá-lo a uma conta de teste via SQL — documentado aqui, não automatizado.

## Pendências
E2E real (cenários A–H) depende das chaves de teste e dos três Price IDs.
