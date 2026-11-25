-- Atividade por fazenda (plantio, pecuária ou ILP) e lote ligado à fazenda.
-- Tudo opcional: quem não usa continua igual (fazenda sem atividade segue a conta).
alter table public.properties
  add column if not exists activity text;

alter table public.properties
  drop constraint if exists properties_activity_check;
alter table public.properties
  add constraint properties_activity_check
  check (activity is null or activity in ('plantio','pecuaria','ilp'));

alter table public.cattle_lots
  add column if not exists property_id uuid references public.properties(id) on delete set null;

create index if not exists cattle_lots_property_idx on public.cattle_lots(property_id);
