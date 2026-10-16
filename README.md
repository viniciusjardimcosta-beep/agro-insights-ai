# Agro Insights AI

Crie um SaaS web chamado AgroIntel AI.

Objetivo:

Um sistema simples para produtores rurais controlarem talhões, custos, produção estimada e lucro por hectare, com um consultor de IA que responde perguntas usando os dados da propriedade.

Público-alvo:

Pequenos e médios produtores de soja, milho e trigo no Brasil.

Stack desejada:

- React

- Supabase

- Autenticação por e-mail

- Banco de dados Supabase

- Layout responsivo para celular e computador

- Design limpo, moderno e rural/financeiro

Funcionalidades principais:

1. Tela inicial / Landing Page

Criar uma página de apresentação com:

- Título: AgroIntel AI

- Subtítulo: O copiloto inteligente do produtor rural

- Botão: Começar agora

- Seções explicando:

  - Controle de custos

  - Lucro por hectare

  - Gestão de talhões

  - Consultor IA da fazenda

2. Login e cadastro

Criar autenticação com Supabase:

- Cadastro por e-mail e senha

- Login

- Logout

- Cada usuário deve acessar apenas seus próprios dados

3. Dashboard principal

Após o login, mostrar:

- Área total cadastrada

- Custo total da safra

- Receita estimada

- Lucro estimado

- Lucro por hectare

- Quantidade de talhões

- Alertas simples, como:

  - “Seu custo por hectare está alto”

  - “Você precisa colher X sacas/ha para empatar”

4. Cadastro de propriedades

Criar CRUD de propriedades com:

- Nome da propriedade

- Município

- Estado

- Área total em hectares

5. Cadastro de talhões

Criar CRUD de talhões com:

- Propriedade vinculada

- Nome do talhão

- Área em hectares

- Cultura: soja, milho, trigo, arroz ou outra

- Safra: exemplo 2025/2026

- Data de plantio

- Produtividade estimada em sacas por hectare

6. Lançamento de custos

Criar CRUD de custos com:

- Talhão vinculado

- Categoria:

  - Sementes

  - Fertilizantes

  - Defensivos

  - Diesel

  - Arrendamento

  - Mão de obra

  - Máquinas

  - Outros

- Descrição

- Valor em reais

- Data

- Observação

7. Produção e preço

Criar tela para informar:

- Preço atual da saca

- Produtividade estimada

- Produtividade real, se houver

- Sistema deve calcular receita estimada por talhão:

  área x produtividade x preço da saca

8. Relatórios

Criar tela com:

- Custo por hectare

- Receita estimada por hectare

- Lucro por hectare

- Talhão mais lucrativo

- Talhão menos lucrativo

- Custo total por categoria

- Gráficos simples

9. Consultor IA

Criar uma tela de chat chamada “Consultor IA”.

O usuário poderá perguntar coisas como:

- Estou tendo lucro?

- Qual talhão está dando prejuízo?

- Quanto preciso colher para empatar?

- Se a soja cair 10%, quanto eu perco?

- Qual custo está mais pesado?

A IA deve responder com base nos dados cadastrados no Supabase.

Por enquanto, criar a interface do chat e deixar a integração com IA preparada para receber uma API key depois.

10. Banco de dados Supabase

Criar tabelas:

profiles:

- id

- email

- name

- created_at

properties:

- id

- user_id

- name

- city

- state

- total_area

- created_at

fields:

- id

- user_id

- property_id

- name

- area

- crop

- season

- planting_date

- estimated_yield

- real_yield

- created_at

costs:

- id

- user_id

- field_id

- category

- description

- amount

- date

- notes

- created_at

prices:

- id

- user_id

- crop

- price_per_bag

- date

- created_at

ai_chats:

- id

- user_id

- question

- answer

- created_at

11. Regras de segurança

Configurar Row Level Security no Supabase:

- Usuário só pode ver, criar, editar e deletar seus próprios dados.

- Todas as tabelas devem ter user_id.

- Aplicar políticas de segurança por usuário autenticado.

12. Visual

Usar:

- Tons verdes, branco e cinza

- Ícones relacionados a agro, gráficos e dinheiro

- Layout simples e profissional

- Cards no dashboard

- Menu lateral ou inferior no celular

13. Dados de demonstração

Criar opção de inserir dados fictícios para demonstração:

- Fazenda Santa Maria

- Talhão 1: 20 ha soja

- Talhão 2: 15 ha milho

- Custos simulados

- Preço da soja: R$ 125/saca

- Preço do milho: R$ 60/saca

14. Cálculos principais

Implementar:

- Custo total = soma dos custos

- Custo por hectare = custo total / área

- Receita estimada = área x produtividade estimada x preço da saca

- Lucro estimado = receita estimada - custo total

- Lucro por hectare = lucro estimado / área

- Ponto de equilíbrio em sacas/ha = custo por hectare / preço da saca

15. Objetivo da primeira versão

A primeira versão deve ser funcional o suficiente para apresentar a produtores rurais e vender como piloto.

Crie o projeto completo com telas, navegação, banco de dados, componentes, cálculos e estrutura para futura integração com IA.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/997eb3bd-6a18-4733-81ce-d1f75d24208f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
