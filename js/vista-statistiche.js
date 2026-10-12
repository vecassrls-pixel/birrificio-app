// Statistiche di produzione: litri prodotti e confezionati, consumi di malti, luppoli, lieviti e zuccheri,
// raggruppati per settimana, mese o anno. Si contano solo le cotte già fatte (data fino a oggi).
// Gli ingredienti con nomi diversi ma collegati allo stesso articolo del magazzino (nome o alias) si sommano.

import { categoriaDa, chiaveNome, converti, lievitoRecuperato, trovaArticolo } from './magazzino.js';

let u; // { $app, html, db, stato, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const filtri = { gruppo: 'mese', anno: '', dettaglio: '', scheda: 'birre', ingr: 'malto' };

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
// settimana ISO (lunedì-domenica): "2026-S41"
function settimanaISO(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const g = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - g + 3); // giovedì della stessa settimana
  const anno = d.getUTCFullYear();
  const primo = new Date(Date.UTC(anno, 0, 4));
  const n = 1 + Math.round((d - primo) / 86400000 / 7 - ((primo.getUTCDay() + 6) % 7 - 3) / 7);
  return `${anno}-S${String(n).padStart(2, '0')}`;
}
const chiavePeriodo = (iso, gruppo) => (gruppo === 'anno' ? iso.slice(0, 4) : gruppo === 'mese' ? iso.slice(0, 7) : settimanaISO(iso));
function nomePeriodo(k) {
  if (/^\d{4}$/.test(k)) return k;
  if (/^\d{4}-\d{2}$/.test(k)) return `${MESI[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
  return `sett. ${Number(k.slice(6))} · ${k.slice(0, 4)}`;
}

// categorie degli ingredienti che si contano, con l'unità in cui si mostrano
export const GRUPPI_INGR = [
  ['malto', 'Malti', 'kg'],
  ['luppolo', 'Luppoli', 'kg'],
  ['lievito', 'Lieviti', 'kg'],
  ['zucchero', 'Zuccheri', 'kg'],
];
const SEZIONI = ['malti', 'luppoli', 'lievito', 'sali'];

// righe elementari: un consumo di ingrediente o un litro prodotto/confezionato, con la sua data
export function movimentiStatistiche(cotte, articoli, oggi) {
  const prodotti = [], confezionati = [], ingredienti = [];
  for (const c of cotte) {
    if (!c.data || c.data > oggi || c.eliminato) continue;
    const birra = c.birra || '—';
    const stile = c.stile || 'senza stile';
    prodotti.push({ data: c.data, litri: Number(c.litri) || 0, birra, stile, id: c.id });
    for (const x of c.confezionato || []) {
      const litri = (Number(x.pezzi) || 0) * (Number(x.litri) || 0);
      if (!litri) continue;
      const data = x.data && x.data <= oggi ? x.data : c.data;
      const formato = `${x.tipo === 'fusto' ? 'Fusti' : x.tipo === 'lattina/bottiglia' ? 'Lattine/bottiglie' : x.tipo || 'Altro'} ${u ? u.numIT(Number(x.litri), 2) : x.litri} L`;
      confezionati.push({ data, litri, pezzi: Number(x.pezzi) || 0, birra, stile, formato });
    }
    for (const sez of SEZIONI) {
      for (const r of c[sez] || []) {
        if (!r.nome || !(Number(r.qta) > 0) || lievitoRecuperato(sez, r)) continue; // il recuperato non è un consumo
        const art = trovaArticolo(articoli, r.nome);
        const cat = art?.categoria || categoriaDa(sez, r.nome);
        if (!GRUPPI_INGR.some(([k]) => k === cat)) continue;
        // tutto in grammi (pesi) o millilitri (liquidi), poi si mostra in kg/g
        const g = converti(r.qta, r.unita || (sez === 'malti' ? 'kg' : 'g'), 'g');
        const ml = g === null ? converti(r.qta, r.unita, 'ml') : null;
        if (g === null && ml === null) continue;
        const nome = art?.nome || chiaveNome(r.nome).replace(/\b\w/g, l => l.toUpperCase()) || r.nome;
        ingredienti.push({ data: c.data, cat, nome, g: g ?? 0, ml: ml ?? 0, id: c.id });
      }
    }
  }
  return { prodotti, confezionati, ingredienti };
}

function somma(lista, chiave, valore) {
  const m = new Map();
  for (const x of lista) {
    const k = chiave(x);
    const v = m.get(k) || { chiave: k, tot: 0, ml: 0, pezzi: 0, cotte: new Set() };
    v.tot += valore(x);
    v.ml += x.ml || 0;
    v.pezzi += x.pezzi || 0;
    if (x.id) v.cotte.add(x.id);
    m.set(k, v);
  }
  return [...m.values()].sort((a, b) => b.tot - a.tot);
}

// elenco cronologico dei periodi da mostrare nel grafico (mesi vuoti compresi se si guarda un anno)
function periodiGrafico(chiavi, gruppo, anno) {
  if (gruppo === 'mese' && anno !== 'tutti') return MESI.map((_, i) => `${anno}-${String(i + 1).padStart(2, '0')}`);
  return [...chiavi].sort();
}
const etichettaBreve = k => (/^\d{4}$/.test(k) ? k : /^\d{4}-\d{2}$/.test(k) ? MESI[Number(k.slice(5)) - 1] : `S${Number(k.slice(6))}`);

export async function vistaStatistiche() {
  const { html, raw } = u;
  const oggi = u.oggiISO();
  const articoli = (await u.db.tutti('articolo')).filter(a => !a.eliminato);
  const tutti = movimentiStatistiche(u.stato.cotte, articoli, oggi);
  const anni = [...new Set(tutti.prodotti.map(p => p.data.slice(0, 4)))].sort().reverse();
  const annoCorrente = oggi.slice(0, 4);
  if (filtri.anno === '') filtri.anno = anni.includes(annoCorrente) ? annoCorrente : anni[0] || 'tutti';
  const nelPeriodo = x => filtri.anno === 'tutti' || x.data.startsWith(filtri.anno);
  const sel = {
    prodotti: tutti.prodotti.filter(nelPeriodo), confezionati: tutti.confezionati.filter(nelPeriodo), ingredienti: tutti.ingredienti.filter(nelPeriodo),
  };

  // andamento per periodo
  const periodi = new Map();
  const riga = k => { if (!periodi.has(k)) periodi.set(k, { k, cotte: 0, prodotti: 0, confezionati: 0, malto: 0, luppolo: 0, lievito: 0, zucchero: 0 }); return periodi.get(k); };
  for (const p of sel.prodotti) { const r = riga(chiavePeriodo(p.data, filtri.gruppo)); r.cotte++; r.prodotti += p.litri; }
  for (const p of sel.confezionati) riga(chiavePeriodo(p.data, filtri.gruppo)).confezionati += p.litri;
  for (const i of sel.ingredienti) riga(chiavePeriodo(i.data, filtri.gruppo))[i.cat] += i.g;
  if (filtri.dettaglio && !periodi.has(filtri.dettaglio)) filtri.dettaglio = '';
  const nelDettaglio = x => !filtri.dettaglio || chiavePeriodo(x.data, filtri.gruppo) === filtri.dettaglio;
  const det = {
    prodotti: sel.prodotti.filter(nelDettaglio), confezionati: sel.confezionati.filter(nelDettaglio), ingredienti: sel.ingredienti.filter(nelDettaglio),
  };
  const andamento = [...periodi.values()].sort((a, b) => b.k.localeCompare(a.k));
  const barre = periodiGrafico(periodi.keys(), filtri.gruppo, filtri.anno).map(k => periodi.get(k) || { k, cotte: 0, prodotti: 0 });
  const maxLitri = Math.max(1, ...barre.map(r => r.prodotti));

  const kg = g => u.numIT(g / 1000, g >= 100000 ? 0 : 1);
  const qtaIngr = (cat, x) => {
    const unita = GRUPPI_INGR.find(([k]) => k === cat)[2];
    const peso = x.tot ? (unita === 'kg' ? `${kg(x.tot)} kg` : `${u.numIT(x.tot, 0)} g`) : '';
    const liquido = x.ml ? `${u.numIT(x.ml / 1000, 2)} L` : '';
    return [peso, liquido].filter(Boolean).join(' + ') || '—';
  };
  const tot = (lista, f) => lista.reduce((t, x) => t + f(x), 0);
  const totIngr = cat => tot(det.ingredienti.filter(i => i.cat === cat), i => i.g);
  const mlIngr = cat => tot(det.ingredienti.filter(i => i.cat === cat), i => i.ml);
  const litriProd = tot(det.prodotti, p => p.litri), litriConf = tot(det.confezionati, p => p.litri);
  const nomeAnno = filtri.anno === 'tutti' ? 'tutti gli anni' : filtri.anno;
  const titoloDet = filtri.dettaglio ? nomePeriodo(filtri.dettaglio) : nomeAnno;

  // confronto con lo stesso periodo dell'anno prima (fino allo stesso giorno, se è l'anno in corso)
  let confronto = null;
  if (filtri.anno !== 'tutti' && !filtri.dettaglio && anni.includes(String(Number(filtri.anno) - 1))) {
    const prima = String(Number(filtri.anno) - 1);
    const limite = filtri.anno === annoCorrente ? `${prima}${oggi.slice(4)}` : `${prima}-12-31`;
    const pp = tutti.prodotti.filter(p => p.data.startsWith(prima) && p.data <= limite);
    confronto = { anno: prima, cotte: pp.length, litri: tot(pp, p => p.litri), finoA: filtri.anno === annoCorrente };
  }
  const delta = (ora, prima) => {
    if (!prima) return '';
    const d = (ora - prima) / prima * 100;
    return html`<span class="delta ${d >= 0 ? 'su' : 'giu'}">${d >= 0 ? '▲' : '▼'} ${u.numIT(Math.abs(d), 0)}%</span>`;
  };

  // tabella con barra della percentuale: righe [{ nome, valore (testo), quota (0-1), extra: [testi] }]
  // la barra è lunga rispetto alla riga più grande, il numero è la quota sul totale; oltre 12 righe si apre a richiesta
  const tabella = (colonne, righe, vuoto) => {
    if (!righe.length) return html`<p class="vuoto">${vuoto}</p>`;
    const max = Math.max(...righe.map(r => r.quota)) || 1;
    const aperta = filtri.tutte === filtri.scheda + filtri.ingr;
    const mostrate = aperta ? righe : righe.slice(0, 12);
    return html`<div class="scroll-x"><table class="tab-mag tab-quote">
      <thead><tr>${colonne.map((c, i) => html`<th class="${i ? 'n' : ''}">${c}</th>`)}<th class="quota">Quota</th></tr></thead>
      <tbody>${mostrate.map(r => html`<tr><td class="nome">${r.nome}</td>${r.celle.map(x => html`<td class="n">${x}</td>`)}
        <td class="quota"><div><span class="quota-barra"><span style="width:${Math.max(1, Math.round(r.quota / max * 100))}%"></span></span><span class="n">${u.numIT(r.quota * 100, 1)}%</span></div></td></tr>`)}</tbody>
    </table></div>
    ${righe.length > 12 ? html`<p style="text-align:center;margin:10px 0 0"><button class="piccolo st-libero" data-tutte="${aperta ? '' : filtri.scheda + filtri.ingr}">${aperta ? 'Mostra solo le prime 12' : `Mostra tutte (${righe.length})`}</button></p>` : ''}`;
  };

  const perChiave = chiave => {
    const prod = somma(det.prodotti, chiave, p => p.litri);
    const conf = new Map(somma(det.confezionati, chiave, p => p.litri).map(x => [x.chiave, x.tot]));
    for (const k of conf.keys()) if (!prod.some(x => x.chiave === k)) prod.push({ chiave: k, tot: 0, cotte: new Set() });
    return tabella(['', 'Cotte', 'Litri prodotti', 'Litri confez.'],
      prod.map(x => ({ nome: x.chiave, quota: litriProd ? x.tot / litriProd : 0, celle: [x.cotte.size || '—', u.numIT(x.tot, 0), conf.has(x.chiave) ? u.numIT(conf.get(x.chiave), 0) : '—'] })),
      'Nessuna cotta in questo periodo.');
  };
  const formati = somma(det.confezionati, p => p.formato, p => p.litri);
  const SCHEDE = [['birre', 'Birre'], ['stili', 'Stili'], ['formati', 'Formati'], ['ingredienti', 'Ingredienti']];
  const pannello = k => {
    if (k === 'birre') return perChiave(p => p.birra);
    if (k === 'stili') return perChiave(p => p.stile);
    if (k === 'formati') return tabella(['Formato', 'Pezzi', 'Litri'],
      formati.map(x => ({ nome: x.chiave, quota: litriConf ? x.tot / litriConf : 0, celle: [u.numIT(x.pezzi, 0), u.numIT(x.tot, 0)] })), 'Niente confezionato in questo periodo.');
    const cat = filtri.ingr;
    const t = totIngr(cat);
    const righe = somma(det.ingredienti.filter(i => i.cat === cat), i => i.nome, i => i.g);
    return html`<div class="segmenti st-libero" id="st-ingr" role="group" aria-label="Tipo di ingrediente">
        ${GRUPPI_INGR.map(([c, n]) => html`<button class="st-libero ${c === cat ? 'attivo' : ''}" data-ingr="${c}" aria-pressed="${c === cat}">${n} <b>${qtaIngr(c, { tot: totIngr(c), ml: mlIngr(c) })}</b></button>`)}
      </div>
      ${tabella(['', 'Cotte', 'Quantità'], righe.map(x => ({ nome: x.chiave, quota: t ? x.tot / t : 0, celle: [x.cotte.size, qtaIngr(cat, x)] })), 'Niente in questo periodo.')}`;
  };

  u.$app.innerHTML = html`
    <div class="barra st-testa">
      <h1 style="margin:0">Statistiche</h1><span class="spazio"></span>
      <button id="stampa" class="st-libero" title="Stampa o salva in PDF">⎙<span class="solo-desktop"> Stampa</span></button>
    </div>
    <div class="filtri-stato st-anni" id="st-anno" role="group" aria-label="Anno">
      ${anni.map(a => html`<button class="st-libero ${a === filtri.anno ? 'attivo' : ''}" data-anno="${a}" aria-pressed="${a === filtri.anno}">${a}</button>`)}
      <button class="st-libero ${filtri.anno === 'tutti' ? 'attivo' : ''}" data-anno="tutti" aria-pressed="${filtri.anno === 'tutti'}">Tutti gli anni</button>
    </div>

    <div class="st-kpi">
      <div class="st-tile"><span>Cotte</span><b>${det.prodotti.length}</b>${confronto ? html`<small>${delta(det.prodotti.length, confronto.cotte)} vs ${confronto.cotte} nel ${confronto.anno}${confronto.finoA ? ' a oggi' : ''}</small>` : ''}</div>
      <div class="st-tile"><span>Litri prodotti</span><b>${u.numIT(litriProd, 0)}</b>${confronto ? html`<small>${delta(litriProd, confronto.litri)} vs ${u.numIT(confronto.litri, 0)} nel ${confronto.anno}</small>` : ''}</div>
      <div class="st-tile"><span>Litri confezionati</span><b>${u.numIT(litriConf, 0)}</b>${litriProd && litriConf ? html`<small>${u.numIT(litriConf / litriProd * 100, 0)}% del prodotto</small>` : html`<small>registrati nelle schede cotta</small>`}</div>
      <div class="st-tile"><span>Malti</span><b>${qtaIngr('malto', { tot: totIngr('malto'), ml: 0 })}</b>${det.prodotti.length ? html`<small>${u.numIT(totIngr('malto') / 1000 / Math.max(1, det.prodotti.length), 0)} kg a cotta</small>` : ''}</div>
      <div class="st-tile"><span>Luppoli</span><b>${qtaIngr('luppolo', { tot: totIngr('luppolo'), ml: mlIngr('luppolo') })}</b>${litriProd ? html`<small>${u.numIT(totIngr('luppolo') / litriProd, 1)} g/L</small>` : ''}</div>
    </div>

    <div class="scheda">
      <div class="barra" style="margin-bottom:6px">
        <h2 style="margin:0">Produzione per ${filtri.gruppo} <span class="totale" style="font-weight:400">· ettolitri</span></h2><span class="spazio"></span>
        <div class="segmenti" id="st-gruppo" role="group" aria-label="Raggruppa per">
          ${[['settimana', 'Settimana'], ['mese', 'Mese'], ['anno', 'Anno']].map(([v, t]) => html`<button class="st-libero ${v === filtri.gruppo ? 'attivo' : ''}" data-gruppo="${v}" aria-pressed="${v === filtri.gruppo}">${t}</button>`)}
        </div>
      </div>
      <p class="totale" style="margin:0 0 10px">Tocca una colonna per vedere solo quel periodo nei dettagli sotto.</p>
      ${andamento.length ? html`<div class="st-grafico ${barre.length > 16 ? 'fitto' : ''} ${filtri.dettaglio ? 'con-scelta' : ''}">
        ${barre.map(r => html`<button class="st-col st-libero ${r.k === filtri.dettaglio ? 'scelto' : ''}" data-periodo="${r.k}" ${r.prodotti ? '' : raw('tabindex="-1"')}
          title="${nomePeriodo(r.k)}: ${u.numIT(r.prodotti, 0)} L, ${r.cotte} cotte">
          <span class="st-val">${r.prodotti ? u.numIT(r.prodotti / 100, 0) : ''}</span>
          <span class="st-barra" style="height:${Math.round(r.prodotti / maxLitri * 100)}%"></span>
          <span class="st-et">${etichettaBreve(r.k)}</span>
        </button>`)}
      </div>
      <details class="st-tabella">
        <summary>Vedi la tabella completa</summary>
        <div class="scroll-x"><table class="tab-mag tab-stat">
          <thead><tr><th>Periodo</th><th class="n">Cotte</th><th class="n">Litri prodotti</th><th class="n">Litri confez.</th><th class="n">Malti kg</th><th class="n">Luppoli kg</th><th class="n">Lieviti kg</th><th class="n">Zuccheri kg</th></tr></thead>
          <tbody>${andamento.map(r => html`<tr data-periodo="${r.k}" class="${r.k === filtri.dettaglio ? 'scelto' : ''}">
            <td>${nomePeriodo(r.k)}</td><td class="n">${r.cotte || '—'}</td><td class="n">${u.numIT(r.prodotti, 0)}</td>
            <td class="n">${r.confezionati ? u.numIT(r.confezionati, 0) : '—'}</td>
            <td class="n">${r.malto ? kg(r.malto) : '—'}</td><td class="n">${r.luppolo ? kg(r.luppolo) : '—'}</td>
            <td class="n">${r.lievito ? kg(r.lievito) : '—'}</td><td class="n">${r.zucchero ? kg(r.zucchero) : '—'}</td>
          </tr>`)}</tbody></table></div>
      </details>` : html`<p class="vuoto">Nessuna cotta in questo periodo.</p>`}
    </div>

    <div class="scheda st-dettagli">
      <div class="barra" style="margin-bottom:10px">
        <h2 style="margin:0">Dettagli · ${titoloDet}</h2>
        ${filtri.dettaglio ? html`<button class="piccolo st-libero filtro-attivo" id="st-tutto" title="Togli il filtro sul periodo">${nomePeriodo(filtri.dettaglio)} ✕</button>` : ''}
      </div>
      <div class="schede-tab" id="st-schede" role="tablist">
        ${SCHEDE.map(([k, t]) => html`<button class="st-libero ${k === filtri.scheda ? 'attivo' : ''}" data-scheda="${k}" role="tab" aria-selected="${k === filtri.scheda}">${t}</button>`)}
      </div>
      ${SCHEDE.map(([k, t]) => html`<div class="pannello ${k === filtri.scheda ? 'attivo' : ''}" data-pannello="${k}"><h3 class="solo-stampa">${t}</h3>${pannello(k)}</div>`)}
    </div>
  `;
  const ridisegna = () => { const y = scrollY; return vistaStatistiche().then(() => scrollTo(0, y)); };
  u.$app.onclick = e => {
    const b = e.target.closest('button, tr[data-periodo]');
    if (!b) return;
    if (b.id === 'stampa') { u.$app.querySelectorAll('details.st-tabella').forEach(d => { d.open = true; }); return window.print(); }
    if (b.id === 'st-tutto') { filtri.dettaglio = ''; return ridisegna(); }
    if (b.dataset.anno) { filtri.anno = b.dataset.anno; filtri.dettaglio = ''; return ridisegna(); }
    if (b.dataset.gruppo) { filtri.gruppo = b.dataset.gruppo; filtri.dettaglio = ''; return ridisegna(); }
    if (b.dataset.periodo) { filtri.dettaglio = filtri.dettaglio === b.dataset.periodo ? '' : b.dataset.periodo; return ridisegna(); }
    if (b.dataset.scheda) { filtri.scheda = b.dataset.scheda; return ridisegna(); }
    if (b.dataset.ingr) { filtri.ingr = b.dataset.ingr; return ridisegna(); }
    if (b.dataset.tutte !== undefined) { filtri.tutte = b.dataset.tutte; return ridisegna(); }
  };
  // il grafico parte dal periodo più recente
  const g = u.$app.querySelector('.st-grafico');
  if (g && !filtri.dettaglio) g.scrollLeft = g.scrollWidth;
}
