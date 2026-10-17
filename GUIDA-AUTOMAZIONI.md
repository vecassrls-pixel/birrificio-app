# Automazioni: cosa configurare

Le automazioni girano su Netlify anche con l'app chiusa. Dopo la pubblicazione servono pochi passi una volta sola.
Le chiavi non vanno mai scritte in chat o nei file: si inseriscono solo nei pannelli di Netlify, Telegram e Anthropic.

## 1. Telegram (agenda, report, allarmi, nuovi ordini)
1. Su Telegram apri **@BotFather**, scrivi `/newbot`, scegli un nome (es. *Global Brewing*) e un nome utente che finisce con `bot`.
   BotFather risponde con un **token** (tipo `123456:ABC-...`).
2. Su Netlify: **Site configuration → Environment variables → Add a variable**
   - chiave `TELEGRAM_BOT_TOKEN`, valore il token del bot.
3. Crea un gruppo Telegram del birrificio (o usa quello che c'è), aggiungi il bot e scrivi un messaggio qualsiasi nel gruppo.
4. Nell'app: **Impostazioni → Automazioni e Telegram → Trova il gruppo**, tocca il gruppo, poi **Manda un messaggio di prova**.

## 2. Claude per "Foto della bolla" e "Chiedi ai dati"
1. Su **console.anthropic.com** crea un account, aggiungi un metodo di pagamento e crea una **API key**.
2. Su Netlify aggiungi la variabile `ANTHROPIC_API_KEY` con quella chiave.
   Costo indicativo: pochi centesimi per una bolla, qualche centesimo per una domanda.

## 3. Fatture in Cloud: acquisti dei fornitori
L'import degli acquisti legge i **documenti ricevuti**: il token `FIC_TOKEN` deve avere anche il permesso di lettura
dei documenti ricevuti (in Fatture in Cloud: **Impostazioni → Applicazioni collegate**, oppure rigenera il token con quel permesso).
Se il permesso manca, l'import delle vendite funziona lo stesso e in Impostazioni compare l'errore degli acquisti.

## 4. Ordini dei clienti online
La pagina `ordina.html` deve essere visibile senza login Netlify: in **Site configuration → Access & security → Visitor access**
la protezione con password deve essere spenta per la produzione (lasciala solo sui deploy di prova, se serve).
Il link di ogni cliente si crea in **Birra → Clienti → 🔗 Link ordini**.

## Cosa fa il server, e quando
| Cosa | Quando | Dove si cambia |
|---|---|---|
| Agenda del mattino | ogni giorno all'ora scelta (default 7:00) | Impostazioni → Automazioni |
| Report della settimana | il lunedì (default 8:00) | Impostazioni → Automazioni |
| Import vendite (Fatture in Cloud, Shopify) e acquisti | ogni notte (default 3:00) | Impostazioni → Automazioni |
| Allarmi temperatura FV | ogni ora, solo per i FV con una cotta (un problema che dura arriva entro 1-2 ore) | Impostazioni → Automazioni (i limiti sono quelli dei sensori) |

Le funzioni programmate usano anche `SUPABASE_SERVICE_KEY` (già impostata per gli inviti): deve valere per la produzione.
