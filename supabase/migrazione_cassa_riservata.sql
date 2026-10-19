-- Cassa riservata (Romain 2026-10-19): chi è in sola lettura (ruolo 'lettore') non riceve
-- i record della cassa (movimenti, conte, soldi da sistemare). Admin ed editori vedono tutto come prima.
-- Da eseguire una volta in Supabase → SQL Editor, dopo migrazione_ruoli.sql.
drop policy if exists "autorizzati leggono" on records;
create policy "autorizzati leggono" on records for select to authenticated
  using (autorizzato() and (tipo not in ('movcassa', 'contacassa', 'sospesocassa') or puo_scrivere()));
