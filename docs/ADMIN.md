# Administração do AgroIntel

## Modelo
- Tabela `public.user_roles (user_id, role app_role, UNIQUE(user_id, role))`, FK `auth.users` ON DELETE CASCADE.
- Papel único hoje: `admin`. Não existe papel em `profiles`, localStorage, cookie nem e-mail fixo no código.
- Permissões: usuário logado só faz SELECT da **própria** linha (RLS). Nenhuma escrita por anon/authenticated (privilégios revogados). Só service role escreve.
- Sem função SECURITY DEFINER nova: `requireAdmin` consulta `user_roles` com o client do próprio usuário.

## Verificação
`src/lib/admin.server.ts` → `requireAdmin(context.supabase, context.userId)`:
sessão validada por `requireSupabaseAuth` → `auth.uid()` → leitura de `user_roles` sob RLS → 403 `FORBIDDEN` se não for admin.
Toda função em `src/lib/admin.functions.ts` (exceto `amIAdmin`, usada só para o menu) chama `requireAdmin` **antes** de usar service role.

## Ações
Somente leitura, exceto `setFounderEligibility` (conceder/revogar). Revogar não altera assinatura fundador ativa.
Auditoria: `admin_founder_granted` / `admin_founder_revoked` com ator = `auth.uid()`, alvo = `entity_id`, `correlation_id`, data. Sem nome/e-mail.

## Criar o primeiro administrador
Nunca automático. Procedimento:
1. Localizar a conta: `select id, email from auth.users where email = '<email>';`
2. Confirmar user_id e e-mail com o proprietário.
3. Executar (backend, com privilégio de serviço):
   `insert into public.user_roles (user_id, role) values ('<user_id>', 'admin') on conflict do nothing;`
4. Remover: `delete from public.user_roles where user_id = '<user_id>' and role = 'admin';`
