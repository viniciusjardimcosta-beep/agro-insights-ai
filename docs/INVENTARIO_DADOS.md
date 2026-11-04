# Inventário de dados pessoais — AgroIntel AI

> **Para quem é:** advogado ou especialista em LGPD que vai revisar a Política de Privacidade e os Termos.
> **O que é:** levantamento técnico do que o sistema faz hoje, tirado do código e das migrations (versão 1.0 dos textos).
> **O que NÃO é:** parecer jurídico. Não altera os textos legais. Pontos marcados com **[confirmar]**
> dependem de contratos ou configurações fora do código.
> Data do levantamento: 04/11/2026.

## 1. Quem trata os dados

| Papel | Quem | Observação |
|---|---|---|
| Controlador | AgroIntel AI (a empresa/responsável ainda **não está identificada** nos textos) | **[confirmar]** razão social, CNPJ, endereço |
| Encarregado (DPO) | Não indicado nos textos | **[confirmar]** necessidade e nome |
| Contato de privacidade | `privacidade@agrointel.ai` (definido em `src/lib/privacy.ts`) | **[confirmar]** que a caixa existe e quem responde |

## 2. Dados tratados

| Categoria | Dados | Onde ficam (tabela) | Finalidade | Titular |
|---|---|---|---|---|
| Cadastro | nome, e-mail, senha (guardada como hash pelo serviço de login, nunca em texto) | `auth.users`, `profiles` | criar e acessar a conta | usuário |
| Aceite legal | data de aceite dos Termos e da Política, versão aceita | `profiles` (`terms_accepted_at`, `privacy_accepted_at`) | comprovar consentimento/ciência | usuário |
| Dados da fazenda | propriedade (nome, cidade, UF, área), talhões (cultura, área, safra, produtividade), custos (categoria, valor, data, descrição), preços | `properties`, `fields`, `costs`, `prices` | calcular lucro por hectare, relatórios | usuário |
| Resultados gerados | diagnósticos (nota, textos da IA), cenários simulados, alertas | `diagnostics`, `simulated_scenarios`, `intelligence_alerts` | funcionalidades do produto | usuário |
| Conversas com a IA | perguntas do usuário e respostas | `ai_threads`, `ai_messages` | Consultor IA e histórico | usuário |
| Assinatura | plano, status, datas de teste e de período, **identificadores do cliente e da assinatura no Stripe**, elegibilidade a plano fundador | `subscriptions`, `billing_checkouts`, `billing_eligibility`, `billing_events` | cobrança e acesso | usuário |
| Uso | tipo de evento e hora (limite de mensagens da IA) | `usage_events` | prevenção de abuso | usuário |
| Auditoria | tipo de ação, entidade, status, hora, código de correlação; **sem** e-mail, nome, valores ou mensagens (lista de campos permitidos em `src/lib/audit.server.ts`) | `audit_events` | segurança e investigação de incidentes | usuário (anonimizado ao excluir a conta) |

Não coletamos: dados de cartão (ficam só no Stripe), CPF/CNPJ, localização precisa, documentos,
dados de menores, dados sensíveis (art. 5º, II, LGPD) **[confirmar com o produto que nenhum campo livre os receba]**.
Campos de texto livre (descrição de custo, observações, mensagens à IA) podem receber qualquer coisa que o usuário digitar.

## 3. Operadores e terceiros (o que o texto atual NÃO cita)

| Terceiro | Para quê | Dados que recebe | **[confirmar]** |
|---|---|---|---|
| **Lovable Cloud / Supabase** | banco de dados, login, e-mails de confirmação e recuperação de senha, hospedagem do app | todos os dados da seção 2 | país dos servidores, contrato (DPA), lista de suboperadores |
| **Gateway de IA do Lovable → modelo de linguagem** (hoje configurado como Google Gemini, `google/gemini-3-flash-preview`) | gerar respostas do Consultor IA e do Diagnóstico | **resumo da fazenda** (nomes de propriedade/talhão, cidade/UF, áreas, custos, preços, produtividade) e as mensagens do usuário. Não envia senha, token nem dados de outros usuários | quem é o provedor final, se os dados são usados para treino, retenção, país |
| **Stripe** | cobrança por assinatura | e-mail do cliente e dados que o próprio Stripe coleta no pagamento | contrato, transferência internacional, papel (operador ou controlador próprio) |

Esse provedor de IA pode ser trocado por variável de ambiente (`AI_PROVIDER`, ver `docs/MIGRACAO.md`);
se isso acontecer, a lista acima muda.

## 4. Transferência internacional

Os textos não tratam do assunto. É provável que haja transferência (Stripe, provedor de IA, possivelmente a hospedagem).
**[confirmar]** países e a base legal usada (art. 33 da LGPD).

## 5. Cookies e armazenamento no navegador

- O login guarda o token de sessão no `localStorage` do navegador (chave do Supabase Auth).
- Um cookie `sidebar_state` (preferência de menu aberto/fechado, 7 dias, sem dado pessoal), criado pelo componente de menu lateral.
- Uma chave `agrointel.pending_terms_accept` guarda temporariamente o aceite dos termos até o primeiro login.
- Não há ferramenta de análise de uso, publicidade ou pixel no código. **[confirmar]** que o Lovable não injeta análises na publicação
  (o painel do Lovable mostra "Analytics" de visitas quando o app é publicado).
- Não há banner de cookies. **[confirmar]** se é necessário.

## 6. Retenção (o que o sistema faz hoje)

| Dado | Regra | Situação real |
|---|---|---|
| Conta e dados da fazenda | enquanto a conta existir | ok |
| Conversas e diagnósticos | enquanto a conta existir | ok |
| `usage_events` | texto interno sugere expurgo após 30 dias | **não há rotina automática**: limpeza manual |
| `audit_events` | Política cita "retenção sugerida de 90 dias" | **não há rotina automática**: limpeza manual |
| Conta excluída | dados pessoais e da fazenda apagados; auditoria anonimizada | implementado (`deleteMyAccount`) |

Atenção: a Política diz "retenção sugerida de 90 dias" para auditoria, mas hoje nada apaga esses registros.
Ou se cria a rotina, ou se ajusta o texto. Detalhes em `docs/DATA_RETENTION.md`.
Dados no Stripe (cliente, faturas) seguem as regras do Stripe e podem ter obrigação fiscal de guarda **[confirmar]**.

## 7. Direitos do titular — como o sistema atende

| Direito | Como | Observação |
|---|---|---|
| Confirmação e acesso, portabilidade | Configurações → "Exportar meus dados" (JSON, gerado na hora, sem URL pública) | não inclui `usage_events` nem `audit_events` |
| Exclusão | Configurações → "Excluir conta" (digitar EXCLUIR); cancela a assinatura antes | o cadastro do cliente no **Stripe não é apagado** (pendência conhecida) |
| Correção | o usuário edita seus dados nas telas | e-mail e nome do perfil: **[confirmar]** se há tela de edição |
| Revogação do consentimento, oposição | por exclusão da conta ou por e-mail ao contato | **[confirmar]** prazo e processo |
| Informação sobre compartilhamento | depende da seção 3 estar nos textos | hoje ausente |

## 8. Segurança (resumo técnico)

- Isolamento por usuário no banco (RLS) em todas as tabelas; funções de servidor exigem sessão válida.
- Chaves e segredos só no servidor. Webhook do Stripe com assinatura verificada.
- Limite de mensagens da IA (30 por hora, 120 por dia) e de tamanho de mensagem.
- Registros de auditoria sem dados pessoais nem conteúdo.
- Não há plano de resposta a incidentes escrito **[confirmar]**; backup e recuperação em `docs/BACKUP_RECOVERY.md`.

## 9. Pontos que o advogado deve decidir

1. Quem é o controlador e se há encarregado (DPO).
2. Bases legais por finalidade (execução de contrato, legítimo interesse, consentimento).
3. Nomear os terceiros da seção 3 nos textos e tratar a transferência internacional.
4. Alinhar o texto de retenção com o que existe (seção 6).
5. Necessidade de aviso de cookies e de aviso de que o conteúdo enviado à IA sai do sistema.
6. Termos de Uso: limites de responsabilidade sobre as respostas da IA, política de cancelamento e reembolso
   (alinhada às regras do Stripe e ao Código de Defesa do Consumidor), foro.
7. Procedimento de incidente (comunicação à ANPD e aos titulares).

## 10. Onde está o código

- Textos: `src/routes/privacidade.tsx`, `src/routes/termos.tsx`, `src/lib/privacy.ts`
- Exportação e exclusão: `src/lib/account.functions.ts`
- Auditoria: `src/lib/audit.server.ts`
- Esquema do banco: `supabase/migrations/`
- Retenção: `docs/DATA_RETENTION.md`
