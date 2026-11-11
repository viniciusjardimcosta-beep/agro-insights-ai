-- Módulo Pecuária (recria e engorda): lotes, custos e vendas. Tudo por usuário, com RLS.
-- Também guarda no perfil quais atividades a pessoa usa (lavoura, pecuária), para mostrar só o que ela usa.

-- Atividades do perfil
alter table public.profiles
  add column if not exists activities text[] not null default array['lavoura']::text[];
alter table public.profiles
  drop constraint if exists profiles_activities_valid;
alter table public.profiles
  add constraint profiles_activities_valid check (activities <@ array['lavoura','pecuaria']::text[]);

-- Lotes de animais
create table public.cattle_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phase text not null default 'engorda' check (phase in ('recria','engorda')),
  head_count integer not null check (head_count > 0),
  entry_date date not null,
  entry_avg_weight_kg numeric check (entry_avg_weight_kg is null or entry_avg_weight_kg > 0),
  purchase_amount numeric not null default 0 check (purchase_amount >= 0),
  status text not null default 'ativo' check (status in ('ativo','vendido')),
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cattle_lots to authenticated;
grant all on public.cattle_lots to service_role;
alter table public.cattle_lots enable row level security;
create policy "cattle_lots_all_own" on public.cattle_lots for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index cattle_lots_user_idx on public.cattle_lots(user_id);

-- Custos (de um lote, ou gerais da fazenda quando lot_id é nulo)
create table public.cattle_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lot_id uuid references public.cattle_lots(id) on delete cascade,
  category text not null,
  description text,
  amount numeric not null check (amount > 0),
  date date not null,
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cattle_costs to authenticated;
grant all on public.cattle_costs to service_role;
alter table public.cattle_costs enable row level security;
create policy "cattle_costs_all_own" on public.cattle_costs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index cattle_costs_user_idx on public.cattle_costs(user_id, date desc);
create index cattle_costs_lot_idx on public.cattle_costs(lot_id);

-- Vendas (parciais ou do lote inteiro)
create table public.cattle_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lot_id uuid not null references public.cattle_lots(id) on delete cascade,
  date date not null,
  head_count integer not null check (head_count > 0),
  arrobas numeric check (arrobas is null or arrobas > 0),
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cattle_sales to authenticated;
grant all on public.cattle_sales to service_role;
alter table public.cattle_sales enable row level security;
create policy "cattle_sales_all_own" on public.cattle_sales for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index cattle_sales_user_idx on public.cattle_sales(user_id, date desc);
create index cattle_sales_lot_idx on public.cattle_sales(lot_id);
