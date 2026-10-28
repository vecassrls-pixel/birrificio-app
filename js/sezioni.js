// Magazzino (Romain 2026-10-28): Materie prime, Birra e Packaging nella stessa sezione, con le unghie in alto
// come Economia. #/magazzino riapre l'ultima unghia usata.

let u; // { html }
export function init(strumenti) { u = strumenti; }

const CHIAVE = 'gb-magazzino-unghia';
export const UNGHIE_MAGAZZINO = [
  { percorso: 'materie-prime', titolo: 'Materie prime' },
  { percorso: 'birra', titolo: 'Birra' },
  { percorso: 'contenitori', titolo: 'Packaging' },
];

export function ultimaUnghiaMagazzino() {
  try { const p = localStorage.getItem(CHIAVE); return UNGHIE_MAGAZZINO.some(x => x.percorso === p) ? p : 'materie-prime'; } catch { return 'materie-prime'; }
}

// Titolo "Magazzino" e unghie, da mettere in cima alle tre pagine
export function testaMagazzino(attiva) {
  const { html } = u;
  try { localStorage.setItem(CHIAVE, attiva); } catch { /* solo comodità */ }
  return html`<div class="barra"><h1 style="margin:0">Magazzino</h1></div>
    <div class="b-marchi eco-unghie" role="tablist" aria-label="Magazzino">${UNGHIE_MAGAZZINO.map(x => html`<a role="tab" href="#/${x.percorso}" class="${x.percorso === attiva ? 'attivo' : ''}" aria-selected="${x.percorso === attiva}">${x.titolo}</a>`)}</div>`;
}
