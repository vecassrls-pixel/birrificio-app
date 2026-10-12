# Mettere online l'app Produzione

Servono tre account gratuiti: **GitHub** (dove sta il codice), **Supabase** (database e login) e **Netlify** (il sito).
Ci vogliono circa 20 minuti. Le chiavi non vanno mai scritte in chat o nei file: si inseriscono solo nei pannelli di Supabase e Netlify.

## 1. Supabase: database e login
1. Vai su supabase.com, crea un account e poi **New project**. Nome: `birrificio`. Regione: *Central EU (Frankfurt)*. Scegli una password del database e salvala in un posto sicuro.
2. Apri il file **schema.sql** (allegato in chat, oppure nella cartella `birrificio-app/supabase/`), seleziona tutto il testo e copialo.
   In Supabase apri **SQL Editor → New query**, incolla il testo e premi **Run**. Deve comparire "Success. No rows returned".
3. Fai lo stesso con i file dello storico, uno alla volta e in ordine: **seed_storico_1.sql**, poi 2, 3, 4 e 5
   (contengono le 226 cotte storiche e i fermentatori). Per ognuno: nuova query, incolla, **Run**.
4. Autorizza la tua email (e quella di chi vuoi), sempre nel SQL Editor:
   `insert into utenti_autorizzati (email) values ('la-tua-email@esempio.it');`
5. **Authentication → Sign In / Providers**: disattiva **Allow new users to sign up**. Così nessuno può registrarsi da solo.
6. Copia due valori (ti servono al punto 3). Il modo più semplice: in alto nella pagina del progetto premi **Connect**.
   - **Project URL**: l'indirizzo tipo `https://abcdefgh.supabase.co`
     Se non lo trovi: nella barra del browser l'indirizzo è `supabase.com/dashboard/project/CODICE/...`;
     il Project URL è `https://CODICE.supabase.co` (il CODICE è anche in **Project Settings → General → Project ID**).
   - **Chiave pubblica**: in **Project Settings → API Keys** copia la **Publishable key** (inizia con `sb_publishable_`).
     Se vedi solo la scheda *Legacy API Keys*, va bene anche la chiave **anon public**.
   Non copiare mai la chiave *secret* o *service_role*: quella resta solo in Supabase.

## 2. GitHub: il codice
Il codice dell'app va in un repository privato su GitHub, da cui Netlify pubblica il sito.
(Lo crea Claude nel tuo account GitHub, se gli dai l'ok.)

## 3. Netlify: il sito
1. Vai su netlify.com e accedi con GitHub.
2. **Add new site → Import an existing project → GitHub** e scegli il repository dell'app.
   Le impostazioni di build si leggono da sole (`netlify.toml`): non cambiare nulla.
3. Prima di pubblicare, in **Environment variables**, aggiungi:
   - `SUPABASE_URL` = Project URL di Supabase
   - `SUPABASE_ANON_KEY` = chiave anon public di Supabase
   - `BREWFATHER_USER_ID` e `BREWFATHER_API_KEY` = da Brewfather → Impostazioni → API
     (crea la chiave con i permessi di sola lettura: *Read Batches*, *Read Recipes*)
4. **Deploy**. Alla fine Netlify ti dà l'indirizzo, tipo `https://produzione-xxxx.netlify.app`.
   Puoi cambiarlo in *Site configuration → Change site name*.

## 4. Collegare il login al sito
1. In Supabase: **Authentication → URL Configuration → Site URL** = l'indirizzo Netlify.
2. **Authentication → Users → Invite user**: inserisci la tua email (deve essere anche in `utenti_autorizzati`).
3. Apri l'email, clicca il link, scegli la password: sei dentro.
4. Sul telefono: apri l'indirizzo, poi *Condividi → Aggiungi a schermata Home* (iPhone) o *Installa app* (Android).

## Aggiungere o togliere una persona
- **Aggiungere**: `insert into utenti_autorizzati ...` (punto 1.4) e poi *Invite user* (punto 4.2).
- **Togliere**: `delete from utenti_autorizzati where email = '...';` e in *Authentication → Users* elimina l'utente.
  Da quel momento non legge più nulla, nemmeno se ha l'app aperta.

## Collegare Fatture in Cloud e Shopify (magazzino Birra)
Servono solo per scaricare la birra dalle fatture e dagli ordini; senza, gli scarichi si fanno a mano.
Le chiavi vanno in Netlify → **Site configuration → Environment variables**, poi un nuovo deploy.

**Fatture in Cloud** (sola lettura dei documenti emessi)
1. In Fatture in Cloud: **Impostazioni → Sviluppatore** (secure.fattureincloud.it/settings-developers) → **Nuova app**,
   visibilità *Privata*, con la tua email tra gli utenti autorizzati; copia il **Client ID**.
2. **Impostazioni → Applicazioni collegate** (secure.fattureincloud.it/settings-apps) → **Collega una nuova applicazione**:
   incolla il Client ID, scegli l'azienda e il solo permesso *Documenti emessi: lettura*; copia il token.
3. In Netlify aggiungi `FIC_TOKEN` = il token. `FIC_COMPANY_ID` (id dell'azienda) è facoltativo: se manca si usa la prima azienda del token.

**Shopify** (sola lettura degli ordini)
1. In Shopify: **Impostazioni → App → Sviluppa app** (Dev Dashboard) crea un'app con i permessi `read_orders`
   (e `read_all_orders` per gli ordini più vecchi di 60 giorni), rilasciala e installala sul negozio.
2. In Netlify aggiungi `SHOPIFY_SHOP` = il nome del negozio (es. `kashmir-brewing`, quello di `kashmir-brewing.myshopify.com`),
   `SHOPIFY_CLIENT_ID` e `SHOPIFY_CLIENT_SECRET` = le credenziali dell'app.
   Se hai già una vecchia app personalizzata con un token `shpat_…`, basta `SHOPIFY_TOKEN` al posto di client id e secret.
