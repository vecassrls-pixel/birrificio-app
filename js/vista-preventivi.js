// Pagina "Preventivi" per i beerfirm: elenco dei preventivi salvati, modello base con i costi fissi e scheda del preventivo.
// Calcoli in preventivi.js.

import {
  SEZIONI, STATI, MODELLO_BASE, ID_MODELLO, CATEGORIE_SEZIONE, nuovoDa, calcola, testoCliente, noteConfezionamento, unitaRiga, prezzoRiga, articoloPer, righeDaRicetta,
} from './preventivi.js';
import { storicoPrezzi } from './costi.js';
import * as bf from './brewfather.js';
import { LOGO_KASHMIR } from './logo-kashmir.js';

let u; // { $app, html, raw, db, toast, chiedi, dataIT, numIT, oggiISO, copia }
export function init(strumenti) { u = strumenti; }

const soldi = v => Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = v => `€ ${soldi(v)}`;
const num = v => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const valore = v => (v === '' || v == null ? '' : String(Math.round(Number(v) * 10000) / 10000));
const salva = ({ aggiornato: _a, ...p }) => u.db.salva(p);
const nomeStato = s => (STATI.find(x => x[0] === s) || STATI[0])[1];

const modelloBase = async () => { const m = await u.db.leggi(ID_MODELLO); return m && !m.eliminato ? m : structuredClone(MODELLO_BASE); };

async function nuovo(da) {
  const id = u.db.nuovoId('preventivo');
  const p = nuovoDa(da, id, u.oggiISO());
  await salva(p);
  location.hash = `#/preventivo/${id}`;
}

export async function vistaPreventivi() {
  const { html } = u;
  const tutti = (await u.db.tutti('preventivo')).filter(p => !p.eliminato && !p.modello)
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (a.cliente || '').localeCompare(b.cliente || '', 'it'));
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/birra" class="btn">←<span class="solo-desktop"> Birra</span></a>
      <h1 style="margin:0">Preventivi</h1><span class="spazio"></span>
    </div>
    <div class="scheda solo-editori">
      <h2>Nuovo preventivo per un beerfirm</h2>
      <div class="barra" style="margin:0;align-items:flex-end">
        <label style="max-width:340px">Parti da<select id="pv-da">
          <option value="m:base">Modello base (costi fissi già inseriti)</option>
          ${tutti.length ? html`<optgroup label="Preventivi salvati">${tutti.map(p => html`<option value="p:${p.id}">${p.cliente || 'senza cliente'} · ${p.birra || '—'} · ${u.dataIT(p.data)}</option>`)}</optgroup>` : ''}
        </select></label>
        <button class="primario" id="pv-nuovo">+ Nuovo preventivo</button>
      </div>
      <p class="totale">Il modello base ha già costi di produzione, trasporto, accise, guadagno e formati. Nel preventivo scegli le materie prime (il prezzo arriva dal magazzino) oppure importi una ricetta Brewfather. <a href="#/preventivo/${ID_MODELLO}">Modifica il modello base</a></p>
    </div>
    <div class="scheda">
      ${tutti.length ? html`<div class="scroll-x"><table class="tab-mag tab-preventivi">
        <thead><tr><th>Data</th><th>Cliente</th><th>Birra</th><th class="n pv-extra">Litri</th><th class="n pv-extra">€/L</th><th class="n">Totale</th><th>Stato</th></tr></thead>
        <tbody>${tutti.map(p => {
          const c = calcola(p);
          return html`<tr class="cliccabile" data-apri="${p.id}">
            <td>${u.dataIT(p.data)}</td><td><a href="#/preventivo/${p.id}">${p.cliente || 'senza cliente'}</a></td><td>${p.birra || '—'}</td>
            <td class="n pv-extra">${u.numIT(p.litri, 0)}</td><td class="n pv-extra">${soldi(c.prezzoL)}</td><td class="n"><b>${euro(c.totalePreventivo)}</b></td>
            <td><span class="pv-stato pv-${p.stato || 'bozza'}">${nomeStato(p.stato)}</span></td></tr>`;
        })}</tbody></table></div>`
      : html`<p class="vuoto">Nessun preventivo salvato. Creane uno partendo dal modello base.</p>`}
    </div>`;
  u.$app.onclick = e => {
    if (e.target.closest('#pv-nuovo')) {
      const [t, id] = document.getElementById('pv-da').value.split(':');
      return (t === 'm' ? modelloBase() : Promise.resolve(tutti.find(p => p.id === id))).then(nuovo);
    }
    const r = e.target.closest('tr[data-apri]');
    if (r && !e.target.closest('a')) location.hash = `#/preventivo/${r.dataset.apri}`;
  };
}

function foglioCliente(p, c) {
  const { html } = u;
  const usati = (p.formati || []).map((f, i) => ({ f, x: c.formati[i] })).filter(({ f }) => num(f.qta) > 0);
  return html`<div class="pv-foglio">
    <div class="pv-foglio-testa"><img src="${LOGO_KASHMIR}" alt="Kashmir Brewing Company">
      <div><h2>Preventivo${p.birra ? ` ${p.birra}` : ''}</h2>
      <div>${p.cliente ? html`Per <b>${p.cliente}</b> · ` : ''}${u.dataIT(p.data)} · VECAS SRLS</div></div></div>
    <p>Produzione di <b>${u.numIT(p.litri, 0)} litri</b>.</p>
    ${usati.length ? html`<table class="tab-mag"><thead><tr><th>Formato</th><th class="n">Quantità</th><th class="n">Prezzo unitario</th><th class="n">Totale</th></tr></thead>
      <tbody>${usati.map(({ f, x }) => html`<tr><td>${f.nome}</td><td class="n">${u.numIT(f.qta, 0)}</td><td class="n">${euro(x.unita)}</td><td class="n">${euro(x.totale)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="3"><b>Totale IVA esclusa</b></td><td class="n"><b>${euro(c.totalePreventivo)}</b></td></tr></tfoot></table>
      ${noteConfezionamento(usati.map(({ f }) => f)).map(t => html`<p class="pv-conf" style="margin:6px 0 0">${t}</p>`)}`
    : html`<p class="vuoto">Scrivi le quantità dei formati (lattine, fusti) per vedere il preventivo.</p>`}
    ${p.note ? html`<p class="pv-note">${p.note}</p>` : ''}
  </div>`;
}

export async function vistaPreventivo(id) {
  const { html } = u;
  const rec = id === ID_MODELLO ? await modelloBase() : await u.db.leggi(id);
  if (!rec || rec.eliminato) { u.toast('Preventivo non trovato'); location.hash = '#/preventivi'; return; }
  const p = structuredClone(rec);
  delete p.aggiornato;
  const modello = !!p.modello;
  let c = calcola(p);
  // materie prime del magazzino con l'ultimo prezzo, per proporle e riempire il prezzo quando si scelgono
  const [articoli, bolle] = await Promise.all([u.db.tutti('articolo'), u.db.tutti('bolla')]);
  const arts = articoli.filter(a => !a.eliminato);
  const storico = storicoPrezzi(arts, bolle.filter(b => !b.eliminato));
  const oggi = u.oggiISO();
  const liste = Object.entries(CATEGORIE_SEZIONE).map(([k, cats]) => html`<datalist id="pv-dl-${k}">${arts.filter(a => cats.includes(a.categoria)).sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
    .map(a => { const pr = prezzoRiga(a, unitaRiga(k, a, a.unita), oggi, storico); return html`<option value="${a.nome}" label="${pr ? `${soldi(pr)} €/${unitaRiga(k, a, a.unita)}` : 'senza prezzo'}"></option>`; })}</datalist>`);

  const cella = (k, v) => html`<span data-out="${k}">${v}</span>`;
  const input = (attr, v, extra = '') => html`<input ${u.raw(attr)} type="number" step="any" inputmode="decimal" value="${valore(v)}" ${u.raw(extra)}>`;
  const sezione = s => html`<div class="scheda pv-sezione">
    <div class="barra" style="margin-top:0"><h2 style="margin:0">${s.titolo}</h2><span class="spazio"></span><b>${cella(`sez-${s.k}`, euro(c.sezioni[s.k].totale))}</b></div>
    <div class="scroll-x"><table class="tab-edit tab-pv">
      <thead><tr><th>Voce</th><th class="n">${s.qta}</th><th class="n">${s.prezzo}</th><th class="n">Totale</th><th></th></tr></thead>
      <tbody>${(p[s.k] || []).map((r, i) => html`<tr class="${num(r.qta) ? '' : 'pv-zero'}">
        <td><input data-r="${s.k}|${i}|nome" value="${r.nome}" ${CATEGORIE_SEZIONE[s.k] ? u.raw(`list="pv-dl-${s.k}" autocomplete="off"`) : ''}></td>
        <td>${input(`data-r="${s.k}|${i}|qta"`, r.qta)}${s.k === 'lievito' && r.unita ? html`<span class="totale pv-unita">${r.unita}</span>` : ''}</td>
        <td>${input(`data-r="${s.k}|${i}|prezzo"`, r.prezzo)}</td>
        <td class="n">${cella(`r-${s.k}-${i}`, soldi(c.sezioni[s.k].righe[i]))}</td>
        <td class="az"><button class="piccolo" data-del="${s.k}|${i}" title="Togli la voce">✕</button></td></tr>`)}</tbody>
    </table></div>
    <button class="piccolo" data-add="${s.k}">+ Voce</button>
  </div>`;

  const disegna = () => {
    c = calcola(p);
    u.$app.innerHTML = html`
      <div class="barra non-stampa">
        <a href="#/preventivi" class="btn">←<span class="solo-desktop"> Preventivi</span></a>
        <h1 style="margin:0">${modello ? 'Modello base' : 'Preventivo'}</h1><span class="spazio"></span>
        ${modello ? '' : html`<button id="pv-copia" title="Testo per WhatsApp o mail, senza i costi interni">⧉ Copia per il cliente</button>
        <button class="primario" id="pv-stampa">Stampa / PDF</button>`}
      </div>
      ${liste}
      <div class="pv-modifica non-stampa">
        ${modello ? html`<div class="scheda avviso"><p style="margin:0">Questo è il modello da cui partono i nuovi preventivi: scrivi qui i costi fissi (produzione, trasporto, accise, guadagno, formati). Le modifiche valgono per i preventivi nuovi, non per quelli già fatti.</p></div>` : ''}
        <div class="scheda">
          ${modello ? '' : html`<div class="barra" style="margin-top:0;flex-wrap:wrap" id="pv-bf">
            <button class="piccolo" id="pv-ricette" title="Prende malti, luppoli, lievito, additivi, litri e °Plato dalla ricetta">⬇ Importa ricetta Brewfather</button>
            <span id="pv-ricetta-scelta" class="barra" style="margin:0;flex:1"></span>
          </div>`}
          <div class="griglia">
            <label>Cliente (beerfirm)<input data-f="cliente" value="${p.cliente || ''}" placeholder="nome del beerfirm"></label>
            <label>Birra<input data-f="birra" value="${p.birra || ''}"></label>
            <label>Data<input data-f="data" type="date" value="${p.data || ''}"></label>
            <label>Stato<select data-f="stato">${STATI.map(([v, n]) => html`<option value="${v}" ${p.stato === v ? 'selected' : ''}>${n}</option>`)}</select></label>
            <label>Litri finali${input('data-f="litri"', p.litri)}</label>
          </div>
        </div>
        ${SEZIONI.map(sezione)}
        <div class="scheda">
          <div class="barra" style="margin-top:0"><h2 style="margin:0">Accise</h2><span class="spazio"></span><b>${cella('accise', euro(c.accise))}</b></div>
          <div class="griglia">
            <label>Ettolitri${input('data-f="hl"', p.hl)}</label>
            <label>Grado Plato${input('data-f="plato"', p.plato)}</label>
            <label>€ per hl·°P${input('data-f="aliquota"', p.aliquota)}</label>
          </div>
          <p class="totale">${cella('hlplato', `${u.numIT(c.hlPlato, 1)} hl·°P`)} × aliquota (1,49 € per hl·°P per i microbirrifici).</p>
        </div>
        <div class="scheda pv-riepilogo">
          <h2>Riepilogo</h2>
          <dl class="pv-conti">
            <dt>Costo della cotta</dt><dd>${cella('totale', euro(c.totale))}</dd>
            <dt>Costo al litro</dt><dd>${cella('costoL', euro(c.costoL))}</dd>
            <dt>Guadagno</dt><dd>${input('data-f="guadagno"', p.guadagno, 'class="pv-guadagno"')}</dd>
            <dt><b>Preventivo</b></dt><dd><b>${cella('preventivo', euro(c.preventivo))}</b></dd>
            <dt><b>Prezzo al litro</b></dt><dd><b>${cella('prezzoL', euro(c.prezzoL))}</b></dd>
          </dl>
        </div>
        <div class="scheda">
          <h2>Formati</h2>
          <div class="scroll-x"><table class="tab-edit tab-pv tab-formati">
            <thead><tr><th>Formato</th><th class="n">Litri</th><th class="n" title="Lattina + cartone, oppure fusto">Contenitore €</th><th class="n">Lavoro €</th><th class="n">Quantità</th><th class="n">Prezzo unità</th><th class="n">Totale</th><th></th></tr></thead>
            <tbody>${(p.formati || []).map((f, i) => html`<tr class="${num(f.qta) ? '' : 'pv-zero'}">
              <td><input data-fo="${i}|nome" value="${f.nome}"></td>
              <td>${input(`data-fo="${i}|litri"`, f.litri)}</td>
              <td>${input(`data-fo="${i}|contenitore"`, f.contenitore)}</td>
              <td>${input(`data-fo="${i}|lavoro"`, f.lavoro)}</td>
              <td>${input(`data-fo="${i}|qta"`, f.qta)}</td>
              <td class="n">${cella(`fo-u-${i}`, soldi(c.formati[i].unita))}</td>
              <td class="n">${cella(`fo-t-${i}`, soldi(c.formati[i].totale))}</td>
              <td class="az"><button class="piccolo" data-del="formati|${i}" title="Togli il formato">✕</button></td></tr>`)}</tbody>
            <tfoot><tr><td colspan="6"><b>Totale preventivo</b></td><td class="n"><b>${cella('totPrev', euro(c.totalePreventivo))}</b></td><td></td></tr></tfoot>
          </table></div>
          <button class="piccolo" data-add="formati">+ Formato</button>
          <p class="totale">Prezzo unità = prezzo al litro × litri del formato + contenitore + lavoro (la lattina conta 1/3 di litro).
            ${cella('litriConf', '')}</p>
          <label>Note per il cliente<textarea data-f="note" rows="3">${p.note || ''}</textarea></label>
        </div>
        ${modello ? '' : html`<div class="barra">
          <button class="piccolo" id="pv-duplica">Duplica</button><span class="spazio"></span>
          <button class="piccolo pericolo" id="pv-elimina">Elimina preventivo</button>
        </div>`}
      </div>
      ${modello ? '' : html`<details class="scheda pv-anteprima" open><summary><b>Come lo vede il cliente</b></summary><div data-out="foglio"></div></details>`}`;
    aggiorna();
  };

  // ricalcola i totali senza ridisegnare la pagina (così il cursore resta dov'è)
  const aggiorna = () => {
    c = calcola(p);
    const out = {
      accise: euro(c.accise), hlplato: `${u.numIT(c.hlPlato, 1)} hl·°P`, totale: euro(c.totale), costoL: euro(c.costoL),
      preventivo: euro(c.preventivo), prezzoL: euro(c.prezzoL), totPrev: euro(c.totalePreventivo),
    };
    for (const s of SEZIONI) {
      out[`sez-${s.k}`] = euro(c.sezioni[s.k].totale);
      c.sezioni[s.k].righe.forEach((v, i) => { out[`r-${s.k}-${i}`] = soldi(v); });
    }
    c.formati.forEach((f, i) => { out[`fo-u-${i}`] = soldi(f.unita); out[`fo-t-${i}`] = soldi(f.totale); });
    const litri = num(p.litri);
    out.litriConf = c.litriConfezionati
      ? `Confezionati ${u.numIT(c.litriConfezionati, 0)} L su ${u.numIT(litri, 0)} L${c.litriConfezionati > litri + 0.5 ? ' ⚠ più dei litri finali' : ''}.`
      : '';
    for (const el of u.$app.querySelectorAll('[data-out]')) {
      if (el.dataset.out === 'foglio') el.innerHTML = foglioCliente(p, c).s;
      else if (el.dataset.out in out) el.textContent = out[el.dataset.out];
    }
    const lc = u.$app.querySelector('[data-out="litriConf"]');
    if (lc) lc.classList.toggle('pv-troppi', c.litriConfezionati > litri + 0.5);
  };

  let timer = null;
  const salvaPoi = () => { clearTimeout(timer); timer = setTimeout(() => salva(p), 400); };
  const ridisegna = async () => { clearTimeout(timer); await salva(p); disegna(); };

  u.$app.oninput = e => {
    const t = e.target;
    const numerico = t.type === 'number';
    const v = numerico ? num(t.value) : t.value;
    if (t.dataset.f) p[t.dataset.f] = v;
    else if (t.dataset.r) { const [k, i, campo] = t.dataset.r.split('|'); p[k][i][campo] = v; }
    else if (t.dataset.fo) { const [i, campo] = t.dataset.fo.split('|'); p.formati[i][campo] = v; }
    else return;
    const riga = t.closest('tr');
    if (riga && numerico) riga.classList.toggle('pv-zero', !num(riga.querySelector('[data-r$="|qta"],[data-fo$="|qta"]')?.value));
    aggiorna();
    salvaPoi();
  };
  // scelta una materia prima del magazzino: nome giusto, unità e ultimo prezzo (poi resta modificabile)
  u.$app.onchange = e => {
    const t = e.target;
    if (!t.dataset.r) return;
    const [k, i, campo] = t.dataset.r.split('|');
    if (campo !== 'nome' || !CATEGORIE_SEZIONE[k]) return;
    const art = articoloPer(k, arts, t.value);
    if (!art) return;
    const r = p[k][i];
    r.nome = art.nome;
    r.unita = unitaRiga(k, art, art.unita);
    const pr = prezzoRiga(art, r.unita, oggi, storico);
    if (pr !== null) r.prezzo = pr;
    else u.toast(`${art.nome}: nessun prezzo in magazzino, scrivilo a mano`);
    ridisegna();
  };
  u.$app.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pv-ricette') {
      b.disabled = true; b.textContent = 'Carico le ricette…';
      try {
        const proxy = (await u.db.meta('brewfatherProxy')) || bf.PROXY_DEFAULT;
        const ricette = await bf.elencoRicette(proxy);
        const pre = ricette.find(r => p.birra && bf.nomiSimili(r.nome, p.birra))?.id || '';
        document.getElementById('pv-ricetta-scelta').innerHTML = html`<select id="pv-ricetta" style="width:auto;flex:1;min-width:200px"><option value="">Scegli la ricetta…</option>
          ${ricette.map(r => html`<option value="${r.id}" ${r.id === pre ? 'selected' : ''}>${r.nome}${r.stile ? ` · ${r.stile}` : ''}</option>`)}</select>
          <button class="piccolo primario" id="pv-ricetta-ok">Importa</button>`.s;
        b.textContent = '⬇ Importa ricetta Brewfather';
      } catch (err) {
        b.disabled = false; b.textContent = 'Riprova';
        u.toast(/fetch|Failed/i.test(err.message) ? 'Brewfather non raggiungibile: serve internet' : err.message);
      }
      return;
    }
    if (b.id === 'pv-ricetta-ok') {
      const sel = document.getElementById('pv-ricetta');
      if (!sel.value) return u.toast('Scegli prima la ricetta');
      const nome = sel.selectedOptions[0].textContent.split(' · ')[0];
      const pieno = ['malti', 'luppoli', 'lievito'].some(k => (p[k] || []).length);
      if (pieno && !(await u.chiedi(`Sostituire malti, luppoli, lievito e additivi con quelli della ricetta ${nome}? Costi, accise e formati restano.`, 'Importa'))) return;
      b.disabled = true; b.textContent = 'Importo…';
      try {
        const proxy = (await u.db.meta('brewfatherProxy')) || bf.PROXY_DEFAULT;
        const r = await bf.scaricaRicetta(proxy, sel.value);
        const x = bf.ricettaPerCotta({ fermentazione: [] }, r);
        Object.assign(p, righeDaRicetta(x, arts, oggi, storico));
        if (!p.birra) p.birra = r.name || nome;
        if (Number(x.litri) > 0) { p.litri = x.litri; p.hl = Math.round(x.litri) / 100; }
        if (Number(x.og) > 0) p.plato = Math.round(x.og * 10) / 10;
        const senza = ['malti', 'luppoli', 'lievito'].flatMap(k => p[k]).filter(r => !(Number(r.prezzo) > 0)).length;
        u.toast(`Ricetta ${nome} importata${senza ? `: ${senza} ${senza === 1 ? 'voce' : 'voci'} senza prezzo in magazzino` : ''}`);
        await ridisegna();
      } catch (err) {
        b.disabled = false; b.textContent = 'Importa';
        u.toast(err.message);
      }
      return;
    }
    if (b.dataset.add) {
      const k = b.dataset.add;
      p[k] = [...(p[k] || []), k === 'formati' ? { nome: 'Bottiglie 0,33 L', litri: 0.33, contenitore: 0, lavoro: 0, qta: 0 } : { nome: '', qta: k === 'malti' || k === 'luppoli' ? 0 : 1, prezzo: 0 }];
      await ridisegna();
      const righe = u.$app.querySelectorAll(k === 'formati' ? '[data-fo$="|nome"]' : `[data-r^="${k}|"][data-r$="|nome"]`);
      setTimeout(() => righe[righe.length - 1]?.focus(), 0);
      return;
    }
    if (b.dataset.del) {
      const [k, i] = b.dataset.del.split('|');
      p[k].splice(Number(i), 1);
      return ridisegna();
    }
    if (b.id === 'pv-copia') return u.copia(testoCliente(p, c, u.dataIT), 'Preventivo copiato: incollalo nel messaggio o nella mail');
    if (b.id === 'pv-stampa') {
      const titolo = document.title;
      document.title = `Preventivo ${p.birra || ''} ${p.cliente || ''} ${p.data || ''}`.replace(/\s+/g, ' ').trim();
      addEventListener('afterprint', () => { document.title = titolo; }, { once: true });
      u.$app.querySelector('.pv-anteprima').open = true;
      return window.print();
    }
    if (b.id === 'pv-duplica') { clearTimeout(timer); await salva(p); return nuovo(p); }
    if (b.id === 'pv-elimina') {
      if (!(await u.chiedi(`Eliminare il preventivo${p.cliente ? ` per ${p.cliente}` : ''}?`, 'Elimina'))) return;
      clearTimeout(timer);
      await u.db.elimina(p.id);
      u.toast('Preventivo eliminato');
      location.hash = '#/preventivi';
    }
  };
  disegna();
  return () => { if (timer) { clearTimeout(timer); salva(p); } };
}
