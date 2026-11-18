-- Rebanho detalhado (opcional): sexo, idade na entrada, fases cria/reprodutor e causa da baixa.
-- Modo simples continua igual: todas as colunas novas são opcionais.
alter table public.cattle_lots add column if not exists sex text check (sex in ('macho','femea'));
alter table public.cattle_lots add column if not exists entry_age_months integer check (entry_age_months between 0 and 360);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.cattle_lots'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%phase%'
  loop
    execute format('alter table public.cattle_lots drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.cattle_lots add constraint cattle_lots_phase_check
  check (phase in ('cria','recria','engorda','reprodutor'));

alter table public.cattle_losses add column if not exists cause text check (cause in ('morte','roubo','sumico','outro'));
