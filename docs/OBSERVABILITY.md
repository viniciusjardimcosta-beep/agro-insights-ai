# Observabilidade, auditoria e monitoramento — AgroIntel AI

## 1. Separação de responsabilidades

| Tabela | Finalidade | Quem escreve |
| --- | --- | --- |
| `usage_events` | Exclusivamente consumo / rate limiting (Sprint 3.1) | `consume_rate_limit`, `record_usage_event` |
| `audit_events` | Auditoria operacional (o que aconteceu, quando, com qual resultado) | `record_audit_event` (SECURITY DEFINER) |

Nenhum limite de uso foi alterado. Nenhuma fórmula financeira, score, diagnóstico,
simulador, `intelligence.ts` ou `alerts-rules.ts` foi modificado.

## 2. Eventos auditados

Autenticação: `login_success`, `logout`, `login_failure` (registrado apenas como
código no monitoramento — o browser não tem sessão para gravar auditoria server-side).

Dados: `property_*`, `field_*`, `cost_*`, `price_*` (`_created`, `_updated`, `_deleted`).

Diagnóstico: `diagnostic_started`, `diagnostic_completed`, `diagnostic_failed`,
`diagnostic_rate_limited`.

Consultor IA: `ai_request_started`, `ai_request_completed`, `ai_request_failed`,
`ai_request_timeout`, `ai_rate_limited`.

Cenários: `scenario_created`, `scenario_deleted`.
Relatório: `executive_report_generated`, `executive_report_failed`.
Alertas: `alert_acknowledged`, `alert_resolved_automatically`, `alert_reactivated`.

Renderizações, navegação e `SELECT` comuns **não** são auditados.

## 3. Política de metadata

`metadata` aceita apenas a allowlist de `src/lib/audit.server.ts`:
`duration_ms`, `http_status`, `error_code`, `source`, `scope`, `count`, `created`,
`updated`, `resolved`, `severity`, `operation`, `retry`, `fallback_used`,
`page_count`, `reason`.

Valores devem ser escalares curtos (strings truncadas em 64 caracteres). Objetos e
arrays são descartados. Uma segunda camada de defesa roda no banco: a função
`record_audit_event` remove chaves com padrões sensíveis.

Nunca gravado: JWT, senha, service role, prompt/resposta da IA, mensagens do chat,
valores financeiros, descrições de custo, nome do produtor, e-mail, documentos ou
snapshots da fazenda.

## 4. correlation_id

Gerado por operação relevante (`createCorrelationId()`) e propagado por todas as
etapas, permitindo reconstruir o fluxo sem armazenar conteúdo:

```
diagnostic_started → (diagnostic_rate_limited | diagnostic_failed) → diagnostic_completed
ai_request_started → (ai_rate_limited | ai_request_timeout | ai_request_failed) → ai_request_completed
executive_report_generated | executive_report_failed
```

## 5. Erros estruturados

`src/lib/errors.ts` define `AppError` com `code`, `status`, `correlationId`,
`timestamp` e `userMessage`. `toUserMessage()` garante que nada técnico
(stack trace, `TypeError`, erro de infraestrutura) chegue à interface.

## 6. Monitoramento (sem fornecedor acoplado)

`src/lib/monitoring.ts` expõe `captureError`, `captureMessage`,
`setMonitoringUser`, `clearMonitoringUser` e `installBrowserMonitoring`.
Por padrão usa console + coletor nativo da plataforma. Nenhuma dependência
externa foi instalada.

Para conectar um provedor (ex.: Sentry) no futuro:

1. Instalar o SDK do provedor.
2. No bootstrap do cliente, chamar:

```ts
import { setMonitoringProvider } from "@/lib/monitoring";

setMonitoringProvider({
  captureError: (error, ctx) => Sentry.captureException(error, { tags: ctx }),
  captureMessage: (msg, ctx) => Sentry.captureMessage(msg, { tags: ctx }),
  setUser: (user) => Sentry.setUser(user ? { id: user.id } : null),
});
```

Nenhum outro arquivo precisa mudar. Envie apenas `id` do usuário — jamais e-mail,
mensagens, tokens ou dados financeiros.

## 7. Permissões / RLS de `audit_events`

- RLS habilitada; **nenhuma policy para `anon`/`authenticated`**.
- `REVOKE ALL` para `anon` e `authenticated`: o cliente não insere, não altera,
  não apaga e não lê.
- Escrita apenas via `public.record_audit_event` (SECURITY DEFINER), que deriva
  `user_id` de `auth.uid()`.
- Leitura restrita a `service_role` (uso administrativo interno). Não há tela de
  auditoria no produto nesta versão.

## 8. Retenção (recomendação, ainda não automatizada)

- `audit_events`: 90 dias.
- `usage_events`: manter janela suficiente para rate limiting e análise operacional
  (sugestão: 180 dias).

A limpeza automática exige um scheduler confiável (`pg_cron`) e será avaliada em
sprint futura. Nada é apagado automaticamente hoje.

## 9. Performance

Índices criados: `(user_id, created_at DESC)`, `(event_type, created_at DESC)` e
`(correlation_id)`. Cada evento é um único `RPC` — não há cascata de queries e a
falha de gravação nunca interrompe a operação principal.
