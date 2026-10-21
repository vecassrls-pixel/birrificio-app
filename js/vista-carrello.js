// Birra → 🧺 Carrello (#/birra-carrello): le birre disponibili si trascinano (o si toccano) nel carrello,
// poi il carrello diventa una fattura in Fatture in Cloud o uno scarico di magazzino (taproom, spaccio…).
// La fattura creata da qui scarica subito il magazzino con lo stesso riferimento dell'import notturno,
// così la stessa vendita non esce due volte.

import { MOTIVI_SCARICO, giacenzeBirra, listaDisponibili, nomeProdotto, nomeFormato, maiuscole } from './birra.js';
import { ID_ALPHA } from './listini.js';
import { idCliente } from './previsioni.js';
import { pezziCartone } from './etichetta.js';
import { datiBirra, apriScarico } from './vista-birra.js';
import { salvaDaCarrello, collegaDocumento } from './vista-ordini.js';
import {
  leggiCarrello, scriviCarrello, svuotaCarrello, passo, prezziListino, prezzoRiga, righeFattura, righeMovimento, TIPO_DRAG, trascinabile, mettiNelCarrello,
} from './carrello.js';

let u; // { $app, html, db, toast, chiedi, dataIT, numIT, oggiISO, token }
export function init(strumenti) { u = strumenti; }

const euro = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const ICONA = { fusto: '🛢️', 'lattina/bottiglia': '🥫' };
const filtro = { q: '' };
let fatto = null; // ultima fattura creata, mostrata in cima finché si resta sulla pagina

async function fic(metodo, corpo, query = '') {
  const t = await u.token();
  const res = await fetch(`/.netlify/functions/fattureincloud${query}`, {
    method: metodo, headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non JSON: app non online */ }
  if (!res.ok || !body) throw new Error(body?.errore || (res.status === 404 ? 'Fatture in Cloud si collega solo quando l\'app è online sul suo sito.' : `Fatture in Cloud: errore ${res.status}`));
  return body;
}

export async function vistaCarrello() {
  const { html } = u;
  const [dati, listini, clienti] = await Promise.all([datiBirra(), u.db.tutti('listino'), u.db.tutti('cliente')]);
  const oggi = u.oggiISO();
  const disponibili = listaDisponibili(dati, oggi);
  const g = giacenzeBirra(dati, oggi);
  const venduti = listini.filter(l => !l.eliminato).sort((a, b) => (a.id === ID_ALPHA ? -1 : b.id === ID_ALPHA ? 1 : a.nome.localeCompare(b.nome, 'it')));
  const nomiClienti = [...new Set([...clienti.map(c => c.nome), ...dati.movimenti.map(m => m.cliente)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const cartone = pezziCartone();
  let c = leggiCarrello();
  if (!c.listino && venduti.some(l => l.id === ID_ALPHA)) c.listino = ID_ALPHA;

  const disegna = () => {
    const { prezzi, iva } = prezziListino(listini, c.listino);
    const q = filtro.q.trim().toLowerCase();
    const lista = disponibili.filter(b => !q || b.birra.toLowerCase().includes(q));
    const nel = new Map(c.righe.map(r => [r.prodotto, Number(r.pezzi) || 0]));
    const totPz = c.righe.reduce((t, r) => t + (Number(r.pezzi) || 0), 0);
    const litri = c.righe.reduce((t, r) => t + (Number(r.pezzi) || 0) * (g.get(r.prodotto)?.litri || 0), 0);
    const conPrezzo = c.righe.map(r => prezzoRiga(r, prezzi));
    const totale = c.righe.reduce((t, r, i) => t + (conPrezzo[i] || 0) * (Number(r.pezzi) || 0), 0);
    const senzaPrezzo = c.righe.filter((r, i) => conPrezzo[i] === null).length;
    const unita = k => (g.get(k)?.tipo === 'fusto' ? 'fusti' : 'pz');
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span>
        ${c.righe.length ? html`<button id="cr-svuota">Svuota</button>` : ''}</div>
      <h1>🧺 Carrello</h1>
      ${fatto ? html`<div class="scheda cr-fatto"><b>✓ ${fatto.numero} creata in Fatture in Cloud per ${fatto.cliente}.</b>
        <p class="totale">Il magazzino è già scaricato. Completala e inviala da Fatture in Cloud (pagamento, fattura elettronica).</p>
        <div class="barra" style="margin:0"><a class="btn primario" target="_blank" rel="noopener" href="https://secure.fattureincloud.it/invoices">Apri Fatture in Cloud</a>
          ${fatto.url ? html`<a class="btn" target="_blank" rel="noopener" href="${fatto.url}">PDF</a>` : ''}<button id="cr-ok">Fatto</button></div></div>` : ''}
      ${c.ordine ? html`<div class="avviso-riga">📋 Stai preparando l'ordine di <b>${c.cliente}</b>: dopo la fattura o lo scarico l'ordine si segna da solo. <button class="piccolo" id="cr-stacca">Stacca dall'ordine</button></div>` : ''}
      <p class="totale">Trascina le birre nel carrello (sul telefono toccale). Un fusto alla volta, le lattine a cartoni da ${cartone}: i pezzi si correggono nel carrello.</p>
      <div class="cr-layout">
        <section class="cr-dispo">
          <input id="cr-q" type="search" placeholder="Cerca birra…" value="${filtro.q}">
          ${lista.length ? lista.map(b => html`<div class="cr-birra"><h3>${b.birra}${b.stile ? html` <span class="totale">${maiuscole(b.stile)}</span>` : ''}</h3>
            <div class="cr-chips">${b.formati.map(f => {
              const resta = f.pezzi - (nel.get(f.chiave) || 0);
              return html`<button class="cr-art ${resta <= 0 ? 'finito' : ''}" draggable="true" data-k="${f.chiave}" title="Trascina nel carrello o tocca per aggiungere">
                <span aria-hidden="true">${ICONA[f.tipo] || '🍺'}</span><span>${nomeFormato(f.tipo, f.litri)}</span><small>${u.numIT(resta, 0)} ${f.tipo === 'fusto' ? 'fusti' : 'pz'}</small>
                ${prezzi.get(f.chiave) ? html`<small>${euro(prezzi.get(f.chiave))}</small>` : ''}<b aria-hidden="true">+</b></button>`;
            })}</div></div>`) : html`<p class="vuoto">${q ? 'Nessuna birra con questo nome.' : 'Nessuna birra disponibile in magazzino.'}</p>`}
        </section>
        <section class="cr-cesto ${c.righe.length ? '' : 'vuoto-cesto'}" id="cr-cesto" aria-label="Carrello">
          <div class="cr-cesto-testa">
            <label>Cliente <input id="cr-cliente" list="cr-dl-cli" value="${c.cliente}" placeholder="Per la fattura"></label>
            <label>Prezzi <select id="cr-listino"><option value="">Senza prezzi</option>${venduti.map(l => html`<option value="${l.id}" ${l.id === c.listino ? 'selected' : ''}>${l.nome}</option>`)}</select></label>
          </div>
          <datalist id="cr-dl-cli">${nomiClienti.map(n => html`<option value="${n}">`)}</datalist>
          ${!c.righe.length ? html`<div class="cr-drop-qui">Trascina qui le birre</div>`
          : html`<ul class="cr-righe">${c.righe.map((r, i) => {
            const gg = g.get(r.prodotto);
            const lotti = (gg?.lotti || []).filter(l => l.lotto && (!l.scadenza || l.scadenza >= oggi));
            const p = conPrezzo[i];
            const troppi = (Number(r.pezzi) || 0) > (gg?.giacenza || 0);
            return html`<li class="cr-riga">
              <div class="cr-riga-nome"><b>${nomeProdotto(r.prodotto)}</b><button class="piccolo cr-x" data-del="${i}" title="Togli dal carrello" aria-label="Togli dal carrello">✕</button></div>
              <div class="cr-riga-campi">
                <span class="cr-stepper"><button class="piccolo" data-piu="${i}" data-d="-1" aria-label="Meno">−</button>
                  <input type="number" min="0" step="1" inputmode="numeric" data-r="${i}.pezzi" value="${r.pezzi ?? ''}" aria-label="Pezzi">
                  <button class="piccolo" data-piu="${i}" data-d="1" aria-label="Più">+</button><small>${unita(r.prodotto)}</small></span>
                <select data-r="${i}.lotto" aria-label="Lotto"><option value="">Lotto: il primo che scade</option>
                  ${lotti.map(l => html`<option value="${l.lotto}" ${l.lotto === r.lotto ? 'selected' : ''}>Lotto ${l.lotto} · ${l.pezzi} pz${l.scadenza ? ` · scad. ${u.dataIT(l.scadenza)}` : ''}</option>`)}</select>
                <label class="cr-prezzo">€/pz <input type="number" min="0" step="0.01" inputmode="decimal" data-r="${i}.prezzo" value="${r.prezzo ?? ''}" placeholder="${prezzi.get(r.prodotto) ?? '—'}"></label>
              </div>
              <small class="totale">${troppi ? html`<span class="cr-avviso">⚠ in magazzino ${u.numIT(gg?.giacenza || 0, 0)}</span> · ` : ''}${p !== null ? `${euro(p * (Number(r.pezzi) || 0))}` : 'senza prezzo'}</small>
            </li>`;
          })}</ul>
          <div class="cr-totali"><span>${u.numIT(totPz, 0)} pezzi · ${u.numIT(litri, 0)} L</span><b>${totale ? euro(totale) : ''}</b></div>
          ${totale ? html`<p class="totale" style="margin:0 0 8px">${iva ? 'IVA inclusa' : '+ IVA'}${senzaPrezzo ? ` · ${senzaPrezzo} ${senzaPrezzo === 1 ? 'riga' : 'righe'} senza prezzo` : ''}</p>` : ''}
          <div class="cr-azioni solo-editori">
            <button class="primario" id="cr-fic">🧾 Fattura in Fatture in Cloud</button>
            <button id="cr-ordine" title="Per gli ordini presi al telefono o su WhatsApp: la fattura o lo scarico li fai quando lo consegni">📋 ${c.ordine ? 'Aggiorna l\'ordine' : 'Salva come ordine'}</button>
            <span class="totale">oppure scarico di magazzino:</span>
            <div class="cr-motivi">${Object.entries(MOTIVI_SCARICO).map(([k, v]) => html`<button data-motivo="${k}">${v}</button>`)}</div>
          </div>`}
        </section>
      </div>`;
  };
  disegna();
  const salva = () => scriviCarrello(c);
  const ridisegna = () => { salva(); disegna(); };

  u.$app.ondragstart = e => { if (trascinabile(e)) u.$app.querySelector('#cr-cesto')?.classList.add('pronto'); };
  u.$app.ondragend = () => u.$app.querySelector('#cr-cesto')?.classList.remove('pronto', 'sopra');
  u.$app.ondragover = e => {
    const cesto = e.target.closest?.('#cr-cesto');
    if (!cesto || !e.dataTransfer?.types.includes(TIPO_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    cesto.classList.add('sopra');
  };
  u.$app.ondragleave = e => { if (e.target.id === 'cr-cesto') e.target.classList.remove('sopra'); };
  u.$app.ondrop = e => {
    const k = e.dataTransfer?.getData(TIPO_DRAG);
    if (!k || !e.target.closest?.('#cr-cesto')) return;
    e.preventDefault();
    c = mettiNelCarrello(k);
    disegna();
  };
  u.$app.oninput = e => {
    const t = e.target;
    if (t.id === 'cr-q') { filtro.q = t.value; disegna(); const el = u.$app.querySelector('#cr-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); return; }
    if (t.id === 'cr-cliente') { c.cliente = t.value; salva(); return; }
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      c.righe[i][k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      salva();
    }
  };
  u.$app.onchange = e => {
    const t = e.target;
    if (t.id === 'cr-listino') { c.listino = t.value; ridisegna(); }
    else if (t.id === 'cr-cliente') {
      // cliente con un listino nel suo link ordini: si propongono quei prezzi
      const scheda = clienti.find(x => x.id === idCliente(t.value));
      if (scheda?.portale?.listino && venduti.some(l => l.id === scheda.portale.listino)) { c.listino = scheda.portale.listino; ridisegna(); }
    } else if (t.dataset.r) ridisegna();
  };
  u.$app.onclick = async e => {
    const art = e.target.closest('.cr-art');
    if (art) {
      // sul telefono il carrello sta sopra e cresce: la birra toccata resta sotto il dito
      const k = art.dataset.k, prima = art.getBoundingClientRect().top;
      c = mettiNelCarrello(k);
      disegna();
      const dopo = [...u.$app.querySelectorAll('.cr-art')].find(x => x.dataset.k === k);
      if (dopo) window.scrollBy(0, dopo.getBoundingClientRect().top - prima);
      u.toast(`${nomeProdotto(k)} nel carrello`);
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del !== undefined) { c.righe.splice(Number(b.dataset.del), 1); ridisegna(); }
    else if (b.dataset.piu !== undefined) {
      const r = c.righe[Number(b.dataset.piu)];
      r.pezzi = Math.max(0, (Number(r.pezzi) || 0) + Number(b.dataset.d) * passo(r.prodotto, cartone));
      ridisegna();
    } else if (b.id === 'cr-svuota') {
      if (await u.chiedi('Svuotare il carrello?', 'Svuota')) { svuotaCarrello(); c = leggiCarrello(); disegna(); }
    } else if (b.id === 'cr-ok') { fatto = null; disegna(); }
    else if (b.id === 'cr-stacca') { c.ordine = ''; ridisegna(); }
    else if (b.id === 'cr-ordine') {
      if (!c.cliente.trim()) { u.toast('Scrivi il cliente'); u.$app.querySelector('#cr-cliente')?.focus(); return; }
      if (!righeMovimento(c).length) return u.toast('Il carrello non ha pezzi');
      const { prezzi, iva } = prezziListino(listini, c.listino);
      const da = c;
      svuotaCarrello();
      await salvaDaCarrello(da, prezzi, iva);
    }
    else if (b.dataset.motivo) {
      const righe = righeMovimento(c);
      if (!righe.length) return u.toast('Il carrello non ha pezzi');
      const ordine = c.ordine;
      apriScarico({ motivo: b.dataset.motivo, cliente: c.cliente, righe, dopo: async mov => { if (ordine) await collegaDocumento(ordine, { movimento: mov.id, righe: mov.righe }); svuotaCarrello(); } });
    } else if (b.id === 'cr-fic') await dialogFattura();
  };

  async function dialogFattura() {
    const righeMov = righeMovimento(c);
    if (!righeMov.length) return u.toast('Il carrello non ha pezzi');
    const { prezzi, iva } = prezziListino(listini, c.listino);
    const righe = righeFattura({ righe: c.righe.filter(r => Number(r.pezzi) > 0) }, dati.prodotti, prezzi);
    const d = document.createElement('dialog');
    d.innerHTML = html`<form method="dialog">
      <h2 style="margin-top:0">Fattura in Fatture in Cloud</h2>
      <label>Cliente <input id="fc-cliente" list="fc-dl" value="${c.cliente}" placeholder="Carico i clienti di Fatture in Cloud…" required></label>
      <datalist id="fc-dl"></datalist>
      <p class="totale" id="fc-stato"></p>
      <label>Data <input type="date" id="fc-data" value="${u.oggiISO()}"></label>
      <ul class="or-elenco">${righe.map(r => html`<li>${u.numIT(r.qta, 0)} × ${r.nome}${r.codice ? html` <span class="totale">(${r.codice})</span>` : ''}${r.descrizione ? html` · ${r.descrizione}` : ''} <span class="totale">${r.prezzo !== null ? euro(r.prezzo) : 'prezzo da scrivere in FIC'}</span></li>`)}</ul>
      <p class="totale">Prezzi ${iva ? 'IVA inclusa' : 'IVA esclusa'}, aliquota 22%. La fattura si crea in Fatture in Cloud e la completi lì (pagamento, invio). Lo scarico dal magazzino si fa subito, con i lotti scelti, e l'import notturno non lo ripete.</p>
      <div class="barra"><span class="spazio"></span><button value="no" formnovalidate>Annulla</button><button class="primario" id="fc-crea" value="si">Crea la fattura</button></div>
    </form>`.s;
    document.body.appendChild(d);
    d.showModal();
    let elenco = [];
    const $stato = d.querySelector('#fc-stato');
    fic('GET', null, '?elenco=clienti').then(r => {
      elenco = r.clienti || [];
      d.querySelector('#fc-dl').innerHTML = html`${elenco.map(x => html`<option value="${x.nome}">${x.piva}</option>`)}`.s;
      d.querySelector('#fc-cliente').placeholder = 'Scegli o scrivi il cliente';
      segnala();
    }).catch(ex => { $stato.textContent = `Clienti di Fatture in Cloud non letti: ${ex.message}`; });
    const trova = nome => elenco.find(x => x.nome.trim().toLowerCase() === nome.trim().toLowerCase());
    const segnala = () => {
      const nome = d.querySelector('#fc-cliente').value.trim();
      if (!elenco.length || !nome) return;
      $stato.textContent = trova(nome) ? '✓ Cliente presente in Fatture in Cloud' : 'Cliente non presente in anagrafica: la fattura avrà solo il nome, completa i dati in Fatture in Cloud.';
    };
    d.querySelector('#fc-cliente').addEventListener('input', segnala);
    d.querySelector('#fc-crea').addEventListener('click', async ev => {
      ev.preventDefault();
      const nome = d.querySelector('#fc-cliente').value.trim();
      const data = d.querySelector('#fc-data').value;
      if (!nome || !data) { $stato.textContent = 'Servono cliente e data'; return; }
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Creo…';
      try {
        const cl = trova(nome);
        const r = await fic('POST', { azione: 'fattura', data, cliente: { id: cl?.id || null, nome: cl?.nome || nome }, lordo: iva, righe });
        const mov = await u.db.salva({
          tipo: 'movbirra', id: u.db.nuovoId('movbirra'), verso: 'scarico', data, motivo: 'vendita', cliente: cl?.nome || nome, documento: r.numero,
          note: 'dal carrello', origine: 'fic', rifEsterno: `fic:${r.id}`, righe: righeMov,
        });
        if (c.ordine) await collegaDocumento(c.ordine, { documento: r.numero, movimento: mov.id, righe: righeMov });
        fatto = { ...r, cliente: cl?.nome || nome };
        svuotaCarrello();
        c = leggiCarrello();
        d.close();
        u.toast(`${r.numero} creata`);
        disegna();
      } catch (ex) {
        $stato.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Crea la fattura';
      }
    });
    d.addEventListener('close', () => d.remove());
  }
}
