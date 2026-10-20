// Prima nota di cassa (#/cassa): contanti in entrata e in uscita, saldo, conte della cassa,
// soldi in sospeso (sospesi), incassi da registrare per gli scarichi taproom/spaccio/eventi,
// Excel e import da "Cassa Vecas".

import { CATEGORIE_CASSA, categoriaCassa, cassaDaExcel, importo, registroCassa, saldoCassa, sospesiAperti } from './cassa.js';
import { leggiXlsx } from './xlsx-leggi.js';
import { creaXlsx } from './xlsx.js';
import { daChiave, nomeMotivo } from './birra.js';

let u; // { $app, html, db, toast, chiedi, dataIT, numIT, oggiISO, addGiorni }
export function init(strumenti) { u = strumenti; }

const filtro = { anno: null, categoria: '' };
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const MOTIVI_INCASSO = ['taproom', 'spaccio', 'eventi'];

export async function vistaCassa() {
  const { html } = u;
  const [movimenti, conte, movBirra, sospesi] = await Promise.all(['movcassa', 'contacassa', 'movbirra', 'sospesocassa'].map(t => u.db.tutti(t)));
  const sosp = sospesiAperti(sospesi);
  const oggi = u.oggiISO();
  const { saldo, conta } = saldoCassa(movimenti, conte);
  const registro = registroCassa(movimenti, conte);
  const anni = [...new Set(registro.map(r => r.data.slice(0, 4)))].sort().reverse();
  if (!filtro.anno || !anni.includes(filtro.anno)) filtro.anno = anni[0] || oggi.slice(0, 4);
  const righe = registro.filter(r => r.data.startsWith(filtro.anno) && (!filtro.categoria || (r.tipo === 'mov' && r.m.categoria === filtro.categoria))).reverse();
  const delAnno = movimenti.filter(m => !m.eliminato && m.data?.startsWith(filtro.anno));
  const entrate = delAnno.reduce((t, m) => t + (Number(m.entrata) || 0), 0), uscite = delAnno.reduce((t, m) => t + (Number(m.uscita) || 0), 0);
  const perCat = Object.keys(CATEGORIE_CASSA).map(k => ({ k, v: delAnno.filter(m => m.categoria === k).reduce((t, m) => t + importo(m), 0) })).filter(x => x.v);
  // scarichi di birra venduta a contanti (ultimi 14 giorni) senza incasso registrato
  const registrati = new Set(movimenti.filter(m => !m.eliminato).map(m => m.rifMovBirra).filter(Boolean));
  const daIncassare = movBirra.filter(m => !m.eliminato && m.verso !== 'carico' && MOTIVI_INCASSO.includes(m.motivo) && m.data >= u.addGiorni(oggi, -14) && !registrati.has(m.id) && !m.incassoScartato)
    .sort((a, b) => b.data.localeCompare(a.data));
  const descrizioni = [...new Set(movimenti.map(m => m.descrizione).filter(Boolean))].slice(-300);
  const nuovo = { data: oggi, verso: 'entrata' };

  u.$app.innerHTML = html`
    <div class="barra"><h1 style="margin:0">Cassa</h1><span class="spazio"></span>
      <button id="cs-excel">Scarica Excel</button>
      <label class="btn solo-editori">Importa dal foglio della cassa<input type="file" id="cs-importa" accept=".xlsx" hidden></label></div>
    <div class="home-kpi cs-kpi">
      <div class="w-kpi" style="--w:var(--ok)"><span>In cassa oggi</span><b>${euro(saldo)}</b><small>${conta ? `contata il ${u.dataIT(conta.data)}: ${euro(conta.saldo)}` : 'mai contata'}</small></div>
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Entrate ${filtro.anno}</span><b>${euro(entrate)}</b><small>${delAnno.filter(m => m.entrata).length} movimenti</small></div>
      <div class="w-kpi" style="--w:var(--warn)"><span>Uscite ${filtro.anno}</span><b>${euro(uscite)}</b><small>${perCat.filter(x => x.v < 0).sort((a, b) => a.v - b.v).slice(0, 2).map(x => `${CATEGORIE_CASSA[x.k]} ${euro(-x.v)}`).join(' · ')}</small></div>
      ${sosp.aperti.length ? html`<button type="button" class="w-kpi w-kpi-btn st-libero" id="cs-vai-sosp" style="--w:var(--s-tank)"><span>In sospeso</span><b>${sosp.aperti.length}</b><small>${[sosp.daIncassare && `da incassare ${euro(sosp.daIncassare)}`, sosp.daPagare && `da pagare ${euro(sosp.daPagare)}`, sosp.daCapire && `da capire ${euro(sosp.daCapire)}`].filter(Boolean).join(' · ')}</small></button>` : ''}
    </div>

    <form class="scheda solo-editori" id="cs-nuovo">
      <h2 style="margin-top:0">Nuovo movimento</h2>
      <div class="segmenti" id="cs-verso"><button type="button" data-v="entrata" class="attivo">+ Entrata</button><button type="button" data-v="uscita">− Uscita</button><button type="button" data-v="sospeso" title="Soldi che qualcuno ci deve o che dobbiamo dare: non toccano la cassa finché non li segni incassati o pagati">⏳ In sospeso</button></div>
      <div class="griglia" style="margin-top:8px">
        <label>Data <input type="date" name="data" value="${nuovo.data}" required></label>
        <label style="grid-column:span 2">Descrizione <input name="descrizione" list="dl-cassa" required placeholder="es. taproom, Adua, versato BPPM"></label>
        <label>Importo € <input name="importo" type="number" step="0.01" min="0.01" inputmode="decimal" required></label>
        <label id="cs-chi" hidden>Chi deve <select name="chi"><option value="entrata">Ce li devono (da incassare)</option><option value="uscita">Li dobbiamo (da pagare)</option></select></label>
        <label id="cs-cat-lab">Categoria <select name="categoria"><option value="">automatica</option>${Object.entries(CATEGORIE_CASSA).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
        <input type="hidden" name="rifMovBirra" value="">
      </div>
      <datalist id="dl-cassa">${descrizioni.map(d => html`<option value="${d}">`)}</datalist>
      <div class="barra" style="margin:8px 0 0"><button type="button" id="cs-conta">Ho contato la cassa…</button><span class="spazio"></span><button class="primario">Registra</button></div>
    </form>

    ${sosp.aperti.length ? html`<div class="scheda" id="cs-sospesi">
      <h2>In sospeso <span class="totale">non toccano la cassa finché non li segni incassati o pagati</span></h2>
      <ul class="w-lista">${sosp.aperti.map(x => html`<li class="acq-riga"><span class="w-testo"><b>${x.descrizione} · ${euro(x.importo)}</b>
        <small>dal ${u.dataIT(x.data)} · ${x.verso === 'entrata' ? 'ce li devono' : x.verso === 'uscita' ? 'li dobbiamo' : 'da capire chi deve a chi'}${x.note ? ` · ${x.note}` : ''}</small></span>
        <span class="solo-editori" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${!x.verso ? html`<button class="piccolo" data-verso-sosp="${x.id}" data-v="entrata" title="Segna solo chi deve a chi, il sospeso resta aperto">Ce li devono</button><button class="piccolo" data-verso-sosp="${x.id}" data-v="uscita" title="Segna solo chi deve a chi, il sospeso resta aperto">Li dobbiamo</button>` : ''}
          ${x.verso !== 'uscita' ? html`<button class="piccolo" data-chiudi="${x.id}" data-come="entrata">Incassato</button>` : ''}
          ${x.verso !== 'entrata' ? html`<button class="piccolo" data-chiudi="${x.id}" data-come="uscita">Pagato</button>` : ''}
          <button class="piccolo" data-del-sosp="${x.id}" title="Elimina senza movimento di cassa">✕</button></span></li>`)}</ul>
    </div>` : ''}

    ${daIncassare.length ? html`<div class="scheda solo-editori">
      <h2>Incassi da registrare <span class="totale">scarichi di birra degli ultimi 14 giorni senza incasso in cassa</span></h2>
      <ul class="w-lista">${daIncassare.map(m => html`<li class="acq-riga"><span class="w-testo"><b>${nomeMotivo(m)} ${u.dataIT(m.data)}</b>${m.cliente ? ` · ${m.cliente}` : ''}${m.scontrinato === false ? ' · non scontrinato' : ''}
        <small>${(m.righe || []).map(r => { const p = daChiave(r.prodotto); return `${r.pezzi} × ${p.birra} ${p.litri} L`; }).join(' · ')}</small></span>
        <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="piccolo" data-incassa="${m.id}">Registra incasso</button>
        <button class="piccolo" data-scarta-inc="${m.id}" title="Togli dall'elenco senza registrare l'incasso (pagato in altro modo, omaggio…)">Scarta</button></span></li>`)}</ul>
    </div>` : ''}

    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <div class="segmenti cs-anni">${(anni.length ? anni : [filtro.anno]).map(a => html`<button data-anno="${a}" class="${a === filtro.anno ? 'attivo' : ''}">${a}</button>`)}</div>
        <select id="cs-cat" style="width:auto"><option value="">Tutte le categorie</option>${Object.entries(CATEGORIE_CASSA).map(([k, v]) => html`<option value="${k}" ${k === filtro.categoria ? 'selected' : ''}>${v}</option>`)}</select>
      </div>
      ${perCat.length ? html`<p class="totale">${perCat.map(x => `${CATEGORIE_CASSA[x.k]} ${x.v > 0 ? '+' : ''}${euro(x.v)}`).join(' · ')}</p>` : ''}
      ${righe.length ? html`<div class="scroll-x"><table class="tab-mag cs-tab">
        <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th class="n">Entrata</th><th class="n">Uscita</th><th class="n">Saldo</th><th></th></tr></thead>
        <tbody>${righe.map(r => r.tipo === 'conta'
          ? html`<tr class="cs-conta"><td>${u.dataIT(r.data)}</td><td colspan="4"><b>Cassa contata</b>${r.c.note ? ` · ${r.c.note}` : ''}${Math.abs(r.differenza) >= 0.01 ? html` <span class="badge ${r.differenza < 0 ? 'cop-badge-ritardo' : ''}">${r.differenza > 0 ? '+' : ''}${euro(r.differenza)} rispetto al calcolato</span>` : ''}</td><td class="n"><b>${euro(r.saldo)}</b></td>
            <td class="az"><button class="piccolo solo-editori" data-del-conta="${r.c.id}" title="Elimina">✕</button></td></tr>`
          : html`<tr><td>${u.dataIT(r.data)}</td><td>${r.m.descrizione}${r.m.note ? html`<small class="totale"> ${r.m.note}</small>` : ''}</td><td class="totale">${CATEGORIE_CASSA[r.m.categoria] || ''}</td>
            <td class="n">${r.m.entrata ? euro(r.m.entrata) : ''}</td><td class="n">${r.m.uscita ? euro(r.m.uscita) : ''}</td><td class="n totale">${euro(r.saldo)}</td>
            <td class="az"><button class="piccolo solo-editori" data-del="${r.m.id}" title="Elimina">✕</button></td></tr>`)}</tbody></table></div>`
        : html`<p class="vuoto">Nessun movimento${filtro.categoria ? ' in questa categoria' : ''} nel ${filtro.anno}.</p>`}
    </div>`;

  const form = u.$app.querySelector('#cs-nuovo');
  let verso = 'entrata';
  u.$app.onclick = async e => {
    const t = e.target;
    const v = t.closest('#cs-verso [data-v]');
    if (v) {
      verso = v.dataset.v;
      form.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('attivo', b === v));
      form.querySelector('#cs-chi').hidden = verso !== 'sospeso';
      form.querySelector('#cs-cat-lab').hidden = verso === 'sospeso';
      return;
    }
    if (t.closest('#cs-vai-sosp')) return document.getElementById('cs-sospesi').scrollIntoView({ behavior: 'smooth' });
    const ch = t.closest('[data-chiudi]');
    if (ch) {
      const x = sosp.aperti.find(s => s.id === ch.dataset.chiudi);
      const entrata = ch.dataset.come === 'entrata';
      const val = Math.round(Number(x.importo) * 100) / 100;
      if (!(await u.chiedi(`${x.descrizione}: segnare ${euro(val)} come ${entrata ? 'incassati oggi (entrano in cassa)' : 'pagati oggi (escono dalla cassa)'}?`, entrata ? 'Incassato' : 'Pagato'))) return;
      const mov = await u.db.salva({
        id: u.db.nuovoId('movcassa'), tipo: 'movcassa', data: u.oggiISO(), descrizione: x.descrizione,
        entrata: entrata ? val : null, uscita: entrata ? null : val, categoria: categoriaCassa(x.descrizione, entrata),
        note: `sospeso dal ${u.dataIT(x.data)}`, rifSospeso: x.id, creato: new Date().toISOString(),
      });
      const { aggiornato: _a, ...rec } = x;
      await u.db.salva({ ...rec, chiuso: u.oggiISO(), rifMovCassa: mov.id });
      u.toast(entrata ? 'Incasso registrato' : 'Pagamento registrato');
      return vistaCassa();
    }
    const vs = t.closest('[data-verso-sosp]');
    if (vs) { // solo il verso, il sospeso resta aperto (Romain 2026-10-20)
      const { aggiornato: _a, ...rec } = sosp.aperti.find(s => s.id === vs.dataset.versoSosp);
      await u.db.salva({ ...rec, verso: vs.dataset.v });
      return vistaCassa();
    }
    const sc = t.closest('[data-scarta-inc]');
    if (sc) { // scarico senza incasso in cassa: non si propone più (Romain 2026-10-20)
      const m = daIncassare.find(x => x.id === sc.dataset.scartaInc);
      if (!(await u.chiedi(`${nomeMotivo(m)} ${u.dataIT(m.data)}: togliere dagli incassi da registrare senza registrare niente in cassa?`, 'Scarta'))) return;
      const { aggiornato: _a, ...rec } = m;
      await u.db.salva({ ...rec, incassoScartato: u.oggiISO() });
      u.toast('Tolto dagli incassi da registrare');
      return vistaCassa();
    }
    const delS = t.closest('[data-del-sosp]');
    if (delS && await u.chiedi('Eliminare questo sospeso? Non viene registrato nessun movimento di cassa.', 'Elimina')) { await u.db.elimina(delS.dataset.delSosp); return vistaCassa(); }
    const a = t.closest('[data-anno]');
    if (a) { filtro.anno = a.dataset.anno; return vistaCassa(); }
    const inc = t.closest('[data-incassa]');
    if (inc) {
      const m = daIncassare.find(x => x.id === inc.dataset.incassa);
      verso = 'entrata';
      form.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('attivo', b.dataset.v === 'entrata'));
      form.data.value = m.data;
      form.descrizione.value = `${nomeMotivo(m)}${m.cliente ? ` ${m.cliente}` : ''}`.trim();
      form.categoria.value = m.motivo === 'taproom' ? 'taproom' : 'vendite';
      form.rifMovBirra.value = m.id;
      form.scrollIntoView({ behavior: 'smooth' });
      form.importo.focus();
      return;
    }
    const del = t.closest('[data-del]');
    if (del && await u.chiedi('Eliminare questo movimento di cassa?', 'Elimina')) { await u.db.elimina(del.dataset.del); return vistaCassa(); }
    const delC = t.closest('[data-del-conta]');
    if (delC && await u.chiedi('Eliminare questa conta della cassa?', 'Elimina')) { await u.db.elimina(delC.dataset.delConta); return vistaCassa(); }
    if (t.id === 'cs-conta') return dialogConta(saldo);
    if (t.id === 'cs-excel') return scaricaExcel(registro);
  };
  u.$app.onchange = async e => {
    if (e.target.id === 'cs-cat') { filtro.categoria = e.target.value; return vistaCassa(); }
    if (e.target.id === 'cs-importa' && e.target.files[0]) return importaExcel(e.target.files[0], movimenti);
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const val = Math.round(Number(form.importo.value) * 100) / 100;
    if (!(val > 0)) return u.toast('Scrivi l\'importo');
    const descrizione = form.descrizione.value.trim();
    if (verso === 'sospeso') {
      await u.db.salva({ id: u.db.nuovoId('sospesocassa'), tipo: 'sospesocassa', data: form.data.value, descrizione, importo: val, verso: form.chi.value, note: '', chiuso: null });
      u.toast(`${euro(val)} in sospeso: ${form.chi.value === 'entrata' ? 'da incassare' : 'da pagare'}`);
      return vistaCassa();
    }
    await u.db.salva({
      id: u.db.nuovoId('movcassa'), tipo: 'movcassa', data: form.data.value, descrizione,
      entrata: verso === 'entrata' ? val : null, uscita: verso === 'uscita' ? val : null,
      categoria: form.categoria.value || categoriaCassa(descrizione, verso === 'entrata'),
      ...(form.rifMovBirra.value ? { rifMovBirra: form.rifMovBirra.value } : {}), creato: new Date().toISOString(),
    });
    u.toast(`${verso === 'entrata' ? 'Entrata' : 'Uscita'} di ${euro(val)} registrata`);
    vistaCassa();
  };
}

function dialogConta(calcolato) {
  const { html } = u;
  const d = document.createElement('dialog');
  d.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">Conta della cassa</h2>
    <p class="totale">Scrivi i contanti che ci sono adesso in cassa. Il saldo riparte da qui; se è diverso dal calcolato (${euro(calcolato)}) la differenza resta scritta nell'elenco.</p>
    <div class="griglia">
      <label>Data <input type="date" name="data" value="${u.oggiISO()}" required></label>
      <label>Contanti € <input name="saldo" type="number" step="0.01" inputmode="decimal" required value="${Math.round(calcolato * 100) / 100}"></label>
      <label style="grid-column:1/-1">Note <input name="note" placeholder="facoltativo"></label>
    </div>
    <div class="barra"><span class="spazio"></span><button value="no" formnovalidate>Annulla</button><button class="primario" value="si">Salva</button></div>
  </form>`.s;
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    const f = d.querySelector('form');
    if (d.returnValue === 'si') {
      await u.db.salva({ id: u.db.nuovoId('contacassa'), tipo: 'contacassa', data: f.data.value, saldo: Math.round(Number(f.saldo.value) * 100) / 100, note: f.note.value.trim() });
      u.toast('Conta salvata');
      vistaCassa();
    }
    d.remove();
  });
  d.showModal();
}

function scaricaExcel(registro) {
  const testa = ['Data', 'Descrizione', 'Categoria', 'Entrata', 'Uscita', 'Saldo'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' }));
  const righe = [testa, ...registro.map(r => (r.tipo === 'conta'
    ? [u.dataIT(r.data), { v: `Cassa contata${r.c.note ? ` · ${r.c.note}` : ''}${Math.abs(r.differenza) >= 0.01 ? ` (differenza ${u.numIT(r.differenza, 2)})` : ''}`, grassetto: true }, '', null, null, { v: Math.round(r.saldo * 100) / 100, grassetto: true }]
    : [u.dataIT(r.data), r.m.descrizione, CATEGORIE_CASSA[r.m.categoria] || '', Number(r.m.entrata) || null, Number(r.m.uscita) || null, Math.round(r.saldo * 100) / 100]))];
  const blob = creaXlsx([{ nome: 'Cassa', righe, larghezze: [11, 40, 18, 11, 11, 12], blocca: { righe: 1 } }]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cassa-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Import dal vecchio foglio: si scelgono i fogli (anni); quelli già importati vengono sostituiti
async function importaExcel(file, esistenti) {
  const { html } = u;
  let fogli;
  try { fogli = cassaDaExcel(await leggiXlsx(await file.arrayBuffer())); } catch (e) { return u.toast(e.message); }
  if (!fogli.length) return u.toast('Nel file non ho trovato fogli con Descrizione, avere e dare');
  const d = document.createElement('dialog');
  d.innerHTML = html`<form method="dialog">
    <h2 style="margin-top:0">Importa la cassa da Excel</h2>
    <p class="totale">Scegli i fogli da importare. Il "RIPORTO" di ogni anno diventa una conta della cassa al 31/12 dell'anno prima, così il saldo riparte dal valore del foglio. Le righe con solo "da pagare" vanno in "In sospeso". Se reimporti un foglio, i movimenti importati prima da quel foglio vengono sostituiti.</p>
    ${fogli.map((f, i) => html`<label class="spunta"><input type="checkbox" name="f${i}" ${f.conta ? 'checked' : ''}> <span><b>${f.nome}</b> · ${f.movimenti.length} movimenti dal ${u.dataIT(f.movimenti[0].data)} al ${u.dataIT(f.movimenti.at(-1).data)}${f.conta ? ` · riporto ${euro(f.conta.saldo)}` : ' · senza riporto e con date mancanti'}${f.sospesi.length ? ` · ${f.sospesi.length} in sospeso` : ''}</span></label>`)}
    <div class="barra"><span class="spazio"></span><button value="no" formnovalidate>Annulla</button><button class="primario" value="si">Importa</button></div>
  </form>`.s;
  document.body.appendChild(d);
  d.addEventListener('close', async () => {
    const f = d.querySelector('form');
    const scelti = fogli.filter((_, i) => f[`f${i}`].checked);
    d.remove();
    if (d.returnValue !== 'si' || !scelti.length) return;
    const nomi = new Set(scelti.map(x => x.nome));
    const vecchi = [...esistenti, ...(await u.db.tutti('contacassa')), ...(await u.db.tutti('sospesocassa'))].filter(x => nomi.has(x.fonteExcel));
    for (const x of vecchi) await u.db.elimina(x.id);
    const nuovi = scelti.flatMap(x => [
      // creato: l'ordine delle righe del foglio nello stesso giorno
      ...x.movimenti.map((m, i) => ({ ...m, id: u.db.nuovoId('movcassa'), tipo: 'movcassa', fonteExcel: x.nome, creato: `0-${String(i).padStart(5, '0')}` })),
      ...(x.conta ? [{ ...x.conta, id: u.db.nuovoId('contacassa'), tipo: 'contacassa', fonteExcel: x.nome }] : []),
      ...x.sospesi.map(sp => ({ ...sp, id: u.db.nuovoId('sospesocassa'), tipo: 'sospesocassa', fonteExcel: x.nome, chiuso: null })),
    ]);
    await u.db.salvaMolti(nuovi);
    u.toast(`Importati ${nuovi.length} movimenti e conte`);
    vistaCassa();
  });
  d.showModal();
}
