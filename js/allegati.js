// Allegati delle cotte (PDF delle analisi).
// Il file sta in Supabase Storage (bucket privato "allegati", vedi supabase/migrazione_allegati.sql);
// nella cotta resta solo l'elenco: c.allegati = [{ id, nome, path, byte, data, inviato }].
// Una copia resta sul dispositivo (Cache API): si apre anche offline, e un file aggiunto
// senza rete o in modalità solo locale si invia appena possibile (inviaInSospeso).

import * as auth from './auth.js';
import { CONFIG } from './config.js';

export const MAX_BYTE = 20 * 1024 * 1024;
const CACHE = 'birrificio-allegati';
const BUCKET = 'allegati';
const chiaveCache = path => new Request(location.origin + '/__allegati/' + path);
const urlStorage = path => CONFIG.supabaseUrl.replace(/\/$/, '') + `/storage/v1/object/${BUCKET}/` + path.split('/').map(encodeURIComponent).join('/');

async function intestazioni() {
  if (!auth.configurato() || !navigator.onLine) return null;
  const token = await auth.token();
  return token ? { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token}` } : null;
}

async function invia(path, blob) {
  const h = await intestazioni();
  if (!h) return false;
  const res = await fetch(urlStorage(path), {
    method: 'POST',
    headers: { ...h, 'Content-Type': blob.type || 'application/pdf', 'x-upsert': 'true' },
    body: blob,
  });
  if (!res.ok) {
    const t = await res.text();
    if (/bucket not found/i.test(t)) throw new Error('Manca lo spazio "allegati" su Supabase: esegui supabase/migrazione_allegati.sql');
    throw new Error(`Invio allegato fallito (${res.status}): ${t}`);
  }
  return true;
}

// Aggiunge un file alla cotta: torna la voce da mettere in c.allegati
export async function aggiungi(c, file) {
  if (file.size > MAX_BYTE) throw new Error(`${file.name} è troppo grande (max 20 MB)`);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pulito = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80) || 'analisi.pdf';
  const path = `cotte/${c.id}/${id}-${pulito}`;
  const cache = await caches.open(CACHE);
  await cache.put(chiaveCache(path), new Response(file, { headers: { 'Content-Type': file.type || 'application/pdf' } }));
  let inviato = false;
  try { inviato = await invia(path, file); } catch (e) { if (!/^Manca/.test(e.message)) console.warn(e); else throw e; }
  return { id, nome: file.name, path, byte: file.size, data: new Date().toISOString().slice(0, 10), inviato };
}

// Il file come Blob: prima la copia sul dispositivo, altrimenti dal cloud (e lo tiene)
export async function leggi(a) {
  const cache = await caches.open(CACHE);
  const r = await cache.match(chiaveCache(a.path));
  if (r) return r.blob();
  const h = await intestazioni();
  if (!h) throw new Error(navigator.onLine ? 'Allegato non disponibile: accedi per scaricarlo' : 'Allegato non ancora scaricato su questo dispositivo: serve internet');
  const res = await fetch(urlStorage(a.path), { headers: h });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 400 ? 'Allegato non ancora caricato dal dispositivo che l\'ha aggiunto' : `Download fallito (${res.status})`);
  const blob = await res.blob();
  await cache.put(chiaveCache(a.path), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/pdf' } }));
  return blob;
}

// Apre il PDF in una nuova scheda (la finestra si apre subito, altrimenti Safari la blocca)
export async function apri(a) {
  const w = window.open('', '_blank');
  try {
    const blob = await leggi(a);
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
    if (w) w.location.href = url; else location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

export async function scarica(a) {
  const blob = await leggi(a);
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: a.nome });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function togli(a) {
  (await caches.open(CACHE)).delete(chiaveCache(a.path));
  const h = await intestazioni();
  if (h && a.inviato) fetch(urlStorage(a.path), { method: 'DELETE', headers: h }).catch(() => {});
}

// Invia i file aggiunti senza rete; torna le cotte modificate (da salvare)
export async function inviaInSospeso(cotte) {
  if (!(await intestazioni())) return [];
  const cache = await caches.open(CACHE);
  const cambiate = [];
  for (const c of cotte) {
    let cambiata = false;
    for (const a of c.allegati || []) {
      if (a.inviato) continue;
      const r = await cache.match(chiaveCache(a.path));
      if (!r) continue;
      try { if (await invia(a.path, await r.blob())) { a.inviato = true; cambiata = true; } } catch { return cambiate; }
    }
    if (cambiata) cambiate.push(c);
  }
  return cambiate;
}

export const dimensione = b => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
