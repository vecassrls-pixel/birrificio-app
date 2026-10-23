// Cashflow (#/cashflow, dalla pagina Cassa): saldo di partenza (banca + contanti), rate da incassare e da pagare
// di Fatture in Cloud, voci fisse ricorrenti, materie prime da ordinare, previsione a 13 settimane.
// Le rate si leggono dal proxy netlify/functions/fattureincloud.mjs (?scadenze=1) e restano su questo dispositivo
// (meta 'cashflow-fic'), così la pagina si apre anche senza internet con l'ultima lettura.

import { ID_CASHFLOW, OGNI, CATEGORIE_FISSE, SETTIMANE, impostazioniDa, previsione, ultimaBanca, usciteMateriePrime } from './cashflow.js';
import { saldoCassa } from './cassa.js';
import { giacenze } from './magazzino.js';
import { fabbisogno, ordinatiDa, ID_ORDINATI } from './ordine.js';
import { storicoPrezzi, prezzoArticolo } from './costi.js';

let u; // { $app, html, raw, db, toast, chiedi, stato, dataIT, oggiISO, addGiorni, diffGiorni, token }
export function init(strumenti) { u = strumenti; }

const META = 'cashflow-fic';
const VECCHIA_ORE = 6; // oltre, all'apertura si rilegge da sola
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;
const euro2 = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const NOME_TIPO = { fattura: 'Fattura', nota: 'Nota di credito', acquisto: 'Acquisto', fissa: 'Fissa', mp: 'Materie prime' };
let lettura = null; // promessa della lettura in corso
let ultimoTentativo = 0; // la lettura automatica non si ripete a ogni ridisegno della pagina

async function leggiFic(imp) {
  const oggi = u.oggiISO();
  const banca = ultimaBanca(imp);
  const pagateDal = [u.addGiorni(oggi, -70), banca?.data].filter(Boolean).sort()[0];
  const dal = u.addGiorni(oggi, -365);
  const t = await u.token();
  const res = await fetch(`/.netlify/functions/fattureincloud?scadenze=1&dal=${dal}&pagateDal=${pagateDal}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  let body = null;
  try { body = await res.json(); } catch { /* non JSON */ }
  if (!res.ok) throw new Error(body?.errore || `Errore ${res.status}`);
  const valore = { letto: new Date().toISOString(), dal, pagateDal, ...body };
  await u.db.meta(META, valore);
  return valore;
}

async function aggiorna(imp, silenziosa) {
  if (lettura) return lettura;
  ultimoTentativo = Date.now();
  lettura = leggiFic(imp)
    .then(() => { if (location.hash === '#/cashflow') vistaCashflow({ appenaLetto: true }); })
    .catch(e => { if (!silenziosa || location.hash === '#/cashflow') u.toast(`Fatture in Cloud: ${e.message}`); })
    .finally(() => { lettura = null; });
  return lettura;
}

export async function vistaCashflow({ appenaLetto = false } = {}) {
  const { html, raw } = u;
  const oggi = u.oggiISO();
  const [movimenti, conte, articoli, bolle, inventari, scarichi, rec, recOrd, fic] = await Promise.all([
    u.db.tutti('movcassa'), u.db.tutti('contacassa'), u.db.tutti('articolo'), u.db.tutti('bolla'), u.db.tutti('inventario'), u.db.tutti('scarico'),
    u.db.leggi(ID_CASHFLOW), u.db.leggi(ID_ORDINATI), u.db.meta(META),
  ]);
  const imp = impostazioniDa(rec);
  const contanti = saldoCassa(movimenti, conte).saldo;
  const rate = fic?.voci || [];

  // materie prime da ordinare per le cotte delle prossime 13 settimane
  const dati = { articoli, bolle, inventari, scarichi, cotte: u.stato.cotte };
  const ordinati = ordinatiDa(recOrd && !recOrd.eliminato ? recOrd : null, bolle);
  const { righe } = fabbisogno(giacenze(dati, oggi), dati, { fino: u.addGiorni(oggi, SETTIMANE * 7), oggi, ordinati });
  const storico = storicoPrezzi(articoli, bolle);
  const mp = usciteMateriePrime(righe, { prezzo: a => prezzoArticolo(a, oggi, storico)?.prezzo, giorniMp: imp.giorniMp, ivaMp: imp.ivaMp });

  const p = previsione({ rate, mp: mp.voci, imp, contanti, oggi });
  const minimo = p.settimane.reduce((m, s) => (s.saldo < m.saldo ? s : m), p.settimane[0]);
  const finale = p.settimane[p.settimane.length - 1];
  const sotto = p.settimane.filter(s => s.sotto);
  const vecchia = !fic || (Date.now() - new Date(fic.letto)) / 3600000 > VECCHIA_ORE;
  const bancaVecchia = p.banca && u.diffGiorni(p.banca.data, oggi) > 30;
  const mpTot = mp.voci.reduce((t, v) => t + v.importo, 0);

  u.$app.innerHTML = html`
    <div class="barra"><a href="#/cassa" class="btn">← Cassa</a><h1 style="margin:0">Cashflow</h1><span class="spazio"></span>
      <span class="totale" style="margin:0">${fic ? `Fatture in Cloud letto ${new Date(fic.letto).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Fatture in Cloud non ancora letto'}</span>
      <button id="cf-aggiorna" ${lettura ? 'disabled' : ''}>${lettura ? 'Lettura…' : '↻ Aggiorna da Fatture in Cloud'}</button></div>

    ${!p.banca ? html`<div class="scheda cf-avviso"><b>Manca il saldo della banca.</b> Scrivilo in fondo alla pagina: senza, la previsione parte dai soli contanti in cassa.</div>`
      : bancaVecchia ? html`<div class="scheda cf-avviso">Il saldo della banca è del ${u.dataIT(p.banca.data)}: aggiornalo in fondo alla pagina per una previsione più giusta.</div>` : ''}

    <div class="home-kpi cs-kpi">
      <div class="w-kpi" style="--w:var(--ok)"><span>Saldo di partenza</span><b>${euro(p.iniziale)}</b>
        <small>${p.banca ? `banca ${euro(p.banca.saldo)} (${u.dataIT(p.banca.data)})${p.aggiustamento ? ` ${p.aggiustamento > 0 ? '+' : '−'} ${euro(Math.abs(p.aggiustamento))} dopo` : ''} · ` : ''}contanti ${euro(p.contanti)}</small></div>
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Da incassare</span><b>${euro(p.aperte.entrate)}</b>
        <small>${p.scadute.entrate ? `di cui scaduti ${euro(p.scadute.entrate)}` : 'nessuno scaduto'}</small></div>
      <div class="w-kpi" style="--w:var(--warn)"><span>Da pagare</span><b>${euro(p.aperte.uscite)}</b>
        <small>${p.scadute.uscite ? `di cui scaduti ${euro(p.scadute.uscite)}` : 'nessuno scaduto'}${mpTot ? ` · + materie prime ${euro(mpTot)}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--s-tank)"><span>Punto più basso</span><b class="${minimo.sotto ? 'neg' : ''}">${euro(minimo.saldo)}</b>
        <small>settimana del ${u.dataIT(minimo.da)} · fra ${SETTIMANE} settimane ${euro(finale.saldo)}</small></div>
    </div>

    ${sotto.length ? html`<div class="scheda cf-avviso cf-rosso">⚠ <b>${sotto.length === 1 ? '1 settimana' : `${sotto.length} settimane`} sotto ${euro(imp.soglia)}</b>, la prima quella del ${u.dataIT(sotto[0].da)} (${euro(sotto[0].saldo)}).</div>` : ''}

    <div class="scheda">
      <h2 style="margin-top:0">Saldo previsto a fine settimana <span class="totale">prossime ${SETTIMANE} settimane</span></h2>
      ${raw(grafico(p.settimane, imp.soglia))}
      <div class="scroll-x"><table class="tab-mag cf-tab">
        <thead><tr><th>Settimana</th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Netto</th><th class="n">Saldo</th></tr></thead>
        <tbody>${p.settimane.map((s, i) => html`<tr class="cf-sett ${s.sotto ? 'neg' : ''}" data-sett="${i}" title="Tocca per vedere le voci">
            <td>${s.sotto ? '⚠ ' : ''}${u.dataIT(s.da, { day: '2-digit', month: 'short' })}<span class="cf-fino"> – ${u.dataIT(s.a, { day: '2-digit', month: 'short' })}</span>${s.voci.length ? html` <span class="totale cf-n">· ${s.voci.length === 1 ? '1 voce' : `${s.voci.length} voci`} ▾</span>` : ''}</td>
            <td class="n">${s.entrate ? euro(s.entrate) : '—'}</td><td class="n">${s.uscite ? euro(s.uscite) : '—'}</td>
            <td class="n">${s.netto ? `${s.netto > 0 ? '+' : '−'}${euro(Math.abs(s.netto))}` : '—'}</td><td class="n"><b>${euro(s.saldo)}</b></td></tr>
          <tr class="cf-dett" data-dett="${i}" hidden><td colspan="5">${s.voci.length ? html`<ul class="w-lista">${s.voci.map(v => rigaVoce(v))}</ul>` : html`<span class="totale">Nessuna voce</span>`}</td></tr>`)}</tbody>
      </table></div>
      <p class="totale">Entrate: rate non pagate delle fatture emesse${imp.scadutiInEntrata ? ' (le scadute nella prima settimana)' : ' (le scadute non si contano: sono qui sotto)'}, meno le note di credito.
        Uscite: rate non pagate degli acquisti (le scadute nella prima settimana), voci fisse, materie prime da ordinare per le cotte pianificate a ${imp.giorniMp} giorni con IVA ${imp.ivaMp}%.
        Importi IVA compresa, come in Fatture in Cloud.${mp.senzaPrezzo.length ? ` Senza prezzo da bolla, non contate: ${mp.senzaPrezzo.join(', ')}.` : ''}
        ${fic?.senzaRate ? ` ${fic.senzaRate} documenti senza scadenze in Fatture in Cloud non sono contati.` : ''}${fic?.altri ? ' Documenti troppi: letti solo i più recenti.' : ''}</p>
    </div>

    ${p.scadute.voci.length ? html`<div class="scheda">
      <h2 style="margin-top:0">Scaduti <span class="totale">rate non ancora segnate pagate in Fatture in Cloud</span></h2>
      ${['entrata', 'uscita'].map(verso => {
        const vv = p.scadute.voci.filter(v => v.verso === verso).sort((a, b) => a.scadenza.localeCompare(b.scadenza));
        return vv.length ? html`<h3>${verso === 'entrata' ? `Clienti in ritardo · ${euro(p.scadute.entrate)}` : `Fornitori da pagare · ${euro(p.scadute.uscite)}`}</h3>
          <ul class="w-lista">${vv.map(v => rigaVoce(v, true))}</ul>` : '';
      })}
    </div>` : ''}

    ${p.ultime.some(s => s.entrate || s.uscite) ? html`<div class="scheda">
      <h2 style="margin-top:0">Ultime 8 settimane <span class="totale">rate segnate pagate in Fatture in Cloud</span></h2>
      <div class="scroll-x"><table class="tab-mag cf-tab"><thead><tr><th>Settimana</th><th class="n">Incassato</th><th class="n">Pagato</th><th class="n">Netto</th></tr></thead>
        <tbody>${p.ultime.map(s => html`<tr><td>${u.dataIT(s.da, { day: '2-digit', month: 'short' })} – ${u.dataIT(s.a, { day: '2-digit', month: 'short' })}</td>
          <td class="n">${s.entrate ? euro(s.entrate) : '—'}</td><td class="n">${s.uscite ? euro(s.uscite) : '—'}</td><td class="n">${euro(s.entrate - s.uscite)}</td></tr>`)}</tbody></table></div>
    </div>` : ''}

    <div class="scheda">
      <h2 style="margin-top:0">Saldo della banca</h2>
      <form class="griglia solo-editori" id="cf-banca">
        <label>Data <input type="date" name="data" value="${oggi}" max="${oggi}" required></label>
        <label>Saldo € <input name="saldo" type="number" step="0.01" inputmode="decimal" required placeholder="dall'home banking"></label>
        <label>Note <input name="note" placeholder="es. BPPM + Poste"></label>
        <label>&nbsp;<button class="primario">Salva saldo</button></label>
      </form>
      ${imp.banca.length ? html`<ul class="w-lista">${[...imp.banca].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6).map(b => html`<li class="acq-riga"><span class="w-testo"><b>${euro2(b.saldo)}</b> <small>${u.dataIT(b.data)}${b.note ? ` · ${b.note}` : ''}</small></span>
        <button class="piccolo solo-editori" data-del-banca="${b.data}|${b.saldo}" title="Elimina">✕</button></li>`)}</ul>` : ''}
      <p class="totale">Dopo la data del saldo si aggiungono da sole le rate segnate pagate in Fatture in Cloud e le voci fisse già passate.</p>
    </div>

    <div class="scheda">
      <h2 style="margin-top:0">Uscite ed entrate fisse <span class="totale">affitto, stipendi, F24, accise, rate…</span></h2>
      ${imp.fisse.length ? html`<div class="scroll-x"><table class="tab-mag"><thead><tr><th>Voce</th><th>Categoria</th><th>Quando</th><th class="n">Importo</th><th></th></tr></thead>
        <tbody>${[...imp.fisse].sort((a, b) => a.nome.localeCompare(b.nome, 'it')).map(f => html`<tr>
          <td>${f.verso === 'entrata' ? '+ ' : ''}${f.nome}</td><td class="totale">${CATEGORIE_FISSE[f.categoria] || ''}</td>
          <td>${OGNI[f.ogni] || ''} dal ${u.dataIT(f.prima)}${f.fino ? ` al ${u.dataIT(f.fino)}` : ''}</td>
          <td class="n">${f.verso === 'entrata' ? '+' : '−'}${euro2(f.importo)}</td>
          <td class="az"><button class="piccolo solo-editori" data-mod-fissa="${f.id}" title="Modifica">✎</button> <button class="piccolo solo-editori" data-del-fissa="${f.id}" title="Elimina">✕</button></td></tr>`)}</tbody></table></div>`
        : html`<p class="totale">Nessuna voce fissa: aggiungi quelle che non passano da Fatture in Cloud.</p>`}
      <form class="solo-editori" id="cf-fissa">
        <input type="hidden" name="id" value="">
        <div class="griglia" style="margin-top:8px">
          <label style="grid-column:span 2">Voce <input name="nome" required placeholder="es. Affitto capannone"></label>
          <label>Categoria <select name="categoria">${Object.entries(CATEGORIE_FISSE).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
          <label>Importo € <input name="importo" type="number" step="0.01" min="0.01" inputmode="decimal" required></label>
          <label>Tipo <select name="verso"><option value="uscita">Uscita</option><option value="entrata">Entrata</option></select></label>
          <label>Ogni <select name="ogni">${Object.entries(OGNI).map(([k, v]) => html`<option value="${k}" ${k === 'mese' ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label>Prima volta <input type="date" name="prima" value="${oggi}" required></label>
          <label>Fino al <input type="date" name="fino" title="Facoltativa: ultima rata"></label>
        </div>
        <div class="barra" style="margin:8px 0 0"><span class="spazio"></span><button type="button" id="cf-fissa-annulla" hidden>Annulla</button><button class="primario" id="cf-fissa-ok">Aggiungi</button></div>
      </form>
    </div>

    <form class="scheda solo-editori" id="cf-opz">
      <h2 style="margin-top:0">Opzioni</h2>
      <div class="griglia">
        <label>Avviso sotto € <input name="soglia" type="number" step="100" inputmode="decimal" value="${imp.soglia}"></label>
        <label>Materie prime pagate a giorni <input name="giorniMp" type="number" min="0" step="1" inputmode="numeric" value="${imp.giorniMp}"></label>
        <label>IVA materie prime % <input name="ivaMp" type="number" min="0" step="1" inputmode="numeric" value="${imp.ivaMp}"></label>
      </div>
      <label class="spunta" style="margin-top:8px"><input type="checkbox" name="scadutiInEntrata" ${imp.scadutiInEntrata ? 'checked' : ''}> Conta i crediti scaduti come incassati nella prima settimana</label>
    </form>`;

  const salva = async campi => {
    const { aggiornato: _a, daSincronizzare: _d, ...r } = imp;
    await u.db.salva({ ...r, ...campi, id: ID_CASHFLOW, tipo: 'cashflow' });
    vistaCashflow();
  };
  const formFissa = u.$app.querySelector('#cf-fissa');

  u.$app.onclick = async e => {
    const t = e.target;
    if (t.closest('#cf-aggiorna')) { t.closest('button').disabled = true; t.closest('button').textContent = 'Lettura…'; return aggiorna(imp, false); }
    const sett = t.closest('[data-sett]');
    if (sett) { const d = u.$app.querySelector(`[data-dett="${sett.dataset.sett}"]`); d.hidden = !d.hidden; return; }
    const delB = t.closest('[data-del-banca]');
    if (delB) {
      if (!(await u.chiedi('Eliminare questo saldo della banca?', 'Elimina'))) return;
      return salva({ banca: imp.banca.filter(b => `${b.data}|${b.saldo}` !== delB.dataset.delBanca) });
    }
    const delF = t.closest('[data-del-fissa]');
    if (delF) {
      const f = imp.fisse.find(x => x.id === delF.dataset.delFissa);
      if (!(await u.chiedi(`Eliminare la voce fissa "${f.nome}"?`, 'Elimina'))) return;
      return salva({ fisse: imp.fisse.filter(x => x.id !== f.id) });
    }
    const modF = t.closest('[data-mod-fissa]');
    if (modF) {
      const f = imp.fisse.find(x => x.id === modF.dataset.modFissa);
      for (const k of ['id', 'nome', 'categoria', 'importo', 'verso', 'ogni', 'prima', 'fino']) formFissa.elements[k].value = f[k] ?? '';
      formFissa.querySelector('#cf-fissa-ok').textContent = 'Salva';
      formFissa.querySelector('#cf-fissa-annulla').hidden = false;
      formFissa.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (t.closest('#cf-fissa-annulla')) return vistaCashflow();
  };
  u.$app.querySelector('#cf-banca').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const voce = { data: f.get('data'), saldo: Math.round(Number(f.get('saldo')) * 100) / 100, note: String(f.get('note') || '').trim() };
    salva({ banca: [...imp.banca.filter(b => b.data !== voce.data), voce] });
  };
  formFissa.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(formFissa);
    const voce = {
      id: f.get('id') || u.db.nuovoId('fissa'), nome: String(f.get('nome')).trim(), categoria: f.get('categoria'), importo: Math.round(Number(f.get('importo')) * 100) / 100,
      verso: f.get('verso'), ogni: f.get('ogni'), prima: f.get('prima'), ...(f.get('fino') ? { fino: f.get('fino') } : {}),
    };
    if (voce.fino && voce.fino < voce.prima) return u.toast('"Fino al" è prima della prima volta');
    salva({ fisse: [...imp.fisse.filter(x => x.id !== voce.id), voce] });
  };
  u.$app.querySelector('#cf-opz').onchange = e => {
    const f = e.currentTarget.elements;
    salva({ soglia: Number(f.soglia.value) || 0, giorniMp: Math.max(0, Number(f.giorniMp.value) || 0), ivaMp: Math.max(0, Number(f.ivaMp.value) || 0), scadutiInEntrata: f.scadutiInEntrata.checked });
  };

  if (vecchia && !appenaLetto && !lettura && navigator.onLine && Date.now() - ultimoTentativo > 10 * 60000) aggiorna(imp, true);
}

function rigaVoce(v, ritardo = false) {
  const { html } = u;
  const oggi = u.oggiISO();
  const giorni = ritardo ? u.diffGiorni(v.scadenza, oggi) : 0;
  return html`<li class="acq-riga"><span class="w-testo"><b>${v.verso === 'entrata' ? '+' : '−'} ${euro2(Math.abs(v.importo))}${v.importo < 0 ? ' (nota di credito)' : ''} · ${v.controparte || v.numero}</b>
    <small>${[v.controparte && v.numero && !v.numero.startsWith(NOME_TIPO[v.tipo]) ? NOME_TIPO[v.tipo] : '', v.controparte ? v.numero : NOME_TIPO[v.tipo]].filter(Boolean).join(' · ')}${v.data ? ` del ${u.dataIT(v.data)}` : ''} · scade ${u.dataIT(v.scadenza)}${ritardo ? ` · ${giorni} giorni di ritardo` : v.scaduta ? ' · scaduta' : ''}${v.stimata ? ' · stima' : ''}</small></span></li>`;
}

// Barre del saldo a fine settimana, con la linea dell'avviso. SVG semplice, si adatta alla larghezza.
function grafico(settimane, soglia) {
  const W = 640, H = 180, sx = 44, top = 10, bottom = 22;
  const valori = settimane.map(s => s.saldo);
  const max = Math.max(0, Number(soglia) || 0, ...valori), min = Math.min(0, Number(soglia) || 0, ...valori);
  const span = max - min || 1;
  const y = v => top + (max - v) / span * (H - top - bottom);
  const bw = (W - sx) / settimane.length;
  const tick = v => `${Math.round(v / 1000).toLocaleString('it-IT')}k`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const barre = settimane.map((s, i) => {
    const x = sx + i * bw + 3, w = Math.max(2, bw - 6);
    const y0 = y(0), y1 = y(s.saldo);
    const alto = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
    const r = Math.min(4, w / 2, h);
    // estremità arrotondata dalla parte opposta allo zero
    const d = s.saldo >= 0
      ? `M${x},${alto + h}V${alto + r}Q${x},${alto} ${x + r},${alto}H${x + w - r}Q${x + w},${alto} ${x + w},${alto + r}V${alto + h}Z`
      : `M${x},${alto}V${alto + h - r}Q${x},${alto + h} ${x + r},${alto + h}H${x + w - r}Q${x + w},${alto + h} ${x + w},${alto + h - r}V${alto}Z`;
    const et = i % 2 === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" class="cf-asse">${s.da.slice(8, 10)}/${s.da.slice(5, 7)}</text>` : '';
    return `<g class="cf-barra${s.sotto ? ' cf-sotto' : ''}"><rect x="${sx + i * bw}" y="${top}" width="${bw}" height="${H - top - bottom}" fill="transparent"/><path d="${d}"/>${et}<title>${esc(`Settimana del ${s.da.slice(8, 10)}/${s.da.slice(5, 7)}: saldo ${euro(s.saldo)} (entrate ${euro(s.entrate)}, uscite ${euro(s.uscite)})`)}</title></g>`;
  }).join('');
  const linee = [max, (max + min) / 2, min].map(v => `<line x1="${sx}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="cf-griglia"/><text x="${sx - 6}" y="${y(v) + 4}" text-anchor="end" class="cf-asse">${tick(v)}</text>`).join('');
  const zero = min < 0 ? `<line x1="${sx}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="cf-zero"/>` : '';
  const sog = Number(soglia) ? `<line x1="${sx}" x2="${W}" y1="${y(soglia)}" y2="${y(soglia)}" class="cf-soglia"/><text x="${W}" y="${y(soglia) - 4}" text-anchor="end" class="cf-asse">avviso ${tick(soglia)}</text>` : '';
  return `<svg class="cf-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo previsto a fine settimana">${linee}${zero}${barre}${sog}</svg>`;
}
