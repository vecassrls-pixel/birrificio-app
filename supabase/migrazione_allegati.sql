-- Allegati delle cotte (PDF delle analisi): spazio file privato "allegati" in Supabase Storage.
-- Leggono tutti gli utenti autorizzati, caricano/sostituiscono/tolgono solo admin ed editori.
-- Si può eseguire più volte (SQL Editor di Supabase → incolla → Run).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('allegati', 'allegati', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "allegati: autorizzati leggono" on storage.objects;
drop policy if exists "allegati: editori caricano" on storage.objects;
drop policy if exists "allegati: editori modificano" on storage.objects;
drop policy if exists "allegati: editori eliminano" on storage.objects;
create policy "allegati: autorizzati leggono" on storage.objects for select to authenticated
  using (bucket_id = 'allegati' and public.autorizzato());
create policy "allegati: editori caricano" on storage.objects for insert to authenticated
  with check (bucket_id = 'allegati' and public.puo_scrivere());
create policy "allegati: editori modificano" on storage.objects for update to authenticated
  using (bucket_id = 'allegati' and public.puo_scrivere()) with check (bucket_id = 'allegati' and public.puo_scrivere());
create policy "allegati: editori eliminano" on storage.objects for delete to authenticated
  using (bucket_id = 'allegati' and public.puo_scrivere());
