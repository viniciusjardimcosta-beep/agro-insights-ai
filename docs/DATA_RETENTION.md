# Política de Retenção e Ciclo de Vida de Dados — AgroIntel AI

Versão 1.0 · Sprint 3.3

## 1. Mapa de dados do usuário

| Tabela | Vínculo com o usuário | Ao excluir a conta | Observação |
| --- | --- | --- | --- |
| `profiles` | `id → auth.users(id)` | CASCADE | Nome, e-mail e aceites legais |
| `properties` | `user_id → auth.users` | CASCADE | — |
| `fields` | `user_id` CASCADE; `property_id → properties` CASCADE | CASCADE | — |
| `costs` | `user_id` CASCADE; `field_id → fields` CASCADE | CASCADE | — |
| `prices` | `user_id` CASCADE | CASCADE | — |
| `ai_threads` | `user_id` CASCADE | CASCADE | — |
| `ai_messages` | `user_id` CASCADE; `thread_id` CASCADE | CASCADE | Conteúdo das conversas |
| `diagnostics` | `user_id` **sem FK** | **exclusão manual explícita** | Tratado no passo 1 de `deleteMyAccount()` |
| `simulated_scenarios` | `user_id` CASCADE; `property_id` SET NULL | CASCADE | — |
| `intelligence_alerts` | `user_id` CASCADE; `property_id` CASCADE | CASCADE | — |
| `usage_events` | `user_id` CASCADE | **excluído explicitamente** + CASCADE | Rate limiting |
| `audit_events` | `user_id` SET NULL; `property_id` SET NULL | **anonimizado** | Ver seção 3 |

Dados que exigem ação manual na exclusão: `diagnostics` (sem FK) e
`usage_events` (removido explicitamente antes da cascata, por clareza operacional).

## 2. Retenção por categoria

- **Dados da conta** (perfil, propriedades, talhões, custos, preços): mantidos enquanto a conta estiver ativa.
- **Diagnósticos e cenários salvos**: mantidos enquanto a conta estiver ativa (histórico é parte do produto).
- **Conversas com o Consultor IA**: mantidas enquanto a conta estiver ativa.
- **`usage_events`**: retenção curta e operacional — só as últimas 24 h são funcionalmente relevantes (janelas de 1 h e 24 h do rate limit). Sugestão: expurgo de registros com mais de 30 dias.
- **`audit_events`**: retenção sugerida de **90 dias**.
- **Conta excluída**: todos os dados pessoais e da fazenda são removidos permanentemente.

## 3. Decisão sobre `audit_events`

**Decisão adotada: anonimização, não exclusão.**

`audit_events.user_id` é `ON DELETE SET NULL`. Quando a conta é removida do Auth,
os eventos permanecem sem qualquer identificador pessoal:

- não há e-mail, nome, valores financeiros, mensagens ou prompts nesses registros
  (allowlist estrita em `src/lib/audit.server.ts` + filtragem no RPC);
- `property_id` também vira `NULL` pela cascata de `properties`;
- restam apenas tipo de evento, status, timestamp e metadados operacionais.

Justificativa: preservar a capacidade de investigar incidentes de segurança e
abuso ocorridos antes da exclusão, sem manter identificadores pessoais.

## 4. O que ainda depende de job futuro

Nesta sprint **não** foi criado scheduler automático de expurgo (não há
infraestrutura confiável de cron dedicada ao projeto). Pendências:

1. Job diário para `DELETE FROM usage_events WHERE created_at < now() - interval '30 days'`.
2. Job diário para `DELETE FROM audit_events WHERE created_at < now() - interval '90 days'`.
3. Alternativas possíveis: `pg_cron` no banco, ou rota `/api/public/cron/*` protegida por segredo e chamada por agendador externo.

Até que existam, a limpeza é **manual** e de responsabilidade operacional.

## 5. Portabilidade e exclusão

- **Exportação**: `exportMyData()` (`src/lib/account.functions.ts`) — JSON versionado, gerado sob demanda, entregue por blob direto, sem persistência e sem URL pública. Nunca inclui `usage_events`, `audit_events`, `correlation_id`, tokens ou `user_id`.
- **Exclusão**: `deleteMyAccount()` — exige confirmação textual `EXCLUIR`, apaga `diagnostics` e `usage_events`, audita o encerramento, remove o usuário do Auth (cascata) e o frontend encerra sessão, limpa o cache e redireciona.
