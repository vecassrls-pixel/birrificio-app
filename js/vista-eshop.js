// Eshop (#/eshop) nella sezione Economia: vendite online di Shopify con gli importi, per mese e per anno,
// e se ogni ordine è già stato scaricato dal magazzino birra. Come la cassa, non la vede chi è in sola lettura.
// Gli ordini arrivano con "Aggiorna da Shopify" (proxy netlify/functions/shopify.mjs) e con l'import notturno.

import { MESI } from './mensili.js';
import { idVendita, partenzaEshop, perMese, statoMagazzino, totaliEshop, uguale, vendite, venditaDaOrdine } from './eshop.js';
import { unghieEconomia } from './economia.js';
import { ID_IMPOSTAZIONI } from './birra.js';
import { creaXlsx } from './xlsx.js';

let u; // { $app, html, db, toast, dataIT, numIT, oggiISO, addGiorni, token }
export function init(strumenti) { u = strumenti; }

const filtro = { anno: null, mese: '' }; // mese '' = tutto l'anno, altrimenti 'AAAA-MM'
let stato = { carica: false, errore: '', dal: null };
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const MAGAZZINO = {
  scaricato: { testo: '✓ scaricato', classe: '' },
  'nessuna-birra': { testo: 'nessuna birra', classe: '' },
  'da-scaricare': { testo: 'da scaricare', classe: 'cop-badge-ritardo' },
  'da-spedire': { testo: 'non spedito', classe: 'cop-badge-presto' },
  prima: { testo: 'prima del magazzino', classe: '' },
};
const articoli = v => (v.righe || []).map(r => `${u.numIT(r.qta, 0)} × ${r.nome}`).join(', ');

export async function vistaEshop() {
  const { html } = u;
  const [record, movBirra, impBirra, unghie] = await Promise.all([u.db.tutti('venditaeshop'), u.db.tutti('movbirra', { ancheEliminati: true }), u.db.leggi(ID_IMPOSTAZIONI), unghieEconomia('eshop')]);
  const inizio = impBirra && !impBirra.eliminato ? impBirra.inizio || '' : '';
  const magazzino = v => MAGAZZINO[statoMagazzino(v, movPerRif, inizio)];
  const tutte = vendite(record).sort((a, b) => b.ordinato.localeCompare(a.ordinato) || String(b.numero).localeCompare(String(a.numero), 'it', { numeric: true }));
  const movPerRif = new Map(movBirra.filter(m => m.origine === 'shopify' && m.rifEsterno && !m.eliminato).map(m => [m.rifEsterno, m]));
  const oggi = u.oggiISO();
  stato.dal ||= partenzaEshop(tutte, oggi, u.addGiorni);
  const anni = [...new Set([oggi.slice(0, 4), ...tutte.map(v => v.ordinato.slice(0, 4))])].sort().reverse();
  if (!filtro.anno || !anni.includes(filtro.anno)) filtro.anno = anni[0];
  if (filtro.mese && !filtro.mese.startsWith(filtro.anno)) filtro.mese = '';
  const delAnno = tutte.filter(v => v.ordinato.startsWith(filtro.anno));
  const elenco = filtro.mese ? delAnno.filter(v => v.ordinato.startsWith(filtro.mese)) : delAnno;
  const t = totaliEshop(elenco);
  const mesi = perMese(delAnno, filtro.anno);
  const tPrima = totaliEshop(tutte.filter(v => v.ordinato.startsWith(String(Number(filtro.anno) - 1)) && v.ordinato.slice(5) <= oggi.slice(5)));
  const daScaricare = tutte.filter(v => magazzino(v) === MAGAZZINO['da-scaricare']).length;
  const periodo = filtro.mese ? `${MESI[Number(filtro.mese.slice(5)) - 1].toLowerCase()} ${filtro.anno}` : filtro.anno;

  u.$app.innerHTML = html`
    <div class="barra"><h1 style="margin:0">Economia</h1></div>
    ${unghie}
    <div class="barra"><h2 style="margin:0">Eshop</h2><span class="spazio"></span>
      <button id="es-excel" ${tutte.length ? '' : 'disabled'}>Scarica Excel</button></div>
    <div class="home-kpi cs-kpi acc-kpi">
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Venduto ${periodo}</span><b>${euro(t.totale)}</b>
        <small>IVA e spedizioni comprese${!filtro.mese && tPrima.ordini ? ` · ${filtro.anno - 1} alla stessa data: ${euro(tPrima.totale)}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--accent)"><span>Ordini</span><b>${t.ordini}</b><small>${t.ordini ? `scontrino medio ${euro(t.medio)} · ${u.numIT(t.pezzi, 0)} articoli` : 'nessun ordine'}</small></div>
      <div class="w-kpi" style="--w:var(--ok)"><span>Spedizioni pagate dai clienti</span><b>${euro(t.spedizione)}</b><small>sconti fatti ${euro(t.sconti)}</small></div>
      ${daScaricare ? html`<a class="w-kpi w-kpi-btn" href="#/birra-importa/shopify" style="--w:var(--warn)"><span>Da scaricare dal magazzino</span><b>${daScaricare}</b><small>ordini spediti senza scarico birra: importali</small></a>`
        : html`<div class="w-kpi" style="--w:var(--warn)"><span>Rimborsi</span><b>${euro(t.rimborsato)}</b><small>già tolti dal venduto</small></div>`}
    </div>

    <div class="scheda solo-editori">
      <div class="barra" style="margin:0;align-items:flex-end">
        <label style="max-width:200px">Ordini dal <input type="date" id="es-dal" value="${stato.dal}"></label>
        <button class="primario" id="es-aggiorna" ${stato.carica ? 'disabled' : ''}>${stato.carica ? 'Aggiorno…' : 'Aggiorna da Shopify'}</button>
        <span class="spazio"></span>
        <a href="#/birra-importa/shopify" class="btn">⬇ Scarica dal magazzino birra</a>
      </div>
      <p class="totale">Gli ordini si aggiornano anche da soli ogni notte, se in Impostazioni → Automazioni è attivo l'import Shopify. Lo scarico della birra si fa da Magazzino → Birra (o in automatico per gli ordini spediti).</p>
      ${stato.errore ? html`<p class="totale" style="color:var(--warn)">${stato.errore}</p>
        ${/configurat/i.test(stato.errore) ? html`<p class="totale">Per collegare Shopify servono SHOPIFY_SHOP e SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (oppure SHOPIFY_TOKEN) nelle variabili d'ambiente di Netlify.</p>` : ''}` : ''}
    </div>

    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <div class="segmenti">${anni.map(a => html`<button data-anno="${a}" class="${a === filtro.anno ? 'attivo' : ''}">${a}</button>`)}</div>
        <span class="spazio"></span>
        <label style="max-width:180px">Mese <select id="es-mese"><option value="">Tutto l'anno</option>
          ${mesi.map(m => html`<option value="${m.mese}" ${m.mese === filtro.mese ? 'selected' : ''}>${MESI[Number(m.mese.slice(5)) - 1]}${m.ordini ? ` (${m.ordini})` : ''}</option>`)}</select></label>
      </div>
      ${filtro.mese ? '' : html`<div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Mese</th><th class="n">Ordini</th><th class="n">Venduto</th><th class="n">Spedizioni</th><th class="n">Rimborsi</th><th class="n">Medio</th></tr></thead>
        <tbody>${mesi.filter(m => m.ordini || m.mese <= oggi.slice(0, 7)).map(m => html`<tr data-mese="${m.mese}" class="${m.ordini ? '' : 'acc-vuoto'}" style="cursor:pointer">
          <td data-l="Mese"><b>${MESI[Number(m.mese.slice(5)) - 1]}</b></td>
          <td data-l="Ordini" class="n">${m.ordini || '—'}</td>
          <td data-l="Venduto" class="n">${m.ordini ? euro(m.totale) : '—'}</td>
          <td data-l="Spedizioni" class="n">${m.ordini ? euro(m.spedizione) : ''}</td>
          <td data-l="Rimborsi" class="n">${m.rimborsato ? euro(m.rimborsato) : ''}</td>
          <td data-l="Medio" class="n">${m.ordini ? euro(m.medio) : ''}</td></tr>`)}</tbody>
        <tfoot><tr><th>Totale</th><th class="n">${t.ordini}</th><th class="n">${euro(t.totale)}</th><th class="n">${euro(t.spedizione)}</th><th class="n">${euro(t.rimborsato)}</th><th class="n">${euro(t.medio)}</th></tr></tfoot>
      </table></div>`}
    </div>

    <div class="scheda">
      <h2 style="margin-top:0">Ordini ${periodo}</h2>
      ${!elenco.length ? html`<p class="vuoto">${tutte.length ? 'Nessun ordine in questo periodo.' : 'Nessun ordine ancora: premi "Aggiorna da Shopify".'}</p>` : html`
      <div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Data</th><th>Ordine</th><th>Articoli</th><th>Pagamento</th><th class="n">Spedizione</th><th class="n">Totale</th><th>Magazzino</th></tr></thead>
        <tbody>${elenco.map(v => {
          const mg = magazzino(v);
          return html`<tr>
            <td data-l="Data">${u.dataIT(v.ordinato)}${v.spedito && v.spedito !== v.ordinato ? html`<small class="totale"> sped. ${u.dataIT(v.spedito)}</small>` : ''}</td>
            <td data-l="Ordine"><b>${String(v.numero).replace(/^Ordine /, '')}</b>${v.canale && v.canale !== 'web' ? html` <span class="badge">${v.canale}</span>` : ''}</td>
            <td data-l="Articoli">${articoli(v) || '—'}</td>
            <td data-l="Pagamento">${v.pagamento}${v.rimborsato ? html`<small class="totale"> −${euro(v.rimborsato)}</small>` : ''}</td>
            <td data-l="Spedizione" class="n">${v.spedizione ? euro(v.spedizione) : ''}</td>
            <td data-l="Totale" class="n"><b>${euro(v.totale)}</b>${v.sconti ? html`<small class="totale"> sconto ${euro(v.sconti)}</small>` : ''}</td>
            <td data-l="Magazzino"><span class="badge ${mg.classe}">${mg.testo}</span></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr><th colspan="4">${t.ordini} ordini</th><th class="n">${euro(t.spedizione)}</th><th class="n">${euro(t.totale)}</th><th></th></tr></tfoot>
      </table></div>`}
    </div>`;

  u.$app.onclick = async e => {
    const el = e.target;
    const a = el.closest('[data-anno]');
    if (a) { filtro.anno = a.dataset.anno; filtro.mese = ''; return vistaEshop(); }
    const m = el.closest('tr[data-mese]');
    if (m) { filtro.mese = m.dataset.mese; return vistaEshop(); }
    if (el.id === 'es-aggiorna') { if (!stato.dal) return u.toast('Scegli la data'); return aggiorna(record); }
    if (el.id === 'es-excel') return scaricaExcel(tutte, magazzino);
  };
  u.$app.onchange = e => {
    if (e.target.id === 'es-dal') stato.dal = e.target.value;
    if (e.target.id === 'es-mese') { filtro.mese = e.target.value; vistaEshop(); }
  };
}

// Chiede gli ordini a Shopify (100 alla volta) e salva quelli nuovi o cambiati
async function aggiorna(record) {
  stato = { ...stato, carica: true, errore: '' };
  vistaEshop();
  const salvati = new Map(record.map(v => [v.id, v]));
  const visti = new Set();
  const nuovi = [];
  try {
    const tk = await u.token();
    let dal = stato.dal;
    for (let giro = 0; giro < 50; giro++) {
      const res = await fetch(`/.netlify/functions/shopify?${new URLSearchParams({ dal })}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
      let body = null;
      try { body = await res.json(); } catch { /* non JSON: app non online */ }
      if (!res.ok || !body) throw new Error(body?.errore || (res.status === 404 ? 'Shopify si collega solo quando l\'app è online sul suo sito.' : `Shopify: errore ${res.status}`));
      for (const d of body.documenti) {
        if (visti.has(d.id)) continue;
        visti.add(d.id);
        const v = venditaDaOrdine(d);
        if (!uguale(salvati.get(idVendita(d.id)), v)) nuovi.push(v);
      }
      // altri ordini: si riparte dal giorno dell'ultimo arrivato (i doppioni si saltano)
      const ultimo = body.documenti.map(d => d.ordinato).filter(Boolean).sort().pop();
      if (!body.altri || !ultimo || ultimo <= dal) break;
      dal = ultimo;
    }
    if (nuovi.length) await u.db.salvaMolti(nuovi);
    u.toast(nuovi.length ? `${nuovi.length} ordini salvati o aggiornati` : 'Nessun ordine nuovo');
    stato = { carica: false, errore: '', dal: null };
  } catch (ex) {
    stato = { ...stato, carica: false, errore: ex.message };
  }
  vistaEshop();
}

function scaricaExcel(tutte, magazzino) {
  const testa = v => v.map(x => ({ v: x, grassetto: true, sfondo: 'EEEEEE' }));
  const righe = [...tutte].reverse().map(v => [u.dataIT(v.ordinato), String(v.numero).replace(/^Ordine /, ''), articoli(v), v.pagamento, v.stato, v.spedito ? u.dataIT(v.spedito) : '',
    Number(v.lordo) || 0, Number(v.sconti) || 0, Number(v.spedizione) || 0, Number(v.rimborsato) || 0, Number(v.totale) || 0, magazzino(v).testo]);
  const anni = [...new Set(tutte.map(v => v.ordinato.slice(0, 4)))].sort();
  const mesi = anni.flatMap(a => perMese(tutte, a).filter(m => m.ordini).map(m => [`${MESI[Number(m.mese.slice(5)) - 1]} ${a}`, m.ordini, Math.round(m.totale * 100) / 100, Math.round(m.spedizione * 100) / 100, Math.round(m.rimborsato * 100) / 100]));
  const blob = creaXlsx([
    { nome: 'Ordini', righe: [testa(['Data', 'Ordine', 'Articoli', 'Pagamento', 'Spedizione', 'Spedito il', 'Totale ordine', 'Sconti', 'Costo spedizione', 'Rimborsato', 'Venduto', 'Magazzino']), ...righe], larghezze: [11, 9, 50, 14, 14, 11, 12, 10, 12, 11, 11, 14], blocca: { righe: 1 } },
    { nome: 'Per mese', righe: [testa(['Mese', 'Ordini', 'Venduto', 'Spedizioni', 'Rimborsi']), ...mesi], larghezze: [16, 8, 12, 12, 12], blocca: { righe: 1 } },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `eshop-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
