// Pagina Packaging (#/contenitori, era "Contenitori"): magazzino di lattine vuote, fusti vuoti, etichette delle lattine, coperchi e cartoni.
// Entrano con i carichi (acquisti, rientri), escono da soli con il Confezionamento delle cotte
// e con gli scarichi a mano (scarti, ceduti). Inventario per rimettere i conti a posto.
// Le fatture dei fornitori importate di notte da Fatture in Cloud con righe di vuoti si confermano qui
// (la prima volta: poi il server le carica da solo). Lotti dei vuoti per la rintracciabilità HACCP.
// Route: #/contenitori, #/contenitore/<id>, #/movcontenitore/<id|carico|scarico>, #/contenitori-inventario

import {
  CATEGORIE_CONT, MOTIVI_CARICO, MOTIVI_SCARICO, categoriaDaFormato, contenitoriProposti, formatiDi, formatiUsati,
  caricoDaFattura, chiaveRiga, etichettaDaAggiornare, etichettaPerBirra, regolaCartone, fabbisognoContenitori, nuovaEtichetta, giacenzeContenitori, nomeFormato, nomeMotivoCont, perCottaDi, righeVuoti, usiConfezionamento,
} from './contenitori.js';

let u; // { $app, html, db, toast, chiedi, stato, dataIT, numIT, oggiISO }  stato.beerfirm = elenco dei beerfirm
export function init(strumenti) { u = strumenti; }

const ICONA = { lattina: '🥫', fusto: '🛢️', etichetta: '🏷️', altro: '📦' };
const pz = n => `${u.numIT(n, 0)} pz`;

async function dati() {
  const [tutti, movimenti, inventari, sospesi] = await Promise.all(['contenitore', 'movcontenitore', 'inventariocontenitori', 'importsospeso'].map(t => u.db.tutti(t)));
  // etichette create con 1 a lattina: ora 1 ogni cartone da 12 (Romain 2026-10-21), si salva una volta
  const vecchie = tutti.filter(etichettaDaAggiornare);
  if (vecchie.length) try { await u.db.salvaMolti(vecchie.map(({ aggiornato: _a, ...k }) => regolaCartone(k))); } catch { /* sola lettura */ }
  const contenitori = tutti.map(regolaCartone);
  contenitori.sort((a, b) => Object.keys(CATEGORIE_CONT).indexOf(a.categoria) - Object.keys(CATEGORIE_CONT).indexOf(b.categoria) || a.nome.localeCompare(b.nome, 'it', { numeric: true }));
  // fatture dei fornitori con righe che sembrano vuoti, non ancora guardate qui
  const fatture = sospesi.filter(x => x.fonte === 'acquisti' && !x.vuotiVisti && x.doc)
    .map(x => ({ x, ...righeVuoti(x.doc, contenitori) })).filter(f => f.proposte.length || f.sicure.length);
  return { contenitori, movimenti, inventari, fatture, cotte: u.stato.cotte };
}
const pezziMov = m => (m.righe || []).reduce((t, r) => t + (Number(r.pezzi) || 0), 0);
// "≈ 2,5 bancali" quando il contenitore ha i pezzi per confezione
const testoConfezioni = (g) => (g.confezioni !== null ? ` · ≈ ${u.numIT(g.confezioni, g.confezioni < 10 ? 1 : 0)} conf. da ${u.numIT(g.contenitore.pezziConfezione, 0)}` : '');
function testoCopertura(g) {
  if (g.giorni === null) return g.consumo ? '' : 'nessun confezionamento negli ultimi 90 giorni';
  const sett = Math.floor(g.giorni / 7);
  return `bastano per circa ${g.giorni < 14 ? `${g.giorni} giorni` : `${sett} settimane`}`;
}

// ---------- pagina principale ----------
export async function vistaContenitori() {
  const { html } = u;
  const d = await dati();
  const oggi = u.oggiISO();
  const g = giacenzeContenitori(d, oggi);
  // vuoti che servono per le cotte da confezionare nei prossimi 20 giorni
  const fab = fabbisognoContenitori({ ...d, durate: u.stato.durate, beerfirm: u.stato.beerfirm }, oggi);
  const lista = d.contenitori.map(k => ({ ...g.get(k.id), servono: fab.servono.get(k.id) || 0 })).map(x => ({ ...x, mancano: Math.max(0, x.servono - Math.max(0, x.giacenza)) }));
  const tot = cat => lista.filter(x => x.contenitore.categoria === cat).reduce((t, x) => t + Math.max(0, x.giacenza), 0);
  const sotto = lista.filter(x => x.mancano > 0);
  // birre in lattina in arrivo senza le loro etichette in Packaging
  const senzaEtichetta = [...new Set(fab.cotte.filter(x => !x.sacca).map(x => x.cotta.birra.trim()))]
    .filter(b => !d.contenitori.some(k => !k.eliminato && etichettaPerBirra(k, b)));
  // ultimi movimenti: a mano e confezionamenti delle cotte, insieme
  // solo quelli che contano (dal giorno in cui il contenitore è stato creato)
  const creato = new Map(d.contenitori.map(k => [k.id, k.creato || '']));
  const usi = usiConfezionamento(d.cotte, d.contenitori).filter(x => x.data <= oggi && x.data >= creato.get(x.contenitoreId));
  const perCotta = new Map();
  for (const x of usi) {
    const k = `${x.cotta.id}|${x.data}`;
    const r = perCotta.get(k) || { tipo: 'conf', data: x.data, cotta: x.cotta, righe: [] };
    r.righe.push(x);
    perCotta.set(k, r);
  }
  const nomeDi = id => d.contenitori.find(k => k.id === id)?.nome || 'contenitore eliminato';
  const ultimi = [...d.movimenti.map(m => ({ tipo: 'mov', data: m.data, m })), ...perCotta.values()]
    .sort((a, b) => b.data.localeCompare(a.data)).slice(0, 15);

  u.$app.innerHTML = html`
    <div class="barra">
      <h1 style="margin:0">Packaging</h1><span class="spazio"></span>
      <a class="btn solo-editori" href="#/movcontenitore/carico">+ Carico</a>
      <a class="btn solo-editori" href="#/movcontenitore/scarico">− Scarico</a>
      <a class="btn solo-editori" href="#/contenitori-inventario">📋 Inventario</a>
      <button class="solo-editori" id="cn-nuovo">+ Nuovo articolo</button>
    </div>
    <p class="totale">Lattine e polykeg vuoti, etichette delle lattine (una per birra) e, se vuoi, coperchi o cartoni. Entrano con i carichi (a mano o dalle fatture di Fatture in Cloud), escono da soli quando scrivi il confezionamento nella scheda cotta.</p>

    ${d.contenitori.length ? html`<div class="st-kpi">
      <div class="st-tile"><span>Lattine vuote</span><b>${u.numIT(tot('lattina'), 0)}</b><small>in magazzino</small></div>
      <div class="st-tile"><span>Fusti vuoti</span><b>${u.numIT(tot('fusto'), 0)}</b><small>in magazzino</small></div>
      ${d.contenitori.some(k => k.categoria === 'etichetta') ? html`<div class="st-tile"><span>Etichette lattine</span><b>${u.numIT(tot('etichetta'), 0)}</b><small>in magazzino</small></div>` : ''}
      <div class="st-tile ${sotto.length ? 'allerta' : ''}"><span>Da ordinare per i prossimi ${fab.giorni} giorni</span><b>${sotto.length}</b><small>${sotto.length ? sotto.map(x => `${x.contenitore.nome}: mancano ${u.numIT(x.mancano, 0)}`).join(' · ') : 'bastano per le cotte in arrivo'}</small></div>
    </div>
    <details class="scheda cn-fab"><summary><b>${fab.cotte.length ? `${fab.cotte.length} ${fab.cotte.length === 1 ? 'cotta' : 'cotte'} da confezionare entro il ${u.dataIT(fab.cotte.at(-1).fine)}` : `Nessuna cotta da confezionare nei prossimi ${fab.giorni} giorni`}</b></summary>
      ${fab.cotte.length ? html`<ul class="w-lista">${fab.cotte.map(x => html`<li><a href="#/cotta/${encodeURIComponent(x.cotta.id)}"><span class="w-testo"><b>${x.cotta.birra} ${x.cotta.lotto || ''}</b>${x.cotta.beerfirm ? html` <span class="bf-chip">${x.cotta.beerfirm}</span>` : ''}
        <small>fine in FV ${u.dataIT(x.fine)} · ${x.sacca ? 'polykeg con sacca' : 'polykeg e lattine'}</small></span></a></li>`)}</ul>` : ''}
      <p class="totale">Per ogni cotta che finisce in FV nei prossimi ${fab.giorni} giorni (o negli ultimi 7 senza confezionamento): ${d.contenitori.filter(k => k.categoria !== 'etichetta').map(k => { const p = perCottaDi(k); return [p.normale && `${p.normale} ${k.nome}`, p.sacca && `${p.sacca} ${k.nome} per Nitro e beerfirm con sacca`].filter(Boolean).join(', '); }).filter(Boolean).join(' · ') || 'nessun numero impostato'}${d.contenitori.some(k => k.categoria === 'etichetta') ? ' · le etichette della sua birra (1 a lattina + 1 per cartone da 12: 867, non per Nitro e beerfirm con sacca)' : ''}. Si cambia nella scheda di ogni articolo.</p>
    </details>` : html`<div class="scheda avviso solo-editori"><h2>Per iniziare</h2>
      <p>Crea un contenitore per ogni cosa da contare (lattine, polykeg, ma anche coperchi o cartoni se vuoi). Ogni contenitore si collega ai formati del Confezionamento: quando confezioni una cotta in quel formato, i vuoti si scalano da soli. Per i polykeg 24 L (riempiti a 25 L) con e senza sacca scegli quale hai usato nella riga del Confezionamento.
      Poi fai l'inventario di quello che hai oggi in magazzino.</p>
      <div class="barra" style="margin:0"><button class="primario" id="cn-proponi">Crea i nostri: ${contenitoriProposti().map(x => x.nome).join(', ')}</button></div>
    </div>`}

    ${senzaEtichetta.length ? html`<div class="scheda solo-editori" id="cn-senza-et"><h2>🏷️ Etichette da aggiungere</h2>
      <p class="totale">Birre in lattina nei prossimi ${fab.giorni} giorni che non hanno ancora le loro etichette in Packaging. Creale e fai un carico o l'inventario.</p>
      <div class="barra" style="margin:0">${senzaEtichetta.map(b => html`<button class="piccolo" data-crea-et="${b}">+ Etichette ${b}</button>`)}</div>
    </div>` : ''}

    ${d.fatture.length ? html`<div class="scheda solo-editori" id="cn-fatture"><h2>📥 Fatture dei fornitori con packaging <span class="totale">da Fatture in Cloud</span></h2>
      <p class="totale">Righe di lattine, fusti o etichette trovate nelle fatture importate di notte. Controlla contenitore, pezzi e lotto e carica: la volta dopo le stesse righe dello stesso fornitore entrano da sole.</p>
      <ul class="w-lista">${d.fatture.map(f => html`<li class="acq-riga"><span class="w-testo"><b>${f.x.doc.fornitore || 'Fornitore'}</b> · ${f.x.doc.numero || ''} · ${u.dataIT(f.x.doc.data)}
        <small>${[...f.sicure, ...f.proposte].map(r => `${u.numIT(r.qta, 0)} ${r.um || ''} ${r.descrizione}`).join(' · ')}</small></span>
        <span class="barra" style="margin:0"><button class="piccolo primario" data-fatt="${f.x.id}">Carica</button><button class="piccolo" data-fatt-no="${f.x.id}" title="Non è packaging: la fattura resta in Materie prime">Non è packaging</button></span></li>`)}</ul>
    </div>` : ''}

    ${Object.entries(CATEGORIE_CONT).map(([cat, nomeCat]) => {
      const qui = lista.filter(x => x.contenitore.categoria === cat);
      if (!qui.length) return '';
      return html`<section class="b-card cn-card"><header><h2>${nomeCat}</h2><span class="b-tot">${u.numIT(qui.reduce((t, x) => t + Math.max(0, x.giacenza), 0), 0)} pz</span></header>
        ${qui.map(x => html`<a class="b-formato ${x.giacenza < 0 ? 'neg' : ''} ${x.giacenza === 0 ? 'zero' : ''}" href="#/contenitore/${encodeURIComponent(x.contenitore.id)}">
          <span class="b-icona" aria-hidden="true">${ICONA[cat]}</span>
          <span class="b-nome">${x.contenitore.nome}
            <span class="b-lotti">${x.lotti.filter(l => l.lotto && l.pezzi > 0).map(l => html`<span class="b-lotto" title="${[l.fornitore, l.documento, l.arrivo && `arrivato il ${u.dataIT(l.arrivo)}`].filter(Boolean).join(' · ')}">${l.lotto} <b>${u.numIT(l.pezzi, 0)}</b></span>`)}<span class="totale">${formatiDi(x.contenitore).length ? `scala con ${formatiDi(x.contenitore).map(f => nomeFormato(f).replace(/^\w/, ch => ch.toLowerCase())).join(', ')}${Number(x.contenitore.ogni) > 1 ? ` (1 ogni ${x.contenitore.ogni})` : ''}${Number(x.contenitore.cartone) > 0 ? ` + 1 per cartone da ${x.contenitore.cartone}` : ''}` : 'solo movimenti a mano'}${x.consumo ? ` · ${u.numIT(x.consumo, 0)} usati in 90 gg, ${testoCopertura(x)}` : ''}</span></span></span>
          <span class="b-num"><b>${u.numIT(x.giacenza, 0)}</b><small>pz${testoConfezioni(x)}</small>${x.servono ? html`<span class="b-scad ${x.mancano ? 'scaduto' : ''}" title="Servono ${u.numIT(x.servono, 0)} per le cotte dei prossimi ${fab.giorni} giorni">${x.mancano ? `mancano ${u.numIT(x.mancano, 0)}` : `servono ${u.numIT(x.servono, 0)}`}</span>` : ''}</span>
        </a>`)}
      </section>`;
    })}

    ${ultimi.length ? html`<div class="scheda b-movimenti"><h2 style="margin:0 0 8px">Ultimi movimenti</h2>
      ${ultimi.map(r => (r.tipo === 'mov'
        ? html`<a class="b-mov ${r.m.verso === 'carico' ? 'carico' : 'scarico'}" href="#/movcontenitore/${encodeURIComponent(r.m.id)}">
          <span class="b-mov-segno" aria-hidden="true">${r.m.verso === 'carico' ? '+' : '−'}</span>
          <span class="b-mov-testo"><b>${nomeMotivoCont(r.m)}</b>${[r.m.fornitore, r.m.documento].filter(Boolean).length ? html` <span class="totale">· ${[r.m.fornitore, r.m.documento].filter(Boolean).join(' · ')}</span>` : ''}
            <small>${u.dataIT(r.m.data)} · ${(r.m.righe || []).map(x => `${x.pezzi} ${nomeDi(x.contenitoreId)}`).join(', ')}</small></span>
          <span class="b-mov-pz">${r.m.verso === 'carico' ? '+' : '−'}${u.numIT(pezziMov(r.m), 0)} pz</span></a>`
        : html`<a class="b-mov scarico" href="#/cotta/${encodeURIComponent(r.cotta.id)}">
          <span class="b-mov-segno" aria-hidden="true">−</span>
          <span class="b-mov-testo"><b>Confezionamento</b> <span class="totale">· ${r.cotta.birra} ${r.cotta.lotto || ''}</span>
            <small>${u.dataIT(r.data)} · ${r.righe.map(x => `${x.pezzi} ${nomeDi(x.contenitoreId)}`).join(', ')}</small></span>
          <span class="b-mov-pz">−${u.numIT(r.righe.reduce((t, x) => t + x.pezzi, 0), 0)} pz</span></a>`))}
    </div>` : ''}`;

  const $ = s => document.getElementById(s);
  if ($('cn-fatture')) $('cn-fatture').onclick = async e => {
    const b = e.target.closest('[data-fatt], [data-fatt-no]');
    if (!b) return;
    const f = d.fatture.find(x => x.x.id === (b.dataset.fatt || b.dataset.fattNo));
    if (b.dataset.fattNo) {
      const { aggiornato: _a, ...rec } = f.x;
      // materie prime già caricate dalla stessa fattura: non resta niente da fare
      if (rec.mpFatte) await u.db.elimina(rec.id); else await u.db.salva({ ...rec, vuotiVisti: true });
      return vistaContenitori();
    }
    dialogFattura(d, f);
  };
  if ($('cn-nuovo')) $('cn-nuovo').onclick = () => dialogContenitore(d);
  if ($('cn-senza-et')) $('cn-senza-et').onclick = async e => {
    const b = e.target.closest('[data-crea-et]');
    if (!b) return;
    const rec = await u.db.salva({ ...nuovaEtichetta(b.dataset.creaEt), id: u.db.nuovoId('contenitore'), tipo: 'contenitore', creato: oggi });
    u.toast(`${rec.nome}: creato`);
    vistaContenitori();
  };
  if ($('cn-proponi')) $('cn-proponi').onclick = async () => {
    const nuovi = contenitoriProposti().map(x => ({ ...x, id: u.db.nuovoId('contenitore'), tipo: 'contenitore', creato: oggi }));
    await u.db.salvaMolti(nuovi);
    u.toast(`${nuovi.length} contenitori creati: ora fai l'inventario`);
    location.hash = '#/contenitori-inventario';
  };
}

// ---------- carico da una fattura del fornitore ----------
function dialogFattura(d, f) {
  const { html } = u;
  const righe = [...f.sicure, ...f.proposte].map(r => ({ ...r, propostoId: r.contenitoreId, lotto: '' }));
  const dlg = document.createElement('dialog');
  dlg.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">${f.x.doc.fornitore || 'Fornitore'} · ${f.x.doc.numero || ''}</h2>
    <p class="totale">Fattura del ${u.dataIT(f.x.doc.data)}. "Pezzi per unità": quante lattine o fusti sono 1 ${righe.some(r => r.um) ? 'unità della fattura (es. 1 bancale = 8.000 lattine)' : 'quantità della fattura'}. Il lotto è sulla bolla o sull'imballo.</p>
    <div class="scroll-x"><table class="tab-edit">
      <thead><tr><th>Riga della fattura</th><th>Contenitore</th><th style="width:90px">Pezzi per unità</th><th style="width:120px">Lotto</th></tr></thead>
      <tbody>${righe.map((r, i) => html`<tr><td>${u.numIT(r.qta, 0)} ${r.um || ''} ${r.descrizione}</td>
        <td><select name="k${i}"><option value="">non è packaging</option>${d.contenitori.map(k => html`<option value="${k.id}" ${k.id === r.contenitoreId ? 'selected' : ''}>${k.nome}</option>`)}</select></td>
        <td><input name="x${i}" type="number" min="1" step="1" inputmode="numeric" value="${r.x}"></td>
        <td><input name="l${i}" value=""></td></tr>`)}</tbody></table></div>
    <div class="barra" style="margin-top:14px"><span class="spazio"></span><button value="no" formnovalidate>Annulla</button><button class="primario" value="ok">Carica</button></div>
  </form>`.s;
  document.body.appendChild(dlg);
  const fm = dlg.querySelector('form');
  dlg.addEventListener('close', async () => {
    dlg.remove();
    if (dlg.returnValue !== 'ok') return;
    righe.forEach((r, i) => { r.contenitoreId = fm[`k${i}`].value; r.x = Math.max(1, Number(fm[`x${i}`].value) || 1); r.lotto = fm[`l${i}`].value.trim(); });
    const vuoti = righe.filter(r => r.contenitoreId);
    // impara: la stessa riga (codice o descrizione) la prossima volta va da sola, oppure si ignora
    const perK = new Map();
    for (const r of righe) {
      const ch = chiaveRiga(r);
      if (!ch) continue;
      const kid = r.contenitoreId || r.propostoId;
      const lista = perK.get(kid) || [];
      lista.push(r.contenitoreId ? { chiave: ch, x: r.x } : { chiave: ch, ignora: true });
      perK.set(kid, lista);
    }
    const aggiornati = d.contenitori.filter(k => perK.has(k.id)).map(({ aggiornato: _a, ...k }) => {
      const nuove = perK.get(k.id);
      return { ...k, codici: [...(k.codici || []).filter(c => !nuove.some(n => n.chiave === c.chiave)), ...nuove] };
    });
    if (aggiornati.length) await u.db.salvaMolti(aggiornati);
    if (vuoti.length) {
      const mov = caricoDaFattura(f.x.doc, vuoti, f.x.rifEsterno);
      await u.db.salva({ ...mov, id: u.db.nuovoId('movcontenitore') });
    }
    // dalla fattura in Materie prime tolgo le righe caricate qui; se non resta niente la fattura sparisce
    const caricate = new Set(vuoti.map(r => chiaveRiga(r)));
    const resto = f.x.doc.righe.filter(r => !caricate.has(chiaveRiga(r)));
    const { aggiornato: _a, ...rec } = f.x;
    if (resto.length && !rec.mpFatte) await u.db.salva({ ...rec, vuotiVisti: true, doc: { ...rec.doc, righe: resto } });
    else await u.db.elimina(f.x.id);
    u.toast(vuoti.length ? `Caricate ${vuoti.length === 1 ? '1 riga' : `${vuoti.length} righe`} da ${f.x.doc.fornitore || 'fattura'}` : 'Fattura segnata: niente packaging');
    vistaContenitori();
  });
  dlg.showModal();
}

// ---------- nuovo / modifica contenitore ----------
function campiContenitore(k, formati) {
  const { html } = u;
  const miei = formatiDi(k);
  const fs = [...new Set([...formati, ...miei])];
  return html`<div class="griglia">
    <label style="grid-column:1/-1">Nome <input name="nome" required value="${k.nome || ''}" placeholder="es. Lattine 0,33 L, Fusti 24 L, Coperchi"></label>
    <label>Tipo <select name="categoria">${Object.entries(CATEGORIE_CONT).map(([c, v]) => html`<option value="${c}" ${c === (k.categoria || 'lattina') ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="cn-birra" ${k.categoria === 'etichetta' ? '' : 'hidden'}>Birra <input name="birra" list="cn-birre" value="${k.birra || ''}" placeholder="come nella cotta" title="Si scala con il confezionamento in lattina delle cotte di questa birra"></label>
    <label class="cn-birra" ${k.categoria === 'etichetta' ? '' : 'hidden'}>Più 1 per cartone da … lattine <input name="cartone" type="number" min="0" step="1" inputmode="numeric" value="${k.cartone ?? 12}" title="Etichetta del cartone, oltre a quella di ogni lattina. 0 = niente cartone"></label>
    <datalist id="cn-birre">${birreNote().map(b => html`<option value="${b}">`)}</datalist>
    <fieldset class="cn-formati" style="grid-column:1/-1"><legend>Si scala con il confezionamento di (nessuno = solo a mano)</legend>
      ${fs.map(f => html`<label class="spunta"><input type="checkbox" name="formati" value="${f}" ${miei.includes(f) ? 'checked' : ''}> ${nomeFormato(f)}</label>`)}</fieldset>
    <label>Uno ogni … pezzi confezionati <input name="ogni" type="number" min="1" step="1" inputmode="numeric" value="${k.ogni || 1}" title="1 per lattine, fusti e coperchi; 12 per i cartoni da 12"></label>
    <label>Servono per cotta <input name="perCotta" type="number" min="0" step="1" inputmode="numeric" value="${perCottaDi(k).normale || ''}" title="Pezzi per ogni cotta da confezionare (es. 30 polykeg, 800 lattine)"></label>
    <label>Per cotta Nitro / beerfirm con sacca <input name="perCottaSacca" type="number" min="0" step="1" inputmode="numeric" value="${perCottaDi(k).sacca || ''}" title="Es. 40 polykeg con sacca"></label>
    <label>Pezzi per bancale/confezione <input name="pezziConfezione" type="number" min="0" step="1" inputmode="numeric" value="${k.pezziConfezione || ''}" placeholder="facoltativo"></label>
    <label style="grid-column:1/-1">Note <input name="note" value="${k.note || ''}" placeholder="fornitore, codice, colore…"></label>
  </div>`;
}
// nomi delle birre delle cotte, per scegliere la birra di un'etichetta
const birreNote = () => [...new Set(u.stato.cotte.filter(c => !c.eliminato && c.birra).map(c => c.birra.trim()))].sort((a, b) => a.localeCompare(b, 'it'));
// la birra si chiede solo per le etichette
function campoBirra(f) {
  f.categoria.addEventListener('change', () => { f.querySelectorAll('.cn-birra').forEach(lab => { lab.hidden = f.categoria.value !== 'etichetta'; }); });
}
const leggiCampi = f => ({
  nome: f.nome.value.trim(), categoria: f.categoria.value, birra: f.categoria.value === 'etichetta' ? f.birra.value.trim() : '', cartone: f.categoria.value === 'etichetta' ? Math.max(0, Math.round(Number(f.cartone.value) || 0)) : undefined, formati: [...f.querySelectorAll('[name="formati"]:checked')].map(x => x.value), formato: undefined,
  ogni: Math.max(1, Math.round(Number(f.ogni.value) || 1)), perCotta: Number(f.perCotta.value) || 0, perCottaSacca: Number(f.perCottaSacca.value) || 0,
  pezziConfezione: Number(f.pezziConfezione.value) || null, note: f.note.value.trim(),
});

function dialogContenitore(d) {
  const { html } = u;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">Nuovo articolo</h2>
    ${campiContenitore({}, formatiUsati(d.cotte))}
    <p class="totale">Si conta da oggi: per partire dal numero giusto fai l'inventario o un carico.</p>
    <div class="barra" style="margin-top:14px"><span class="spazio"></span><button value="no" formnovalidate>Annulla</button><button class="primario" value="ok">Crea</button></div>
  </form>`.s;
  document.body.appendChild(dlg);
  const f = dlg.querySelector('form');
  // il formato propone il tipo
  f.querySelector('.cn-formati').onchange = e => { if (e.target.checked && !['altro', 'etichetta'].includes(f.categoria.value)) f.categoria.value = categoriaDaFormato(e.target.value); };
  campoBirra(f);
  const proponi = () => {
    if (f.categoria.value !== 'etichetta') return;
    const e = nuovaEtichetta(f.birra.value || '');
    f.querySelectorAll('[name="formati"]').forEach(x => { x.checked = e.formati.includes(x.value); });
    f.ogni.value = e.ogni;
    f.cartone.value = e.cartone;
    if (!f.perCotta.value || f.perCotta.value === '800') f.perCotta.value = e.perCotta;
    if (f.birra.value && (!f.nome.value || /^Etichette /.test(f.nome.value))) f.nome.value = e.nome;
  };
  f.categoria.addEventListener('change', proponi);
  f.birra.addEventListener('change', proponi);
  dlg.addEventListener('close', async () => {
    dlg.remove();
    if (dlg.returnValue !== 'ok') return;
    const c = leggiCampi(f);
    if (!c.nome) return;
    if (c.categoria === 'etichetta' && !c.birra) return u.toast('Scegli la birra dell\'etichetta');
    const rec = await u.db.salva({ ...c, id: u.db.nuovoId('contenitore'), tipo: 'contenitore', creato: u.oggiISO() });
    location.hash = `#/contenitore/${encodeURIComponent(rec.id)}`;
  });
  dlg.showModal();
}

// ---------- scheda contenitore: dati e registro ----------
const NOMI_RIGA = { inventario: 'Inventario', carico: 'Carico', scarico: 'Scarico', confezionamento: 'Confezionamento' };
export async function vistaContenitore(id) {
  const { html } = u;
  const d = await dati();
  const k = d.contenitori.find(x => x.id === id);
  if (!k) { u.$app.innerHTML = html`<p class="vuoto">Articolo non trovato. <a href="#/contenitori">Torna a Packaging</a></p>`; return; }
  const g = giacenzeContenitori(d, u.oggiISO()).get(k.id);
  const fab = fabbisognoContenitori({ ...d, durate: u.stato.durate, beerfirm: u.stato.beerfirm }, u.oggiISO());
  const servono = fab.servono.get(k.id) || 0, mancano = Math.max(0, servono - Math.max(0, g.giacenza));
  const righe = g.registro.filter(r => r.conta || r.data > u.oggiISO()).reverse();
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/contenitori" class="btn">← Packaging</a><span class="spazio"></span>
      <a class="btn solo-editori" href="#/movcontenitore/carico?c=${encodeURIComponent(k.id)}">+ Carico</a>
      <a class="btn solo-editori" href="#/movcontenitore/scarico?c=${encodeURIComponent(k.id)}">− Scarico</a></div>
    <h1>${ICONA[k.categoria] || ''} ${k.nome}</h1>
    <div class="st-kpi">
      <div class="st-tile ${mancano ? 'allerta' : ''}"><span>In magazzino</span><b>${pz(g.giacenza)}</b><small>${servono ? `servono ${u.numIT(servono, 0)} per ${fab.cotte.length} ${fab.cotte.length === 1 ? 'cotta' : 'cotte'} dei prossimi ${fab.giorni} giorni${mancano ? `: mancano ${u.numIT(mancano, 0)}` : ''}` : testoConfezioni(g).replace(/^ · /, '') || (g.ultimoInventario ? `inventario del ${u.dataIT(g.ultimoInventario)}` : 'senza inventario')}</small></div>
      <div class="st-tile"><span>Usati in 90 giorni</span><b>${u.numIT(g.consumo, 0)}</b><small>${testoCopertura(g) || 'dai confezionamenti'}</small></div>
    </div>
    ${g.lotti.some(l => l.pezzi > 0) ? html`<div class="scheda"><h2 style="margin-top:0">Lotti in magazzino</h2>
      <table class="tab-mag"><thead><tr><th>Lotto</th><th class="n">Pezzi</th><th>Arrivato</th><th>Fornitore / documento</th></tr></thead>
      <tbody>${g.lotti.filter(l => l.pezzi > 0).map(l => html`<tr><td>${l.lotto || html`<span class="totale">senza lotto</span>`}</td><td class="n">${u.numIT(l.pezzi, 0)}</td><td>${l.arrivo ? u.dataIT(l.arrivo) : ''}</td><td>${[l.fornitore, l.documento].filter(Boolean).join(' · ')}</td></tr>`)}</tbody></table>
      <p class="totale">Confezionamenti e scarichi senza lotto prendono dal lotto arrivato prima.</p></div>` : ''}
    <form class="scheda" id="cn-dati"><h2 style="margin-top:0">Dati</h2>
      ${campiContenitore(k, formatiUsati(d.cotte))}
      <p class="totale">Conta dal ${u.dataIT(k.creato)}${g.ultimoInventario ? ` · ultimo inventario ${u.dataIT(g.ultimoInventario)}` : ''}. I confezionamenti delle cotte prima di quel giorno non scalano.</p>
      <div class="barra solo-editori" style="margin:8px 0 0"><button type="button" class="pericolo" id="cn-elimina">Elimina</button><span class="spazio"></span><button class="primario">Salva</button></div>
    </form>
    <div class="scheda"><h2>Registro</h2>
      ${righe.length ? html`<div class="scroll-x"><table class="tab-mag">
        <thead><tr><th>Data</th><th>Movimento</th><th>Lotti</th><th class="n">Pezzi</th><th class="n">Saldo</th></tr></thead>
        <tbody>${righe.map(r => {
          const link = r.tipo === 'confezionamento' ? `#/cotta/${encodeURIComponent(r.uso.cotta.id)}` : r.tipo === 'inventario' ? '' : `#/movcontenitore/${encodeURIComponent(r.rec.id)}`;
          const testo = r.tipo === 'confezionamento' ? `${r.uso.cotta.birra} ${r.uso.cotta.lotto || ''} · ${r.uso.confezionati} confezionati`
            : r.tipo === 'inventario' ? (r.differenza ? `${r.differenza > 0 ? '+' : ''}${u.numIT(r.differenza, 0)} rispetto al calcolato` : '')
            : [nomeMotivoCont(r.rec), r.rec.fornitore, r.rec.documento].filter(Boolean).join(' · ');
          return html`<tr class="${r.conta ? '' : 'totale'}"><td>${u.dataIT(r.data)}</td>
            <td><b>${NOMI_RIGA[r.tipo]}</b> ${link ? html`<a href="${link}">${testo}</a>` : testo}${r.conta ? '' : html` <small>(futuro, non conta ancora)</small>`}</td>
            <td class="totale">${r.tipo === 'carico' ? r.parti.map(x => x.lotto).filter(Boolean).join(', ') : r.tipo === 'inventario' ? r.lotto : (r.lotti || []).map(x => `${x.lotto || 'senza lotto'} (${u.numIT(x.pezzi, 0)})`).join(', ')}</td>
            <td class="n">${r.tipo === 'inventario' ? `= ${u.numIT(r.pezzi, 0)}` : `${r.pezzi > 0 ? '+' : ''}${u.numIT(r.pezzi, 0)}`}</td>
            <td class="n"><b>${r.saldo === null ? '' : u.numIT(r.saldo, 0)}</b></td></tr>`;
        })}</tbody></table></div>` : html`<p class="vuoto">Nessun movimento.</p>`}
    </div>`;
  const f = document.getElementById('cn-dati');
  campoBirra(f);
  f.onsubmit = async e => {
    e.preventDefault();
    const c = leggiCampi(f);
    if (!c.nome) return u.toast('Scrivi il nome');
    const { aggiornato: _a, ...rec } = k;
    await u.db.salva({ ...rec, ...c });
    u.toast('Salvato');
    vistaContenitore(id);
  };
  document.getElementById('cn-elimina').onclick = async () => {
    if (!(await u.chiedi(`Eliminare "${k.nome}"? I movimenti restano nel registro ma non si vedono più qui.`, 'Elimina'))) return;
    await u.db.elimina(k.id);
    location.hash = '#/contenitori';
  };
}

// ---------- carico / scarico ----------
export async function vistaMovimento(id) {
  const { html } = u;
  const [idPuro, query] = id.split('?');
  const d = await dati();
  const nuovo = idPuro === 'carico' || idPuro === 'scarico';
  const esistente = nuovo ? null : d.movimenti.find(x => x.id === idPuro);
  if (!nuovo && !esistente) { u.$app.innerHTML = html`<p class="vuoto">Movimento non trovato. <a href="#/contenitori">Torna a Packaging</a></p>`; return; }
  if (!d.contenitori.length) { u.$app.innerHTML = html`<p class="vuoto">Prima crea i contenitori. <a href="#/contenitori">Vai a Packaging</a></p>`; return; }
  const pre = new URLSearchParams(query || '').get('c') || '';
  const m = esistente ? JSON.parse(JSON.stringify(esistente))
    : { tipo: 'movcontenitore', verso: idPuro, data: u.oggiISO(), motivo: idPuro === 'carico' ? 'acquisto' : 'scarto', fornitore: '', documento: '', note: '', righe: [{ contenitoreId: pre || d.contenitori[0].id, pezzi: null, lotto: '' }] };
  const carico = () => m.verso === 'carico';
  const g = giacenzeContenitori({ ...d, movimenti: d.movimenti.filter(x => x.id !== m.id) }, u.oggiISO());
  const fornitori = [...new Set(d.movimenti.map(x => x.fornitore).filter(Boolean))].sort();
  const kDi = cid => d.contenitori.find(x => x.id === cid);

  function disegna() {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/contenitori" class="btn">← Packaging</a><span class="spazio"></span>
        ${esistente ? html`<button class="pericolo" id="elimina">Elimina</button>` : ''}</div>
      <div class="scheda">
        <h1 style="margin-top:0">${esistente ? '' : 'Nuovo '}${carico() ? 'carico' : 'scarico'} di vuoti</h1>
        <div class="barra" style="margin:0 0 8px">
          <label class="spunta"><input type="radio" name="verso" value="carico" ${carico() ? 'checked' : ''}> + Carico (entra)</label>
          <label class="spunta"><input type="radio" name="verso" value="scarico" ${carico() ? '' : 'checked'}> − Scarico (esce)</label>
        </div>
        <p class="totale">${carico() ? 'Per i vuoti che arrivano: acquisto dal fornitore, rientro, rettifica.' : 'Per i vuoti che escono senza un confezionamento: scarti, danneggiati, ceduti. Il confezionamento delle cotte li scala da solo.'}</p>
        <div class="griglia">
          <label>Data <input type="date" data-m="data" value="${m.data || ''}"></label>
          <label>Motivo <select data-m="motivo">${Object.entries(carico() ? MOTIVI_CARICO : MOTIVI_SCARICO).map(([k, v]) => html`<option value="${k}" ${k === m.motivo ? 'selected' : ''}>${v}</option>`)}</select></label>
          ${carico() ? html`<label>Fornitore <input data-m="fornitore" list="dl-forn" value="${m.fornitore || ''}"></label>
            <label>Documento (DDT, fattura) <input data-m="documento" value="${m.documento || ''}"></label>` : ''}
          <label style="grid-column:span 2">Note <input data-m="note" value="${m.note || ''}"></label>
        </div>
        <datalist id="dl-forn">${fornitori.map(x => html`<option value="${x}">`)}</datalist>
      </div>
      <div class="scheda"><h2>Righe</h2>
        <div class="scroll-x"><table class="tab-edit">
          <thead><tr><th>Contenitore</th><th class="n">In magazzino</th><th style="width:100px">Confezioni</th><th style="width:110px">Pezzi</th><th style="width:${carico() ? 140 : 220}px">Lotto</th><th></th></tr></thead>
          <tbody>${m.righe.map((r, i) => {
            const k = kDi(r.contenitoreId), perConf = Number(k?.pezziConfezione) || 0;
            return html`<tr>
              <td><select data-r="${i}.contenitoreId" style="min-width:180px">${d.contenitori.map(x => html`<option value="${x.id}" ${x.id === r.contenitoreId ? 'selected' : ''}>${x.nome}</option>`)}</select></td>
              <td class="n totale">${g.get(r.contenitoreId) ? pz(g.get(r.contenitoreId).giacenza) : ''}</td>
              <td>${perConf ? html`<input data-conf="${i}" type="number" min="0" step="any" inputmode="decimal" title="da ${perConf} pezzi" value="${r.pezzi ? Math.round((r.pezzi / perConf) * 100) / 100 : ''}">` : html`<span class="totale" title="Scrivi i pezzi per bancale/confezione nella scheda del contenitore">—</span>`}</td>
              <td><input data-r="${i}.pezzi" type="number" min="0" step="1" inputmode="numeric" value="${r.pezzi ?? ''}"></td>
              <td>${(() => {
                const lotti = (g.get(r.contenitoreId)?.lotti || []).filter(l => l.lotto && l.pezzi > 0);
                return carico() ? html`<input data-r="${i}.lotto" value="${r.lotto || ''}" list="dl-lv-${i}"><datalist id="dl-lv-${i}">${lotti.map(l => html`<option value="${l.lotto}">`)}</datalist>`
                  : html`<select data-r="${i}.lotto"><option value="">Il più vecchio (automatico)</option>${lotti.map(l => html`<option value="${l.lotto}" ${l.lotto === r.lotto ? 'selected' : ''}>${l.lotto} · ${l.pezzi} pz</option>`)}
                    ${r.lotto && !lotti.some(l => l.lotto === r.lotto) ? html`<option value="${r.lotto}" selected>${r.lotto}</option>` : ''}</select>`;
              })()}</td>
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
      for (const r of m.righe) r.lotto = '';
      return disegna();
    }
    if (t.dataset.m) m[t.dataset.m] = t.value;
    if (t.dataset.conf !== undefined) {
      const r = m.righe[Number(t.dataset.conf)];
      r.pezzi = t.value === '' ? null : Math.round(Number(t.value) * (Number(kDi(r.contenitoreId)?.pezziConfezione) || 1));
      const inp = u.$app.querySelector(`[data-r="${t.dataset.conf}.pezzi"]`);
      if (inp) inp.value = r.pezzi ?? '';
    }
    if (t.dataset.r) {
      const [i, k] = t.dataset.r.split('.');
      m.righe[i][k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      if (k === 'contenitoreId' && e.type === 'change') { m.righe[i].lotto = ''; disegna(); }
      if (k === 'pezzi' && e.type === 'change') disegna();
    }
  };
  u.$app.onclick = async e => {
    const t = e.target;
    if (t.id === 'riga') { m.righe.push({ contenitoreId: d.contenitori[0].id, pezzi: null, lotto: '' }); disegna(); }
    else if (t.dataset.del !== undefined) { m.righe.splice(Number(t.dataset.del), 1); disegna(); }
    else if (t.id === 'elimina') {
      if (!(await u.chiedi(carico() ? 'Eliminare questo carico? I pezzi escono dalla giacenza.' : 'Eliminare questo scarico? I pezzi tornano in giacenza.', 'Elimina'))) return;
      await u.db.elimina(esistente.id);
      location.hash = '#/contenitori';
    } else if (t.id === 'salva') {
      const righe = m.righe.filter(r => r.contenitoreId && Number(r.pezzi) > 0).map(r => ({ contenitoreId: r.contenitoreId, pezzi: Math.round(Number(r.pezzi)), lotto: String(r.lotto || '').trim() }));
      if (!m.data || !righe.length) return u.toast('Servono la data e almeno una riga con i pezzi');
      if (!carico()) {
        const troppo = righe.find(r => r.pezzi > (g.get(r.contenitoreId)?.giacenza || 0));
        if (troppo && !(await u.chiedi(`${kDi(troppo.contenitoreId).nome}: in magazzino risultano ${g.get(troppo.contenitoreId)?.giacenza || 0} pezzi, ne stai scaricando ${troppo.pezzi}. Salvare lo stesso?`, 'Salva'))) return;
      }
      const { aggiornato: _a, ...rec } = m;
      await u.db.salva({ ...rec, id: m.id || u.db.nuovoId('movcontenitore'), righe });
      u.toast(carico() ? 'Carico salvato' : 'Scarico salvato');
      location.hash = '#/contenitori';
    }
  };
}

// ---------- inventario ----------
export async function vistaInventario() {
  const { html } = u;
  const d = await dati();
  if (!d.contenitori.length) { u.$app.innerHTML = html`<p class="vuoto">Prima crea i contenitori. <a href="#/contenitori">Vai a Packaging</a></p>`; return; }
  const oggi = u.oggiISO();
  const g = giacenzeContenitori(d, oggi);
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/contenitori" class="btn">← Packaging</a></div>
    <form class="scheda" id="cn-inv">
      <h1 style="margin-top:0">Inventario dei vuoti</h1>
      <p class="totale">Scrivi i pezzi contati. Se lasci un campo vuoto quel contenitore tiene il calcolato; per azzerarlo scrivi 0. Da questo giorno la giacenza riparte dai numeri contati.
        Il lotto è facoltativo: se lo scrivi, i pezzi contati sono tutti di quel lotto; se no restano i lotti arrivati per ultimi.</p>
      <div class="griglia"><label>Data <input type="date" name="data" value="${oggi}" required></label></div>
      <div class="scroll-x" style="margin-top:10px"><table class="tab-edit">
        <thead><tr><th>Contenitore</th><th class="n">Calcolato</th><th style="width:100px">Confezioni</th><th style="width:120px">Contati</th><th style="width:140px">Lotto</th></tr></thead>
        <tbody>${d.contenitori.map(k => html`<tr>
          <td>${ICONA[k.categoria] || ''} ${k.nome}</td><td class="n totale">${pz(g.get(k.id).giacenza)}</td>
          <td>${Number(k.pezziConfezione) > 0 ? html`<input data-conf="${k.id}" type="number" min="0" step="any" inputmode="decimal" title="da ${k.pezziConfezione} pezzi">` : ''}</td>
          <td><input name="pz-${k.id}" type="number" min="0" step="1" inputmode="numeric"></td>
          <td><input name="lt-${k.id}" list="dl-li-${k.id}" placeholder="${g.get(k.id).lotti.filter(l => l.lotto).map(l => l.lotto).join(', ')}"><datalist id="dl-li-${k.id}">${g.get(k.id).lotti.filter(l => l.lotto).map(l => html`<option value="${l.lotto}">`)}</datalist></td></tr>`)}</tbody>
      </table></div>
      <div class="barra salva-inv" style="margin-top:10px"><span class="spazio"></span><button class="primario">Salva inventario</button></div>
    </form>`;
  const f = document.getElementById('cn-inv');
  f.oninput = e => {
    const id = e.target.dataset.conf;
    if (!id) return;
    const k = d.contenitori.find(x => x.id === id);
    f[`pz-${id}`].value = e.target.value === '' ? '' : Math.round(Number(e.target.value) * Number(k.pezziConfezione));
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const righe = d.contenitori.filter(k => f[`pz-${k.id}`].value !== '').map(k => ({ contenitoreId: k.id, pezzi: Math.round(Number(f[`pz-${k.id}`].value)), lotto: f[`lt-${k.id}`].value.trim() }));
    if (!righe.length) return u.toast('Scrivi almeno un numero contato');
    await u.db.salva({ id: u.db.nuovoId('inventariocontenitori'), tipo: 'inventariocontenitori', data: f.data.value, righe });
    u.toast('Inventario salvato');
    location.hash = '#/contenitori';
  };
}
