// Pagina "Costi": costo di ogni lotto (materie prime + altri costi), costo al litro, ricavo e margine;
// prezzi delle materie prime e prezzi di vendita. Più il riquadro "Costo" della scheda cotta.

import { ID_PREZZI, prezziDa, storicoPrezzi, prezzoArticolo, contoLotto, chiaveFormato } from './costi.js';
import { CATEGORIE, decimaliUnita, scarichiCotte } from './magazzino.js';
import { gruppoCotta, lottoGruppo, nomeBirra } from './dominio.js';

let u; // { $app, html, raw, db, toast, stato, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const filtri = { anno: String(new Date().getFullYear()) };
const euro = (n, dec = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`);
const FORMATI = { fusto: 'Fusto', 'lattina/bottiglia': 'Lattina' };
const nomeFormato = (tipo, litri) => `${FORMATI[tipo] || tipo} ${u.numIT(litri, litri < 1 ? 2 : 0)} L`;

export async function datiCosti() {
  const [articoli, bolle, rec] = await Promise.all([u.db.tutti('articolo'), u.db.tutti('bolla'), u.db.leggi(ID_PREZZI)]);
  return { articoli, bolle, storico: storicoPrezzi(articoli, bolle), prezzi: prezziDa(rec && !rec.eliminato ? rec : null) };
}
const salvaPrezzi = prezzi => u.db.salva({ ...prezzi, id: ID_PREZZI, tipo: 'impostazione' });

// ---------- riquadro nella scheda cotta ----------
export function htmlCosto(c, cotte, dati) {
  const { html } = u;
  if (!dati || !c.data) return '';
  const conto = contoLotto(c, cotte, dati);
  const mio = conto.costi[conto.gruppo.findIndex(x => x.id === c.id)] || conto.costi[0];
  const doppia = conto.gruppo.length > 1;
  const futura = c.data > u.oggiISO();
  return html`<div class="scheda" id="sez-costo">
    <h2>Costo${doppia ? html` <span class="totale">· lotto ${lottoGruppo(conto.gruppo)}</span>` : ''}</h2>
    <div class="kpi">
      <div><b>${mio.righe.length || mio.altri ? euro(mio.totale) : '—'}</b>${doppia ? 'questa cotta' : 'costo cotta'}</div>
      ${doppia ? html`<div><b>${euro(conto.costo)}</b>costo lotto</div>` : ''}
      <div><b>${conto.perLitro === null || !conto.costo ? '—' : euro(conto.perLitro)}</b>al litro${conto.litriStimati ? ' (litri in FV)' : ' confezionato'}</div>
      ${conto.ricavo !== null ? html`<div><b>${euro(conto.ricavo, 0)}</b>ricavo${conto.ricavoParziale ? ' parziale' : ''}</div>
        <div><b class="${conto.margine < 0 ? 'neg' : ''}">${euro(conto.margine, 0)}</b>margine (${u.numIT(conto.margine / conto.ricavo * 100, 0)}%)</div>` : ''}
    </div>
    ${mio.righe.length ? html`<details class="st-tabella"><summary>Dettaglio materie prime${futura ? ' (prezzi di oggi)' : ''}</summary><div class="scroll-x"><table class="tab-mag">
      <thead><tr><th>Articolo</th><th class="n">Quantità</th><th class="n">Prezzo</th><th class="n">Costo</th></tr></thead>
      <tbody>${mio.righe.map(r => html`<tr><td><a href="#/materia/${encodeURIComponent(r.articolo.id)}">${r.nome}</a></td>
        <td class="n">${u.numIT(r.qta, decimaliUnita(r.unita))} ${r.unita}</td>
        <td class="n">${euro(r.prezzo, r.prezzo < 0.1 ? 4 : 2)}/${r.unita}${r.fonte === 'articolo' ? html` <span class="totale" title="Prezzo della scheda articolo">*</span>` : ''}</td>
        <td class="n">${euro(r.costo)}</td></tr>`)}
        ${mio.altri ? html`<tr><td>Altri costi per cotta</td><td></td><td></td><td class="n">${euro(mio.altri)}</td></tr>` : ''}</tbody></table></div></details>` : ''}
    ${conto.mancanti.length ? (() => {
      const per = new Map();
      for (const m of conto.mancanti) per.set(m.motivo, new Set([...(per.get(m.motivo) || []), m.nome]));
      return html`<p class="totale">⚠ Non contati: ${[...per].map(([motivo, nomi], i) => html`${i ? ' · ' : ''}${nomi.size} ${motivo} (${[...nomi].join(', ')})`)}. <a href="#/costi">Prezzi</a> · <a href="#/materie-prime">Collega al magazzino</a></p>`;
    })() : ''}
  </div>`;
}

// ---------- pagina Costi ----------
export async function vistaCosti() {
  const { html } = u;
  const dati = await datiCosti();
  const cotte = u.stato.cotte;
  const anni = [...new Set(cotte.map(c => c.anno).filter(Boolean))].sort((a, b) => b - a);
  // un lotto per gruppo (cotte doppie/triple), le cotte dell'anno scelto
  const visti = new Set();
  const lotti = [];
  for (const c of [...cotte].filter(c => c.data && (!filtri.anno || String(c.anno) === filtri.anno)).sort((a, b) => b.data.localeCompare(a.data))) {
    if (visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    lotti.push({ c: g[0], conto: contoLotto(g[0], cotte, dati) });
  }
  // nei totali solo i lotti fatti con tutti gli ingredienti a prezzo, per non falsare il costo al litro
  const fattiTutti = lotti.filter(x => x.c.data <= u.oggiISO());
  const fatti = fattiTutti.filter(x => !x.conto.mancanti.length && x.conto.costo > 0);
  const tot = fatti.reduce((t, x) => ({ costo: t.costo + x.conto.costo, litri: t.litri + (x.conto.litri || 0), ricavo: t.ricavo + (x.conto.ricavo || 0), margine: t.margine + (x.conto.margine || 0) }), { costo: 0, litri: 0, ricavo: 0, margine: 0 });

  // articoli usati dalle cotte dell'anno: per completare i prezzi
  const usati = new Map();
  for (const s of scarichiCotte(lotti.flatMap(x => x.conto.gruppo), dati.articoli)) if (s.articolo) usati.set(s.articolo.id, s.articolo);
  const articoli = [...usati.values()].sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nome.localeCompare(b.nome, 'it'));
  const senzaPrezzo = articoli.filter(a => !prezzoArticolo(a, null, dati.storico)).length;
  // formati venduti (dal confezionamento di tutte le cotte)
  const formati = new Map();
  for (const c of cotte) for (const r of c.confezionato || []) if (r.litri) formati.set(chiaveFormato(r.tipo, r.litri), { tipo: r.tipo || 'fusto', litri: Number(r.litri) });
  const perBirra = Object.entries(dati.prezzi.vendita).filter(([k]) => !k.startsWith('*|'));
  const birre = [...new Set(cotte.map(c => nomeBirra(c.birra)).filter(Boolean))].sort();

  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/statistiche" class="btn">← Statistiche</a>
      <h1 style="margin:0">Costi</h1><span class="spazio"></span>
      <select id="co-anno" class="st-libero" style="width:auto"><option value="">Tutti gli anni</option>
        ${anni.map(a => html`<option ${String(a) === filtri.anno ? 'selected' : ''}>${a}</option>`)}</select>
    </div>
    <div class="st-kpi">
      <div class="st-tile"><span>Costo cotte fatte</span><b>${euro(tot.costo, 0)}</b><small>${fatti.length} lotti con tutti i prezzi${fattiTutti.length > fatti.length ? ` su ${fattiTutti.length}` : ''}</small></div>
      <div class="st-tile"><span>Costo medio al litro</span><b>${tot.litri ? euro(tot.costo / tot.litri) : '—'}</b><small>${u.numIT(tot.litri, 0)} L</small></div>
      <div class="st-tile"><span>Ricavo stimato</span><b>${tot.ricavo ? euro(tot.ricavo, 0) : '—'}</b><small>dal confezionato × prezzi</small></div>
      <div class="st-tile"><span>Margine</span><b>${tot.ricavo ? euro(tot.margine, 0) : '—'}</b><small>${tot.ricavo ? `${u.numIT(tot.margine / tot.ricavo * 100, 0)}% del ricavo` : 'mancano i prezzi di vendita'}</small></div>
    </div>
    ${senzaPrezzo ? html`<p class="totale">⚠ ${senzaPrezzo} materie prime usate quest'anno non hanno un prezzo: i loro costi non sono contati. Scrivilo qui sotto o nelle bolle.</p>` : ''}
    <div class="scheda"><h2>Lotti</h2>
      ${lotti.length ? html`<div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Data</th><th>Lotto</th><th>Birra</th><th class="n">Litri</th><th class="n">Costo</th><th class="n">€/L</th><th class="n">Ricavo</th><th class="n">Margine</th></tr></thead>
        <tbody>${lotti.map(({ c, conto }) => html`<tr class="${c.data > u.oggiISO() ? 'futuro' : ''}">
          <td>${u.dataIT(c.data)}</td>
          <td><a href="#/cotta/${encodeURIComponent(c.id)}">${lottoGruppo(conto.gruppo)}</a></td>
          <td>${c.birra}${conto.mancanti.length ? html` <span class="totale" title="${[...new Set(conto.mancanti.map(m => m.nome))].join(', ')}">⚠ ${conto.mancanti.length}</span>` : ''}</td>
          <td class="n">${u.numIT(conto.litri, 0)}${conto.litriStimati ? html`<span class="totale" title="Litri in FV: non ancora confezionata">*</span>` : ''}</td>
          <td class="n">${conto.costo ? euro(conto.costo, 0) : '—'}</td>
          <td class="n"><b>${conto.perLitro === null || !conto.costo ? '—' : euro(conto.perLitro)}</b></td>
          <td class="n">${conto.ricavo === null ? '—' : euro(conto.ricavo, 0)}</td>
          <td class="n ${conto.margine < 0 ? 'neg' : ''}">${conto.margine === null ? '—' : euro(conto.margine, 0)}</td>
        </tr>`)}</tbody></table></div>
        <p class="totale">* litri in fermentatore (stima) finché la cotta non è confezionata. Le cotte future sono calcolate con i prezzi di oggi. ⚠ = ingredienti senza prezzo o non collegati al magazzino.</p>`
      : html`<p class="totale">Nessuna cotta.</p>`}
    </div>
    <div class="scheda solo-editori"><h2>Altri costi</h2>
      <div class="griglia"><label>Altri costi per ogni cotta (€)<input id="co-altri" type="number" step="any" inputmode="decimal" value="${dati.prezzi.altriCostiCotta || ''}" placeholder="es. energia, CO₂, pulizie"></label></div>
    </div>
    <div class="scheda"><h2>Prezzi di vendita</h2>
      <p class="totale">Prezzo di un pezzo (fusto, lattina) senza IVA. Serve per ricavo e margine (i <a href="#/listini">listini</a> hanno i loro prezzi, nel listino Alpha).</p>
      ${formati.size ? html`<div class="scroll-x"><table class="tab-edit"><thead><tr><th>Formato</th><th style="width:150px">€ al pezzo</th><th class="n">€ al litro</th></tr></thead>
        <tbody>${[...formati].sort((a, b) => a[1].tipo.localeCompare(b[1].tipo) || b[1].litri - a[1].litri).map(([k, f]) => html`<tr>
          <td>${nomeFormato(f.tipo, f.litri)}</td>
          <td><input data-vendita="${k}" type="number" step="any" inputmode="decimal" value="${dati.prezzi.vendita[k] ?? ''}"></td>
          <td class="n">${dati.prezzi.vendita[k] ? euro(dati.prezzi.vendita[k] / f.litri) : '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="totale">Nessun confezionamento registrato.</p>`}
      <details class="st-tabella" ${perBirra.length ? 'open' : ''}><summary>Prezzi diversi per una birra</summary>
        ${perBirra.length ? html`<div class="scroll-x"><table class="tab-edit"><thead><tr><th>Birra</th><th>Formato</th><th style="width:150px">€ al pezzo</th><th></th></tr></thead>
          <tbody>${perBirra.map(([k, p]) => { const [b, t, l] = k.split('|'); return html`<tr><td>${b}</td><td>${nomeFormato(t, Number(l))}</td>
            <td><input data-vendita="${k}" type="number" step="any" inputmode="decimal" value="${p ?? ''}"></td>
            <td class="az"><button class="piccolo" data-togli="${k}" title="Usa il prezzo del formato">✕</button></td></tr>`; })}</tbody></table></div>` : ''}
        <div class="barra solo-editori" style="margin-top:8px">
          <select id="co-birra" style="flex:1;min-width:150px"><option value="">Birra…</option>${birre.map(b => html`<option>${b}</option>`)}</select>
          <select id="co-formato" style="flex:1;min-width:150px">${[...formati].map(([k, f]) => html`<option value="${k.slice(2)}">${nomeFormato(f.tipo, f.litri)}</option>`)}</select>
          <button class="piccolo" id="co-aggiungi">+ Prezzo per la birra</button>
        </div>
      </details>
    </div>
    <div class="scheda"><h2>Prezzi delle materie prime</h2>
      <p class="totale">Il costo usa il prezzo dell'ultima bolla fino al giorno della cotta (colonna €/unità nella bolla). Il prezzo qui sotto vale per gli articoli senza prezzo nelle bolle.</p>
      ${articoli.length ? html`<div class="scroll-x"><table class="tab-edit"><thead><tr><th>Articolo</th><th>Ultimo prezzo da bolla</th><th style="width:170px">Prezzo scheda (€/unità)</th></tr></thead>
        <tbody>${articoli.map(a => {
          const v = dati.storico.get(a.id) || [];
          const ul = v[v.length - 1];
          return html`<tr class="${!ul && !(a.prezzo > 0) ? 'basso' : ''}">
            <td><a href="#/materia/${encodeURIComponent(a.id)}">${a.nome}</a> <span class="totale">${CATEGORIE[a.categoria] || ''}</span></td>
            <td>${ul ? html`${euro(ul.prezzo, ul.prezzo < 0.1 ? 4 : 2)}/${a.unita} <span class="totale">${u.dataIT(ul.data)} ${ul.fornitore}</span>` : '—'}</td>
            <td><div style="display:flex;gap:6px;align-items:center"><input data-prezzo="${a.id}" type="number" step="any" inputmode="decimal" value="${a.prezzo ?? ''}"><span class="totale">/${a.unita}</span></div></td></tr>`;
        })}</tbody></table></div>` : html`<p class="totale">Nessuna cotta collegata al magazzino in questo periodo.</p>`}
    </div>`;

  u.$app.onchange = async e => {
    const t = e.target;
    if (t.id === 'co-anno') { filtri.anno = t.value; return vistaCosti(); }
    const num = t.value === '' ? null : Number(t.value);
    if (t.id === 'co-altri') { await salvaPrezzi({ ...dati.prezzi, altriCostiCotta: num || 0 }); u.toast('Salvato'); return vistaCosti(); }
    if (t.dataset.vendita) {
      const vendita = { ...dati.prezzi.vendita };
      if (num === null) delete vendita[t.dataset.vendita]; else vendita[t.dataset.vendita] = num;
      await salvaPrezzi({ ...dati.prezzi, vendita });
      u.toast('Prezzo salvato');
      return vistaCosti();
    }
    if (t.dataset.prezzo) {
      const a = dati.articoli.find(x => x.id === t.dataset.prezzo);
      await u.db.salva({ ...a, prezzo: num });
      u.toast(`Prezzo di ${a.nome} salvato`);
      return vistaCosti();
    }
  };
  u.$app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'co-aggiungi') {
      const b = document.getElementById('co-birra').value, f = document.getElementById('co-formato').value;
      if (!b || !f) return u.toast('Scegli birra e formato');
      const k = `${b}|${f}`;
      if (dati.prezzi.vendita[k] === undefined) await salvaPrezzi({ ...dati.prezzi, vendita: { ...dati.prezzi.vendita, [k]: dati.prezzi.vendita[`*|${f}`] ?? null } });
      return vistaCosti();
    }
    if (t.dataset.togli) {
      const vendita = { ...dati.prezzi.vendita };
      delete vendita[t.dataset.togli];
      await salvaPrezzi({ ...dati.prezzi, vendita });
      return vistaCosti();
    }
  };
}
