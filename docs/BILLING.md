# Cobrança — Asaas (SANDBOX)

**Estado:** adapter Asaas implementado, **somente sandbox** (fail-closed). Nenhuma cobrança real.

## Documentação oficial consultada (out/2026)
- Checkout hospedado: https://docs.asaas.com/docs/asaas-checkout e /docs/checkout-com-assinatura-recorrente
- Eventos de Checkout: https://docs.asaas.com/docs/eventos-para-checkout
- Eventos de assinatura: https://docs.asaas.com/docs/eventos-para-assinaturas
- Webhooks / token / idempotência: /docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook, /docs/faq-de-webhooks

## Endpoints Asaas usados (base `https://api-sandbox.asaas.com/v3`, header `access_token`)
| Uso | Endpoint |
|---|---|
| Criar checkout recorrente | `POST /checkouts` (`billingTypes:[CREDIT_CARD]`, `chargeTypes:[RECURRENT]`, `subscription.cycle`, `subscription.nextDueDate`) |
| Localizar assinatura do cliente | `GET /subscriptions?customer=…&status=ACTIVE` |
| Cancelar recorrência | `DELETE /subscriptions/{id}` |

Webhook recebido em `POST /api/public/billing/asaas`. Eventos tratados:
`CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
`PAYMENT_OVERDUE`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`. Demais → ignorados.

## Configuração
| Nome | Tipo |
|---|---|
| `BILLING_PROVIDER` | `asaas` |
| `ASAAS_ENVIRONMENT` | `sandbox` (qualquer outro valor desliga a cobrança) |
| `ASAAS_API_KEY` | chave da conta **sandbox** (sandbox.asaas.com → Integrações → Chaves de API) |
| `ASAAS_WEBHOOK_TOKEN` | token forte (≥ 32 caracteres) cadastrado também no webhook do Asaas |

Nenhum com `VITE_`. O código não contém URL de produção do Asaas.

Configurar no painel sandbox do Asaas → Integrações → Webhooks: URL
`https://project--997eb3bd-6a18-4733-81ce-d1f75d24208f-dev.lovable.app/api/public/billing/asaas`, API v3,
**envio sequencial**, token = `ASAAS_WEBHOOK_TOKEN`, eventos listados acima.

## Planos (server-side)
| plan_code | Valor | Ciclo |
|---|---|---|
| pro_monthly | R$ 99,90 | mensal |
| pro_yearly | R$ 999,00 | anual (economia exata R$ 199,80 vs 12× mensal) |
| pro_founder_monthly | R$ 69,90 | mensal, exige elegibilidade |

## Fundador
- Tabela `billing_eligibility` (`founder_eligible`, `granted_at`, `consumed_at`). Usuário só lê; concessão apenas por servidor/admin (SQL ou service role).
- `createCheckout("pro_founder_monthly")` sem elegibilidade → `FOUNDER_PLAN_NOT_ELIGIBLE`.
- Na primeira ativação a elegibilidade é **consumida**. Renovações dependem só do `plan_code` gravado na assinatura (preço fixado no Asaas). Após encerramento, nova assinatura não recebe o preço fundador.
- LGPD: removida em cascata na exclusão; não é dado sensível.

## Trial e momento da cobrança
O trial interno (7 dias) é a única fonte. O checkout cria a assinatura no Asaas com `nextDueDate` = data de fim do trial (fuso de Brasília) — o cartão é registrado e a 1ª cobrança ocorre no fim do teste. Sem trial do gateway. Trial já vencido → 1ª cobrança hoje.

## Fluxo de checkout
1. `requireSupabaseAuth` → `context.userId`; cliente envia **só** `planCode` (demais campos descartados).
2. Valida plano e elegibilidade; bloqueia se já houver recorrência ativa.
3. Cria `billing_checkouts` (pendente, 30 min; índice único parcial: uma pendente por usuário — impede checkouts concorrentes).
4. Cria o Checkout no Asaas com `externalReference` = id interno opaco; devolve somente o link.
O Asaas coleta CPF/cartão na própria página → **o AgroIntel nunca recebe dados de cartão** (escopo PCI inalterado). Customer é criado pelo Asaas no checkout e vinculado via `CHECKOUT_PAID`.

## Webhook
1. Valida `asaas-access-token` (comparação em tempo constante) **antes de qualquer escrita**; inválido → 401 + `webhook_invalid_signature`.
2. Reserva `billing_events (provider, provider_event_id)` UNIQUE; repetido → 200 sem efeito.
3. Reconcilia (`reconcile.ts`, puro): identidade só por `billing_checkouts.provider_checkout_id` (criado por nós), `provider_customer_id` e `provider_subscription_id`. `metadata.user_id` é ignorado. Um customer nunca é vinculado a dois usuários.
4. Atualização com concorrência otimista (`updated_at`).
5. Cobrança que chega antes do `CHECKOUT_PAID` → reserva liberada + 503 (Asaas retenta). Use envio sequencial.

## Eventos fora de ordem
Período = `dueDate` da cobrança + ciclo do plano. Evento cujo fim de período ≤ ao já conhecido é descartado; cobrança de outra `provider_subscription_id` é ignorada.

## Status
| Evento | Interno | Auditoria |
|---|---|---|
| PAYMENT_CONFIRMED/RECEIVED (1ª) | active | subscription_activated |
| PAYMENT_CONFIRMED/RECEIVED (seguinte) | active, período avança | subscription_renewed |
| PAYMENT_OVERDUE / CAPTURE_REFUSED | past_due (sem grace period) | payment_failed |
| SUBSCRIPTION_DELETED/INACTIVATED | canceled, mantém fim do período | subscription_canceled |

## Cancelamento
O Asaas **não tem cancelamento no fim do período**. `cancelMySubscription` faz `DELETE /subscriptions/{id}` (nenhuma cobrança futura) e grava `status=canceled`, `cancel_at_period_end=true` mantendo `current_period_ends_at`: o entitlement engine preserva o acesso até lá. Durante o trial, o trial interno continua.

## Portal do cliente
O Asaas não oferece portal hospedado de assinatura. Não há tela de cartão no AgroIntel: o usuário vê o status e pode cancelar; troca de cartão = cancelar e assinar de novo.

## Exclusão de conta
`deleteMyAccount` cancela a recorrência no Asaas antes de excluir. Falha/indeterminado → exclusão abortada com:
"Não foi possível confirmar o cancelamento da assinatura. Sua conta não foi excluída para evitar uma cobrança futura."

## RLS
`subscriptions`: só leitura própria. `billing_events`, `billing_checkouts`: nenhum acesso do cliente. `billing_eligibility`: leitura própria.

## Pendências que dependem do sandbox
Validar com chave real: formato aceito de `nextDueDate`/imagem do item; se `CHECKOUT_PAID` é emitido quando a 1ª cobrança é futura; ciclo completo (ativação, renovação, falha, cancelamento) para mensal, anual e fundador.

## Futuro: Pix Automático / boleto
Adicionar `PIX` em `billingTypes` e mapear eventos equivalentes no adapter; o restante da arquitetura não muda.

---

# Stripe (provedor alternativo)

O provedor é escolhido por `BILLING_PROVIDER` (`asaas` ou `stripe`). Os dois adapters implementam a mesma interface (`types.ts`); planos, trial, entitlements, reconciliação e tabelas são compartilhados. O código do Asaas permanece intacto.

## Configuração (somente no servidor — nunca com prefixo `VITE_`)
| Nome | Valor |
|---|---|
| `BILLING_PROVIDER` | `stripe` |
| `STRIPE_ENVIRONMENT` | `test` ou `live` (qualquer outro valor desliga a cobrança) |
| `STRIPE_SECRET_KEY` | `sk_test_…`/`rk_test_…` com `test`; `sk_live_…`/`rk_live_…` com `live` |
| `STRIPE_WEBHOOK_SECRET` | segredo de assinatura do endpoint, `whsec_…` |

**Fail-closed:** falta de qualquer item, ou chave que não combine com o ambiente declarado (ex.: chave `live` com `STRIPE_ENVIRONMENT=test`), desliga a cobrança (`BILLING_NOT_CONFIGURED`). Cobrança real só existe com `live` **e** chave `live`.

## Como funciona
- **Checkout hospedado** (`POST /v1/checkout/sessions`, `mode=subscription`): só cartão, `locale=pt-BR`, sessão expira conforme o checkout interno (mín. 31 min). O preço vai inline (`price_data`): **não é preciso criar produtos nem preços no painel do Stripe**. Valor, ciclo e nome vêm sempre do catálogo do servidor (`plans.ts`).
- O AgroIntel nunca recebe dados de cartão (escopo PCI inalterado). Sem SDK: chamadas REST com `fetch` e assinatura por Web Crypto (compatível com Cloudflare Workers).
- **Trial:** se restarem 48 h + 5 min ou mais do trial interno, o fim exato é repassado como `subscription_data[trial_end]` (cartão registrado agora, 1ª cobrança no fim do teste). Com menos que isso, ou sem trial em curso, a cobrança começa imediatamente.
- **Cancelamento:** `DELETE /v1/subscriptions/{id}` (nenhuma cobrança futura); o app mantém o acesso até o fim do período pago, como no Asaas. 404 = já cancelada, tratado como sucesso.
- **Portal do cliente:** ainda não integrado. Troca de cartão = cancelar e assinar de novo.

## Webhook
URL: `https://<domínio publicado do app>/api/public/billing/stripe`

1. Valida `Stripe-Signature` (HMAC-SHA256 de `t.corpoBruto`, tolerância de 5 min) **antes de qualquer escrita**; inválido → 401 + `webhook_invalid_signature`.
2. Idempotência pelo id do evento (`evt_…`) em `billing_events`; repetido → 200 sem efeito.
3. Reconciliação idêntica à do Asaas (`reconcile.ts`): a identidade vem do checkout criado por nós, nunca de metadados.

Eventos a assinalar no endpoint do Stripe:
| Evento | Efeito interno |
|---|---|
| `checkout.session.completed` | vincula cliente e assinatura ao usuário (vale para trial e para cobrança imediata) |
| `checkout.session.expired` | fecha o checkout pendente |
| `invoice.paid` | `active`; renovações avançam o período |
| `invoice.payment_failed` | `past_due` |
| `customer.subscription.deleted` | `canceled`, mantendo o fim do período pago |

Faturas de **R$ 0** (início do trial) são ignoradas: nunca ativam a assinatura. O adapter lê os dois formatos de fatura do Stripe (`parent.subscription_details` e o legado `subscription`), pois a versão da API do endpoint é definida no painel.

## Pendências que dependem do modo de teste do Stripe
Estes pontos foram implementados a partir da documentação, **mas não foram executados contra o Stripe real**:
- prazo mínimo de `trial_end` no Checkout (o adapter assume 48 h);
- ciclo completo com cartões de teste: ativação, renovação, falha, cancelamento, para mensal, anual e fundador;
- confirmação de que a conta Stripe aceita cobrar em BRL com cartão;
- Pix e boleto não estão habilitados (somente cartão).
