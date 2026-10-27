// Pagine "Copertura birra" (#/copertura) e "Clienti da richiamare" (#/clienti).
// Calcoli in js/previsioni.js; i dati di vendita sono gli scarichi del magazzino birra (fatture, Shopify, taproom…).

import { ID_IMPOSTAZIONI, giacenzeBirra, listaDisponibili, testoListaBirre } from './birra.js';
import { impegnatiOrdini } from './portale.js';
import { coperturaBirre, statoClienti, messaggioCliente, numeroWhatsApp, SETTIMANE_VENDITE } from './previsioni.js';

let u; // { $app, html, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni, pianifica, linkOrdini }
export function init(strumenti) { u = strumenti; }

async function datiBirra() {
  const [movimenti, inventari, prodotti, imp, clienti, ordini] = await Promise.all([
    u.db.tutti('movbirra'), u.db.tutti('inventariobirra'), u.db.tutti('prodottobirra'), u.db.leggi(ID_IMPOSTAZIONI), u.db.tutti('cliente'), u.db.tutti('ordinecliente'),
  ]);
  return { cotte: u.stato.cotte, durate: u.stato.durate, movimenti, inventari, prodotti, impostazioni: imp && !imp.eliminato ? imp : null, clienti, impegnati: impegnatiOrdini(ordini) };
}
const L = n => `${u.numIT(n, 0)} L`;

// ---------- copertura ----------
export async function vistaCopertura() {
  const { html } = u;
  const dati = await datiBirra();
  const oggi = u.oggiISO();
  const avviato = !!dati.impostazioni?.inizio;
  const righe = avviato ? coperturaBirre({ giac: giacenzeBirra(dati, oggi), cotte: dati.cotte, durate: dati.durate }, { oggi }) : [];
  const STATO = { ritardo: 'in ritardo', presto: 'pianifica ora', ok: '' };
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span><a class="btn" href="#/clienti">📞 Clienti da richiamare</a></div>
    <h1>Copertura birra</h1>
    <p class="totale">Per ogni birra: quanto ne esce a settimana (media delle ultime ${SETTIMANE_VENDITE} settimane, tutti gli scarichi), quanto ne resta in magazzino e nei fermentatori, quando finisce e entro quando fare la prossima cotta perché sia pronta in tempo (durata tipica in FV + 7 giorni per confezionare). Le cotte già pianificate contano dal giorno in cui sono pronte.</p>
    ${!avviato ? html`<p class="vuoto">Il magazzino birra non è ancora avviato: fai il primo inventario in <a href="#/birra-inventario">Birra → Inventario</a>, poi qui trovi le previsioni.</p>`
    : !righe.length ? html`<p class="vuoto">Nessuna vendita nelle ultime ${SETTIMANE_VENDITE} settimane.</p>`
    : html`<div class="scroll-x"><table class="tab-mag copertura">
      <thead><tr><th>Birra</th><th class="n">Esce a settimana</th><th class="n">Magazzino</th><th class="n">In FV</th><th>Cotte pianificate</th><th>Finisce</th><th>Cotta entro</th><th></th></tr></thead>
      <tbody>${righe.map(b => html`<tr class="cop-${b.stato}">
        <td><b>${b.birra}</b></td>
        <td class="n">${L(b.settimana)}</td>
        <td class="n">${L(b.magazzino)}</td>
        <td class="n">${b.inFv ? L(b.inFv) : ''}</td>
        <td>${b.pianificate.map(p => html`<a href="#/cotta/${encodeURIComponent(p.g[0].id)}">${u.dataIT(p.data)}</a> `)}</td>
        <td>${b.esaurita ? 'esaurita' : u.dataIT(b.esaurimento)} <span class="totale">${b.esaurita ? '' : `${u.numIT(b.settimaneCopertura, 1)} sett.`}</span></td>
        <td>${u.dataIT(b.cottaEntro)}${STATO[b.stato] ? html` <span class="badge cop-badge-${b.stato}">${STATO[b.stato]}</span>` : ''}</td>
        <td class="az"><button class="piccolo solo-editori" data-pianifica="${b.birra}" data-entro="${b.cottaEntro}" data-src="${b.ultimaCotta?.id || ''}">+ Pianifica</button></td>
      </tr>`)}</tbody></table></div>
      <p class="totale">"Pianifica" apre la cotta nuova copiata dall'ultima di quella birra, alla data consigliata: con 🔎 trovi la prima data con un FV libero.</p>`}`;
  u.$app.onclick = e => {
    const b = e.target.closest('[data-pianifica]');
    if (!b) return;
    const data = b.dataset.entro < oggi ? oggi : b.dataset.entro;
    u.pianifica({ titolo: 'Pianifica cotta', birra: b.dataset.pianifica, data, copiaDa: b.dataset.src || undefined });
  };
}

// ---------- clienti da richiamare ----------
const filtro = { tutti: false };
export async function vistaClienti() {
  const { html } = u;
  const dati = await datiBirra();
  const oggi = u.oggiISO();
  const clienti = statoClienti(dati.movimenti, dati.clienti, dati.prodotti, oggi);
  const daChiamare = clienti.filter(c => c.daRichiamare);
  const mostrati = filtro.tutti ? clienti : daChiamare;
  const lista = testoListaBirre(listaDisponibili(dati, oggi), oggi);
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span><a class="btn" href="#/copertura">📉 Copertura birra</a></div>
    <h1>Clienti da richiamare</h1>
    <p class="totale">Dalle vendite registrate (fatture importate e scarichi con il cliente): per ogni cliente il ritmo abituale degli ordini. Chi non ordina da più del solito compare qui, con il messaggio WhatsApp già scritto e le birre disponibili oggi.</p>
    <div class="segmenti" id="cl-filtro">
      <button data-f="0" class="${filtro.tutti ? '' : 'attivo'}">Da richiamare (${daChiamare.length})</button>
      <button data-f="1" class="${filtro.tutti ? 'attivo' : ''}">Tutti i clienti (${clienti.length})</button>
    </div>
    ${!clienti.length ? html`<p class="vuoto">Nessuna vendita con il nome del cliente: arrivano con l'import da Fatture in Cloud.</p>`
    : !mostrati.length ? html`<p class="vuoto">✓ Nessun cliente in ritardo sul suo solito ritmo.</p>`
    : html`<div class="cl-griglia">${mostrati.map(c => html`<section class="scheda cl-card ${c.daRichiamare ? 'cl-ritardo' : ''}" data-id="${c.id}">
      <header><h2>${c.nome}</h2>${c.daRichiamare ? html`<span class="badge cop-badge-presto">${c.ritardo} gg di ritardo</span>` : c.rimandato ? html`<span class="badge">rimandato al ${u.dataIT(c.scheda.rimandaFino)}</span>` : ''}</header>
      <p class="totale">Ultimo ordine ${c.giorni === 0 ? 'oggi' : `${c.giorni} giorni fa`} (${u.dataIT(c.ultimo)}) · ${c.ordini} ordini · ${L(c.litri)} in tutto${c.ritmo ? ` · di solito ogni ${c.ritmo} giorni` : ''}</p>
      ${c.birre.length ? html`<p class="totale">Prende: ${c.birre.join(', ')}</p>` : ''}
      <div class="griglia cl-campi">
        <label>Telefono <input data-k="telefono" type="tel" value="${c.telefono}" placeholder="per WhatsApp"></label>
        <label>Indirizzo <input data-k="indirizzo" value="${c.scheda?.indirizzo || ''}" placeholder="per le consegne"></label>
        <label>Comune <input data-k="comune" value="${c.scheda?.comune || ''}"></label>
        <label>Ogni quanti giorni ordina <input data-k="ritmoGiorni" type="number" min="1" inputmode="numeric" value="${c.scheda?.ritmoGiorni || ''}" placeholder="${c.ritmo ? `calcolato: ${c.ritmo}` : 'da scrivere'}"></label>
      </div>
      <div class="barra solo-editori" style="margin:8px 0 0">
        <button class="primario" data-wa="${c.id}">📲 WhatsApp</button>
        <button data-rimanda="${c.id}" title="Sparisce dalla lista per due settimane">✓ Sentito, rimanda</button>
        <label class="spunta" style="min-height:auto"><input type="checkbox" data-k="nonRichiamare" ${c.scheda?.nonRichiamare ? 'checked' : ''}> Non richiamare</label>
        <button data-link="${c.id}" title="Link personale per ordinare online">🔗 Link ordini${c.scheda?.portale?.token && c.scheda.portale.attivo !== false ? ' ✓' : ''}</button>
      </div>
    </section>`)}</div>`}`;
  const salva = async (id, patch) => {
    const c = clienti.find(x => x.id === id);
    const { aggiornato: _a, ...s } = c.scheda || { id, tipo: 'cliente', nome: c.nome };
    await u.db.salva({ ...s, id, tipo: 'cliente', ...patch });
  };
  u.$app.onchange = async e => {
    const t = e.target, card = t.closest('[data-id]');
    if (!card || !t.dataset.k) return;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value ? Number(t.value) : null) : t.value.trim();
    await salva(card.dataset.id, { [t.dataset.k]: v });
    u.toast('Salvato');
    if (!['telefono', 'indirizzo', 'comune'].includes(t.dataset.k)) vistaClienti();
  };
  u.$app.onclick = async e => {
    const f = e.target.closest('[data-f]');
    if (f) { filtro.tutti = f.dataset.f === '1'; return vistaClienti(); }
    const wa = e.target.closest('[data-wa]');
    if (wa) {
      const c = clienti.find(x => x.id === wa.dataset.wa);
      const tel = numeroWhatsApp(u.$app.querySelector(`[data-id="${c.id}"] [data-k="telefono"]`)?.value || c.telefono);
      window.open(`https://wa.me/${tel}?text=${encodeURIComponent(messaggioCliente(c, lista))}`, '_blank');
      return;
    }
    const l = e.target.closest('[data-link]');
    if (l) { const c = clienti.find(x => x.id === l.dataset.link); return u.linkOrdini(c.nome, c.scheda); }
    const r = e.target.closest('[data-rimanda]');
    if (r) { await salva(r.dataset.rimanda, { rimandaFino: u.addGiorni(oggi, 14), ultimoContatto: oggi }); u.toast('Rimandato di due settimane'); vistaClienti(); }
  };
}
