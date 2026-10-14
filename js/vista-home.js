// Home: colpo d'occhio sul birrificio. Attività di oggi e domani, birra nei fermentatori e in magazzino,
// malti, materie prime da ordinare e i numeri principali dell'anno. Ogni widget porta alla pagina di dettaglio.

import { giacenze } from './magazzino.js';
import { fabbisogno } from './ordine.js';
import { giacenzeBirra } from './birra.js';
import { ID_IMPOSTAZIONI } from './birra.js';
import { LOGO_KASHMIR } from './logo-kashmir.js';
import {
  SIMBOLI, eventiGiorno, fasiCotta, fineCotta, gruppoCotta, litriConfezionati, lottoGruppo, periodiCotta, statoCotta, travasoCotta,
} from './dominio.js';

let u; // { $app, html, raw, db, stato, dataIT, numIT, oggiISO, addGiorni, diffGiorni, conGiorniDh }
export function init(strumenti) { u = strumenti; }

const NOMI_FASE = { fermentazione: 'Fermentazione', dh: 'Dry hop', maturazione: 'Maturazione' };
const giornoSett = d => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
// il nome del saluto si scrive in Impostazioni e vale per questo dispositivo (ognuno vede il suo)
export const NOME_SALUTO = 'gb-nome-saluto';
// logo in alto nella Home (record condiviso, uguale per tutti): 'gb' Global Brewing, 'kashmir', 'mio' = immagine caricata
export const ID_HOME = 'impostazione-home';
function logoHome(imp) {
  const scelta = imp && !imp.eliminato ? imp.logo : 'gb';
  if (scelta === 'kashmir') return { src: LOGO_KASHMIR, alt: 'Kashmir Brewing Company', bianco: true };
  if (scelta === 'mio' && imp.logoImmagine) return { src: imp.logoImmagine, alt: 'Logo del birrificio', bianco: imp.sfondoBianco !== false };
  return { src: 'img/gb-logo-chiaro.png', alt: 'Global Brewing' };
}
const nomeSaluto = () => { try { return (localStorage.getItem(NOME_SALUTO) || '').trim(); } catch { return ''; } };
const saluto = () => { const h = new Date().getHours(); const n = nomeSaluto(); return `${h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'}${n ? ` ${n}` : ''}`; };

// Cosa c'è da fare in un giorno, per lotto (le cotte doppie una volta sola)
export function attivitaGiorno(cotte, d, { durate, fv, addGiorni, conGiorniDh = g => g[0] }) {
  const out = [];
  const visti = new Set();
  for (const c of cotte) {
    if (c.eliminato || !c.data || visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    const c0 = conGiorniDh(g);
    const fine = fineCotta(g[0], durate);
    if (d < g[0].data || d > fine) continue;
    const nome = g[0].birra;
    const lotto = g.length > 1 ? lottoGruppo(g) : g[0].lotto;
    const base = { id: g[0].id, birra: nome, lotto, fv: g[0].fv };
    if (g.some(x => x.data === d)) out.push({ ...base, tipo: 'cotta', icona: '🍺', testo: `Cotta${g.length > 1 ? ` ${g.length === 2 ? 'doppia' : 'tripla'}` : ''}`, dett: '' });
    const dh = (c0.luppoli || []).filter(r => r.uso === 'dry hop' && Number(r.giorno) > 0 && addGiorni(c0.data, Number(r.giorno) - 1) === d);
    const fasi = fasiCotta(c0, durate);
    if (dh.length) out.push({ ...base, tipo: 'dh', icona: '🌿', testo: 'Dry hop', dett: dh.map(r => `${r.nome}${r.qta ? ` ${u.numIT(r.qta, 1)} ${r.unita || 'g'}` : ''}`).join(', ') });
    else if (fasi.some(f => f.fase === 'dh' && f.da === d && d !== g[0].data)) out.push({ ...base, tipo: 'dh', icona: '🌿', testo: 'Inizio dry hop', dett: '' });
    if (fasi.some(f => f.fase === 'maturazione' && f.da === d)) out.push({ ...base, tipo: 'freddo', icona: '❄️', testo: 'Crash cooling', dett: 'scendere a freddo, inizio maturazione' });
    const t = travasoCotta(g[0], fv);
    if (t?.data === d) out.push({ ...base, tipo: 'travaso', icona: '↪️', testo: 'Travaso', dett: `${g[0].fv} → ${t.fv || 'FV da scegliere'}${t.stimato ? ' (stimato)' : ''}` });
    const ev = (g[0].fermentazione || []).filter(e => e.data === d).flatMap(eventiGiorno);
    for (const k of new Set(ev)) out.push({ ...base, tipo: k, icona: SIMBOLI[k], testo: k === 'spurgo' ? 'Spurgo' : 'Bubbling', dett: '' });
    if (fine === d && !g.some(x => (x.confezionato || []).length)) out.push({ ...base, tipo: 'fine', icona: '📦', testo: 'Ultimo giorno in FV', dett: 'da confezionare' });
  }
  const ordine = ['cotta', 'travaso', 'dh', 'freddo', 'spurgo', 'bubbling', 'fine'];
  return out.sort((a, b) => ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo) || String(a.fv).localeCompare(String(b.fv), 'it', { numeric: true }));
}

export async function vistaHome() {
  const { html, stato, numIT, dataIT, oggiISO, addGiorni, diffGiorni } = u;
  const oggi = oggiISO(), domani = addGiorni(oggi, 1);
  const [articoli, bolle, inventari, scarichi, movimenti, inventariBirra, prodotti, impBirra, impHome] = await Promise.all([
    ...['articolo', 'bolla', 'inventario', 'scarico', 'movbirra', 'inventariobirra', 'prodottobirra'].map(t => u.db.tutti(t)),
    u.db.leggi(ID_IMPOSTAZIONI), u.db.leggi(ID_HOME),
  ]);
  const logo = logoHome(impHome);
  const cotte = stato.cotte;
  const ctx = { durate: stato.durate, fv: stato.fv, addGiorni, conGiorniDh: u.conGiorniDh };

  // materie prime
  const datiMag = { articoli, bolle, inventari, scarichi, cotte };
  const giac = giacenze(datiMag, oggi);
  const malti = [...giac.values()].filter(x => x.articolo.categoria === 'malto' && !x.articolo.eliminato && (x.articolo.unita || 'kg') === 'kg');
  const kgMalti = malti.reduce((t, x) => t + Math.max(0, x.giacenza), 0);
  const kgDi = x => (x.articolo.unita === 'g' ? x.giacenza / 1000 : x.giacenza);
  const luppoli = [...giac.values()].filter(x => x.articolo.categoria === 'luppolo' && ['kg', 'g'].includes(x.articolo.unita || 'kg'));
  const kgLuppoli = luppoli.reduce((t, x) => t + Math.max(0, kgDi(x)), 0);
  const { righe: daOrdinare } = fabbisogno(giac, datiMag, { fino: addGiorni(oggi, 42), anticipo: 7, oggi });
  const urgenti = daOrdinare.filter(r => r.urgente);
  daOrdinare.sort((a, b) => (b.urgente - a.urgente) || String(a.entro).localeCompare(String(b.entro)));

  // birra in magazzino
  const impB = impBirra && !impBirra.eliminato ? impBirra : null;
  const gb = [...giacenzeBirra({ cotte, durate: stato.durate, movimenti, inventari: inventariBirra, prodotti, impostazioni: impB }).values()];
  const litriMag = gb.reduce((t, x) => t + Math.max(0, x.litriTot), 0);
  const pezzi = tipo => gb.filter(x => x.tipo === tipo).reduce((t, x) => t + Math.max(0, x.giacenza), 0);

  // birra nei fermentatori: un periodo per FV oggi (con il travaso la cotta è nel secondo FV)
  const periodi = cotte.filter(c => !c.eliminato).flatMap(c => periodiCotta(c, stato.durate, stato.fv)).filter(p => p.fv && p.da <= oggi && p.a >= oggi);
  const perFv = new Map();
  for (const p of periodi) {
    const lista = perFv.get(p.fv) || [];
    if (!lista.some(x => x.id === p.cotta.id)) lista.push(p.cotta);
    perFv.set(p.fv, lista);
  }
  const fvOccupati = [...perFv].map(([fv, cc]) => {
    const c0 = [...cc].sort((a, b) => a.data.localeCompare(b.data))[0];
    const fase = fasiCotta(u.conGiorniDh(gruppoCotta(c0, cotte)), stato.durate).find(f => f.da <= oggi && f.a >= oggi)?.fase || 'fermentazione';
    const litri = cc.reduce((t, c) => t + (Number(c.litri) || 0), 0);
    return { fv, c0, cc, fase, litri, giorno: diffGiorni(c0.data, oggi) + 1, fine: fineCotta(c0, stato.durate) };
  }).sort((a, b) => a.fv.localeCompare(b.fv, 'it', { numeric: true }));
  const litriFv = fvOccupati.reduce((t, x) => t + x.litri, 0);
  const fvTot = stato.fv.length;

  // numeri dell'anno, confrontati con lo stesso periodo dell'anno scorso
  const anno = Number(oggi.slice(0, 4));
  const fatte = a => cotte.filter(c => !c.eliminato && c.data && c.data.slice(0, 4) === String(a) && c.data.slice(5) <= oggi.slice(5));
  const somma = (cc, f) => cc.reduce((t, c) => t + (Number(f(c)) || 0), 0);
  const quest = fatte(anno), scorso = fatte(anno - 1);
  const stat = [
    { nome: 'Cotte', v: quest.length, prima: scorso.length, unita: '' },
    { nome: 'Litri prodotti', v: somma(quest, c => c.litri), prima: somma(scorso, c => c.litri), unita: 'L' },
    { nome: 'Litri confezionati', v: somma(quest, litriConfezionati), prima: somma(scorso, litriConfezionati), unita: 'L' },
    { nome: 'Birre diverse', v: new Set(quest.map(c => c.birra)).size, prima: new Set(scorso.map(c => c.birra)).size, unita: '' },
  ];
  const prossime = cotte.filter(c => !c.eliminato && c.data > oggi && statoCotta(c, stato.durate, oggi, cotte) === 'pianificata')
    .sort((a, b) => a.data.localeCompare(b.data));
  const prossimeLotti = [];
  for (const c of prossime) if (!prossimeLotti.some(g => g.some(x => x.id === c.id))) prossimeLotti.push(gruppoCotta(c, cotte));
  // etichette da ordinare: cotte pianificate o ancora nei fermentatori senza la spunta "Etichette pronte"
  // (le etichette sono del lotto: basta la spunta su una cotta). Servono per il confezionamento: ordine per fine in FV.
  const senzaEtichette = [];
  for (const c of cotte) {
    if (c.eliminato || !c.data || senzaEtichette.some(x => x.g.some(y => y.id === c.id))) continue;
    if (!['pianificata', 'tank'].includes(statoCotta(c, stato.durate, oggi, cotte))) continue;
    const g = gruppoCotta(c, cotte);
    if (g.some(x => x.etichetteOk)) continue;
    senzaEtichette.push({ g, fine: fineCotta(g[0], stato.durate), inFv: g[0].data <= oggi });
  }
  senzaEtichette.sort((x, y) => x.fine.localeCompare(y.fine));

  const att = [[oggi, 'Oggi'], [domani, 'Domani']].map(([d, titolo]) => ({ d, titolo, voci: attivitaGiorno(cotte, d, ctx) }));
  // DH, travasi e crash cooling previsti nei giorni dopo (fino a una settimana)
  const previste = Array.from({ length: 6 }, (_, i) => addGiorni(oggi, i + 2))
    .map(d => ({ d, voci: attivitaGiorno(cotte, d, ctx).filter(v => ['dh', 'travaso', 'freddo'].includes(v.tipo)) }))
    .filter(x => x.voci.length);
  const L = n => `${numIT(n, 0)} L`;
  const delta = s => {
    if (!s.prima) return '';
    const p = (s.v - s.prima) / s.prima * 100;
    return html`<span class="w-delta ${p >= 0 ? 'su' : 'giu'}" title="Stesso periodo ${anno - 1}: ${numIT(s.prima, 0)}${s.unita ? ` ${s.unita}` : ''}">${p >= 0 ? '▲' : '▼'} ${numIT(Math.abs(p), 0)}%</span>`;
  };
  const fmtOrd = r => `${numIT(r.ordina, r.articolo.unita === 'kg' || r.articolo.unita === 'L' ? 1 : 0)} ${r.articolo.unita || ''}`;

  u.$app.innerHTML = html`
    <section class="home-hero">
      ${logo.bianco ? html`<img class="home-logo su-bianco" src="${logo.src}" alt="${logo.alt}">` : html`<img class="home-logo" src="${logo.src}" alt="${logo.alt}" width="1174" height="240">`}
      <div class="home-ciao"><b>${saluto()}</b><span>${giornoSett(oggi)}</span></div>
      <div class="home-azioni solo-editori">
        <a class="btn" href="#/planning">Planning</a>
        <a class="btn" href="#/bolla/nuova">+ Bolla</a>
        <a class="btn" href="#/movbirra/scarico">− Scarico birra</a>
      </div>
    </section>

    <div class="home-kpi">
      <a class="w-kpi" href="#/planning" style="--w:var(--s-tank)"><span>Nei fermentatori</span><b>${L(litriFv)}</b><small>${fvOccupati.length} FV occupati su ${fvTot}</small></a>
      <a class="w-kpi" href="#/birra" style="--w:var(--s-confezionata)"><span>Birra in magazzino</span><b>${impB ? L(litriMag) : '—'}</b><small>${impB ? `${numIT(pezzi('fusto'), 0)} fusti · ${numIT(pezzi('lattina/bottiglia'), 0)} lattine` : 'magazzino birra non avviato'}</small></a>
      <a class="w-kpi" href="#/materie-prime" style="--w:var(--accent)"><span>Malti in magazzino</span><b>${numIT(kgMalti, 0)} kg</b><small>totale di tutte le varietà</small></a>
      <a class="w-kpi" href="#/materie-prime" style="--w:#65a30d"><span>Luppoli in magazzino</span><b>${numIT(kgLuppoli, 1)} kg</b><small>totale di tutte le varietà</small></a>
      <a class="w-kpi" href="#/ordine" style="--w:${urgenti.length ? 'var(--warn)' : 'var(--s-pianificata)'}"><span>Da ordinare</span><b>${daOrdinare.length}</b><small>${urgenti.length ? `${urgenti.length} da ordinare subito` : 'per le cotte delle prossime 6 settimane'}</small></a>
    </div>

    <div class="home-griglia">
      ${att.map(a => html`<section class="widget w-attivita">
        <header><h2>${a.titolo}</h2><span class="totale">${giornoSett(a.d)}</span></header>
        ${a.voci.length ? html`<ul class="w-lista">${a.voci.map(v => html`<li><a href="#/cotta/${encodeURIComponent(v.id)}">
          <span class="w-ico" aria-hidden="true">${v.icona}</span>
          <span class="w-testo"><b>${v.testo}</b> · ${v.birra} <span class="totale">${v.lotto || ''}${v.fv && v.tipo !== 'travaso' ? ` · ${v.fv}` : ''}</span>${v.dett ? html`<small>${v.dett}</small>` : ''}</span></a></li>`)}</ul>`
          : html`<p class="w-vuoto">Niente in programma.</p>`}
      </section>`)}

      <section class="widget w-previste">
        <header><h2>In arrivo</h2><span class="totale">DH, travasi e crash cooling</span></header>
        ${previste.length ? html`<ul class="w-lista">${previste.flatMap(x => x.voci.map(v => html`<li><a href="#/cotta/${encodeURIComponent(v.id)}">
          <span class="w-data"><b>${new Date(`${x.d}T12:00:00`).getDate()}</b>${new Date(`${x.d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short' })}</span>
          <span class="w-ico" aria-hidden="true">${v.icona}</span>
          <span class="w-testo"><b>${v.testo}</b> · ${v.birra} <span class="totale">${v.lotto || ''}${v.fv && v.tipo !== 'travaso' ? ` · ${v.fv}` : ''}</span>${v.dett ? html`<small>${v.dett}</small>` : ''}</span></a></li>`))}</ul>`
          : html`<p class="w-vuoto">Niente nei prossimi 7 giorni.</p>`}
      </section>

      <section class="widget w-fv">
        <header><h2>Fermentatori</h2><a class="totale" href="#/planning">Planning →</a></header>
        ${fvOccupati.length ? html`<ul class="w-lista">${fvOccupati.map(x => html`<li><a href="#/cotta/${encodeURIComponent(x.c0.id)}">
          <span class="w-fvnome">${x.fv}</span>
          <span class="w-testo"><b>${x.c0.birra}</b> <span class="totale">${x.cc.length > 1 ? lottoGruppo(x.cc) : x.c0.lotto}</span>
            <small><span class="w-fase" style="--f:var(--f-${x.fase})"></span>${NOMI_FASE[x.fase]} · giorno ${x.giorno} · fino al ${dataIT(x.fine)}</small></span>
          <span class="w-num">${x.litri ? L(x.litri) : ''}</span></a></li>`)}</ul>`
          : html`<p class="w-vuoto">Tutti i fermentatori sono liberi.</p>`}
      </section>

      <section class="widget w-ordine">
        <header><h2>Materie prime da ordinare</h2><a class="totale" href="#/ordine">Tutto →</a></header>
        ${daOrdinare.length ? html`<ul class="w-lista">${daOrdinare.slice(0, 6).map(r => html`<li><a href="#/materia/${encodeURIComponent(r.articolo.id)}">
          <span class="w-testo"><b>${r.articolo.nome}</b><small>${r.fornitore || 'fornitore non indicato'}</small></span>
          <span class="w-num">${fmtOrd(r)}<small class="${r.urgente ? 'w-urgente' : ''}">${r.urgente ? 'subito' : `entro ${dataIT(r.entro)}`}</small></span></a></li>`)}</ul>
          ${daOrdinare.length > 6 ? html`<p class="totale">e altri ${daOrdinare.length - 6}…</p>` : ''}`
          : html`<p class="w-vuoto">✓ Niente da ordinare per le cotte delle prossime 6 settimane.</p>`}
      </section>

      <section class="widget w-stat">
        <header><h2>${anno} fino a oggi</h2><a class="totale" href="#/statistiche">Statistiche →</a></header>
        <div class="w-statgriglia">${stat.map(s => html`<div><span>${s.nome}</span><b>${numIT(s.v, 0)}${s.unita ? ` ${s.unita}` : ''}</b>${delta(s)}</div>`)}</div>
        <p class="totale" style="margin-bottom:0">Confronto con lo stesso periodo del ${anno - 1}.</p>
      </section>

      <section class="widget w-etichette">
        <header><h2>${SIMBOLI.etichette} Etichette da ordinare</h2><span class="totale">${senzaEtichette.length ? `${senzaEtichette.length} cotte` : ''}</span></header>
        ${senzaEtichette.length ? html`<ul class="w-lista">${senzaEtichette.slice(0, 8).map(({ g, fine, inFv }) => { const gg = diffGiorni(oggi, fine); return html`<li><a href="#/cotta/${encodeURIComponent(g[0].id)}">
          <span class="w-data"><b>${new Date(`${fine}T12:00:00`).getDate()}</b>${new Date(`${fine}T12:00:00`).toLocaleDateString('it-IT', { month: 'short' })}</span>
          <span class="w-testo"><b>${g[0].birra}</b> <span class="totale">${g.length > 1 ? lottoGruppo(g) : g[0].lotto}${g[0].fv ? ` · ${g[0].fv}` : ''}</span><small>${inFv ? 'nel fermentatore' : `cotta il ${dataIT(g[0].data)}`} · da confezionare ${gg <= 0 ? 'ora' : `tra ${gg} gg`}</small></span>
          <span class="w-num ${gg <= 14 ? 'w-urgente' : ''}">${gg <= 14 ? 'urgente' : ''}</span></a></li>`; })}</ul>
          ${senzaEtichette.length > 8 ? html`<p class="totale">e altre ${senzaEtichette.length - 8}…</p>` : ''}
          <p class="totale" style="margin-bottom:0">Quando le hai, spunta "Etichette pronte" nella cotta.</p>`
          : html`<p class="w-vuoto">✓ Etichette pronte per tutte le cotte pianificate.</p>`}
      </section>

      <section class="widget w-prossime">
        <header><h2>Prossime cotte</h2><a class="totale" href="#/planning">Planning →</a></header>
        ${prossimeLotti.length ? html`<ul class="w-lista">${prossimeLotti.slice(0, 5).map(g => html`<li><a href="#/cotta/${encodeURIComponent(g[0].id)}">
          <span class="w-data"><b>${new Date(`${g[0].data}T12:00:00`).getDate()}</b>${new Date(`${g[0].data}T12:00:00`).toLocaleDateString('it-IT', { month: 'short' })}</span>
          <span class="w-testo"><b>${g[0].birra}</b> <span class="totale">${g.length > 1 ? lottoGruppo(g) : g[0].lotto}${g[0].fv ? ` · ${g[0].fv}` : ''}</span>
            <small>${[g.every(x => x.materiePrime) ? '✓ materie prime' : 'materie prime da ordinare', g.every(x => x.lievitoOk) ? `${SIMBOLI.lievito} lievito ok` : '', g.some(x => x.etichetteOk) ? `${SIMBOLI.etichette} etichette ok` : ''].filter(Boolean).join(' · ')}</small></span>
          <span class="w-num">tra ${diffGiorni(oggi, g[0].data)} gg</span></a></li>`)}</ul>`
          : html`<p class="w-vuoto">Nessuna cotta pianificata.</p>`}
      </section>
    </div>`;
}
