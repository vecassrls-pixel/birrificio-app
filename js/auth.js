// Accesso con email e password (Supabase Auth, chiamate REST senza librerie).
// La sessione resta salvata sul dispositivo: l'app si apre anche offline e il token
// si rinnova appena torna internet. Senza configurazione (config.js vuoto) l'app
// funziona in modalità "solo locale", senza login.

import { CONFIG } from './config.js';
import * as db from './db.js';

export const configurato = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const base = () => CONFIG.supabaseUrl.replace(/\/$/, '') + '/auth/v1';
const headers = () => ({ apikey: CONFIG.supabaseAnonKey, 'Content-Type': 'application/json' });

let sessione = null;

async function chiamata(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(base() + path, {
    method,
    headers: { ...headers(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const dati = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = dati.error_description || dati.msg || dati.message || res.statusText;
    const e = new Error(traduci(msg));
    e.status = res.status;
    throw e;
  }
  return dati;
}

function traduci(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o password non corretti.';
  if (/email not confirmed/i.test(msg)) return 'Email non ancora confermata: apri il link che hai ricevuto.';
  if (/password should be at least/i.test(msg)) return 'La password deve avere almeno 8 caratteri.';
  if (/rate limit|too many/i.test(msg)) return 'Troppi tentativi, riprova tra qualche minuto.';
  return msg;
}

async function salvaSessione(d) {
  sessione = {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    scade: Date.now() + (d.expires_in || 3600) * 1000,
    email: d.user?.email || sessione?.email,
  };
  await db.meta('sessione', sessione);
  return sessione;
}

export async function caricaSessione() {
  sessione = (await db.meta('sessione')) || null;
  return sessione;
}

export const utente = () => sessione;

export async function accedi(email, password) {
  return salvaSessione(await chiamata('/token?grant_type=password', { body: { email: email.trim(), password } }));
}

export async function esci() {
  try { if (sessione && navigator.onLine) await chiamata('/logout', { token: sessione.accessToken }); } catch { /* già scaduta */ }
  sessione = null;
  await db.meta('sessione', null);
}

export async function recuperaPassword(email) {
  await chiamata('/recover', { body: { email: email.trim() } });
}

// Link di invito o di recupero password: Supabase rimanda all'app con #access_token=...&type=invite|recovery
export function tokenDaLink() {
  const h = location.hash.replace(/^#/, '');
  if (!h.includes('access_token=')) return null;
  const p = new URLSearchParams(h);
  return { accessToken: p.get('access_token'), refreshToken: p.get('refresh_token'), tipo: p.get('type'), expiresIn: Number(p.get('expires_in')) || 3600 };
}

export async function impostaPassword(link, password) {
  const user = await chiamata('/user', { method: 'PUT', token: link.accessToken, body: { password } });
  await salvaSessione({ access_token: link.accessToken, refresh_token: link.refreshToken, expires_in: link.expiresIn, user });
  history.replaceState(null, '', location.pathname + '#/cotte');
}

// Token valido per le chiamate al cloud (rinnovato se sta per scadere). null se offline o non loggati.
export async function token() {
  if (!sessione) return null;
  if (Date.now() < sessione.scade - 60_000) return sessione.accessToken;
  if (!navigator.onLine) return null;
  try {
    await salvaSessione(await chiamata('/token?grant_type=refresh_token', { body: { refresh_token: sessione.refreshToken } }));
    return sessione.accessToken;
  } catch (e) {
    if (e.status === 400 || e.status === 401) { // sessione revocata (es. utente rimosso)
      sessione = null;
      await db.meta('sessione', null);
      window.dispatchEvent(new Event('sessione-scaduta'));
    }
    return null;
  }
}

// ---------- ruoli: admin (gestisce gli utenti), editore, lettore (solo lettura) ----------
const rest = () => CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/utenti_autorizzati';
async function chiamataUtenti(q = '', { method = 'GET', body } = {}) {
  const t = await token();
  if (!t) throw new Error('Serve internet per gestire gli utenti.');
  const res = await fetch(rest() + q, {
    method,
    headers: { ...headers(), Authorization: `Bearer ${t}`, Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const dati = await res.json().catch(() => null);
  if (!res.ok) throw new Error(/duplicate/i.test(dati?.message || '') ? 'Email già presente.' : dati?.message || res.statusText);
  return dati;
}

// Ruolo dell'utente loggato, salvato con la sessione per funzionare anche offline.
// Se la migrazione dei ruoli non è ancora stata eseguita vale "editore" (comportamento di prima).
export const ruolo = () => sessione?.ruolo || 'editore';
export async function caricaRuolo() {
  if (!sessione || !navigator.onLine) return ruolo();
  try {
    const righe = await chiamataUtenti(`?select=ruolo&email=ilike.${encodeURIComponent(sessione.email)}`);
    sessione.ruolo = righe?.[0]?.ruolo || 'editore';
  } catch { sessione.ruolo = sessione.ruolo || 'editore'; }
  await db.meta('sessione', sessione);
  return sessione.ruolo;
}

export const elencoUtenti = () => chiamataUtenti('?select=email,ruolo,aggiunto&order=aggiunto.asc');
export const aggiungiUtente = (email, r) => chiamataUtenti('', { method: 'POST', body: { email: email.trim().toLowerCase(), ruolo: r } });
export const cambiaRuolo = (email, r) => chiamataUtenti(`?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: { ruolo: r } });
export const togliUtente = email => chiamataUtenti(`?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
