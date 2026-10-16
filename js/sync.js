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

// ---------- letture dirette dal cloud (temperature dei fermentatori) ----------
// Tabelle scritte dal gateway in birrificio (supabase/migrazione_temperature.sql): l'app le legge e basta,
// non passano dall'archivio locale. Errore con .codice: 'locale' (cloud non configurato), 'offline',
// 'mancante' (tabelle non ancora create), 'http'.
const erroreCloud = (msg, codice) => Object.assign(new Error(msg), { codice });

export async function interroga(percorso, { method = 'GET', body, range } = {}) {
  if (!auth.configurato()) throw erroreCloud('App in modalità solo locale', 'locale');
  if (!navigator.onLine) throw erroreCloud('Senza internet', 'offline');
  const token = await auth.token();
  if (!token) throw erroreCloud('Accesso al cloud non disponibile', 'offline');
  let res;
  try {
    res = await fetch(CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + percorso, {
      method,
      headers: { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(range ? { Range: range } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw erroreCloud('Cloud non raggiungibile', 'offline'); }
  if (!res.ok) {
    const t = await res.text();
    // tabella o funzione inesistente: la migrazione non è ancora stata eseguita
    if (res.status === 404 || /PGRST20[25]|42P01|42883|does not exist|Could not find/i.test(t)) throw erroreCloud('Tabelle delle temperature non ancora create', 'mancante');
    throw erroreCloud(`Lettura fallita (${res.status}): ${t.slice(0, 200)}`, 'http');
  }
  return res.json();
}

// Aggiornamenti in tempo reale di una tabella (Supabase Realtime, protocollo Phoenix su WebSocket, senza librerie).
// suRiga(record) per ogni riga inserita o modificata; suStato('collegato' | 'scollegato').
// Restituisce la funzione per chiudere. Se la connessione cade riprova da sola.
export function ascoltaTabella(tabella, suRiga, suStato = () => {}) {
  if (!auth.configurato() || typeof WebSocket === 'undefined') return () => {};
  let ws = null, battito = null, riprova = null, chiuso = false, ref = 0, attesa = 2000;
  const invia = (topic, event, payload) => ws?.readyState === 1 && ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
  const topic = `realtime:temperature-${tabella}`;
  async function apri() {
    if (chiuso) return;
    const token = navigator.onLine ? await auth.token() : null;
    if (!token) { riprova = setTimeout(apri, 30_000); return; }
    const url = CONFIG.supabaseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + `/realtime/v1/websocket?apikey=${encodeURIComponent(CONFIG.supabaseAnonKey)}&vsn=1.0.0`;
    try { ws = new WebSocket(url); } catch { riprova = setTimeout(apri, attesa); return; }
    ws.onopen = () => {
      attesa = 2000;
      invia(topic, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: tabella }] }, access_token: token });
      // battito ogni 25 s, e il token rinnovato prima che scada
      battito = setInterval(async () => {
        invia('phoenix', 'heartbeat', {});
        const t = await auth.token();
        if (t) invia(topic, 'access_token', { access_token: t });
      }, 25_000);
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.payload?.status === 'ok') suStato('collegato');
      if (m.event === 'phx_reply' && m.payload?.status === 'error') suStato('scollegato');
      if (m.event === 'postgres_changes' && m.payload?.data?.record) suRiga(m.payload.data.record);
    };
    ws.onclose = () => {
      clearInterval(battito);
      suStato('scollegato');
      if (!chiuso) { riprova = setTimeout(apri, attesa); attesa = Math.min(attesa * 2, 60_000); }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* già chiuso */ } };
  }
  apri();
  return () => { chiuso = true; clearTimeout(riprova); clearInterval(battito); try { ws?.close(); } catch { /* già chiuso */ } };
}
