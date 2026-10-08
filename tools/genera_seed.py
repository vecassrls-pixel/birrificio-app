"""Genera supabase/seed_storico.sql: cotte storiche e fermentatori FV1-FV10 da caricare una volta nel database.

Uso:  python3 tools/genera_seed.py data/storico.json supabase
Scrive seed_storico_1..N.sql da 50 righe ciascuno (il SQL editor di Supabase non accetta file troppo grandi).
Le righe esistenti con lo stesso id non vengono toccate (on conflict do nothing).
"""
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
cotte = json.load(open(src))["cotte"]
ora = "2026-10-08T00:00:00Z"
righe = [{"id": f"fv-FV{i}", "tipo": "fv", "nome": f"FV{i}", "capacita": None} for i in range(1, 11)]
righe += [{k: v for k, v in c.items() if k != "stato"} for c in cotte]

parti = range(0, len(righe), 50)
for n, i in enumerate(parti, 1):
    with open(f"{dst}/seed_storico_{n}.sql", "w") as out:
        out.write(f"-- Storico cotte, parte {n} di {len(parti)}. Eseguire dopo schema.sql.\n")
        out.write("insert into records (id, tipo, aggiornato, dati) values\n")
        valori = []
        for r in righe[i:i + 50]:
            r = {**r, "aggiornato": ora}
            j = json.dumps(r, ensure_ascii=False)
            assert "$j$" not in j
            valori.append(f"('{r['id']}', '{r['tipo']}', '{ora}', $j${j}$j$::jsonb)")
        out.write(",\n".join(valori) + "\non conflict (id) do nothing;\n")
print(len(righe), "righe")
