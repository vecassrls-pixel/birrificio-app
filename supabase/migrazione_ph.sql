-- Fermentazione: nel Brewing Schedule la quarta riga da metà 2025 è il pH, non la pressione.
-- Sposta i valori sotto 7 da "psi" a "ph" nelle cotte già caricate. Si può eseguire più volte.
-- L'ora di modifica viene aggiornata, così i dispositivi scaricano la versione corretta.
update records set
  dati = jsonb_set(
    jsonb_set(dati, '{fermentazione}', (
      select jsonb_agg(
        case when jsonb_typeof(e -> 'psi') = 'number' and (e ->> 'psi')::numeric < 7
             then (e - 'psi') || jsonb_build_object('ph', e -> 'psi')
             else e end
        order by i)
      from jsonb_array_elements(dati -> 'fermentazione') with ordinality as t(e, i))),
    '{aggiornato}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  aggiornato = now()
where tipo = 'cotta'
  and jsonb_typeof(dati -> 'fermentazione') = 'array'
  and exists (
    select 1 from jsonb_array_elements(dati -> 'fermentazione') e
    where jsonb_typeof(e -> 'psi') = 'number' and (e ->> 'psi')::numeric < 7);
