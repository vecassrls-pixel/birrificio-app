-- Database dell'app birrificio (Supabase / Postgres).
-- Eseguire una volta nel SQL editor del progetto Supabase, poi seed_storico.sql.

-- Chi può usare l'app: solo le email in questa lista.
-- Ruoli (colonna ruolo, vedi migrazione_ruoli.sql): admin, editore, lettore (solo lettura).
-- Aggiungere una persona:  insert into utenti_autorizzati (email) values ('nome@esempio.it');
-- Toglierla:               delete from utenti_autorizzati where email = 'nome@esempio.it';
create table if not exists utenti_autorizzati (
  email text primary key,
  aggiunto timestamptz not null default now()
);
alter table utenti_autorizzati enable row level security;
drop policy if exists "vedo me stesso" on utenti_autorizzati;
create policy "vedo me stesso" on utenti_autorizzati for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function autorizzato() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from utenti_autorizzati where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Tutti i dati dell'app (cotte, fermentatori, ...): un record JSON per riga.
create table if not exists records (
  id          text primary key,
  tipo        text not null,
  aggiornato  timestamptz not null,                  -- ora della modifica sul dispositivo
  ricevuto    timestamptz not null default now(),    -- ora del server, usata per scaricare le novità
  eliminato   boolean not null default false,
  dati        jsonb not null
);
create index if not exists records_ricevuto on records (ricevuto);

-- Vince la modifica più recente: un dispositivo rimasto offline a lungo
-- non sovrascrive dati più nuovi arrivati da un altro.
create or replace function records_upsert_guard() returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.aggiornato < old.aggiornato then
    return old;
  end if;
  new.ricevuto := now();
  return new;
end $$ language plpgsql;

drop trigger if exists records_guard on records;
create trigger records_guard before insert or update on records
  for each row execute function records_upsert_guard();

-- Solo gli utenti loggati e presenti nella lista leggono e scrivono.
-- Senza login (anche conoscendo l'indirizzo del sito e la chiave pubblica) non si vede nulla.
alter table records enable row level security;
drop policy if exists "accesso birrificio" on records;
drop policy if exists "solo autorizzati" on records;
create policy "solo autorizzati" on records for all to authenticated
  using (autorizzato()) with check (autorizzato());
revoke all on records from anon;
revoke all on utenti_autorizzati from anon;

-- ---------- Ruoli admin / editore / lettore (uguale a migrazione_ruoli.sql) ----------
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
