-- Temperature dei fermentatori in tempo reale (pagina Cantina e curva nella scheda cotta).
-- Eseguire una volta nel SQL editor di Supabase (SQL Editor → New query → incolla → Run).
-- Si può eseguire più volte: non cancella dati.
--
-- Chi scrive: SOLO il gateway in birrificio (il mini PC Lenovo, tools/gateway-temperature), con la chiave
-- segreta di Supabase (secret / service_role) che sta solo nel suo config.json. La chiave segreta salta le
-- regole qui sotto: non va mai nell'app, in chat o su GitHub.
-- Chi legge: gli utenti in utenti_autorizzati (admin, editore, lettore). Nessun utente dell'app scrive letture.
--
-- Tabelle:
--   sensori                una riga per FV: nome, tipo di sonda, soglie di allarme
--   letture_temperature    storico, una riga ogni 5 minuti per FV (~1,2 milioni di righe l'anno con 11 FV)
--   temperature_attuali    ultimo valore di ogni FV, aggiornato ogni ~15 s (Realtime per la pagina Cantina)

-- Funzioni dei ruoli (uguali a migrazione_ruoli.sql): se esistono già non cambia nulla.
alter table utenti_autorizzati add column if not exists ruolo text not null default 'editore';
create or replace function ruolo_utente() returns text
language sql stable security definer set search_path = public as $$
  select ruolo from utenti_autorizzati where lower(email) = lower(auth.jwt() ->> 'email');
$$;
create or replace function puo_scrivere() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(ruolo_utente() in ('admin', 'editore'), false);
$$;

-- ---------- sensori: uno per FV ----------
create table if not exists sensori (
  fv                  text primary key,                  -- 'FV1' … 'FV11', come i nomi dei fermentatori nell'app
  nome                text,                              -- descrizione libera (es. 'TK4S indirizzo 1')
  tipo                text not null check (tipo in ('modbus', 'esp32', 'plc')),
  attivo              boolean not null default true,
  soglia_scostamento  numeric(4, 1) not null default 1.5, -- allarme se |temperatura - setpoint| supera questo valore (°C)
  temp_min            numeric(5, 1),                     -- allarme sotto questa temperatura (facoltativo)
  temp_max            numeric(5, 1),                     -- allarme sopra questa temperatura (facoltativo)
  minuti_offline      integer not null default 10,       -- allarme "sensore muto" dopo questi minuti senza dati
  note                text,
  aggiornato          timestamptz not null default now()
);

insert into sensori (fv, nome, tipo) values
  ('FV1', 'Autonics TK4S indirizzo 1', 'modbus'),
  ('FV2', 'Autonics TK4S indirizzo 2', 'modbus'),
  ('FV3', 'Autonics TK4S indirizzo 3', 'modbus'),
  ('FV4', 'Autonics TK4S indirizzo 4', 'modbus'),
  ('FV5', 'Autonics TK4S indirizzo 5', 'modbus'),
  ('FV6', 'ESP32 termostato', 'esp32'),
  ('FV7', 'ESP32 termostato', 'esp32'),
  ('FV8', 'PLC S7-200 SMART (pannello 3#)', 'plc'),
  ('FV9', 'PLC S7-200 SMART (pannello 4#)', 'plc'),
  ('FV10', 'PLC S7-200 SMART (pannello 1#)', 'plc'),
  ('FV11', 'PLC S7-200 SMART (da collegare)', 'plc')
on conflict (fv) do nothing;

-- ---------- storico: una lettura ogni 5 minuti per FV ----------
create table if not exists letture_temperature (
  id                  bigint generated always as identity primary key,
  fv                  text not null,
  ts                  timestamptz not null,              -- fine del periodo di 5 minuti (ora del gateway, sincronizzata)
  temperatura         numeric(5, 2),                     -- media del periodo, °C
  setpoint            numeric(5, 2),                     -- null se la sorgente non lo dà
  raffreddamento      boolean,                           -- freddo acceso almeno una volta nel periodo (null se non si sa)
  raffreddamento_pct  smallint check (raffreddamento_pct between 0 and 100), -- % del periodo con il freddo acceso
  fonte               text                               -- 'modbus' | 'esp32' | 'plc' | 'simulazione'
);
-- (fv, ts) unico: se il gateway rimanda una lettura dal buffer offline non si creano doppioni.
-- È anche l'indice per i grafici (letture di un FV in un intervallo di date).
create unique index if not exists letture_temperature_fv_ts on letture_temperature (fv, ts);

-- ---------- stato attuale: una riga per FV, per la pagina Cantina ----------
create table if not exists temperature_attuali (
  fv                  text primary key,
  ts                  timestamptz not null,              -- ora della lettura
  temperatura         numeric(5, 2),
  setpoint            numeric(5, 2),
  raffreddamento      boolean,
  errore              text,                              -- es. 'sonda scollegata', 'nessuna risposta'; null se ok
  fonte               text,
  ricevuto            timestamptz not null default now() -- ora del server
);
create or replace function temperature_attuali_ricevuto() returns trigger as $$
begin
  new.ricevuto := now();
  return new;
end $$ language plpgsql;
drop trigger if exists temperature_attuali_ricevuto on temperature_attuali;
create trigger temperature_attuali_ricevuto before insert or update on temperature_attuali
  for each row execute function temperature_attuali_ricevuto();

-- ---------- regole di accesso ----------
alter table sensori enable row level security;
alter table letture_temperature enable row level security;
alter table temperature_attuali enable row level security;

-- tutti gli autorizzati leggono
drop policy if exists "autorizzati leggono" on sensori;
drop policy if exists "autorizzati leggono" on letture_temperature;
drop policy if exists "autorizzati leggono" on temperature_attuali;
create policy "autorizzati leggono" on sensori for select to authenticated using (autorizzato());
create policy "autorizzati leggono" on letture_temperature for select to authenticated using (autorizzato());
create policy "autorizzati leggono" on temperature_attuali for select to authenticated using (autorizzato());

-- soglie di allarme: le cambiano admin ed editori (i lettori no)
drop policy if exists "editori modificano" on sensori;
create policy "editori modificano" on sensori for update to authenticated using (puo_scrivere()) with check (puo_scrivere());

-- letture: nessuna regola di scrittura per gli utenti dell'app → solo il gateway (chiave segreta) scrive
revoke all on sensori, letture_temperature, temperature_attuali from anon;
revoke insert, update, delete on letture_temperature, temperature_attuali from authenticated;
revoke insert, delete on sensori from authenticated;
grant select on sensori, letture_temperature, temperature_attuali to authenticated;
grant update on sensori to authenticated;

-- ---------- medie per i grafici (curva della cotta) ----------
-- Medie a intervalli fissi: una cotta di 40 giorni ha ~11.500 letture per FV, il grafico ne usa poche centinaia.
-- security invoker: valgono le regole di accesso di chi chiama.
create or replace function temperature_medie(p_fv text, p_da timestamptz, p_a timestamptz, p_minuti integer default 60)
returns table (ts timestamptz, temperatura numeric, setpoint numeric, raffreddamento_pct numeric, n integer)
language sql stable security invoker set search_path = public as $$
  select date_bin(make_interval(mins => greatest(p_minuti, 5)), l.ts, timestamptz '2000-01-01') as ts,
         round(avg(l.temperatura), 2),
         round(avg(l.setpoint), 2),
         round(avg(coalesce(l.raffreddamento_pct, case when l.raffreddamento then 100 when not l.raffreddamento then 0 end)), 0),
         count(*)::integer
  from letture_temperature l
  where l.fv = p_fv and l.ts >= p_da and l.ts < p_a
  group by 1
  order by 1;
$$;
revoke execute on function temperature_medie(text, timestamptz, timestamptz, integer) from anon;
grant execute on function temperature_medie(text, timestamptz, timestamptz, integer) to authenticated;

-- ---------- Realtime: la pagina Cantina riceve gli aggiornamenti senza ricaricare ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'temperature_attuali') then
    alter publication supabase_realtime add table temperature_attuali;
  end if;
end $$;

-- ---------- utilità (da eseguire a mano, se serve) ----------
-- Togliere i dati finti del gateway in modalità simulazione:
--   delete from letture_temperature where fonte = 'simulazione';
--   delete from temperature_attuali where fonte = 'simulazione';
-- Spazio occupato dallo storico:
--   select pg_size_pretty(pg_total_relation_size('letture_temperature'));
-- Cambiare la soglia di allarme di un FV (anche dall'app non serve: basta qui):
--   update sensori set soglia_scostamento = 1.0 where fv = 'FV8';
