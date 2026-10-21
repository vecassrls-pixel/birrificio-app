// Ordini dei clienti online: ogni cliente ha un link personale (ordina.html#<token>) con le birre
// disponibili oggi e i prezzi del suo listino; l'ordine arriva nell'app come record 'ordinecliente'.
// Senza DOM: lo usano la funzione netlify/functions/ordini.mjs, la pagina pubblica e l'app.
//
// Record:
//   cliente.portale  { token, listino (id), attivo }
//   ordinecliente    { cliente, clienteId, data, consegna, righe: [{ prodotto, pezzi, prezzo, iva }], note, stato, creato,
//                      modo (ritiro|zona|corriere), indirizzo, comune, telefono, origine ('app' se inserito nell'app),
//                      corriere, colli, peso, tracking, giroPosto, documento, movimento (id movbirra dello scarico) }

import { listaDisponibili, formatoCliente, maiuscole } from './birra.js';
import { righeListino, listinoDa, ID_ALPHA } from './listini.js';

export const STATI_ORDINE = { nuovo: 'Nuovo', confermato: 'Confermato', pronto: 'Pronto', spedito: 'Spedito', consegnato: 'Consegnato', annullato: 'Annullato' };
export const MODI_CONSEGNA = { ritiro: 'Ritiro in birrificio', zona: 'Consegna in zona', corriere: 'Spedizione con corriere' };

// Come vuole ricevere l'ordine il cliente (dalla pagina pubblica): valori puliti e corti
export function datiConsegna(corpo) {
  const t = (v, n) => String(v || '').trim().slice(0, n);
  const modo = MODI_CONSEGNA[corpo?.modo] ? corpo.modo : '';
  return { modo, indirizzo: modo === 'ritiro' ? '' : t(corpo?.indirizzo, 200), comune: modo === 'ritiro' ? '' : t(corpo?.comune, 80), telefono: t(corpo?.telefono, 30) };
}
export const MAX_RIGHE = 40, MAX_PEZZI = 500;
export const ULTIMI_PEZZI = 5; // sotto questa giacenza il cliente vede "ultimi pezzi"

export const nuovoToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
export const tokenValido = t => /^[a-f0-9]{32}$/.test(String(t || ''));
export const linkOrdini = (token, base) => `${base.replace(/\/$/, '')}/ordina.html#${token}`;

// Catalogo per un cliente: birre con giacenza (lotti non scaduti), prezzo dal suo listino (se c'è).
// datiBirra = { cotte, durate, movimenti, inventari, prodotti, impostazioni }; listini = record 'listino'
export function catalogoCliente(datiBirra, listini, cliente, oggi) {
  const alpha = listini.find(l => l.id === ID_ALPHA && !l.eliminato);
  const idListino = cliente?.portale?.listino;
  const rec = idListino && listini.find(l => l.id === idListino && !l.eliminato);
  const prezzi = new Map();
  if (rec && alpha) {
    const l = listinoDa(rec);
    for (const r of righeListino({ ...l, prodotti: 'tutti' }, Object.keys(alpha.prezzi || {}), new Map(), alpha.prezzi || {}, alpha.esclusi || [])) {
      if (r.prezzo && !r.escluso) prezzi.set(r.chiave, { prezzo: r.prezzo, iva: !!l.iva });
    }
  }
  const fuori = new Set(alpha?.esclusi || []);
  return listaDisponibili(datiBirra, oggi).map(b => ({
    birra: b.birra, stile: b.stile ? maiuscole(b.stile) : '', abv: b.abv,
    formati: b.formati.filter(f => !fuori.has(f.chiave)).map(f => ({
      chiave: f.chiave, formato: formatoCliente(f), tipo: f.tipo, litri: f.litri,
      disponibili: f.pezzi > ULTIMI_PEZZI ? null : f.pezzi, // il numero esatto solo quando sono pochi
      ...(prezzi.get(f.chiave) || { prezzo: null, iva: false }),
    })),
  })).filter(b => b.formati.length);
}

// Controlla le righe ordinate contro il catalogo: { righe, errori }
export function righeOrdine(catalogo, richieste) {
  const per = new Map(catalogo.flatMap(b => b.formati.map(f => [f.chiave, f])));
  const righe = [], errori = [];
  for (const r of (Array.isArray(richieste) ? richieste : []).slice(0, MAX_RIGHE)) {
    const f = per.get(String(r?.prodotto || ''));
    const pezzi = Math.floor(Number(r?.pezzi));
    if (!f) { errori.push('Un prodotto non è più disponibile'); continue; }
    if (!(pezzi > 0) || pezzi > MAX_PEZZI) { errori.push(`Quantità non valida per ${f.formato}`); continue; }
    if (f.disponibili !== null && pezzi > f.disponibili) errori.push(`${f.formato}: ne restano solo ${f.disponibili}`);
    righe.push({ prodotto: f.chiave, pezzi, prezzo: f.prezzo, iva: f.iva });
  }
  return { righe, errori };
}

// Birra impegnata: pezzi per prodotto negli ordini aperti non ancora fatturati né scaricati (la giacenza non è ancora scesa).
// tranne = id di un ordine da non contare (quello che si sta preparando nel carrello)
export const ORDINI_APERTI = ['nuovo', 'confermato', 'pronto', 'spedito'];
export function impegnatiOrdini(ordini, tranne = '') {
  const per = new Map();
  for (const o of ordini || []) {
    if (o.eliminato || o.id === tranne || !ORDINI_APERTI.includes(o.stato) || o.documento || o.movimento) continue;
    for (const r of o.righe || []) per.set(r.prodotto, (per.get(r.prodotto) || 0) + (Number(r.pezzi) || 0));
  }
  return per;
}

export const totaleOrdine = righe => righe.reduce((t, r) => t + (Number(r.prezzo) || 0) * r.pezzi, 0);
