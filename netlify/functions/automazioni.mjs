// Automazioni a richiesta dall'app (Impostazioni → Automazioni).
//   GET                               → { telegram, fic, shopify, database, ai } cosa è configurato sul server
//   POST { azione: 'prova' }          → messaggio di prova su Telegram
//   POST { azione: 'chat' }           → ultime chat che hanno scritto al bot (per trovare l'id del gruppo)
//   POST { azione: 'agenda' | 'report' | 'importa' }  → fa subito quello che di solito fa la funzione programmata
// Solo admin ed editori (stessa regola del database).

import { json, puoScrivere, autorizzato } from '../lib/accesso.mjs';
import * as db from '../lib/db.mjs';
import * as telegram from '../lib/telegram.mjs';
import * as fic from '../lib/fic.mjs';
import * as shopify from '../lib/shopify.mjs';
import { ID_IMP, impostazioni, inviaAgenda, inviaReport, importa } from '../lib/automazioni.mjs';

export default async req => {
  if (req.method === 'GET') {
    if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);
    return json({ telegram: telegram.configurato(), database: db.configurato(), fic: fic.configurato(), shopify: shopify.configurato(), ai: !!process.env.ANTHROPIC_API_KEY });
  }
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
  if (!(await puoScrivere(req))) return json({ errore: 'Solo chi può modificare i dati' }, 403);
  let azione = '';
  try { azione = String((await req.json())?.azione || ''); } catch { /* corpo vuoto */ }
  if (!db.configurato()) return json({ errore: 'Manca SUPABASE_SERVICE_KEY su Netlify' }, 503);
  try {
    const imp = impostazioni(await db.leggi(ID_IMP));
    if (azione === 'prova') { await telegram.invia('👋 Global Brewing è collegato a questa chat: qui arriveranno agenda, report e allarmi.', imp.chatId || undefined); return json({ ok: true }); }
    if (azione === 'chat') return json({ chat: await telegram.chatRecenti() });
    if (azione === 'agenda') return json({ ok: true, testo: await inviaAgenda({ imp }) });
    if (azione === 'report') return json({ ok: true, testo: await inviaReport({ imp }) });
    if (azione === 'importa') return json({ ok: true, esito: await importa({ imp }) });
    return json({ errore: 'Azione sconosciuta' }, 400);
  } catch (e) {
    return json({ errore: e.message }, 500);
  }
};
