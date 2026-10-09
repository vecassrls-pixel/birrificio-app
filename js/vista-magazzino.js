// Pagine "Materie prime": giacenze, scheda articolo, bolla di carico, inventario.
// Riceve da app.js gli strumenti condivisi (html, db, toast…) per non duplicarli.

import {
  CATEGORIE, UNITA, GIORNI_IN_SCADENZA, giacenze, daCollegare, articoliDaRicette, categoriaDa, chiaveNome, statoScadenza, unitaDa, registroS6, MOTIVI_SCARICO, MOTIVI_CARICO, unisciArticoli,
} from './magazzino.js';
import { estraiTesto, leggiDdt, proponiRighe } from './bolla-pdf.js';

let u; // { $app, html, raw, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni }
export function init(strumenti) { u = strumenti; }

const filtri = { q: '', categoria: '' };

async function datiMagazzino() {
  const [articoli, bolle, inventari, scarichi] = await Promise.all(['articolo', 'bolla', 'inventario', 'scarico'].map(t => u.db.tutti(t)));
  articoli.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return { articoli, bolle, inventari, scarichi, cotte: u.stato.cotte };
}
// data di scadenza colorata: rossa se passata, arancione entro GIORNI_IN_SCADENZA giorni
function scad(data) {
  if (!data) return '—';
  const st = statoScadenza(data, u.oggiISO());
  return u.html`<span class="scad ${st || ''}" title="${st === 'scaduto' ? 'Scaduto' : st === 'vicino' ? `Scade entro ${GIORNI_IN_SCADENZA} giorni` : ''}">${u.dataIT(data)}</span>`;
}
// lotti da cui è uscito uno scarico (solo quelli con un nome)
const lottiUsati = m => ((m.lotti || []).some(l => l.lotto) ? ` · lotto ${m.lotti.map(l => l.lotto || '—').join(' + ')}` : '');
const fmt = (n, unita) => `${u.numIT(n, unita === 'kg' || unita === 'L' ? 1 : 0)} ${unita}`;
// da quando cercare ingredienti non collegati: primo inventario, altrimenti 3 mesi fa
const inizioControllo = inventari => [...inventari].map(i => i.data).filter(Boolean).sort()[0] || u.addGiorni(u.oggiISO(), -90);

// ---------- elenco giacenze ----------
export async function vistaMagazzino() {
  const { html, raw } = u;
  const dati = await datiMagazzino();
  const g = giacenze(dati);
  const q = chiaveNome(filtri.q);
  const nascondiZero = leggiPref();
  const righe = [...g.values()].filter(x => (!filtri.categoria || x.articolo.categoria === filtri.categoria)
    && (!q || chiaveNome(x.articolo.nome).includes(q) || (x.articolo.alias || []).some(a => chiaveNome(a).includes(q)))
    && !(nascondiZero && aZero(x.giacenza) && aZero(x.impegnato)));
  const sotto = [...g.values()].filter(x => x.sottoScorta || x.disponibile < 0);
  const scadenze = [...g.values()].filter(x => x.statoScadenza);
  const scollegati = daCollegare(dati.cotte, dati.articoli, inizioControllo(dati.inventari)).slice(0, 40);
  const bolle = [...dati.bolle].sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 8);

  u.$app.innerHTML = html`
    <div class="barra">
      <div><h1 style="margin:0">Materie prime</h1><div class="kpi">
        <div><b>${dati.articoli.length}</b>articoli</div>
        <div><b>${sotto.length}</b>sotto scorta</div>
        <div><b>${scadenze.length}</b>scaduti o in scadenza</div>
        <div><b>${dati.bolle.length}</b>bolle</div>
      </div></div>
      <span class="spazio"></span>
      <a class="btn" href="#/registro-s6">Registro S6</a>
      <a class="btn" href="#/inventario">Inventario</a>
      <button id="nuovo-art">+ Articolo</button>
      <a class="btn" href="#/scarico/carico">+ Carico manuale</a>
      <a class="btn" href="#/scarico/nuovo">− Scarico manuale</a>
      <a class="btn primario" href="#/bolla/nuova">+ Bolla di carico</a>
    </div>
    ${!dati.articoli.length ? html`<div class="scheda"><h2>Per iniziare</h2>
      <p>Crea gli articoli partendo dagli ingredienti delle cotte degli ultimi 12 mesi, poi fai l'inventario iniziale con le quantità che hai in magazzino. Le cotte già fatte prima della creazione dell'articolo o dell'inventario non vengono scaricate.</p>
      <button class="primario" id="da-ricette">Crea articoli dalle ricette</button></div>` : ''}
    ${dati.articoli.length ? html`<div class="barra">
      <input id="q" type="search" placeholder="Cerca articolo…" value="${filtri.q}" style="flex:2;min-width:180px">
      <select id="cat" style="flex:1;min-width:140px"><option value="">Tutte le categorie</option>
        ${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === filtri.categoria ? 'selected' : ''}>${v}</option>`)}</select>
      <label class="spunta"><input type="checkbox" id="nascondi-zero" ${nascondiZero ? 'checked' : ''}> Nascondi le materie prime a 0</label>
    </div>` : ''}
    ${Object.entries(CATEGORIE).map(([cat, titolo]) => {
      const rr = righe.filter(x => x.articolo.categoria === cat);
      if (!rr.length) return '';
      return html`<div class="scheda"><h2>${titolo}</h2><div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Articolo</th><th class="n">Giacenza</th><th class="n" title="Serve alle cotte pianificate e ai DH ancora da fare">Impegnato</th><th class="n">Disponibile</th><th class="n">Scorta min.</th><th>Scadenza</th><th>Inventario</th></tr></thead>
        <tbody>${rr.map(x => html`<tr class="${x.disponibile < 0 ? 'neg' : x.sottoScorta ? 'basso' : ''}">
          <td><a href="#/materia/${encodeURIComponent(x.articolo.id)}">${x.articolo.nome}</a>${x.nonConvertibili ? html` <span class="totale" title="Alcune righe hanno un'unità non convertibile">⚠</span>` : ''}</td>
          <td class="n">${fmt(x.giacenza, x.articolo.unita)}</td>
          <td class="n">${x.impegnato ? fmt(x.impegnato, x.articolo.unita) : '—'}</td>
          <td class="n"><b>${fmt(x.disponibile, x.articolo.unita)}</b></td>
          <td class="n">${x.articolo.scortaMin ? fmt(x.articolo.scortaMin, x.articolo.unita) : '—'}</td>
          <td>${scad(x.scadenza)}</td>
          <td class="totale" style="margin:0">${x.inventario ? u.dataIT(x.inventario.data) : 'mai'}</td>
        </tr>`)}</tbody></table></div></div>`;
    })}
    ${dati.articoli.length && !righe.length ? html`<p class="vuoto">Nessun articolo trovato.</p>` : ''}
    ${scollegati.length && dati.articoli.length ? html`<div class="scheda"><h2>Ingredienti delle cotte non collegati</h2>
      <p class="totale">Questi nomi dalle schede cotta non corrispondono a nessun articolo, quindi non vengono scaricati. Collegali a un articolo (diventano un suo alias) oppure crea l'articolo.</p>
      <div class="scroll-x"><table class="tab-edit"><thead><tr><th>Nome nella scheda</th><th class="n">Volte</th><th>Collega a</th><th></th></tr></thead>
      <tbody>${scollegati.map((s, i) => html`<tr>
        <td>${s.nome}</td><td class="n">${s.volte}</td>
        <td><select data-collega="${i}"><option value="">—</option>${dati.articoli.map(a => html`<option value="${a.id}">${a.nome}</option>`)}</select></td>
        <td class="az"><button class="piccolo" data-crea="${i}">Crea articolo</button></td>
      </tr>`)}</tbody></table></div></div>` : ''}
    <div class="scheda"><h2>Ultime bolle di carico</h2>
      ${bolle.length ? html`<div class="lista">${bolle.map(b => html`<a class="riga-cotta" href="#/bolla/${encodeURIComponent(b.id)}">
        <span class="lotto">${u.dataIT(b.data)}</span><span class="birra">${b.fornitore || 'Fornitore ?'}${b.numero ? ` · n° ${b.numero}` : ''}</span>
        <span class="totale" style="margin:0">${(b.righe || []).length} righe</span></a>`)}</div>` : html`<p class="totale">Nessuna bolla caricata.</p>`}
    </div>
    ${dati.scarichi.length ? html`<div class="scheda"><h2>Ultimi carichi e scarichi manuali</h2><div class="lista">
      ${[...dati.scarichi].sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 8).map(x => html`<a class="riga-cotta" href="#/scarico/${encodeURIComponent(x.id)}">
        <span class="lotto">${u.dataIT(x.data)}</span><span class="birra">${x.verso === 'carico' ? `+ ${MOTIVI_CARICO[x.motivo] || 'Carico'}` : `− ${MOTIVI_SCARICO[x.motivo] || 'Scarico'}`}${x.destinatario ? ` · ${x.destinatario}` : ''}</span>
        <span class="totale" style="margin:0">${(x.righe || []).length} righe</span></a>`)}</div></div>` : ''}
  `;
  const $ = s => document.getElementById(s);
  $('q')?.addEventListener('input', e => { filtri.q = e.target.value; vistaMagazzino().then(() => { const el = $('q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); });
  $('cat')?.addEventListener('change', e => { filtri.categoria = e.target.value; vistaMagazzino(); });
  $('nascondi-zero')?.addEventListener('change', e => { scriviPref(e.target.checked); vistaMagazzino(); });
  $('nuovo-art').onclick = () => dialogArticolo({});
  $('da-ricette')?.addEventListener('click', async () => {
    const proposti = articoliDaRicette(dati.cotte, dati.articoli, u.addGiorni(u.oggiISO(), -365));
    if (!proposti.length) return u.toast('Nessun ingrediente trovato nelle cotte recenti');
    if (!(await u.chiedi(`Creo ${proposti.length} articoli dagli ingredienti delle cotte dell'ultimo anno? Potrai rinominarli, unirli con gli alias o eliminarli.`, 'Crea'))) return;
    await u.db.salvaMolti(proposti.map(({ volte: _v, ...a }) => ({ ...a, tipo: 'articolo', id: u.db.nuovoId('articolo'), creato: u.oggiISO() })));
    u.toast(`${proposti.length} articoli creati`);
    location.hash = '#/inventario';
  });
  u.$app.onchange = async e => {
    const i = e.target.dataset.collega;
    if (i === undefined || !e.target.value) return;
    const a = dati.articoli.find(x => x.id === e.target.value);
    await u.db.salva({ ...a, alias: [...new Set([...(a.alias || []), scollegati[i].nome])] });
    u.toast(`"${scollegati[i].nome}" collegato a ${a.nome}`);
  };
  u.$app.onclick = e => {
    const i = e.target.dataset.crea;
    if (i === undefined) return;
    const s = scollegati[i];
    dialogArticolo({ nome: s.chiave.replace(/\b\w/g, l => l.toUpperCase()), categoria: categoriaDa(s.sezione, s.nome), unita: unitaDa(s.sezione), alias: [s.nome] });
  };
}

// ---------- dialogo nuovo articolo ----------
// vai = false: resta dove si è (es. scheda cotta) e restituisce l'articolo creato
function dialogArticolo(pre, vai = true) {
  const { html } = u;
  const d = document.createElement('dialog');
  d.innerHTML = html`<form method="dialog" id="f-art">
    <h2 style="margin-top:0">Nuovo articolo</h2>
    <div class="griglia">
      <label style="grid-column:1/-1">Nome <input name="nome" required value="${pre.nome || ''}"></label>
      <label>Categoria <select name="categoria">${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === (pre.categoria || 'malto') ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label>Unità <select name="unita">${UNITA.map(x => html`<option ${x === (pre.unita || 'kg') ? 'selected' : ''}>${x}</option>`)}</select></label>
      <label>Scorta minima <input name="scortaMin" type="number" step="any" inputmode="decimal"></label>
    </div>
    <div class="barra" style="margin-top:14px"><span class="spazio"></span>
      <button value="no" formnovalidate>Annulla</button><button class="primario" value="ok">Crea</button></div>
  </form>`.s;
  document.body.appendChild(d);
  const fatto = new Promise(ok => d.addEventListener('close', async () => {
    d.remove();
    if (d.returnValue !== 'ok') return ok(null);
    const fd = new FormData(d.querySelector('form'));
    const nome = String(fd.get('nome') || '').trim();
    if (!nome) return ok(null);
    const rec = await u.db.salva({
      tipo: 'articolo', id: u.db.nuovoId('articolo'), nome, categoria: fd.get('categoria'), unita: fd.get('unita'),
      scortaMin: Number(fd.get('scortaMin')) || 0, alias: pre.alias || [], creato: u.oggiISO(),
    });
    if (vai) location.hash = `#/materia/${encodeURIComponent(rec.id)}`;
    ok(rec);
  }));
  d.showModal();
  return fatto;
}
export const nuovoArticolo = pre => dialogArticolo(pre, false);

// articoli del magazzino per scegliere gli ingredienti di una ricetta, anche quelli a zero
export async function articoliRicetta() {
  const d = await datiMagazzino();
  const g = giacenze(d, u.oggiISO());
  return d.articoli.map(a => ({ ...a, giacenza: g.get(a.id)?.giacenza ?? 0 }));
}

// ---------- scheda articolo ----------
export async function vistaArticolo(id) {
  const { html } = u;
  const dati = await datiMagazzino();
  const a = dati.articoli.find(x => x.id === id);
  if (!a) { u.$app.innerHTML = html`<p class="vuoto">Articolo non trovato. <a href="#/materie-prime">Torna alle materie prime</a></p>`; return; }
  const g = giacenze(dati).get(id);
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span>
      <button class="pericolo" id="elimina">Elimina articolo</button></div>
    <div class="scheda">
      <h1 style="margin-top:0">${a.nome}</h1>
      <div class="kpi">
        <div><b>${fmt(g.giacenza, a.unita)}</b>giacenza oggi</div>
        <div><b>${fmt(g.impegnato, a.unita)}</b>impegnato</div>
        <div><b>${fmt(g.disponibile, a.unita)}</b>disponibile</div>
        <div><b>${g.inventario ? u.dataIT(g.inventario.data) : 'mai'}</b>ultimo inventario</div>
      </div>
    </div>
    <form class="scheda" id="f-art">
      <h2>Dati articolo</h2>
      <div class="griglia">
        <label style="grid-column:span 2">Nome <input name="nome" required value="${a.nome}"></label>
        <label>Categoria <select name="categoria">${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === a.categoria ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label>Unità <select name="unita">${UNITA.map(x => html`<option ${x === a.unita ? 'selected' : ''}>${x}</option>`)}</select></label>
        <label>Scorta minima (${a.unita}) <input name="scortaMin" type="number" step="any" inputmode="decimal" value="${a.scortaMin || ''}"></label>
        <label>1 pezzo / sacco = (${a.unita}) <input name="pesoPezzo" type="number" step="any" inputmode="decimal" value="${a.pesoPezzo || ''}" placeholder="es. 20" title="Per le bolle che riportano solo i pezzi"></label>
        <label style="grid-column:1/-1">Altri nomi nelle schede cotta (separati da virgola)
          <input name="alias" value="${(a.alias || []).join(', ')}" placeholder="es. Pils Schuemma, pils shuema"></label>
      </div>
      <div class="barra" style="margin-top:12px;margin-bottom:0"><span class="spazio"></span><button class="primario">Salva</button></div>
    </form>
    ${dati.articoli.length > 1 ? html`<div class="scheda solo-editori"><h2>Unisci un doppione</h2>
      <p class="totale">Se lo stesso prodotto è stato creato due volte con nomi diversi: scegli il doppione, le sue bolle, inventari e scarichi passano a <b>${a.nome}</b>, il suo nome diventa un alias e il doppione viene eliminato.</p>
      <div class="barra" style="margin:0"><select id="doppione" style="flex:1;min-width:200px"><option value="">Scegli il doppione…</option>
        ${[...dati.articoli].filter(x => x.id !== a.id).sort((x, y) => (y.categoria === a.categoria) - (x.categoria === a.categoria) || x.nome.localeCompare(y.nome, 'it'))
          .map(x => html`<option value="${x.id}">${x.nome} (${CATEGORIE[x.categoria] || ''}, ${x.unita})</option>`)}</select>
        <button id="unisci">Unisci in ${a.nome}</button></div></div>` : ''}
    ${g.lotti.some(l => l.lotto || l.scadenza) ? u.html`<div class="scheda"><h2>Lotti in magazzino</h2>
      <p class="totale">Stima: si assume che le cotte usino prima la merce caricata da più tempo.</p>
      <div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Lotto</th><th>Scadenza</th><th>Caricato</th><th class="n">Quantità</th></tr></thead>
        <tbody>${g.lotti.map(l => u.html`<tr>
          <td>${l.lotto || u.html`<span class="totale">senza lotto</span>`}</td><td>${scad(l.scadenza)}</td>
          <td>${l.data ? u.html`${u.dataIT(l.data)} <span class="totale">${l.rif}</span>` : u.html`<span class="totale">${l.rif}</span>`}</td>
          <td class="n">${fmt(l.qta, a.unita)}</td></tr>`)}</tbody></table></div></div>` : ''}
    <div class="scheda"><h2>Movimenti</h2>
      ${g.movimenti.length ? html`<div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Data</th><th>Movimento</th><th class="n">Quantità</th></tr></thead>
        <tbody>${g.movimenti.slice(0, 200).map(m => html`<tr class="${m.futuro ? 'futuro' : ''}">
          <td>${u.dataIT(m.data)}</td>
          <td>${m.tipo === 'inventario' ? html`<b>Inventario</b>${m.lotto ? ` · lotto ${m.lotto}` : ''}${m.scadenza ? ` · scad. ${u.dataIT(m.scadenza)}` : ''}` : m.tipo === 'carico'
            ? html`<a href="#/${m.manuale ? 'scarico' : 'bolla'}/${encodeURIComponent(m.id)}">${m.rif}</a>${m.lotto ? ` · lotto ${m.lotto}` : ''}${m.scadenza ? ` · scad. ${u.dataIT(m.scadenza)}` : ''}`
            : m.manuale ? html`<a href="#/scarico/${encodeURIComponent(m.id)}">${m.rif}</a>${lottiUsati(m)}`
            : html`<a href="#/cotta/${encodeURIComponent(m.id)}">${m.rif}</a> <span class="totale">${m.nome}${m.futuro ? ' · da fare' : ''}</span>${lottiUsati(m)}`}</td>
          <td class="n">${m.tipo === 'inventario' ? '= ' : m.qta > 0 ? '+' : ''}${fmt(m.qta, a.unita)}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="totale">Nessun movimento: fai l'inventario o carica una bolla.</p>`}
    </div>`;
  document.getElementById('f-art').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await u.db.salva({
      ...a, nome: String(fd.get('nome')).trim(), categoria: fd.get('categoria'), unita: fd.get('unita'),
      scortaMin: Number(fd.get('scortaMin')) || 0, pesoPezzo: Number(fd.get('pesoPezzo')) || null,
      alias: String(fd.get('alias') || '').split(',').map(s => s.trim()).filter(Boolean),
    });
    u.toast('Articolo salvato');
    vistaArticolo(id);
  };
  const $unisci = document.getElementById('unisci');
  if ($unisci) $unisci.onclick = async () => {
    const togli = dati.articoli.find(x => x.id === document.getElementById('doppione').value);
    if (!togli) return u.toast('Scegli prima il doppione');
    if (!(await u.chiedi(`Unire ${togli.nome} in ${a.nome}? ${togli.nome} viene eliminato e tutti i suoi movimenti passano a ${a.nome}.`, 'Unisci'))) return;
    const r = unisciArticoli(a, togli, dati);
    if (r.errore) return u.toast(r.errore);
    await u.db.salvaMolti(r.modificati.map(({ aggiornato: _a, ...x }) => x)); // ora nuova: vince nella sincronizzazione
    await u.db.elimina(togli.id);
    u.toast(`${togli.nome} unito in ${a.nome}`);
    vistaArticolo(id);
  };
  document.getElementById('elimina').onclick = async () => {
    if (!(await u.chiedi(`Eliminare ${a.nome}? I movimenti di bolle e inventari restano ma non verranno più contati.`, 'Elimina'))) return;
    await u.db.elimina(a.id);
    location.hash = '#/materie-prime';
  };
}

// ---------- bolla di carico ----------
export async function vistaBolla(id) {
  const { html } = u;
  const dati = await datiMagazzino();
  const esistente = id === 'nuova' ? null : dati.bolle.find(b => b.id === id);
  if (id !== 'nuova' && !esistente) { u.$app.innerHTML = html`<p class="vuoto">Bolla non trovata. <a href="#/materie-prime">Torna alle materie prime</a></p>`; return; }
  const b = esistente ? JSON.parse(JSON.stringify(esistente))
    : { tipo: 'bolla', data: u.oggiISO(), fornitore: '', numero: '', righe: [{ nome: '', qta: null, unita: '', lotto: '', scadenza: '' }] };
  const perId = new Map(dati.articoli.map(a => [a.id, a]));
  for (const r of b.righe) if (r.articoloId && !r.nome) r.nome = perId.get(r.articoloId)?.nome || '';
  const fornitori = [...new Set(dati.bolle.map(x => x.fornitore).filter(Boolean))].sort();
  let pdfStato = '';
  const daPdf = () => b.righe.some(r => r.descrizione);

  async function leggiPdf(file) {
    pdfStato = 'Leggo il PDF…';
    disegna();
    try {
      const ddt = leggiDdt(await estraiTesto(file));
      if (!ddt.righe.length) throw new Error('Non ho trovato righe articolo: il PDF è una scansione o ha un formato che non conosco. Inserisci le righe a mano.');
      b.data = ddt.data || b.data;
      b.numero = ddt.numero || b.numero;
      b.fornitore = ddt.fornitore || b.fornitore;
      b.righe = proponiRighe(ddt, dati.articoli);
      const n = b.righe.filter(r => r.includi).length;
      pdfStato = `${file.name}: ${n} righe da caricare, ${b.righe.length - n} escluse (spese, imballi…).`;
    } catch (ex) {
      pdfStato = ex.message;
    }
    disegna();
  }

  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span>
        ${esistente ? html`<button class="pericolo" id="elimina">Elimina bolla</button>` : ''}</div>
      <div class="scheda">
        <h1 style="margin-top:0">${esistente ? 'Bolla di carico' : 'Nuova bolla di carico'}</h1>
        ${esistente ? '' : html`<div class="barra">
          <label class="btn primario">📄 Leggi il PDF della bolla<input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
          <span class="totale" id="pdf-stato" style="margin:0">${pdfStato}</span>
        </div>`}
        <div class="griglia">
          <label>Data <input type="date" data-b="data" value="${b.data || ''}"></label>
          <label style="grid-column:span 2">Fornitore <input data-b="fornitore" list="dl-forn" value="${b.fornitore || ''}"></label>
          <label>N° bolla / DDT <input data-b="numero" value="${b.numero || ''}"></label>
        </div>
        <datalist id="dl-forn">${fornitori.map(f => html`<option value="${f}">`)}</datalist>
        <datalist id="dl-art">${dati.articoli.map(a => html`<option value="${a.nome}">`)}</datalist>
      </div>
      <div class="scheda"><h2>Righe</h2>
        ${daPdf() ? html`<p class="totale">Controlla le righe lette dal PDF: togli la spunta a quello che non va in magazzino e correggi il nome se l'articolo esiste già con un altro nome (la descrizione del fornitore viene ricordata per le prossime bolle).</p>` : ''}
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr>${daPdf() ? html`<th title="Carica in magazzino">✓</th>` : ''}<th>Articolo</th><th style="width:130px">Categoria (se nuovo)</th><th style="width:100px">Quantità</th><th style="width:80px">Unità</th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th><th></th></tr></thead>
          <tbody>${b.righe.map((r, i) => {
            const art = dati.articoli.find(a => a.nome.toLowerCase() === String(r.nome || '').trim().toLowerCase());
            return html`<tr class="${r.includi === false ? 'escluso' : ''}">
              ${daPdf() ? html`<td><input type="checkbox" data-r="${i}.includi" ${r.includi === false ? '' : 'checked'} style="width:auto;min-height:auto"></td>` : ''}
              <td><input data-r="${i}.nome" list="dl-art" value="${r.nome || ''}" style="min-width:160px">${r.descrizione ? html`<div class="totale" style="margin:2px 0 0">${r.descrizione}${art || r.includi === false ? '' : ' · articolo nuovo'}</div>` : ''}</td>
              <td>${art ? html`<span class="totale">${CATEGORIE[art.categoria]}</span>` : html`<select data-r="${i}.categoria">${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === (r.categoria || 'malto') ? 'selected' : ''}>${v}</option>`)}</select>`}</td>
              <td><input data-r="${i}.qta" type="number" step="any" inputmode="decimal" value="${r.qta ?? ''}"></td>
              <td><select data-r="${i}.unita">${UNITA.map(x => html`<option ${x === (r.unita || art?.unita || 'kg') ? 'selected' : ''}>${x}</option>`)}</select></td>
              <td><input data-r="${i}.lotto" value="${r.lotto || ''}"></td>
              <td><input data-r="${i}.scadenza" type="date" value="${r.scadenza || ''}"></td>
              <td class="az"><button class="piccolo" data-del="${i}" title="Rimuovi">✕</button></td>
            </tr>`;
          })}</tbody>
        </table></div>
        <div class="barra" style="margin-top:8px"><button class="piccolo" id="riga">+ Riga</button><span class="spazio"></span>
          <button class="primario" id="salva">Salva bolla</button></div>
      </div>`;
  }
  disegna();
  u.$app.oninput = u.$app.onchange = e => {
    const t = e.target;
    if (t.id === 'pdf' && e.type === 'change' && t.files[0]) return leggiPdf(t.files[0]);
    if (t.dataset.b) b[t.dataset.b] = t.value;
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      b.righe[i][k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      if (k === 'includi' && e.type === 'change') disegna();
      // nome scelto: mostra categoria e unità dell'articolo esistente
      if (k === 'nome' && e.type === 'change') {
        const art = dati.articoli.find(a => a.nome.toLowerCase() === t.value.trim().toLowerCase());
        if (art) b.righe[i].unita = art.unita;
        disegna();
      }
    }
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'riga') { b.righe.push({ nome: '', qta: null, unita: '', lotto: '', scadenza: '' }); disegna(); }
    else if (t.dataset.del !== undefined) { b.righe.splice(Number(t.dataset.del), 1); disegna(); }
    else if (t.id === 'elimina') {
      if (!(await u.chiedi('Eliminare questa bolla? Le quantità caricate verranno tolte dalle giacenze.', 'Elimina'))) return;
      await u.db.elimina(esistente.id);
      location.hash = '#/materie-prime';
    } else if (t.id === 'salva') {
      const righe = b.righe.filter(r => r.includi !== false && String(r.nome || '').trim() && Number(r.qta) > 0);
      if (!b.data || !righe.length) return u.toast('Servono la data e almeno una riga con articolo e quantità');
      const doppia = !esistente && b.numero && dati.bolle.find(x => x.numero === b.numero && (x.fornitore || '') === (b.fornitore || ''));
      if (doppia && !(await u.chiedi(`La bolla n° ${b.numero} ${b.fornitore || ''} è già stata caricata il ${u.dataIT(doppia.data)}. Caricarla di nuovo?`, 'Carica lo stesso'))) return;
      const nuovi = [], aggiornati = new Map();
      const out = righe.map(r => {
        const nome = String(r.nome).trim();
        let art = dati.articoli.find(a => a.nome.toLowerCase() === nome.toLowerCase()) || nuovi.find(a => a.nome.toLowerCase() === nome.toLowerCase());
        if (!art) {
          art = { tipo: 'articolo', id: u.db.nuovoId('articolo'), nome, categoria: r.categoria || 'malto', unita: r.unita || 'kg', scortaMin: 0, alias: [], creato: [b.data, u.oggiISO()].sort()[0] };
          nuovi.push(art);
        }
        // la descrizione del fornitore diventa un alias: la prossima bolla trova l'articolo da sola
        if (r.descrizione && !(art.alias || []).includes(r.descrizione)) {
          art.alias = [...(art.alias || []), r.descrizione];
          if (!nuovi.includes(art)) aggiornati.set(art.id, art);
        }
        return { articoloId: art.id, nome: art.nome, qta: Number(r.qta), unita: r.unita || art.unita, lotto: String(r.lotto || '').trim(), scadenza: r.scadenza || '', ...(r.descrizione ? { descrizione: r.descrizione } : {}) };
      });
      if (nuovi.length || aggiornati.size) await u.db.salvaMolti([...nuovi, ...aggiornati.values()].map(({ aggiornato: _a, ...a }) => a));
      await u.db.salva({ ...b, id: b.id || u.db.nuovoId('bolla'), righe: out });
      u.toast(`Bolla salvata${nuovi.length ? ` · ${nuovi.length} articoli nuovi` : ''}`);
      location.hash = '#/materie-prime';
    }
  };
}

// ---------- inventario ----------
// "Nascondi le materie prime a zero": scelta ricordata su questo dispositivo
const NASCONDI_ZERO = 'inventario-nascondi-zero';
const leggiPref = () => { try { return localStorage.getItem(NASCONDI_ZERO) === '1'; } catch { return false; } };
const scriviPref = v => { try { localStorage.setItem(NASCONDI_ZERO, v ? '1' : '0'); } catch { /* niente storage: vale solo ora */ } };
const aZero = x => Math.abs(x) < 1e-9;
export async function vistaInventario() {
  const { html } = u;
  const dati = await datiMagazzino();
  const g = giacenze(dati);
  const data = { v: u.oggiISO() };
  const contati = new Map();
  const nascondi = leggiPref();
  const extre = new Map(); // lotto e scadenza facoltativi per articolo
  const extra = id => { if (!extre.has(id)) extre.set(id, {}); return extre.get(id); };
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span></div>
    <div class="scheda">
      <h1 style="margin-top:0">Inventario</h1>
      <p class="totale">Scrivi la quantità contata solo per gli articoli che hai controllato: da quella data la giacenza riparte da lì, poi si aggiungono le bolle e si tolgono cotte e DH. Gli articoli lasciati vuoti non cambiano.</p>
      <div class="barra" style="margin:0;align-items:flex-end">
        <label style="max-width:200px">Data inventario <input type="date" id="data-inv" value="${data.v}"></label>
        <label class="spunta"><input type="checkbox" id="nascondi-zero" ${nascondi ? 'checked' : ''}> Nascondi le materie prime a 0</label>
      </div>
    </div>
    <div id="elenco-inv" class="${nascondi ? 'senza-zero' : ''}">
    ${!dati.articoli.length ? html`<p class="vuoto">Nessun articolo. <a href="#/materie-prime">Crea prima gli articoli</a>.</p>` : ''}
    ${Object.entries(CATEGORIE).map(([cat, titolo]) => {
      const rr = dati.articoli.filter(a => a.categoria === cat);
      if (!rr.length) return '';
      const tuttiZero = rr.every(a => aZero(g.get(a.id).giacenza));
      return html`<div class="scheda ${tuttiZero ? 'tutti-zero' : ''}"><h2>${titolo}</h2><div class="scroll-x"><table class="tab-edit">
        <thead><tr><th>Articolo</th><th class="n">Calcolato oggi</th><th style="width:130px">Contato</th><th style="width:50px"></th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th></tr></thead>
        <tbody>${rr.map(a => html`<tr class="${aZero(g.get(a.id).giacenza) ? 'zero' : ''}">
          <td>${a.nome}</td><td class="n">${fmt(g.get(a.id).giacenza, a.unita)}</td>
          <td><input data-inv="${a.id}" type="number" step="any" inputmode="decimal"></td><td class="totale">${a.unita}</td>
          <td><input data-lotto="${a.id}"></td><td><input data-scad="${a.id}" type="date"></td>
        </tr>`)}</tbody></table></div></div>`;
    })}
    </div>
    ${dati.articoli.length ? html`<div class="barra"><span class="spazio"></span><button class="primario" id="salva-inv">Salva inventario</button></div>` : ''}`;
  u.$app.oninput = e => {
    if (e.target.id === 'nascondi-zero') {
      scriviPref(e.target.checked);
      document.getElementById('elenco-inv').classList.toggle('senza-zero', e.target.checked);
      return;
    }
    if (e.target.id === 'data-inv') data.v = e.target.value;
    const id = e.target.dataset.inv;
    if (id) { if (e.target.value === '') contati.delete(id); else contati.set(id, Number(e.target.value)); }
    if (e.target.dataset.lotto) extra(e.target.dataset.lotto).lotto = e.target.value.trim();
    if (e.target.dataset.scad) extra(e.target.dataset.scad).scadenza = e.target.value;
  };
  u.$app.onchange = u.$app.oninput;
  u.$app.onclick = async e => {
    if (e.target.id !== 'salva-inv') return;
    if (!contati.size) return u.toast('Nessuna quantità inserita');
    if (!data.v) return u.toast('Manca la data');
    await u.db.salva({ tipo: 'inventario', id: u.db.nuovoId('inventario'), data: data.v, righe: [...contati].map(([articoloId, qta]) => ({ articoloId, qta, lotto: extre.get(articoloId)?.lotto || '', scadenza: extre.get(articoloId)?.scadenza || '' })) });
    u.toast(`Inventario salvato: ${contati.size} articoli`);
    location.hash = '#/materie-prime';
  };
}

// ---------- registro HACCP S6 carico/scarico (da stampare) ----------
const s6 = { da: null, a: null, categoria: '' };
export async function vistaRegistroS6() {
  const { html } = u;
  const anno = u.oggiISO().slice(0, 4);
  s6.da ||= `${anno}-01-01`;
  s6.a ||= u.oggiISO();
  const dati = await datiMagazzino();
  const righe = registroS6(dati, s6.da, s6.a).filter(r => !s6.categoria || r.categoria === s6.categoria);
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/materie-prime" class="btn">← Materie prime</a>
      <label>Dal <input type="date" id="s6-da" value="${s6.da}"></label>
      <label>Al <input type="date" id="s6-a" value="${s6.a}"></label>
      <select id="s6-cat"><option value="">Tutte le categorie</option>
        ${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === s6.categoria ? 'selected' : ''}>${v}</option>`)}</select>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    <div class="s6">
      <div class="s6-testa">
        <img src="img/logo-kashmir.png" alt="Kashmir Brewing Company">
        <div><h1>S6 - CARICO - SCARICO /// VECAS SRLS</h1>
          <div>Periodo: dal ${u.dataIT(s6.da)} al ${u.dataIT(s6.a)}${s6.categoria ? ` · ${CATEGORIE[s6.categoria]}` : ''} · stampato il ${u.dataIT(u.oggiISO())}</div></div>
      </div>
      <p class="s6-legenda">Legenda: C = carico - S = scarico - QTA = quantità - Dest = destinatario - Prov = Provenienza</p>
      ${righe.length ? html`<table class="tab-s6">
        <thead><tr><th>C/S</th><th>Data</th><th>Prodotto</th><th>Lotto</th><th class="n">QTA</th><th>Scadenza</th><th>Dest/Prov</th></tr></thead>
        <tbody>${righe.map(r => html`<tr class="${r.cs === 'C' ? 'c' : ''}">
          <td>${r.cs}</td><td>${u.dataIT(r.data)}</td><td>${r.prodotto}</td><td>${r.lotto}</td>
          <td class="n">${fmt(r.qta, r.unita)}</td><td>${r.scadenza ? u.dataIT(r.scadenza) : ''}</td><td>${r.chi}</td>
        </tr>`)}</tbody></table>` : html`<p class="vuoto">Nessun movimento nel periodo.</p>`}
    </div>`;
  const $ = s => document.getElementById(s);
  $('s6-da').onchange = e => { s6.da = e.target.value; vistaRegistroS6(); };
  $('s6-a').onchange = e => { s6.a = e.target.value; vistaRegistroS6(); };
  $('s6-cat').onchange = e => { s6.categoria = e.target.value; vistaRegistroS6(); };
  $('stampa').onclick = () => {
    const titolo = document.title;
    document.title = `S6 carico scarico ${s6.da} ${s6.a}`;
    addEventListener('afterprint', () => { document.title = titolo; }, { once: true });
    window.print();
  };
}

// ---------- scarico manuale (vendita, reso, scarto) ----------
export async function vistaScarico(id) {
  const { html } = u;
  const dati = await datiMagazzino();
  const nuovo = id === 'nuovo' || id === 'carico';
  const esistente = nuovo ? null : dati.scarichi.find(x => x.id === id);
  if (!nuovo && !esistente) { u.$app.innerHTML = html`<p class="vuoto">Movimento non trovato. <a href="#/materie-prime">Torna alle materie prime</a></p>`; return; }
  // stesso record per carichi e scarichi manuali: verso = 'carico' | 'scarico'
  const sc = esistente ? JSON.parse(JSON.stringify(esistente))
    : { tipo: 'scarico', verso: id === 'carico' ? 'carico' : 'scarico', data: u.oggiISO(), motivo: id === 'carico' ? 'acquisto' : 'vendita', destinatario: '', note: '', righe: [{ articoloId: '', qta: null, unita: '', lotto: '', scadenza: '' }] };
  sc.verso ||= 'scarico';
  const carico = () => sc.verso === 'carico';
  // le giacenze senza questo scarico, per proporre i lotti disponibili
  const g = giacenze({ ...dati, scarichi: dati.scarichi.filter(x => x.id !== sc.id) });
  const perNome = n => dati.articoli.find(a => a.nome.toLowerCase() === String(n || '').trim().toLowerCase());
  for (const r of sc.righe) r.nome ??= dati.articoli.find(a => a.id === r.articoloId)?.nome || '';
  const destinatari = [...new Set(dati.scarichi.map(x => x.destinatario).filter(Boolean))].sort();

  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span>
        ${esistente ? html`<button class="pericolo" id="elimina">Elimina</button>` : ''}</div>
      <div class="scheda">
        <h1 style="margin-top:0">${esistente ? '' : 'Nuovo '}${carico() ? 'carico' : 'scarico'} manuale</h1>
        <div class="barra" style="margin:0 0 8px">
          <label class="spunta"><input type="radio" name="verso" value="carico" ${carico() ? 'checked' : ''}> + Carico (entra)</label>
          <label class="spunta"><input type="radio" name="verso" value="scarico" ${carico() ? '' : 'checked'}> − Scarico (esce)</label>
        </div>
        <p class="totale">${carico()
          ? 'Per la materia prima che entra senza una bolla: reso da un cliente, prestito o scambio con un altro birrificio, campione, rettifica. Lotto e scadenza sono facoltativi.'
          : 'Per la materia prima che esce dal magazzino senza andare in una cotta: vendita, reso al fornitore, scarto. Se non scegli il lotto esce quello caricato da più tempo.'}</p>
        <div class="griglia">
          <label>Data <input type="date" data-s="data" value="${sc.data || ''}"></label>
          <label>Motivo <select data-s="motivo">${Object.entries(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO).map(([k, v]) => html`<option value="${k}" ${k === sc.motivo ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label style="grid-column:span 2">${carico() ? 'Provenienza / fornitore' : 'Destinatario / cliente'} <input data-s="destinatario" list="dl-dest" value="${sc.destinatario || ''}"></label>
          <label style="grid-column:1/-1">Note (n° fattura, DDT…) <input data-s="note" value="${sc.note || ''}"></label>
        </div>
        <datalist id="dl-dest">${destinatari.map(x => html`<option value="${x}">`)}</datalist>
        <datalist id="dl-art">${dati.articoli.map(a => html`<option value="${a.nome}">`)}</datalist>
      </div>
      <div class="scheda"><h2>Righe</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th>Articolo</th><th class="n">${carico() ? 'In magazzino' : 'Disponibile'}</th><th style="width:100px">Quantità</th><th style="width:80px">Unità</th>${carico() ? html`<th style="width:140px">Lotto</th><th style="width:150px">Scadenza</th>` : html`<th style="width:200px">Lotto</th>`}<th></th></tr></thead>
          <tbody>${sc.righe.map((r, i) => {
            const art = perNome(r.nome);
            const gg = art && g.get(art.id);
            return html`<tr>
              <td><input data-r="${i}.nome" list="dl-art" value="${r.nome || ''}" style="min-width:160px"></td>
              <td class="n totale">${gg ? fmt(gg.giacenza, art.unita) : ''}</td>
              <td><input data-r="${i}.qta" type="number" step="any" inputmode="decimal" value="${r.qta ?? ''}"></td>
              <td><select data-r="${i}.unita">${UNITA.map(x => html`<option ${x === (r.unita || art?.unita || 'kg') ? 'selected' : ''}>${x}</option>`)}</select></td>
              ${carico() ? html`<td><input data-r="${i}.lotto" value="${r.lotto || ''}" placeholder="facoltativo"></td>
              <td><input data-r="${i}.scadenza" type="date" value="${r.scadenza || ''}"></td>` : html`<td><select data-r="${i}.lotto"><option value="">Il più vecchio (automatico)</option>
                ${(gg?.lotti || []).filter(l => l.lotto).reverse().map(l => html`<option value="${l.lotto}" ${l.lotto === r.lotto ? 'selected' : ''}>${l.lotto} · ${fmt(l.qta, art.unita)}${l.scadenza ? ` · scad. ${u.dataIT(l.scadenza)}` : ''}</option>`)}
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
      sc.verso = t.value;
      sc.motivo = Object.keys(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO)[0];
      for (const r of sc.righe) { r.lotto = ''; r.scadenza = ''; }
      disegna();
      return;
    }
    if (t.dataset.s) sc[t.dataset.s] = t.value;
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      sc.righe[i][k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      if (k === 'nome' && e.type === 'change') {
        const art = perNome(t.value);
        sc.righe[i].unita = art?.unita || sc.righe[i].unita;
        if (!carico()) sc.righe[i].lotto = '';
        disegna();
      }
    }
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'riga') { sc.righe.push({ nome: '', qta: null, unita: '', lotto: '', scadenza: '' }); disegna(); }
    else if (t.dataset.del !== undefined) { sc.righe.splice(Number(t.dataset.del), 1); disegna(); }
    else if (t.id === 'elimina') {
      if (!(await u.chiedi(carico() ? 'Eliminare questo carico? Le quantità escono dalla giacenza.' : 'Eliminare questo scarico? Le quantità tornano in giacenza.', 'Elimina'))) return;
      await u.db.elimina(esistente.id);
      location.hash = '#/materie-prime';
    } else if (t.id === 'salva') {
      const righe = sc.righe.filter(r => String(r.nome || '').trim() && Number(r.qta) > 0);
      const ignoti = righe.filter(r => !perNome(r.nome));
      if (ignoti.length) return u.toast(`Articolo non trovato: ${ignoti.map(r => r.nome).join(', ')}`);
      if (!sc.data || !righe.length) return u.toast('Servono la data e almeno una riga con articolo e quantità');
      const out = righe.map(r => {
        const art = perNome(r.nome);
        return { articoloId: art.id, nome: art.nome, qta: Number(r.qta), unita: r.unita || art.unita, lotto: (r.lotto || '').trim(), ...(carico() ? { scadenza: r.scadenza || '' } : {}) };
      });
      await u.db.salva({ ...sc, id: sc.id || u.db.nuovoId('scarico'), righe: out });
      u.toast(carico() ? 'Carico salvato' : 'Scarico salvato');
      location.hash = '#/materie-prime';
    }
  };
}
