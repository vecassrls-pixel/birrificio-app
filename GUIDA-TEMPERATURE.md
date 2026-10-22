# Temperature dei fermentatori: guida all'installazione

Guida passo passo per mettere in funzione le temperature in tempo reale (pagina **Cantina** dell'app e curva di ogni cotta).
Tutto il software è già pronto; qui ci sono i collegamenti, le impostazioni e le prove da fare sul posto.
I punti segnati **DA VERIFICARE** sono valori di partenza che vanno controllati sull'hardware vero.

```
FV1-FV5  Autonics TK4S ──RS485──► Waveshare RS485 TO WIFI/ETH ─┐
FV6-FV7  ESP32 + relè (ESPHome) ──Wi-Fi──────────────────────────┼──► Lenovo (gateway) ──internet──► Supabase ──► App
FV8-FV11 PLC S7-200 SMART ──cavo di rete──► switch ──────────────┤    buffer se manca internet
Cella 1-2  Pego ECP200 ──RS485──► adattatore USB-RS485 ───────────┤
Frigo luppoli  ESP32 + DS18B20 ──Wi-Fi────────────────────────────┘
```

Ordine consigliato: **1.** database Supabase → **2.** Lenovo (prima con Windows, poi Linux) → **3.** PLC (FV8-FV10) → **4.** ESP32 (FV6-FV7) → **5.** TK4S (FV1-FV5) → **6.** taratura e prove.
Ogni blocco funziona da solo: si può partire con quello che è già montato e mettere `"attivo": false` agli altri.

---

## 1. Database Supabase (5 minuti)

1. Supabase → **SQL Editor → New query**.
2. Aprire il file **`supabase/migrazione_temperature.sql`**, copiare tutto, incollare, **Run**. Deve comparire "Success".
   Crea le tabelle `sensori`, `letture_temperature`, `temperature_attuali`, le regole di accesso e attiva il tempo reale. Si può rieseguire senza perdere dati.
3. Controllo: **Database → Publications → supabase_realtime** deve contenere `temperature_attuali`.
4. Copiare la chiave **secret**: **Project Settings → API Keys → secret** (`sb_secret_…`; se c'è solo la scheda *Legacy*, la chiave *service_role*).
   Questa chiave va **solo** nel file di configurazione del Lenovo (punto 2.6). Mai in chat, nell'app, su GitHub o su Netlify per questo scopo.

Chi può fare cosa: tutti gli utenti dell'app (anche i collaboratori in sola lettura) **vedono** le temperature; solo il gateway le **scrive**. Le soglie di allarme (tabella `sensori`) le cambiano admin ed editori dal SQL editor, per esempio:
```sql
update sensori set soglia_scostamento = 1.0, minuti_offline = 15 where fv = 'FV8';
```

---

## 2. Il gateway: Lenovo ThinkCentre Tiny

Il Lenovo sta **fuori** dall'armadio del PLC (su una mensola vicina): cavo di rete verso lo switch del PLC, Wi-Fi verso internet, le schede ESP32 e il Waveshare.

### 2.1 PRIMA di installare Linux: copia del programma del PLC (con Windows)

Il Lenovo arriva con Windows. **Prima di cancellarlo** si usa per fare una copia di sicurezza del programma del PLC: è l'unico computer Windows disponibile, e senza documentazione dell'armadio questa copia è preziosa (dice anche dove il programma tiene temperature e setpoint).

1. Scaricare e installare **STEP 7-Micro/WIN SMART** (gratuito, dal sito Siemens: cercare "STEP 7-Micro/WIN SMART download"; serve un account Siemens gratuito).
2. Collegare il Lenovo al PLC con un cavo di rete (alla porta libera dello switch o, temporaneamente, direttamente al PLC al posto del pannello MCGS).
3. In Micro/WIN SMART: **Comunicazione** (doppio clic nell'albero a sinistra) → scegliere la scheda di rete del Lenovo → **Trova CPU**. Compare la CPU con il suo **indirizzo IP**: **scriverlo** (serve dopo).
   Se il Lenovo non è nella stessa rete del PLC, impostare in Windows un IP fisso della stessa famiglia (es. PLC `192.168.2.1` → Lenovo `192.168.2.100`, maschera `255.255.255.0`): *Impostazioni → Rete → Ethernet → Modifica impostazioni IP*.
4. Premere **Carica** (in inglese *Upload*: dal PLC al computer). Questo **legge** soltanto.
   > **Non premere mai "Scarica" (*Download*)**: manderebbe un programma dal computer al PLC e potrebbe fermare l'impianto.
5. Salvare il progetto (**File → Salva con nome**) su una **chiavetta USB**, e tenerne una seconda copia altrove. Fare anche una foto della finestra "Comunicazione" con l'IP.
6. Se il programma è protetto da password il caricamento fallisce: **non è un problema**, non si è toccato nulla. Si va avanti lo stesso (gli indirizzi si troveranno con `--cerca-v`, punto 3.4).

Il file del progetto si può mandare a Claude: dal programma si leggono la scala degli ingressi analogici e gli indirizzi della memoria V di temperature e setpoint.

### 2.2 Installare Ubuntu Server

1. Da un PC qualsiasi: scaricare **Ubuntu Server 26.04 LTS** (ubuntu.com/download/server; sempre la LTS, non le versioni intermedie) e **Rufus** (rufus.ie, Windows) o **balenaEtcher** (Mac); con questo scrivere l'immagine su una chiavetta USB da almeno 4 GB (si cancella).
2. Riavviare il Lenovo con la chiavetta inserita premendo **F12** (menu di avvio) e scegliere la chiavetta.
3. Installazione: lingua, tastiera italiana; **rete**: configurare il **Wi-Fi** del birrificio (o il cavo, se è collegato a internet); disco: **usa tutto il disco** (Windows viene cancellato); nome utente e password (scriverli); spuntare **Install OpenSSH server**; nessun pacchetto aggiuntivo.
4. A fine installazione togliere la chiavetta e riavviare. Entrare con utente e password, poi:
   ```
   sudo apt update && sudo apt full-upgrade -y
   sudo timedatectl set-timezone Europe/Rome
   ```
5. Nel BIOS (F1 all'accensione) impostare **riaccensione automatica dopo mancanza di corrente** (*Power → After Power Loss → Power On*), così il gateway riparte da solo.

### 2.3 Rete: cavo verso il PLC, Wi-Fi verso internet

Il cavo va nella rete del PLC (che **non** ha internet): gli si dà un IP fisso **senza gateway**, così internet resta sul Wi-Fi.
Esempio con PLC in `192.168.2.x` (usare la famiglia dell'IP trovato al punto 2.1):
```
ip -br link          # nome della scheda di rete via cavo, es. enp0s31f6
sudo nano /etc/netplan/60-plc.yaml
```
```yaml
network:
  version: 2
  ethernets:
    enp0s31f6:                 # il nome trovato con ip -br link
      addresses: [192.168.2.100/24]
      dhcp4: false
```
```
sudo chmod 600 /etc/netplan/60-plc.yaml && sudo netplan apply
ping -c 3 192.168.2.1        # deve rispondere il PLC
```
Sul router del birrificio conviene dare un **IP fisso** (prenotazione DHCP) al Lenovo, al Waveshare e alle due schede ESP32.

### 2.4 Installare il programma del gateway

```
sudo apt install -y git
git clone <indirizzo del repository dell'app> && cd birrificio-app/tools/gateway-temperature
sudo bash installa.sh
```
(In alternativa copiare la cartella `tools/gateway-temperature` con una chiavetta.)
Dettagli e comandi: `tools/gateway-temperature/README.md`.

### 2.5 Provare l'app senza hardware (facoltativo)

Per vedere subito la pagina Cantina piena di dati finti:
```
sudo -u gateway node /opt/gateway-temperature/gateway.mjs --simula --storico 30 --config /etc/gateway-temperature/config.json
```
(Ctrl+C per fermare). Dopo la prova cancellare i dati finti (query in fondo a `supabase/migrazione_temperature.sql`).

### 2.6 Configurazione

```
sudo nano /etc/gateway-temperature/config.json
```
Compilare `supabase.url` e `supabase.chiave` (la secret del punto 1.4), poi i blocchi `modbus`, `esp32`, `plc` man mano che vengono installati (capitoli 3-5). Un blocco non ancora montato: `"attivo": false`.
Salvare con Ctrl+O, Invio, Ctrl+X. Poi: `sudo systemctl restart gateway-temperature`.

### 2.7 Verificare che funzioni

```
systemctl status gateway-temperature      # "active (running)"
journalctl -u gateway-temperature -f      # log in diretta; gli errori di una sonda compaiono una volta sola, quando cambiano
```
Nell'app → **Cantina**: in alto "● in tempo reale"; le schede dei FV collegati sono verdi con "aggiornato adesso".

---

## 3. FV8-FV11: PLC Siemens S7-200 SMART (solo lettura)

### 3.1 Collegamento
- Switch 5 porte nell'armadio (o vicino): **PLC → switch**, **pannello MCGS → switch**, **Lenovo → switch** (il cavo che oggi va dal PLC al pannello si sostituisce con i due patch corti).
- Nessuna modifica al programma del PLC. Il gateway **non scrive mai** nel PLC: il suo codice non contiene nemmeno la funzione di scrittura.

### 3.2 Configurazione (`plc` in config.json)
- `host`: IP del PLC (punto 2.1; oppure `node /opt/gateway-temperature/gateway.mjs --cerca-plc 192.168.2.0/24`).
- `tsap_locale` / `tsap_remoto`: `0x0100` / `0x0101` (rack 0, slot 1). Se la connessione è rifiutata provare `0x0200`/`0x0201` o `0x0300`/`0x0301`.
- `area_ai`: `AI200` oppure `P`. **DA VERIFICARE**: `--test` le prova tutte e due e mostra quale risponde.
- `canali`: un canale per FV. **DA VERIFICARE** quale ingresso è quale FV. Valori di partenza:

| FV | Pannello MCGS | Ingresso (ipotesi) |
|---|---|---|
| FV10 | 1# | AIW16 (modulo 0 = EM AE08, canale 0) |
| FV8 | 3# | AIW20 (modulo 0, canale 2) |
| FV9 | 4# | AIW22 (modulo 0, canale 3) |
| FV11 | — | da collegare (`"ingresso": null`) |

  Modulo 0 (EM AE08) parte da **AIW16**, modulo 1 (EM AE04) da **AIW32**: **DA VERIFICARE** (dipende dall'ordine dei moduli; nel progetto Micro/WIN si vede in *Blocco di sistema*).
- Scala: con trasmettitori 4-20 mA il valore grezzo va da **5530** (4 mA) a **27648** (20 mA). `temp_min`/`temp_max` = intervallo del trasmettitore (es. -50…150 °C): **DA VERIFICARE** sull'etichetta del trasmettitore o con la taratura (3.3).
  Indizio: gli ingressi senza sonda sul pannello segnano **-62,5 °C**. Con 0 mA il valore è `temp_min − 25% dell'intervallo`: per esempio un intervallo -20…150 °C o 0…250 °C dà proprio -62,5. Da confermare.
- `setpoint`: indirizzo nella memoria V (es. `VD200` se è un numero reale in gradi, `VW200` con `"setpoint_fattore": 0.1`). Sconosciuto: lasciare `null`.
- `raffreddamento`: uscita dell'elettrovalvola (es. `Q0.3`), facoltativo; si trova guardando quale LED delle uscite del PLC si accende quando il pannello mostra il freddo attivo.

### 3.3 Taratura con il pannello MCGS
1. `sudo -u gateway node /opt/gateway-temperature/gateway.mjs --test --config /etc/gateway-temperature/config.json`
   Per ogni canale stampa il valore **grezzo** (riga "plc FV10 AIW16: grezzo …") e la temperatura calcolata.
2. Annotare grezzo e temperatura del pannello per ogni FV, in due momenti con temperature diverse (es. 19 °C in fermentazione e 1 °C a freddo).
3. Con due coppie (g1, T1) e (g2, T2): `pendenza = (T2 − T1) / (g2 − g1)`, poi
   `temp_min = T1 + (grezzo_min − g1) × pendenza` e `temp_max = T1 + (grezzo_max − g1) × pendenza`.
   Con una sola coppia: lasciare la scala e correggere solo `offset` (= temperatura pannello − temperatura calcolata).
4. Riavviare il servizio e confrontare di nuovo: differenza entro 0,2 °C.

### 3.4 Trovare il setpoint nella memoria V (facoltativo)
`node /opt/gateway-temperature/gateway.mjs --cerca-v 0 400 --config /etc/gateway-temperature/config.json` legge (sola lettura) VB0-VB400 e stampa i numeri che sembrano temperature. Si confrontano con i setpoint del pannello; cambiando un setpoint **dal pannello** si vede quale indirizzo cambia. Meglio ancora: leggerlo nel progetto salvato al punto 2.1.

---

## 4. FV6-FV7: scheda ESP32 + relè al posto dell'Inkbird STC-1000

La scheda diventa il termostato vero: legge la sonda NTC dell'STC-1000, comanda il freddo, mostra i valori sul display e si regola dalla sua pagina web. **Funziona anche senza Wi-Fi.** Se la sonda è scollegata o in corto il relè si **spegne** e il display scrive "SONDA GUASTA".

### 4.1 Collegamenti (lavoro dell'elettricista, a quadro **senza tensione**)

| Da | A |
|---|---|
| 230 V L e N | morsetti di alimentazione AC della scheda |
| Contatti del relè della scheda (COM e NO) | al posto dell'uscita "freddo" dell'STC-1000 (elettrovalvola o pompa del glicole) |
| Sonda NTC 10k dell'STC-1000, filo 1 | GND della scheda |
| Sonda NTC, filo 2 | pin **GPIO34** della scheda |
| Resistenza 10 kΩ 1% | tra **3V3** e **GPIO34** (partitore) |
| Display OLED: VCC, GND, SDA, SCL | 3V3, GND, **GPIO21**, **GPIO22** |

Piedini **DA VERIFICARE sulla scheda** (serigrafia e scheda del venditore): relè GPIO16, LED GPIO23, sonda GPIO34 (deve essere un ingresso analogico ADC1: GPIO32-39), display GPIO21/22. Se sono diversi si cambiano in `tools/esphome/fv6.yaml` e `fv7.yaml` (righe `pin_…`), non altrove.
Il display si monta dietro il rettangolo di plexiglass nel foro del quadro; la sonda resta quella di prima nel pozzetto. L'STC-1000 resta come ricambio.

### 4.2 Primo caricamento del firmware (con l'adattatore USB-seriale)

La scheda non ha la presa USB: la prima volta il firmware si carica con l'adattatore USB-seriale (CP2102 o CH340), poi gli aggiornamenti passano dal Wi-Fi. Si fa **dal Lenovo**, sul banco, **prima** di montare la scheda nel quadro.

> ## ⚠ ATTENZIONE: MAI 230 V COLLEGATI MENTRE L'ADATTATORE USB È ATTACCATO
> **Durante il caricamento la scheda deve essere completamente scollegata dalla rete elettrica.** Con la 230 V collegata e l'adattatore attaccato si rischiano la scossa, il Lenovo e l'adattatore. La scheda si alimenta solo dall'adattatore.

1. Sull'adattatore spostare il **ponticello (jumper) su 3V3** (livello dei segnali a 3,3 V: a 5 V si può danneggiare l'ESP32).
2. Collegare con i cavetti dupont: adattatore **GND → GND**, **TX → RX** (U0RXD), **RX → TX** (U0TXD) della scheda; alimentazione: **5V → 5V** della scheda se c'è il pin, altrimenti **3V3 → 3V3**.
3. Modalità programmazione: collegare **IO0 (GPIO0) a GND** (ponticello o cavetto) **prima** di dare corrente; inserire l'adattatore nel Lenovo.
4. Sul Lenovo, una volta sola:
   ```
   sudo apt install -y python3-venv
   python3 -m venv ~/esphome && ~/esphome/bin/pip install esphome
   sudo usermod -aG dialout $USER     # poi uscire e rientrare
   ```
5. Preparare i file (cartella `tools/esphome` del repository):
   ```
   cd birrificio-app/tools/esphome
   cp secrets.example.yaml secrets.yaml && nano secrets.yaml     # Wi-Fi e password
   ~/esphome/bin/esphome config fv6.yaml                         # controllo: deve finire con "Configuration is valid!"
   ~/esphome/bin/esphome run fv6.yaml --device /dev/ttyUSB0
   ```
   La prima compilazione dura qualche minuto (scarica gli strumenti e i caratteri del display: serve internet).
6. A fine caricamento: staccare l'adattatore, **togliere il collegamento IO0-GND**, ridare corrente (dall'adattatore per la prova sul banco). Sul display compaiono "FV6" e la temperatura; con il telefono sulla stessa rete aprire **http://fv6.local** (utente e password `web_…` di secrets.yaml).
7. Ripetere con `fv7.yaml` sulla seconda scheda.
8. Aggiornamenti successivi (scheda montata e accesa, nessun cavo): `~/esphome/bin/esphome run fv6.yaml` e scegliere l'aggiornamento via rete (OTA).

### 4.3 Impostazioni del termostato
In `fv6.yaml` / `fv7.yaml`: `setpoint_iniziale` (solo al primo avvio), `isteresi` (0,5 °C: il freddo parte a setpoint + 0,5 e si ferma al setpoint, come l'STC-1000), `min_spento` (3 minuti di pausa minima), `correzione_temp` (taratura).
Il setpoint si cambia dalla pagina web della scheda (campo **setpoint**) e resta salvato anche dopo un'interruzione di corrente.

### 4.4 Configurazione nel gateway (`esp32` in config.json)
`host`: `fv6.local` o meglio l'IP fisso della scheda; `utente`/`password`: gli stessi `web_utente`/`web_password` di secrets.yaml.

---

## 5. FV1-FV5: Autonics TK4S-B4RN via RS485

### 5.1 Collegamenti (elettricista, un regolatore alla volta, a FV vuoto o tranquillo)
- Il TK4S ha i morsetti numerati **diversamente** dal TCN4S: cablare seguendo il **manuale del TK4S**. Stessa sonda PT100 a 3 fili, stessa uscita relè.
- Bus RS485 con il cavo schermato a 2 poli: **A(+) con A(+)**, **B(−) con B(−)** da un regolatore all'altro (in fila, non a stella) fino al Waveshare. Schermo a terra da un solo lato.
- **Resistenza da 120 Ω** tra A e B sull'**ultimo** regolatore della fila (se il Waveshare ha già la sua resistenza interna, è l'altro capo).
- Waveshare RS485 TO WIFI/ETH alimentato dai **24 V** del quadro (5-36 V in continua, mai 230 V); se il quadro non ha un'uscita 24 V, un alimentatore da guida DIN tipo Mean Well HDR-15-24.

### 5.2 Impostazioni dei TK4S (dal pannello frontale, gruppo dei parametri di comunicazione: **VERIFICARE SUL MANUALE** i nomi)
- Ingresso: **DPt100** (come il TCN4S). Setpoint e isteresi: come quelli di oggi.
- Indirizzo: **1** su FV1, **2** su FV2 … **5** su FV5. Velocità **9600**; parità, bit di stop: annotarli e usare gli stessi sul Waveshare.
- Se c'è il parametro che abilita la scrittura via comunicazione (COMW), metterlo su **disabilitato**: il gateway legge soltanto.

### 5.3 Waveshare (dalla sua pagina web o con il programma VirCom)
- IP fisso nella rete del birrificio (Wi-Fi o cavo), porta **502**, modalità **TCP Server**, protocollo **Modbus TCP ↔ RTU** (*Modbus TCP to RTU*).
- Seriale: **9600**, 8 bit, parità e stop come i TK4S.

### 5.4 Configurazione nel gateway (`modbus` in config.json)
- `host`: IP del Waveshare. `dispositivi`: FV1→1 … FV5→5.
- Registri (**VERIFICARE SUL MANUALE**, mappa Modbus del TK4S): temperatura misurata = input register **0x03E8** (1000, funzione 04), punto decimale = **0x03E9** (1001), setpoint = holding register **0x0000** (funzione 03). Lo stato dell'uscita (`uscita`) è facoltativo, `null` finché non si conosce il registro.
- Con `--test` la temperatura deve coincidere con il display del TK4S (stessi decimali). Se è 10 volte più grande o più piccola, il punto decimale non è letto bene: mettere `"punto_decimale_fisso": 1`.

---

## 5bis. Celle frigo (Pego) e frigo luppoli (ESP32), solo lettura

Unghia **Celle** della pagina Cantina e registro **HACCP → Temperature celle frigo** (giornaliero, automatico, da stampare).
I frigo restano regolati dai loro termostati: il gateway legge e basta.

### Cella 1 e Cella 2: regolatori Pego ECP200 Expert via RS485

I due Pego hanno la porta **RS485 TeleNET** e parlano **Modbus RTU** (software reL 7). Il gateway legge temperatura della
cella, setpoint, compressore acceso/spento, sbrinamento e allarmi del Pego. Non scrive mai niente sul Pego (solo funzione 03).

Materiale:
- cavo schermato a coppie intrecciate (es. LiYCY 2x2x0,25 o cavo bus RS485), circa **30 m**: Pego 1 → Pego 2 (8 m) → armadio del mini PC (20 m);
- adattatore **USB-RS485** (es. DSD TECH SH-U11) nella presa USB del Lenovo;
- resistenza **120 Ω** tra A e B sul Pego in fondo al cavo (l'adattatore di solito ha già la sua dall'altro capo).

Collegamento (a Pego **spenti**, elettricista): un unico cavo che passa da un Pego all'altro e arriva all'adattatore
(niente diramazioni a stella). Una coppia per **A (+)** e **B (−)**, un filo dell'altra coppia per **GND**;
lo schermo collegato a terra **solo** dal lato armadio. Stessa lettera su tutti gli apparecchi; se poi nessuno risponde, si prova a invertire A e B.

Impostazioni sul Pego (2° livello: tenere premuti **▲ + ▼ per 3 s**, il Pego va in stand-by; per uscire di nuovo ▲ + ▼ 3 s, poi tasto stand-by):
- **AU = 7** (Modbus-RTU). Attenzione: oggi AU = 0 (relè di allarme); con AU = 7 il relè ausiliario del Pego non scatta più,
  gli allarmi arrivano dall'app. Prima controllare che a quel relè non sia collegato niente (sirena, lampada).
- **Ad = 1** sulla Cella 1, **Ad = 2** sulla Cella 2.

Nel gateway: blocco `pego` di `config.json` (porta dell'adattatore, `CELLA1` indirizzo 1, `CELLA2` indirizzo 2). Poi:
```bash
ls /dev/serial/by-id/                         # nome dell'adattatore, da copiare in "porta"
node gateway.mjs --cerca-pego 1               # trova velocità e parità del Pego (sola lettura)
node gateway.mjs --test                       # temperatura e setpoint devono essere uguali al display dei Pego
```
La mappa dei registri (0x0100 temperatura, 0x0300 setpoint, 0x0500-0x0502 uscite, ingressi, allarmi) viene dal documento Pego
"MODBUS-RTU protocol specifications" della serie ECP200 Expert: **DA VERIFICARE** con `--test`.

### Frigo luppoli: ESP32 + sonda DS18B20

Il frigo luppoli è comandato da un Inkbird ITC-308 (setpoint 0 °C) che non ha uscita dati: accanto si mette una sonda in più.

Materiale: scheda **ESP32 DevKit** (ESP32-WROOM-32, con presa USB) + alimentatore USB 5 V; sonda **DS18B20 impermeabile**;
resistenza **4,7 kΩ** (nel kit Elegoo) tra 3V3 e il filo dati.

Collegamento: rosso → **3V3**, nero → **GND**, giallo → **GPIO4** + resistenza 4,7 kΩ tra GPIO4 e 3V3.
La scheda va **fuori** dal frigo; dentro entra solo la capsula, vicino alla sonda dell'Inkbird. Il cavo passa dalla guarnizione.

Firmware: `tools/esphome/frigo-luppoli.yaml` (stesso `secrets.yaml` delle schede FV6-FV7).
Si carica con la scheda collegata in USB al Lenovo: `esphome run frigo-luppoli.yaml`. Poi `http://frigo-luppoli.local` mostra la temperatura.
Nel gateway è già nell'esempio di `config.json`, blocco `esp32` (`FRIGO-LUPPOLI`).

Limiti di allarme (tabella `sensori`, già inseriti dalla migrazione, **DA VERIFICARE**): celle 0 … 8 °C, frigo luppoli max 4 °C.
Per cambiarli, per esempio se il frigo luppoli è un congelatore:
```sql
update sensori set temp_min = -22, temp_max = -15 where fv = 'FRIGO-LUPPOLI';
```
Registro HACCP: per ogni giorno minima, massima e media; il giorno è **non conforme** se una cella resta fuori dai limiti più di
30 minuti in tutto (le aperture della porta sono tollerate). Nella colonna Note si scrive l'azione correttiva.

---

## 6. Messa in servizio: lista di controllo

- [ ] Migrazione `supabase/migrazione_temperature.sql` eseguita; `temperature_attuali` nella publication `supabase_realtime`.
- [ ] Copia del programma del PLC su chiavetta (2.1), IP del PLC annotato.
- [ ] Lenovo: Ubuntu aggiornato, fuso orario Europe/Rome, riaccensione automatica nel BIOS, `ping` al PLC ok.
- [ ] `config.json` compilato; `--test` senza errori per i blocchi installati; "Supabase: collegamento OK".
- [ ] Servizio attivo (`systemctl status`), log senza errori ripetuti.
- [ ] App → Cantina: "● in tempo reale", FV collegati verdi, ora "aggiornato adesso".
- [ ] **PLC**: ogni FV confrontato con il pannello MCGS (scala/offset, 3.3); mappa canali-FV confermata scaldando o raffreddando un FV e guardando quale scheda cambia.
- [ ] **ESP32**: temperatura confrontata con un termometro di riferimento (anche in acqua e ghiaccio = 0 °C) → `correzione_temp`; **prova di sicurezza**: staccando un filo della sonda il relè si spegne e il display scrive "SONDA GUASTA"; il freddo parte sopra setpoint + isteresi e si ferma al setpoint.
- [ ] **TK4S**: temperatura e setpoint uguali al display di ogni regolatore.
- [ ] Dopo 5-10 minuti: nella scheda di una cotta in corso, sezione Fermentazione, compare la curva "Temperatura misurata in FV…" (e nel PDF "Salva PDF").
- [ ] Prova senza internet: staccare internet al Lenovo per 15 minuti e riattaccarlo; nel log compare "Inviate N letture dal buffer offline" e la curva non ha buchi.
- [ ] Soglie di allarme (`sensori`) sistemate per ogni FV se 1,5 °C e 10 minuti non vanno bene.
- [ ] **Celle**: Pego con AU = 7 e Ad 1/2, `--test` uguale ai display dei Pego (altrimenti `offset` nel blocco `pego`); frigo luppoli confrontato con un termometro → `correzione_temp`; limiti min/max giusti per ogni cella; il giorno dopo, HACCP → Temperature celle frigo mostra la riga di ieri.

### Se qualcosa non va
| Sintomo | Dove guardare |
|---|---|
| Cantina: "Le tabelle delle temperature non ci sono ancora" | eseguire la migrazione (capitolo 1) |
| Tutte le schede "Senza dati" | `systemctl status gateway-temperature`, internet del Lenovo, `supabase.chiave` |
| "○ aggiornamento ogni minuto" invece di "● in tempo reale" | publication Realtime (1.3); le letture arrivano lo stesso ogni minuto |
| PLC: "connessione ISO rifiutata" | TSAP (3.2), IP, cavo e switch |
| PLC: "area o oggetto inesistente" | `area_ai` (AI200 / P) o indirizzo AIW sbagliato |
| TK4S: "lo strumento N non risponde" | indirizzo del TK4S, A/B invertiti, velocità/parità diverse dal Waveshare, resistenza da 120 Ω |
| ESP32: "non raggiungibile" | IP o nome della scheda, Wi-Fi; la scheda continua comunque a regolare da sola |
