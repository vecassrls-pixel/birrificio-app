// Ricette (Romain 2026-10-28): per ogni birra la ricetta presa dalle cotte salvate nell'app.
// Ricetta di riferimento = l'ultima cotta già fatta (se non ce n'è, l'ultima pianificata);
// le cotte con gli stessi malti, luppoli e lievito formano una versione, così si vede quando e cosa è cambiato
// (sali e acido no: si correggono a ogni cotta in base all'acqua).
// Brewfather resta la fonte delle ricette: qui si legge solo quello che è finito nelle cotte.

import { abv, fineCotta, gruppoCotta, nomeBirra, ogMedia } from './dominio.js';
import { decimaliUnita } from './magazzino.js';

let u; // { $app, html, raw, stato, dataIT, numIT, oggiISO, diffGiorni, nuovaCotta }
export function init(strumenti) { u = strumenti; }

const SEZIONI = [
  ['malti', 'Malti e zuccheri'],
  ['luppoli', 'Luppoli'],
  ['lievito', 'Lievito'],
  ['sali', 'Sali e additivi'],
];
const filtro = { q: '', ordine: 'az' };
const pieno = v => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const chiaveNome = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const kgDi = r => (r.unita === 'kg' ? +r.qta || 0 : r.unita === 'g' ? (+r.qta || 0) / 1000 : 0);
const conRicetta = c => !c.eliminato && c.data && (c.malti || []).some(r => r.nome);

// Impronta degli ingredienti: stesse righe (nome, uso, quantità arrotondata) = stessa versione
const SEZIONI_VERSIONE = ['malti', 'luppoli', 'lievito'];
function righeRicetta(c) {
  const out = new Map();
  for (const k of SEZIONI_VERSIONE) {
    for (const r of c[k] || []) {
      if (!r?.nome) continue;
      const id = `${k}|${chiaveNome(r.nome)}${k === 'luppoli' ? `|${r.uso || ''}` : ''}`;
      const x = out.get(id) || { sez: k, nome: r.nome, uso: k === 'luppoli' ? r.uso || '' : '', qta: 0, unita: r.unita || '' };
      x.qta += Number(r.qta) || 0;
      out.set(id, x);
    }
  }
  return out;
}
const impronta = c => [...righeRicetta(c)].map(([id, x]) => `${id}=${Math.round(x.qta * 1000) / 1000}${x.unita}`).sort().join(';');

// Cosa cambia da una versione all'altra (nomi e quantità)
function differenze(prima, dopo) {
  const a = righeRicetta(prima), b = righeRicetta(dopo);
  const nome = x => `${x.nome}${x.uso && x.uso !== 'bollitura' ? ` (${x.uso})` : ''}`;
  const qta = x => `${u.numIT(x.qta, decimaliUnita(x.unita) || 2)} ${x.unita}`.trim();
  const d = [];
  for (const [id, x] of b) {
    const y = a.get(id);
    if (!y) d.push({ tipo: 'piu', testo: `+ ${nome(x)}${x.qta ? ` ${qta(x)}` : ''}` });
    else if (Math.abs(x.qta - y.qta) > 1e-6 && x.unita === y.unita) d.push({ tipo: 'qta', testo: `${nome(x)} ${qta(y)} → ${qta(x)}` });
  }
  for (const [id, y] of a) if (!b.has(id)) d.push({ tipo: 'meno', testo: `− ${nome(y)}` });
  return d;
}

// Tutte le birre con almeno una cotta con i malti, ognuna con le sue versioni (dalla più recente)
function ricette() {
  const { stato, oggiISO } = u;
  const oggi = oggiISO();
  const perBirra = new Map();
  for (const c of stato.cotte.filter(conRicetta)) {
    const k = nomeBirra(c.birra);
    if (!perBirra.has(k)) perBirra.set(k, []);
    perBirra.get(k).push(c);
  }
  return [...perBirra].map(([chiave, cotte]) => {
    cotte.sort((a, b) => a.data.localeCompare(b.data) || (a.numero || 0) - (b.numero || 0));
    // versioni: cotte consecutive con gli stessi ingredienti
    const versioni = [];
    for (const c of cotte) {
      const imp = impronta(c);
      const v = versioni[versioni.length - 1];
      if (v && v.impronta === imp) v.cotte.push(c);
      else versioni.push({ impronta: imp, cotte: [c] });
    }
    versioni.forEach((v, i) => {
      v.numero = i + 1;
      v.fatte = v.cotte.filter(c => c.data <= oggi);
      v.rif = v.fatte[v.fatte.length - 1] || v.cotte[v.cotte.length - 1];
      v.cambi = i ? differenze(versioni[i - 1].rif, v.cotte[0]) : [];
    });
    const fatte = cotte.filter(c => c.data <= oggi);
    const rif = fatte[fatte.length - 1] || cotte[cotte.length - 1];
    const vRif = versioni.find(v => v.cotte.includes(rif));
    const ultima = cotte[cotte.length - 1];
    return { chiave, nome: rif.birra, rif, vRif, versioni: versioni.reverse(), cotte, fatte: fatte.length, ultima, prossima: cotte.find(c => c.data > oggi) };
  });
}

// OG, FG e grado alcolico della cotta (OG media se doppia/tripla)
function numeri(c) {
  const g = gruppoCotta(c, u.stato.cotte);
  const og = g.length > 1 ? ogMedia(g) : c.og;
  const ultima = [...(c.fermentazione || [])].reverse().find(e => pieno(e.densita));
  const fg = pieno(c.fg) ? c.fg : ultima ? Number(ultima.densita) : null;
  const a = abv(og, fg);
  return { og, fg, fgMisurata: pieno(c.fg), abv: a > 0 ? a : null }; // densità sbagliate nello storico: niente grado negativo
}

const stileDi = r => [...r.cotte].reverse().find(c => c.stile)?.stile || '';

// Il menu: la voce Ricette resta accesa anche sulla singola ricetta (#/ricetta/…)
function accendiMenu() {
  document.querySelector('.top nav a[data-tab="ricette"]')?.classList.add('attivo');
}

// ---------- elenco ----------
export function vistaRicette() {
  const { $app, html, dataIT, numIT } = u;
  accendiMenu();
  const tutte = ricette();
  const q = filtro.q.trim().toLowerCase();
  const lista = tutte
    .filter(r => !q || `${r.nome} ${stileDi(r)} ${[...righeRicetta(r.rif).values()].map(x => x.nome).join(' ')}`.toLowerCase().includes(q))
    .sort(filtro.ordine === 'recenti' ? (a, b) => b.rif.data.localeCompare(a.rif.data)
      : filtro.ordine === 'cotte' ? (a, b) => b.fatte - a.fatte || a.nome.localeCompare(b.nome)
        : (a, b) => a.nome.localeCompare(b.nome));
  const ORDINI = [['az', 'A–Z'], ['recenti', 'Ultime fatte'], ['cotte', 'Più fatte']];

  $app.innerHTML = html`
    <div class="barra"><h1 style="margin:0">Ricette</h1><span class="spazio"></span>
      <span class="totale" style="margin:0">${tutte.length} birre</span></div>
    <p class="totale" style="margin-top:0">La ricetta di ogni birra è quella dell'ultima cotta fatta; quando cambiano malti, luppoli o lievito inizia una nuova versione. Le ricette nascono in Brewfather: qui si legge cosa è finito davvero nelle cotte.</p>
    <div class="barra b-filtri">
      <input id="rc-q" type="search" placeholder="Cerca birra, stile, malto, luppolo…" value="${filtro.q}">
      <div class="segmenti" id="rc-ordine" role="group" aria-label="Ordina">${ORDINI.map(([k, t]) => html`<button type="button" data-o="${k}" class="${filtro.ordine === k ? 'attivo' : ''}" aria-pressed="${filtro.ordine === k}">${t}</button>`)}</div>
    </div>
    ${lista.length ? html`<div class="b-griglia">${lista.map(r => {
      const c = r.rif, n = numeri(c);
      const ing = [...righeRicetta(c).values()];
      const malti = ing.filter(x => x.sez === 'malti');
      const totMalti = malti.reduce((t, x) => t + kgDi(x), 0);
      const principali = malti.sort((a, b) => kgDi(b) - kgDi(a)).slice(0, 3).map(x => `${x.nome}${totMalti ? ` ${numIT(kgDi(x) / totMalti * 100, 0)}%` : ''}`);
      const luppoli = [...new Set(ing.filter(x => x.sez === 'luppoli').map(x => x.nome))];
      const lievito = ing.filter(x => x.sez === 'lievito').map(x => x.nome);
      const stile = stileDi(r);
      return html`<a class="b-card rc-card" href="#/ricetta/${encodeURIComponent(c.id)}">
        <header><h2>${r.nome}</h2>${c.beerfirm ? html`<span class="bf-chip" title="Beerfirm">${c.beerfirm}</span>` : ''}
          <span class="b-tot" title="Versioni della ricetta">v${r.vRif.numero}${r.versioni.length > 1 ? ` di ${r.versioni.length}` : ''}</span>
          ${stile ? html`<p class="totale" style="flex-basis:100%">${stile}</p>` : ''}</header>
        <div class="rc-numeri">
          ${pieno(n.og) ? html`<span><b>${numIT(n.og)}</b> OG °P</span>` : ''}
          ${n.abv ? html`<span><b>${numIT(n.abv, 1)}%</b> ABV</span>` : ''}
          ${pieno(c.litri) ? html`<span><b>${numIT(c.litri, 0)}</b> L</span>` : ''}
          <span><b>${r.fatte}</b> ${r.fatte === 1 ? 'cotta' : 'cotte'}</span>
        </div>
        <dl class="rc-ingr">
          ${principali.length ? html`<dt>Malti</dt><dd>${principali.join(' · ')}${malti.length > 3 ? ` +${malti.length - 3}` : ''}</dd>` : ''}
          ${luppoli.length ? html`<dt>Luppoli</dt><dd>${luppoli.join(', ')}</dd>` : ''}
          ${lievito.length ? html`<dt>Lievito</dt><dd>${lievito.join(', ')}</dd>` : ''}
        </dl>
        <p class="totale rc-piede">Ultima ${dataIT(c.data)} · lotto ${c.lotto || '—'}${r.prossima && r.prossima !== c ? ` · prossima ${dataIT(r.prossima.data)}` : ''}</p>
      </a>`;
    })}</div>` : html`<p class="vuoto">${tutte.length ? 'Nessuna ricetta trovata.' : 'Nessuna cotta con gli ingredienti: le ricette compaiono quando una cotta ha i malti compilati.'}</p>`}
  `;
  const $q = document.getElementById('rc-q');
  $q.addEventListener('input', () => { filtro.q = $q.value; vistaRicette(); const x = document.getElementById('rc-q'); x.focus(); x.setSelectionRange(filtro.q.length, filtro.q.length); });
  document.getElementById('rc-ordine').onclick = e => { const b = e.target.closest('button[data-o]'); if (b) { filtro.ordine = b.dataset.o; vistaRicette(); } };
}

// ---------- una ricetta (quella di una cotta, con tutte le versioni della birra) ----------
export function vistaRicetta(id) {
  const { $app, html, raw, dataIT, numIT, diffGiorni, stato } = u;
  accendiMenu();
  const c = stato.cotte.find(x => x.id === id);
  const r = c && ricette().find(x => x.chiave === nomeBirra(c.birra));
  if (!c || !r) { $app.innerHTML = html`<p class="vuoto">Ricetta non trovata. <a href="#/ricette">Torna alle ricette</a></p>`; return; }
  const v = r.versioni.find(x => x.cotte.includes(c));
  const n = numeri(c);
  const n1 = (x, d = 1) => (pieno(x) ? numIT(Number(x), d) : '');
  const tile = (etichetta, val, unita = '') => (pieno(val) && val !== '' ? html`<div class="st-tile"><span>${etichetta}</span><b>${val}${unita ? html`<small> ${unita}</small>` : ''}</b></div>` : '');
  const giorniFv = c.data ? diffGiorni(c.data, fineCotta(c, stato.durate)) : null;
  const ettolitri = Number(c.litri) > 0 ? Number(c.litri) / 100 : 0;

  const tabella = (k, titolo) => {
    const righe = (c[k] || []).filter(x => x?.nome);
    if (!righe.length) return '';
    const kg = righe.reduce((t, x) => t + kgDi(x), 0);
    const perc = k === 'malti' && kg > 0;
    const ghl = k === 'luppoli' && ettolitri;
    const conUso = k === 'luppoli' && righe.some(x => x.uso || pieno(x.minuti) || pieno(x.giorno));
    return html`<section class="scheda rc-sez"><h2>${titolo}</h2><div class="scroll-x"><table class="rc-tab"><tbody>
      ${righe.map(x => html`<tr>
        <td>${x.nome}</td>
        ${conUso ? html`<td class="rc-uso">${[x.uso, x.uso === 'dry hop' ? pieno(x.giorno) && `giorno ${x.giorno}` : pieno(x.minuti) && `${n1(x.minuti, 0)} min`].filter(Boolean).join(' · ')}</td>` : ''}
        <td class="n">${pieno(x.qta) ? `${numIT(Number(x.qta), decimaliUnita(x.unita) || 2)} ${x.unita || ''}` : ''}</td>
        ${perc ? html`<td class="n rc-perc">${kgDi(x) ? `${numIT(kgDi(x) / kg * 100, 1)}%` : ''}</td>` : ''}
        ${ghl ? html`<td class="n rc-perc" title="Grammi per ettolitro">${kgDi(x) ? `${numIT(kgDi(x) * 1000 / ettolitri, 0)} g/hL` : ''}</td>` : ''}
      </tr>`)}</tbody>
      ${righe.length > 1 && kg ? html`<tfoot><tr><td${conUso ? raw(' colspan="2"') : ''}>Totale</td><td class="n">${numIT(kg, 2)} kg</td>${perc || ghl ? html`<td class="n rc-perc">${ghl ? `${numIT(kg * 1000 / ettolitri, 0)} g/hL` : ''}</td>` : ''}</tr></tfoot>` : ''}
    </table></div></section>`;
  };
  const am = c.acquaMash || {}, as = c.acquaSparge || {}, ad = c.acquaDip || {};
  const processo = [
    ['T° mash', n1(am.tempMash), '°C'], ['Durata mash', n1(c.mashMin, 0), 'min'], ['pH mash', n1(c.phMash ?? am.ph15, 2), ''],
    ['Litri mash', n1(am.litri, 0), 'L'], ['T° sparge', n1(as.temp), '°C'], ['Litri sparge', n1(as.litri, 0), 'L'],
    ['Litri dip hopping', n1(ad.litri, 0), 'L'], ['Whirlpool', n1(c.whirlpoolMin, 0), 'min'], ['T° inoculo', n1(c.tempInoculo), '°C'],
  ].filter(([, val]) => val !== '');

  $app.innerHTML = html`
    <div class="barra">
      <a href="#/ricette" class="btn" title="Torna all'elenco delle ricette">←<span class="solo-desktop"> Ricette</span></a>
      <h1 style="margin:0">${r.nome}</h1>${c.beerfirm ? html`<span class="bf-chip" title="Beerfirm">${c.beerfirm}</span>` : ''}
      <span class="spazio"></span>
      <a class="btn" href="#/cotta/${encodeURIComponent(c.id)}">Apri la cotta ${c.lotto || ''}</a>
      <button class="primario solo-editori" id="rc-nuova" title="Nuova cotta che copia ingredienti, acqua, profilo e durata da questa cotta">+ Nuova cotta con questa ricetta</button>
    </div>
    <p class="totale" style="margin-top:0">${[stileDi(r), `versione ${v.numero} di ${r.versioni.length}`, `dalla cotta del ${dataIT(c.data)} (lotto ${c.lotto || '—'})`, c.ricettaBf?.nome && `ricetta Brewfather “${c.ricettaBf.nome}”`].filter(Boolean).join(' · ')}${c !== r.rif ? html` · <a href="#/ricetta/${encodeURIComponent(r.rif.id)}">vai alla ricetta attuale</a>` : ''}</p>
    <div class="rc-tiles">
      ${tile('OG', n1(n.og), '°P')}
      ${tile(n.fgMisurata ? 'FG' : 'Ultima densità', n1(n.fg), '°P')}
      ${tile('ABV', n.abv ? numIT(n.abv, 1) : '', '%')}
      ${tile('Litri cotta', n1(c.litri, 0), 'L')}
      ${tile('Giorni in FV', giorniFv > 0 ? giorniFv + 1 : '', '')}
    </div>
    <div class="rc-colonne">${SEZIONI.map(([k, t]) => tabella(k, t))}</div>
    ${processo.length ? html`<section class="scheda rc-sez"><h2>Acqua e processo</h2><div class="rc-voci">${processo.map(([e, val, un]) => html`<div><span>${e}</span><b>${val}${un ? ` ${un}` : ''}</b></div>`)}</div></section>` : ''}
    <section class="scheda rc-sez"><h2>Versioni</h2>
      <p class="totale" style="margin-top:0">Una versione è un gruppo di cotte con gli stessi malti, luppoli e lievito (sali e acido non contano: cambiano con l'acqua). Tocca una versione per vederne la ricetta.</p>
      <div class="rc-versioni">${r.versioni.map(x => html`<a class="rc-versione ${x === v ? 'attivo' : ''}" href="#/ricetta/${encodeURIComponent(x.rif.id)}">
        <span class="rc-vnum">v${x.numero}</span>
        <span class="rc-vtesto"><b>${x.cotte.length === 1 ? dataIT(x.cotte[0].data) : `${dataIT(x.cotte[0].data)} – ${dataIT(x.cotte[x.cotte.length - 1].data)}`}</b>
          <small>${x.cotte.length} ${x.cotte.length === 1 ? 'cotta' : 'cotte'}: ${x.cotte.map(y => y.lotto || '—').join(', ')}${x.fatte.length < x.cotte.length ? ` (${x.cotte.length - x.fatte.length} pianificat${x.cotte.length - x.fatte.length === 1 ? 'a' : 'e'})` : ''}</small>
          ${x.numero === 1 ? html`<small>Prima versione nell'app</small>`
            : x.cambi.length ? html`<span class="rc-cambi">${x.cambi.map(d => html`<span class="rc-cambio ${d.tipo}">${d.testo}</span>`)}</span>`
              : html`<small>Stessi ingredienti, quantità diverse</small>`}</span>
        ${x === r.vRif ? html`<span class="chip confezionata">Attuale</span>` : ''}
      </a>`)}</div>
    </section>
  `;
  const $nuova = document.getElementById('rc-nuova');
  if ($nuova) $nuova.onclick = () => u.nuovaCotta({ birra: c.birra, copiaDa: c.id, beerfirm: c.beerfirm || '' });
}
