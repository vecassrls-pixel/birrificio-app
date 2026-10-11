// Backup: file JSON con tutti i dati (cotte, magazzino, birra, impostazioni).
// Automatico: una volta a settimana, all'apertura dell'app, il dispositivo scarica il file nella
// cartella Download. Si attiva per dispositivo (di base sui computer, non sui telefoni).

import * as db from './db.js';
import { diffGiorni, oggiISO } from './dominio.js';

const PREF = 'gb-backup-auto';
export const GIORNI = 7;

export function automatico() {
  try {
    const v = localStorage.getItem(PREF);
    if (v !== null) return v === '1';
  } catch { /* navigazione privata */ }
  return matchMedia('(min-width: 761px)').matches;
}
export function impostaAutomatico(on) { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch { /* navigazione privata */ } }
export const ultimo = () => db.meta('backupUltimo');

export async function scarica() {
  const dati = await db.esporta();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dati)], { type: 'application/json' }));
  a.download = `global-brewing-backup-${oggiISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  await db.meta('backupUltimo', new Date().toISOString());
  return dati.records.length;
}

// All'avvio: true se ha scaricato il backup settimanale
export async function controlla() {
  if (!automatico()) return false;
  const u = await ultimo();
  if (u && diffGiorni(u.slice(0, 10), oggiISO()) < GIORNI) return false;
  await scarica();
  return true;
}

// Ripristino: rimette i record del file che qui mancano o sono più vecchi, e li rimanda al cloud
export async function ripristina(file) {
  const dati = JSON.parse(await file.text());
  if (dati.app !== 'birrificio' || !Array.isArray(dati.records)) throw new Error('File non valido');
  return db.ripristina(dati.records);
}
