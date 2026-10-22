// Ordini dei clienti (#/ordini-clienti): quelli dal link personale e quelli inseriti nell'app (telefono, WhatsApp),
// con come arrivano (ritiro, giro in zona, corriere), il giro consegne del giorno (#/giro) e il collegamento
// con il carrello per fare la fattura o lo scarico. Anche il link personale di ogni cliente.

import { STATI_ORDINE, MODI_CONSEGNA, linkOrdini, nuovoToken, totaleOrdine } from './portale.js';
import { nomeProdotto } from './birra.js';
import { idCliente, numeroWhatsApp } from './previsioni.js';
import { ID_ALPHA } from './listini.js';
import { leggiCarrello, scriviCarrello, prezzoRiga, clienteFic } from './carrello.js';
import { APERTI, ICONA_MODO, nomeModo, prossimoPasso, indirizzoCompleto, linkMappa, linkPercorso, tappeGiro, caricoGiro, messaggioOrdine, messaggioArrivo } from './consegne.js';

let u; // { $app, html, db, toast, chiedi, copia, dataIT, numIT, oggiISO, addGiorni, token }
export function init(strumenti) { u = strumenti; }

const filtro = { stato: 'aperti', modo: '' };
const euro = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const CORRIERI = ['BRT', 'GLS', 'SDA', 'Poste Italiane', 'DHL', 'UPS', 'TNT FedEx'];

// Anagrafica clienti di Fatture in Cloud (indirizzo e telefono per le consegne), letta una volta per sessione
let anagrafica = null;
function anagraficaFic() {
  anagrafica ||= (async () => {
    const t = await u.token();
    const res = await fetch('/.netlify/functions/fattureincloud?elenco=clienti', { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    let b = null;
    try { b = await res.json(); } catch { /* non JSON: app non online */ }
    if (!res.ok || !b) throw new Error(b?.errore || (res.status === 404 ? 'Fatture in Cloud si collega solo quando l\'app è online sul suo sito.' : `Fatture in Cloud: errore ${res.status}`));
    return b.clienti || [];
  })().catch(e => { anagrafica = null; throw e; });
  return anagrafica;
}
let daAprire = null; // ordine da aprire nel dettaglio quando si arriva sulla pagina (dal carrello)

const senza = ({ aggiornato: _a, ...rec }) => rec;
const wa = (o, testo) => (o.telefono ? `https://wa.me/${numeroWhatsApp(o.telefono)}?text=${encodeURIComponent(testo)}` : '');

// Il telefono e l'indirizzo dell'ordine vengono dalla scheda cliente, se l'ordine non li ha
function conRecapito(o, clienti) {
  const cl = clienti.find(c => c.id === (o.clienteId || idCliente(o.cliente)));
  return { ...o, telefono: o.telefono || cl?.telefono || '', indirizzo: o.indirizzo ?? cl?.indirizzo ?? '', comune: o.comune ?? cl?.comune ?? '' };
}

async function cambiaStato(o, stato) {
  const patch = { stato };
  if (stato === 'consegnato') patch.consegnato = u.oggiISO();
  await u.db.salva({ ...senza(o), ...patch });
  u.toast(`Ordine ${STATI_ORDINE[stato].toLowerCase()}`);
}

export async function vistaOrdini() {
  const { html } = u;
  const [tuttiOrd, clienti] = await Promise.all([u.db.tutti('ordinecliente'), u.db.tutti('cliente')]);
  const ordini = tuttiOrd.map(o => conRecapito(o, clienti));
  ordini.sort((a, b) => String(b.creato || b.data).localeCompare(String(a.creato || a.data)));
  const oggi = u.oggiISO();
  const nelFiltro = (o, s) => (s === 'aperti' ? ['nuovo', 'confermato', 'pronto'].includes(o.stato) : s === 'dafatturare' ? o.stato === 'consegnato' && !o.documento && !o.movimento : s === 'tutti' || o.stato === s);
  const mostrati = ordini.filter(o => nelFiltro(o, filtro.stato) && (!filtro.modo || (o.modo || '') === filtro.modo));
  const conta = s => ordini.filter(o => nelFiltro(o, s)).length;
  const conLink = clienti.filter(c => c.portale?.token && c.portale.attivo !== false).length;
  const giroOggi = tappeGiro(ordini, oggi).length;
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span>
      <a class="btn" href="#/giro">🚐 Giro consegne${giroOggi ? html` <span class="cr-conta">${giroOggi}</span>` : ''}</a>
      <a class="btn" href="#/clienti">📞 Clienti e link</a>
      <button class="primario solo-editori" id="or-nuovo">+ Nuovo ordine</button></div>
    <h1>Ordini dei clienti</h1>
    <p class="totale">Gli ordini dal link personale dei clienti (${conLink} con il link attivo, arrivano anche su Telegram) e quelli presi al telefono o su WhatsApp con "+ Nuovo ordine". Da ogni ordine fai la fattura in Fatture in Cloud in qualsiasi momento, anche dopo la consegna: il magazzino si scarica una volta sola. L'indirizzo si prende dall'anagrafica di Fatture in Cloud.</p>
    <div class="segmenti">${[['aperti', 'Da gestire'], ['spedito', 'Spediti'], ['dafatturare', 'Da fatturare'], ['consegnato', 'Consegnati'], ['annullato', 'Annullati'], ['tutti', 'Tutti']].map(([k, v]) => html`<button data-f="${k}" class="${filtro.stato === k ? 'attivo' : ''}">${v} <b>${conta(k)}</b></button>`)}</div>
    <div class="segmenti" style="margin-left:6px">${[['', 'Tutti i modi'], ...Object.keys(MODI_CONSEGNA).map(k => [k, `${ICONA_MODO[k]} ${MODI_CONSEGNA[k].split(' ')[0]}`])].map(([k, v]) => html`<button data-m="${k}" class="${filtro.modo === k ? 'attivo' : ''}">${v}</button>`)}</div>
    ${!mostrati.length ? html`<p class="vuoto">Nessun ordine${filtro.stato === 'aperti' ? ' da gestire' : ''}.</p>`
    : html`<div class="cl-griglia">${mostrati.map(o => {
      const tot = totaleOrdine(o.righe || []);
      const passo = prossimoPasso(o);
      const ritardo = o.consegna && o.consegna < oggi && APERTI.includes(o.stato);
      return html`<section class="scheda cl-card ${o.stato === 'nuovo' || ritardo ? 'cl-ritardo' : ''}">
        <header><h2>${o.cliente}</h2><span class="badge ${o.stato === 'nuovo' ? 'cop-badge-presto' : ''}">${STATI_ORDINE[o.stato] || o.stato}</span></header>
        <p class="totale">${o.origine === 'app' ? 'Preso il' : 'Arrivato il'} ${u.dataIT(o.data)} · <b>${ICONA_MODO[o.modo] || '❔'} ${nomeModo(o)}</b>${o.consegna ? html` · ${o.modo === 'ritiro' ? 'ritiro' : 'consegna'} ${o.consegna === oggi ? 'oggi' : u.dataIT(o.consegna)}${ritardo ? ' (in ritardo)' : ''}` : ''}</p>
        ${o.modo !== 'ritiro' && indirizzoCompleto(o) ? html`<p class="totale">📍 <a target="_blank" rel="noopener" href="${linkMappa(o)}">${indirizzoCompleto(o)}</a></p>` : ''}
        ${o.modo === 'corriere' && (o.corriere || o.tracking) ? html`<p class="totale">📦 ${o.corriere || 'corriere'}${o.colli ? ` · ${o.colli} colli` : ''}${o.peso ? ` · ${u.numIT(o.peso, 1)} kg` : ''}${o.tracking ? ` · n. ${o.tracking}` : ''}</p>` : ''}
        <ul class="or-elenco">${(o.righe || []).map(r => html`<li>${r.pezzi} × ${nomeProdotto(r.prodotto)}${r.prezzo ? html` <span class="totale">${euro(r.prezzo)}</span>` : ''}</li>`)}</ul>
        ${tot ? html`<p class="totale">Totale indicativo ${euro(tot)} ${(o.righe || []).some(r => r.iva) ? 'IVA inclusa' : '+ IVA'}</p>` : ''}
        ${o.note ? html`<p><i>${o.note}</i></p>` : ''}
        ${o.documento || o.movimento ? html`<p class="totale">🧾 ${o.documento ? `Fattura ${o.documento}` : 'Scaricato dal magazzino'}</p>` : ''}
        <div class="barra solo-editori" style="margin:8px 0 0">
          ${passo ? html`<button class="primario" data-stato="${passo.stato}" data-id="${o.id}">${passo.testo}</button>` : ''}
          <button data-dett="${o.id}">✏️ Dettagli</button>
          ${!o.documento && o.stato !== 'annullato' ? html`<button data-fattura="${o.id}" title="Crea la fattura in Fatture in Cloud con le birre dell'ordine, in qualsiasi momento">🧾 Fattura in Fatture in Cloud</button>` : ''}
          ${!o.documento && !o.movimento && o.stato !== 'annullato' ? html`<button data-carrello="${o.id}" title="Apre il carrello con queste birre: cambi quantità e lotti, o fai uno scarico (taproom, spaccio…)">🧺 Nel carrello</button>` : ''}
          ${o.telefono ? html`<a class="btn" target="_blank" rel="noopener" href="${wa(o, messaggioOrdine(o, u.dataIT))}">📲 WhatsApp</a>` : ''}
          ${APERTI.includes(o.stato) ? html`<button data-stato="annullato" data-id="${o.id}">Annulla</button>` : html`<button data-stato="nuovo" data-id="${o.id}">Riapri</button>`}
        </div>
      </section>`;
    })}</div>`}`;
  u.$app.onclick = async e => {
    const f = e.target.closest('[data-f]');
    if (f) { filtro.stato = f.dataset.f; return vistaOrdini(); }
    const m = e.target.closest('[data-m]');
    if (m) { filtro.modo = m.dataset.m; return vistaOrdini(); }
    if (e.target.closest('#or-nuovo')) return nuovoOrdine();
    const d = e.target.closest('[data-dett]');
    if (d) return dialogOrdine(ordini.find(x => x.id === d.dataset.dett), clienti).then(ok => ok && vistaOrdini());
    const c = e.target.closest('[data-carrello]');
    if (c) return preparaNelCarrello(ordini.find(x => x.id === c.dataset.carrello), clienti);
    const fa = e.target.closest('[data-fattura]');
    if (fa) return preparaNelCarrello(ordini.find(x => x.id === fa.dataset.fattura), clienti, { fattura: true });
    const s = e.target.closest('[data-stato]');
    if (!s) return;
    const o = tuttiOrd.find(x => x.id === s.dataset.id);
    if (s.dataset.stato === 'annullato' && !(await u.chiedi(`Annullare l'ordine di ${o.cliente}?`, 'Annulla ordine'))) return;
    // spedito: prima corriere e numero di spedizione
    if (s.dataset.stato === 'spedito') { if (await dialogOrdine({ ...conRecapito(o, clienti), stato: 'spedito' }, clienti)) vistaOrdini(); return; }
    await cambiaStato(o, s.dataset.stato);
    vistaOrdini();
  };
  if (daAprire) {
    const o = ordini.find(x => x.id === daAprire);
    daAprire = null;
    if (o) dialogOrdine(o, clienti, { nuovo: true }).then(ok => ok && vistaOrdini());
  }
}

// Nuovo ordine: si compone nel carrello (stesso modo di sempre) e si salva come ordine
async function nuovoOrdine() {
  const c = leggiCarrello();
  if (c.righe.length && !c.ordine && !(await u.chiedi('Nel carrello ci sono già delle birre: le usi per il nuovo ordine?', 'Sì, usale'))) return;
  scriviCarrello({ ...c, ordine: '' });
  u.toast('Scegli le birre e premi "Salva come ordine"');
  location.hash = '#/birra-carrello';
}

// Mette le righe dell'ordine nel carrello, per fare la fattura o lo scarico
async function preparaNelCarrello(o, clienti, { fattura = false } = {}) {
  const c = leggiCarrello();
  if (c.righe.length && c.ordine !== o.id && !(await u.chiedi('Il carrello non è vuoto: lo sostituisco con questo ordine?', 'Sostituisci'))) return;
  const scheda = clienti.find(x => x.id === (o.clienteId || idCliente(o.cliente)));
  scriviCarrello({
    cliente: o.cliente, listino: scheda?.portale?.listino || ID_ALPHA, ordine: o.id, ...(fattura ? { apriFattura: true } : {}),
    righe: (o.righe || []).map(r => ({ prodotto: r.prodotto, pezzi: r.pezzi, lotto: r.lotto || '', prezzo: r.prezzo ?? null })),
  });
  location.hash = '#/birra-carrello';
}

// Dal carrello: salva (o aggiorna) l'ordine con le birre del carrello e apre i dettagli
export async function salvaDaCarrello(c, prezzi, iva) {
  const righe = c.righe.filter(r => r.prodotto && Number(r.pezzi) > 0).map(r => {
    const p = prezzoRiga(r, prezzi);
    return { prodotto: r.prodotto, pezzi: Number(r.pezzi), prezzo: p, iva: !!iva, ...(r.lotto ? { lotto: r.lotto } : {}) };
  });
  const esistente = c.ordine ? await u.db.leggi(c.ordine) : null;
  const o = esistente && !esistente.eliminato
    ? { ...senza(esistente), cliente: c.cliente.trim(), clienteId: esistente.cliente === c.cliente.trim() ? esistente.clienteId : idCliente(c.cliente), righe }
    : { id: u.db.nuovoId('ordinecliente'), tipo: 'ordinecliente', origine: 'app', cliente: c.cliente.trim(), clienteId: idCliente(c.cliente), data: u.oggiISO(), consegna: '', righe, note: '', stato: 'confermato', creato: new Date().toISOString() };
  await u.db.salva(o);
  daAprire = o.id;
  location.hash = '#/ordini-clienti';
  return o;
}

// Dopo la fattura o lo scarico dal carrello: l'ordine si segna con il documento e le birre davvero uscite
export async function collegaDocumento(id, { documento = '', movimento = '', righe }) {
  const o = id && await u.db.leggi(id);
  if (!o || o.eliminato) return;
  const vecchie = new Map((o.righe || []).map(r => [r.prodotto, r]));
  await u.db.salva({
    ...senza(o), documento, movimento,
    righe: righe.map(r => ({ ...(vecchie.get(r.prodotto) || {}), prodotto: r.prodotto, pezzi: r.pezzi, ...(r.lotto ? { lotto: r.lotto } : {}) })),
    stato: ['nuovo', 'confermato'].includes(o.stato) ? 'pronto' : o.stato,
  });
}

// Dettagli dell'ordine: come arriva, quando, dove, corriere. Indirizzo e telefono restano anche nella scheda cliente.
function dialogOrdine(o, clienti, { nuovo = false } = {}) {
  const { html } = u;
  return new Promise(risolvi => {
    const d = document.createElement('dialog');
    const nomi = [...new Set(clienti.map(c => c.nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    d.innerHTML = html`<form method="dialog" class="or-dett">
      <h2 style="margin-top:0">${nuovo ? 'Ordine salvato: come lo consegni?' : `Ordine di ${o.cliente}`}</h2>
      <label>Cliente <input name="cliente" list="od-cli" value="${o.cliente}" required></label>
      <datalist id="od-cli">${nomi.map(n => html`<option value="${n}">`)}</datalist>
      <div class="segmenti od-modi">${Object.entries(MODI_CONSEGNA).map(([k, v]) => html`<button type="button" data-modo="${k}" class="${o.modo === k ? 'attivo' : ''}">${ICONA_MODO[k]} ${v}</button>`)}</div>
      <div class="griglia">
        <label>Stato <select name="stato">${Object.entries(STATI_ORDINE).map(([k, v]) => html`<option value="${k}" ${o.stato === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label><span class="od-quando">Data</span> <input type="date" name="consegna" value="${o.consegna || ''}"></label>
        <label>Telefono <input type="tel" name="telefono" value="${o.telefono || ''}" placeholder="per WhatsApp"></label>
      </div>
      <div class="griglia od-dove">
        <label>Indirizzo <input name="indirizzo" value="${o.indirizzo || ''}" placeholder="via e numero"></label>
        <label>Comune <input name="comune" value="${o.comune || ''}"></label>
      </div>
      <div class="barra od-dove" style="margin:0"><button type="button" class="piccolo" id="od-fic">📥 Indirizzo da Fatture in Cloud</button><span class="totale" id="od-fic-stato"></span></div>
      <div class="griglia od-corriere">
        <label>Corriere <input name="corriere" list="od-corr" value="${o.corriere || ''}"></label>
        <datalist id="od-corr">${CORRIERI.map(n => html`<option value="${n}">`)}</datalist>
        <label>Colli <input type="number" name="colli" min="0" step="1" inputmode="numeric" value="${o.colli ?? ''}"></label>
        <label>Peso kg <input type="number" name="peso" min="0" step="0.1" inputmode="decimal" value="${o.peso ?? ''}"></label>
        <label>N. spedizione <input name="tracking" value="${o.tracking || ''}" placeholder="tracking"></label>
      </div>
      <label>Note <textarea name="note" rows="2">${o.note || ''}</textarea></label>
      <label>Fattura o DDT <input name="documento" value="${o.documento || ''}" placeholder="se l'hai fatta direttamente in Fatture in Cloud"></label>
      <div class="barra">${!o.documento && o.stato !== 'annullato' ? html`<button type="button" id="od-fattura">🧾 Fattura in Fatture in Cloud</button>` : ''}<span class="spazio"></span>${o.origine === 'app' && !nuovo ? html`<button type="button" id="od-elimina">Elimina</button>` : ''}<button value="no" formnovalidate>Chiudi</button><button class="primario" value="si">Salva</button></div>
    </form>`.s;
    const f = d.querySelector('form');
    let modo = o.modo || '';
    const aggiorna = () => {
      d.querySelectorAll('[data-modo]').forEach(b => b.classList.toggle('attivo', b.dataset.modo === modo));
      d.querySelector('.od-dove').hidden = modo === 'ritiro';
      d.querySelector('.od-corriere').hidden = modo !== 'corriere';
      d.querySelector('.od-quando').textContent = modo === 'ritiro' ? 'Ritiro il' : modo === 'corriere' ? 'Spedizione il' : 'Consegna il';
    };
    aggiorna();
    // indirizzo e telefono dall'anagrafica di Fatture in Cloud: da soli se l'ordine non li ha, col bottone per riprenderli
    let ficId = o.ficId || '';
    const daFic = async sovrascrivi => {
      const $s = d.querySelector('#od-fic-stato');
      $s.textContent = 'Cerco in Fatture in Cloud…';
      try {
        const c = clienteFic(await anagraficaFic(), f.cliente.value, sovrascrivi ? '' : ficId);
        if (!c) { $s.textContent = 'Cliente non trovato in Fatture in Cloud'; return; }
        if (!c.indirizzo && !c.comune && !c.telefono) { $s.textContent = `${c.nome}: in Fatture in Cloud non ha indirizzo`; return; }
        ficId = c.id;
        for (const k of ['indirizzo', 'comune', 'telefono']) if (c[k] && (sovrascrivi || !f[k].value.trim())) f[k].value = c[k];
        $s.textContent = `✓ Da Fatture in Cloud: ${c.nome}`;
      } catch (ex) { $s.textContent = ex.message; }
    };
    if (!o.indirizzo && !o.comune && modo !== 'ritiro') daFic(false);
    d.addEventListener('click', async e => {
      const b = e.target.closest('[data-modo]');
      if (b) { modo = b.dataset.modo; aggiorna(); return; }
      if (e.target.id === 'od-fic') { daFic(true); return; }
      if (e.target.id === 'od-fattura') { d.close('no'); preparaNelCarrello(o, clienti, { fattura: true }); return; }
      if (e.target.id === 'od-elimina' && await u.chiedi(`Eliminare l'ordine di ${o.cliente}?`, 'Elimina')) { await u.db.elimina(o.id); d.close('eliminato'); }
    });
    f.addEventListener('submit', async e => {
      if (e.submitter?.value !== 'si') return;
      e.preventDefault();
      const v = k => f[k].value.trim();
      const num = k => (f[k].value === '' ? null : Number(f[k].value));
      const nome = v('cliente');
      if (!nome) return u.toast('Scrivi il cliente');
      const stato = f.stato.value;
      const rec = {
        ...senza(o), cliente: nome, clienteId: o.clienteId && o.cliente === nome ? o.clienteId : idCliente(nome), modo, stato,
        consegna: f.consegna.value, telefono: v('telefono'), indirizzo: v('indirizzo'), comune: v('comune'), note: v('note'), documento: v('documento'),
        corriere: v('corriere'), colli: num('colli'), peso: num('peso'), tracking: v('tracking'),
        ...(ficId ? { ficId } : {}),
        ...(stato === 'consegnato' && o.stato !== 'consegnato' ? { consegnato: u.oggiISO() } : {}),
      };
      await u.db.salva(rec);
      // recapito nella scheda cliente, per i prossimi ordini e il link personale
      const scheda = await u.db.leggi(rec.clienteId);
      const patch = Object.fromEntries(['telefono', 'indirizzo', 'comune', 'modo'].filter(k => rec[k] && rec[k] !== scheda?.[k]).map(k => [k, rec[k]]));
      if (Object.keys(patch).length) await u.db.salva({ ...(scheda && !scheda.eliminato ? senza(scheda) : { id: rec.clienteId, tipo: 'cliente', nome }), ...patch });
      u.toast('Ordine salvato');
      d.close('si');
    });
    d.addEventListener('close', () => { d.remove(); risolvi(d.returnValue === 'si' || d.returnValue === 'eliminato'); });
    document.body.appendChild(d);
    d.showModal();
  });
}

// ---------- giro consegne in zona ----------
let giorno = null;
export async function vistaGiro() {
  const { html } = u;
  const oggi = u.oggiISO();
  if (!giorno) giorno = oggi;
  const [tuttiOrd, clienti] = await Promise.all([u.db.tutti('ordinecliente'), u.db.tutti('cliente')]);
  const ordini = tuttiOrd.map(o => conRecapito(o, clienti));
  const tappe = tappeGiro(ordini, giorno);
  const carico = caricoGiro(tappe);
  const senzaData = ordini.filter(o => o.modo === 'zona' && ['nuovo', 'confermato', 'pronto'].includes(o.stato) && !o.consegna);
  const fatti = ordini.filter(o => o.modo === 'zona' && o.stato === 'consegnato' && o.consegnato === giorno);
  const percorso = linkPercorso(tappe);
  const domani = u.addGiorni(oggi, 1);
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/ordini-clienti" class="btn">← Ordini</a><span class="spazio"></span>
      <div class="segmenti"><button data-g="${oggi}" class="${giorno === oggi ? 'attivo' : ''}">Oggi</button><button data-g="${domani}" class="${giorno === domani ? 'attivo' : ''}">Domani</button></div>
      <input type="date" id="gi-data" value="${giorno}" aria-label="Giorno del giro"></div>
    <h1>🚐 Giro consegne</h1>
    <p class="totale">Gli ordini "Consegna in zona" con la data fino al ${u.dataIT(giorno)} (quelli in ritardo restano qui). Mettili in ordine con le frecce: il percorso su Google Maps parte da dove sei e passa per le tappe in quell'ordine.</p>
    ${!tappe.length ? html`<p class="vuoto">Nessuna consegna in zona per il ${u.dataIT(giorno)}.</p>` : html`
      <div class="barra">${percorso ? html`<a class="btn primario" target="_blank" rel="noopener" href="${percorso}">🗺️ Percorso su Google Maps (${Math.min(tappe.length, 10)} tappe)</a>` : ''}</div>
      ${tappe.length > 10 ? html`<p class="totale">Google Maps prende al massimo 10 tappe per percorso: le altre aprile una per una.</p>` : ''}
      <section class="scheda"><h2>Da caricare sul furgone</h2>
        <ul class="or-elenco">${carico.map(r => html`<li><b>${r.pezzi}</b> × ${r.nome}</li>`)}</ul></section>
      <ol class="gi-tappe">${tappe.map((o, i) => html`<li class="scheda cl-card">
        <header><h2>${i + 1}. ${o.cliente}</h2><span class="badge">${STATI_ORDINE[o.stato]}${o.consegna < giorno ? ` · dal ${u.dataIT(o.consegna)}` : ''}</span></header>
        ${indirizzoCompleto(o) ? html`<p>📍 <a target="_blank" rel="noopener" href="${linkMappa(o)}">${indirizzoCompleto(o)}</a></p>` : html`<p class="cr-avviso">Indirizzo mancante: aggiungilo in Dettagli</p>`}
        <ul class="or-elenco">${(o.righe || []).map(r => html`<li>${r.pezzi} × ${nomeProdotto(r.prodotto)}</li>`)}</ul>
        ${o.note ? html`<p><i>${o.note}</i></p>` : ''}
        ${!o.documento && !o.movimento ? html`<p class="totale">Senza fattura né scarico: falli da Ordini con "Fattura o scarico".</p>` : ''}
        <div class="barra solo-editori" style="margin:8px 0 0">
          <button class="primario" data-fatto="${o.id}">✓ Consegnato</button>
          ${o.telefono ? html`<a class="btn" href="tel:${o.telefono}">📞</a><a class="btn" target="_blank" rel="noopener" href="${wa(o, messaggioArrivo(o))}">📲 Sto arrivando</a>` : ''}
          <span class="spazio"></span>
          <button class="piccolo" data-su="${i}" ${i ? '' : 'disabled'} aria-label="Prima">↑</button><button class="piccolo" data-giu="${i}" ${i < tappe.length - 1 ? '' : 'disabled'} aria-label="Dopo">↓</button>
        </div></li>`)}</ol>`}
    ${senzaData.length ? html`<section class="scheda"><h2>Da consegnare in zona, senza data</h2>
      <ul class="or-elenco">${senzaData.map(o => html`<li><b>${o.cliente}</b>${o.comune ? ` · ${o.comune}` : ''} · ${(o.righe || []).map(r => `${r.pezzi} × ${nomeProdotto(r.prodotto)}`).join(', ')}
        <button class="piccolo solo-editori" data-metti="${o.id}">+ Nel giro del ${u.dataIT(giorno)}</button></li>`)}</ul></section>` : ''}
    ${fatti.length ? html`<section class="scheda"><h2>Consegnati il ${u.dataIT(giorno)}</h2><ul class="or-elenco">${fatti.map(o => html`<li>✓ ${o.cliente}${o.comune ? ` · ${o.comune}` : ''}</li>`)}</ul></section>` : ''}`;
  const trova = id => tuttiOrd.find(x => x.id === id);
  u.$app.onchange = e => { if (e.target.id === 'gi-data' && e.target.value) { giorno = e.target.value; vistaGiro(); } };
  u.$app.onclick = async e => {
    const g = e.target.closest('[data-g]');
    if (g) { giorno = g.dataset.g; return vistaGiro(); }
    const fatto = e.target.closest('[data-fatto]');
    if (fatto) { await cambiaStato(trova(fatto.dataset.fatto), 'consegnato'); return vistaGiro(); }
    const metti = e.target.closest('[data-metti]');
    if (metti) {
      const o = trova(metti.dataset.metti);
      await u.db.salva({ ...senza(o), consegna: giorno, stato: o.stato === 'nuovo' ? 'confermato' : o.stato, giroPosto: tappe.length });
      return vistaGiro();
    }
    const su = e.target.closest('[data-su]'), giu = e.target.closest('[data-giu]');
    if (!su && !giu) return;
    const i = Number((su || giu).dataset[su ? 'su' : 'giu']), j = su ? i - 1 : i + 1;
    const nuovi = [...tappe];
    [nuovi[i], nuovi[j]] = [nuovi[j], nuovi[i]];
    // si salva il posto di tutte le tappe, così l'ordine resta anche sugli altri dispositivi
    await u.db.salvaMolti(nuovi.map((o, k) => ({ ...senza(trova(o.id)), giroPosto: k })).filter((o, k) => trova(o.id).giroPosto !== k));
    vistaGiro();
  };
}

// Dialog del link personale di un cliente (da Clienti): crea, sceglie il listino, copia, disattiva
export async function dialogLink(nome, scheda) {
  const { html } = u;
  const listini = (await u.db.tutti('listino')).filter(l => l.id !== ID_ALPHA);
  const id = scheda?.id || idCliente(nome);
  let rec = scheda ? { ...scheda } : { id, tipo: 'cliente', nome };
  delete rec.aggiornato;
  const salva = async patch => { rec = { ...rec, portale: { ...rec.portale, ...patch } }; await u.db.salva(rec); };
  if (!rec.portale?.token) await salva({ token: nuovoToken(), attivo: true, listino: listini[0]?.id || '' });
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
  const d = document.createElement('dialog');
  const disegna = () => {
    const link = linkOrdini(rec.portale.token, base);
    d.innerHTML = html`<form method="dialog">
      <h2 style="margin-top:0">Link ordini · ${nome}</h2>
      <p class="totale">Con questo link ${nome} vede le birre disponibili oggi con i prezzi del listino scelto e manda l'ordine, senza password. Non condividerlo con altri: se serve, crea un link nuovo (quello vecchio smette di funzionare).</p>
      <label>Listino dei prezzi<select id="ln-listino"><option value="">Nessuno: prezzo su richiesta</option>${listini.map(l => html`<option value="${l.id}" ${l.id === rec.portale.listino ? 'selected' : ''}>${l.nome}</option>`)}</select></label>
      <label class="spunta"><input type="checkbox" id="ln-attivo" ${rec.portale.attivo !== false ? 'checked' : ''}> Link attivo</label>
      <p class="ln-link"><code>${link}</code></p>
      <div class="barra"><button type="button" id="ln-copia">Copia il link</button>
        ${rec.telefono ? html`<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${numeroWhatsApp(rec.telefono)}?text=${encodeURIComponent(`Ciao ${nome.split(/\s+/)[0]}, da qui puoi vedere le nostre birre disponibili e ordinare quando vuoi: ${link}`)}">📲 Manda su WhatsApp</a>` : ''}
        <button type="button" id="ln-nuovo">Crea un link nuovo</button></div>
      <div class="barra"><span class="spazio"></span><button value="ok" class="primario">Fatto</button></div>
    </form>`.s;
  };
  disegna();
  d.addEventListener('change', async e => {
    if (e.target.id === 'ln-listino') await salva({ listino: e.target.value });
    if (e.target.id === 'ln-attivo') await salva({ attivo: e.target.checked });
    u.toast('Salvato');
  });
  d.addEventListener('click', async e => {
    if (e.target.id === 'ln-copia') u.copia(linkOrdini(rec.portale.token, base), 'Link copiato');
    if (e.target.id === 'ln-nuovo' && await u.chiedi('Creare un link nuovo? Quello di adesso smette di funzionare.', 'Crea')) { await salva({ token: nuovoToken() }); disegna(); }
  });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
}
