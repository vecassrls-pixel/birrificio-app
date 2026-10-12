// Pagina "Listini": listino base Alpha (prezzi scritti a mano) + ricarico = altri listini con nome, da copiare e incollare.
// Calcoli in listini.js.

import { ID_IMPOSTAZIONI, elencoProdotti, giacenzeBirra, nomeFormato } from './birra.js';
import { ARROTONDA, ALIQUOTA_IVA, ID_ALPHA, nuovoAlpha, perCalcolo, nuovoListino, listinoDa, prezzoListino, righeListino, righeDaCopiare, testoListino, tabellaListino, soldi } from './listini.js';

let u; // { $app, html, db, toast, chiedi, stato, dataIT, numIT, oggiISO, copia }
export function init(strumenti) { u = strumenti; }

const SCELTO = 'gb-listino';
const leggiScelto = () => { try { return localStorage.getItem(SCELTO) || ''; } catch { return ''; } };
const scriviScelto = id => { try { localStorage.setItem(SCELTO, id); } catch { /* vale solo ora */ } };
const euro = n => (n ? `€ ${soldi(n)}` : '—');

async function dati() {
  const [listini, movimenti, inventari, prodotti, imp] = await Promise.all([
    u.db.tutti('listino'), u.db.tutti('movbirra'), u.db.tutti('inventariobirra'), u.db.tutti('prodottobirra'),
    u.db.leggi(ID_IMPOSTAZIONI),
  ]);
  // Alpha c'è sempre: finché non scrivi un prezzo esiste solo qui (si salva alla prima modifica)
  const tutti = listini.map(listinoDa);
  const alpha = tutti.find(x => x.id === ID_ALPHA) || nuovoAlpha();
  const d = { cotte: u.stato.cotte, durate: u.stato.durate, movimenti, inventari, prodotti, impostazioni: imp && !imp.eliminato ? imp : null };
  return {
    alpha,
    listini: [alpha, ...tutti.filter(x => x.id !== ID_ALPHA).sort((a, b) => a.nome.localeCompare(b.nome, 'it'))],
    chiavi: elencoProdotti(d),
    giacenze: giacenzeBirra(d),
  };
}
const salvaListino = ({ aggiornato: _a, ...l }) => u.db.salva(l);

export async function vistaListini() {
  const { html } = u;
  const D = await dati();
  const l = D.listini.find(x => x.id === leggiScelto()) || D.listini[0];
  const eAlpha = l.id === ID_ALPHA;
  const vendita = D.alpha.prezzi || {};
  const righe = l ? righeListino(l, D.chiavi, D.giacenze, vendita) : [];
  const daCopiare = righeDaCopiare(righe);
  const senzaBase = righe.filter(r => !r.escluso && !r.base && !r.fisso).length;
  const oggi = u.dataIT(u.oggiISO());
  // formati conosciuti, per il prezzo base di formato
  const formati = new Map();
  for (const k of D.chiavi) { const [, tipo, litri] = k.split('|'); formati.set(`*|${tipo}|${litri}`, { tipo, litri: Number(litri) }); }
  let birraPrima = '';

  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/birra" class="btn">←<span class="solo-desktop"> Birra</span></a>
      <h1 style="margin:0">Listini</h1><span class="spazio"></span>
      <button class="primario solo-editori" id="li-nuovo">+ Nuovo listino</button>
    </div>
    ${D.listini.length > 1 ? html`<div class="filtri-stato" role="group" aria-label="Listino">
      ${D.listini.map(x => html`<button class="st-libero ${x.id === l.id ? 'attivo' : ''}" data-scegli="${x.id}" aria-pressed="${x.id === l.id}">${x.nome} <b>${x.id === ID_ALPHA ? 'base' : `${x.ricarico > 0 ? '+' : ''}${u.numIT(x.ricarico, 1)}%`}</b></button>`)}
    </div>` : ''}
    ${D.listini.length === 1 ? html`<div class="scheda avviso"><h2>Come funziona</h2>
      <p>Scrivi i prezzi del listino base Alpha, poi crea gli altri listini con un ricarico in % su Alpha: per esempio "Distributori +15%", "Pub +30%", "Taproom IVA inclusa".
      Ogni listino resta salvato e si copia con un tocco per incollarlo in un messaggio, una mail o Excel.</p>
      <button class="primario solo-editori" id="li-nuovo2">Crea un listino da Alpha</button></div>` : ''}${html`
    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <h2 style="margin:0">${l.nome}</h2><span class="spazio"></span>
        <button class="piccolo st-libero" id="li-copia" ${daCopiare.length ? '' : 'disabled'} title="Testo per WhatsApp o mail">⧉ Copia testo</button>
        <button class="piccolo st-libero" id="li-excel" ${daCopiare.length ? '' : 'disabled'} title="Tabella da incollare in Excel">⧉ Copia per Excel</button>
      </div>
      <div class="griglia solo-editori">
        <label>Nome<input data-campo="nome" value="${l.nome}"></label>
        ${eAlpha ? '' : html`<label>Ricarico su Alpha (%)<input data-campo="ricarico" type="number" step="any" inputmode="decimal" value="${l.ricarico}"></label>`}
        <label>Arrotonda per eccesso a<select data-campo="arrotonda">${ARROTONDA.map(([v, n]) => html`<option value="${v}" ${Number(l.arrotonda) === v ? 'selected' : ''}>${n}</option>`)}</select></label>
        <label>Prodotti<select data-campo="prodotti">
          <option value="magazzino" ${l.prodotti === 'magazzino' ? 'selected' : ''}>Solo quelli in magazzino</option>
          <option value="tutti" ${l.prodotti === 'tutti' ? 'selected' : ''}>Tutti i prodotti</option></select></label>
      </div>
      <label class="solo-editori" style="margin-top:10px"><input type="checkbox" data-campo="iva" ${l.iva ? 'checked' : ''}> Prezzi IVA inclusa (${ALIQUOTA_IVA}%)</label>
      <label class="solo-editori" style="margin-top:10px">Note in fondo al titolo (consegna, minimo d'ordine…)<textarea data-campo="note" rows="2">${l.note || ''}</textarea></label>
      ${eAlpha ? html`<p class="totale"><b>Alpha è il listino base</b>: scrivi a mano il prezzo di ogni birra e formato (IVA esclusa) nella colonna Base, o un prezzo per formato più sotto. Gli altri listini sono Alpha + il loro ricarico.</p>` : ''}
      <p class="totale">${daCopiare.length} prodotti nel listino · prezzo = ${eAlpha ? 'prezzo Alpha' : `Alpha ${l.ricarico >= 0 ? '+' : '−'} ${u.numIT(Math.abs(l.ricarico), 1)}%`}${l.iva ? ` + IVA ${ALIQUOTA_IVA}%` : ', IVA esclusa'}${Number(l.arrotonda) ? `, arrotondato per eccesso a ${soldi(l.arrotonda)} €` : ''}.
        ${senzaBase ? html`<b>⚠ ${senzaBase} senza prezzo in Alpha</b>: ${eAlpha ? 'scrivilo nella colonna Base o nei prezzi per formato qui sotto' : html`scrivilo nel listino <button class="link st-libero" data-scegli="${ID_ALPHA}">Alpha</button>`}.` : ''}</p>
      ${righe.length ? html`<div class="scroll-x"><table class="tab-edit tab-listino">
        <thead><tr><th title="Nel listino">✓</th><th>Formato</th><th class="n li-extra">Giacenza</th><th>${eAlpha ? 'Base €' : 'Alpha €'}</th><th>${eAlpha ? 'Prezzo €' : 'Prezzo listino €'}</th><th class="n li-extra">€/L</th></tr></thead>
        <tbody>${righe.map(r => {
          const prima = r.birra !== birraPrima;
          birraPrima = r.birra;
          return html`${prima ? html`<tr class="li-gruppo"><td colspan="6">${r.birra}</td></tr>` : ''}<tr class="${r.escluso ? 'escluso' : ''}">
            <td><input type="checkbox" data-includi="${r.chiave}" ${r.escluso ? '' : 'checked'} title="Nel listino"></td>
            <td>${r.formato}</td>
            <td class="n li-extra">${r.giacenza ? u.numIT(r.giacenza, 0) : '—'}</td>
            <td>${eAlpha ? html`<input data-base="${r.chiave}" type="number" step="any" inputmode="decimal" value="${r.baseBirra ?? ''}" placeholder="${r.base ? soldi(r.base) : 'manca'}" title="${r.baseBirra === null ? 'Prezzo del formato (vale per tutte le birre): scrivi qui per un prezzo diverso per questa birra' : 'Prezzo Alpha di questa birra'}">` : euro(r.base)}</td>
            <td>${eAlpha ? euro(r.prezzo) : html`<input data-fisso="${r.chiave}" type="number" step="any" inputmode="decimal" value="${r.fisso ?? ''}" placeholder="${r.calcolato ? soldi(r.calcolato) : '—'}" class="${r.fisso ? 'fisso' : ''}" title="${r.fisso ? `Prezzo scritto a mano (calcolato: ${euro(r.calcolato)}). Cancella per tornare al calcolo.` : 'Prezzo calcolato: scrivi qui per fissarlo a mano'}">`}</td>
            <td class="n li-extra">${r.alLitro ? soldi(r.alLitro) : '—'}</td>
          </tr>`;
        })}</tbody></table></div>
        <p class="totale">${eAlpha ? 'La colonna Base, se vuota, usa il prezzo del formato. ' : 'Un prezzo scritto a mano nella colonna del listino vince sul calcolo (cancellalo per tornare al ricarico). '}Senza spunta il prodotto non va nel testo copiato.</p>`
      : html`<p class="totale">${l.prodotti === 'magazzino' ? 'Nessuna birra in magazzino: scegli "Tutti i prodotti" oppure registra confezionamenti e inventario nella pagina Birra.' : 'Nessun prodotto: compaiono quando scrivi il confezionamento nelle schede cotta.'}</p>`}
      ${daCopiare.length ? html`<details class="st-tabella"><summary>Anteprima del testo</summary><pre class="li-anteprima">${testoListino(l, righe, oggi)}</pre></details>` : ''}
      <div class="barra solo-editori">
        ${eAlpha ? '' : html`<button class="piccolo" id="li-duplica">Duplica</button>
        <span class="spazio"></span>
        <button class="piccolo" id="li-elimina">Elimina listino</button>`}
      </div>
    </div>
    ${eAlpha ? html`<div class="scheda"><h2>Prezzi Alpha per formato</h2>
      <p class="totale">Prezzo di un pezzo senza IVA, uguale per tutte le birre se la birra non ha un prezzo suo in Alpha.</p>
      ${formati.size ? html`<div class="scroll-x"><table class="tab-edit"><thead><tr><th>Formato</th><th style="width:150px">Base € al pezzo</th><th class="n">Nel listino</th></tr></thead>
        <tbody>${[...formati].sort((a, b) => a[1].tipo.localeCompare(b[1].tipo) || b[1].litri - a[1].litri).map(([k, f]) => html`<tr>
          <td>${nomeFormato(f.tipo, f.litri)}</td>
          <td><input data-base="${k}" type="number" step="any" inputmode="decimal" value="${vendita[k] ?? ''}"></td>
          <td class="n">${euro(prezzoListino(vendita[k], perCalcolo(l)))}</td></tr>`)}</tbody></table></div>`
      : html`<p class="totale">Nessun formato: compaiono quando scrivi il confezionamento nelle schede cotta.</p>`}
    </div>` : ''}
    ${D.listini.length > 1 ? (() => {
      const tutte = D.listini.map(x => righeListino({ ...x, prodotti: 'tutti' }, D.chiavi, D.giacenze, vendita));
      const usate = tutte[0].map((r, i) => ({ r, prezzi: tutte.map(t => (t[i].escluso ? null : t[i].prezzo)) })).filter(x => x.prezzi.some(Boolean));
      return html`<details class="scheda st-tabella"><summary><b>Tutti i listini a confronto</b></summary>
        <div class="scroll-x"><table class="tab-mag"><thead><tr><th>Prodotto</th>${D.listini.map(x => html`<th class="n">${x.nome}${x.iva ? ' (IVA incl.)' : ''}</th>`)}</tr></thead>
        <tbody>${usate.map(({ r, prezzi }) => html`<tr><td>${r.birra} · ${r.formato}</td>${prezzi.map(p => html`<td class="n">${euro(p)}</td>`)}</tr>`)}</tbody></table></div></details>`;
    })() : ''}`}`;

  const nuovo = async (base) => {
    const nome = base ? `${base.nome} (copia)` : `Listino ${D.listini.length + 1}`;
    const rec = base ? { ...base, id: u.db.nuovoId('listino'), nome } : nuovoListino(u.db.nuovoId('listino'), nome);
    await salvaListino(rec);
    scriviScelto(rec.id);
    u.toast(base ? 'Listino duplicato' : 'Listino creato: scegli nome e ricarico');
    return vistaListini();
  };

  u.$app.onchange = async e => {
    const t = e.target;
    if (t.dataset.campo && l) {
      const c = t.dataset.campo;
      let v = t.type === 'checkbox' ? t.checked : t.value;
      if (c === 'ricarico') v = Number(String(v).replace(',', '.')) || 0;
      if (c === 'arrotonda') v = Number(v);
      if (c === 'nome' && !v.trim()) return vistaListini();
      await salvaListino({ ...l, [c]: c === 'nome' ? v.trim() : v });
      return vistaListini();
    }
    if (t.dataset.includi && l) {
      const esclusi = new Set(l.esclusi);
      if (t.checked) esclusi.delete(t.dataset.includi); else esclusi.add(t.dataset.includi);
      await salvaListino({ ...l, esclusi: [...esclusi] });
      return vistaListini();
    }
    if (t.dataset.fisso && l) {
      const fissi = { ...l.fissi };
      const n = Number(String(t.value).replace(',', '.'));
      if (t.value === '' || !(n > 0)) delete fissi[t.dataset.fisso]; else fissi[t.dataset.fisso] = n;
      await salvaListino({ ...l, fissi });
      return vistaListini();
    }
    if (t.dataset.base) {
      const v = { ...vendita };
      const n = Number(String(t.value).replace(',', '.'));
      if (t.value === '' || !(n > 0)) delete v[t.dataset.base]; else v[t.dataset.base] = n;
      await salvaListino({ ...D.alpha, prezzi: v });
      u.toast('Prezzo Alpha salvato');
      return vistaListini();
    }
  };
  u.$app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.scegli) { scriviScelto(t.dataset.scegli); return vistaListini(); }
    if (t.id === 'li-nuovo' || t.id === 'li-nuovo2') return nuovo(null);
    if (t.id === 'li-duplica') return nuovo(eAlpha ? null : l);
    if (t.id === 'li-copia') return u.copia(testoListino(l, righe, oggi), `Listino "${l.nome}" copiato: ${daCopiare.length} prodotti`);
    if (t.id === 'li-excel') return u.copia(tabellaListino(l, righe), `Tabella copiata: incollala in Excel`);
    if (t.id === 'li-elimina') {
      if (!(await u.chiedi(`Eliminare il listino "${l.nome}"? I prezzi base restano.`, 'Elimina'))) return;
      await u.db.elimina(l.id);
      scriviScelto('');
      u.toast('Listino eliminato');
      return vistaListini();
    }
  };
}
