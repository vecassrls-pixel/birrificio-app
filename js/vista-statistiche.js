// Statistiche di produzione: litri prodotti e confezionati, consumi di malti, luppoli, lieviti e zuccheri,
// raggruppati per settimana, mese o anno. Si contano solo le cotte già fatte (data fino a oggi).
// Gli ingredienti con nomi diversi ma collegati allo stesso articolo del magazzino (nome o alias) si sommano.

import { categoriaDa, chiaveNome, converti, lievitoRecuperato, trovaArticolo } from './magazzino.js';

let u; // { $app, html, db, stato, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const filtri = { gruppo: 'mese', anno: '', dettaglio: '' };

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

export async function vistaStatistiche() {
  const { html } = u;
  const oggi = u.oggiISO();
  const articoli = (await u.db.tutti('articolo')).filter(a => !a.eliminato);
  const tutti = movimentiStatistiche(u.stato.cotte, articoli, oggi);
  const anni = [...new Set(tutti.prodotti.map(p => p.data.slice(0, 4)))].sort().reverse();
  const annoCorrente = oggi.slice(0, 4);
  if (filtri.anno === '') filtri.anno = annoCorrente;
  const nelPeriodo = x => filtri.anno === 'tutti' || x.data.startsWith(filtri.anno);
  const nelDettaglio = x => nelPeriodo(x) && (!filtri.dettaglio || chiavePeriodo(x.data, filtri.gruppo) === filtri.dettaglio);
  const sel = {
    prodotti: tutti.prodotti.filter(nelPeriodo), confezionati: tutti.confezionati.filter(nelPeriodo), ingredienti: tutti.ingredienti.filter(nelPeriodo),
  };
  const det = {
    prodotti: tutti.prodotti.filter(nelDettaglio), confezionati: tutti.confezionati.filter(nelDettaglio), ingredienti: tutti.ingredienti.filter(nelDettaglio),
  };

  // andamento per periodo
  const periodi = new Map();
  const riga = k => { if (!periodi.has(k)) periodi.set(k, { k, cotte: 0, prodotti: 0, confezionati: 0, malto: 0, luppolo: 0, lievito: 0, zucchero: 0 }); return periodi.get(k); };
  for (const p of sel.prodotti) { const r = riga(chiavePeriodo(p.data, filtri.gruppo)); r.cotte++; r.prodotti += p.litri; }
  for (const p of sel.confezionati) riga(chiavePeriodo(p.data, filtri.gruppo)).confezionati += p.litri;
  for (const i of sel.ingredienti) riga(chiavePeriodo(i.data, filtri.gruppo))[i.cat] += i.g;
  const andamento = [...periodi.values()].sort((a, b) => b.k.localeCompare(a.k));
  const maxLitri = Math.max(1, ...andamento.map(r => r.prodotti));
  if (filtri.dettaglio && !periodi.has(filtri.dettaglio)) filtri.dettaglio = '';

  const kg = g => u.numIT(g / 1000, g >= 100000 ? 0 : 1);
  const qtaIngr = (cat, x) => {
    const unita = GRUPPI_INGR.find(([k]) => k === cat)[2];
    const peso = x.tot ? (unita === 'kg' ? `${kg(x.tot)} kg` : `${u.numIT(x.tot, 0)} g`) : '';
    const liquido = x.ml ? `${u.numIT(x.ml / 1000, 2)} L` : '';
    return [peso, liquido].filter(Boolean).join(' + ') || '—';
  };
  const tot = (lista, f) => lista.reduce((t, x) => t + f(x), 0);
  const totIngr = cat => tot(det.ingredienti.filter(i => i.cat === cat), i => i.g);
  const litriProd = tot(det.prodotti, p => p.litri), litriConf = tot(det.confezionati, p => p.litri);
  const titoloDet = filtri.dettaglio ? nomePeriodo(filtri.dettaglio) : filtri.anno === 'tutti' ? 'tutti gli anni' : filtri.anno;

  const tabBirre = (titolo, chiave) => {
    const prod = somma(det.prodotti, chiave, p => p.litri);
    const conf = new Map(somma(det.confezionati, chiave, p => p.litri).map(x => [x.chiave, x.tot]));
    for (const k of conf.keys()) if (!prod.some(x => x.chiave === k)) prod.push({ chiave: k, tot: 0, cotte: new Set() });
    return html`<div class="scheda"><h2>${titolo}</h2>${prod.length ? html`<div class="scroll-x"><table class="tab-mag">
      <thead><tr><th></th><th class="n">Cotte</th><th class="n">Litri prodotti</th><th class="n">Litri confezionati</th><th class="n">% del totale</th></tr></thead>
      <tbody>${prod.map(x => html`<tr><td>${x.chiave}</td><td class="n">${x.cotte.size || '—'}</td><td class="n">${u.numIT(x.tot, 0)}</td>
        <td class="n">${conf.has(x.chiave) ? u.numIT(conf.get(x.chiave), 0) : '—'}</td><td class="n">${litriProd ? `${u.numIT(x.tot / litriProd * 100, 1)}%` : '—'}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="totale">Nessuna cotta in questo periodo.</p>`}</div>`;
  };
  const tabIngr = (cat, titolo) => {
    const righe = somma(det.ingredienti.filter(i => i.cat === cat), i => i.nome, i => i.g);
    const t = totIngr(cat);
    return html`<div class="scheda"><h2>${titolo} <span class="totale" style="font-weight:400">· totale ${qtaIngr(cat, { tot: t, ml: tot(det.ingredienti.filter(i => i.cat === cat), i => i.ml) })}</span></h2>
      ${righe.length ? html`<div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Tipo</th><th class="n">Cotte</th><th class="n">Quantità</th><th class="n">% del totale</th></tr></thead>
        <tbody>${righe.map(x => html`<tr><td>${x.chiave}</td><td class="n">${x.cotte.size}</td><td class="n">${qtaIngr(cat, x)}</td>
          <td class="n">${t && x.tot ? `${u.numIT(x.tot / t * 100, 1)}%` : '—'}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="totale">Niente in questo periodo.</p>`}</div>`;
  };
  const formati = somma(det.confezionati, p => p.formato, p => p.litri);

  u.$app.innerHTML = html`
    <div class="barra">
      <h1 style="margin:0">Statistiche</h1><span class="spazio"></span>
      <label class="in-linea">Raggruppa per <select id="st-gruppo">
        ${[['settimana', 'settimana'], ['mese', 'mese'], ['anno', 'anno']].map(([v, t]) => html`<option value="${v}" ${v === filtri.gruppo ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="in-linea">Periodo <select id="st-anno">
        ${anni.map(a => html`<option value="${a}" ${a === filtri.anno ? 'selected' : ''}>${a === annoCorrente ? `${a} (anno corrente)` : a}</option>`)}
        <option value="tutti" ${filtri.anno === 'tutti' ? 'selected' : ''}>Tutti gli anni</option></select></label>
      <button id="stampa">Stampa</button>
    </div>

    <div class="scheda">
      <h2>Totali · ${titoloDet}${filtri.dettaglio ? html` <button class="piccolo" id="st-tutto">Mostra tutto il periodo</button>` : ''}</h2>
      <div class="kpi">
        <div><b>${det.prodotti.length}</b>cotte</div>
        <div><b>${u.numIT(litriProd, 0)} L</b>prodotti</div>
        <div><b>${u.numIT(litriConf, 0)} L</b>confezionati</div>
        ${GRUPPI_INGR.map(([k, t]) => html`<div><b>${qtaIngr(k, { tot: totIngr(k), ml: tot(det.ingredienti.filter(i => i.cat === k), i => i.ml) })}</b>${t.toLowerCase()}</div>`)}
      </div>
    </div>

    <div class="scheda">
      <h2>Andamento per ${filtri.gruppo}</h2>
      <p class="totale">Tocca una riga per vedere il dettaglio di quel periodo qui sotto.</p>
      ${andamento.length ? html`<div class="scroll-x"><table class="tab-mag tab-stat">
        <thead><tr><th>Periodo</th><th class="n">Cotte</th><th class="n">Litri prodotti</th><th></th><th class="n">Litri confez.</th><th class="n">Malti kg</th><th class="n">Luppoli kg</th><th class="n">Lieviti kg</th><th class="n">Zuccheri kg</th></tr></thead>
        <tbody>${andamento.map(r => html`<tr data-periodo="${r.k}" class="${r.k === filtri.dettaglio ? 'scelto' : ''}">
          <td>${nomePeriodo(r.k)}</td><td class="n">${r.cotte || '—'}</td><td class="n">${u.numIT(r.prodotti, 0)}</td>
          <td style="width:30%"><span class="barra-stat" style="width:${Math.round(r.prodotti / maxLitri * 100)}%"></span></td>
          <td class="n">${r.confezionati ? u.numIT(r.confezionati, 0) : '—'}</td>
          <td class="n">${r.malto ? kg(r.malto) : '—'}</td><td class="n">${r.luppolo ? kg(r.luppolo) : '—'}</td>
          <td class="n">${r.lievito ? kg(r.lievito) : '—'}</td><td class="n">${r.zucchero ? kg(r.zucchero) : '—'}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="totale">Nessuna cotta in questo periodo.</p>`}
    </div>

    ${tabBirre(`Per birra · ${titoloDet}`, p => p.birra)}
    ${tabBirre(`Per stile · ${titoloDet}`, p => p.stile)}
    <div class="scheda"><h2>Confezionato per formato · ${titoloDet}</h2>
      ${formati.length ? html`<div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Formato</th><th class="n">Pezzi</th><th class="n">Litri</th><th class="n">% del totale</th></tr></thead>
        <tbody>${formati.map(x => html`<tr><td>${x.chiave}</td><td class="n">${u.numIT(x.pezzi, 0)}</td><td class="n">${u.numIT(x.tot, 0)}</td>
          <td class="n">${litriConf ? `${u.numIT(x.tot / litriConf * 100, 1)}%` : '—'}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="totale">Niente confezionato in questo periodo.</p>`}</div>
    ${GRUPPI_INGR.map(([k, t]) => tabIngr(k, `${t} · ${titoloDet}`))}
  `;
  const $ = id => document.getElementById(id);
  $('st-gruppo').onchange = e => { filtri.gruppo = e.target.value; filtri.dettaglio = ''; vistaStatistiche(); };
  $('st-anno').onchange = e => { filtri.anno = e.target.value; filtri.dettaglio = ''; vistaStatistiche(); };
  $('stampa').onclick = () => window.print();
  const tutto = $('st-tutto');
  if (tutto) tutto.onclick = () => { filtri.dettaglio = ''; vistaStatistiche(); };
  u.$app.querySelectorAll('tr[data-periodo]').forEach(tr => {
    tr.onclick = () => {
      filtri.dettaglio = filtri.dettaglio === tr.dataset.periodo ? '' : tr.dataset.periodo;
      const y = scrollY;
      vistaStatistiche().then(() => scrollTo(0, y));
    };
  });
}
