import * as db from './db.js';
import * as sync from './sync.js';
import * as bf from './brewfather.js';
import * as auth from './auth.js';
import { creaXlsx } from './xlsx.js';
import { litriATacca, prelievo, taccaFinale, ALTEZZA_MAX } from './serbatoio.js';
import {
  STATI, abv, addGiorni, conflitti, copiaDa, dataIT, daISO, diffGiorni, durateTipiche, fineCotta,
  CAMPI_COMUNI, conAdditiviDefault, ogMedia, DURATA_DEFAULT, FASI, fasiCotta, gruppoCotta, lottoGruppo, registroComune, fvLiberi, litriConfezionati, profiloDefault, periodiCotta, travasoCotta, lottoDi, nomeBirra, numIT, oggiISO, prossimoNumero, statoCotta,
} from './dominio.js';

const $app = document.getElementById('app');

// ---------- utilità HTML ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Raw(s);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.s : esc(x))).join('');
    else out += v instanceof Raw ? v.s : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

// conferma dentro la pagina (confirm() non è disponibile ovunque)
function chiedi(msg, ok = 'Conferma') {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = html`<form method="dialog"><p>${msg}</p><div class="barra"><span class="spazio"></span>
      <button value="no">Annulla</button><button class="primario" value="si">${ok}</button></div></form>`.s;
    document.body.appendChild(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'si'); d.remove(); });
    d.showModal();
  });
}

// ---------- dati in memoria ----------
const stato = { cotte: [], fv: [], durate: new Map() };
async function carica() {
  stato.cotte = await db.tutti('cotta');
  stato.fv = (await db.tutti('fv')).sort((a, b) => a.nome.localeCompare(b.nome, 'it', { numeric: true }));
  stato.durate = durateTipiche(stato.cotte);
}
const birreNote = () => [...new Set(stato.cotte.map(c => nomeBirra(c.birra)).filter(Boolean))].sort();
// Stile: quello già usato per la stessa birra, e la lista per i suggerimenti
const STILI_COMUNI = ['American IPA', 'Double IPA', 'New England IPA', 'American Pale Ale', 'Session IPA', 'Pilsner', 'Helles', 'Lager',
  'Blanche', 'Weizen', 'Saison', 'Belgian Blonde', 'Belgian Dubbel', 'Belgian Tripel', 'Belgian Strong Dark Ale', 'Stout', 'Imperial Stout',
  'Porter', 'Red Ale', 'Amber Ale', 'Bitter', 'Sour', 'Barley Wine'];
const stileDi = birra => stato.cotte
  .filter(c => c.stile && nomeBirra(c.birra) === nomeBirra(birra))
  .sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0]?.stile || '';
const stiliNoti = () => [...new Set([...stato.cotte.map(c => c.stile).filter(Boolean), ...STILI_COMUNI])].sort((a, b) => a.localeCompare(b));
const ultimaCottaDi = birra => stato.cotte
  .filter(c => nomeBirra(c.birra) === nomeBirra(birra) && (c.malti || []).length)
  .sort((a, b) => b.data.localeCompare(a.data))[0];

// ---------- primo avvio ----------
// Aggiorna le cotte già importate con i campi aggiunti in seguito allo storico (tacche del serbatoio).
async function aggiornaStorico() {
  if ((await db.meta('versioneStorico')) >= 2) return;
  const { cotte } = await (await fetch('data/storico.json')).json();
  const perId = new Map(cotte.map(c => [c.id, c]));
  const da = [];
  for (const c of await db.tutti('cotta')) {
    const s = perId.get(c.id);
    if (!s || c.acquaMash?.taccaInizio != null) continue;
    da.push({
      ...c,
      acquaMash: { ...s.acquaMash, ...c.acquaMash, taccaInizio: s.acquaMash.taccaInizio ?? null, taccaFine: s.acquaMash.taccaFine ?? null },
      acquaSparge: { ...s.acquaSparge, ...c.acquaSparge, taccaFine: s.acquaSparge.taccaFine ?? null },
    });
  }
  if (da.length) await db.salvaMolti(da.map(({ aggiornato, ...r }) => r));
  await db.meta('versioneStorico', 2);
}

async function primoAvvio() {
  // con il cloud: cotte e fermentatori arrivano dal database, niente dati di partenza locali
  if (auth.configurato()) { await db.meta('inizializzato', true); return; }
  if (await db.meta('inizializzato')) { try { await aggiornaStorico(); } catch { /* offline */ } return; }
  const fvs = Array.from({ length: 10 }, (_, i) => ({ id: `fv-FV${i + 1}`, tipo: 'fv', nome: `FV${i + 1}`, capacita: null, isobarico: i !== 5 && i !== 6 }));
  await db.salvaMolti(fvs);
  try {
    await importaStorico({ silenzioso: true });
    await db.meta('versioneStorico', 2);
  } catch { /* offline al primo avvio: si può importare da Impostazioni */ }
  await db.meta('inizializzato', true);
}

async function importaStorico({ silenzioso = false } = {}) {
  const res = await fetch('data/storico.json');
  const { cotte } = await res.json();
  const esistenti = new Set((await db.tutti('cotta', { ancheEliminati: true })).map(c => c.id));
  const nuove = cotte.filter(c => !esistenti.has(c.id)).map(({ stato: _s, ...c }) => c);
  await db.salvaMolti(nuove);
  if (!silenzioso) toast(`${nuove.length} cotte importate`);
}

// ---------- router ----------
const routes = [
  [/^#\/cotte$/, vistaCotte],
  [/^#\/cotta\/(.+)$/, vistaCotta],
  [/^#\/planning$/, vistaPlanning],
  [/^#\/impostazioni$/, vistaImpostazioni],
];
let pulizia = null;
async function render() {
  const h = location.hash || '#/cotte';
  if (h.includes('access_token=')) return; // link di invito: gestito all'avvio
  if (pulizia) { pulizia(); pulizia = null; }
  $app.classList.toggle('largo', h.startsWith('#/planning')); // il planning usa tutta la larghezza
  document.querySelectorAll('.top nav a').forEach(a => a.classList.toggle('attivo', h.startsWith('#/' + a.dataset.tab) || (a.dataset.tab === 'cotte' && h.startsWith('#/cotta/'))));
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) return fn(...m.slice(1).map(decodeURIComponent));
  }
  location.hash = '#/cotte';
}
window.addEventListener('hashchange', render);

// ---------- Lista cotte ----------
const filtri = { q: '', anno: '', stato: '', limite: 60 };

function vistaCotte() {
  const anni = [...new Set(stato.cotte.map(c => c.anno).filter(Boolean))].sort((a, b) => b - a);
  const q = filtri.q.trim().toLowerCase();
  const lista = stato.cotte
    .map(c => ({ c, s: statoCotta(c, stato.durate) }))
    .filter(({ c, s }) =>
      (!q || `${c.birra} ${c.lotto} ${c.fv}`.toLowerCase().includes(q)) &&
      (!filtri.anno || String(c.anno) === filtri.anno) &&
      (!filtri.stato || s === filtri.stato))
    .sort((a, b) => (b.c.data || '').localeCompare(a.c.data || '') || (b.c.numero || 0) - (a.c.numero || 0));

  const inTank = stato.cotte.filter(c => statoCotta(c, stato.durate) === 'tank').length;
  const prossime = stato.cotte.filter(c => statoCotta(c, stato.durate) === 'pianificata').length;

  // cotte doppie/triple: lotto del gruppo (51/52)
  const lotti = new Map();
  for (const { c } of lista.slice(0, filtri.limite)) {
    const g = gruppoCotta(c, stato.cotte);
    if (g.length > 1) lotti.set(c.id, lottoGruppo(g));
  }
  $app.innerHTML = html`
    <div class="barra">
      <div><h1>Cotte</h1><div class="kpi">
        <div><b>${inTank}</b>in fermentatore</div>
        <div><b>${prossime}</b>pianificate</div>
        <div><b>${stato.cotte.length}</b>totali</div>
      </div></div>
      <span class="spazio"></span>
      <button class="primario" id="nuova">+ Nuova cotta</button>
    </div>
    <div class="barra">
      <input id="q" type="search" placeholder="Cerca birra, lotto, FV…" value="${filtri.q}" style="flex:2;min-width:180px">
      <select id="anno" style="flex:1;min-width:110px"><option value="">Tutti gli anni</option>
        ${anni.map(a => html`<option ${String(a) === filtri.anno ? 'selected' : ''}>${a}</option>`)}</select>
      <select id="stato" style="flex:1;min-width:140px"><option value="">Tutti gli stati</option>
        ${Object.entries(STATI).map(([k, v]) => html`<option value="${k}" ${k === filtri.stato ? 'selected' : ''}>${v}</option>`)}</select>
    </div>
    <div class="lista">
      ${lista.length ? lista.slice(0, filtri.limite).map(({ c, s }) => html`
        <a class="riga-cotta" href="#/cotta/${encodeURIComponent(c.id)}">
          <span class="lotto">${c.lotto || '—'}${lotti.has(c.id) ? html`<br><small class="totale">${lotti.get(c.id)}</small>` : ''}</span>
          <span class="birra">${c.birra || 'Senza nome'}${s === 'pianificata' && c.materiePrime ? html` <span class="mp" title="Materie prime ordinate o in magazzino">MP ✓</span>` : ''}</span>
          <span class="chip ${s}">${STATI[s]}</span>
          <span class="dett">${dataIT(c.data)}${c.stile ? ` · ${c.stile}` : ''} · ${c.fv || 'FV ?'}${c.litri ? ` · ${numIT(c.litri, 0)} L` : ''}${c.og ? ` · OG ${numIT(c.og)} °P` : ''}</span>
        </a>`) : html`<p class="vuoto">Nessuna cotta trovata.</p>`}
    </div>
    ${lista.length > filtri.limite ? html`<p style="text-align:center"><button id="altre">Mostra altre (${lista.length - filtri.limite})</button></p>` : ''}
  `;
  const q$ = document.getElementById('q');
  q$.addEventListener('input', () => { filtri.q = q$.value; filtri.limite = 60; vistaCotte(); document.getElementById('q').focus(); document.getElementById('q').setSelectionRange(filtri.q.length, filtri.q.length); });
  document.getElementById('anno').onchange = e => { filtri.anno = e.target.value; vistaCotte(); };
  document.getElementById('stato').onchange = e => { filtri.stato = e.target.value; vistaCotte(); };
  document.getElementById('nuova').onclick = () => dialogNuovaCotta();
  const altre = document.getElementById('altre');
  if (altre) altre.onclick = () => { filtri.limite += 100; vistaCotte(); };
}

// ---------- Dialog: nuova / pianifica cotta ----------
function dialogNuovaCotta(pre = {}) {
  const anno = new Date().getFullYear();
  const dlg = document.createElement('dialog');
  const birre = birreNote();
  dlg.innerHTML = html`
    <form method="dialog">
      <h2>${pre.titolo || 'Nuova cotta'}</h2>
      <div class="griglia" style="grid-template-columns:1fr 1fr">
        <label style="grid-column:1/-1">Birra <input name="birra" list="dl-birre" required value="${pre.birra || ''}" autocomplete="off"></label>
        <label>Data cotta <input name="data" type="date" required value="${pre.data || oggiISO()}"></label>
        <label>Giorni in FV <input name="durata" type="number" min="1" max="120"></label>
        <label>Lotto n° <input name="numero" type="number" min="1" value="${prossimoNumero(stato.cotte, anno)}"></label>
        <label>Anno <input name="anno" type="number" value="${anno}"></label>
      </div>
      <h3>Fermentatore</h3>
      <div id="fv-scelta" class="griglia" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div>
      <label style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="copia" checked style="width:auto;min-height:auto"> Copia ricetta e profilo dall'ultima cotta della stessa birra</label>
      <label style="margin-top:6px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="materiePrime" style="width:auto;min-height:auto"> Materie prime ordinate o in magazzino</label>
      <p id="origine" class="totale"></p>
      <div class="barra" style="margin-top:14px"><span class="spazio"></span>
        <button value="annulla" formnovalidate>Annulla</button>
        <button class="primario" value="ok">Crea cotta</button>
      </div>
    </form>
    <datalist id="dl-birre">${birre.map(b => html`<option value="${b}">`)}</datalist>`;
  document.body.appendChild(dlg);
  const f = dlg.querySelector('form');
  const aggiornaFv = () => {
    const birra = f.birra.value;
    // durata: quella del profilo che verrà copiato, altrimenti 34 giorni (fermentazione, DH, freddo)
    const src0 = f.copia.checked ? ultimaCottaDi(birra) : null;
    const durata = Number(f.durata.value) || (src0?.fermentazione?.length) || DURATA_DEFAULT;
    if (!f.durata.value || f.durata.dataset.auto) { f.durata.value = durata; f.durata.dataset.auto = '1'; }
    const da = f.data.value || oggiISO();
    const a = addGiorni(da, durata - 1);
    const scelto = f.querySelector('input[name=fv]:checked')?.value || pre.fv;
    const righe = fvLiberi(stato.fv, stato.cotte, da, a, stato.durate);
    let primoLibero = null;
    dlg.querySelector('#fv-scelta').innerHTML = righe.map(({ fv, occupatoDa }) => {
      const libero = !occupatoDa.length;
      if (libero && !primoLibero) primoLibero = fv.nome;
      return html`<label style="display:flex;gap:6px;align-items:center;font-size:.9rem;color:var(--text)">
        <input type="radio" name="fv" value="${fv.nome}" style="width:auto;min-height:auto">
        <span><b>${fv.nome}</b> ${libero ? html`<span class="fv-libero">libero</span>` : html`<span class="fv-occupato">${[...new Set(occupatoDa.map(p => `${p.cotta.birra} fino al ${dataIT(p.a, { day: '2-digit', month: '2-digit' })}${p.cotta.fv === fv.nome && p.a < fineCotta(p.cotta, stato.durate) ? ' (travaso)' : ''}`))].join(', ')}</span>`}</span>
      </label>`.s;
    }).join('');
    const target = scelto || primoLibero;
    const r = dlg.querySelector(`input[name=fv][value="${target}"]`);
    if (r) r.checked = true;
    const src = ultimaCottaDi(birra);
    dlg.querySelector('#origine').textContent = src ? `Ultima cotta di ${nomeBirra(birra)}: lotto ${src.lotto} del ${dataIT(src.data)}` : (birra ? 'Nessuna cotta precedente con ricetta per questa birra.' : '');
  };
  f.durata.addEventListener('input', () => { delete f.durata.dataset.auto; aggiornaFv(); });
  f.birra.addEventListener('change', () => { f.durata.dataset.auto = '1'; f.durata.value = ''; aggiornaFv(); });
  f.data.addEventListener('change', aggiornaFv);
  f.copia.addEventListener('change', () => { if (f.durata.dataset.auto) f.durata.value = ''; aggiornaFv(); });
  aggiornaFv();
  dlg.addEventListener('close', async () => {
    dlg.remove();
    if (dlg.returnValue !== 'ok') return;
    const fd = new FormData(f);
    const numero = Number(fd.get('numero')), annoC = Number(fd.get('anno'));
    const data = fd.get('data'), fv = fd.get('fv') || '';
    const birra = nomeBirra(fd.get('birra'));
    const src = fd.get('copia') ? ultimaCottaDi(birra) : null;
    const base = src ? copiaDa(src, { data, numero, anno: annoC, fv }) : {
      tipo: 'cotta', birra, numero, anno: annoC, lotto: lottoDi(numero, annoC), data, fv,
      og: null, fg: null, phMash: null, litri: null, sali: conAdditiviDefault(), malti: [], luppoli: [], lievito: [],
      acquaMash: {}, acquaSparge: {}, fermentazione: [], confezionato: [], note: '',
    };
    const durata = Number(fd.get('durata'));
    if (!base.fermentazione.length) base.fermentazione = profiloDefault(data);
    if (durata && durata !== base.fermentazione.length) base.fine = addGiorni(data, durata - 1);
    if (fd.get('materiePrime')) base.materiePrime = true;
    if (!base.stile && stileDi(birra)) base.stile = stileDi(birra);
    const rec = await db.salva({ ...base, birra, id: db.nuovoId('cotta') });
    location.hash = `#/cotta/${encodeURIComponent(rec.id)}`;
  });
  dlg.showModal();
}

// ---------- Scheda cotta ----------
const SEZIONI_INGR = [
  ['malti', 'Malti e zuccheri', 'kg'],
  ['luppoli', 'Luppoli', 'g'],
  ['lievito', 'Lievito', 'g'],
  ['sali', 'Sali e additivi', 'g'],
];

// Correzioni del pH con acido lattico: sul mosto (giorno di cotta) o più avanti
const FASI_ACIDO = ['ammostamento', 'sparge', 'bollitura', 'fermentazione', 'maturazione'];

async function vistaCotta(id) {
  const orig = await db.leggi(id);
  if (!orig || orig.eliminato) { $app.innerHTML = html`<p class="vuoto">Cotta non trovata. <a href="#/cotte">Torna alla lista</a></p>`; return; }
  const c = JSON.parse(JSON.stringify(orig));
  for (const k of ['sali', 'malti', 'luppoli', 'lievito', 'acido', 'fermentazione', 'confezionato']) c[k] = c[k] || [];
  c.acquaMash = c.acquaMash || {};
  c.acquaSparge = c.acquaSparge || {};
  // cotte non ancora fatte: antifoam già pronto negli additivi (lo storico non si tocca)
  if (c.data && c.data >= oggiISO()) c.sali = conAdditiviDefault(c.sali);

  // cotta doppia/tripla: registro, fine, travaso e confezionamento sono del fermentatore
  const gruppo = () => gruppoCotta(c, stato.cotte);
  const g0 = gruppo();
  const capo = g0[0];
  if (g0.length > 1) {
    c.fermentazione = registroComune(g0);
    for (const k of ['fine', 'travaso', 'fg']) if (c[k] == null) { const da = g0.find(x => x[k] != null); if (da) c[k] = JSON.parse(JSON.stringify(da[k])); }
    if (capo.id !== c.id) c.confezionato = JSON.parse(JSON.stringify(capo.confezionato || []));
  }

  let timer, salvataggio = Promise.resolve();
  const salvaPresto = () => {
    clearTimeout(timer);
    segna('Modifiche non salvate…');
    timer = setTimeout(salvaOra, 600);
  };
  const salvaOra = () => {
    clearTimeout(timer);
    salvataggio = salvataggio.then(async () => {
      c.lotto = c.numero && c.anno ? lottoDi(c.numero, c.anno) : c.lotto;
      c.birra = nomeBirra(c.birra);
      const g = gruppo();
      const primo = g[0];
      const r = await db.salva(primo.id === c.id || g.length === 1 ? c : { ...c, confezionato: [] });
      c.aggiornato = r.aggiornato;
      // allinea le altre cotte del gruppo, solo se qualcosa di comune è cambiato
      const altre = [];
      for (const x of g.filter(x => x.id !== c.id)) {
        const nuovo = { ...x };
        for (const k of CAMPI_COMUNI) nuovo[k] = c[k] === undefined ? null : JSON.parse(JSON.stringify(c[k]));
        if (x.id === primo.id) nuovo.confezionato = JSON.parse(JSON.stringify(c.confezionato));
        const prima = JSON.stringify([...CAMPI_COMUNI, 'confezionato'].map(k => x[k] ?? null));
        const dopo = JSON.stringify([...CAMPI_COMUNI, 'confezionato'].map(k => nuovo[k] ?? null));
        if (prima !== dopo) altre.push(nuovo);
      }
      if (altre.length) await db.salvaMolti(altre);
      segna('Salvato ✓');
    });
    return salvataggio;
  };
  const segna = t => { const el = document.getElementById('salv'); if (el) el.textContent = t; };
  pulizia = () => { if (timer) salvaOra(); };

  function campo(path, etichetta, tipo = 'number', extra = '') {
    const v = get(c, path);
    return html`<label>${etichetta}<input data-path="${path}" type="${tipo}" ${tipo === 'number' ? raw('step="any" inputmode="decimal"') : ''} value="${v ?? ''}" ${raw(extra)}></label>`;
  }

  function tabIngredienti(k, titolo, unitaDef) {
    const righe = c[k];
    const extra = k === 'luppoli';
    return html`<div class="scheda">
      <h2>${titolo}</h2>
      <div class="scroll-x"><table class="tab-edit">
        <thead><tr><th>Nome</th><th style="width:90px">Quantità</th><th style="width:70px">Unità</th>${extra ? html`<th style="width:80px">Minuti</th><th style="width:110px">Uso</th>` : ''}<th></th></tr></thead>
        <tbody>${righe.map((r, i) => html`<tr>
          <td><input data-path="${k}.${i}.nome" value="${r.nome || ''}" style="min-width:140px"></td>
          <td><input data-path="${k}.${i}.qta" type="number" step="any" inputmode="decimal" value="${r.qta ?? ''}"></td>
          <td><select data-path="${k}.${i}.unita">${['kg', 'g', 'L', 'ml', ''].map(u => html`<option value="${u}" ${u === (r.unita ?? '') ? 'selected' : ''}>${u || '—'}</option>`)}</select></td>
          ${extra ? html`<td><input data-path="${k}.${i}.minuti" type="number" step="any" value="${r.minuti ?? ''}"></td>
          <td><select data-path="${k}.${i}.uso">${['', 'bollitura', 'whirlpool', 'dry hop'].map(u => html`<option value="${u}" ${u === (r.uso || '') ? 'selected' : ''}>${u || '—'}</option>`)}</select></td>` : ''}
          <td class="az"><button class="piccolo" data-del="${k}.${i}" title="Rimuovi">✕</button></td>
        </tr>`)}</tbody>
      </table></div>
      <button class="piccolo" data-add="${k}" data-unita="${unitaDef}">+ Aggiungi</button>
      ${totaleIngr(righe)}
    </div>`;
  }
  function totaleIngr(righe) {
    const kg = righe.reduce((t, r) => t + (r.unita === 'kg' ? +r.qta || 0 : r.unita === 'g' ? (+r.qta || 0) / 1000 : 0), 0);
    return kg ? html`<p class="totale">Totale: ${numIT(kg, 2)} kg</p>` : '';
  }

  function disegna() {
    const s = statoCotta(c, stato.durate);
    const fine = c.data ? fineCotta(c, stato.durate) : null;
    const giorniTank = c.data && fine ? diffGiorni(c.data, fine) + 1 : null;
    const giornoOggi = c.data ? diffGiorni(c.data, oggiISO()) + 1 : null;
    const g = gruppo();
    const ogLotto = g.length > 1 ? ogMedia(g.map(x => (x.id === c.id ? c : x))) : c.og;
    const a = abv(ogLotto, c.fg);
    const litriConf = litriConfezionati(c);
    const litriGruppo = g.length > 1 ? g.reduce((t, x) => t + (Number(x.id === c.id ? c.litri : x.litri) || 0), 0) : c.litri;
    const ultimaLettura = [...c.fermentazione].reverse().find(e => e.densita !== undefined && e.densita !== null && e.densita !== '');
    $app.innerHTML = html`
      <div class="barra">
        <a href="#/cotte" class="btn">← Cotte</a>
        <span class="spazio"></span>
        <span id="salv" class="stato-salvataggio"></span>
        <button id="duplica">Duplica</button>
        ${window.self === window.top ? html`<button id="stampa" title="Si apre la stampa: scegli “Salva come PDF”">Salva PDF</button>` : ''}
      </div>
      <div class="scheda">
        <div class="barra" style="margin:0">
          <div><h1>${c.birra || 'Nuova cotta'} <span style="color:var(--muted);font-weight:400">· lotto ${c.lotto || '—'}</span></h1>
          ${g.length > 1 ? html`<p class="totale" style="margin:2px 0">Cotta ${g.length === 2 ? 'doppia' : g.length === 3 ? 'tripla' : 'multipla'} <b>${lottoGruppo(g)}</b> in ${c.fv}: ${g.filter(x => x.id !== c.id).map((x, i) => html`${i ? ', ' : ''}<a href="#/cotta/${encodeURIComponent(x.id)}">${x.lotto}</a>`)}. Registro di fermentazione, FG, fine in FV, travaso e confezionamento sono comuni; OG, pH e dati del giorno di cotta restano di ogni cotta. Il grado alcolico usa la media degli OG.</p>` : ''}
          <span class="chip ${s}">${STATI[s]}</span>
          ${s === 'tank' && giornoOggi > 0 ? html` <span class="totale">giorno ${giornoOggi} di ${giorniTank}</span>` : ''}
          ${c.origine ? html` <span class="totale">· ricetta da lotto ${c.origine}</span>` : ''}</div>
        </div>
        <div class="kpi">
          <div><b>${numIT(c.og)}</b>OG °P</div>
          ${g.length > 1 ? html`<div><b>${numIT(ogLotto)}</b>OG media ${lottoGruppo(g)}</div>` : ''}
          <div><b>${numIT(c.fg ?? ultimaLettura?.densita)}</b>${c.fg ? 'FG °P' : 'ultima densità'}</div>
          <div><b>${a ? numIT(a, 1) + '%' : '—'}</b>ABV stimato${g.length > 1 ? ' lotto' : ''}</div>
          <div><b>${numIT(c.litri, 0)}</b>litri cotta</div>
          <div><b>${litriConf ? numIT(litriConf, 0) : '—'}</b>litri confezionati</div>
        </div>
      </div>

      <div class="scheda">
        <h2>Dati cotta</h2>
        <div class="griglia">
          <label style="grid-column:span 2">Birra <input data-path="birra" list="dl-birre2" value="${c.birra || ''}"></label>
          <label style="grid-column:span 2">Stile <input data-path="stile" list="dl-stili" value="${c.stile || ''}" placeholder="${stileDi(c.birra) || 'es. American IPA'}"></label>
          ${campo('numero', 'Lotto n°')}
          ${campo('anno', 'Anno')}
          ${campo('data', 'Data cotta', 'date')}
          <label>Fermentatore <select data-path="fv"><option value="">—</option>${stato.fv.map(f => html`<option ${f.nome === c.fv ? 'selected' : ''}>${f.nome}</option>`)}</select></label>
          ${campo('fine', 'Fine in FV (prevista)', 'date', `placeholder="${fine || ''}"`)}
          <label>Travaso in <select data-path="travaso.fv"><option value="">—</option>${stato.fv.filter(f => f.nome !== c.fv).map(f => html`<option ${f.nome === (c.travaso?.fv || c.fvPercorso?.[1]) ? 'selected' : ''}>${f.nome}</option>`)}</select></label>
          ${campo('travaso.data', 'Data travaso', 'date')}
          ${campo('litri', 'Litri finali')}
          ${campo('og', 'OG (°P)')}
          ${campo('fg', 'FG (°P)')}
          ${campo('phMash', 'pH')}
        </div>
        <label style="margin-top:10px;display:flex;gap:8px;align-items:center;font-size:.9rem;color:var(--text)"><input type="checkbox" data-path="materiePrime" ${c.materiePrime ? 'checked' : ''} style="width:auto;min-height:auto"> Materie prime ordinate o in magazzino</label>
        <datalist id="dl-stili">${stiliNoti().map(x => html`<option value="${x}">`)}</datalist>
        <datalist id="dl-birre2">${birreNote().map(b => html`<option value="${b}">`)}</datalist>
        ${(() => {
          if (c.brewfather) return html`<p class="totale">Collegata a Brewfather${c.brewfather.stato ? ` (stato: ${c.brewfather.stato})` : ''}.</p>`;
          const da = stato.cotte.filter(x => x.id !== c.id && x.brewfather && x.id.startsWith('cotta-bf-') && x.data && c.data && Math.abs(diffGiorni(c.data, x.data)) <= 30);
          if (!da.length) return '';
          return html`<div class="calc-hlt"><b>Collega a Brewfather</b>
            <select id="bf-collega" style="width:auto;flex:1;min-width:200px"><option value="">Scegli la cotta creata in Brewfather…</option>
              ${da.map(x => html`<option value="${x.id}">${x.birra} · ${x.lotto} · ${dataIT(x.data)}</option>`)}</select>
            <button class="piccolo" id="bf-collega-ok">Collega</button></div>`;
        })()}
        ${(() => {
          const t = travasoCotta(c, stato.fv);
          if (!t) return stato.fv.find(f => f.nome === c.fv)?.isobarico === false
            ? html`<p class="totale">${c.fv} non è isobarico: la data del travaso si ricava dal profilo, al primo giorno a 1 °C dopo i 6 °C. Se nel profilo non c'è, scrivila qui sopra.</p>` : '';
          return html`<p class="totale">Travaso ${t.stimato ? 'previsto' : ''} il ${dataIT(t.data)}: ${c.fv} si libera, la birra passa in ${t.fv || 'un FV da scegliere'}.</p>`;
        })()}
      </div>

      <div class="scheda">
        <h2>Acqua e mash</h2>
        <div class="griglia">
          ${campo('acquaMash.tempAmbiente', 'T° ambiente')}
          ${campo('acquaMash.tempAcqua', 'T° acqua mash')}
          ${campo('acquaMash.tempMash', 'T° mash')}
          ${campo('acquaMash.ph15', 'pH a 15 min')}
          ${campo('acquaSparge.temp', 'T° sparge')}
        </div>
        <h3>Serbatoio acqua calda (tacche in cm)</h3>
        <div class="griglia">
          ${campo('acquaMash.taccaInizio', 'Tacca iniziale')}
          ${campo('acquaMash.taccaFine', 'Tacca dopo mash')}
          ${campo('acquaMash.litri', 'Litri mash')}
          ${campo('acquaSparge.taccaFine', 'Tacca dopo sparge')}
          ${campo('acquaSparge.litri', 'Litri sparge')}
        </div>
        ${(() => {
          const m = prelievo(c.acquaMash.taccaInizio, c.acquaMash.taccaFine);
          const sp = prelievo(c.acquaMash.taccaFine, c.acquaSparge.taccaFine);
          const righe = [];
          if (m !== null) righe.push(`Mash da tabella: ${numIT(m, 0)} L (${numIT(c.acquaMash.taccaInizio)} → ${numIT(c.acquaMash.taccaFine)} cm)`);
          if (sp !== null) righe.push(`Sparge da tabella: ${numIT(sp, 0)} L (${numIT(c.acquaMash.taccaFine)} → ${numIT(c.acquaSparge.taccaFine)} cm)`);
          return righe.length ? html`<p class="totale">${righe.join(' · ')}</p>` : '';
        })()}
        <div class="calc-hlt">
          <b>Calcolatore</b> (mash, sparge, dip hopping): parto da tacca
          <input id="hlt-da" type="number" step="any" inputmode="decimal" value="${c.acquaSparge.taccaFine ?? c.acquaMash.taccaFine ?? c.acquaMash.taccaInizio ?? ''}">
          e prelevo <input id="hlt-litri" type="number" step="any" inputmode="decimal" placeholder="litri"> L
          <span id="hlt-out" class="calc-out"></span>
        </div>
        ${(c.acquaMash.righe || []).length || (c.acquaSparge.righe || []).length ? html`<p class="totale">Dalla scheda originale: ${[...(c.acquaMash.righe || []), ...(c.acquaSparge.righe || [])].join(' · ')}</p>` : ''}
      </div>

      ${SEZIONI_INGR.map(([k, t, u]) => tabIngredienti(k, t, u))}

      <div class="scheda">
        <h2>Acido lattico</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th style="width:150px">Fase</th><th style="width:150px">Data</th><th style="width:80px">ml</th><th style="width:80px">pH prima</th><th style="width:80px">pH dopo</th><th>Nota</th><th></th></tr></thead>
          <tbody>${c.acido.map((r, i) => html`<tr>
            <td><select data-path="acido.${i}.fase">${FASI_ACIDO.map(f => html`<option ${f === r.fase ? 'selected' : ''}>${f}</option>`)}</select></td>
            <td><input data-path="acido.${i}.data" type="date" value="${r.data || ''}"></td>
            <td><input data-path="acido.${i}.ml" type="number" step="any" inputmode="decimal" value="${r.ml ?? ''}"></td>
            <td><input data-path="acido.${i}.phPrima" type="number" step="0.01" inputmode="decimal" value="${r.phPrima ?? ''}"></td>
            <td><input data-path="acido.${i}.phDopo" type="number" step="0.01" inputmode="decimal" value="${r.phDopo ?? ''}"></td>
            <td><input data-path="acido.${i}.nota" value="${r.nota || ''}" style="min-width:120px"></td>
            <td class="az"><button class="piccolo" data-del="acido.${i}" title="Rimuovi">✕</button></td>
          </tr>`)}</tbody>
        </table></div>
        <div class="barra" style="margin-top:8px">
          <button class="piccolo" data-add="acido" data-preset="ammostamento">+ In ammostamento</button>
          <button class="piccolo" data-add="acido" data-preset="fermentazione">+ Più avanti</button>
        </div>
        ${c.acido.length ? html`<p class="totale">Totale acido lattico: ${numIT(c.acido.reduce((t, r) => t + (Number(r.ml) || 0), 0), 1)} ml</p>` : ''}
      </div>

      <div class="scheda">
        <h2>Fermentazione</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th style="width:44px">G.</th><th style="width:150px">Data</th><th>T° °C</th><th>Densità °P</th><th>pH</th><th>psi</th><th>Nota (DH, CC, spurgo…)</th><th></th></tr></thead>
          <tbody>${c.fermentazione.map((e, i) => html`<tr ${e.data === oggiISO() ? raw('style="background:var(--surface-2)"') : ''}>
            <td class="num">${c.data && e.data ? diffGiorni(c.data, e.data) + 1 : e.giorno || ''}</td>
            <td><input data-path="fermentazione.${i}.data" type="date" value="${e.data || ''}"></td>
            <td><input data-path="fermentazione.${i}.temp" type="number" step="any" inputmode="decimal" value="${e.temp ?? ''}" style="min-width:60px"></td>
            <td><input data-path="fermentazione.${i}.densita" type="number" step="any" inputmode="decimal" value="${e.densita ?? ''}" style="min-width:60px"></td>
            <td><input data-path="fermentazione.${i}.ph" type="number" step="0.01" inputmode="decimal" value="${e.ph ?? ''}" style="min-width:60px"></td>
            <td><input data-path="fermentazione.${i}.psi" type="number" step="any" inputmode="decimal" value="${e.psi ?? ''}" style="min-width:60px"></td>
            <td><input data-path="fermentazione.${i}.nota" value="${e.nota || ''}" style="min-width:120px"></td>
            <td class="az"><button class="piccolo" data-del="fermentazione.${i}" title="Rimuovi">✕</button></td>
          </tr>`)}</tbody>
        </table></div>
        <div class="barra" style="margin-top:8px">
          <button class="piccolo primario" id="lettura-oggi">+ Lettura di oggi</button>
          <button class="piccolo" data-add="fermentazione">+ Riga</button>
        </div>
      </div>

      <div class="scheda">
        <h2>Confezionamento${g.length > 1 ? html` <span class="totale">· lotto ${lottoGruppo(g)}</span>` : ''}</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th>Formato</th><th style="width:90px">Pezzi</th><th style="width:100px">Litri/pezzo</th><th style="width:140px">Data</th><th></th></tr></thead>
          <tbody>${c.confezionato.map((r, i) => html`<tr>
            <td><select data-path="confezionato.${i}.tipo">${['fusto', 'lattina/bottiglia'].map(t => html`<option ${t === r.tipo ? 'selected' : ''}>${t}</option>`)}</select></td>
            <td><input data-path="confezionato.${i}.pezzi" type="number" step="1" inputmode="numeric" value="${r.pezzi ?? ''}"></td>
            <td><input data-path="confezionato.${i}.litri" type="number" step="any" inputmode="decimal" value="${r.litri ?? ''}"></td>
            <td><input data-path="confezionato.${i}.data" type="date" value="${r.data || ''}"></td>
            <td class="az"><button class="piccolo" data-del="confezionato.${i}" title="Rimuovi">✕</button></td>
          </tr>`)}</tbody>
        </table></div>
        <div class="barra" style="margin-top:8px">
          <button class="piccolo" data-add="confezionato" data-preset="fusto:24">+ Fusti 24 L</button>
          <button class="piccolo" data-add="confezionato" data-preset="fusto:25">+ Fusti 25 L</button>
          <button class="piccolo" data-add="confezionato" data-preset="fusto:20">+ Fusti 20 L</button>
          <button class="piccolo" data-add="confezionato" data-preset="fusto:12">+ Fusti 12 L</button>
          <button class="piccolo" data-add="confezionato" data-preset="lattina/bottiglia:0.33">+ Lattine 0,33</button>
        </div>
        ${litriConf ? html`<p class="totale">Totale confezionato: ${numIT(litriConf, 1)} L${litriGruppo ? ` (resa ${numIT(litriConf / litriGruppo * 100, 0)}%${g.length > 1 ? ` su ${numIT(litriGruppo, 0)} L di ${g.length} cotte` : ''})` : ''}</p>` : ''}
        ${c.confezionatoNote ? html`<p class="totale">Note: ${c.confezionatoNote}</p>` : ''}
      </div>

      <div class="scheda">
        <h2>Note</h2>
        <textarea data-path="note" rows="4">${c.note || ''}</textarea>
      </div>
      <div class="barra">
        <span class="totale">${c.fonte ? `Importata da ${c.fonte}` : ''}</span>
        <span class="spazio"></span>
        <button class="pericolo" id="elimina">Elimina cotta</button>
      </div>
    `;
  }

  disegna();

  $app.oninput = e => {
    const p = e.target.dataset.path;
    if (e.target.id === 'hlt-da' || e.target.id === 'hlt-litri') return calcolaHlt();
    if (!p) return;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'number') v = v === '' ? null : Number(v);
    if (e.target.type === 'date' && v === '') v = null;
    set(c, p, v);
    // le tacche del serbatoio aggiornano i litri prelevati
    if (/^acqua(Mash|Sparge)\.tacca/.test(p)) {
      const m = prelievo(c.acquaMash.taccaInizio, c.acquaMash.taccaFine);
      const sp = prelievo(c.acquaMash.taccaFine, c.acquaSparge.taccaFine);
      if (m !== null && m >= 0) { c.acquaMash.litri = m; const el = $app.querySelector('[data-path="acquaMash.litri"]'); if (el) el.value = m; }
      if (sp !== null && sp >= 0) { c.acquaSparge.litri = sp; const el = $app.querySelector('[data-path="acquaSparge.litri"]'); if (el) el.value = sp; }
    }
    salvaPresto();
  };
  function calcolaHlt() {
    const da = document.getElementById('hlt-da').value, litri = Number(document.getElementById('hlt-litri').value);
    const out = document.getElementById('hlt-out');
    if (da === '') { out.textContent = ''; return; }
    const disp = litriATacca(da);
    if (!litri) { out.textContent = `nel serbatoio ci sono ${numIT(disp, 0)} L`; return; }
    if (litri > disp) { out.textContent = `servono ${numIT(litri, 0)} L ma a ${numIT(Number(da))} cm ce ne sono solo ${numIT(disp, 0)}`; return; }
    out.textContent = `→ fermati a tacca ${numIT(taccaFinale(da, litri))} cm`;
  }
  $app.onchange = e => {
    const p = e.target.dataset.path;
    // ridisegna quando cambiano valori che influenzano KPI e stato
    if (p && /^(og|fg|data|fine|fv|travaso|litri|numero|anno|birra|confezionato|acqua(Mash|Sparge)\.tacca|fermentazione\.\d+\.(data|densita|temp))/.test(p)) {
      const y = scrollY; disegna(); scrollTo(0, y);
    }
  };
  $app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.add) {
      const k = t.dataset.add;
      if (k === 'fermentazione') {
        const last = c.fermentazione[c.fermentazione.length - 1];
        c.fermentazione.push({ data: last?.data ? addGiorni(last.data, 1) : c.data || oggiISO(), temp: last?.temp ?? null });
      } else if (k === 'acido') {
        const fase = t.dataset.preset;
        c.acido.push({ fase, data: fase === 'ammostamento' ? c.data || oggiISO() : oggiISO(), ml: null, phPrima: null, phDopo: null, nota: '' });
      } else if (k === 'confezionato') {
        const [tipo, litri] = t.dataset.preset.split(':');
        c.confezionato.push({ tipo, pezzi: null, litri: Number(litri), data: oggiISO() });
      } else {
        c[k].push({ nome: '', qta: null, unita: t.dataset.unita });
      }
      salvaPresto();
      const y = scrollY; disegna(); scrollTo(0, y);
    } else if (t.dataset.del) {
      const [k, i] = t.dataset.del.split('.');
      c[k].splice(Number(i), 1);
      salvaPresto();
      const y = scrollY; disegna(); scrollTo(0, y);
    } else if (t.id === 'lettura-oggi') {
      const oggi = oggiISO();
      let e2 = c.fermentazione.find(x => x.data === oggi);
      if (!e2) {
        const prec = [...c.fermentazione].filter(x => x.data < oggi).pop();
        e2 = { data: oggi, temp: prec?.temp ?? null };
        c.fermentazione.push(e2);
        c.fermentazione.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
      }
      salvaPresto();
      const y = scrollY; disegna(); scrollTo(0, y);
      const i = c.fermentazione.indexOf(e2);
      document.querySelector(`[data-path="fermentazione.${i}.densita"]`)?.focus();
    } else if (t.id === 'elimina') {
      if (!(await chiedi(`Eliminare la cotta ${c.lotto} ${c.birra}?`, 'Elimina'))) return;
      clearTimeout(timer);
      await db.elimina(c.id);
      toast('Cotta eliminata');
      location.hash = '#/cotte';
    } else if (t.id === 'duplica') {
      await salvaOra();
      dialogNuovaCotta({ birra: c.birra, titolo: `Nuova cotta da ${c.lotto}` });
    } else if (t.id === 'bf-collega-ok') {
      const altroId = document.getElementById('bf-collega').value;
      const altro = stato.cotte.find(x => x.id === altroId);
      if (!altro) return;
      if (!(await chiedi(`Unire questa cotta pianificata con ${altro.birra} ${altro.lotto} di Brewfather? Restano FV, tacche e note di questa scheda.`, 'Collega'))) return;
      clearTimeout(timer);
      Object.assign(c, bf.uniscaManuale(c, altro));
      await db.salva(c);
      await db.elimina(altro.id);
      toast('Cotta collegata a Brewfather');
      const y = scrollY; disegna(); scrollTo(0, y);
    } else if (t.id === 'stampa') {
      // il titolo diventa il nome proposto per il file PDF
      const titolo = document.title;
      document.title = `Cotta ${c.lotto || ''} ${c.birra || ''}`.replace(/[/\\:]/g, '-').trim();
      addEventListener('afterprint', () => { document.title = titolo; }, { once: true });
      window.print();
    }
  };
  pulizia = () => {
    if (timer) salvaOra();
    $app.oninput = $app.onchange = $app.onclick = null;
  };
}

function get(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }
function set(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) { if (x[k] == null) x[k] = {}; x = x[k]; }
  x[ks[ks.length - 1]] = v;
}

// ---------- Planning ----------
const plan = { inizio: null, giorni: 84 };
const W = 30; // pixel per giorno

// Export del planning in Excel: righe = FV, colonne = giorni, colori come nell'app.
// Periodo: dall'inizio della vista attuale fino all'ultima cotta in programma.
const COLORI_XLSX = { fermentazione: 'FB923C', dh: 'B39DFA', maturazione: '7DD3FC', weekend: 'F7DBE3', mp: '92D050', testa: 'E7E5E4' };
function esportaPlanning() {
  const da = plan.inizio || addGiorni(oggiISO(), -21);
  const fini = stato.cotte.filter(c => c.data).map(c => fineCotta(c, stato.durate));
  const a = [addGiorni(da, plan.giorni - 1), ...fini].sort().pop();
  const giorni = Array.from({ length: diffGiorni(da, a) + 1 }, (_, i) => addGiorni(da, i));
  const periodi = stato.cotte.filter(c => c.data && c.data <= a && fineCotta(c, stato.durate) >= da)
    .flatMap(c => periodiCotta(c, stato.durate, stato.fv)).filter(p => p.fv && p.da <= a && p.a >= da);
  const nomiFv = [...new Set([...stato.fv.map(f => f.nome), ...periodi.map(p => p.fv)])]
    .sort((x, y) => x.localeCompare(y, 'it', { numeric: true }));
  const fest = d => [0, 6].includes(daISO(d).getDay());
  const GG = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
  const testa = (v, d) => ({ v, centro: true, grassetto: true, sfondo: d && fest(d) ? COLORI_XLSX.weekend : COLORI_XLSX.testa });
  const righe = [
    [testa('FV'), ...giorni.map((d, i) => testa(i === 0 || d.endsWith('-01') ? daISO(d).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }) : '', d))],
    [testa(''), ...giorni.map(d => testa(daISO(d).getDate(), d))],
    [testa(''), ...giorni.map(d => testa(GG[daISO(d).getDay()], d))],
  ];
  for (const n of nomiFv) {
    const riga = [{ v: n, grassetto: true }, ...giorni.map(d => (fest(d) ? { v: '', sfondo: COLORI_XLSX.weekend } : null))];
    const suFv = periodi.filter(p => p.fv === n).sort((x, y) => x.da.localeCompare(y.da));
    const scritti = new Set();
    for (const p of suFv) {
      const c = p.cotta;
      const g = gruppoCotta(c, stato.cotte);
      const fasi = fasiCotta(c, stato.durate);
      for (let d = p.da < da ? da : p.da; d <= p.a && d <= a; d = addGiorni(d, 1)) {
        const f = fasi.find(x => x.da <= d && x.a >= d)?.fase || 'fermentazione';
        riga[diffGiorni(da, d) + 1] = { v: '', sfondo: COLORI_XLSX[f] };
      }
      // etichetta sul primo giorno della barra (una volta per cotta doppia/tripla)
      const chiave = g.map(x => x.id).join() + (p.travaso ? 't' : '');
      if (scritti.has(chiave)) continue;
      scritti.add(chiave);
      const inizio = p.da < da ? da : p.da;
      const mp = statoCotta(c, stato.durate) === 'pianificata' && g.every(x => x.materiePrime);
      riga[diffGiorni(da, inizio) + 1] = { v: `${p.travaso ? '↳ ' : ''}${lottoGruppo(g) || c.lotto || ''} ${c.birra || ''}`.trim(), grassetto: true, sfondo: mp ? COLORI_XLSX.mp : riga[diffGiorni(da, inizio) + 1]?.sfondo };
    }
    righe.push(riga);
  }
  righe.push([], [{ v: 'Legenda', grassetto: true }],
    [{ v: 'Fermentazione', sfondo: COLORI_XLSX.fermentazione }], [{ v: 'DH', sfondo: COLORI_XLSX.dh }],
    [{ v: 'Maturazione a freddo', sfondo: COLORI_XLSX.maturazione }], [{ v: 'Materie prime ordinate', sfondo: COLORI_XLSX.mp }],
    [{ v: 'Sabato e domenica', sfondo: COLORI_XLSX.weekend }]);

  const elenco = stato.cotte.filter(c => c.data && c.data <= a && fineCotta(c, stato.durate) >= da)
    .sort((x, y) => x.data.localeCompare(y.data));
  const cotte = [
    ['Lotto', 'Lotto gruppo', 'Birra', 'Stile', 'FV', 'Data cotta', 'Fine in FV', 'Travaso in', 'Data travaso', 'Litri', 'OG °P', 'Stato', 'Materie prime'].map(v => testa(v)),
    ...elenco.map(c => {
      const g = gruppoCotta(c, stato.cotte);
      return [c.lotto || '', g.length > 1 ? lottoGruppo(g) : '', c.birra || '', c.stile || '', c.fv || '', dataIT(c.data), dataIT(fineCotta(c, stato.durate)),
        c.travaso?.fv || '', c.travaso?.data ? dataIT(c.travaso.data) : '', c.litri ?? '', c.og ?? '', STATI[statoCotta(c, stato.durate)] || '',
        c.materiePrime ? { v: 'sì', sfondo: COLORI_XLSX.mp } : ''];
    }),
  ];
  const blob = creaXlsx([
    { nome: 'Planning', righe, larghezze: [8, ...giorni.map(() => 4.5)], blocca: { righe: 3, colonne: 1 } },
    { nome: 'Cotte', righe: cotte, larghezze: [8, 10, 22, 18, 6, 11, 11, 10, 12, 8, 7, 12, 13], blocca: { righe: 1 } },
  ]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `planning-${da}-${a}.xlsx`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// Vista normale: dal 1° gennaio dell'anno in corso fino a dopo l'ultima cotta pianificata,
// aperta sul giorno di oggi (si scorre indietro fino a gennaio)
function vistaDaGennaio() {
  const oggi = oggiISO();
  const fini = stato.cotte.filter(c => c.data).map(c => fineCotta(c, stato.durate));
  const fine = [addGiorni(oggi, 90), ...fini.map(f => addGiorni(f, 14))].sort().pop();
  plan.inizio = `${oggi.slice(0, 4)}-01-01`;
  plan.giorni = diffGiorni(plan.inizio, fine) + 1;
}

// anni con cotte, più quello prossimo per pianificare
function anniPlanning() {
  const anni = stato.cotte.map(c => Number((c.data || '').slice(0, 4))).filter(Boolean);
  const ora = Number(oggiISO().slice(0, 4));
  const da = Math.min(ora, ...anni), a = Math.max(ora + 1, ...anni);
  return Array.from({ length: a - da + 1 }, (_, i) => a - i);
}

function vistaPlanning() {
  if (!plan.inizio) vistaDaGennaio();
  const fineVista = addGiorni(plan.inizio, plan.giorni - 1);
  const oggi = oggiISO();
  const visibili = stato.cotte.filter(c => c.data && c.data <= fineVista && fineCotta(c, stato.durate) >= plan.inizio);
  const periodi = visibili.flatMap(c => periodiCotta(c, stato.durate, stato.fv)).filter(p => p.da <= fineVista && p.a >= plan.inizio);
  const conf = conflitti(stato.cotte.filter(c => fineCotta(c, stato.durate) >= oggi), stato.durate, stato.fv);
  const senzaFv = stato.cotte.flatMap(c => periodiCotta(c, stato.durate, stato.fv)).filter(p => p.travaso && !p.fv && p.a >= oggi);
  const inConflitto = new Set(conf.flatMap(x => [x.a.id, x.b.id]));
  const nomiFv = [...new Set([...stato.fv.map(f => f.nome), ...periodi.map(p => p.fv).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
  const larghezza = plan.giorni * W;

  const giorni = Array.from({ length: plan.giorni }, (_, i) => addGiorni(plan.inizio, i));
  const sfondo = giorni.map((d, i) => {
    const dow = daISO(d).getDay();
    return html`<div class="g-day ${dow === 1 ? 'lun' : ''} ${d === oggi ? 'oggi' : ''} ${dow === 0 || dow === 6 ? 'fest' : ''}" style="left:${i * W}px;width:${W}px"></div>`;
  });
  const testa = giorni.map((d, i) => {
    const dd = daISO(d);
    const primo = dd.getDate() === 1 || i === 0;
    return html`<div class="g-day ${dd.getDay() === 1 ? 'lun' : ''} ${d === oggi ? 'oggi' : ''} ${dd.getDay() === 0 || dd.getDay() === 6 ? 'fest' : ''}" style="left:${i * W}px;width:${W}px">
      <div style="height:18px;font-weight:600;color:var(--text);white-space:nowrap;text-align:left;padding-left:2px">${primo ? dd.toLocaleDateString('it-IT', { month: 'short' }) : ''}</div>
      <div>${dd.getDate()}</div></div>`;
  });

  // raggruppa cotte doppie (stessa birra, stesso FV, date vicine) in un'unica barra
  const barrePerFv = new Map();
  for (const p of periodi.filter(x => x.fv).sort((a, b) => a.da.localeCompare(b.da))) {
    const c = p.cotta;
    const lista = barrePerFv.get(p.fv) || [];
    const prev = lista[lista.length - 1];
    if (prev && prev.travaso === !!p.travaso && nomeBirra(prev.cotte[0].birra) === nomeBirra(c.birra) && diffGiorni(prev.da, p.da) <= 2) {
      prev.cotte.push(c);
      if (p.a > prev.a) prev.a = p.a;
    } else {
      lista.push({ cotte: [c], da: p.da, a: p.a, travaso: !!p.travaso });
    }
    barrePerFv.set(p.fv, lista);
  }
  const occupazione = nomiFv.map(n => {
    const attuale = periodi.find(p => p.fv === n && p.da <= oggi && p.a >= oggi);
    return { n, attuale, cap: stato.fv.find(f => f.nome === n)?.capacita };
  });

  $app.innerHTML = html`
    <div class="barra">
      <h1 style="margin:0">Planning fermentatori</h1>
      <span class="spazio"></span>
      <select id="anno" title="Vedi tutto un anno" style="width:auto">
        <option value="">Anno…</option>
        ${anniPlanning().map(y => html`<option value="${y}" ${plan.annoScelto === y ? 'selected' : ''}>${y}</option>`)}
      </select>
      <button id="prec">◀</button><button id="oggi">Oggi</button><button id="succ">▶</button>
      <button id="esporta">Esporta Excel</button>
      <button class="primario" id="pianifica">+ Pianifica cotta</button>
    </div>
    <div class="legenda">
      ${Object.entries(FASI).map(([k, v]) => html`<span><span class="fase-chip" style="background:var(--f-${k})"></span> ${v}</span>`)}
      <span>Bordo tratteggiato = pianificata · sbiadita = finita</span>
      <span>Bordo rosso = conflitto sullo stesso FV</span>
      <span><span class="mp">n° cotta</span> = materie prime ordinate o in magazzino</span>
      <span><span class="g-eta" style="position:static;padding:0 4px">12</span> = giorno della birra oggi (cotta = giorno 1)</span>
    </div>
    ${conf.length ? html`<div class="scheda avviso"><h2>⚠ ${conf.length} conflitt${conf.length === 1 ? 'o' : 'i'}</h2>
      ${conf.map(x => html`<div>${x.fv}: <a href="#/cotta/${encodeURIComponent(x.a.id)}">${x.a.birra} ${x.a.lotto}</a> (fino al ${dataIT(x.fineA)}) e <a href="#/cotta/${encodeURIComponent(x.b.id)}">${x.b.birra} ${x.b.lotto}</a> (dal ${dataIT(x.inizioB)})</div>`)}
      ${conf.some(x => stato.fv.find(f => f.nome === x.fv)?.isobarico === false) ? html`<p class="totale">Su un FV non isobarico basta indicare il travaso nella scheda della cotta (data, o profilo che scende a 1 °C).</p>` : ''}
    </div>` : ''}
    ${senzaFv.length ? html`<div class="scheda"><h2>Travasi senza FV di arrivo</h2>
      ${senzaFv.map(p => html`<div><a href="#/cotta/${encodeURIComponent(p.cotta.id)}">${p.cotta.birra} ${p.cotta.lotto}</a>: da ${p.cotta.fv} il ${dataIT(p.da)}, fino al ${dataIT(p.a)}</div>`)}
    </div>` : ''}
    <div class="gantt-wrap"><div class="gantt" style="width:${larghezza + 74}px">
      <div class="g-row testa"><div class="g-label">FV</div><div class="g-days" style="width:${larghezza}px">${testa}</div></div>
      ${nomiFv.map(n => html`<div class="g-row">
        <div class="g-label">${n}<small>${(() => { const f = stato.fv.find(x => x.nome === n); return f && f.capacita ? `${numIT(f.capacita, 0)} L` : ''; })()}</small></div>
        <div class="g-days" style="width:${larghezza}px">${sfondo}
          ${(barrePerFv.get(n) || []).map(b => {
            const c0 = b.cotte[0];
            const s = statoCotta(c0, stato.durate);
            const left = Math.max(0, diffGiorni(plan.inizio, b.da)) * W;
            const right = (Math.min(plan.giorni - 1, diffGiorni(plan.inizio, b.a)) + 1) * W;
            const lotti = (b.travaso ? '↳ ' : '') + (b.cotte.length > 1 ? b.cotte.map(c => c.numero).join('/') : c0.lotto || '');
            const mp = s === 'pianificata' && b.cotte.every(c => c.materiePrime);
            const conflitto = b.cotte.some(c => inConflitto.has(c.id));
            // sfondo a fasi: arancione fermentazione, viola DH, celeste maturazione
            const da = b.da < plan.inizio ? plan.inizio : b.da, a = b.a > fineVista ? fineVista : b.a;
            const tot = diffGiorni(da, a) + 1;
            const stops = fasiCotta(c0, stato.durate).filter(f => f.a >= da && f.da <= a).map(f => {
              const x0 = diffGiorni(da, f.da < da ? da : f.da) / tot * 100, x1 = (diffGiorni(da, f.a > a ? a : f.a) + 1) / tot * 100;
              return `var(--f-${f.fase}) ${x0.toFixed(2)}% ${x1.toFixed(2)}%`;
            });
            const sfondoFasi = stops.length ? `background:linear-gradient(to right, ${stops.join(', ')});` : '';
            return html`<a class="g-bar ${s} ${conflitto ? 'conflitto' : ''}" href="#/cotta/${encodeURIComponent(c0.id)}"
              style="left:${left + 1}px;width:${Math.max(right - left - 2, 8)}px;${sfondoFasi}"
              title="${c0.birra} · lotto ${lotti} · ${dataIT(b.da)} → ${dataIT(b.a)}">
              <b>${c0.birra}</b><span>${mp ? html`<span class="mp">${lotti}</span>` : lotti} · ${diffGiorni(b.da, b.a) + 1} gg</span>
              ${b.da <= oggi && oggi <= b.a && c0.data && oggi >= plan.inizio && oggi <= fineVista
                ? html`<span class="g-eta" style="left:${diffGiorni(plan.inizio, oggi) * W - left - 1}px;width:${W}px" title="Cotta del ${dataIT(c0.data)}: giorno ${diffGiorni(c0.data, oggi) + 1}">${diffGiorni(c0.data, oggi) + 1}</span>` : ''}</a>`;
          })}
        </div></div>`)}
    </div></div>

    <div class="scheda" style="margin-top:12px">
      <h2>Oggi nei fermentatori</h2>
      <div class="griglia">${occupazione.map(o => html`<div>
        <b>${o.n}</b><br>
        ${o.attuale ? html`<a href="#/cotta/${encodeURIComponent(o.attuale.cotta.id)}">${o.attuale.cotta.birra}</a><br><span class="totale">giorno ${diffGiorni(o.attuale.cotta.data, oggi) + 1}, libero dal ${dataIT(addGiorni(o.attuale.a, 1))}${o.attuale.a < fineCotta(o.attuale.cotta, stato.durate) ? ' (travaso)' : ''}</span>`
          : html`<span class="fv-libero">libero</span>`}
      </div>`)}</div>
    </div>
  `;
  document.getElementById('prec').onclick = () => { plan.inizio = addGiorni(plan.inizio, -28); vistaPlanning(); };
  document.getElementById('succ').onclick = () => { plan.inizio = addGiorni(plan.inizio, 28); vistaPlanning(); };
  document.getElementById('oggi').onclick = () => { plan.annoScelto = null; vistaDaGennaio(); vistaPlanning(); scrollOggi(); };
  document.getElementById('anno').onchange = e => {
    const y = Number(e.target.value);
    if (!y) return;
    plan.inizio = `${y}-01-01`;
    plan.annoScelto = y;
    plan.giorni = diffGiorni(`${y}-01-01`, `${y + 1}-01-01`);
    vistaPlanning();
  };
  document.getElementById('pianifica').onclick = () => dialogNuovaCotta({ titolo: 'Pianifica cotta', data: addGiorni(oggiISO(), 7) });
  document.getElementById('esporta').onclick = esportaPlanning;
  scrollOggi();
  function scrollOggi() {
    const wrap = document.querySelector('.gantt-wrap');
    const off = diffGiorni(plan.inizio, oggi);
    if (off >= 0 && off < plan.giorni) wrap.scrollLeft = Math.max(0, off * W - 120);
  }
}

// ---------- Impostazioni ----------
async function vistaImpostazioni() {
  const nonInviati = (await db.daInviare()).length;
  const bfUltimo = await db.meta('brewfatherUltimo');
  $app.innerHTML = html`
    <h1>Impostazioni</h1>
    <div class="scheda">
      <h2>Fermentatori</h2>
      <table class="tab-edit">
        <thead><tr><th>Nome</th><th>Capacità (L)</th><th>Isobarico</th><th></th></tr></thead>
        <tbody>${stato.fv.map(f => html`<tr>
          <td><input data-fv="${f.id}" data-k="nome" value="${f.nome}"></td>
          <td><input data-fv="${f.id}" data-k="capacita" type="number" value="${f.capacita ?? ''}"></td>
          <td style="text-align:center"><input data-fv="${f.id}" data-k="isobarico" type="checkbox" style="width:auto;min-height:auto" ${f.isobarico === false ? '' : 'checked'}></td>
          <td class="az"><button class="piccolo" data-del-fv="${f.id}">✕</button></td></tr>`)}</tbody>
      </table>
      <button class="piccolo" id="add-fv">+ Aggiungi fermentatore</button>
      <p class="totale">Togli "Isobarico" ai fermentatori da cui travasi (FV6, FV7): nel planning si liberano il giorno del travaso.</p>
    </div>

    <div class="scheda">
      <h2>Account e sincronizzazione</h2>
      ${auth.configurato() ? html`
        <p>Accesso come <b>${auth.utente()?.email || '—'}</b></p>
        <p class="totale">I dati restano anche su questo dispositivo: l'app funziona offline e invia le modifiche appena torna internet.</p>
        <div class="barra"><button id="sync-ora">Sincronizza ora</button><button class="pericolo" id="esci">Esci</button></div>
        <p class="totale" id="sync-stato"></p>
        <p class="totale">Modifiche in attesa di invio: ${nonInviati}</p>`
      : html`<p class="totale">Versione di prova: i dati sono solo su questo dispositivo, senza account e senza cloud.</p>`}
    </div>

    <div class="scheda">
      <h2>Brewfather</h2>
      <p class="totale">Ricette e cotte si scrivono in Brewfather. Qui arrivano birra, numero, data, ricetta, valori misurati e letture del densimetro; fermentatore, tacche e confezionamento restano quelli inseriti nell'app.</p>
      <div class="barra">
        <button class="primario" id="bf-attive">Aggiorna cotte in corso</button>
        <button id="bf-tutto">Importa tutto lo storico</button>
      </div>
      <p class="totale" id="bf-stato">${bfUltimo ? `Ultimo import: ${new Date(bfUltimo).toLocaleString('it-IT')}` : 'Mai importato.'}</p>
    </div>

    <div class="scheda">
      <h2>Dati</h2>
      <div class="barra">
        ${auth.configurato() ? '' : html`<button id="storico">Importa storico schede cotta</button>`}
        <button id="esporta">Scarica backup (JSON)</button>
        <label class="btn" style="color:var(--text);font-size:inherit">Ripristina backup<input id="ripristina" type="file" accept="application/json" hidden></label>
      </div>
      <p class="totale">${stato.cotte.length} cotte su questo dispositivo.</p>
    </div>
  `;
  $app.querySelectorAll('[data-fv]').forEach(inp => inp.addEventListener('change', async () => {
    const f = stato.fv.find(x => x.id === inp.dataset.fv);
    f[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked
      : inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value.trim().toUpperCase();
    await db.salva(f);
  }));
  $app.querySelectorAll('[data-del-fv]').forEach(b => b.addEventListener('click', async () => {
    if (await chiedi('Rimuovere questo fermentatore?', 'Rimuovi')) await db.elimina(b.dataset.delFv);
  }));
  document.getElementById('add-fv').onclick = async () => {
    const n = stato.fv.length + 1;
    await db.salva({ id: db.nuovoId('fv'), tipo: 'fv', nome: `FV${n}`, capacita: null });
  };
  const syncOra = document.getElementById('sync-ora');
  if (syncOra) syncOra.onclick = () => sync.sincronizza();
  const esci = document.getElementById('esci');
  if (esci) esci.onclick = async () => {
    const attesa = (await db.daInviare()).length;
    const msg = attesa
      ? `Ci sono ${attesa} modifiche non ancora inviate al cloud: uscendo andranno perse. Uscire lo stesso?`
      : 'Uscire? I dati verranno tolti da questo dispositivo e torneranno al prossimo accesso.';
    if (!(await chiedi(msg, 'Esci'))) return;
    await auth.esci();
    await db.svuota();
    location.hash = '#/cotte';
    location.reload();
  };
  document.getElementById('bf-attive').onclick = () => importaBrewfather(false);
  document.getElementById('bf-tutto').onclick = () => importaBrewfather(true);
  const off = sync.onStato(s => {
    const el = document.getElementById('sync-stato');
    if (!el) return;
    el.textContent = !s.attivo ? 'Cloud non collegato: i dati sono solo su questo dispositivo.'
      : s.errore ? `Errore: ${s.errore}` : s.ultimo ? `Ultima sincronizzazione: ${new Date(s.ultimo).toLocaleString('it-IT')}` : 'In attesa della prima sincronizzazione…';
  });
  pulizia = off;
  const storico = document.getElementById('storico');
  if (storico) storico.onclick = () => importaStorico().catch(e => toast('Import non riuscito: ' + e.message));
  document.getElementById('esporta').onclick = async () => {
    const dati = await db.esporta();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dati)], { type: 'application/json' }));
    a.download = `birrificio-backup-${oggiISO()}.json`;
    a.click();
  };
  document.getElementById('ripristina').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const dati = JSON.parse(await file.text());
    if (dati.app !== 'birrificio') return toast('File non valido');
    await db.applicaRemoti(dati.records);
    toast('Backup ripristinato');
  };
}

async function importaBrewfather(completo) {
  const out = document.getElementById('bf-stato');
  const scrivi = t => { if (out) out.textContent = t; };
  const bottoni = [...document.querySelectorAll('#bf-attive, #bf-tutto')];
  bottoni.forEach(b => { b.disabled = true; });
  try {
    scrivi('Scarico le cotte da Brewfather…');
    const proxy = (await db.meta('brewfatherProxy')) || bf.PROXY_DEFAULT;
    const batch = await bf.scaricaBatch(proxy, { completo });
    const cotte = await db.tutti('cotta');
    const salvare = [];
    let nuove = 0, aggiornate = 0;
    for (const [i, b] of batch.entries()) {
      scrivi(`Elaboro ${i + 1} di ${batch.length}…`);
      const attiva = ['Brewing', 'Fermenting', 'Conditioning'].includes(b.status);
      const letture = attiva ? await bf.scaricaLetture(proxy, b._id) : [];
      const esistente = bf.cottaCorrispondente(cotte, b);
      const c = bf.unisci(esistente, b, letture);
      if (esistente) { c.id = esistente.id; aggiornate++; } else { c.id = `cotta-bf-${b._id}`; nuove++; cotte.push(c); }
      salvare.push(c);
    }
    await db.salvaMolti(salvare.map(({ aggiornato, ...r }) => r));
    await db.meta('brewfatherUltimo', new Date().toISOString());
    scrivi(`Fatto: ${nuove} cotte nuove, ${aggiornate} aggiornate.`);
    toast(`Brewfather: ${nuove} nuove, ${aggiornate} aggiornate`);
  } catch (e) {
    scrivi(e.message.includes('Failed to fetch') || e.message.includes('404')
      ? 'Brewfather non raggiungibile: funziona quando l\'app è online sul suo server con la chiave API configurata.'
      : e.message);
  } finally {
    bottoni.forEach(b => { b.disabled = false; });
  }
}

// ---------- accesso ----------
function schermataAccesso(messaggio = '') {
  document.querySelector('.top nav').hidden = true;
  $app.innerHTML = html`
    <div class="scheda accesso">
      <h1>Produzione</h1>
      <p class="totale">Accedi con l'email e la password del tuo account.</p>
      <form id="login" class="griglia" style="grid-template-columns:1fr">
        <label>Email <input id="login-email" name="email" type="email" autocomplete="username" required></label>
        <label>Password <input id="login-password" name="password" type="password" autocomplete="current-password" required></label>
        <button class="primario">Accedi</button>
      </form>
      <p class="errore" id="login-errore">${messaggio}</p>
      <button class="piccolo" id="password-dimenticata" style="margin-top:8px">Password dimenticata?</button>
      <p class="totale" style="margin-top:14px">Gli account li crea il titolare: non è possibile registrarsi da soli.</p>
    </div>`;
  const f = document.getElementById('login');
  const err = document.getElementById('login-errore');
  f.onsubmit = async e => {
    e.preventDefault();
    if (!navigator.onLine) { err.textContent = 'Per il primo accesso serve internet.'; return; }
    const btn = f.querySelector('button'); btn.disabled = true; err.textContent = '';
    try {
      await auth.accedi(f.email.value, f.password.value);
      location.hash = '#/cotte';
      location.reload();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
  document.getElementById('password-dimenticata').onclick = async () => {
    if (!f.email.value) { err.textContent = 'Scrivi prima la tua email.'; return; }
    try { await auth.recuperaPassword(f.email.value); err.textContent = ''; toast('Ti abbiamo inviato un\'email per scegliere una nuova password'); }
    catch (ex) { err.textContent = ex.message; }
  };
}

function schermataPassword(link) {
  document.querySelector('.top nav').hidden = true;
  $app.innerHTML = html`
    <div class="scheda accesso">
      <h1>${link.tipo === 'recovery' ? 'Nuova password' : 'Benvenuto'}</h1>
      <p class="totale">Scegli la password per entrare nell'app (almeno 8 caratteri).</p>
      <form id="nuova-pw" class="griglia" style="grid-template-columns:1fr">
        <label>Password <input id="pw1" name="pw1" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Ripeti la password <input id="pw2" name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="primario">Salva e entra</button>
      </form>
      <p class="errore" id="pw-errore"></p>
    </div>`;
  const f = document.getElementById('nuova-pw');
  f.onsubmit = async e => {
    e.preventDefault();
    const err = document.getElementById('pw-errore');
    if (f.pw1.value !== f.pw2.value) { err.textContent = 'Le due password non coincidono.'; return; }
    try { await auth.impostaPassword(link, f.pw1.value); location.reload(); }
    catch (ex) { err.textContent = ex.message; }
  };
}

// ---------- stato rete ----------
function aggiornaRete(s = {}) {
  const el = document.getElementById('rete');
  const online = navigator.onLine;
  el.classList.toggle('off', !online);
  el.textContent = !online ? '● offline' : s.errore ? '● errore sync' : s.attivo ? '● sincronizzato' : '● solo locale';
}

// ---------- avvio ----------
(async function avvio() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (auth.configurato()) {
    const link = auth.tokenDaLink();
    if (link) return schermataPassword(link);
    if (!(await auth.caricaSessione())) return schermataAccesso();
    window.addEventListener('sessione-scaduta', () => schermataAccesso('La sessione è scaduta o l\'accesso è stato revocato. Rientra.'));
    bf.usaToken(auth.token);
  }
  await primoAvvio();
  await carica();
  db.onCambio(async () => {
    await carica();
    // non ridisegnare la scheda mentre si sta scrivendo
    if (!location.hash.startsWith('#/cotta/')) render();
  });
  window.addEventListener('online', () => aggiornaRete());
  window.addEventListener('offline', () => aggiornaRete());
  sync.onStato(aggiornaRete);
  sync.avvia();
  render();
})();
