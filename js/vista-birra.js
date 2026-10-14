// Pagine "Birra": magazzino della birra confezionata con lotti e scadenze.
// Carico dal confezionamento delle cotte; scarico manuale o importato da Fatture in Cloud e Shopify.
// Riceve da app.js gli strumenti condivisi (html, db, toast…) come vista-magazzino.js.

import { LOGO_KASHMIR } from './logo-kashmir.js';
import {
  ID_IMPOSTAZIONI, FORMATI, confezionamenti, MOTIVI_SCARICO, MOTIVI_CARICO, ORIGINI, nomeMotivo, testoScontrino, impostazioniDa, giacenzeBirra, elencoProdotti, nomeProdotto,
  nomeFormato, registroBirra, trovaProdotto, conCodice, idProdotto, chiaveProdotto, daChiave, indovinaProdotto,
} from './birra.js';
import { nomeBirra } from './dominio.js';
import { statoScadenza, GIORNI_IN_SCADENZA } from './magazzino.js';

let u; // { $app, html, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni, token }
export function init(strumenti) { u = strumenti; }

async function datiBirra() {
  const [movimenti, inventari, prodotti, imp] = await Promise.all([
    u.db.tutti('movbirra'), u.db.tutti('inventariobirra'), u.db.tutti('prodottobirra'), u.db.leggi(ID_IMPOSTAZIONI),
  ]);
  return { cotte: u.stato.cotte, durate: u.stato.durate, movimenti, inventari, prodotti, impostazioni: imp && !imp.eliminato ? imp : null };
}
export async function impostazioniBirra() { return impostazioniDa(await u.db.leggi(ID_IMPOSTAZIONI)); }
async function salvaImpostazioni(patch) {
  const rec = (await u.db.leggi(ID_IMPOSTAZIONI)) || { id: ID_IMPOSTAZIONI, tipo: 'impostazione' };
  const { aggiornato: _a, ...r } = rec;
  await u.db.salva({ ...r, ...patch });
}

function scad(data) {
  if (!data) return '—';
  const st = statoScadenza(data, u.oggiISO());
  return u.html`<span class="scad ${st || ''}" title="${st === 'scaduto' ? 'Scaduta' : st === 'vicino' ? `Scade entro ${GIORNI_IN_SCADENZA} giorni` : ''}">${u.dataIT(data)}</span>`;
}
const pz = n => `${u.numIT(n, 0)} pz`;
const litri = n => `${u.numIT(n, n < 100 ? 1 : 0)} L`;
const lottiUsati = m => ((m.lotti || []).some(l => l.lotto) ? ` · lotto ${m.lotti.map(l => `${l.lotto || '—'}${m.lotti.length > 1 ? ` (${l.pezzi})` : ''}`).join(' + ')}` : '');
const NASCONDI = 'birra-nascondi-zero';
const leggiPref = () => { try { return localStorage.getItem(NASCONDI) !== '0'; } catch { return true; } };
const scriviPref = v => { try { localStorage.setItem(NASCONDI, v ? '1' : '0'); } catch { /* vale solo ora */ } };
const filtri = { q: '', formato: '' };

// ---------- elenco giacenze ----------
export async function vistaBirra() {
  const { html } = u;
  const dati = await datiBirra();
  const imp = impostazioniDa(dati.impostazioni);
  const g = [...giacenzeBirra(dati).values()];
  const nascondi = leggiPref();
  const q = filtri.q.trim().toLowerCase();
  const righe = g.filter(x => (!nascondi || x.giacenza !== 0) && (!filtri.formato || x.tipo === filtri.formato) && (!q || x.nome.toLowerCase().includes(q)))
    .sort((a, b) => a.birra.localeCompare(b.birra, 'it') || a.tipo.localeCompare(b.tipo) || b.litri - a.litri);
  const tot = tipo => g.filter(x => x.tipo === tipo).reduce((t, x) => t + Math.max(0, x.giacenza), 0);
  const inScadenza = g.filter(x => x.statoScadenza).length;
  const ultimi = [...dati.movimenti].filter(m => !m.ignorato).sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 10);
  let birraPrima = '';

  u.$app.innerHTML = html`
    <div class="barra">
      <div><h1 style="margin:0">Birra</h1><div class="kpi">
        <div><b>${u.numIT(tot('fusto'), 0)}</b>fusti</div>
        <div><b>${u.numIT(tot('lattina/bottiglia'), 0)}</b>lattine</div>
        <div><b>${litri(g.reduce((t, x) => t + Math.max(0, x.litriTot), 0))}</b>in magazzino</div>
        <div><b>${inScadenza}</b>scaduti o in scadenza</div>
      </div></div>
    </div>
    <div class="barra azioni-birra">
      <a class="btn primario" href="#/movbirra/scarico">− Scarico</a>
      <a class="btn" href="#/movbirra/carico">+ Carico</a>
      <a class="btn" href="#/birra-importa/fic">Da Fatture in Cloud</a>
      <a class="btn" href="#/birra-importa/shopify">Da Shopify</a>
      <span class="spazio"></span>
      <a class="btn" href="#/birra-inventario">Inventario</a>
      <a class="btn" href="#/birra-registro">Registro</a>
      <a class="btn" href="#/listini">Listini</a>
      <a class="btn" href="#/preventivi">Preventivi</a>
    </div>
    ${!imp.inizio ? html`<div class="scheda avviso solo-editori"><h2>Per iniziare</h2>
      <p>La birra entra in magazzino da sola quando scrivi il confezionamento nella scheda cotta, ed esce con gli scarichi (a mano, dalle fatture di Fatture in Cloud o dagli ordini Shopify).
      Scegli da che giorno parte il magazzino: i confezionamenti precedenti non contano. Poi fai l'inventario della birra che hai oggi, lotto per lotto.</p>
      <div class="barra" style="margin:0;align-items:flex-end">
        <label style="max-width:200px">Inizio magazzino birra <input type="date" id="b-inizio" value="${u.oggiISO()}"></label>
        <button class="primario" id="b-avvia">Inizia e fai l'inventario</button>
      </div></div>` : ''}
    <div class="barra">
      <input id="b-q" type="search" placeholder="Cerca birra…" value="${filtri.q}" style="flex:2;min-width:160px">
      <select id="b-formato" style="flex:1;min-width:140px"><option value="">Tutti i formati</option>
        ${Object.entries(FORMATI).map(([k, v]) => html`<option value="${k}" ${k === filtri.formato ? 'selected' : ''}>${v}</option>`)}</select>
      <label class="spunta"><input type="checkbox" id="b-zero" ${nascondi ? 'checked' : ''}> Nascondi le birre a 0</label>
    </div>
    <div class="scheda">
      ${righe.length ? html`<div class="scroll-x"><table class="tab-mag tab-birra">
        <thead><tr><th>Birra · formato · lotti</th><th class="n">Pezzi</th><th class="n">Litri</th><th>Scade</th></tr></thead>
        <tbody>${righe.map(x => {
          const nuova = x.birra !== birraPrima;
          birraPrima = x.birra;
          return html`${nuova ? html`<tr class="gruppo-birra"><td colspan="4">${x.birra}</td></tr>` : ''}<tr class="${x.giacenza < 0 ? 'neg' : ''}">
            <td><a href="#/birra-prodotto/${encodeURIComponent(x.chiave)}">${nomeFormato(x.tipo, x.litri)}</a>${x.mancanti ? html` <span class="totale" title="Scaricati più pezzi di quelli caricati: manca un confezionamento o un inventario">⚠</span>` : ''}
              <div class="totale" style="margin:2px 0 0">${x.lotti.map(l => `${l.lotto || 'senza lotto'} (${l.pezzi})`).join(' · ') || '—'}</div></td>
            <td class="n"><b>${u.numIT(x.giacenza, 0)}</b></td>
            <td class="n">${u.numIT(x.litriTot, 0)}</td>
            <td>${scad(x.scadenza)}</td>
          </tr>`;
        })}</tbody></table></div>` : html`<p class="totale">${g.length ? 'Nessuna birra in magazzino con questi filtri.' : 'Nessuna birra: scrivi il confezionamento nella scheda di una cotta.'}</p>`}
    </div>
    ${ultimi.length ? html`<div class="scheda"><h2>Ultimi movimenti</h2><div class="lista">
      ${ultimi.map(m => html`<a class="riga-cotta" href="#/movbirra/${encodeURIComponent(m.id)}">
        <span class="lotto">${u.dataIT(m.data)}</span>
        <span class="birra">${m.verso === 'carico' ? '+' : '−'} ${nomeMotivo(m)}${testoScontrino(m) ? ` · ${testoScontrino(m)}` : ''}${m.cliente ? ` · ${m.cliente}` : ''}${m.documento ? ` · ${m.documento}` : ''}</span>
        <span class="totale" style="margin:0">${(m.righe || []).reduce((t, r) => t + (Number(r.pezzi) || 0), 0)} pz${m.origine && m.origine !== 'manuale' ? ` · ${ORIGINI[m.origine]}` : ''}</span></a>`)}
    </div></div>` : ''}
    ${imp.inizio ? html`<details class="scheda solo-editori"><summary><b>Impostazioni magazzino birra</b></summary>
      <div class="griglia" style="margin-top:10px">
        <label>Inizio magazzino <input type="date" id="b-inizio" value="${imp.inizio}"></label>
      </div>
      <p class="totale">Lotto e scadenza di ogni confezionamento sono quelli dell'etichetta, nella sezione Confezionamento della scheda cotta (scadenza = fine del mese indicato).
      ${imp.codiciIgnorati.length ? html`<br>Righe di fatture/ordini che non sono birra: ${imp.codiciIgnorati.join(', ')} <button class="piccolo" id="b-reset-ign">Dimentica</button>` : ''}</p>
    </details>` : ''}`;
  const $ = s => document.getElementById(s);
  $('b-q').oninput = e => { filtri.q = e.target.value; vistaBirra().then(() => { const el = $('b-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); };
  $('b-formato').onchange = e => { filtri.formato = e.target.value; vistaBirra(); };
  $('b-zero').onchange = e => { scriviPref(e.target.checked); vistaBirra(); };
  const $avvia = $('b-avvia');
  if ($avvia) $avvia.onclick = async () => {
    const inizio = $('b-inizio').value;
    if (!inizio) return u.toast('Scegli la data di inizio');
    await salvaImpostazioni({ inizio });
    location.hash = '#/birra-inventario';
  };
  if (imp.inizio) {
    $('b-inizio').onchange = e => e.target.value && salvaImpostazioni({ inizio: e.target.value }).then(() => u.toast('Inizio salvato')).then(vistaBirra);
    const $reset = $('b-reset-ign');
    if ($reset) $reset.onclick = () => salvaImpostazioni({ codiciIgnorati: [] }).then(vistaBirra);
  }
}

// ---------- scheda prodotto ----------
export async function vistaProdotto(chiave) {
  const { html } = u;
  const dati = await datiBirra();
  const g = giacenzeBirra(dati).get(chiave);
  if (!g) { u.$app.innerHTML = html`<p class="vuoto">Prodotto non trovato. <a href="#/birra">Torna alla birra</a></p>`; return; }
  const rec = dati.prodotti.find(p => p.chiave === chiave);
  const codici = [...(rec?.codici || [])];
  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span>
        <a class="btn" href="#/movbirra/scarico?p=${encodeURIComponent(chiave)}">− Scarico</a></div>
      <div class="scheda">
        <h1 style="margin-top:0">${g.birra} <span class="totale">${nomeFormato(g.tipo, g.litri)}</span></h1>
        <div class="kpi">
          <div><b>${pz(g.giacenza)}</b>in magazzino</div>
          <div><b>${litri(g.litriTot)}</b>litri</div>
          <div><b>${g.lotti.length}</b>lotti</div>
          <div><b>${g.inventario ? u.dataIT(g.inventario.data) : 'mai'}</b>ultimo inventario</div>
        </div>
        ${g.mancanti ? html`<p class="totale">⚠ Sono usciti ${g.mancanti} pezzi in più di quelli caricati: manca un confezionamento o un inventario.</p>` : ''}
      </div>
      <div class="scheda"><h2>Lotti in magazzino</h2>
        ${g.lotti.length ? html`<div class="scroll-x"><table class="tab-mag">
          <thead><tr><th>Lotto</th><th>Scadenza</th><th>Entrato</th><th class="n">Pezzi</th><th class="n">Litri</th></tr></thead>
          <tbody>${g.lotti.map(l => html`<tr><td>${l.lotto || html`<span class="totale">senza lotto</span>`}</td><td>${scad(l.scadenza)}</td>
            <td>${u.dataIT(l.data)} <span class="totale">${l.rif}</span></td><td class="n">${u.numIT(l.pezzi, 0)}</td><td class="n">${u.numIT(l.pezzi * g.litri, 1)}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="totale">Nessun lotto in magazzino.</p>`}
      </div>
      <div class="scheda solo-editori"><h2>Codici in Fatture in Cloud e Shopify</h2>
        <p class="totale">Codice articolo, SKU o descrizione con cui questa birra compare nelle fatture e negli ordini. "Pezzi" = quanti ${g.tipo === 'fusto' ? 'fusti' : 'pezzi'} esce per ogni unità venduta (es. cartone da 24 = 24). Si aggiungono da soli quando colleghi una riga durante l'import.</p>
        <div class="scroll-x"><table class="tab-edit"><thead><tr><th>Codice / SKU / descrizione</th><th style="width:100px">Pezzi</th><th></th></tr></thead>
          <tbody>${codici.map((c, i) => html`<tr><td><input data-c="${i}.codice" value="${c.codice}"></td><td><input data-c="${i}.x" type="number" min="1" step="1" inputmode="numeric" value="${c.x || 1}"></td>
            <td class="az"><button class="piccolo" data-del="${i}" title="Rimuovi">✕</button></td></tr>`)}</tbody></table></div>
        <div class="barra" style="margin-top:8px"><button class="piccolo" id="add-cod">+ Codice</button><span class="spazio"></span><button class="primario" id="salva-cod">Salva codici</button></div>
      </div>
      <div class="scheda"><h2>Movimenti</h2>
        ${g.movimenti.length || g.futuri.length ? html`<div class="scroll-x"><table class="tab-mag">
          <thead><tr><th>Data</th><th>Movimento</th><th class="n">Pezzi</th></tr></thead>
          <tbody>${[...g.futuri.map(m => ({ ...m, futuro: true })), ...g.movimenti].slice(0, 300).map(m => html`<tr class="${m.futuro ? 'futuro' : ''}">
            <td>${u.dataIT(m.data)}</td>
            <td><a href="${m.link}">${m.tipo === 'inventario' ? 'Inventario' : m.rif}</a>${m.tipo === 'carico' ? `${m.lotto ? ` · lotto ${m.lotto}` : ''}${m.scadenza ? ` · scad. ${u.dataIT(m.scadenza)}` : ''}` : m.tipo === 'scarico' ? lottiUsati(m) : ''}${m.futuro ? ' · da fare' : ''}</td>
            <td class="n">${m.tipo === 'inventario' ? '= ' : m.tipo === 'carico' ? '+' : '−'}${u.numIT(m.pezzi, 0)}</td>
          </tr>`)}</tbody></table></div>` : html`<p class="totale">Nessun movimento.</p>`}
      </div>`;
  }
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const c = e.target.dataset.c;
    if (!c) return;
    const [i, k] = c.split('.');
    codici[i][k] = k === 'x' ? Number(e.target.value) || 1 : e.target.value;
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'add-cod') { codici.push({ codice: '', x: 1 }); disegna(); }
    else if (t.dataset.del !== undefined) { codici.splice(Number(t.dataset.del), 1); disegna(); }
    else if (t.id === 'salva-cod') {
      const base = rec || { tipo: 'prodottobirra', id: idProdotto(chiave), chiave };
      const { aggiornato: _a, ...r } = base;
      await u.db.salva({ ...r, codici: codici.filter(c => String(c.codice).trim()).map(c => ({ codice: String(c.codice).trim(), x: Number(c.x) || 1 })) });
      u.toast('Codici salvati');
    }
  };
}

// ---------- carico / scarico manuale ----------
export async function vistaMovimento(id) {
  const { html } = u;
  const [idPuro, query] = id.split('?');
  const dati = await datiBirra();
  const nuovo = idPuro === 'carico' || idPuro === 'scarico';
  const esistente = nuovo ? null : dati.movimenti.find(x => x.id === idPuro);
  if (!nuovo && !esistente) { u.$app.innerHTML = html`<p class="vuoto">Movimento non trovato. <a href="#/birra">Torna alla birra</a></p>`; return; }
  const pre = new URLSearchParams(query || '').get('p') || '';
  const m = esistente ? JSON.parse(JSON.stringify(esistente))
    : { tipo: 'movbirra', verso: idPuro, data: u.oggiISO(), motivo: idPuro === 'carico' ? 'reso' : 'taproom', scontrinato: idPuro === 'carico' ? undefined : false, cliente: '', documento: '', note: '', origine: 'manuale', righe: [{ prodotto: pre, pezzi: null, lotto: '', scadenza: '' }] };
  const carico = () => m.verso === 'carico';
  // giacenze senza questo movimento, per proporre i lotti disponibili
  const g = giacenzeBirra({ ...dati, movimenti: dati.movimenti.filter(x => x.id !== m.id) });
  const prodotti = elencoProdotti(dati);
  const ordinati = () => [...prodotti].sort((a, b) => (carico() ? 0 : ((g.get(b)?.giacenza > 0) - (g.get(a)?.giacenza > 0))) || a.localeCompare(b, 'it'));
  const clienti = [...new Set(dati.movimenti.map(x => x.cliente).filter(Boolean))].sort();

  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span>
        ${esistente ? html`<button class="pericolo" id="elimina">Elimina</button>` : ''}</div>
      <div class="scheda">
        <h1 style="margin-top:0">${esistente ? '' : 'Nuovo '}${carico() ? 'carico' : 'scarico'} di birra</h1>
        ${m.origine && m.origine !== 'manuale' ? html`<p class="totale">Importato da ${ORIGINI[m.origine]}${m.documento ? ` · ${m.documento}` : ''}.</p>` : ''}
        <div class="barra" style="margin:0 0 8px">
          <label class="spunta"><input type="radio" name="verso" value="scarico" ${carico() ? '' : 'checked'}> − Scarico (esce)</label>
          <label class="spunta"><input type="radio" name="verso" value="carico" ${carico() ? 'checked' : ''}> + Carico (entra)</label>
        </div>
        <p class="totale">${carico()
          ? 'Per la birra che rientra senza un confezionamento: reso da un cliente, rettifica. Il confezionamento delle cotte entra da solo.'
          : 'Per la birra che esce dalla taproom, dallo spaccio, agli eventi o in autoconsumo (le vendite con fattura o su Shopify si importano). Se non scegli il lotto esce quello che scade prima.'}</p>
        <div class="griglia">
          <label>Data <input type="date" data-m="data" value="${m.data || ''}"></label>
          <label>Motivo <select data-m="motivo">${Object.entries(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO).map(([k, v]) => html`<option value="${k}" ${k === m.motivo ? 'selected' : ''}>${v}</option>`)}
            ${(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO)[m.motivo] ? '' : html`<option value="${m.motivo}" selected>${nomeMotivo(m)}</option>`}</select></label>
          ${carico() || (m.origine && m.origine !== 'manuale') ? '' : html`<div class="scontrino"><span>Scontrino</span>
            <label class="spunta"><input type="radio" name="scontrinato" value="si" ${m.scontrinato ? 'checked' : ''}> Scontrinato</label>
            <label class="spunta"><input type="radio" name="scontrinato" value="no" ${m.scontrinato ? '' : 'checked'}> Non scontrinato</label></div>`}
          <label style="grid-column:span 2">Cliente <input data-m="cliente" list="dl-cli" value="${m.cliente || ''}"></label>
          <label>Documento (fattura, DDT, ordine) <input data-m="documento" value="${m.documento || ''}"></label>
          <label style="grid-column:span 2">Note <input data-m="note" value="${m.note || ''}"></label>
        </div>
        <datalist id="dl-cli">${clienti.map(x => html`<option value="${x}">`)}</datalist>
      </div>
      <div class="scheda"><h2>Righe</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th>Birra e formato</th><th class="n">In magazzino</th><th style="width:90px">Pezzi</th>${carico() ? html`<th style="width:120px">Lotto</th><th style="width:150px">Scadenza</th>` : html`<th style="width:220px">Lotto</th>`}<th></th></tr></thead>
          <tbody>${m.righe.map((r, i) => {
            const gg = r.prodotto && g.get(r.prodotto);
            return html`<tr>
              <td><select data-r="${i}.prodotto" style="min-width:200px"><option value="">Scegli…</option>
                ${ordinati().map(k => html`<option value="${k}" ${k === r.prodotto ? 'selected' : ''}>${nomeProdotto(k)}${g.get(k)?.giacenza ? ` (${g.get(k).giacenza})` : ''}</option>`)}</select></td>
              <td class="n totale">${gg ? pz(gg.giacenza) : ''}</td>
              <td><input data-r="${i}.pezzi" type="number" min="0" step="1" inputmode="numeric" value="${r.pezzi ?? ''}"></td>
              ${carico() ? html`<td><input data-r="${i}.lotto" value="${r.lotto || ''}" list="dl-lotti-${i}"><datalist id="dl-lotti-${i}">${(gg?.lotti || []).map(l => html`<option value="${l.lotto}">`)}</datalist></td>
                <td><input data-r="${i}.scadenza" type="date" value="${r.scadenza || ''}"></td>`
              : html`<td><select data-r="${i}.lotto"><option value="">Il primo che scade (automatico)</option>
                ${(gg?.lotti || []).filter(l => l.lotto).map(l => html`<option value="${l.lotto}" ${l.lotto === r.lotto ? 'selected' : ''}>${l.lotto} · ${l.pezzi} pz${l.scadenza ? ` · scad. ${u.dataIT(l.scadenza)}` : ''}</option>`)}
                ${r.lotto && !(gg?.lotti || []).some(l => l.lotto === r.lotto) ? html`<option value="${r.lotto}" selected>${r.lotto}</option>` : ''}</select></td>`}
              <td class="az"><button class="piccolo" data-del="${i}" title="Rimuovi">✕</button></td>
            </tr>`;
          })}</tbody>
        </table></div>
        <div class="barra" style="margin-top:8px"><button class="piccolo" id="riga">+ Riga</button><span class="spazio"></span>
          <button class="primario" id="salva">Salva ${carico() ? 'carico' : 'scarico'}</button></div>
      </div>`;
  }
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const t = e.target;
    if (t.name === 'verso' && e.type === 'change') {
      m.verso = t.value;
      m.motivo = Object.keys(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO)[0];
      m.scontrinato = carico() ? undefined : !!m.scontrinato;
      for (const r of m.righe) { r.lotto = ''; r.scadenza = ''; }
      disegna();
      return;
    }
    if (t.name === 'scontrinato') m.scontrinato = t.value === 'si';
    if (t.dataset.m) m[t.dataset.m] = t.value;
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      m.righe[i][k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      if (k === 'prodotto' && e.type === 'change') { m.righe[i].lotto = ''; disegna(); }
      // carico su un lotto già in magazzino: stessa scadenza
      if (k === 'lotto' && carico() && e.type === 'change') {
        const l = g.get(m.righe[i].prodotto)?.lotti.find(x => x.lotto === t.value);
        if (l?.scadenza && !m.righe[i].scadenza) { m.righe[i].scadenza = l.scadenza; disegna(); }
      }
    }
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'riga') { m.righe.push({ prodotto: '', pezzi: null, lotto: '', scadenza: '' }); disegna(); }
    else if (t.dataset.del !== undefined) { m.righe.splice(Number(t.dataset.del), 1); disegna(); }
    else if (t.id === 'elimina') {
      const msg = m.origine && m.origine !== 'manuale'
        ? `Eliminare questo movimento? I pezzi tornano in magazzino e il documento di ${ORIGINI[m.origine]} si potrà importare di nuovo.`
        : carico() ? 'Eliminare questo carico? I pezzi escono dalla giacenza.' : 'Eliminare questo scarico? I pezzi tornano in giacenza.';
      if (!(await u.chiedi(msg, 'Elimina'))) return;
      await u.db.elimina(esistente.id);
      location.hash = '#/birra';
    } else if (t.id === 'salva') {
      const righe = m.righe.filter(r => r.prodotto && Number(r.pezzi) > 0)
        .map(r => ({ prodotto: r.prodotto, pezzi: Number(r.pezzi), lotto: String(r.lotto || '').trim(), ...(carico() ? { scadenza: r.scadenza || '' } : {}) }));
      if (!m.data || !righe.length) return u.toast('Servono la data e almeno una riga con birra e pezzi');
      if (!carico()) {
        const troppo = righe.find(r => r.pezzi > (g.get(r.prodotto)?.giacenza || 0));
        if (troppo && !(await u.chiedi(`${nomeProdotto(troppo.prodotto)}: in magazzino risultano ${g.get(troppo.prodotto)?.giacenza || 0} pezzi, ne stai scaricando ${troppo.pezzi}. Salvare lo stesso?`, 'Salva'))) return;
      }
      const { aggiornato: _a, ...rec } = m;
      await u.db.salva({ ...rec, id: m.id || u.db.nuovoId('movbirra'), righe });
      u.toast(carico() ? 'Carico salvato' : 'Scarico salvato');
      location.hash = '#/birra';
    }
  };
}

// ---------- inventario ----------
export async function vistaInventario() {
  const { html } = u;
  const dati = await datiBirra();
  const g = giacenzeBirra(dati);
  const oggi = u.oggiISO();
  const imp = impostazioniDa(dati.impostazioni);
  // lotti proposti: quelli in magazzino + quelli confezionati nell'ultimo anno (per il primo inventario)
  const proposti = new Map();
  const aggiungi = (prodotto, lotto, scadenza, calcolato) => {
    const k = `${prodotto}§${(lotto || '').toLowerCase()}`;
    const x = proposti.get(k) || { prodotto, lotto: lotto || '', scadenza: scadenza || '', calcolato: 0 };
    x.calcolato += calcolato;
    proposti.set(k, x);
  };
  for (const x of g.values()) for (const l of x.lotti) aggiungi(x.chiave, l.lotto, l.scadenza, l.pezzi);
  const daAnno = u.addGiorni(oggi, -365);
  for (const cf of confezionamenti(dati.cotte, dati.durate)) if (cf.data >= daAnno && cf.data <= oggi) aggiungi(cf.prodotto, cf.lotto, cf.scadenza, 0);
  const righe = [...proposti.values()];
  // birre aggiunte a mano o da Fatture in Cloud, senza lotti: una riga con lotto e scadenza da scrivere
  const senzaLotti = chiavi => { for (const k of chiavi) if (!righe.some(r => r.prodotto === k)) righe.push({ prodotto: k, lotto: '', scadenza: '', calcolato: 0, libero: true }); };
  senzaLotti(dati.prodotti.map(p => p.chiave).filter(Boolean));
  const ordina = () => righe.sort((a, b) => a.prodotto.localeCompare(b.prodotto, 'it') || (a.scadenza || '').localeCompare(b.scadenza || ''));
  ordina();
  const extra = [];
  const data = { v: oggi };
  const prodotti = elencoProdotti(dati);
  const nascondi = { v: true };

  function disegna() {
    let prima = '';
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span></div>
      <div class="scheda">
        <h1 style="margin-top:0">Inventario birra</h1>
        <p class="totale">Scrivi i pezzi contati per ogni lotto. Per una birra in cui scrivi almeno un numero, i lotti lasciati vuoti valgono 0; le birre senza nessun numero non cambiano.
        Da quel giorno la giacenza riparte da qui, poi si aggiungono i confezionamenti e si tolgono gli scarichi.
        Una birra o un formato che non c'è ancora si aggiunge con "+ Nuova birra" in fondo, oppure tutte insieme dai prodotti di Fatture in Cloud.</p>
        <div class="barra" style="margin:0;align-items:flex-end">
          <label style="max-width:200px">Data inventario <input type="date" id="data-inv" value="${data.v}"></label>
          <label class="spunta"><input type="checkbox" id="inv-zero" ${nascondi.v ? 'checked' : ''}> Solo lotti in magazzino o confezionati negli ultimi 12 mesi</label>
        </div>
      </div>
      <div class="scheda"><div class="scroll-x"><table class="tab-edit">
        <thead><tr><th>Birra e formato</th><th>Lotto</th><th>Scadenza</th><th class="n">Calcolato</th><th style="width:110px">Contato</th></tr></thead>
        <tbody>${righe.map((r, i) => {
          const nuovo = r.prodotto !== prima;
          prima = r.prodotto;
          return html`<tr>
            <td>${nuovo ? nomeProdotto(r.prodotto) : ''}</td><td>${r.libero ? html`<input data-i="${i}.lotto" value="${r.lotto || ''}" placeholder="lotto">` : r.lotto || html`<span class="totale">senza lotto</span>`}</td>
            <td><input type="date" data-i="${i}.scadenza" value="${r.scadenza || ''}"></td>
            <td class="n">${r.calcolato ? u.numIT(r.calcolato, 0) : html`<span class="totale">0</span>`}</td>
            <td><input data-i="${i}.contato" type="number" min="0" step="1" inputmode="numeric" value="${r.contato ?? ''}"></td></tr>`;
        })}
        ${extra.map((r, i) => html`<tr>
          <td><select data-x="${i}.prodotto"><option value="">Scegli…</option>${prodotti.map(k => html`<option value="${k}" ${k === r.prodotto ? 'selected' : ''}>${nomeProdotto(k)}</option>`)}</select></td>
          <td><input data-x="${i}.lotto" value="${r.lotto || ''}" placeholder="lotto"></td>
          <td><input type="date" data-x="${i}.scadenza" value="${r.scadenza || ''}"></td><td></td>
          <td><input data-x="${i}.contato" type="number" min="0" step="1" inputmode="numeric" value="${r.contato ?? ''}"></td></tr>`)}
        </tbody></table></div>
        <div class="barra" style="margin-top:8px"><button class="piccolo" id="inv-riga">+ Altro lotto</button><button class="piccolo" id="inv-nuova">+ Nuova birra</button>
          <a class="btn piccolo" href="#/birra-prodotti-fic">Birre da Fatture in Cloud</a><span class="spazio"></span>
          <button class="primario" id="salva-inv">Salva inventario</button></div>
      </div>`;
  }
  // con la spunta tolta compaiono anche i lotti confezionati da più di un anno
  async function tuttiLotti(si) {
    nascondi.v = si;
    if (!si) for (const cf of confezionamenti(dati.cotte, dati.durate)) if (cf.data < daAnno) {
      const k = `${cf.prodotto}§${cf.lotto.toLowerCase()}`;
      if (!proposti.has(k)) { const x = { prodotto: cf.prodotto, lotto: cf.lotto, scadenza: cf.scadenza, calcolato: 0 }; proposti.set(k, x); righe.push(x); }
    }
    if (!si) senzaLotti(prodotti);
    ordina();
    disegna();
  }
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const t = e.target;
    if (t.id === 'data-inv') data.v = t.value;
    if (t.id === 'inv-zero' && e.type === 'change') return tuttiLotti(t.checked);
    const [lista, path] = t.dataset.i ? [righe, t.dataset.i] : t.dataset.x ? [extra, t.dataset.x] : [];
    if (!lista) return;
    const [i, k] = path.split('.');
    lista[i][k] = k === 'contato' ? (t.value === '' ? null : Number(t.value)) : t.value;
  };
  u.$app.onclick = async e => {
    if (e.target.id === 'inv-riga') { extra.push({ prodotto: '', lotto: '', scadenza: '', contato: null }); disegna(); return; }
    if (e.target.id === 'inv-nuova') {
      const chiave = await dialogNuovaBirra(dati);
      if (!chiave) return;
      if (!prodotti.includes(chiave)) { prodotti.push(chiave); prodotti.sort((a, b) => a.localeCompare(b, 'it')); }
      extra.push({ prodotto: chiave, lotto: '', scadenza: '', contato: null });
      disegna();
      u.$app.querySelector(`[data-x="${extra.length - 1}.lotto"]`)?.focus();
      return;
    }
    if (e.target.id !== 'salva-inv') return;
    if (!data.v) return u.toast('Manca la data');
    const tutte = [...righe, ...extra.filter(r => r.prodotto)];
    const contati = new Set(tutte.filter(r => r.contato !== null && r.contato !== undefined).map(r => r.prodotto));
    if (!contati.size) return u.toast('Nessun pezzo inserito');
    const out = tutte.filter(r => contati.has(r.prodotto))
      .map(r => ({ prodotto: r.prodotto, lotto: String(r.lotto || '').trim(), scadenza: r.scadenza || '', pezzi: Number(r.contato) || 0 }));
    await u.db.salva({ tipo: 'inventariobirra', id: u.db.nuovoId('inventariobirra'), data: data.v, righe: out });
    if (!imp.inizio) await salvaImpostazioni({ inizio: data.v });
    u.toast(`Inventario salvato: ${contati.size} birre`);
    location.hash = '#/birra';
  };
}

// ---------- registro carico/scarico (da stampare) ----------
const reg = { da: null, a: null, origine: '' };
export async function vistaRegistro() {
  const { html } = u;
  reg.da ||= `${u.oggiISO().slice(0, 4)}-01-01`;
  reg.a ||= u.oggiISO();
  const dati = await datiBirra();
  const righe = registroBirra(dati, reg.da, reg.a).filter(r => !reg.origine || (r.cs === 'C' && !r.origine ? 'confezionamento' : r.origine || 'manuale') === reg.origine);
  const somma = cs => righe.filter(r => r.cs === cs).reduce((t, r) => t + r.litri, 0);
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/birra" class="btn">← Birra</a>
      <label>Dal <input type="date" id="br-da" value="${reg.da}"></label>
      <label>Al <input type="date" id="br-a" value="${reg.a}"></label>
      <select id="br-origine"><option value="">Tutti i movimenti</option>
        ${[['confezionamento', 'Confezionamenti'], ...Object.entries(ORIGINI)].map(([k, v]) => html`<option value="${k}" ${k === reg.origine ? 'selected' : ''}>${v}</option>`)}</select>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    <div class="s6">
      <div class="s6-testa">
        <img src="${LOGO_KASHMIR}" alt="Kashmir Brewing Company">
        <div><h1>CARICO - SCARICO BIRRA /// VECAS SRLS</h1>
          <div>Periodo: dal ${u.dataIT(reg.da)} al ${u.dataIT(reg.a)} · caricati ${u.numIT(somma('C'), 1)} L · scaricati ${u.numIT(somma('S'), 1)} L · stampato il ${u.dataIT(u.oggiISO())}</div></div>
      </div>
      <p class="s6-legenda">Legenda: C = carico - S = scarico - Dest = destinatario - Prov = provenienza</p>
      ${righe.length ? html`<table class="tab-s6">
        <thead><tr><th>C/S</th><th>Data</th><th>Birra</th><th>Lotto</th><th class="n">Pezzi</th><th class="n">Litri</th><th>Scadenza</th><th>Dest/Prov</th></tr></thead>
        <tbody>${righe.map(r => html`<tr class="${r.cs === 'C' ? 'c' : ''}">
          <td>${r.cs}</td><td>${u.dataIT(r.data)}</td><td>${r.prodotto}</td><td>${r.lotto}</td>
          <td class="n">${u.numIT(r.pezzi, 0)}</td><td class="n">${u.numIT(r.litri, 1)}</td><td>${r.scadenza ? u.dataIT(r.scadenza) : ''}</td>
          <td><a href="${r.link}">${r.chi}</a></td></tr>`)}</tbody></table>` : html`<p class="vuoto">Nessun movimento nel periodo.</p>`}
    </div>`;
  const $ = s => document.getElementById(s);
  $('br-da').onchange = e => { reg.da = e.target.value; vistaRegistro(); };
  $('br-a').onchange = e => { reg.a = e.target.value; vistaRegistro(); };
  $('br-origine').onchange = e => { reg.origine = e.target.value; vistaRegistro(); };
  $('stampa').onclick = () => {
    const titolo = document.title;
    document.title = `Carico scarico birra ${reg.da} ${reg.a}`;
    addEventListener('afterprint', () => { document.title = titolo; }, { once: true });
    window.print();
  };
}

// ---------- import da Fatture in Cloud e Shopify ----------
// I documenti arrivano dai proxy netlify/functions/fattureincloud.mjs e shopify.mjs già nello stesso formato:
//   { documenti: [{ id, numero, data, cliente, stato, spedito, righe: [{ codice, nome, qta }] }], altri }
const FONTI = {
  fic: { nome: 'Fatture in Cloud', proxy: '/.netlify/functions/fattureincloud', doc: 'documenti', tipi: { invoice: 'Fatture', delivery_note: 'DDT', receipt: 'Ricevute' } },
  shopify: { nome: 'Shopify', proxy: '/.netlify/functions/shopify', doc: 'ordini' },
};
const imp_ = { fic: { dal: null, tipo: 'invoice' }, shopify: { dal: null } };
export async function vistaImporta(fonte) {
  const { html } = u;
  const F = FONTI[fonte];
  if (!F) { location.hash = '#/birra'; return; }
  const dati = await datiBirra();
  const imp = impostazioniDa(dati.impostazioni);
  const par = imp_[fonte];
  // da dove ripartire: il giorno dell'ultimo documento importato da questa fonte, altrimenti l'inizio del magazzino
  const ultimo = dati.movimenti.concat(await u.db.tutti('movbirra', { ancheEliminati: true })).filter(m => m.origine === fonte).map(m => m.data).sort().pop();
  par.dal ||= ultimo || imp.inizio || u.addGiorni(u.oggiISO(), -30);
  let stato = { carica: false, errore: '', docs: null, altri: false };
  const prodotti = elencoProdotti(dati);
  const g = giacenzeBirra(dati);

  async function cerca() {
    stato = { carica: true, errore: '', docs: null };
    disegna();
    try {
      const q = new URLSearchParams({ dal: par.dal, ...(par.tipo ? { tipo: par.tipo } : {}) });
      const t = await u.token();
      const res = await fetch(`${F.proxy}?${q}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      let body = null;
      try { body = await res.json(); } catch { /* non JSON: app non online */ }
      if (!res.ok || !body) throw new Error(body?.errore || (res.status === 404 ? `${F.nome} si collega solo quando l'app è online sul suo sito.` : `${F.nome}: errore ${res.status}`));
      const gia = new Set((await u.db.tutti('movbirra')).map(m => m.rifEsterno).filter(Boolean));
      const docs = body.documenti.filter(d => !gia.has(`${fonte}:${d.id}`)).map(d => ({
        ...d,
        scegli: fonte !== 'shopify' || d.spedito,
        righe: d.righe.map(r => {
          const t2 = trovaProdotto(r, prodotti, dati.prodotti, imp);
          return { ...r, prodotto: t2?.ignora ? '-' : t2?.prodotto || '', x: t2?.x || 1, auto: !!t2, lotto: '' };
        }),
      }));
      stato = { carica: false, errore: '', docs, altri: body.altri, gia: body.documenti.length - docs.length };
    } catch (ex) {
      stato = { carica: false, errore: ex.message, docs: null };
    }
    disegna();
  }

  function disegna() {
    const docs = stato.docs || [];
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span></div>
      <div class="scheda">
        <h1 style="margin-top:0">Scarichi da ${F.nome}</h1>
        <p class="totale">${fonte === 'fic' ? 'Ogni fattura (o DDT) con birra diventa uno scarico, con il cliente e il numero del documento.' : 'Ogni ordine con birra diventa uno scarico alla data di spedizione (o dell\'ordine se non ancora spedito: quelli non spediti restano da spuntare).'}
        Le righe vengono collegate alla birra dal codice o dal nome; quelle che colleghi tu vengono ricordate. I documenti già importati non ricompaiono.</p>
        <div class="barra" style="margin:0;align-items:flex-end">
          <label style="max-width:200px">Documenti dal <input type="date" id="imp-dal" value="${par.dal}"></label>
          ${F.tipi ? html`<label style="max-width:200px">Tipo <select id="imp-tipo">${Object.entries(F.tipi).map(([k, v]) => html`<option value="${k}" ${k === par.tipo ? 'selected' : ''}>${v}</option>`)}</select></label>` : ''}
          <button class="primario" id="imp-cerca" ${stato.carica ? 'disabled' : ''}>${stato.carica ? 'Cerco…' : `Cerca in ${F.nome}`}</button>
        </div>
        ${stato.errore ? html`<p class="totale" style="color:var(--warn)">${stato.errore}</p>
          ${/configurat/i.test(stato.errore) ? html`<p class="totale">Per collegare ${F.nome} servono le chiavi nelle variabili d'ambiente di Netlify: ${fonte === 'fic' ? 'FIC_TOKEN e FIC_COMPANY_ID' : 'SHOPIFY_SHOP e SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (oppure SHOPIFY_TOKEN)'}. Vedi la guida "Mettere online l'app".</p>` : ''}` : ''}
      </div>
      ${stato.docs ? html`
        ${!docs.length ? html`<p class="vuoto">Nessun ${fonte === 'fic' ? 'documento' : 'ordine'} nuovo dal ${u.dataIT(par.dal)}${stato.gia ? ` (${stato.gia} già importati)` : ''}.</p>` : ''}
        ${stato.altri ? html`<p class="totale">Ce ne sono altri: dopo aver salvato questi, cerca di nuovo.</p>` : ''}
        ${docs.map((d, di) => {
          const daScegliere = d.righe.filter(r => !r.prodotto).length;
          const birre = d.righe.filter(r => r.prodotto && r.prodotto !== '-').length;
          return html`<div class="scheda ${d.scegli ? '' : 'escluso'}">
            <div class="barra" style="margin:0 0 6px">
              <label class="spunta" style="min-height:auto"><input type="checkbox" data-scegli="${di}" ${d.scegli ? 'checked' : ''}>
                <b>${d.numero}</b>&nbsp;· ${u.dataIT(d.data)}${d.cliente ? ` · ${d.cliente}` : ''}</label>
              <span class="spazio"></span><span class="totale" style="margin:0">${d.stato || ''}${daScegliere ? ` · ${daScegliere} righe da collegare` : birre ? '' : ' · nessuna birra'}</span>
            </div>
            <div class="scroll-x"><table class="tab-edit"><thead><tr><th>Riga del documento</th><th class="n">Qtà</th><th>Birra</th><th style="width:70px" title="Pezzi per unità venduta (cartone da 24 = 24)">× pz</th><th class="n">Pezzi</th><th style="width:170px">Lotto</th></tr></thead>
              <tbody>${d.righe.map((r, ri) => {
                const gg = r.prodotto && r.prodotto !== '-' ? g.get(r.prodotto) : null;
                return html`<tr class="${r.prodotto === '-' ? 'escluso' : ''}">
                  <td>${r.nome}${r.codice ? html` <span class="totale">${r.codice}</span>` : ''}</td>
                  <td class="n">${u.numIT(r.qta, 0)}</td>
                  <td><select data-p="${di}.${ri}" style="min-width:190px;${r.prodotto ? '' : 'border-color:var(--warn)'}"><option value="">Scegli…</option>
                    <option value="-" ${r.prodotto === '-' ? 'selected' : ''}>— Non è birra (ignora)</option>
                    ${prodotti.map(k => html`<option value="${k}" ${k === r.prodotto ? 'selected' : ''}>${nomeProdotto(k)}</option>`)}</select></td>
                  <td>${r.prodotto && r.prodotto !== '-' ? html`<input data-x="${di}.${ri}" type="number" min="1" step="1" inputmode="numeric" value="${r.x}">` : ''}</td>
                  <td class="n">${r.prodotto && r.prodotto !== '-' ? u.numIT(r.qta * r.x, 0) : ''}</td>
                  <td>${gg ? html`<select data-l="${di}.${ri}"><option value="">Il primo che scade</option>
                    ${gg.lotti.filter(l => l.lotto).map(l => html`<option value="${l.lotto}" ${l.lotto === r.lotto ? 'selected' : ''}>${l.lotto} · ${l.pezzi} pz</option>`)}</select>` : ''}</td>
                </tr>`;
              })}</tbody></table></div>
          </div>`;
        })}
        ${docs.length ? html`<div class="barra"><span class="spazio"></span><span class="totale" style="margin:0">${docs.filter(d => d.scegli).length} di ${docs.length} selezionati</span>
          <button class="primario" id="imp-salva">Scarica i selezionati</button></div>` : ''}` : ''}`;
  }
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const t = e.target;
    if (t.id === 'imp-dal') par.dal = t.value;
    if (t.id === 'imp-tipo') par.tipo = t.value;
    if (!stato.docs) return;
    if (t.dataset.scegli !== undefined && e.type === 'change') { stato.docs[t.dataset.scegli].scegli = t.checked; disegna(); }
    const ref = t.dataset.p || t.dataset.x || t.dataset.l;
    if (!ref) return;
    const [di, ri] = ref.split('.').map(Number);
    const r = stato.docs[di].righe[ri];
    if (t.dataset.p && e.type === 'change') {
      r.prodotto = t.value; r.auto = false; r.lotto = '';
      // stessa riga in altri documenti: stessa scelta
      for (const d of stato.docs) for (const x of d.righe) if (!x.prodotto && (x.codice || x.nome) === (r.codice || r.nome)) { x.prodotto = r.prodotto; x.x = r.x; }
      disegna();
    }
    if (t.dataset.x) { r.x = Number(t.value) || 1; r.auto = false; if (e.type === 'change') disegna(); }
    if (t.dataset.l) r.lotto = t.value;
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'imp-cerca') { if (!par.dal) return u.toast('Scegli la data'); cerca(); return; }
    if (t.id !== 'imp-salva') return;
    const scelti = stato.docs.filter(d => d.scegli);
    if (!scelti.length) return u.toast('Nessun documento selezionato');
    const manca = scelti.find(d => d.righe.some(r => !r.prodotto));
    if (manca) return u.toast(`${manca.numero}: collega tutte le righe a una birra o segnale come "Non è birra"`);
    // le scelte fatte a mano diventano codici dei prodotti (o righe da ignorare)
    const perProdotto = new Map(dati.prodotti.map(p => [p.chiave, p]));
    const ignorati = new Set(imp.codiciIgnorati);
    for (const d of scelti) for (const r of d.righe) {
      if (r.auto) continue;
      const cod = r.codice || r.nome;
      if (r.prodotto === '-') { if (cod) ignorati.add(cod); continue; }
      const p = conCodice([...perProdotto.values()], r.prodotto, cod, r.x);
      if (p) perProdotto.set(r.prodotto, p);
    }
    const nuoviProdotti = [...perProdotto.values()].filter(p => !dati.prodotti.includes(p)).map(({ aggiornato: _a, ...p }) => p);
    const movimenti = scelti.map(d => {
      const righe = d.righe.filter(r => r.prodotto !== '-' && r.qta > 0).map(r => ({ prodotto: r.prodotto, pezzi: r.qta * r.x, lotto: r.lotto || '' }));
      return {
        tipo: 'movbirra', id: u.db.nuovoId('movbirra'), verso: 'scarico', data: d.data, motivo: 'vendita', cliente: d.cliente || '',
        documento: d.numero, note: '', origine: fonte, rifEsterno: `${fonte}:${d.id}`, righe, ...(righe.length ? {} : { ignorato: true }),
      };
    });
    await u.db.salvaMolti([...nuoviProdotti, ...movimenti]);
    if (ignorati.size !== imp.codiciIgnorati.length) await salvaImpostazioni({ codiciIgnorati: [...ignorati] });
    const n = movimenti.filter(m => !m.ignorato).length;
    u.toast(`${n} scarichi salvati${movimenti.length - n ? ` · ${movimenti.length - n} senza birra segnati come visti` : ''}`);
    location.hash = '#/birra';
  };
}


// ---------- nuova birra / formato ----------
// Una birra mai confezionata nell'app (inventario iniziale, birre di altri birrifici…) diventa un prodotto da sola.
const LITRI_TIPICI = { fusto: [12, 20, 24, 25, 30], 'lattina/bottiglia': [0.33, 0.44, 0.5, 0.75] };
function birreNote(dati) {
  return [...new Set([...dati.cotte.filter(c => !c.eliminato).map(c => nomeBirra(c.birra)), ...elencoProdotti(dati).map(k => daChiave(k).birra)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'it'));
}
function dialogNuovaBirra(dati, pre = {}) {
  const { html } = u;
  const d = document.createElement('dialog');
  d.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">Nuova birra</h2>
    <div class="griglia">
      <label style="grid-column:1/-1">Birra <input name="birra" required list="dl-nb" value="${pre.birra || ''}" placeholder="es. LA MORTE SUA"></label>
      <label>Formato <select name="tipo">${Object.entries(FORMATI).map(([k, v]) => html`<option value="${k}" ${k === (pre.tipo || 'fusto') ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label>Litri per pezzo <input name="litri" type="number" step="any" min="0" inputmode="decimal" required list="dl-nl" value="${pre.litri || ''}"></label>
    </div>
    <datalist id="dl-nb">${birreNote(dati).map(b => html`<option value="${b}">`)}</datalist>
    <datalist id="dl-nl">${[...LITRI_TIPICI.fusto, ...LITRI_TIPICI['lattina/bottiglia']].map(l => html`<option value="${l}">`)}</datalist>
    <div class="barra" style="margin-top:14px"><span class="spazio"></span>
      <button value="no" formnovalidate>Annulla</button><button class="primario" value="ok">Aggiungi</button></div>
  </form>`.s;
  document.body.appendChild(d);
  const f = d.querySelector('form');
  f.tipo.onchange = () => { if (!f.litri.value) f.litri.value = LITRI_TIPICI[f.tipo.value][0]; };
  const fatto = new Promise(ok => d.addEventListener('close', async () => {
    d.remove();
    const birra = nomeBirra(f.birra.value), litri = Number(String(f.litri.value).replace(',', '.'));
    if (d.returnValue !== 'ok' || !birra || !(litri > 0)) return ok(null);
    const chiave = chiaveProdotto(birra, f.tipo.value, litri);
    if (!elencoProdotti(dati).includes(chiave)) {
      const rec = { tipo: 'prodottobirra', id: idProdotto(chiave), chiave, codici: [] };
      await u.db.salva(rec);
      dati.prodotti.push(rec);
    }
    ok(chiave);
  }));
  d.showModal();
  return fatto;
}

// ---------- birre dall'anagrafica prodotti di Fatture in Cloud ----------
export async function vistaProdottiFic() {
  const { html } = u;
  const dati = await datiBirra();
  const note = birreNote(dati);
  const mappati = new Set(dati.prodotti.flatMap(p => (p.codici || []).map(c => String(c.codice).toLowerCase())));
  let stato = { carica: true, errore: '', righe: [], gia: 0 };
  const disegna = () => {
    const nuove = stato.righe.filter(r => !r.gia);
    const scelte = nuove.filter(r => r.importa);
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra-inventario" class="btn">← Inventario</a><span class="spazio"></span></div>
      <div class="scheda">
        <h1 style="margin-top:0">Birre da Fatture in Cloud</h1>
        <p class="totale">I prodotti dell'anagrafica di Fatture in Cloud diventano birre del magazzino, già collegate al loro codice: poi le fatture si scaricano da sole.
        Controlla nome della birra, formato e litri; togli la spunta a quello che non è birra (gadget, spedizioni, vuoti). "× pz" = pezzi per unità venduta (cartone da 24 = 24).</p>
        ${stato.carica ? html`<p class="totale">Leggo i prodotti…</p>` : ''}
        ${stato.errore ? html`<p class="totale" style="color:var(--warn)">${stato.errore}</p>` : ''}
        ${!stato.carica && !stato.errore ? html`<p class="totale">${stato.righe.length} prodotti in Fatture in Cloud${stato.gia ? `, ${stato.gia} già collegati a una birra` : ''}.</p>` : ''}
      </div>
      ${nuove.length ? html`<div class="scheda"><div class="scroll-x"><table class="tab-edit">
        <thead><tr><th title="Crea">✓</th><th>Prodotto in Fatture in Cloud</th><th>Birra</th><th style="width:130px">Formato</th><th style="width:90px">Litri</th><th style="width:70px">× pz</th></tr></thead>
        <tbody>${stato.righe.map((r, i) => (r.gia ? '' : html`<tr class="${r.importa ? '' : 'escluso'}">
          <td><input type="checkbox" data-f="${i}.importa" ${r.importa ? 'checked' : ''} style="width:auto;min-height:auto"></td>
          <td>${r.nome}${r.codice ? html` <span class="totale">${r.codice}</span>` : ''}</td>
          <td><input data-f="${i}.birra" list="dl-pf" value="${r.birra}" style="min-width:160px"></td>
          <td><select data-f="${i}.tipo">${Object.entries(FORMATI).map(([k, v]) => html`<option value="${k}" ${k === r.tipo ? 'selected' : ''}>${v}</option>`)}</select></td>
          <td><input data-f="${i}.litri" type="number" step="any" min="0" inputmode="decimal" value="${r.litri || ''}" style="${r.importa && !(r.litri > 0) ? 'border-color:var(--warn)' : ''}"></td>
          <td><input data-f="${i}.x" type="number" min="1" step="1" inputmode="numeric" value="${r.x}"></td>
        </tr>`))}</tbody></table></div>
        <datalist id="dl-pf">${note.map(b => html`<option value="${b}">`)}</datalist>
        <div class="barra" style="margin-top:8px"><span class="spazio"></span><span class="totale" style="margin:0">${scelte.length} selezionati</span>
          <button class="primario" id="pf-crea">Crea le birre selezionate</button></div>
      </div>` : ''}`;
  };
  disegna();
  try {
    const t = await u.token();
    const res = await fetch('/.netlify/functions/fattureincloud?elenco=prodotti', { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    let body = null;
    try { body = await res.json(); } catch { /* non JSON: app non online */ }
    if (!res.ok || !body) throw new Error(body?.errore || (res.status === 404 ? 'Fatture in Cloud si collega solo quando l\'app è online sul suo sito.' : `Fatture in Cloud: errore ${res.status}`));
    const righe = body.prodotti.map(p => {
      const g = indovinaProdotto(`${p.nome} ${p.codice}`, note);
      const gia = mappati.has(String(p.codice || p.nome).toLowerCase()) || mappati.has(String(p.nome).toLowerCase());
      return { ...p, birra: g.birra, tipo: g.tipo, litri: g.litri, x: 1, importa: g.sicuro || (g.birraNota && g.formatoNoto), gia };
    });
    stato = { carica: false, errore: '', righe, gia: righe.filter(r => r.gia).length };
  } catch (ex) {
    stato = { carica: false, errore: ex.message, righe: [], gia: 0 };
  }
  if (location.hash !== '#/birra-prodotti-fic') return; // pagina già lasciata
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const ref = e.target.dataset.f;
    if (!ref) return;
    const [i, k] = ref.split('.');
    const r = stato.righe[i];
    r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(String(e.target.value).replace(',', '.')) || 0 : e.target.value;
    if (e.type === 'change' && (k === 'importa' || k === 'tipo' || k === 'litri')) disegna();
  };
  u.$app.onclick = async e => {
    if (e.target.id !== 'pf-crea') return;
    const scelte = stato.righe.filter(r => !r.gia && r.importa);
    const male = scelte.find(r => !nomeBirra(r.birra) || !(r.litri > 0));
    if (male) return u.toast(`${male.nome}: mancano la birra o i litri`);
    if (!scelte.length) return u.toast('Nessun prodotto selezionato');
    const perChiave = new Map(dati.prodotti.map(p => [p.chiave, p]));
    for (const r of scelte) {
      const chiave = chiaveProdotto(r.birra, r.tipo, r.litri);
      const p = conCodice([...perChiave.values()], chiave, r.codice || r.nome, r.x);
      perChiave.set(chiave, r.codice && r.nome ? conCodice([p], chiave, r.nome, r.x) : p); // anche la descrizione, per le righe senza codice
    }
    const daSalvare = [...perChiave.values()].filter(p => !dati.prodotti.includes(p)).map(({ aggiornato: _a, ...p }) => p);
    await u.db.salvaMolti(daSalvare);
    u.toast(`${scelte.length} prodotti collegati a ${daSalvare.length} birre`);
    location.hash = '#/birra-inventario';
  };
}
