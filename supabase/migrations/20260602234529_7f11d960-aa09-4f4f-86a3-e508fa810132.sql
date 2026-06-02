
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- handle_new_user trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city text,
  state text,
  total_area numeric not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.properties to authenticated;
grant all on public.properties to service_role;
alter table public.properties enable row level security;
create policy "properties_all_own" on public.properties for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index properties_user_idx on public.properties(user_id);

-- Fields (talhões)
create table public.fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  area numeric not null default 0,
  crop text not null,
  season text,
  planting_date date,
  estimated_yield numeric,
  real_yield numeric,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.fields to authenticated;
grant all on public.fields to service_role;
alter table public.fields enable row level security;
create policy "fields_all_own" on public.fields for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index fields_user_idx on public.fields(user_id);
create index fields_property_idx on public.fields(property_id);

-- Costs
create table public.costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  category text not null,
  description text,
  amount numeric not null default 0,
  date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.costs to authenticated;
grant all on public.costs to service_role;
alter table public.costs enable row level security;
create policy "costs_all_own" on public.costs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index costs_user_idx on public.costs(user_id);
create index costs_field_idx on public.costs(field_id);

-- Prices
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crop text not null,
  price_per_bag numeric not null default 0,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.prices to authenticated;
grant all on public.prices to service_role;
alter table public.prices enable row level security;
create policy "prices_all_own" on public.prices for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index prices_user_idx on public.prices(user_id);

-- AI Threads
create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ai_threads to authenticated;
grant all on public.ai_threads to service_role;
alter table public.ai_threads enable row level security;
create policy "ai_threads_all_own" on public.ai_threads for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index ai_threads_user_idx on public.ai_threads(user_id, updated_at desc);

-- AI Messages
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ai_messages to authenticated;
grant all on public.ai_messages to service_role;
alter table public.ai_messages enable row level security;
create policy "ai_messages_all_own" on public.ai_messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index ai_messages_thread_idx on public.ai_messages(thread_id, created_at);
