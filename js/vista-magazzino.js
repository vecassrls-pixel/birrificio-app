// Pagine "Materie prime": giacenze, scheda articolo, bolla di carico, inventario.
// Riceve da app.js gli strumenti condivisi (html, db, toast…) per non duplicarli.

import {
  CATEGORIE, UNITA, GIORNI_IN_SCADENZA, giacenze, daCollegare, articoliDaRicette, categoriaDa, chiaveNome, statoScadenza, unitaDa, registroS6,
} from './magazzino.js';

let u; // { $app, html, raw, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni }
export function init(strumenti) { u = strumenti; }

const filtri = { q: '', categoria: '' };

async function datiMagazzino() {
  const [articoli, bolle, inventari] = await Promise.all([u.db.tutti('articolo'), u.db.tutti('bolla'), u.db.tutti('inventario')]);
  articoli.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return { articoli, bolle, inventari, cotte: u.stato.cotte };
}
// data di scadenza colorata: rossa se passata, arancione entro GIORNI_IN_SCADENZA giorni
function scad(data) {
  if (!data) return '—';
  const st = statoScadenza(data, u.oggiISO());
  return u.html`<span class="scad ${st || ''}" title="${st === 'scaduto' ? 'Scaduto' : st === 'vicino' ? `Scade entro ${GIORNI_IN_SCADENZA} giorni` : ''}">${u.dataIT(data)}</span>`;
}
const fmt = (n, unita) => `${u.numIT(n, unita === 'kg' || unita === 'L' ? 1 : 0)} ${unita}`;
// da quando cercare ingredienti non collegati: primo inventario, altrimenti 3 mesi fa
const inizioControllo = inventari => [...inventari].map(i => i.data).filter(Boolean).sort()[0] || u.addGiorni(u.oggiISO(), -90);

// ---------- elenco giacenze ----------
export async function vistaMagazzino() {
  const { html, raw } = u;
  const dati = await datiMagazzino();
  const g = giacenze(dati);
  const q = chiaveNome(filtri.q);
  const righe = [...g.values()].filter(x => (!filtri.categoria || x.articolo.categoria === filtri.categoria)
    && (!q || chiaveNome(x.articolo.nome).includes(q) || (x.articolo.alias || []).some(a => chiaveNome(a).includes(q))));
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
      <a class="btn primario" href="#/bolla/nuova">+ Bolla di carico</a>
    </div>
    ${!dati.articoli.length ? html`<div class="scheda"><h2>Per iniziare</h2>
      <p>Crea gli articoli partendo dagli ingredienti delle cotte degli ultimi 12 mesi, poi fai l'inventario iniziale con le quantità che hai in magazzino. Le cotte già fatte prima della creazione dell'articolo o dell'inventario non vengono scaricate.</p>
      <button class="primario" id="da-ricette">Crea articoli dalle ricette</button></div>` : ''}
    ${dati.articoli.length ? html`<div class="barra">
      <input id="q" type="search" placeholder="Cerca articolo…" value="${filtri.q}" style="flex:2;min-width:180px">
      <select id="cat" style="flex:1;min-width:140px"><option value="">Tutte le categorie</option>
        ${Object.entries(CATEGORIE).map(([k, v]) => html`<option value="${k}" ${k === filtri.categoria ? 'selected' : ''}>${v}</option>`)}</select>
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
  `;
  const $ = s => document.getElementById(s);
  $('q')?.addEventListener('input', e => { filtri.q = e.target.value; vistaMagazzino().then(() => { const el = $('q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); });
  $('cat')?.addEventListener('change', e => { filtri.categoria = e.target.value; vistaMagazzino(); });
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
function dialogArticolo(pre) {
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
  d.addEventListener('close', async () => {
    d.remove();
    if (d.returnValue !== 'ok') return;
    const fd = new FormData(d.querySelector('form'));
    const nome = String(fd.get('nome') || '').trim();
    if (!nome) return;
    const rec = await u.db.salva({
      tipo: 'articolo', id: u.db.nuovoId('articolo'), nome, categoria: fd.get('categoria'), unita: fd.get('unita'),
      scortaMin: Number(fd.get('scortaMin')) || 0, alias: pre.alias || [], creato: u.oggiISO(),
    });
    location.hash = `#/materia/${encodeURIComponent(rec.id)}`;
  });
  d.showModal();
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
        <label style="grid-column:1/-1">Altri nomi nelle schede cotta (separati da virgola)
          <input name="alias" value="${(a.alias || []).join(', ')}" placeholder="es. Pils Schuemma, pils shuema"></label>
      </div>
      <div class="barra" style="margin-top:12px;margin-bottom:0"><span class="spazio"></span><button class="primario">Salva</button></div>
    </form>
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
            ? html`<a href="#/bolla/${encodeURIComponent(m.id)}">${m.rif}</a>${m.lotto ? ` · lotto ${m.lotto}` : ''}${m.scadenza ? ` · scad. ${u.dataIT(m.scadenza)}` : ''}`
            : html`<a href="#/cotta/${encodeURIComponent(m.id)}">${m.rif}</a> <span class="totale">${m.nome}${m.futuro ? ' · da fare' : ''}</span>`}</td>
          <td class="n">${m.tipo === 'inventario' ? '= ' : m.qta > 0 ? '+' : ''}${fmt(m.qta, a.unita)}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="totale">Nessun movimento: fai l'inventario o carica una bolla.</p>`}
    </div>`;
  document.getElementById('f-art').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await u.db.salva({
      ...a, nome: String(fd.get('nome')).trim(), categoria: fd.get('categoria'), unita: fd.get('unita'),
      scortaMin: Number(fd.get('scortaMin')) || 0,
      alias: String(fd.get('alias') || '').split(',').map(s => s.trim()).filter(Boolean),
    });
    u.toast('Articolo salvato');
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

  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span>
        ${esistente ? html`<button class="pericolo" id="elimina">Elimina bolla</button>` : ''}</div>
      <div class="scheda">
        <h1 style="margin-top:0">${esistente ? 'Bolla di carico' : 'Nuova bolla di carico'}</h1>
        <div class="griglia">
          <label>Data <input type="date" data-b="data" value="${b.data || ''}"></label>
          <label style="grid-column:span 2">Fornitore <input data-b="fornitore" list="dl-forn" value="${b.fornitore || ''}"></label>
          <label>N° bolla / DDT <input data-b="numero" value="${b.numero || ''}"></label>
        </div>
        <datalist id="dl-forn">${fornitori.map(f => html`<option value="${f}">`)}</datalist>
        <datalist id="dl-art">${dati.articoli.map(a => html`<option value="${a.nome}">`)}</datalist>
      </div>
      <div class="scheda"><h2>Righe</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th>Articolo</th><th style="width:130px">Categoria (se nuovo)</th><th style="width:100px">Quantità</th><th style="width:80px">Unità</th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th><th></th></tr></thead>
          <tbody>${b.righe.map((r, i) => {
            const art = dati.articoli.find(a => a.nome.toLowerCase() === String(r.nome || '').trim().toLowerCase());
            return html`<tr>
              <td><input data-r="${i}.nome" list="dl-art" value="${r.nome || ''}" style="min-width:160px"></td>
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
    if (t.dataset.b) b[t.dataset.b] = t.value;
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      b.righe[i][k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
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
      const righe = b.righe.filter(r => String(r.nome || '').trim() && Number(r.qta) > 0);
      if (!b.data || !righe.length) return u.toast('Servono la data e almeno una riga con articolo e quantità');
      const nuovi = [];
      const out = righe.map(r => {
        const nome = String(r.nome).trim();
        let art = dati.articoli.find(a => a.nome.toLowerCase() === nome.toLowerCase()) || nuovi.find(a => a.nome.toLowerCase() === nome.toLowerCase());
        if (!art) {
          art = { tipo: 'articolo', id: u.db.nuovoId('articolo'), nome, categoria: r.categoria || 'malto', unita: r.unita || 'kg', scortaMin: 0, alias: [], creato: [b.data, u.oggiISO()].sort()[0] };
          nuovi.push(art);
        }
        return { articoloId: art.id, nome: art.nome, qta: Number(r.qta), unita: r.unita || art.unita, lotto: String(r.lotto || '').trim(), scadenza: r.scadenza || '' };
      });
      if (nuovi.length) await u.db.salvaMolti(nuovi);
      await u.db.salva({ ...b, id: b.id || u.db.nuovoId('bolla'), righe: out });
      u.toast(`Bolla salvata${nuovi.length ? ` · ${nuovi.length} articoli nuovi` : ''}`);
      location.hash = '#/materie-prime';
    }
  };
}

// ---------- inventario ----------
export async function vistaInventario() {
  const { html } = u;
  const dati = await datiMagazzino();
  const g = giacenze(dati);
  const data = { v: u.oggiISO() };
  const contati = new Map();
  const extre = new Map(); // lotto e scadenza facoltativi per articolo
  const extra = id => { if (!extre.has(id)) extre.set(id, {}); return extre.get(id); };
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><span class="spazio"></span></div>
    <div class="scheda">
      <h1 style="margin-top:0">Inventario</h1>
      <p class="totale">Scrivi la quantità contata solo per gli articoli che hai controllato: da quella data la giacenza riparte da lì, poi si aggiungono le bolle e si tolgono cotte e DH. Gli articoli lasciati vuoti non cambiano.</p>
      <label style="max-width:200px">Data inventario <input type="date" id="data-inv" value="${data.v}"></label>
    </div>
    ${!dati.articoli.length ? html`<p class="vuoto">Nessun articolo. <a href="#/materie-prime">Crea prima gli articoli</a>.</p>` : ''}
    ${Object.entries(CATEGORIE).map(([cat, titolo]) => {
      const rr = dati.articoli.filter(a => a.categoria === cat);
      if (!rr.length) return '';
      return html`<div class="scheda"><h2>${titolo}</h2><div class="scroll-x"><table class="tab-edit">
        <thead><tr><th>Articolo</th><th class="n">Calcolato oggi</th><th style="width:130px">Contato</th><th style="width:50px"></th><th style="width:130px">Lotto (facolt.)</th><th style="width:140px">Scadenza (facolt.)</th></tr></thead>
        <tbody>${rr.map(a => html`<tr>
          <td>${a.nome}</td><td class="n">${fmt(g.get(a.id).giacenza, a.unita)}</td>
          <td><input data-inv="${a.id}" type="number" step="any" inputmode="decimal"></td><td class="totale">${a.unita}</td>
          <td><input data-lotto="${a.id}"></td><td><input data-scad="${a.id}" type="date"></td>
        </tr>`)}</tbody></table></div></div>`;
    })}
    ${dati.articoli.length ? html`<div class="barra"><span class="spazio"></span><button class="primario" id="salva-inv">Salva inventario</button></div>` : ''}`;
  u.$app.oninput = e => {
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
