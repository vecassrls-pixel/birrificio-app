// Sincronizzazione con il cloud.
//
// L'app non dipende da un servizio specifico: un "adattatore" deve offrire
//   invia(records)        -> salva/aggiorna i record nel cloud
//   ricevi(dalTimestamp)  -> restituisce i record modificati dopo quel momento
// Oggi c'è un adattatore per Supabase (Postgres gestito, piano gratuito).
// Per cambiare servizio basta scrivere un altro adattatore con gli stessi due metodi.

import * as db from './db.js';
import * as auth from './auth.js';
import { CONFIG } from './config.js';

export class SupabaseAdapter {
  // token = token dell'utente loggato: le regole del database lasciano passare solo gli utenti autorizzati
  constructor({ url, chiave, token, tabella = 'records' }) {
    this.base = url.replace(/\/$/, '') + '/rest/v1/' + tabella;
    this.headers = {
      apikey: chiave,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async invia(records) {
    if (!records.length) return;
    const righe = records.map(r => ({
      id: r.id, tipo: r.tipo, aggiornato: r.aggiornato, eliminato: !!r.eliminato,
      dati: { ...r, daSincronizzare: undefined },
    }));
    const res = await fetch(this.base + '?on_conflict=id', {
      method: 'POST',
      headers: { ...this.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe),
    });
    if (!res.ok) throw new Error(`Invio fallito (${res.status}): ${await res.text()}`);
  }

  async ricevi(dal) {
    const out = [];
    const pagina = 1000;
    for (let da = 0; ; da += pagina) {
      // 'ricevuto' è l'ora del server (vedi supabase/schema.sql): non dipende dagli orologi dei dispositivi
      const q = `?select=dati,ricevuto&order=ricevuto.asc${dal ? `&ricevuto=gt.${encodeURIComponent(dal)}` : ''}`;
      const res = await fetch(this.base + q, {
        headers: { ...this.headers, Range: `${da}-${da + pagina - 1}` },
      });
      if (!res.ok) throw new Error(`Lettura fallita (${res.status}): ${await res.text()}`);
      const righe = await res.json();
      out.push(...righe.map(r => ({ ...r.dati, _ricevuto: r.ricevuto })));
      if (righe.length < pagina) break;
    }
    return out;
  }
}

async function creaAdattatore() {
  if (!auth.configurato()) return null;
  const token = await auth.token();
  return token ? new SupabaseAdapter({ url: CONFIG.supabaseUrl, chiave: CONFIG.supabaseAnonKey, token }) : null;
}

let inCorso = false;
const stato = { ultimo: null, errore: null, attivo: false };
const ascoltatori = new Set();
export const onStato = fn => { ascoltatori.add(fn); fn(stato); return () => ascoltatori.delete(fn); };
const aggiorna = patch => { Object.assign(stato, patch); ascoltatori.forEach(fn => fn(stato)); };

export async function sincronizza() {
  aggiorna({ attivo: auth.configurato() && !!auth.utente() });
  if (inCorso || !navigator.onLine) return;
  const adattatore = await creaAdattatore();
  if (!adattatore) return;
  inCorso = true;
  try {
    // 1. invia le modifiche locali
    const locali = await db.daInviare();
    await adattatore.invia(locali);
    await db.segnaInviati(locali);
    // 2. scarica le modifiche degli altri dispositivi
    const dal = await db.meta('syncDal');
    const remoti = await adattatore.ricevi(dal);
    const max = remoti.reduce((m, r) => (r._ricevuto > m ? r._ricevuto : m), dal || '');
    await db.applicaRemoti(remoti.map(({ _ricevuto, ...r }) => r));
    if (max) await db.meta('syncDal', max);
    aggiorna({ ultimo: new Date().toISOString(), errore: null });
  } catch (e) {
    aggiorna({ errore: e.message });
  } finally {
    inCorso = false;
  }
}

export function avvia() {
  sincronizza();
  window.addEventListener('online', sincronizza);
  setInterval(sincronizza, 60_000);
  let timer;
  db.onCambio(() => { clearTimeout(timer); timer = setTimeout(sincronizza, 3000); });
}
