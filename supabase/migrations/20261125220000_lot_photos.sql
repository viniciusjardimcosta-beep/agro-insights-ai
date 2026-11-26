-- Fotos do lote (até 5 por lote): guardam o estado do gado na compra.
-- Apagadas quando o lote é vendido por inteiro, excluído, ou a conta é excluída.
create table if not exists public.cattle_lot_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lot_id uuid not null references public.cattle_lots(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cattle_lot_photos to authenticated;
grant all on public.cattle_lot_photos to service_role;
alter table public.cattle_lot_photos enable row level security;
drop policy if exists "cattle_lot_photos_all_own" on public.cattle_lot_photos;
create policy "cattle_lot_photos_all_own" on public.cattle_lot_photos for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists cattle_lot_photos_lot_idx on public.cattle_lot_photos(lot_id);

-- No máximo 5 fotos por lote (garantido no banco, não só na tela).
create or replace function public.cattle_lot_photos_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.cattle_lot_photos where lot_id = new.lot_id) >= 5 then
    raise exception 'Limite de 5 fotos por lote';
  end if;
  return new;
end $$;
drop trigger if exists cattle_lot_photos_limit_trg on public.cattle_lot_photos;
create trigger cattle_lot_photos_limit_trg before insert on public.cattle_lot_photos
  for each row execute function public.cattle_lot_photos_limit();

-- Pasta privada de arquivos: cada pessoa só enxerga a própria pasta (user_id/lote/arquivo). Até 1 MB por foto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lot-photos', 'lot-photos', false, 1048576, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/webp'];

drop policy if exists "lot_photos_select_own" on storage.objects;
create policy "lot_photos_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'lot-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "lot_photos_insert_own" on storage.objects;
create policy "lot_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'lot-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "lot_photos_delete_own" on storage.objects;
create policy "lot_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'lot-photos' and (storage.foldername(name))[1] = auth.uid()::text);
