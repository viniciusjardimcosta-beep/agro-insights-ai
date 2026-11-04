# Migração: sair do Lovable Cloud para o seu próprio Supabase

> **Status:** guia de planejamento. Nenhuma parte foi executada nem testada.
> Faça primeiro num projeto de teste. Não migre enquanto o pagamento (Stripe) estiver em obras.

## O que o Lovable fornece hoje

| Peça | Onde está hoje | Para onde vai |
|---|---|---|
| Banco de dados e login | Lovable Cloud (Supabase gerenciado pelo Lovable) | Um projeto Supabase seu |
| IA do Consultor e do diagnóstico | Gateway de IA do Lovable (`LOVABLE_API_KEY`) | Provedor de IA à sua escolha (ver abaixo) |
| Hospedagem do app | Lovable (o build gera uma saída para Cloudflare, via `nitro`) | Cloudflare, Vercel ou similar |
| Segredos (chaves) | Painel de Secrets do Lovable | Painel de variáveis da nova hospedagem |
| E-mails de login | Lovable | Configuração de e-mail do seu Supabase |

O Lovable informa que **não há migração de um clique** e que o projeto Cloud não dá uma
conexão direta ao banco. O que existe: exportar um backup pelo Lovable, ou usar uma
ferramenta de terceiros (ver "Fontes").

## Passo 0 — Preparar (sem risco, já feito no código)

A escolha do provedor de IA agora é feita por variáveis, sem mexer no código
(`src/lib/ai-config.ts`). Com `AI_PROVIDER=lovable` (padrão) nada muda.

## Passo 1 — Backup

1. No Lovable, abra **Cloud → Database** e use **Export project data** (backup do banco).
   Segundo o Lovable, o backup não inclui arquivos de storage, código de funções, segredos
   nem configurações de login. Este app não usa storage de arquivos (confirmar em Cloud → Storage).
2. Guarde o arquivo em local seguro. Ele contém dados de clientes: trate como confidencial.

## Passo 2 — Criar o projeto Supabase novo

1. Crie uma conta em supabase.com e um projeto novo, no mesmo país dos usuários (ex.: São Paulo).
2. Anote: URL do projeto, chave **publishable/anon** e chave **service role** (esta última é secreta).

## Passo 3 — Levar o banco

O esquema está em `supabase/migrations/` (17 arquivos). Duas formas:

- **A. Restaurar o backup** do Passo 1 no projeto novo (traz esquema, dados e políticas).
- **B. Aplicar as migrations** (`supabase db push` com a CLI do Supabase) para criar as tabelas vazias
  e depois copiar os dados. Use esta forma para começar do zero, sem clientes.

Depois, confirme em **Authentication → Policies** que **todas as tabelas** estão com RLS ligado.
Teste com duas contas: uma não pode ver os dados da outra.

## Passo 4 — Levar os usuários

Os usuários ficam no esquema `auth`. O backup do banco não traz as senhas de forma utilizável
por padrão. A ferramenta de terceiros "Lovable Cloud Exporter" (Dreamlit) copia usuários com os
hashes de senha. **Eu não a testei.** Se não for usar, peça aos usuários para usar
"Esqueci minha senha" no novo ambiente (a tela já existe).

## Passo 5 — Variáveis de ambiente do app

Configure na nova hospedagem (nomes exatos; modelo em `.env.example`):

| Variável | Valor |
|---|---|
| `SUPABASE_URL` e `VITE_SUPABASE_URL` | URL do projeto novo |
| `SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PUBLISHABLE_KEY` | chave publishable/anon (pública) |
| `SUPABASE_PROJECT_ID` e `VITE_SUPABASE_PROJECT_ID` | código do projeto novo |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service role (**secreta**, só servidor) |
| `BILLING_PROVIDER`, `STRIPE_*` | ver `docs/BILLING.md` |
| `AI_PROVIDER=custom`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | provedor de IA (Passo 6) |

Atenção: o arquivo `.env` do repositório é gerenciado pelo Lovable e aponta para o projeto antigo.
Fora do Lovable, ele deve ser substituído pelas variáveis da hospedagem. Quem fizer a migração
deve decidir como tratá-lo.

## Passo 6 — IA

1. Crie uma chave no provedor escolhido. Use uma API compatível com OpenAI
   (a da Anthropic, em `https://api.anthropic.com/v1/`, a da OpenAI e a do OpenRouter servem).
2. Defina `AI_PROVIDER=custom`, `AI_API_KEY`, `AI_BASE_URL` (com `https://`) e `AI_MODEL`.
3. Gere um diagnóstico e use o Consultor. O formato das respostas pode variar de modelo
   para modelo: confira o diagnóstico (JSON) e as 5 seções do Consultor.
4. A cobrança da IA passa a ser sua, direto no provedor.

## Passo 7 — Hospedagem

O build usa `nitro` com alvo Cloudflare por padrão (`vite.config.ts`). O caminho de menor
atrito é Cloudflare Workers/Pages. Para Vercel ou outro destino, o alvo do `nitro` precisa ser
ajustado: tarefa para quem tem acesso técnico ao projeto. **Não testado.**

## Passo 8 — Stripe

1. No painel do Stripe (modo teste), troque o endereço do webhook para o novo domínio:
   `/api/public/billing/stripe`.
2. Copie o novo `whsec_...` para `STRIPE_WEBHOOK_SECRET`.
3. Refaça o teste de pagamento com o cartão `4242 4242 4242 4242`.

## Passo 9 — Login e e-mails

1. Em **Authentication → URL Configuration**, ajuste **Site URL** e **Redirect URLs** para o novo domínio
   (necessário para confirmação de e-mail e recuperação de senha).
2. Configure o envio de e-mails (SMTP próprio é recomendado para produção).
3. Confira confirmação de e-mail e tamanho mínimo da senha.

## Passo 10 — Validação (roteiro)

- [ ] Criar conta, confirmar e-mail, entrar, sair.
- [ ] "Esqueci minha senha" funciona.
- [ ] Duas contas: nenhuma vê dados da outra.
- [ ] Demonstração, relatório, diagnóstico e Consultor IA funcionam.
- [ ] Assinatura em modo teste ativa e o webhook responde 200.
- [ ] Excluir conta de teste.
- [ ] Só depois, desligar o projeto antigo no Lovable.

## Riscos e o que NÃO é coberto

- Sem janela de manutenção, usuários podem criar dados no ambiente antigo durante a cópia.
- Funcionalidades exclusivas do Lovable (editor, painéis de Banco/Usuários) deixam de existir; use o painel do Supabase.
- O Lovable pode alterar o repositório (ele faz commits na `main`). Combine quem edita o quê antes de sair.

## Fontes

- Dreamlit, "Why we built an open-source Lovable Cloud exporter": https://dreamlit.ai/blog/why-we-built-an-open-source-lovable-cloud-exporter
- WZ-IT, "Migrate Lovable Cloud to Supabase": https://wz-it.com/en/knowledge/supabase/migrate-lovable-cloud-to-supabase/
