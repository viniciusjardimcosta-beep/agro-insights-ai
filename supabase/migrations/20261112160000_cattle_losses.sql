-- Pecuária: baixas (animais que morreram ou se perderam). Tudo por usuário, com RLS.
create table if not exists public.cattle_losses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lot_id uuid not null references public.cattle_lots(id) on delete cascade,
  date date not null,
  head_count integer not null check (head_count > 0),
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cattle_losses to authenticated;
grant all on public.cattle_losses to service_role;
alter table public.cattle_losses enable row level security;
drop policy if exists "cattle_losses_all_own" on public.cattle_losses;
create policy "cattle_losses_all_own" on public.cattle_losses for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists cattle_losses_user_idx on public.cattle_losses(user_id, date desc);
create index if not exists cattle_losses_lot_idx on public.cattle_losses(lot_id);
