# Backup e Recuperação — AgroIntel AI

Versão 1.0 · Sprint 3.3

## 1. Estado atual dos backups

O banco do AgroIntel é um Postgres gerenciado provisionado pela plataforma
(Lovable Cloud). O que é possível afirmar com o acesso disponível ao projeto:

- **Backups automáticos diários**: fornecidos pela plataforma gerenciada no plano padrão, com retenção típica de 7 dias.
- **PITR (Point-in-Time Recovery)**: recurso de plano pago. **Não foi ativado** — nenhum serviço pago foi habilitado nesta sprint.
- **Restore self-service pelo painel**: não disponível ao time do projeto neste modelo de acesso; a restauração depende de solicitação ao suporte da plataforma.
- **Backup lógico próprio**: não configurado.

Nenhuma configuração de cobrança ou plano foi alterada.

## 2. Como verificar o backup

1. Confirmar com o suporte da plataforma a data/hora do snapshot mais recente e a janela de retenção vigente.
2. Verificação independente e sempre disponível: exportar os dados de uma conta pelo próprio produto (Configurações → Exportar meus dados) e conferir se o JSON contém propriedades, talhões, custos, preços, diagnósticos, cenários, alertas e conversas.
3. Conferência rápida de volumetria (contagens por tabela) para detectar perdas silenciosas.

## 3. Como restaurar

**Perda total ou corrupção do banco**

1. Congelar escrita: comunicar indisponibilidade e evitar novas gravações.
2. Abrir chamado com o suporte da plataforma informando data/hora alvo do restore.
3. Restaurar o snapshot para uma instância nova (nunca sobrescrever a produção sem validação).
4. Validar contagens e relacionamentos (seção 5).
5. Redirecionar a aplicação para a instância restaurada.

**Perda pontual (uma conta / poucas linhas)**

1. Localizar o JSON de exportação da conta, se existir.
2. Reinserir manualmente respeitando a ordem: `properties → fields → costs`, depois `prices`, `diagnostics`, `simulated_scenarios`, `intelligence_alerts`, `ai_threads → ai_messages`.
3. `user_id` deve ser sempre o do dono; triggers de integridade rejeitam FKs de outro usuário.

## 4. Impacto esperado

- **RPO** (perda máxima aceitável): até 24 h com backup diário; seria minutos com PITR.
- **RTO** (tempo de retorno): depende do suporte da plataforma — estimar horas, não minutos.
- Durante o restore o app fica indisponível ou em modo somente leitura.
- Responsabilidade operacional: o responsável técnico do projeto aciona o suporte, valida o restore e comunica os usuários.

## 5. Teste de restauração — status honesto

**O restore completo NÃO foi executado.** Não existe, hoje, ambiente isolado
provisionado para restaurar um snapshot sem tocar a produção, e a sprint proíbe
operações destrutivas em produção.

O que **foi** validado: o caminho de portabilidade (exportação JSON completa por
conta), que serve como recuperação lógica por usuário.

### Checklist operacional para o primeiro teste real de restore

- [ ] Provisionar instância Postgres isolada (staging).
- [ ] Solicitar/obter cópia do snapshot mais recente.
- [ ] Restaurar o snapshot na instância isolada.
- [ ] Comparar contagens por tabela entre produção e restauração.
- [ ] Validar integridade referencial: todo `field.property_id` existe; todo `cost.field_id` existe; todo `ai_message.thread_id` existe; nenhum registro com `user_id` inexistente.
- [ ] Verificar RLS ativa em todas as tabelas restauradas.
- [ ] Fazer login com conta de teste e conferir dashboard, diagnóstico e alertas.
- [ ] Registrar tempo total (RTO real) e a defasagem do snapshot (RPO real).
- [ ] Destruir a instância de teste.

## 6. Procedimento seguro de teste com conta de teste (não destrutivo em produção)

1. Criar conta de teste e popular com dados demo.
2. Exportar os dados por Configurações → Exportar meus dados.
3. Excluir a conta de teste (fluxo real de exclusão).
4. Recriar a conta e reinserir a partir do JSON, na ordem da seção 3.
5. Conferir contagens e relacionamentos com o JSON original.

Este procedimento valida exportação, exclusão e recomposição lógica — não
substitui o teste de restore de snapshot da seção 5.
