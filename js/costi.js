// Costo delle cotte: materie prime usate × prezzo, e margine sul prezzo di vendita.
//
// Prezzo di un articolo a una data (in € per unità dell'articolo, es. €/kg):
//   1. l'ultima bolla con il prezzo fino a quella data (righe bolla: prezzo = € per unità della riga);
//   2. altrimenti il prezzo scritto nella scheda articolo (articolo.prezzo).
// Per le cotte pianificate vale l'ultimo prezzo conosciuto.
//
// Prezzi di vendita (record 'impostazione-prezzi'): € per pezzo (fusto, lattina) per formato,
// con eventuale prezzo diverso per una birra: chiave "BIRRA|tipo|litri", di base "*|tipo|litri".
// Altri costi per cotta (energia, CO2, pulizie…): una cifra fissa che si somma alle materie prime.

import { convertiPer, scarichiCotte } from './magazzino.js';
import { gruppoCotta, nomeBirra } from './dominio.js';

export const ID_PREZZI = 'impostazione-prezzi';
export const prezziDa = rec => ({ vendita: {}, altriCostiCotta: 0, ...(rec || {}) });

// Prezzi da bolla per articolo: [{ data, prezzo (€/unità articolo), fornitore }] in ordine di data
export function storicoPrezzi(articoli, bolle) {
  const perId = new Map(articoli.map(a => [a.id, a]));
  const out = new Map();
  for (const b of bolle) {
    if (!b.data) continue;
    for (const r of b.righe || []) {
      const art = perId.get(r.articoloId);
      const p = Number(r.prezzo);
      if (!art || !(p > 0)) continue;
      const unoRiga = convertiPer(art, 1, r.unita || art.unita); // 1 unità della riga = x unità articolo
      if (!(unoRiga > 0)) continue;
      if (!out.has(art.id)) out.set(art.id, []);
      out.get(art.id).push({ data: b.data, prezzo: p / unoRiga, fornitore: b.fornitore || '', bolla: b.id });
    }
  }
  for (const v of out.values()) v.sort((x, y) => x.data.localeCompare(y.data));
  return out;
}

// { prezzo, fonte: 'bolla'|'articolo', data } oppure null
export function prezzoArticolo(art, data, storico) {
  const v = storico.get(art.id) || [];
  const fino = data ? v.filter(x => x.data <= data) : v;
  const ultimo = fino[fino.length - 1];
  if (ultimo) return { prezzo: ultimo.prezzo, fonte: 'bolla', data: ultimo.data, fornitore: ultimo.fornitore };
  if (Number(art.prezzo) > 0) return { prezzo: Number(art.prezzo), fonte: 'articolo' };
  // cotta più vecchia della prima bolla con prezzo: il prezzo più vecchio conosciuto
  if (v.length) return { prezzo: v[0].prezzo, fonte: 'bolla', data: v[0].data, fornitore: v[0].fornitore };
  return null;
}

// Costo di una cotta. righe: [{ nome, articolo, qta (unità articolo), unita, prezzo, costo }]
export function costoCotta(c, { articoli, storico, prezzi }) {
  const righe = [];
  const mancanti = [];
  for (const s of scarichiCotte([c], articoli)) {
    const art = s.articolo;
    if (!art) { mancanti.push({ nome: s.nome, motivo: 'non collegato al magazzino' }); continue; }
    const qta = convertiPer(art, s.qta, s.unita || art.unita);
    if (qta === null) { mancanti.push({ nome: s.nome, motivo: `unità ${s.unita} non convertibile in ${art.unita}` }); continue; }
    const p = prezzoArticolo(art, c.data, storico);
    if (!p) { mancanti.push({ nome: art.nome, motivo: 'senza prezzo', articolo: art }); continue; }
    righe.push({ nome: art.nome, articolo: art, sezione: s.sezione, qta, unita: art.unita, prezzo: p.prezzo, fonte: p.fonte, costo: qta * p.prezzo });
  }
  // stesso articolo usato più volte (es. luppolo in bollitura e DH): una riga sola
  const unite = new Map();
  for (const r of righe) {
    const x = unite.get(r.articolo.id);
    if (x) { x.qta += r.qta; x.costo += r.costo; } else unite.set(r.articolo.id, { ...r });
  }
  const materie = righe.reduce((t, r) => t + r.costo, 0);
  const altri = Number(prezzi?.altriCostiCotta) || 0;
  return { righe: [...unite.values()].sort((a, b) => b.costo - a.costo), mancanti, materie, altri, totale: materie + altri };
}

// Prezzo di vendita di un pezzo: prima quello della birra, poi quello del formato
export function prezzoVendita(prezzi, birra, tipo, litri) {
  const v = prezzi?.vendita || {};
  const k = `${tipo || 'fusto'}|${Number(litri) || 0}`;
  const p = v[`${nomeBirra(birra)}|${k}`] ?? v[`*|${k}`];
  return Number(p) > 0 ? Number(p) : null;
}
export const chiaveFormato = (tipo, litri) => `*|${tipo || 'fusto'}|${Number(litri) || 0}`;

// Conto del lotto (cotta singola o doppia/tripla): costo, litri, costo al litro, ricavo e margine.
// Litri: confezionati se ci sono, altrimenti litri in FV (stima).
export function contoLotto(c, cotte, dati) {
  const g = gruppoCotta(c, cotte);
  const costi = g.map(x => costoCotta(x, dati));
  const costo = costi.reduce((t, x) => t + x.totale, 0);
  const materie = costi.reduce((t, x) => t + x.materie, 0);
  const mancanti = costi.flatMap(x => x.mancanti);
  const conf = g.flatMap(x => x.confezionato || []);
  const litriConf = conf.reduce((t, r) => t + (Number(r.pezzi) || 0) * (Number(r.litri) || 0), 0);
  const litriFv = g.reduce((t, x) => t + (Number(x.litri) || 0), 0);
  const litri = litriConf || litriFv;
  let ricavo = 0, senzaPrezzo = 0;
  for (const r of conf) {
    const p = prezzoVendita(dati.prezzi, c.birra, r.tipo, r.litri);
    if (p === null) senzaPrezzo += Number(r.pezzi) || 0; else ricavo += (Number(r.pezzi) || 0) * p;
  }
  return {
    gruppo: g, costi, costo, materie, mancanti, litri, litriStimati: !litriConf, perLitro: litri > 0 ? costo / litri : null,
    ricavo: ricavo > 0 ? ricavo : null, ricavoParziale: ricavo > 0 && senzaPrezzo > 0,
    margine: ricavo > 0 ? ricavo - costo : null,
  };
}
