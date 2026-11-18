-- Nascimentos na fazenda: o bezerro nasce como um lote (idade 0) ligado ao lote de matrizes e ao touro pai.
-- Colunas opcionais; o modo simples não usa nada disso.
alter table public.cattle_lots add column if not exists born_here boolean not null default false;
alter table public.cattle_lots add column if not exists sire_name text check (char_length(sire_name) <= 80);
alter table public.cattle_lots add column if not exists dam_lot_id uuid references public.cattle_lots(id) on delete set null;
