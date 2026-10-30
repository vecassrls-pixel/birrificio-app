// Economia (Romain 2026-10-28): Cassa, Scontrini, Accise, Stipendi, F24, Eshop (e poi Cashflow) nella stessa sezione,
// con le unghie in alto per passare da una pagina all'altra. #/economia riapre l'ultima unghia usata.

import { TIPI_MENSILI, apertiMensili } from './mensili.js';

let u; // { html, db, oggiISO }
export function init(strumenti) { u = strumenti; }

const CHIAVE = 'gb-economia-unghia';
export const UNGHIE = [
  { percorso: 'cassa', titolo: 'Cassa' },
  { percorso: 'scontrini', titolo: 'Scontrini' }, // corrispettivi dal portale dell'Agenzia delle Entrate (Romain 2026-10-30)
  ...Object.entries(TIPI_MENSILI).map(([tipo, t]) => ({ percorso: t.percorso, titolo: t.titolo, tipo })),
  { percorso: 'eshop', titolo: 'Eshop' }, // vendite online di Shopify (Romain 2026-10-30)
  { percorso: 'cashflow', titolo: 'Cashflow', presto: true }, // arriva con la sua PR
];
export const percorsiEconomia = UNGHIE.filter(x => !x.presto).map(x => x.percorso);

export function ultimaUnghia() {
  try { const p = localStorage.getItem(CHIAVE); return percorsiEconomia.includes(p) ? p : 'cassa'; } catch { return 'cassa'; }
}

// Unghie con il numero dei pagamenti scaduti (⚠) sulle pagine mensili
export async function unghieEconomia(attiva) {
  const { html } = u;
  try { localStorage.setItem(CHIAVE, attiva); } catch { /* solo comodità */ }
  const oggi = u.oggiISO();
  const scadute = {};
  for (const x of UNGHIE.filter(y => y.tipo)) {
    const imp = await u.db.leggi(`impostazione-${x.tipo}`);
    scadute[x.percorso] = apertiMensili(await u.db.tutti(x.tipo), oggi, { ...TIPI_MENSILI[x.tipo].scadenza, ...(imp && !imp.eliminato ? imp : {}) }).scadute;
  }
  return html`<div class="b-marchi eco-unghie" role="tablist" aria-label="Economia">${UNGHIE.map(x => (x.presto
    ? html`<button type="button" role="tab" disabled title="In arrivo">${x.titolo} <small>presto</small></button>`
    : html`<a role="tab" href="#/${x.percorso}" class="${x.percorso === attiva ? 'attivo' : ''}" aria-selected="${x.percorso === attiva}">${x.titolo}${scadute[x.percorso] ? html` <small class="eco-scadute">⚠ ${scadute[x.percorso]}</small>` : ''}</a>`))}</div>`;
}
