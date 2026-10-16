# Gateway temperature dei fermentatori

Programma che gira sul mini PC **Lenovo ThinkCentre Tiny** in birrificio: legge le temperature dei fermentatori e le manda a Supabase, da dove l'app le mostra nella pagina **Cantina** e nella curva di ogni cotta.

| FV | Strumento | Come lo legge |
|---|---|---|
| FV1-FV5 | Autonics TK4S-B4RN (PT100), RS485 indirizzi 1-5, 9600 baud | Modbus TCP verso il Waveshare RS485 TO WIFI/ETH (porta 502) |
| FV6-FV7 | Scheda ESP32 + relè con firmware ESPHome (`tools/esphome`) | pagina web della scheda (REST) |
| FV8-FV11 | PLC Siemens S7-200 SMART CPU SR30 + EM AE08 + EM AE04 | protocollo S7, **solo lettura** |

- Ogni **15 secondi** aggiorna `temperature_attuali` (pagina Cantina, in tempo reale).
- Ogni **5 minuti** salva una riga di storico per FV in `letture_temperature` (media dei 5 minuti).
- **Senza internet** lo storico va nel file `/var/lib/gateway-temperature/buffer.jsonl` e parte da solo al ritorno della rete.
- Il gateway **non apre porte** verso internet: esce solo verso Supabase.

La guida completa (cablaggi, firmware ESP32, taratura) è in [`GUIDA-TEMPERATURE.md`](../../GUIDA-TEMPERATURE.md). Qui solo il programma.

## Perché nessuna libreria esterna

Il programma usa solo Node.js (versione 18 o più recente), senza pacchetti da scaricare:

- **Modbus TCP**: servono solo le funzioni di lettura 03 e 04, poche righe (`lib/modbus.mjs`).
- **PLC S7**: `node-snap7` richiede la compilazione di codice nativo (build-essential, python, node-gyp) e si rompe a ogni aggiornamento di Node; `nodes7` è puro JavaScript ma contiene anche le funzioni di scrittura. Il nostro client (`lib/s7.mjs`) costruisce **solo** i messaggi di connessione e di lettura: anche per errore non può scrivere nel PLC né fermarlo.
- **ESP32 e Supabase**: semplici richieste HTTP con `fetch`, già dentro Node.

Così l'installazione è una copia di file e gli aggiornamenti di Ubuntu non rompono niente.

## Installazione (sul Lenovo con Ubuntu Server)

1. Copiare questa cartella sul Lenovo, per esempio con una chiavetta USB o con:
   ```
   git clone <indirizzo del repository> && cd birrificio-app/tools/gateway-temperature
   ```
2. Installare:
   ```
   sudo bash installa.sh
   ```
   Installa Node.js (se manca), crea l'utente di servizio `gateway`, copia il programma in `/opt/gateway-temperature`, crea `/etc/gateway-temperature/config.json` dall'esempio e registra il servizio di avvio automatico.
3. Compilare la configurazione:
   ```
   sudo nano /etc/gateway-temperature/config.json
   ```
   - `supabase.url`: il Project URL (`https://xxxx.supabase.co`)
   - `supabase.chiave`: la chiave **secret** (Supabase → Project Settings → API Keys → secret, `sb_secret_…`; oppure la vecchia *service_role*). Resta solo in questo file, leggibile solo da root e dal servizio.
   - indirizzi IP del Waveshare, delle schede ESP32 e del PLC, mappa canali/FV: vedere la guida, capitolo "Messa in servizio".
   - Per una sorgente non ancora installata mettere `"attivo": false`.
4. Provare le sonde senza inviare nulla:
   ```
   sudo -u gateway node /opt/gateway-temperature/gateway.mjs --test --config /etc/gateway-temperature/config.json
   ```
   Stampa per ogni FV temperatura, setpoint, freddo ed eventuali errori, e controlla il collegamento a Supabase.
5. Avviare il servizio:
   ```
   sudo systemctl restart gateway-temperature
   ```
6. Controllare:
   ```
   systemctl status gateway-temperature        # deve dire "active (running)"
   journalctl -u gateway-temperature -f        # log in diretta (Ctrl+C per uscire)
   ```
   Nell'app, pagina **Cantina**: le schede dei FV collegati diventano verdi con "aggiornato adesso".

Dopo ogni modifica a `config.json`: `sudo systemctl restart gateway-temperature`.
Per aggiornare il programma: copiare la nuova cartella e rilanciare `sudo bash installa.sh` (la configurazione resta).

## Comandi utili

| Comando | A cosa serve |
|---|---|
| `node gateway.mjs --test` | legge ogni sorgente una volta e stampa i valori; per il PLC prova anche le due aree degli ingressi analogici |
| `node gateway.mjs --simula` | letture finte (fonte `simulazione`) inviate a Supabase, per provare l'app senza hardware |
| `node gateway.mjs --simula --secco` | letture finte solo a schermo, nessun invio (funziona anche senza config.json) |
| `node gateway.mjs --simula --storico 30` | in più carica 30 giorni di storico finto, per vedere le curve nelle schede cotta |
| `node gateway.mjs --cerca-plc 192.168.2.0/24` | cerca nella rete chi ha la porta S7 (102) aperta: il PLC |
| `node gateway.mjs --cerca-v 0 400` | legge la memoria V del PLC (VB0-VB400, **sola lettura**) e mostra i numeri che sembrano temperature o setpoint |
| `npm test` | prove del programma con strumenti finti (non serve l'hardware) |

Aggiungere `--config /etc/gateway-temperature/config.json` quando si lancia a mano sul Lenovo.

Dopo una prova con `--simula` sul database vero, togliere i dati finti dal SQL editor di Supabase:
```sql
delete from letture_temperature where fonte = 'simulazione';
delete from temperature_attuali where fonte = 'simulazione';
```

## File

- `gateway.mjs` programma principale (ciclo di lettura, storico, buffer, modalità di prova)
- `lib/modbus.mjs` client Modbus TCP (solo lettura) · `lib/s7.mjs` client S7 (solo lettura) · `lib/esp32.mjs` lettura REST ESPHome
- `lib/sorgenti.mjs` i tre blocchi di FV e la conversione in °C · `lib/supabase.mjs` invio · `lib/buffer.mjs` buffer offline · `lib/simulazione.mjs`
- `config.esempio.json` configurazione di esempio (quella vera, `config.json`, non va su GitHub)
- `gateway-temperature.service` servizio systemd · `installa.sh` installazione
