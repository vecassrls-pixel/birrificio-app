-- Economia riservata (Romain 2026-10-28): come la cassa, chi è in sola lettura (ruolo 'lettore') non riceve
-- i record di accise, stipendi e F24 (né cassa, cashflow e vendite dell'eshop). Admin ed editori vedono tutto.
-- Sostituisce la policy di migrazione_cassa_riservata.sql: si può eseguire anche se quella non è mai stata eseguita.
-- Da eseguire una volta in Supabase → SQL Editor, dopo migrazione_ruoli.sql.
drop policy if exists "autorizzati leggono" on records;
create policy "autorizzati leggono" on records for select to authenticated
  using (autorizzato() and (tipo not in ('movcassa', 'contacassa', 'sospesocassa', 'cashflow', 'accisa', 'stipendio', 'f24', 'venditaeshop') or puo_scrivere()));
