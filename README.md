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
- `js/vista-cantina.js` pagina Cantina (temperature dei FV in tempo reale); `js/temperature.js` dati delle sonde e curva della cotta
- `tools/gateway-temperature/` programma del mini PC in birrificio che legge le sonde; `tools/esphome/` firmware dei termostati ESP32 di FV6-FV7
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

## Temperature dei fermentatori
Pagina **Cantina**: temperatura, setpoint, freddo acceso/spento e cotta di ogni FV, con allarmi (dati vecchi, sonda guasta, lontano dal setpoint). Unghia **Celle**: Cella 1, Cella 2 e frigo luppoli (sonde DS18B20 su ESP32, allarme fuori da min/max); da queste il registro **HACCP → Temperature celle frigo** (min/max/media giornaliere, esito, azione correttiva, da stampare).
Nella scheda cotta, sezione Fermentazione, la curva misurata nei FV occupati dalla cotta (anche dopo il travaso), inclusa nel PDF.
- Dati scritti dal gateway in birrificio (`tools/gateway-temperature`, Node senza dipendenze) con la chiave segreta di Supabase che sta solo lì; l'app legge con il login (tutti i ruoli, anche il lettore).
- Tabelle e regole: `supabase/migrazione_temperature.sql` (da eseguire una volta). Senza tabelle, offline o in modalità locale la pagina mostra un avviso e il resto dell'app non cambia.
- Tempo reale con Supabase Realtime (WebSocket in `js/sync.js`, senza librerie), con lettura di riserva ogni minuto.
- Installazione, cablaggi e taratura passo passo: `GUIDA-TEMPERATURE.md`.

## Cassa e Contenitori
- **Cassa** (`js/cassa.js`, `js/vista-cassa.js`): prima nota dei contanti, conte della cassa, soldi "da sistemare" (sospesi: non toccano il saldo finché non si segnano incassati o pagati), import da "Cassa Vecas.xlsx".
- **Contenitori** (`js/contenitori.js`, `js/vista-contenitori.js`): magazzino di lattine e polykeg vuoti. Entrano con carichi e inventari, escono da soli con il Confezionamento delle cotte (formati collegati al contenitore; i polykeg 24 L si riempiono a 25 L). Con due contenitori per lo stesso formato (con e senza sacca) la riga del Confezionamento dice quale.
- Fatture dei fornitori (import notturno Fatture in Cloud): le righe di lattine/fusti si confermano la prima volta in Contenitori (codice o descrizione + pezzi per unità restano in `contenitore.codici`); dopo il server (`netlify/lib/automazioni.mjs`) le carica da solo.
- Lotti dei vuoti: entrano con carichi e inventari, confezionamenti e scarichi senza lotto prendono dal più vecchio (FIFO); la rintracciabilità HACCP mostra i lotti di lattine e fusti di ogni lotto di birra.
- Nessuna tabella nuova su Supabase: i record vanno nella tabella `records` come gli altri.
