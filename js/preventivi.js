// Preventivi per beerfirm.
//   costo cotta = malti + luppoli + trasporto forniture + lievito e additivi + costi di produzione + accise
//   accise = ettolitri × °Plato × aliquota (1,49 € microbirrifici)
//   preventivo = costo cotta + guadagno; prezzo al litro = preventivo / litri finali
//   prezzo di un formato = prezzo al litro × litri del formato + contenitore + lavoro
//     (lattina: litri 1/3, lattina + cartone 0,20 €, lavoro 0,06 €; fusto 25 L +12,30 €; fusto 20 L +12 €)
// Ogni nuovo preventivo parte dal "modello base" (record ID_MODELLO, modificabile come un preventivo):
// costi fissi, trasporto, aliquota, guadagno e formati già scritti; materie prime vuote, da riempire a mano
// (prezzo preso dal magazzino quando si sceglie l'articolo) o da una ricetta Brewfather.

import { articoloSimile, converti, convertiPer, trovaArticolo } from './magazzino.js';
import { prezzoArticolo } from './costi.js';

export const SEZIONI = [
  { k: 'malti', titolo: 'Malti', qta: 'kg', prezzo: '€/kg' },
  { k: 'luppoli', titolo: 'Luppoli', qta: 'kg', prezzo: '€/kg' },
  { k: 'trasporto', titolo: 'Trasporto forniture', qta: 'qtà', prezzo: '€' },
  { k: 'lievito', titolo: 'Lievito e additivi', qta: 'qtà', prezzo: '€/unità' },
  { k: 'costi', titolo: 'Costi di produzione', qta: 'qtà', prezzo: '€/unità' },
];
// sezioni con le materie prime del magazzino, e le categorie di articoli proposte in ognuna
export const CATEGORIE_SEZIONE = { malti: ['malto', 'zucchero'], luppoli: ['luppolo'], lievito: ['lievito', 'sale', 'aggiunta', 'coadiuvante', 'zucchero', 'spezia'] };
export const STATI = [['bozza', 'Bozza'], ['inviato', 'Inviato'], ['accettato', 'Accettato'], ['rifiutato', 'Rifiutato']];
export const ALIQUOTA_ACCISE = 1.49;
export const ID_MODELLO = 'preventivo-modello';

const righe = l => l.map(([nome, qta, prezzo]) => ({ nome, qta, prezzo }));
// costi fissi dell'ultimo preventivo fatto a mano da Romain (ottobre 2026): si cambiano nel modello base
export const MODELLO_BASE = {
  id: ID_MODELLO, tipo: 'preventivo', modello: true, cliente: '', birra: '', stato: 'bozza',
  litri: 1000, hl: 10, plato: 0, aliquota: ALIQUOTA_ACCISE, guadagno: 450,
  malti: [], luppoli: [], trasporto: righe([['Trasporto forniture', 1, 70]]), lievito: [],
  costi: righe([['Acqua', 1, 10], ['Corrente (kWh)', 250, 0.6], ['Gas', 12, 1.5], ['Affitto', 1, 100],
    ['CO2', 1, 25], ['Detergenti', 1, 10], ['Rata', 1, 383], ['Lavoro', 1, 500]]),
  formati: [
    { nome: 'Lattine 0,33 L', litri: 1 / 3, contenitore: 0.2, lavoro: 0.06, qta: 0 },
    { nome: 'Fusti 25 L', litri: 25, contenitore: 12.3, lavoro: 0, qta: 0 },
    { nome: 'Fusti 20 L', litri: 20, contenitore: 12, lavoro: 0, qta: 0 },
  ],
  note: '',
};

// nuovo preventivo da un modello o da un preventivo salvato
export function nuovoDa(da, id, oggi) {
  const { aggiornato: _a, modello: _m, ...resto } = structuredClone(da);
  return { ...resto, id, tipo: 'preventivo', data: oggi, stato: 'bozza' };
}

// ---------- materie prime dal magazzino ----------
const FAMIGLIA_BASE = { kg: 'kg', g: 'kg', L: 'L', ml: 'L', pz: 'pz' };
// unità della riga di preventivo: kg per malti e luppoli, altrimenti kg / L / pz secondo l'articolo
export const unitaRiga = (sez, art, unita) => (sez === 'malti' || sez === 'luppoli' ? 'kg' : FAMIGLIA_BASE[art?.unita] || FAMIGLIA_BASE[unita] || 'pz');
// prezzo dell'articolo (ultima bolla o scheda articolo) in € per unità della riga, oppure null
export function prezzoRiga(art, unita, oggi, storico) {
  const p = art && prezzoArticolo(art, oggi, storico);
  if (!p) return null;
  const quanti = convertiPer(art, 1, unita); // unità dell'articolo in 1 unità della riga
  return quanti > 0 ? Math.round(p.prezzo * quanti * 10000) / 10000 : null;
}
export const articoloPer = (sez, articoli, nome) => trovaArticolo(articoli, nome) || (sez === 'malti' || sez === 'luppoli' ? articoloSimile(articoli, nome) : null);

// Righe del preventivo da una ricetta Brewfather già convertita in scheda cotta (ricettaPerCotta):
// malti e luppoli in kg (lo stesso luppolo usato più volte = una riga), lievito e sali/additivi nella loro unità.
export function righeDaRicetta(x, articoli, oggi, storico) {
  const out = { malti: [], luppoli: [], lievito: [] };
  const metti = (sez, r) => {
    const n = Number(r.qta);
    if (!r.nome || !(n > 0)) return;
    const art = articoloPer(sez, articoli, r.nome);
    const da = r.unita || (sez === 'malti' ? 'kg' : sez === 'luppoli' ? 'g' : 'pz');
    let unita = unitaRiga(sez, art, da);
    const inArt = art ? convertiPer(art, n, da) : null;
    let q = inArt !== null ? converti(inArt, art.unita, unita) : converti(n, da, unita);
    if (q === null) { q = n; unita = da; } // es. lievito in bustine e articolo in grammi senza peso a pezzo
    const nome = art ? art.nome : r.nome;
    const riga = out[sez].find(y => y.nome === nome && y.unita === unita);
    if (riga) { riga.qta = Math.round((riga.qta + q) * 1000) / 1000; return; }
    out[sez].push({ nome, qta: Math.round(q * 1000) / 1000, prezzo: prezzoRiga(art, unita, oggi, storico) ?? 0, unita });
  };
  for (const r of x.malti || []) metti('malti', r);
  for (const r of x.luppoli || []) metti('luppoli', r);
  for (const r of [...(x.lievito || []), ...(x.sali || [])]) metti('lievito', r);
  return out;
}

const n = v => Number(v) || 0;
export function calcola(p) {
  const sezioni = {};
  for (const s of SEZIONI) {
    const r = (p[s.k] || []).map(x => n(x.qta) * n(x.prezzo));
    sezioni[s.k] = { righe: r, totale: r.reduce((a, b) => a + b, 0), qta: (p[s.k] || []).reduce((a, x) => a + n(x.qta), 0) };
  }
  const hlPlato = n(p.hl) * n(p.plato);
  const accise = hlPlato * n(p.aliquota);
  const totale = SEZIONI.reduce((a, s) => a + sezioni[s.k].totale, 0) + accise;
  const litri = n(p.litri);
  const costoL = litri ? totale / litri : 0;
  const preventivo = totale + n(p.guadagno);
  const prezzoL = litri ? preventivo / litri : 0;
  const formati = (p.formati || []).map(f => {
    const unita = prezzoL * n(f.litri) + n(f.contenitore) + n(f.lavoro);
    return { unita, totale: n(f.qta) * unita, litri: n(f.qta) * n(f.litri) };
  });
  const totalePreventivo = formati.reduce((a, f) => a + f.totale, 0);
  const litriConfezionati = formati.reduce((a, f) => a + f.litri, 0);
  return { sezioni, hlPlato, accise, totale, costoL, preventivo, prezzoL, formati, totalePreventivo, litriConfezionati };
}

const soldi = v => Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = v => Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 });
// testo da mandare al cliente: solo formati, prezzi unitari e totale (niente costi interni)
export function testoCliente(p, c, dataIT) {
  const usati = (p.formati || []).map((f, i) => ({ f, x: c.formati[i] })).filter(({ f }) => n(f.qta) > 0);
  return [
    `Preventivo ${p.birra || ''}`.trim(),
    [p.cliente && `Per: ${p.cliente}`, p.data && `Data: ${dataIT(p.data)}`].filter(Boolean).join(' · '),
    `Produzione: ${numero(p.litri)} litri`,
    '',
    ...usati.map(({ f, x }) => `- ${numero(f.qta)} × ${f.nome}: ${soldi(x.unita)} € cad. = ${soldi(x.totale)} €`),
    '',
    `Totale: ${soldi(c.totalePreventivo)} € + IVA`,
    ...(p.note ? ['', p.note] : []),
  ].join('\n');
}
