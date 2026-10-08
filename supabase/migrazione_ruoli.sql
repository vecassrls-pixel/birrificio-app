-- Ruoli degli utenti: admin, editore, lettore.
--   admin   = legge, modifica e gestisce gli utenti (dalla pagina Impostazioni)
--   editore = legge e modifica
--   lettore = solo lettura: il database rifiuta qualsiasi modifica
-- Eseguire una volta nel SQL editor di Supabase. Il primo utente aggiunto diventa admin.

alter table utenti_autorizzati add column if not exists ruolo text not null default 'editore';
alter table utenti_autorizzati drop constraint if exists utenti_ruolo_valido;
alter table utenti_autorizzati add constraint utenti_ruolo_valido check (ruolo in ('admin', 'editore', 'lettore'));
update utenti_autorizzati set ruolo = 'admin'
  where email = (select email from utenti_autorizzati order by aggiunto limit 1)
    and not exists (select 1 from utenti_autorizzati where ruolo = 'admin');

create or replace function ruolo_utente() returns text
language sql stable security definer set search_path = public as $$
  select ruolo from utenti_autorizzati where lower(email) = lower(auth.jwt() ->> 'email');
$$;
create or replace function puo_scrivere() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(ruolo_utente() in ('admin', 'editore'), false);
$$;

-- dati: tutti gli autorizzati leggono, solo admin ed editori scrivono
drop policy if exists "solo autorizzati" on records;
drop policy if exists "autorizzati leggono" on records;
drop policy if exists "editori inseriscono" on records;
drop policy if exists "editori modificano" on records;
drop policy if exists "editori eliminano" on records;
create policy "autorizzati leggono" on records for select to authenticated using (autorizzato());
create policy "editori inseriscono" on records for insert to authenticated with check (puo_scrivere());
create policy "editori modificano" on records for update to authenticated using (puo_scrivere()) with check (puo_scrivere());
create policy "editori eliminano" on records for delete to authenticated using (puo_scrivere());

-- utenti: ognuno vede sé stesso, l'admin vede e gestisce tutti
drop policy if exists "admin gestisce utenti" on utenti_autorizzati;
create policy "admin gestisce utenti" on utenti_autorizzati for all to authenticated
  using (ruolo_utente() = 'admin') with check (ruolo_utente() = 'admin');
grant select, insert, update, delete on utenti_autorizzati to authenticated;
