// Carrello della birra (Birra → 🧺 Carrello): le birre disponibili si trascinano nel carrello,
// poi si manda tutto a Fatture in Cloud come fattura oppure si fa uno scarico di magazzino.
// Il carrello resta su questo dispositivo (localStorage) finché non lo si usa o svuota.
//
// { righe: [{ prodotto, pezzi, lotto ('' = il primo che scade), prezzo (null = dal listino) }], cliente, listino }

import { daChiave, nomeProdotto } from './birra.js';
import { dataIT } from './dominio.js';
import { righeListino, listinoDa, ID_ALPHA } from './listini.js';
import { pezziCartone } from './etichetta.js';

const CHIAVE = 'gb-carrello';
const vuoto = () => ({ righe: [], cliente: '', listino: '' });

export function leggiCarrello() {
  try {
    const c = JSON.parse(localStorage.getItem(CHIAVE));
    if (c && Array.isArray(c.righe)) return { ...vuoto(), ...c };
  } catch { /* niente */ }
  return vuoto();
}
export function scriviCarrello(c) { try { localStorage.setItem(CHIAVE, JSON.stringify(c)); } catch { /* vale solo ora */ } }
export const svuotaCarrello = () => scriviCarrello(vuoto());
export const pezziCarrello = c => c.righe.reduce((t, r) => t + (Number(r.pezzi) || 0), 0);

// quanti pezzi aggiunge un trascinamento: un fusto, o un cartone di lattine
export const passo = (chiave, pezziCartone = 12) => (daChiave(chiave).tipo === 'fusto' ? 1 : Number(pezziCartone) || 12);

export function aggiungi(c, prodotto, pezzi) {
  const r = c.righe.find(x => x.prodotto === prodotto);
  if (r) r.pezzi = (Number(r.pezzi) || 0) + pezzi;
  else c.righe.push({ prodotto, pezzi, lotto: '', prezzo: null });
  return c;
}

export function mettiNelCarrello(chiave) {
  const c = aggiungi(leggiCarrello(), chiave, passo(chiave, pezziCartone()));
  scriviCarrello(c);
  return c;
}

// Trascinamento verso il carrello (pagina Birra e pagina Carrello): dataTransfer porta la chiave del prodotto
export const TIPO_DRAG = 'text/x-birra';
export function trascinabile(e) {
  const el = e.target.closest?.('[data-k]');
  if (!el || !e.dataTransfer) return false;
  e.dataTransfer.setData(TIPO_DRAG, el.dataset.k);
  e.dataTransfer.setData('text/plain', nomeProdotto(el.dataset.k));
  e.dataTransfer.effectAllowed = 'copy';
  return true;
}

// Prezzi (per pezzo) del listino scelto: Map chiave → prezzo, e se sono IVA inclusa
export function prezziListino(listini, id) {
  const alpha = listini.find(l => l.id === ID_ALPHA && !l.eliminato);
  const rec = id && listini.find(l => l.id === id && !l.eliminato);
  const prezzi = new Map();
  if (!rec || !alpha) return { prezzi, iva: false };
  const l = listinoDa(rec);
  for (const r of righeListino({ ...l, prodotti: 'tutti' }, Object.keys(alpha.prezzi || {}), new Map(), alpha.prezzi || {}, alpha.esclusi || [])) {
    if (r.prezzo && !r.escluso) prezzi.set(r.chiave, r.prezzo);
  }
  return { prezzi, iva: !!l.iva };
}
export const prezzoRiga = (r, prezzi) => (r.prezzo !== null && r.prezzo !== undefined && r.prezzo !== '' ? Number(r.prezzo) : prezzi.get(r.prodotto) ?? null);

// Codice di Fatture in Cloud del prodotto (dai codici salvati in Importa): meglio quello del singolo pezzo,
// altrimenti uno a confezione (x pezzi) che divide i pezzi del carrello. → { codice, x }
export function codiceFic(prodotti, chiave, pezzi) {
  const codici = (prodotti.find(p => p.chiave === chiave && !p.eliminato)?.codici || []).map(c => ({ codice: String(c.codice), x: Number(c.x) || 1 }));
  return codici.find(c => c.x === 1) || codici.filter(c => pezzi % c.x === 0).sort((a, b) => b.x - a.x)[0] || { codice: '', x: 1 };
}

// Lotti che prenderà lo scarico di ogni riga, come fa il magazzino: prima il lotto scelto, poi quello che scade prima.
// g = giacenzeBirra(); → per ogni riga [{ lotto, scadenza, pezzi }]
const stessoLotto = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
export function lottiRighe(righe, g) {
  const resti = new Map();
  return righe.map(r => {
    if (!resti.has(r.prodotto)) resti.set(r.prodotto, (g.get(r.prodotto)?.lotti || []).map(l => ({ ...l })));
    const lotti = resti.get(r.prodotto), out = [];
    let resto = Number(r.pezzi) || 0;
    const prendi = l => { const q = Math.min(resto, l.pezzi); if (q <= 0) return; l.pezzi -= q; resto -= q; out.push({ lotto: l.lotto, scadenza: l.scadenza, pezzi: q }); };
    const scelto = r.lotto && lotti.find(l => stessoLotto(l.lotto, r.lotto));
    if (scelto) prendi(scelto);
    for (const l of lotti) { if (resto <= 0) break; prendi(l); }
    if (resto > 0) out.push({ lotto: r.lotto || '', scadenza: '', pezzi: resto });
    return out;
  });
}
// "Lotto 51/26 scad. 31/05/27"; con più lotti anche i pezzi di ognuno
export function testoLotti(lotti) {
  const l = (lotti || []).filter(x => x.lotto);
  return l.map(x => `Lotto ${x.lotto}${x.scadenza ? ` scad. ${dataIT(x.scadenza)}` : ''}${l.length > 1 ? ` (${x.pezzi} pz)` : ''}`).join(' · ');
}

// Cliente dell'anagrafica di Fatture in Cloud con questo nome: per id, poi nome uguale senza punti e spazi
// ("Lucy S.R.L.S." = "LUCY SRLS"), poi un nome che contiene l'altro
const pulito = n => String(n || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
export function clienteFic(elenco, nome, id) {
  const n = pulito(nome);
  return (id && elenco.find(c => String(c.id) === String(id))) || elenco.find(c => pulito(c.nome) === n)
    || (n.length > 3 ? elenco.filter(c => pulito(c.nome).length > 3 && (pulito(c.nome).includes(n) || n.includes(pulito(c.nome)))).sort((a, b) => a.nome.length - b.nome.length)[0] : null) || null;
}

// Righe della fattura per Fatture in Cloud; lotti = lottiRighe() delle stesse righe (i lotti vanno in descrizione)
export function righeFattura(c, prodotti, prezzi, lotti = []) {
  return c.righe.filter(r => Number(r.pezzi) > 0).map((r, i) => {
    const { codice, x } = codiceFic(prodotti, r.prodotto, Number(r.pezzi));
    const p = prezzoRiga(r, prezzi);
    return {
      codice, nome: nomeProdotto(r.prodotto), descrizione: lotti[i] ? testoLotti(lotti[i]) : r.lotto ? `Lotto ${r.lotto}` : '',
      qta: Number(r.pezzi) / x, prezzo: p === null ? null : Math.round(p * x * 10000) / 10000,
    };
  });
}

// Le righe del carrello come righe di un movimento di birra
export const righeMovimento = c => c.righe.filter(r => r.prodotto && Number(r.pezzi) > 0).map(r => ({ prodotto: r.prodotto, pezzi: Number(r.pezzi), lotto: r.lotto || '' }));
