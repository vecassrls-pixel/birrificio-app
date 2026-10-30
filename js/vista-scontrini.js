// Scontrini (#/scontrini) nella sezione Economia: corrispettivi del registratore telematico presi dal portale
// Fatture e Corrispettivi dell'Agenzia delle Entrate, per giorno, per mese e per anno, contanti e POS.
// Come la cassa, non la vede chi è in sola lettura. Logica in js/corrispettivi.js.

import { MESI } from './mensili.js';
import { daTabellaPortale, incasso, perAliquota, perGiorno, perMese, righeCsv, scontrini, totale, totaliScontrini, unisci } from './corrispettivi.js';
import { unghieEconomia } from './economia.js';
import { leggiXlsx } from './xlsx-leggi.js';
import { creaXlsx } from './xlsx.js';

let u; // { $app, html, db, toast, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const filtro = { anno: null, mese: '' }; // mese '' = tutto l'anno, altrimenti 'AAAA-MM'
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const nomeMese = m => MESI[Number(m.slice(5)) - 1];
const URL_PORTALE = 'https://ivaservizi.agenziaentrate.gov.it/portale/';

export async function vistaScontrini() {
  const { html } = u;
  const [record, unghie] = await Promise.all([u.db.tutti('corrispettivo'), unghieEconomia('scontrini')]);
  const tutti = scontrini(record);
  const oggi = u.oggiISO();
  const anni = [...new Set([oggi.slice(0, 4), ...tutti.map(r => r.data.slice(0, 4))])].sort().reverse();
  if (!filtro.anno || !anni.includes(filtro.anno)) filtro.anno = anni[0];
  if (filtro.mese && !filtro.mese.startsWith(filtro.anno)) filtro.mese = '';
  const delAnno = tutti.filter(r => r.data.startsWith(filtro.anno));
  const elenco = filtro.mese ? delAnno.filter(r => r.data.startsWith(filtro.mese)) : delAnno;
  const t = totaliScontrini(elenco);
  const mesi = perMese(delAnno, filtro.anno);
  const giorni = perGiorno(elenco);
  const aliquote = perAliquota(elenco);
  const prima = totaliScontrini(tutti.filter(r => r.data.startsWith(String(Number(filtro.anno) - 1)) && r.data.slice(5) <= oggi.slice(5)));
  const ultimo = tutti.map(r => r.data).sort().pop();
  const periodo = filtro.mese ? `${nomeMese(filtro.mese).toLowerCase()} ${filtro.anno}` : filtro.anno;
  const diviso = t.contanti + t.elettronico;

  u.$app.innerHTML = html`
    <div class="barra"><h1 style="margin:0">Economia</h1></div>
    ${unghie}
    <div class="barra"><h2 style="margin:0">Scontrini</h2><span class="spazio"></span>
      <button id="sc-excel" ${tutti.length ? '' : 'disabled'}>Scarica Excel</button>
      <label class="btn solo-editori">Importa dal portale<input type="file" id="sc-importa" accept=".csv,.txt,.xlsx" hidden></label></div>
    <div class="home-kpi cs-kpi acc-kpi">
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Incassato ${periodo}</span><b>${euro(t.totale)}</b>
        <small>IVA compresa${!filtro.mese && prima.chiusure ? ` · ${Number(filtro.anno) - 1} alla stessa data: ${euro(prima.totale)}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--accent)"><span>Giorni con vendite</span><b>${t.giorni}</b>
        <small>${t.giorni ? `media ${euro(t.medioGiorno)} al giorno${t.documenti ? ` · ${t.documenti} scontrini, medio ${euro(t.medioScontrino)}` : ''}` : 'nessuna vendita'}</small></div>
      <div class="w-kpi" style="--w:var(--ok)"><span>Contanti / POS</span><b>${diviso ? `${u.numIT(t.contanti / diviso * 100, 0)}% / ${u.numIT(t.elettronico / diviso * 100, 0)}%` : '—'}</b>
        <small>${diviso ? `${euro(t.contanti)} contanti · ${euro(t.elettronico)} POS` : ''}${t.nonDiviso ? ` · ${euro(t.nonDiviso)} senza dettaglio` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--warn)"><span>IVA sui corrispettivi</span><b>${euro(t.imposta)}</b>
        <small>${aliquote.filter(a => a.aliquota != null).map(a => `${u.numIT(a.aliquota, 0)}%: ${euro(a.imposta)}`).join(' · ') || `imponibile ${euro(t.imponibile)}`}</small></div>
    </div>

    <div class="scheda solo-editori">
      <p class="totale" style="margin:0">Dati dal portale <a href="${URL_PORTALE}" target="_blank" rel="noopener">Fatture e Corrispettivi</a>${ultimo ? ` · ultima chiusura ${u.dataIT(ultimo)}` : ''}.
        Per aggiungere i giorni nuovi: Consultazione → Corrispettivi → Invii/Aggregati giornalieri, scegli il periodo (massimo 3 mesi), apri l'elenco dei registratori telematici,
        "Esporta la tabella" e carica qui il file con "Importa dal portale". Contanti e POS li ha solo il dettaglio di ogni invio: per quelli chiedi a Claude, che li legge dal portale.</p>
    </div>

    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <div class="segmenti">${anni.map(a => html`<button data-anno="${a}" class="${a === filtro.anno ? 'attivo' : ''}">${a}</button>`)}</div>
        <span class="spazio"></span>
        <label style="max-width:180px">Mese <select id="sc-mese"><option value="">Tutto l'anno</option>
          ${mesi.map(m => html`<option value="${m.mese}" ${m.mese === filtro.mese ? 'selected' : ''}>${nomeMese(m.mese)}${m.giorni ? ` (${m.giorni})` : ''}</option>`)}</select></label>
      </div>
      ${filtro.mese ? '' : html`<div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Mese</th><th class="n">Giorni</th><th class="n">Incassato</th><th class="n">Contanti</th><th class="n">POS</th><th class="n">IVA</th><th class="n">Media al giorno</th></tr></thead>
        <tbody>${mesi.filter(m => m.giorni || m.mese <= oggi.slice(0, 7)).map(m => html`<tr data-mese="${m.mese}" class="${m.giorni ? '' : 'acc-vuoto'}" style="cursor:pointer">
          <td data-l="Mese"><b>${nomeMese(m.mese)}</b></td>
          <td data-l="Giorni" class="n">${m.giorni || '—'}</td>
          <td data-l="Incassato" class="n">${m.giorni ? html`<b>${euro(m.totale)}</b>` : '—'}</td>
          <td data-l="Contanti" class="n">${m.contanti ? euro(m.contanti) : ''}</td>
          <td data-l="POS" class="n">${m.elettronico ? euro(m.elettronico) : ''}${m.nonDiviso ? html`<small class="totale"> + ${euro(m.nonDiviso)} n.d.</small>` : ''}</td>
          <td data-l="IVA" class="n">${m.giorni ? euro(m.imposta) : ''}</td>
          <td data-l="Media al giorno" class="n">${m.giorni ? euro(m.medioGiorno) : ''}</td></tr>`)}</tbody>
        <tfoot><tr><th>Totale</th><th class="n">${t.giorni}</th><th class="n">${euro(t.totale)}</th><th class="n">${euro(t.contanti)}</th><th class="n">${euro(t.elettronico)}</th><th class="n">${euro(t.imposta)}</th><th class="n">${euro(t.medioGiorno)}</th></tr></tfoot>
      </table></div>`}
    </div>

    <div class="scheda">
      <h2 style="margin-top:0">Giorno per giorno ${periodo}</h2>
      ${!giorni.length ? html`<p class="vuoto">${tutti.length ? 'Nessuna vendita in questo periodo.' : 'Nessuno scontrino ancora: importa la tabella dal portale.'}</p>` : html`
      <div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Giorno</th><th class="n">Scontrini</th><th class="n">Incassato</th><th class="n">Contanti</th><th class="n">POS</th><th class="n">IVA</th><th>Aliquote</th></tr></thead>
        <tbody>${giorni.map(g => html`<tr>
          <td data-l="Giorno"><b>${u.dataIT(g.data)}</b>${g.chiusure > 1 ? html`<small class="totale"> ${g.chiusure} chiusure</small>` : ''}</td>
          <td data-l="Scontrini" class="n">${g.documenti || ''}</td>
          <td data-l="Incassato" class="n"><b>${euro(g.totale)}</b></td>
          <td data-l="Contanti" class="n">${g.nonDiviso ? html`<small class="totale">n.d.</small>` : g.contanti ? euro(g.contanti) : ''}</td>
          <td data-l="POS" class="n">${g.nonDiviso ? '' : g.elettronico ? euro(g.elettronico) : ''}</td>
          <td data-l="IVA" class="n">${euro(g.imposta)}</td>
          <td data-l="Aliquote">${perAliquota(g.invii).filter(a => a.aliquota != null).map(a => `${u.numIT(a.aliquota, 0)}%`).join(' + ')}</td></tr>`)}</tbody>
        <tfoot><tr><th>${t.giorni} giorni</th><th class="n">${t.documenti || ''}</th><th class="n">${euro(t.totale)}</th><th class="n">${euro(t.contanti)}</th><th class="n">${euro(t.elettronico)}</th><th class="n">${euro(t.imposta)}</th><th></th></tr></tfoot>
      </table></div>`}
    </div>`;

  u.$app.onclick = e => {
    const el = e.target;
    const a = el.closest('[data-anno]');
    if (a) { filtro.anno = a.dataset.anno; filtro.mese = ''; return vistaScontrini(); }
    const m = el.closest('tr[data-mese]');
    if (m) { filtro.mese = m.dataset.mese; return vistaScontrini(); }
    if (el.id === 'sc-excel') return scaricaExcel(tutti);
  };
  u.$app.onchange = async e => {
    if (e.target.id === 'sc-mese') { filtro.mese = e.target.value; return vistaScontrini(); }
    if (e.target.id === 'sc-importa') {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await importa(file, record);
    }
  };
}

async function importa(file, record) {
  try {
    const righe = /\.xlsx$/i.test(file.name)
      ? (await leggiXlsx(await file.arrayBuffer())).flatMap(f => f.righe)
      : righeCsv(await file.text());
    const letti = daTabellaPortale(righe);
    if (!letti.length) return u.toast('Nel file non ci sono giorni con vendite');
    const daSalvare = unisci(record, letti);
    if (daSalvare.length) await u.db.salvaMolti(daSalvare);
    u.toast(daSalvare.length ? `${daSalvare.length} chiusure nuove o aggiornate (su ${letti.length} nel file)` : `Già tutto presente (${letti.length} chiusure nel file)`);
    vistaScontrini();
  } catch (ex) {
    u.toast(ex.message);
  }
}

function scaricaExcel(tutti) {
  const testa = v => v.map(x => ({ v: x, grassetto: true, sfondo: 'EEEEEE' }));
  const ordinati = [...tutti].sort((a, b) => a.rilevato.localeCompare(b.rilevato));
  const righe = ordinati.map(r => {
    const i = incasso(r);
    return [u.dataIT(r.data), r.rilevato.slice(11, 16), r.idInvio, r.matricola || '', Number(r.documenti) || '', totale(r), Number(r.imponibile) || 0, Number(r.imposta) || 0,
      i.nonDiviso ? '' : i.contanti, i.nonDiviso ? '' : i.elettronico, (r.aliquote || []).map(a => `${u.numIT(a.aliquota, 0)}%`).join(' + ')];
  });
  const anni = [...new Set(tutti.map(r => r.data.slice(0, 4)))].sort();
  const tondo = v => Math.round(v * 100) / 100;
  const mesi = anni.flatMap(a => perMese(tutti, a).filter(m => m.giorni).map(m => [`${nomeMese(m.mese)} ${a}`, m.giorni, m.documenti || '', tondo(m.totale), tondo(m.imponibile), tondo(m.imposta), tondo(m.contanti), tondo(m.elettronico), tondo(m.nonDiviso)]));
  const blob = creaXlsx([
    { nome: 'Chiusure', righe: [testa(['Giorno', 'Ora', 'Id invio', 'Matricola', 'Scontrini', 'Incassato', 'Imponibile', 'IVA', 'Contanti', 'POS', 'Aliquote']), ...righe], larghezze: [11, 6, 12, 13, 9, 11, 11, 10, 10, 10, 12], blocca: { righe: 1 } },
    { nome: 'Per mese', righe: [testa(['Mese', 'Giorni', 'Scontrini', 'Incassato', 'Imponibile', 'IVA', 'Contanti', 'POS', 'Senza dettaglio']), ...mesi], larghezze: [16, 7, 9, 12, 12, 10, 11, 11, 13], blocca: { righe: 1 } },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scontrini-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
