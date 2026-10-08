-- Materie prime: le cotte in programma che nel Brewing Schedule hanno il n° cotta in verde
-- (materie prime ordinate o in magazzino). Si può eseguire più volte.
update records set
  dati = dati || jsonb_build_object(
    'materiePrime', true,
    'aggiornato', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  aggiornato = now()
where id in ('cotta-60-26-sched', 'cotta-61-26-sched', 'cotta-62-26-sched', 'cotta-63-26-sched',
             'cotta-64-26-sched', 'cotta-65-26-sched', 'cotta-66-26-sched')
  and not coalesce((dati ->> 'materiePrime')::boolean, false);
