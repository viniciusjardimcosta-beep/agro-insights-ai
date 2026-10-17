# AgroIntel AI

O copiloto inteligente do produtor rural. SaaS web para pequenos e médios produtores de soja, milho e trigo controlarem **propriedades, talhões, custos, produção estimada e lucro por hectare**, com um **Consultor IA** que responde perguntas usando os dados da própria fazenda.

> O texto do pedido original (prompt inicial do projeto) está em [`docs/PROMPT_INICIAL.md`](docs/PROMPT_INICIAL.md).

## O que o app faz

**Gestão da fazenda**
- Propriedades, talhões (cultura, safra, plantio, produtividade estimada e real), custos por categoria e preço da saca por cultura.
- Dashboard com área total, custo total, receita e lucro estimados, lucro por hectare e alertas (por exemplo, quantas sacas/ha são necessárias para empatar).
- Relatórios com gráficos: custo por categoria, lucro por talhão, talhões mais e menos lucrativos.
- Dados de demonstração (Fazenda Santa Maria) para apresentar o produto.

**Recursos premium** (exigem teste gratuito ou assinatura ativa)
- Consultor IA em conversas (threads), com os dados da fazenda no contexto.
- Diagnóstico por IA, Central de Inteligência, Simulador de cenários e Alertas inteligentes.
- Relatório Executivo em PDF.

**Conta, cobrança e governança**
- Login por e-mail e senha; cada usuário acessa só os próprios dados (RLS no banco).
- Teste gratuito de 7 dias e planos Pro (mensal e anual) via Asaas — hoje **somente em sandbox**.
- Painel de administração, trilha de auditoria, limites de uso da IA, exportação e exclusão de conta (LGPD), termos e política de privacidade.

## Tecnologias

TanStack Start + React 19, Vite, Tailwind CSS 4, shadcn/ui (Radix), Recharts, Supabase (Postgres + autenticação), Vercel AI SDK com Lovable AI Gateway (Gemini), Asaas (cobrança), jsPDF e Vitest.

## Como rodar localmente

Requer Node.js (a versão 22 é a usada nas definições de tipos do projeto).

```sh
npm install        # ou: bun install
npm run dev        # servidor de desenvolvimento
npm run build      # build de produção
npm run lint       # análise do código
npm test           # testes (Vitest)
```

### Variáveis de ambiente

O arquivo `.env` (gerenciado pelo Lovable) guarda só a URL e a chave **pública** do Supabase. Os **segredos** (chave de serviço do Supabase, `LOVABLE_API_KEY`, chaves do Asaas) ficam apenas nos *Secrets* do ambiente onde o app roda e **nunca** devem ser comitados. O modelo completo está em [`.env.example`](.env.example).

## Estrutura

```
src/routes/             páginas e rotas de API (roteamento por arquivos)
  _authenticated/       área logada: dashboard, propriedades, talhoes, custos, precos,
                        relatorios, consultor, diagnostico, inteligencia, simulador,
                        alertas, configuracoes, admin
  api/public/           chat do Consultor IA e webhook do Asaas
src/lib/                cálculos (calc.ts), IA, cobrança, entitlements, auditoria, limites
src/integrations/       cliente Supabase e tipos
supabase/migrations/    esquema do banco (todas as tabelas com RLS)
docs/                   documentação técnica
```

## Documentação técnica

| Documento | Assunto |
| --- | --- |
| [`docs/SUBSCRIPTIONS.md`](docs/SUBSCRIPTIONS.md) | Teste gratuito, estados da assinatura e permissões por plano |
| [`docs/BILLING.md`](docs/BILLING.md) | Integração com o Asaas, planos, webhook e plano fundador |
| [`docs/ADMIN.md`](docs/ADMIN.md) | Papel de administrador e como criar o primeiro |
| [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) | Observabilidade, auditoria e monitoramento |
| [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md) | Backup e recuperação |
| [`docs/DATA_RETENTION.md`](docs/DATA_RETENTION.md) | Retenção e ciclo de vida dos dados |
| [`docs/PROMPT_INICIAL.md`](docs/PROMPT_INICIAL.md) | Pedido original do projeto |

## Pendências conhecidas

- **Cobrança real:** o adaptador do Asaas está implementado apenas para sandbox e desliga a cobrança em qualquer outro ambiente. Falta liberar o ambiente de produção (ver `docs/BILLING.md`).
- **Testes automatizados:** existem testes (Vitest) para alertas, cobrança, auditoria, limites de uso, permissões por plano, inteligência, monitoramento, administração e exportação de conta. Os cálculos financeiros (`src/lib/calc.ts`) ainda não têm testes próprios.

## Desenvolvimento com Lovable

Este projeto foi criado no [Lovable](https://lovable.dev) e continua sincronizado com ele: alterações feitas no Lovable são comitadas neste repositório, e alterações enviadas à branch `main` aparecem no Lovable.

Editor do projeto: <https://lovable.dev/projects/997eb3bd-6a18-4733-81ce-d1f75d24208f>
