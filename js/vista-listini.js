// Pagina "Listini": listino base Alpha (prezzi scritti a mano) + ricarico = altri listini con nome, da copiare e incollare.
// Calcoli in listini.js.

import { ID_IMPOSTAZIONI, elencoProdotti, giacenzeBirra, formatoCliente, caratteristiche, maiuscole } from './birra.js';
import { LOGO_KASHMIR } from './logo-kashmir.js';
import { ARROTONDA, ALIQUOTA_IVA, ID_ALPHA, nuovoAlpha, perCalcolo, nuovoListino, listinoDa, GRUPPI_RICARICO, testoRicarico, righeListino, righeDaCopiare, testoListino, conCaratteristiche, infoBirra, tabellaListino, soldi } from './listini.js';

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
    // stile e grado alcolico per birra: quelli scritti in Birra, altrimenti dall'ultima cotta
    info: (() => {
      const cache = new Map();
      return birra => {
        if (!cache.has(birra)) { const c = caratteristiche(birra, prodotti, u.stato.cotte); cache.set(birra, { stile: c.stileVale ? maiuscole(c.stileVale) : '', abv: c.abvVale }); }
        return cache.get(birra);
      };
    })(),
  };
}
// Foglio da stampare o salvare in PDF (solo in stampa), con lo stesso stile della lista birre per i clienti
function foglio(l, righe, oggi) {
  const { html } = u;
  const birre = [];
  for (const r of righeDaCopiare(righe)) {
    if (birre.at(-1)?.birra !== r.birra) birre.push({ birra: r.birra, formati: [] });
    birre.at(-1).formati.push(r);
  }
  const info = b => infoBirra(b.formati[0]);
  return html`<div class="lista-clienti li-foglio solo-stampa">
    <div class="lc-testa">
      <img src="${LOGO_KASHMIR}" alt="Kashmir Brewing Company">
      <div><h1>Listino ${l.nome}</h1><div class="lc-data">Prezzi al ${oggi} · ${l.iva ? `IVA ${ALIQUOTA_IVA}% inclusa` : 'IVA esclusa'}</div>
        ${l.note?.trim() ? html`<div class="lc-data">${l.note.trim()}</div>` : ''}</div>
    </div>
    <div class="lc-griglia">${birre.map(b => html`<section class="lc-birra"><h2>${b.birra}</h2>${info(b) ? html`<p class="lc-info">${info(b)}</p>` : ''}
      ${b.formati.map(f => html`<div class="lc-formato"><span>${formatoCliente(f)}</span><span class="lc-punti"></span><b>€ ${soldi(f.prezzo)}</b></div>`)}
    </section>`)}</div>
    <p class="lc-piede">Kashmir Brewing Company · prezzi al pezzo, soggetti a variazioni</p>
  </div>`;
}
const salvaListino = ({ aggiornato: _a, ...l }) => u.db.salva(l);

export async function vistaListini() {
  const { html } = u;
  const D = await dati();
  const l = D.listini.find(x => x.id === leggiScelto()) || D.listini[0];
  const eAlpha = l.id === ID_ALPHA;
  const vendita = D.alpha.prezzi || {};
  const righe = l ? conCaratteristiche(righeListino(l, D.chiavi, D.giacenze, vendita, D.alpha.esclusi), D.info) : [];
  const daCopiare = righeDaCopiare(righe);
  const senzaBase = righe.filter(r => !r.escluso && !r.base && !r.fisso).length;
  const oggi = u.dataIT(u.oggiISO());
  let birraPrima = '';

  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/birra" class="btn">←<span class="solo-desktop"> Birra</span></a>
      <h1 style="margin:0">Listini</h1><span class="spazio"></span>
      <button class="primario solo-editori" id="li-nuovo">+ Nuovo listino</button>
    </div>
    ${D.listini.length > 1 ? html`<div class="filtri-stato" role="group" aria-label="Listino">
      ${D.listini.map(x => html`<button class="st-libero ${x.id === l.id ? 'attivo' : ''}" data-scegli="${x.id}" aria-pressed="${x.id === l.id}">${x.nome} <b>${x.id === ID_ALPHA ? 'base' : testoRicarico(x, u.numIT)}</b></button>`)}
    </div>` : ''}
    ${D.listini.length === 1 ? html`<div class="scheda avviso"><h2>Come funziona</h2>
      <p>Scrivi i prezzi del listino base Alpha, poi crea gli altri listini con un ricarico in % su Alpha: per esempio "Distributori +15%", "Pub +30%", "Taproom IVA inclusa".
      Il ricarico può essere diverso per fusti e lattine. Ogni listino resta salvato e si copia con un tocco per incollarlo in un messaggio, una mail o Excel.</p>
      <button class="primario solo-editori" id="li-nuovo2">Crea un listino da Alpha</button></div>` : ''}${html`
    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <h2 style="margin:0">${l.nome}</h2><span class="spazio"></span>
        <button class="piccolo st-libero" id="li-copia" ${daCopiare.length ? '' : 'disabled'} title="Testo per WhatsApp o mail">⧉ Copia testo</button>
        <button class="piccolo st-libero" id="li-excel" ${daCopiare.length ? '' : 'disabled'} title="Tabella da incollare in Excel">⧉ Copia per Excel</button>
        <button class="piccolo primario st-libero" id="li-stampa" ${daCopiare.length ? '' : 'disabled'} title="Stampa il listino o salvalo in PDF">🖨 Stampa / PDF</button>
      </div>
      <div class="griglia solo-editori">
        <label>Nome<input data-campo="nome" value="${l.nome}"></label>
        ${eAlpha ? '' : html`<label>Ricarico su Alpha (%)<input data-campo="ricarico" type="number" step="any" inputmode="decimal" value="${l.ricarico}"></label>
        ${GRUPPI_RICARICO.map(([tipo, nome]) => html`<label>Ricarico ${nome.toLowerCase()} (%)<input data-ricarico="${tipo}" type="number" step="any" inputmode="decimal" value="${l.ricarichi[tipo] ?? ''}" placeholder="come sopra: ${u.numIT(Number(l.ricarico) || 0, 1)}" title="Vuoto = vale il ricarico su Alpha"></label>`)}`}
        <label>Arrotonda per eccesso a<select data-campo="arrotonda">${ARROTONDA.map(([v, n]) => html`<option value="${v}" ${Number(l.arrotonda) === v ? 'selected' : ''}>${n}</option>`)}</select></label>
        <label>Prodotti<select data-campo="prodotti">
          <option value="magazzino" ${l.prodotti === 'magazzino' ? 'selected' : ''}>Solo quelli in magazzino</option>
          <option value="tutti" ${l.prodotti === 'tutti' ? 'selected' : ''}>Tutti i prodotti</option></select></label>
      </div>
      <label class="solo-editori" style="margin-top:10px"><input type="checkbox" data-campo="iva" ${l.iva ? 'checked' : ''}> Prezzi IVA inclusa (${ALIQUOTA_IVA}%)</label>
      <label class="solo-editori" style="margin-top:10px">Note in fondo al titolo (consegna, minimo d'ordine…)<textarea data-campo="note" rows="2">${l.note || ''}</textarea></label>
      ${eAlpha ? html`<p class="totale"><b>Alpha è il listino base</b>: scrivi a mano il prezzo (IVA esclusa) dei prodotti che vendi; togli la spunta a quelli che non vendi. Gli altri listini contengono solo i prodotti con un prezzo in Alpha, più il loro ricarico.</p>` : ''}
      <p class="totale">${daCopiare.length} prodotti nel listino · prezzo = ${eAlpha ? 'prezzo Alpha' : `Alpha ${testoRicarico(l, u.numIT)}`}${l.iva ? ` + IVA ${ALIQUOTA_IVA}%` : ', IVA esclusa'}${Number(l.arrotonda) ? `, arrotondato per eccesso a ${soldi(l.arrotonda)} €` : ''}.
        ${senzaBase ? html`<b>⚠ ${senzaBase} senza prezzo in Alpha</b>: ${eAlpha ? 'scrivilo nella colonna Base o togli la spunta se non lo vendi' : html`scrivilo nel listino <button class="link st-libero" data-scegli="${ID_ALPHA}">Alpha</button>`}.` : ''}</p>
      ${righe.length ? html`<div class="scroll-x"><table class="tab-edit tab-listino">
        <thead><tr><th title="Nel listino">✓</th><th>Formato</th><th class="n li-extra">Giacenza</th><th>${eAlpha ? 'Base €' : 'Alpha €'}</th><th>${eAlpha ? 'Prezzo €' : 'Prezzo listino €'}</th><th class="n li-extra">€/L</th></tr></thead>
        <tbody>${righe.map(r => {
          const prima = r.birra !== birraPrima;
          birraPrima = r.birra;
          return html`${prima ? html`<tr class="li-gruppo"><td colspan="6">${r.birra}${infoBirra(r) ? html` <small class="li-info">${infoBirra(r)}</small>` : ''}</td></tr>` : ''}<tr class="${r.escluso ? 'escluso' : ''}">
            <td><input type="checkbox" data-includi="${r.chiave}" ${r.escluso ? '' : 'checked'} title="Nel listino"></td>
            <td>${r.formato}</td>
            <td class="n li-extra">${r.giacenza ? u.numIT(r.giacenza, 0) : '—'}</td>
            <td>${eAlpha ? html`<input data-base="${r.chiave}" type="number" step="any" inputmode="decimal" value="${r.baseBirra ?? ''}" placeholder="manca" title="Prezzo Alpha di questo prodotto, IVA esclusa">` : euro(r.base)}</td>
            <td>${eAlpha ? euro(r.prezzo) : html`<input data-fisso="${r.chiave}" type="number" step="any" inputmode="decimal" value="${r.fisso ?? ''}" placeholder="${r.calcolato ? soldi(r.calcolato) : '—'}" class="${r.fisso ? 'fisso' : ''}" title="${r.fisso ? `Prezzo scritto a mano (calcolato: ${euro(r.calcolato)}). Cancella per tornare al calcolo.` : 'Prezzo calcolato: scrivi qui per fissarlo a mano'}">`}</td>
            <td class="n li-extra">${r.alLitro ? soldi(r.alLitro) : '—'}</td>
          </tr>`;
        })}</tbody></table></div>
        <p class="totale">${eAlpha ? '' : 'Un prezzo scritto a mano nella colonna del listino vince sul calcolo (cancellalo per tornare al ricarico). '}Senza spunta il prodotto non va nel testo copiato.</p>`
      : html`<p class="totale">${l.prodotti === 'magazzino' ? 'Nessuna birra in magazzino: scegli "Tutti i prodotti" oppure registra confezionamenti e inventario nella pagina Birra.' : 'Nessun prodotto: compaiono quando scrivi il confezionamento nelle schede cotta.'}</p>`}
      ${daCopiare.length ? html`<details class="st-tabella"><summary>Anteprima del testo</summary><pre class="li-anteprima">${testoListino(l, righe, oggi)}</pre></details>` : ''}
      <div class="barra solo-editori">
        ${eAlpha ? '' : html`<button class="piccolo" id="li-duplica">Duplica</button>
        <span class="spazio"></span>
        <button class="piccolo" id="li-elimina">Elimina listino</button>`}
      </div>
    </div>
    ${D.listini.length > 1 ? (() => {
      // per prodotto: gli altri listini hanno solo i prodotti con prezzo in Alpha
      const tutte = D.listini.map(x => new Map(righeListino({ ...x, prodotti: 'tutti' }, D.chiavi, D.giacenze, vendita, D.alpha.esclusi).map(r => [r.chiave, r])));
      const usate = [...tutte[0].values()].filter(r => !r.escluso)
        .map(r => ({ r, prezzi: tutte.map(t => (t.get(r.chiave) && !t.get(r.chiave).escluso ? t.get(r.chiave).prezzo : null)) })).filter(x => x.prezzi.some(Boolean));
      return html`<details class="scheda st-tabella"><summary><b>Tutti i listini a confronto</b></summary>
        <div class="scroll-x"><table class="tab-mag"><thead><tr><th>Prodotto</th>${D.listini.map(x => html`<th class="n">${x.nome}${x.iva ? ' (IVA incl.)' : ''}</th>`)}</tr></thead>
        <tbody>${usate.map(({ r, prezzi }) => html`<tr><td>${r.birra} · ${r.formato}</td>${prezzi.map(p => html`<td class="n">${euro(p)}</td>`)}</tr>`)}</tbody></table></div></details>`;
    })() : ''}`}
    ${daCopiare.length ? foglio(l, righe, oggi) : ''}`;

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
    if (t.dataset.ricarico && l) {
      const ricarichi = { ...l.ricarichi };
      const n = Number(String(t.value).replace(',', '.'));
      if (t.value === '' || !Number.isFinite(n)) delete ricarichi[t.dataset.ricarico]; else ricarichi[t.dataset.ricarico] = n;
      await salvaListino({ ...l, ricarichi });
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
    if (t.id === 'li-stampa') {
      const titolo = document.title;
      document.title = `Listino ${l.nome} ${u.oggiISO()}`;
      addEventListener('afterprint', () => { document.title = titolo; }, { once: true });
      return window.print();
    }
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
