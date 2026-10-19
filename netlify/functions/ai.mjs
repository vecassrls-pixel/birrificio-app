// Funzioni con Claude (serve ANTHROPIC_API_KEY su Netlify).
//   POST { azione: 'bolla', media_type, data }  foto (jpeg/png/webp) o PDF scansionato della bolla, in base64
//        → righe della bolla nello stesso formato della lettura del PDF (bolla-pdf.js leggiDdt)
//   POST { azione: 'domanda', domanda, storia? } domanda in italiano sui dati del birrificio
//        → risposta in testo (le tabelle dei dati le prepara netlify/lib/contesto.mjs)
// La risposta arriva a pezzi (una riga JSON per evento: { testo } … poi { fine, json? } o { errore }),
// così la funzione resta nel limite di tempo delle risposte in streaming e l'app mostra il testo mentre arriva.
// Bolla: solo admin ed editori. Domanda: chiunque abbia accesso all'app (i collaboratori leggono già tutto).

import Anthropic from '@anthropic-ai/sdk';
import { json, autorizzato, puoScrivere } from '../lib/accesso.mjs';
import * as db from '../lib/db.mjs';
import { datiBirrificio, oraItalia } from '../lib/automazioni.mjs';
import { contestoDati } from '../lib/contesto.mjs';

const MODELLO = 'claude-opus-5-5';
// se il modello rifiuta una richiesta, la API la ripete da sola su un altro modello
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const TIPI_IMMAGINE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const SCHEMA_BOLLA = {
  type: 'object', additionalProperties: false, required: ['fornitore', 'numero', 'data', 'righe'],
  properties: {
    fornitore: { type: 'string', description: 'ragione sociale di chi emette il documento (non il destinatario)' },
    numero: { type: 'string', description: 'numero del DDT o della fattura, vuoto se non leggibile' },
    data: { type: 'string', description: 'data del documento AAAA-MM-GG, vuota se non leggibile' },
    righe: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['codice', 'descrizione', 'um', 'qta', 'prezzo', 'lotto', 'scadenza'],
        properties: {
          codice: { type: 'string' },
          descrizione: { type: 'string' },
          um: { type: 'string', description: 'unità di misura come scritta (KG, PZ, SC, LT…)' },
          qta: { type: 'number' },
          prezzo: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'prezzo unitario senza IVA, null se non c\'è' },
          lotto: { type: 'string' },
          scadenza: { type: 'string', description: 'AAAA-MM-GG, vuota se non c\'è' },
        },
      },
    },
  },
};

const ISTRUZIONI_BOLLA = `Leggi questo documento di trasporto (DDT) o fattura di un fornitore di un birrificio artigianale e riporta le righe articolo.
Una riga per ogni articolo con la quantità così come è scritta (non convertire le unità). Lotto e scadenza vanno sulla riga a cui si riferiscono, anche se sul documento sono scritti sotto o accanto.
Includi anche le righe che non sono materie prime (trasporto, imballi, cauzioni): le escluderà chi controlla la bolla.
Se un valore non si legge con sicurezza lascialo vuoto invece di indovinarlo.`;

const ISTRUZIONI_DOMANDA = `Sei l'assistente del gestionale di un birrificio artigianale (Kashmir Brewing Company). Rispondi in italiano a chi ci lavora,
usando solo i dati qui sotto, esportati dal gestionale oggi. Rispondi in modo breve e diretto: prima il risultato (numeri con l'unità), poi, se serve, una riga su come l'hai calcolato.
Se i dati non bastano per rispondere, dillo e spiega quale dato manca invece di stimare. Per elenchi o confronti usa una tabella Markdown corta.
Note sui dati: OG e FG sono in gradi Plato; "stato" della cotta è pianificata, fermentazione/tank (in FV) o finita; le vendite sono gli scarichi con motivo "vendita" (fatture e Shopify), gli altri motivi sono taproom, eventi, autoconsumo ecc.`;

// risposta in streaming: una riga JSON per evento
function flusso(lavoro) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const manda = o => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      try { await lavoro(manda); } catch (e) { manda({ errore: messaggioErrore(e) }); }
      ctrl.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function messaggioErrore(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'La chiave ANTHROPIC_API_KEY su Netlify non è valida';
  if (e instanceof Anthropic.RateLimitError) return 'Troppe richieste a Claude in poco tempo: riprova tra un minuto';
  if (e instanceof Anthropic.APIError) return `Claude non ha risposto (${e.status || 'errore'}): riprova`;
  return e.message || String(e);
}

async function chiama(client, richiesta, manda) {
  const stream = client.beta.messages.stream({ model: MODELLO, ...FALLBACK, ...richiesta });
  stream.on('text', t => manda({ testo: t }));
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude non ha voluto rispondere a questa richiesta');
  if (msg.stop_reason === 'max_tokens') throw new Error('Risposta troppo lunga, interrotta: prova con una domanda più precisa');
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export default async req => {
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ errore: 'Manca ANTHROPIC_API_KEY su Netlify' }, 503);
  let corpo;
  try { corpo = await req.json(); } catch { return json({ errore: 'Richiesta non valida' }, 400); }
  const client = new Anthropic();

  if (corpo?.azione === 'bolla') {
    if (!(await puoScrivere(req))) return json({ errore: 'Solo chi può modificare i dati' }, 403);
    const tipo = String(corpo.media_type || ''), dati = String(corpo.data || '');
    const pdf = tipo === 'application/pdf';
    if (!dati || (!pdf && !TIPI_IMMAGINE.includes(tipo))) return json({ errore: 'Serve una foto (JPEG, PNG) o un PDF' }, 400);
    const allegato = pdf
      ? { type: 'document', source: { type: 'base64', media_type: tipo, data: dati } }
      : { type: 'image', source: { type: 'base64', media_type: tipo, data: dati } };
    return flusso(async manda => {
      const testo = await chiama(client, {
        max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_BOLLA } },
        messages: [{ role: 'user', content: [allegato, { type: 'text', text: ISTRUZIONI_BOLLA }] }],
      }, () => {}); // il JSON parziale non serve all'app
      manda({ fine: true, json: JSON.parse(testo) });
    });
  }

  if (corpo?.azione === 'domanda') {
    if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);
    if (!db.configurato()) return json({ errore: 'Manca SUPABASE_SERVICE_KEY su Netlify' }, 503);
    const domanda = String(corpo.domanda || '').trim().slice(0, 2000);
    if (!domanda) return json({ errore: 'Scrivi una domanda' }, 400);
    // conversazione: le domande e risposte precedenti (solo testo), poi la nuova
    const storia = (Array.isArray(corpo.storia) ? corpo.storia : []).slice(-6)
      .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (storia.length && storia[0].role !== 'user') storia.shift();
    if (storia.length && storia[storia.length - 1].role === 'user') storia.pop();
    return flusso(async manda => {
      const contesto = contestoDati(await datiBirrificio(), oraItalia().data);
      await chiama(client, {
        max_tokens: 16000,
        // il contesto è lo stesso per le domande successive dello stesso giorno: in cache costa molto meno
        system: [{ type: 'text', text: ISTRUZIONI_DOMANDA }, { type: 'text', text: contesto, cache_control: { type: 'ephemeral' } }],
        messages: [...storia, { role: 'user', content: domanda }],
      }, manda);
      manda({ fine: true });
    });
  }
  return json({ errore: 'Azione sconosciuta' }, 400);
};
