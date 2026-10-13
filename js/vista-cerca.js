// Ricerca unica: cotte (birra, lotto anche "51/52/25", stile, FV, ingredienti, note), materie prime
// (nome e altri nomi), lotti delle materie prime (bolle, inventari, carichi/scarichi), bolle
// (fornitore, numero), movimenti della birra (cliente, documento, lotto).
// Più parole = tutte devono comparire.

import { STATI, gruppoCotta, lottoGruppo, statoCotta } from './dominio.js';
import { CATEGORIE } from './magazzino.js';

let u; // { $app, html, db, stato, dataIT }
export function init(strumenti) { u = strumenti; }

let testo = '';
const MAX = 30;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const trova = (parole, ...campi) => { const t = norm(campi.flat().join(' ')); return parole.every(p => t.includes(p)); };

export async function vistaCerca() {
  const { html } = u;
  u.$app.innerHTML = html`
    <h1>Cerca</h1>
    <input id="cerca-q" class="st-libero" type="search" placeholder="Birra, lotto (es. 51/25), ingrediente, fornitore, cliente, n° bolla…" value="${testo}" autocomplete="off" enterkeyhint="search">
    <div id="cerca-esiti" style="margin-top:14px"></div>`;
  const dati = await Promise.all(['articolo', 'bolla', 'inventario', 'scarico', 'movbirra'].map(t => u.db.tutti(t)));
  const [articoli, bolle, inventari, scarichi, movbirra] = dati;
  const q = document.getElementById('cerca-q');
  const mostra = () => { document.getElementById('cerca-esiti').innerHTML = esiti({ articoli, bolle, inventari, scarichi, movbirra }).s; };
  q.addEventListener('input', () => { testo = q.value; mostra(); });
  q.focus();
  mostra();
}

function esiti({ articoli, bolle, inventari, scarichi, movbirra }) {
  const { html } = u;
  const parole = norm(testo).split(/\s+/).filter(Boolean);
  if (!parole.length) return html`<p class="totale">Scrivi almeno una parola. Puoi cercare anche un lotto di materia prima per sapere in quali cotte è finito (registro S6).</p>`;
  const perArt = new Map(articoli.map(a => [a.id, a]));
  const nomeArt = id => perArt.get(id)?.nome || '';

  // cotte
  const cotte = [];
  for (const c of [...u.stato.cotte].sort((a, b) => (b.data || '').localeCompare(a.data || ''))) {
    const g = gruppoCotta(c, u.stato.cotte);
    const lottoLungo = g.length > 1 ? `${lottoGruppo(g)}/${String(c.anno || '').slice(2)}` : '';
    const ingredienti = ['malti', 'luppoli', 'lievito', 'sali'].flatMap(k => (c[k] || []).map(r => `${r.nome} ${r.lotto || ''}`));
    if (!trova(parole, c.birra, c.lotto, lottoLungo, `${c.numero}/${c.anno}`, c.stile, c.fv, c.note, ingredienti, c.data, u.dataIT(c.data))) continue;
    // dove ha trovato: se non è nel nome/lotto, mostra l'ingrediente o la nota
    const dettaglio = trova(parole, c.birra, c.lotto, lottoLungo, c.stile, c.fv) ? ''
      : ingredienti.find(x => parole.some(p => norm(x).includes(p))) || (parole.some(p => norm(c.note).includes(p)) ? `nota: ${String(c.note).slice(0, 80)}` : '');
    cotte.push({ c, dettaglio, s: statoCotta(c, u.stato.durate, undefined, u.stato.cotte) });
  }
  const art = articoli.filter(a => trova(parole, a.nome, a.alias || [], CATEGORIE[a.categoria] || ''));
  // lotti delle materie prime: dove sono entrati e usciti
  const lotti = [];
  for (const b of bolle) for (const r of b.righe || []) if (r.lotto && trova(parole, r.lotto, nomeArt(r.articoloId))) lotti.push({ data: b.data, lotto: r.lotto, art: nomeArt(r.articoloId), dove: `Bolla ${b.fornitore || ''} ${b.numero || ''}`.trim(), href: `#/bolla/${encodeURIComponent(b.id)}`, cs: 'C' });
  for (const i of inventari) for (const r of i.righe || []) if (r.lotto && trova(parole, r.lotto, nomeArt(r.articoloId))) lotti.push({ data: i.data, lotto: r.lotto, art: nomeArt(r.articoloId), dove: 'Inventario', href: '#/inventario', cs: '=' });
  for (const s of scarichi) for (const r of s.righe || []) if (r.lotto && trova(parole, r.lotto, nomeArt(r.articoloId))) lotti.push({ data: s.data, lotto: r.lotto, art: nomeArt(r.articoloId), dove: `${s.verso === 'carico' ? 'Carico' : 'Scarico'} manuale${s.destinatario ? ` · ${s.destinatario}` : ''}`, href: `#/scarico/${encodeURIComponent(s.id)}`, cs: s.verso === 'carico' ? 'C' : 'S' });
  lotti.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const bol = bolle.filter(b => trova(parole, b.fornitore, b.numero, b.data, u.dataIT(b.data), (b.righe || []).map(r => nomeArt(r.articoloId))))
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const mov = movbirra.filter(m => trova(parole, m.cliente, m.documento, m.note, (m.righe || []).map(r => `${r.lotto || ''} ${String(r.prodotto || '').split('|')[0]}`)))
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const tot = cotte.length + art.length + lotti.length + bol.length + mov.length;
  if (!tot) return html`<p class="vuoto">Nessun risultato per "${testo}".</p>`;
  const titolo = (t, n) => html`<h2>${t} <span class="totale">${n > MAX ? `primi ${MAX} di ${n}` : n}</span></h2>`;
  return html`
    ${cotte.length ? html`<div class="scheda">${titolo('Cotte', cotte.length)}<div class="lista">${cotte.slice(0, MAX).map(({ c, dettaglio, s }) => html`
      <a class="riga-cotta ${s}" href="#/cotta/${encodeURIComponent(c.id)}"><span class="lotto">${c.lotto || '—'}</span>
        <span class="birra">${c.birra}${dettaglio ? html` <span class="totale">· ${dettaglio}</span>` : ''}</span>
        <span class="totale" style="margin:0">${u.dataIT(c.data)} · ${c.fv || '—'} · ${STATI[s]}</span></a>`)}</div></div>` : ''}
    ${lotti.length ? html`<div class="scheda">${titolo('Lotti di materie prime', lotti.length)}<div class="scroll-x"><table class="tab-mag">
      <thead><tr><th>Data</th><th>Lotto</th><th>Articolo</th><th>Movimento</th></tr></thead>
      <tbody>${lotti.slice(0, MAX).map(l => html`<tr><td>${u.dataIT(l.data)}</td><td>${l.lotto}</td><td>${l.art}</td><td><a href="${l.href}">${l.cs} · ${l.dove}</a></td></tr>`)}</tbody></table></div>
      <p class="totale">Le cotte che hanno usato un lotto sono nel <a href="#/registro-s6">registro S6</a>.</p></div>` : ''}
    ${art.length ? html`<div class="scheda">${titolo('Materie prime', art.length)}<div class="lista">${art.slice(0, MAX).map(a => html`
      <a class="riga-cotta" href="#/materia/${encodeURIComponent(a.id)}"><span class="lotto">${CATEGORIE[a.categoria] || ''}</span><span class="birra">${a.nome}</span>
        <span class="totale" style="margin:0">${(a.alias || []).slice(0, 3).join(', ')}</span></a>`)}</div></div>` : ''}
    ${bol.length ? html`<div class="scheda">${titolo('Bolle', bol.length)}<div class="lista">${bol.slice(0, MAX).map(b => html`
      <a class="riga-cotta" href="#/bolla/${encodeURIComponent(b.id)}"><span class="lotto">${u.dataIT(b.data)}</span><span class="birra">${b.fornitore || 'Fornitore ?'}${b.numero ? ` · n° ${b.numero}` : ''}</span>
        <span class="totale" style="margin:0">${(b.righe || []).length} righe</span></a>`)}</div></div>` : ''}
    ${mov.length ? html`<div class="scheda">${titolo('Movimenti birra', mov.length)}<div class="lista">${mov.slice(0, MAX).map(m => html`
      <a class="riga-cotta" href="#/movbirra/${encodeURIComponent(m.id)}"><span class="lotto">${u.dataIT(m.data)}</span>
        <span class="birra">${m.verso === 'carico' ? '+' : '−'} ${m.cliente || m.motivo || ''}${m.documento ? ` · ${m.documento}` : ''}</span>
        <span class="totale" style="margin:0">${(m.righe || []).reduce((t, r) => t + (Number(r.pezzi) || 0), 0)} pz</span></a>`)}</div></div>` : ''}`;
}
