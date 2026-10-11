// Ordine materie prime: cosa serve alle cotte pianificate (e ai DH ancora da fare) entro una data,
// confrontato con la giacenza di oggi e le bolle già programmate.
//
// Per ogni articolo si scorrono i movimenti futuri in ordine di data partendo dalla giacenza di oggi:
// il punto più basso dice quanto manca per non scendere sotto la scorta minima.
// La quantità si arrotonda ai sacchi/pezzi interi se l'articolo ha il peso per pezzo.
// "Ordina entro" = giorno in cui si scenderebbe sotto scorta − giorni di consegna.

import { addGiorni, oggiISO } from './dominio.js';
import { scarichiCotte } from './magazzino.js';

export function fabbisogno(giac, { bolle = [], cotte = [], articoli = [] }, { fino, anticipo = 7, oggi = oggiISO() }) {
  const ultimoFornitore = new Map();
  for (const b of [...bolle].filter(x => x.data && x.fornitore).sort((x, y) => x.data.localeCompare(y.data))) {
    for (const r of b.righe || []) ultimoFornitore.set(r.articoloId, b.fornitore);
  }
  const righe = [];
  for (const g of giac.values()) {
    const a = g.articolo;
    const futuri = g.movimenti.filter(m => m.futuro && m.data <= fino).sort((x, y) => x.data.localeCompare(y.data) || y.qta - x.qta);
    if (!futuri.some(m => m.tipo === 'scarico') && !(a.scortaMin > 0 && g.giacenza < a.scortaMin)) continue;
    const min = Number(a.scortaMin) || 0;
    // giacenza negativa = dati da sistemare con l'inventario: si parte da zero
    const parti = Math.max(0, g.giacenza);
    let saldo = parti, minimo = parti, quando = parti < min ? oggi : null;
    const cotteUsate = new Map();
    for (const m of futuri) {
      saldo += m.qta;
      if (m.tipo === 'scarico') cotteUsate.set(m.id, { id: m.id, rif: m.rif, data: m.data });
      if (saldo < minimo) minimo = saldo;
      if (!quando && saldo < min - 1e-9) quando = m.data;
    }
    const manca = min - minimo;
    if (!(manca > 1e-9)) continue;
    const pezzi = a.pesoPezzo > 0 ? Math.ceil(manca / a.pesoPezzo - 1e-9) : null;
    const entro = addGiorni(quando, -anticipo);
    righe.push({
      articolo: a, giacenza: g.giacenza, negativa: g.giacenza < 0, serve: -futuri.filter(m => m.tipo === 'scarico').reduce((t, m) => t + m.qta, 0),
      inArrivo: futuri.filter(m => m.tipo === 'carico').reduce((t, m) => t + m.qta, 0),
      manca, pezzi, ordina: pezzi ? pezzi * a.pesoPezzo : manca, quando, entro: entro < oggi ? oggi : entro, urgente: entro <= oggi,
      fornitore: ultimoFornitore.get(a.id) || '', cotte: [...cotteUsate.values()],
    });
  }
  // ingredienti delle cotte da fare che non corrispondono a nessun articolo: non si possono contare
  const scollegati = new Map();
  for (const s of scarichiCotte(cotte.filter(c => c.data && c.data > oggi && c.data <= fino), articoli)) {
    if (s.articolo || s.data > fino) continue;
    const k = s.nome.trim().toLowerCase();
    const x = scollegati.get(k) || { nome: s.nome, qta: 0, unita: s.unita, cotte: new Set() };
    if (x.unita === s.unita) x.qta += s.qta;
    x.cotte.add(`${s.cotta.birra || ''} ${s.cotta.lotto || ''}`.trim());
    scollegati.set(k, x);
  }
  righe.sort((x, y) => x.entro.localeCompare(y.entro) || x.articolo.nome.localeCompare(y.articolo.nome, 'it'));
  return { righe, scollegati: [...scollegati.values()].map(x => ({ ...x, cotte: [...x.cotte] })) };
}

// Testo dell'ordine per un fornitore, da incollare in una mail o in WhatsApp
export function testoOrdine(righe, numIT) {
  return righe.map(r => {
    const u = r.articolo.unita;
    const q = `${numIT(r.ordina, u === 'kg' || u === 'L' ? 1 : 0)} ${u}`;
    return `- ${r.articolo.nome}: ${q}${r.pezzi ? ` (${r.pezzi} ${r.pezzi === 1 ? 'pezzo' : 'pezzi'} da ${numIT(r.articolo.pesoPezzo)} ${u})` : ''}`;
  }).join('\n');
}
