-- Database dell'app birrificio (Supabase / Postgres).
-- Eseguire una volta nel SQL editor del progetto Supabase, poi seed_storico.sql.

-- Chi può usare l'app: solo le email in questa lista.
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
