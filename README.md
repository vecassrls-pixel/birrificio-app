# Produzione Birrificio (app web offline)

Primo modulo del tool globale: **schede cotta** e **planning dei fermentatori**.

- App installabile (PWA), funziona offline: i dati stanno sul dispositivo (IndexedDB).
- Online: login con email (Supabase Auth, niente registrazione libera) e dati protetti dalle regole del database: solo le email in `utenti_autorizzati` leggono e scrivono (`supabase/schema.sql`). Senza `js/config.js` compilato l'app gira in modalità solo locale (anteprima).
- Messa online passo per passo: `GUIDA-ONLINE.md`. Build Netlify: `tools/build.mjs` (scrive config.js dalle variabili d'ambiente, non pubblica lo storico). Storico nel database: `supabase/seed_storico_1..5.sql` (rigenerabili con `tools/genera_seed.py`, poi divisi in parti da ~200 KB per l'editor SQL di Supabase).
  Il collegamento al cloud passa da `js/sync.js`: per cambiare servizio basta un altro adattatore con `invia()` e `ricevi()`.
- Nessuna build: file statici (HTML, CSS, JS moduli). Si pubblica su qualunque hosting statico (Netlify, Vercel, GitHub Pages).

## Struttura
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js` (cache offline), icone
- `js/app.js` interfaccia (Cotte, Scheda cotta, Planning, Impostazioni)
- `js/dominio.js` regole: stato cotta, fine in FV, durate tipiche per birra, conflitti FV, copia ricetta
- `js/db.js` archivio locale; `js/sync.js` sincronizzazione
- `data/storico.json` cotte storiche, generato da `tools/importa_storico.py`

## Rigenerare lo storico
    python3 tools/importa_storico.py /mnt/project-files data/storico.json
Legge tutte le `SCHEDA-COTTA_*.xlsx` (lotto e anno dal nome file) e il `Brewing Schedule Kashmir.xlsx`
(fogli 2024-2026: righe giorno / temperatura / densità / psi per batch).

## Provare in locale
    python3 -m http.server 8765   # poi aprire http://localhost:8765

## Brewfather
Ricette e cotte si scrivono in Brewfather; l'app le importa (Impostazioni > Brewfather) e aggiunge FV, tacche, letture, confezionamento.
- Proxy server: `netlify/functions/brewfather.mjs` (solo lettura: batches, readings, recipes). Credenziali come variabili d'ambiente Netlify `BREWFATHER_USER_ID` e `BREWFATHER_API_KEY` (Brewfather > Impostazioni > API, permessi batches.read e recipes.read). Mai nei file del progetto.
- Conversione e abbinamento in `js/brewfather.js`. Il planning si fa prima nell'app: una cotta Brewfather si collega da sola alla cotta pianificata con birra simile entro 14 giorni (o stesso n°/anno), spostando fine in FV e profilo se la data è cambiata. Altrimenti si collega a mano dalla scheda cotta ("Collega a Brewfather").
- Limite API: 500 chiamate/ora. "Aggiorna cotte in corso" scarica solo Planning/Brewing/Fermenting/Conditioning.
