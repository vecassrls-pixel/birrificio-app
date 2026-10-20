// Pagine "Materie prime": giacenze, scheda articolo, bolla di carico, inventario.
// Riceve da app.js gli strumenti condivisi (html, db, toast…) per non duplicarli.

import { LOGO_KASHMIR } from './logo-kashmir.js';
import { token } from './auth.js';
import { sincronizza } from './sync.js';
import { CONTROLLI_ARRIVO, ID_OPERATORI, operatoriDa, opzioniOperatori } from './haccp.js';
import {
  CATEGORIE, UNITA, GIORNI_IN_SCADENZA, giacenze, daCollegare, articoliDaRicette, categoriaDa, chiaveNome, statoScadenza, unitaDa, registroS6, MOTIVI_SCARICO, MOTIVI_CARICO, unisciArticoli, trovaArticolo, densitaArticolo, DENSITA_ACIDO, cambiaUnita, sogliaGrammi,
} from './magazzino.js';
import { estraiTesto, leggiDdt, proponiRighe, categoriaDaDescrizione, incrociaBolla } from './bolla-pdf.js';
import { trovaContenitore } from './contenitori.js';
import { chiediAi, fotoBase64 } from './ai.js';

let u; // { $app, html, raw, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni }
export function init(strumenti) { u = strumenti; }

const filtri = { q: '', categoria: '' };
// modalità "Unisci doppioni" dell'elenco: id degli articoli spuntati (null = spento)
let scelti = null;

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
  // inventari con numeri da grammi su articoli in kg/L (6300 contati = 6300 kg di luppolo): da correggere ÷1000
  // (e lo stesso per bolle e carichi manuali): da correggere ÷1000 sulla riga d'origine
  const sospetti = [...g.values()].flatMap(x => {
    const soglia = sogliaGrammi(x.articolo);
    return soglia ? x.movimenti.filter(m => !m.futuro && m.tipo !== 'scarico' && m.dove && m.qta >= soglia).map(m => ({ articolo: x.articolo, mov: m })) : [];
  });
  const scollegati = daCollegare(dati.cotte, dati.articoli, inizioControllo(dati.inventari)).slice(0, 40);
  const bolle = [...dati.bolle].sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 8);
  // fatture dei fornitori arrivate con l'import automatico notturno (netlify/lib/automazioni.mjs)
  const acquisti = (await u.db.tutti('importsospeso')).filter(x => x.fonte === 'acquisti' && !x.mpFatte).sort((a, b) => String(b.doc?.data).localeCompare(String(a.doc?.data)));

  u.$app.innerHTML = html`
    <div class="barra">
      <div><h1 style="margin:0">Materie prime</h1><div class="kpi">
        <div><b>${dati.articoli.length}</b>articoli</div>
        <div><b>${sotto.length}</b>sotto scorta</div>
        <div><b>${scadenze.length}</b>scaduti o in scadenza</div>
        <div><b>${dati.bolle.length}</b>bolle</div>
      </div></div>
      <span class="spazio"></span>
      <a class="btn" href="#/ordine" title="Cosa ordinare per le cotte pianificate">🛒 Da ordinare</a>
      <a class="btn" href="#/inventario">Inventario</a>
      <button id="nuovo-art">+ Articolo</button>
      <a class="btn" href="#/scarico/carico">+ Carico manuale</a>
      <a class="btn" href="#/scarico/nuovo">− Scarico manuale</a>
      <a class="btn primario" href="#/bolla/nuova">+ Bolla di carico</a>
      <button class="solo-editori" id="importa-fic" title="Scarica adesso le fatture dei fornitori (e le vendite) da Fatture in Cloud, senza aspettare l'import della notte">⟳ Importa da Fatture in Cloud</button>
    </div>
    ${sospetti.length ? html`<div class="scheda avviso solo-editori" id="sospetti"><h2>⚠ Quantità da controllare</h2>
      <p class="totale">In queste righe il numero sembra in grammi ma l'articolo è in kg (o in ml con l'articolo in L). Se è così tocca "÷ 1000": cambia solo quella riga (di inventario, bolla o carico).</p>
      <div class="scroll-x"><table class="tab-mag"><tbody>${sospetti.map((x, i) => html`<tr>
        <td><a href="#/materia/${encodeURIComponent(x.articolo.id)}">${x.articolo.nome}</a></td>
        <td>${x.mov.tipo === 'inventario' ? 'inventario' : x.mov.rif} del ${u.dataIT(x.mov.data)}</td>
        <td class="n">${fmt(x.mov.qta, x.articolo.unita)}</td>
        <td class="az"><button class="piccolo" data-diviso="${i}">÷ 1000 → ${fmt(x.mov.qta / 1000, x.articolo.unita)}</button></td></tr>`)}</tbody></table></div></div>` : ''}
    ${acquisti.length ? html`<div class="scheda solo-editori" id="acquisti"><h2>📥 Acquisti da Fatture in Cloud <span class="totale">${acquisti.length} da controllare</span></h2>
      <p class="totale">Fatture dei fornitori importate di notte. "Carica" apre la bolla già compilata con righe e prezzi: controlli e salvi. "Scarta" per spese, servizi e tutto quello che non è materia prima.</p>
      <ul class="w-lista">${acquisti.map(x => html`<li class="acq-riga"><span class="w-testo"><b>${x.doc.fornitore || 'Fornitore'}</b> · ${x.doc.numero || ''} · ${u.dataIT(x.doc.data)}<small>${x.doc.righe.slice(0, 4).map(r => r.descrizione).join(' · ')}${x.doc.righe.length > 4 ? ` e altre ${x.doc.righe.length - 4}` : ''}</small></span>
        <span class="barra" style="margin:0"><button class="piccolo primario" data-acq="${x.id}">Carica</button><button class="piccolo" data-acq-via="${x.id}">Scarta</button></span></li>`)}</ul>
    </div>` : ''}
    ${!dati.articoli.length ? html`<div class="scheda"><h2>Per iniziare</h2>
      <p>Crea gli articoli partendo dagli ingredienti delle cotte degli ultimi 12 mesi, poi fai l'inventario iniziale con le quantità che hai in magazzino. Le cotte già fatte prima della creazione dell'articolo o dell'inventario non vengono scaricate.</p>
      <button class="primario" id="da-ricette">Crea articoli dalle ricette</button></div>` : ''}
    ${dati.articoli.length ? html`<div class="barra">
      <input id="q" type="search" placeholder="Cerca articolo…" value="${filtri.q}" style="flex:2;min-width:180px">
      <select id="cat" style="flex:1;min-width:140px"><option value="">Tutte le categorie</option>
        ${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === filtri.categoria ? 'selected' : ''}>${v}</option>`)}</select>
      <label class="spunta"><input type="checkbox" id="nascondi-zero" ${nascondiZero ? 'checked' : ''}> Nascondi le materie prime a 0</label>
      ${dati.articoli.length > 1 && !scelti ? html`<button class="solo-editori" id="unisci-modo" title="Spunta due o più articoli che sono lo stesso prodotto">⇄ Unisci doppioni</button>` : ''}
    </div>` : ''}
    ${scelti ? html`<div class="scheda barra unisci-barra" style="position:sticky;top:0;z-index:5">
      <span>Spunta gli articoli che sono lo stesso prodotto: <b id="unisci-n">${scelti.size}</b> scelti</span><span class="spazio"></span>
      <button id="unisci-annulla">Annulla</button><button class="primario" id="unisci-via">Unisci…</button></div>` : ''}
    ${Object.entries(CATEGORIE).map(([cat, titolo]) => {
      const rr = righe.filter(x => x.articolo.categoria === cat);
      if (!rr.length) return '';
      return html`<div class="scheda"><h2>${titolo}</h2><div class="scroll-x"><table class="tab-mag">
        <thead><tr>${scelti ? html`<th></th>` : ''}<th>Articolo</th><th class="n">Giacenza</th><th class="n" title="Serve alle cotte pianificate e ai DH ancora da fare">Impegnato</th><th class="n">Disponibile</th><th class="n">Scorta min.</th><th>Scadenza</th><th>Inventario</th></tr></thead>
        <tbody>${rr.map(x => html`<tr class="${x.disponibile < 0 ? 'neg' : x.sottoScorta ? 'basso' : ''}">
          ${scelti ? html`<td><input type="checkbox" data-sel="${x.articolo.id}" ${scelti.has(x.articolo.id) ? 'checked' : ''} aria-label="Scegli ${x.articolo.nome}"></td>` : ''}
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
        <span class="lotto">${u.dataIT(x.data)}</span><span class="birra">${x.verso === 'carico' ? `+ ${MOTIVI_CARICO[x.motivo] || 'Carico'}${x.documento ? ` ${x.documento}` : ''}` : `− ${MOTIVI_SCARICO[x.motivo] || 'Scarico'}`}${x.destinatario ? ` · ${x.destinatario}` : ''}</span>
        <span class="totale" style="margin:0">${(x.righe || []).length} righe</span></a>`)}</div></div>` : ''}
  `;
  const $ = s => document.getElementById(s);
  $('q')?.addEventListener('input', e => { filtri.q = e.target.value; vistaMagazzino().then(() => { const el = $('q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); });
  $('cat')?.addEventListener('change', e => { filtri.categoria = e.target.value; vistaMagazzino(); });
  $('nascondi-zero')?.addEventListener('change', e => { scriviPref(e.target.checked); vistaMagazzino(); });
  $('nuovo-art').onclick = () => dialogArticolo({});
  // import subito, lo stesso dell'automazione notturna (POST automazioni { azione: 'importa' }) (Romain 2026-10-20)
  $('importa-fic').onclick = async e => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = '⟳ Importo…';
    try {
      const t = await token();
      const res = await fetch('/.netlify/functions/automazioni', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ azione: 'importa' }) });
      let r = null;
      try { r = await res.json(); } catch { /* app non pubblicata su Netlify */ }
      if (!res.ok || !r) throw new Error(r?.errore || (res.status === 404 ? 'L\'import funziona solo sull\'app pubblicata' : `Errore ${res.status}`));
      const x = r.esito || {};
      await sincronizza(); // porta nell'app quello che il server ha appena salvato
      u.toast(`Import fatto: ${x.acquisti || 0} fatture fornitori da controllare, ${x.movimenti || 0} movimenti birra${x.errori?.length ? ` · ${x.errori.join(' · ')}` : ''}`);
      if (location.hash === '#/materie-prime') vistaMagazzino();
    } catch (ex) { u.toast(ex.message); b.disabled = false; b.textContent = '⟳ Importa da Fatture in Cloud'; }
  };
  $('da-ricette')?.addEventListener('click', async () => {
    const proposti = articoliDaRicette(dati.cotte, dati.articoli, u.addGiorni(u.oggiISO(), -365));
    if (!proposti.length) return u.toast('Nessun ingrediente trovato nelle cotte recenti');
    if (!(await u.chiedi(`Creo ${proposti.length} articoli dagli ingredienti delle cotte dell'ultimo anno? Potrai rinominarli, unirli con gli alias o eliminarli.`, 'Crea'))) return;
    await u.db.salvaMolti(proposti.map(({ volte: _v, ...a }) => ({ ...a, tipo: 'articolo', id: u.db.nuovoId('articolo'), creato: u.oggiISO() })));
    u.toast(`${proposti.length} articoli creati`);
    location.hash = '#/inventario';
  });
  $('unisci-modo')?.addEventListener('click', () => { scelti = new Set(); vistaMagazzino(); });
  $('unisci-annulla')?.addEventListener('click', () => { scelti = null; vistaMagazzino(); });
  $('unisci-via')?.addEventListener('click', async () => {
    const voci = dati.articoli.filter(a => scelti.has(a.id)).map(art => ({ art }));
    if (voci.length < 2) return u.toast('Spunta almeno due articoli');
    if (await dialogUnisci(voci)) { scelti = null; vistaMagazzino(); }
  });
  u.$app.onchange = async e => {
    if (e.target.dataset.sel) {
      scelti[e.target.checked ? 'add' : 'delete'](e.target.dataset.sel);
      $('unisci-n').textContent = scelti.size;
      return;
    }
    const i = e.target.dataset.collega;
    if (i === undefined || !e.target.value) return;
    const a = dati.articoli.find(x => x.id === e.target.value);
    await u.db.salva({ ...a, alias: [...new Set([...(a.alias || []), scollegati[i].nome])] });
    u.toast(`"${scollegati[i].nome}" collegato a ${a.nome}`);
  };
  u.$app.onclick = async e => {
    const div = e.target.dataset.diviso;
    if (div !== undefined) {
      const x = sospetti[div];
      const rec = await u.db.leggi(x.mov.dove.id);
      const i = Number(x.mov.dove.path.split('.')[1]);
      if (!rec?.righe?.[i] || rec.righe[i].articoloId !== x.articolo.id) return u.toast('Riga non trovata');
      rec.righe[i] = { ...rec.righe[i], qta: Number(rec.righe[i].qta) / 1000 };
      const { aggiornato: _a, ...daSalvare } = rec;
      await u.db.salva(daSalvare);
      u.toast(`${x.articolo.nome}: quantità corretta`);
      return vistaMagazzino();
    }
    const i = e.target.dataset.crea;
    if (i === undefined) return;
    const s = scollegati[i];
    dialogArticolo({ nome: s.chiave.replace(/\b\w/g, l => l.toUpperCase()), categoria: categoriaDa(s.sezione, s.nome), unita: unitaDa(s.sezione), alias: [s.nome] });
  };
  const $acq = document.getElementById('acquisti');
  if ($acq) $acq.addEventListener('click', async e => {
    const b = e.target.closest('[data-acq], [data-acq-via]');
    if (!b) return;
    e.stopPropagation();
    const x = acquisti.find(a => a.id === (b.dataset.acq || b.dataset.acqVia));
    if (b.dataset.acqVia) {
      if (!(await u.chiedi(`Scartare ${x.doc.fornitore} ${x.doc.numero}? Non verrà importato di nuovo.`, 'Scarta'))) return;
      await u.db.elimina(x.id);
      return vistaMagazzino();
    }
    apriBozzaBolla({ ...x.doc, rifEsterno: x.rifEsterno, sospesoId: x.id });
  });
}

// Bolla nuova già compilata (fattura d'acquisto importata, foto letta dall'AI): stesso formato di leggiDdt
// { fornitore, numero, data, righe: [{ codice, descrizione, um, qta, prezzo, lotto, scadenza }], rifEsterno?, sospesoId? }
let bozzaBolla = null;
export function apriBozzaBolla(ddt) {
  bozzaBolla = ddt;
  if (location.hash === '#/bolla/nuova') vistaBolla('nuova'); else location.hash = '#/bolla/nuova';
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

// ---------- unisci doppioni (Materie prime e Statistiche) ----------
// voci: [{ art }] articoli del magazzino, oppure [{ nome, nomi, categoria }] nomi delle schede cotta senza articolo.
// Si sceglie quale tenere: gli altri articoli gli vengono uniti (bolle, inventari, scarichi, nome → alias),
// i nomi non collegati diventano suoi alias. Tenendo un nome non collegato si crea l'articolo.
// Restituisce true se l'unione è fatta.
export function dialogUnisci(voci) {
  const { html } = u;
  const etichetta = v => (v.art ? `${v.art.nome} (${CATEGORIE[v.art.categoria] || ''}, ${v.art.unita})` : `${v.nome} (solo nelle schede cotta, nuovo articolo)`);
  const d = document.createElement('dialog');
  d.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">Unisci ${voci.length} doppioni</h2>
    <p class="totale">Scegli il nome da tenere. Bolle, inventari e scarichi degli altri passano a lui, i loro nomi diventano suoi alias e le cotte li trovano ancora.</p>
    ${voci.map((v, i) => html`<label class="spunta" style="display:flex;gap:8px;margin:8px 0"><input type="radio" name="tieni" value="${i}" ${i === Math.max(0, voci.findIndex(x => x.art)) ? 'checked' : ''}> ${etichetta(v)}</label>`)}
    <div class="barra" style="margin-top:14px"><span class="spazio"></span>
      <button value="no" formnovalidate>Annulla</button><button class="primario" value="ok">Unisci</button></div>
  </form>`.s;
  document.body.appendChild(d);
  const fatto = new Promise(ok => d.addEventListener('close', async () => {
    const i = Number(new FormData(d.querySelector('form')).get('tieni'));
    d.remove();
    if (d.returnValue !== 'ok') return ok(false);
    ok(await eseguiUnione(voci, i));
  }));
  d.showModal();
  return fatto;
}

async function eseguiUnione(voci, i) {
  const t = voci[i];
  let tieni = t.art;
  if (!tieni) {
    const cat = t.categoria || 'malto';
    tieni = await u.db.salva({
      tipo: 'articolo', id: u.db.nuovoId('articolo'), nome: t.nome, categoria: cat, unita: ['malto', 'zucchero'].includes(cat) ? 'kg' : 'g',
      scortaMin: 0, alias: [...new Set(t.nomi || [])], creato: u.oggiISO(),
    });
  }
  for (const [j, v] of voci.entries()) {
    if (j === i || !v.art) continue;
    const dati = await datiMagazzino(); // ogni unione parte dai dati aggiornati dalla precedente
    const a = dati.articoli.find(x => x.id === tieni.id), togli = dati.articoli.find(x => x.id === v.art.id);
    if (!a || !togli) continue;
    const r = unisciArticoli(a, togli, dati);
    if (r.errore) { u.toast(r.errore); return false; }
    await u.db.salvaMolti(r.modificati.map(({ aggiornato: _a, ...x }) => x)); // ora nuova: vince nella sincronizzazione
    await u.db.elimina(togli.id);
  }
  const nomi = voci.filter((v, j) => j !== i && !v.art).flatMap(v => v.nomi || [v.nome]);
  if (nomi.length) {
    const a = await u.db.leggi(tieni.id);
    await u.db.salva({ ...a, alias: [...new Set([...(a.alias || []), ...nomi])] });
  }
  u.toast(`${voci.length - 1} ${voci.length === 2 ? 'doppione unito' : 'doppioni uniti'} in ${tieni.nome}`);
  return true;
}

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
        <label>Prezzo (€/${a.unita}) <input name="prezzo" type="number" step="any" inputmode="decimal" value="${a.prezzo || ''}" title="Usato per il costo delle cotte se le bolle non hanno il prezzo"></label>
        <label>1 pezzo / sacco = (${a.unita}) <input name="pesoPezzo" type="number" step="any" inputmode="decimal" value="${a.pesoPezzo || ''}" placeholder="es. 20" title="Per le bolle che riportano solo i pezzi"></label>
        <label>Densità (kg/L) <input name="densita" type="number" step="any" inputmode="decimal" value="${a.densita || ''}" placeholder="${densitaArticolo({ nome: a.nome }) ? String(DENSITA_ACIDO).replace('.', ',') : 'solo liquidi'}" title="Per i liquidi: converte i ml delle schede cotta nell'unità dell'articolo (acido lattico 80% = 1,2)"></label>
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
    const rec = {
      ...a, nome: String(fd.get('nome')).trim(), categoria: fd.get('categoria'),
      scortaMin: Number(fd.get('scortaMin')) || 0, pesoPezzo: Number(fd.get('pesoPezzo')) || null, densita: Number(fd.get('densita')) || null, prezzo: Number(fd.get('prezzo')) || null,
      alias: String(fd.get('alias') || '').split(',').map(s => s.trim()).filter(Boolean),
    };
    // unità cambiata (g ↔ kg, ml ↔ L): si convertono anche inventari, scorta minima, peso per pezzo e prezzo
    const cambio = cambiaUnita(rec, fd.get('unita'), dati.inventari);
    if (cambio) {
      if (!(await u.chiedi(`Passare ${rec.nome} da ${a.unita} a ${fd.get('unita')}? Le quantità contate negli inventari, la scorta minima e il prezzo vengono convertiti.`, 'Converti'))) return;
      await u.db.salvaMolti([cambio.art, ...cambio.inventari].map(({ aggiornato: _a, ...x }) => x));
    } else await u.db.salva({ ...rec, unita: fd.get('unita') });
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
  // chi controlla la merce in arrivo: di default il primo degli operatori in Impostazioni
  const operatori = operatoriDa(await u.db.leggi(ID_OPERATORI));
  const nomeControllo = () => operatori[0];
  if (id !== 'nuova' && !esistente) { u.$app.innerHTML = html`<p class="vuoto">Bolla non trovata. <a href="#/materie-prime">Torna alle materie prime</a></p>`; return; }
  const bozza = id === 'nuova' ? bozzaBolla : null;
  bozzaBolla = null;
  // righe della fattura che sono lattine o fusti vuoti: vanno in Contenitori, non in magazzino
  const contenitori = bozza?.sospesoId ? await u.db.tutti('contenitore') : [];
  const vuoto = r => { const t = trovaContenitore(r, contenitori); return !!t && !t.ignora; };
  const b = esistente ? JSON.parse(JSON.stringify(esistente))
    : bozza ? { tipo: 'bolla', data: bozza.data || u.oggiISO(), fornitore: bozza.fornitore || '', numero: bozza.numero || '', righe: proponiRighe(bozza, dati.articoli).map((r, i) => (vuoto(bozza.righe[i]) ? { ...r, includi: false, nota: 'vuoto: si carica in Contenitori' } : { ...r, includi: r.includi || !!categoriaDaDescrizione(r.descrizione) || dati.articoli.some(a => a.nome === r.nome) })), ...(bozza.rifEsterno ? { rifEsterno: bozza.rifEsterno } : {}) }
    : { tipo: 'bolla', data: u.oggiISO(), fornitore: '', numero: '', righe: [{ nome: '', qta: null, unita: '', lotto: '', scadenza: '' }] };
  const perId = new Map(dati.articoli.map(a => [a.id, a]));
  for (const r of b.righe) if (r.articoloId && !r.nome) r.nome = perId.get(r.articoloId)?.nome || '';
  const fornitori = [...new Set(dati.bolle.map(x => x.fornitore).filter(Boolean))].sort();
  let pdfStato = '';
  const daPdf = () => b.righe.some(r => r.descrizione);
  // bolla nuova aperta da una fattura: il PDF o la foto della bolla non sostituiscono le righe, le incrociano
  const daFattura = !esistente && !!bozza?.rifEsterno;
  const noto = r => r.includi || !!categoriaDaDescrizione(r.descrizione) || dati.articoli.some(a => a.nome === r.nome);
  const applica = (ddt, lette, origine) => {
    if (!daFattura) {
      b.data = ddt.data || b.data;
      b.numero = ddt.numero || b.numero;
      b.fornitore = ddt.fornitore || b.fornitore;
      b.righe = lette;
      return `${origine}: ${lette.filter(r => r.includi).length} righe da caricare, ${lette.filter(r => !r.includi).length} escluse (spese, imballi…).`;
    }
    if (ddt.numero) b.ddt = ddt.numero;
    const { righe, avvisi } = incrociaBolla(b.righe, lette.filter(noto));
    b.righe = righe;
    const lotti = righe.filter(r => r.includi !== false && r.lotto).length;
    return `${origine}: lotti e scadenze presi dalla bolla (${lotti} righe con lotto)${avvisi ? ` · ${avvisi} da controllare, segnate con ⚠` : ' · quantità uguali alla fattura'}.`;
  };

  async function leggiPdf(file) {
    pdfStato = 'Leggo il PDF…';
    disegna();
    try {
      const ddt = leggiDdt(await estraiTesto(file));
      if (!ddt.righe.length) throw new Error('Non ho trovato righe articolo: il PDF è una scansione o ha un formato che non conosco. Inserisci le righe a mano.');
      pdfStato = applica(ddt, proponiRighe(ddt, dati.articoli), file.name);
    } catch (ex) {
      // scansione o formato sconosciuto: ci prova Claude
      return leggiAi(file, `${ex.message.split(':')[0]}: lo faccio leggere all'AI…`);
    }
    disegna();
  }

  // foto della bolla (o PDF scansionato) letta da Claude
  async function leggiAi(file, attesa = 'Leggo la bolla con l\'AI… (qualche secondo)') {
    pdfStato = attesa;
    disegna();
    try {
      const { json: ddt } = await chiediAi({ azione: 'bolla', ...(await fotoBase64(file)) });
      if (!ddt?.righe?.length) throw new Error('Non ho trovato righe articolo nella foto: rifalla più dritta e illuminata, o inserisci le righe a mano.');
      const righe = ddt.righe.map(r => ({ ...r, prezzo: r.prezzo ?? undefined, scadenza: /^\d{4}-\d{2}-\d{2}$/.test(r.scadenza) ? r.scadenza : '' }));
      const lette = proponiRighe({ ...ddt, righe }, dati.articoli).map(r => ({ ...r, includi: noto(r) }));
      pdfStato = `${applica({ ...ddt, data: /^\d{4}-\d{2}-\d{2}$/.test(ddt.data) ? ddt.data : '' }, lette, 'Letta dall\'AI')} Controlla quantità e lotti prima di salvare.`;
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
          ${daFattura ? html`<span class="totale" style="margin:0;flex-basis:100%">Righe dalla fattura di Fatture in Cloud, senza lotti e scadenze: leggi il PDF o la foto della bolla (DDT) e li prendo da lì, controllando che le quantità siano le stesse.</span>` : ''}
          <label class="btn primario">📄 Leggi il PDF della bolla<input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
          <label class="btn" title="Fotografa la bolla di carta: la legge Claude">📷 Foto della bolla<input type="file" id="foto-bolla" accept="image/*" capture="environment" hidden></label>
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
      <div class="scheda bolla-controllo">
        <h2>Controllo all'arrivo <small class="totale">HACCP</small></h2>
        <div class="ck-spunte">${CONTROLLI_ARRIVO.map(([k, n]) => html`<label><input type="checkbox" data-ck="${k}" ${b.controllo?.[k] ? 'checked' : ''}> ${n}</label>`)}</div>
        <div class="griglia" style="margin-top:10px">
          <label>Esito<select data-ck="esito">
            <option value="" ${b.controllo?.esito ? '' : 'selected'}>non controllata</option>
            <option value="conforme" ${b.controllo?.esito === 'conforme' ? 'selected' : ''}>Conforme</option>
            <option value="non conforme" ${b.controllo?.esito === 'non conforme' ? 'selected' : ''}>Non conforme</option></select></label>
          <label>Controllato da<select data-ck="chi">${opzioniOperatori(operatori, b.controllo?.chi).map(n => html`<option ${n === (b.controllo?.chi || nomeControllo()) ? 'selected' : ''}>${n}</option>`)}</select></label>
          <label style="grid-column:span 2">Note (cosa non va, cosa hai fatto)<input data-ck="note" value="${b.controllo?.note || ''}"></label>
        </div>
      </div>
      <div class="scheda"><h2>Righe</h2>
        ${daPdf() ? html`<p class="totale">Controlla le righe lette dal PDF: togli la spunta a quello che non va in magazzino e correggi il nome se l'articolo esiste già con un altro nome (la descrizione del fornitore viene ricordata per le prossime bolle).</p>` : ''}
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr>${daPdf() ? html`<th title="Carica in magazzino">✓</th>` : ''}<th>Articolo</th><th style="width:130px">Categoria (se nuovo)</th><th style="width:100px">Quantità</th><th style="width:80px">Unità</th><th style="width:110px" title="Prezzo per unità della riga, senza IVA: serve per il costo delle cotte">€/unità (facolt.)</th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th><th></th></tr></thead>
          <tbody>${b.righe.map((r, i) => {
            const art = dati.articoli.find(a => a.nome.toLowerCase() === String(r.nome || '').trim().toLowerCase());
            return html`<tr class="${r.includi === false ? 'escluso' : ''}">
              ${daPdf() ? html`<td><input type="checkbox" data-r="${i}.includi" ${r.includi === false ? '' : 'checked'} style="width:auto;min-height:auto"></td>` : ''}
              <td><input data-r="${i}.nome" list="dl-art" value="${r.nome || ''}" style="min-width:160px">${r.descrizione ? html`<div class="totale" style="margin:2px 0 0">${r.descrizione}${art || r.includi === false ? '' : ' · articolo nuovo'}</div>` : ''}${r.nota ? html`<div class="totale nota-riga">⚠ ${r.nota}</div>` : ''}</td>
              <td>${art ? html`<span class="totale">${CATEGORIE[art.categoria]}</span>` : html`<select data-r="${i}.categoria">${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === (r.categoria || 'malto') ? 'selected' : ''}>${v}</option>`)}</select>`}</td>
              <td><input data-r="${i}.qta" type="number" step="any" inputmode="decimal" value="${r.qta ?? ''}"></td>
              <td><select data-r="${i}.unita">${UNITA.map(x => html`<option ${x === (r.unita || art?.unita || 'kg') ? 'selected' : ''}>${x}</option>`)}</select></td>
              <td><input data-r="${i}.prezzo" type="number" step="any" inputmode="decimal" value="${r.prezzo ?? ''}"></td>
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
    if (t.id === 'foto-bolla' && e.type === 'change' && t.files[0]) return leggiAi(t.files[0]);
    if (t.dataset.b) b[t.dataset.b] = t.value;
    if (t.dataset.ck) {
      b.controllo = { chi: nomeControllo(), ...b.controllo, [t.dataset.ck]: t.type === 'checkbox' ? t.checked : t.value };
      // tutte le spunte date: esito proposto "conforme"
      if (t.type === 'checkbox' && !b.controllo.esito && CONTROLLI_ARRIVO.every(([k]) => b.controllo[k])) { b.controllo.esito = 'conforme'; disegna(); }
    }
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
        return { articoloId: art.id, nome: art.nome, qta: Number(r.qta), unita: r.unita || art.unita, lotto: String(r.lotto || '').trim(), scadenza: r.scadenza || '', ...(Number(r.prezzo) > 0 ? { prezzo: Number(r.prezzo) } : {}), ...(r.descrizione ? { descrizione: r.descrizione } : {}) };
      });
      if (nuovi.length || aggiornati.size) await u.db.salvaMolti([...nuovi, ...aggiornati.values()].map(({ aggiornato: _a, ...a }) => a));
      await u.db.salva({ ...b, id: b.id || u.db.nuovoId('bolla'), righe: out });
      if (bozza?.sospesoId) {
        // la fattura resta per Contenitori se ha lattine o fusti non ancora caricati là
        const rec = await u.db.leggi(bozza.sospesoId);
        const vuoti = (rec?.doc?.righe || []).filter(vuoto);
        if (rec && !rec.eliminato && !rec.vuotiVisti && vuoti.length) {
          const { aggiornato: _a, ...daSalvare } = rec;
          await u.db.salva({ ...daSalvare, mpFatte: true, doc: { ...rec.doc, righe: vuoti } });
        } else await u.db.elimina(bozza.sospesoId);
      }
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
// testo per il filtro dell'inventario: nome, alias e categoria, senza accenti e maiuscole
const semplice = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const testoCerca = a => semplice([a.nome, ...(a.alias || []), CATEGORIE[a.categoria]].join(' '));
export async function vistaInventario() {
  const { html } = u;
  const dati = await datiMagazzino();
  const g = giacenze(dati);
  const data = { v: u.oggiISO() };
  const contati = new Map();
  const nascondi = leggiPref();
  const extre = new Map(); // lotto e scadenza facoltativi per articolo
  const extra = id => { if (!extre.has(id)) extre.set(id, {}); return extre.get(id); };
  // lotto proposto: quello in uso (il più vecchio rimasto), altrimenti l'ultimo entrato
  const proposto = id => {
    const x = g.get(id);
    const inUso = [...x.lotti].reverse().find(l => l.lotto && l.qta > 1e-9); // g.lotti: i più recenti per primi
    const ultimo = x.movimenti.find(m => m.tipo !== 'scarico' && (m.lotto || m.scadenza));
    const l = inUso || ultimo || {};
    const altri = x.lotti.filter(y => y.lotto && y.qta > 1e-9 && y !== inUso).map(y => y.lotto);
    return { lotto: l.lotto || '', scadenza: l.scadenza || '', altri };
  };
  for (const a of dati.articoli) { const p = proposto(a.id); if (p.lotto || p.scadenza) Object.assign(extra(a.id), { lotto: p.lotto, scadenza: p.scadenza }); }
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span></div>
    <div class="scheda">
      <h1 style="margin-top:0">Inventario</h1>
      <p class="totale">Scrivi la quantità contata solo per gli articoli che hai controllato: da quella data la giacenza riparte da lì, poi si aggiungono le bolle e si tolgono cotte e DH. Gli articoli lasciati vuoti non cambiano. Lotto e scadenza sono già quelli in magazzino: cambiali se non corrispondono.</p>
      <div class="barra" style="margin:0;align-items:flex-end">
        <label style="max-width:200px">Data inventario <input type="date" id="data-inv" value="${data.v}"></label>
        <label style="max-width:260px">Cerca materia prima <input type="search" id="inv-cerca" placeholder="es. pils, citra, gypsum…" autocomplete="off"></label>
        <label class="spunta"><input type="checkbox" id="nascondi-zero" ${nascondi ? 'checked' : ''}> Nascondi le materie prime a 0</label>
      </div>
    </div>
    <div id="elenco-inv" class="${nascondi ? 'senza-zero' : ''}">
    ${!dati.articoli.length ? html`<p class="vuoto">Nessun articolo. <a href="#/materie-prime">Crea prima gli articoli</a>.</p>` : ''}
    ${Object.entries(CATEGORIE).map(([cat, titolo]) => {
      const rr = dati.articoli.filter(a => a.categoria === cat);
      if (!rr.length) return '';
      const tuttiZero = rr.every(a => aZero(g.get(a.id).giacenza));
      return html`<div class="scheda ${tuttiZero ? 'tutti-zero' : ''}"><h2>${titolo}</h2><div class="scroll-x"><table class="tab-edit tab-inv">
        <thead><tr><th>Articolo</th><th class="n">Calcolato oggi</th><th style="width:130px">Contato</th><th style="width:50px"></th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th></tr></thead>
        <tbody>${rr.map(a => html`<tr class="${aZero(g.get(a.id).giacenza) ? 'zero' : ''}" data-cerca="${testoCerca(a)}">
          <td class="inv-nome">${a.nome}</td><td class="n inv-calc" data-et="Calcolato oggi">${fmt(g.get(a.id).giacenza, a.unita)}</td>
          <td data-et="Contato (${a.unita})"><input data-inv="${a.id}" type="number" step="any" inputmode="decimal"></td><td class="totale inv-unita">${a.unita}</td>
          <td data-et="Lotto (facolt.)"><input data-lotto="${a.id}" value="${extre.get(a.id)?.lotto || ''}">${proposto(a.id).altri.length ? html`<span class="totale" style="display:block;font-size:.72rem">altri lotti: ${proposto(a.id).altri.join(', ')}</span>` : ''}</td><td data-et="Scadenza (facolt.)"><input data-scad="${a.id}" type="date" value="${extre.get(a.id)?.scadenza || ''}"></td>
        </tr>`)}</tbody></table></div></div>`;
    })}
    </div>
    <p class="vuoto" id="inv-nessuno" hidden>Nessuna materia prima trovata.</p>
    ${dati.articoli.length ? html`<div class="barra salva-inv"><span class="totale" id="inv-conta"></span><span class="spazio"></span><button class="primario" id="salva-inv">Salva inventario</button></div>` : ''}`;
  const toccati = new Set(); // articoli con lotto o scadenza cambiati a mano
  // lotto/scadenza scritti senza quantità contata
  const soloLotto = () => [...toccati].filter(id => !contati.has(id) && (extre.get(id)?.lotto || extre.get(id)?.scadenza));
  const conta = () => {
    const n = contati.size + soloLotto().length;
    const el = document.getElementById('inv-conta'); if (el) el.textContent = n ? (n === 1 ? '1 articolo da salvare' : `${n} articoli da salvare`) : '';
  };
  // filtro: nasconde le righe che non corrispondono (le quantità già scritte restano)
  const filtra = () => {
    const parole = semplice(document.getElementById('inv-cerca').value).split(' ').filter(Boolean);
    let visibili = 0;
    for (const sc of u.$app.querySelectorAll('#elenco-inv > .scheda')) {
      let n = 0;
      for (const tr of sc.querySelectorAll('tbody tr')) {
        const ok = parole.every(p => tr.dataset.cerca.includes(p));
        tr.hidden = !ok;
        if (ok) n++;
      }
      sc.hidden = !n;
      visibili += n;
    }
    document.getElementById('elenco-inv').classList.toggle('filtrato', parole.length > 0);
    document.getElementById('inv-nessuno').hidden = !!visibili || !dati.articoli.length;
  };
  document.getElementById('inv-cerca').onkeydown = e => { if (e.key === 'Escape') { e.target.value = ''; filtra(); } };
  u.$app.oninput = e => {
    if (e.target.id === 'inv-cerca') return filtra();
    if (e.target.id === 'nascondi-zero') {
      scriviPref(e.target.checked);
      document.getElementById('elenco-inv').classList.toggle('senza-zero', e.target.checked);
      return;
    }
    if (e.target.id === 'data-inv') data.v = e.target.value;
    const id = e.target.dataset.inv;
    if (id) { if (e.target.value === '') contati.delete(id); else contati.set(id, Number(e.target.value)); conta(); }
    if (e.target.dataset.lotto) { extra(e.target.dataset.lotto).lotto = e.target.value.trim(); toccati.add(e.target.dataset.lotto); conta(); }
    if (e.target.dataset.scad) { extra(e.target.dataset.scad).scadenza = e.target.value; toccati.add(e.target.dataset.scad); conta(); }
  };
  u.$app.onchange = u.$app.oninput;
  u.$app.onclick = async e => {
    if (e.target.id !== 'salva-inv') return;
    const solo = soloLotto();
    if (!contati.size && !solo.length) return u.toast('Nessuna quantità, lotto o scadenza inserita');
    if (!data.v) return u.toast('Manca la data');
    // luppoli, lieviti, sali… in kg contati in grammi (10.000 kg di Citra): si chiede se dividere per 1000
    const sospetti = [...contati].map(([id, q]) => ({ id, q, a: dati.articoli.find(x => x.id === id) }))
      .filter(x => x.a && sogliaGrammi(x.a) && x.q >= sogliaGrammi(x.a));
    if (sospetti.length) {
      const elenco = sospetti.map(x => `${x.a.nome} ${u.numIT(x.q)} ${x.a.unita}`).join(', ');
      if (await u.chiedi(`${elenco}: forse li hai contati in grammi (o ml). Li divido per 1000? Con Annulla restano come li hai scritti.`, 'Sì, dividi per 1000')) {
        for (const x of sospetti) contati.set(x.id, x.q / 1000);
      }
    }
    // Lotto o scadenza senza quantità: vanno sulla riga d'origine (bolla, carico manuale o inventario)
    // dei lotti in magazzino che non li hanno; se tutti li hanno già, riga d'inventario con la quantità calcolata.
    const daAggiornare = new Map(); // id record → [{ path, lotto, scadenza }]
    const righeInv = [...contati].map(([articoloId, qta]) => ({ articoloId, qta, lotto: extre.get(articoloId)?.lotto || '', scadenza: extre.get(articoloId)?.scadenza || '' }));
    const gData = data.v === u.oggiISO() ? g : giacenze(dati, data.v);
    for (const id of solo) {
      const ex = extre.get(id);
      const vuoti = g.get(id).lotti.filter(l => l.dove && ((ex.lotto && !l.lotto) || (ex.scadenza && !l.scadenza)));
      if (vuoti.length) {
        for (const l of vuoti) {
          if (!daAggiornare.has(l.dove.id)) daAggiornare.set(l.dove.id, []);
          daAggiornare.get(l.dove.id).push({ path: l.dove.path, lotto: ex.lotto, scadenza: ex.scadenza });
        }
      } else righeInv.push({ articoloId: id, qta: Math.round(gData.get(id).giacenza * 1000) / 1000, lotto: ex.lotto || '', scadenza: ex.scadenza || '' });
    }
    for (const [recId, mod] of daAggiornare) {
      const rec = await u.db.leggi(recId);
      if (!rec) continue;
      for (const m of mod) {
        const [k, i] = m.path.split('.');
        const r = rec[k]?.[i];
        if (!r) continue;
        rec[k][i] = { ...r, lotto: r.lotto || m.lotto || '', scadenza: r.scadenza || m.scadenza || '' };
      }
      const { aggiornato: _a, ...daSalvare } = rec;
      await u.db.salva(daSalvare);
    }
    if (righeInv.length) await u.db.salva({ tipo: 'inventario', id: u.db.nuovoId('inventario'), data: data.v, righe: righeInv });
    const n = contati.size + solo.length;
    u.toast(`Inventario salvato: ${n} ${n === 1 ? 'articolo' : 'articoli'}`);
    location.hash = '#/materie-prime';
  };
}

// ---------- registro HACCP S6 carico/scarico (da stampare) ----------
const s6 = { da: null, a: null, categoria: '', pagina: 0 };
const RIGHE_S6 = 18;
export async function vistaRegistroS6() {
  const { html } = u;
  // date di default ricalcolate a ogni apertura (l'app può restare aperta per giorni); quelle scelte a mano restano
  // default: la settimana in corso, da lunedì a domenica (Romain 2026-10-12)
  const oggi = u.oggiISO(), lun = u.addGiorni(oggi, -((new Date(oggi + 'T12:00:00').getDay() + 6) % 7));
  if (!s6.daScelto) s6.da = lun;
  if (!s6.aScelto) s6.a = u.addGiorni(lun, 6);
  const dati = await datiMagazzino();
  const righe = registroS6(dati, s6.da, s6.a).filter(r => !s6.categoria || r.categoria === s6.categoria);
  // fogli da RIGHE_S6 righe, ognuno con intestazione e nomi delle colonne (Romain 2026-10-20); a video uno alla volta
  const pagine = [];
  for (let i = 0; i < righe.length; i += RIGHE_S6) pagine.push(righe.slice(i, i + RIGHE_S6));
  s6.pagina = Math.min(Math.max(0, s6.pagina || 0), Math.max(0, pagine.length - 1));
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/haccp" class="btn">← HACCP</a>
      <label>Dal <input type="date" id="s6-da" value="${s6.da}"></label>
      <label>Al <input type="date" id="s6-a" value="${s6.a}"></label>
      <select id="s6-cat"><option value="">Tutte le categorie</option>
        ${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === s6.categoria ? 'selected' : ''}>${v}</option>`)}</select>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    ${righe.some(r => r.scollegato) ? html`<p class="totale non-stampa">${righe.filter(r => r.scollegato).length} righe hanno un ingrediente non collegato a un articolo del magazzino: compaiono col nome della scheda cotta e senza lotto. Collegali in Materie prime → "Ingredienti delle cotte non collegati".</p>` : ''}
    ${pagine.length > 1 ? html`<div class="barra non-stampa s6-pagine">
      <button id="s6-prec" ${s6.pagina ? '' : 'disabled'} aria-label="Pagina precedente">◀</button>
      <span>Pagina <b>${s6.pagina + 1}</b> di ${pagine.length} · ${righe.length} righe</span>
      <button id="s6-succ" ${s6.pagina < pagine.length - 1 ? '' : 'disabled'} aria-label="Pagina successiva">▶</button>
      <span class="totale">In stampa escono tutte le pagine.</span></div>` : ''}
    ${(pagine.length ? pagine : [[]]).map((pag, n) => html`<div class="s6 s6-pag ${n === s6.pagina ? '' : 's6-altra'}">
      <div class="s6-testa">
        <img src="${LOGO_KASHMIR}" alt="Kashmir Brewing Company">
        <div><h1>S6 - CARICO - SCARICO /// VECAS SRLS</h1>
          <div>Periodo: dal ${u.dataIT(s6.da)} al ${u.dataIT(s6.a)}${s6.categoria ? ` · ${CATEGORIE[s6.categoria]}` : ''} · stampato il ${u.dataIT(u.oggiISO())}${pagine.length > 1 ? ` · pagina ${n + 1} di ${pagine.length}` : ''}</div></div>
      </div>
      <p class="s6-legenda">Legenda: C = carico - S = scarico - QTA = quantità - Dest = destinatario - Prov = Provenienza</p>
      ${pag.length ? html`<table class="tab-s6">
        <thead><tr><th>C/S</th><th>Data</th><th>Prodotto</th><th>Lotto</th><th class="n">QTA</th><th>Scadenza</th><th>Dest/Prov</th></tr></thead>
        <tbody>${pag.map(r => html`<tr class="${r.cs === 'C' ? 'c' : ''}">
          <td>${r.cs}</td><td>${u.dataIT(r.data)}</td><td>${r.prodotto}</td>
          <td>${r.lotto || !r.dove ? r.lotto : html`<input class="s6-lotto" data-dove="${JSON.stringify(r.dove)}" placeholder="+ lotto" title="Scrivi il lotto: si salva su ${r.dove.tipo === 'cotta' ? 'la scheda cotta' : r.dove.tipo === 'bolla' ? 'la bolla' : 'il movimento manuale'}">`}</td>
          <td class="n">${fmt(r.qta, r.unita)}</td><td>${r.scadenza ? u.dataIT(r.scadenza) : ''}</td><td>${r.chi}</td>
        </tr>`)}</tbody></table>` : html`<p class="vuoto">Nessun movimento nel periodo.</p>`}
    </div>`)}`;
  const $ = s => document.getElementById(s);
  $('s6-da').onchange = e => { s6.da = e.target.value; s6.daScelto = !!e.target.value; s6.pagina = 0; vistaRegistroS6(); };
  $('s6-a').onchange = e => { s6.a = e.target.value; s6.aScelto = !!e.target.value; s6.pagina = 0; vistaRegistroS6(); };
  if ($('s6-prec')) $('s6-prec').onclick = () => { s6.pagina--; vistaRegistroS6(); };
  if ($('s6-succ')) $('s6-succ').onclick = () => { s6.pagina++; vistaRegistroS6(); };
  const loghi = [...u.$app.querySelectorAll('.s6-testa img')];
  $('s6-cat').onchange = e => { s6.categoria = e.target.value; s6.pagina = 0; vistaRegistroS6(); };
  // lotto mancante scritto qui: va sulla riga di origine (ingrediente della cotta, riga della bolla o del movimento manuale)
  u.$app.querySelectorAll('.s6-lotto').forEach(el => {
    el.onchange = async () => {
      const lotto = el.value.trim();
      if (!lotto) return;
      const dove = JSON.parse(el.dataset.dove);
      const rec = await u.db.leggi(dove.id);
      const [k, i] = dove.path.split('.');
      if (!rec?.[k]?.[i]) return u.toast('Riga di origine non trovata');
      rec[k][i] = { ...rec[k][i], lotto };
      const { aggiornato: _a, ...daSalvare } = rec;
      await u.db.salva(daSalvare);
      u.toast(`Lotto ${lotto} salvato`);
      const y = scrollY;
      vistaRegistroS6().then(() => scrollTo(0, y));
    };
  });
  $('stampa').onclick = async () => {
    await Promise.all(loghi.map(l => l.decode().catch(() => {}))); // stampa coi loghi già caricati
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
    : { tipo: 'scarico', verso: id === 'carico' ? 'carico' : 'scarico', data: u.oggiISO(), motivo: id === 'carico' ? 'ddt' : 'vendita', documento: '', destinatario: '', note: '', righe: [{ articoloId: '', qta: null, unita: '', lotto: '', scadenza: '' }] };
  sc.verso ||= 'scarico';
  const carico = () => sc.verso === 'carico';
  // le giacenze senza questo scarico, per proporre i lotti disponibili
  const g = giacenze({ ...dati, scarichi: dati.scarichi.filter(x => x.id !== sc.id) });
  // nel carico si riconoscono anche i nomi simili e gli alias (Gypsum = Gesso)
  const perNome = n => dati.articoli.find(a => a.nome.toLowerCase() === String(n || '').trim().toLowerCase())
    || (carico() && String(n || '').trim() ? trovaArticolo(dati.articoli, n) : null);
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
          ? 'Per la materia prima che entra a mano: con DDT o fattura del fornitore, oppure reso da un cliente, prestito o scambio, campione, rettifica. Lotto e scadenza sono facoltativi.'
          : 'Per la materia prima che esce dal magazzino senza andare in una cotta: vendita, reso al fornitore, scarto. Se non scegli il lotto esce quello caricato da più tempo.'}</p>
        <div class="griglia">
          <label>Data <input type="date" data-s="data" value="${sc.data || ''}"></label>
          <label>Motivo <select data-s="motivo">${Object.entries(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO).map(([k, v]) => html`<option value="${k}" ${k === sc.motivo ? 'selected' : ''}>${v}</option>`)}</select></label>
          ${carico() ? html`<label>N° documento <input data-s="documento" value="${sc.documento || ''}" placeholder="${sc.motivo === 'fattura' ? 'n° fattura' : sc.motivo === 'ddt' ? 'n° DDT' : 'facoltativo'}"></label>` : ''}
          <label style="grid-column:span 2">${carico() ? 'Provenienza / fornitore' : 'Destinatario / cliente'} <input data-s="destinatario" list="dl-dest" value="${sc.destinatario || ''}"></label>
          <label style="grid-column:1/-1">Note <input data-s="note" value="${sc.note || ''}"></label>
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
              <td class="n totale">${gg ? fmt(gg.giacenza, art.unita) : carico() && String(r.nome || '').trim() ? html`<select data-r="${i}.categoria" title="Articolo nuovo: si crea al salvataggio in questa categoria">${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === (r.categoria || categoriaDaDescrizione(r.nome) || 'aggiunta') ? 'selected' : ''}>Nuovo · ${v}</option>`)}</select>` : ''}</td>
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
      if (ignoti.length && !carico()) return u.toast(`Articolo non trovato: ${ignoti.map(r => r.nome).join(', ')}`);
      if (!sc.data || !righe.length) return u.toast('Servono la data e almeno una riga con articolo e quantità');
      // carico: gli articoli che non esistono si creano qui
      const nuovi = [];
      for (const r of ignoti) {
        const nome = String(r.nome).trim();
        if (nuovi.some(a => a.nome.toLowerCase() === nome.toLowerCase())) continue;
        nuovi.push({ tipo: 'articolo', id: u.db.nuovoId('articolo'), nome, categoria: r.categoria || categoriaDaDescrizione(nome) || 'aggiunta', unita: r.unita || 'kg', scortaMin: 0, alias: [], creato: [sc.data, u.oggiISO()].sort()[0] });
      }
      if (nuovi.length) { await u.db.salvaMolti(nuovi); dati.articoli.push(...nuovi); }
      const out = righe.map(r => {
        const art = perNome(r.nome);
        return { articoloId: art.id, nome: art.nome, qta: Number(r.qta), unita: r.unita || art.unita, lotto: (r.lotto || '').trim(), ...(carico() ? { scadenza: r.scadenza || '' } : {}) };
      });
      await u.db.salva({ ...sc, id: sc.id || u.db.nuovoId('scarico'), righe: out });
      u.toast(carico() ? `Carico salvato${nuovi.length ? ` · ${nuovi.length === 1 ? '1 articolo nuovo' : `${nuovi.length} articoli nuovi`}` : ''}` : 'Scarico salvato');
      location.hash = '#/materie-prime';
    }
  };
}
