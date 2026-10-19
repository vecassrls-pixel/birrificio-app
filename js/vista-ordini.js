// Ordini dei clienti arrivati dalla pagina pubblica (#/ordini-clienti) e link personale di ogni cliente.

import { STATI_ORDINE, linkOrdini, nuovoToken, totaleOrdine } from './portale.js';
import { nomeProdotto } from './birra.js';
import { idCliente, numeroWhatsApp } from './previsioni.js';
import { ID_ALPHA } from './listini.js';

let u; // { $app, html, db, toast, chiedi, copia, dataIT, numIT }
export function init(strumenti) { u = strumenti; }

const filtro = { stato: 'aperti' };
const euro = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const APERTI = ['nuovo', 'confermato'];

export async function vistaOrdini() {
  const { html } = u;
  const [ordini, clienti] = await Promise.all([u.db.tutti('ordinecliente'), u.db.tutti('cliente')]);
  ordini.sort((a, b) => String(b.creato || b.data).localeCompare(String(a.creato || a.data)));
  const mostrati = ordini.filter(o => (filtro.stato === 'aperti' ? APERTI.includes(o.stato) : filtro.stato === 'tutti' || o.stato === filtro.stato));
  const conta = s => ordini.filter(o => (s === 'aperti' ? APERTI.includes(o.stato) : o.stato === s)).length;
  const conLink = clienti.filter(c => c.portale?.token && c.portale.attivo !== false).length;
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span><a class="btn" href="#/clienti">📞 Clienti e link</a></div>
    <h1>Ordini dei clienti</h1>
    <p class="totale">Gli ordini che i clienti mandano dal loro link personale (${conLink} clienti con il link attivo; il link si crea in Clienti). Quando arriva un ordine c'è anche il messaggio su Telegram. La fattura o il DDT si fanno come sempre in Fatture in Cloud: lo scarico dal magazzino arriva da lì.</p>
    <div class="segmenti">${[['aperti', 'Da gestire'], ['consegnato', 'Consegnati'], ['annullato', 'Annullati'], ['tutti', 'Tutti']].map(([k, v]) => html`<button data-f="${k}" class="${filtro.stato === k ? 'attivo' : ''}">${v} <b>${k === 'tutti' ? ordini.length : conta(k)}</b></button>`)}</div>
    ${!mostrati.length ? html`<p class="vuoto">Nessun ordine${filtro.stato === 'aperti' ? ' da gestire' : ''}.</p>`
    : html`<div class="cl-griglia">${mostrati.map(o => {
      const cl = clienti.find(c => c.id === o.clienteId);
      const tot = totaleOrdine(o.righe);
      return html`<section class="scheda cl-card ${o.stato === 'nuovo' ? 'cl-ritardo' : ''}">
        <header><h2>${o.cliente}</h2><span class="badge ${o.stato === 'nuovo' ? 'cop-badge-presto' : ''}">${STATI_ORDINE[o.stato] || o.stato}</span></header>
        <p class="totale">Arrivato il ${u.dataIT(o.data)}${o.consegna ? ` · consegna richiesta ${u.dataIT(o.consegna)}` : ''}</p>
        <ul class="or-elenco">${o.righe.map(r => html`<li>${r.pezzi} × ${nomeProdotto(r.prodotto)}${r.prezzo ? html` <span class="totale">${euro(r.prezzo)}</span>` : ''}</li>`)}</ul>
        ${tot ? html`<p class="totale">Totale indicativo ${euro(tot)} ${o.righe.some(r => r.iva) ? 'IVA inclusa' : '+ IVA'}</p>` : ''}
        ${o.note ? html`<p><i>${o.note}</i></p>` : ''}
        <div class="barra solo-editori" style="margin:8px 0 0">
          ${o.stato === 'nuovo' ? html`<button class="primario" data-stato="confermato" data-id="${o.id}">Conferma</button>` : ''}
          ${APERTI.includes(o.stato) ? html`<button data-stato="consegnato" data-id="${o.id}">Consegnato</button><button data-stato="annullato" data-id="${o.id}">Annulla</button>` : html`<button data-stato="nuovo" data-id="${o.id}">Riapri</button>`}
          ${cl?.telefono ? html`<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${numeroWhatsApp(cl.telefono)}?text=${encodeURIComponent(`Ciao ${o.cliente.split(/\s+/)[0]}, abbiamo ricevuto il tuo ordine del ${u.dataIT(o.data)}. `)}">📲 WhatsApp</a>` : ''}
        </div>
      </section>`;
    })}</div>`}`;
  u.$app.onclick = async e => {
    const f = e.target.closest('[data-f]');
    if (f) { filtro.stato = f.dataset.f; return vistaOrdini(); }
    const s = e.target.closest('[data-stato]');
    if (!s) return;
    const o = ordini.find(x => x.id === s.dataset.id);
    if (s.dataset.stato === 'annullato' && !(await u.chiedi(`Annullare l'ordine di ${o.cliente}?`, 'Annulla ordine'))) return;
    const { aggiornato: _a, ...rec } = o;
    await u.db.salva({ ...rec, stato: s.dataset.stato });
    u.toast(`Ordine ${STATI_ORDINE[s.dataset.stato].toLowerCase()}`);
    vistaOrdini();
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
