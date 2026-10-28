// Accise, Stipendi, F24 (#/accise, #/stipendi, #/f24) nella sezione Economia: totale mensile scritto a mano,
// pagato sì/no con la data, scadenza, riepiloghi dell'anno ed Excel. Come la cassa, non le vede chi è in sola lettura.

import { MESI, TIPI_MENSILI, conImporto, idMensile, mediaUltimi12, nomeMese, riepilogoMensile, scadenzaMese } from './mensili.js';
import { unghieEconomia } from './economia.js';
import { creaXlsx } from './xlsx.js';

let u; // { $app, html, db, toast, chiedi, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const annoScelto = {}; // tipo → anno mostrato
const anniAggiunti = {}; // tipo → anni passati ancora vuoti, aperti con "+ Anno" per compilarli
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const tondo = v => Math.round(Number(v) * 100) / 100;
const meseMin = mese => MESI[Number(mese.slice(5)) - 1].toLowerCase();

async function scadenzaDi(tipo) {
  const imp = await u.db.leggi(`impostazione-${tipo}`);
  const s = { ...TIPI_MENSILI[tipo].scadenza, ...(imp && !imp.eliminato ? { giorno: imp.giorno, meseDopo: imp.meseDopo } : {}) };
  return { giorno: Number(s.giorno) || 16, meseDopo: s.meseDopo !== false };
}

export async function vistaMensile(tipo) {
  const { html } = u;
  const T = TIPI_MENSILI[tipo];
  const ridisegna = () => vistaMensile(tipo);
  const [righe, scadenza, unghie] = await Promise.all([u.db.tutti(tipo), scadenzaDi(tipo), unghieEconomia(T.percorso)]);
  const oggi = u.oggiISO(), annoOggi = oggi.slice(0, 4);
  const aggiunti = (anniAggiunti[tipo] ||= new Set());
  const anni = [...new Set([annoOggi, ...aggiunti, ...righe.map(r => r.mese?.slice(0, 4)).filter(Boolean)])].sort().reverse();
  if (!annoScelto[tipo] || !anni.includes(annoScelto[tipo])) annoScelto[tipo] = annoOggi;
  const anno = annoScelto[tipo];
  const per = new Map(righe.map(r => [r.mese, r]));
  const rie = riepilogoMensile(righe, anno, oggi, scadenza);
  const m12 = mediaUltimi12(righe, oggi);
  const mesi = MESI.map((_, i) => `${anno}-${String(i + 1).padStart(2, '0')}`);
  const diff = rie.primaStessiMesi ? (rie.totale - rie.primaStessiMesi) / rie.primaStessiMesi * 100 : null;

  u.$app.innerHTML = html`
    <div class="barra"><h1 style="margin:0">Economia</h1></div>
    ${unghie}
    <div class="barra"><h2 style="margin:0">${T.titolo}</h2><span class="spazio"></span><button id="mn-excel">Scarica Excel</button></div>
    <div class="home-kpi cs-kpi acc-kpi">
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Totale ${anno}</span><b>${euro(rie.totale)}</b>
        <small>${rie.mesi} ${rie.mesi === 1 ? 'mese' : 'mesi'} inseriti${diff != null ? ` · ${diff >= 0 ? '+' : ''}${u.numIT(diff, 0)}% sugli stessi mesi del ${Number(anno) - 1}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--accent)"><span>Media mensile ${anno}</span><b>${euro(rie.media)}</b>
        <small>${m12.mesi ? `ultimi 12 mesi: ${euro(m12.media)}` : 'nessun mese negli ultimi 12'}${rie.maxMese ? ` · mese più alto ${meseMin(rie.maxMese.mese)}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--ok)"><span>Pagato ${anno}</span><b>${euro(rie.pagato)}</b><small>${rie.mesi - rie.nAperte} di ${rie.mesi}</small></div>
      <div class="w-kpi" style="--w:var(--warn)"><span>Da pagare ${anno}</span><b>${euro(rie.daPagare)}</b>
        <small>${rie.scadute.length ? `${rie.scadute.length} scadut${rie.scadute.length === 1 ? 'o' : 'i'}: ${rie.scadute.map(r => meseMin(r.mese)).join(', ')}` : rie.nAperte ? `${rie.nAperte} ${rie.nAperte === 1 ? 'mese' : 'mesi'}, nessuno scaduto` : 'tutto pagato'}</small></div>
    </div>

    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <div class="segmenti">${anni.map(a => html`<button data-anno="${a}" class="${a === anno ? 'attivo' : ''}">${a}</button>`)}</div>
        <span class="spazio"></span>
        <button id="mn-anno-nuovo" class="piccolo" title="Aggiungi un anno passato da compilare">+ Anno</button>
      </div>
      <p class="totale">Scrivi il totale del mese: si salva da solo. Spunta "Pagato" quando l'hai versato (la data si mette a oggi, puoi cambiarla).</p>
      <p class="mn-scad">Scadenza: il giorno <input type="number" name="sc-giorno" min="1" max="31" inputmode="numeric" value="${scadenza.giorno}">
        <select name="sc-mese"><option value="dopo" ${scadenza.meseDopo ? 'selected' : ''}>del mese dopo</option><option value="stesso" ${scadenza.meseDopo ? '' : 'selected'}>dello stesso mese</option></select></p>
      <div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Mese</th><th class="n">Totale €</th><th>Pagato</th><th>Data pagamento</th><th>Note</th></tr></thead>
        <tbody>${mesi.map(m => {
          const r = per.get(m);
          const c = conImporto(r);
          const sc = scadenzaMese(m, scadenza);
          const scaduta = c && !r.pagato && sc < oggi;
          const futuro = m > oggi.slice(0, 7);
          return html`<tr data-mese="${m}" class="${scaduta ? 'acc-scaduta' : ''} ${c ? '' : 'acc-vuoto'} ${futuro && !c ? 'acc-futuro' : ''}">
            <td data-l="Mese"><b>${MESI[Number(m.slice(5)) - 1]}</b><small class="totale"> scad. ${u.dataIT(sc)}</small>${scaduta ? html` <span class="badge cop-badge-ritardo">scaduta</span>` : ''}</td>
            <td data-l="Totale €" class="n"><input type="number" name="importo" step="0.01" min="0" inputmode="decimal" value="${c ? r.importo : ''}" placeholder="—"></td>
            <td data-l="Pagato"><label class="spunta"><input type="checkbox" name="pagato" ${r?.pagato ? 'checked' : ''} ${c ? '' : 'disabled'}> <span>${r?.pagato ? 'Sì' : 'No'}</span></label></td>
            <td data-l="Data pagamento"><input type="date" name="dataPagamento" value="${r?.dataPagamento || ''}" ${c ? '' : 'disabled'}></td>
            <td data-l="Note"><input name="note" value="${r?.note || ''}" placeholder="facoltativo" ${c ? '' : 'disabled'}></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr><th>Totale</th><th class="n">${euro(rie.totale)}</th><th colspan="3" class="totale">media ${euro(rie.media)} al mese${rie.haPrima ? ` · ${Number(anno) - 1}: ${euro(rie.primaTotale)}` : ''}</th></tr></tfoot>
      </table></div>
    </div>`;

  u.$app.onclick = async e => {
    const t = e.target;
    const a = t.closest('[data-anno]');
    if (a) { annoScelto[tipo] = a.dataset.anno; return ridisegna(); }
    if (t.id === 'mn-anno-nuovo') { annoScelto[tipo] = String(Number(anni.at(-1)) - 1); aggiunti.add(annoScelto[tipo]); return ridisegna(); }
    if (t.id === 'mn-excel') return scaricaExcel(tipo, righe, scadenza);
  };
  u.$app.onchange = async e => {
    const campo = e.target.name;
    if (campo === 'sc-giorno' || campo === 'sc-mese') {
      const box = e.target.closest('.mn-scad');
      const giorno = Math.min(31, Math.max(1, Math.round(Number(box.querySelector('[name=sc-giorno]').value) || 1)));
      await u.db.salva({ id: `impostazione-${tipo}`, tipo: 'impostazione', giorno, meseDopo: box.querySelector('[name=sc-mese]').value === 'dopo' });
      u.toast(`${T.titolo}: scadenza aggiornata`);
      return ridisegna();
    }
    const tr = e.target.closest('tr[data-mese]');
    if (!tr) return;
    const mese = tr.dataset.mese;
    const vecchio = (await u.db.leggi(idMensile(tipo, mese))) || { id: idMensile(tipo, mese), tipo, mese };
    const { aggiornato: _a, daSincronizzare: _d, ...rec } = vecchio;
    if (campo === 'importo') {
      const v = e.target.value.trim();
      if (v === '') {
        if (!vecchio.aggiornato) return;
        if (rec.pagato && !(await u.chiedi(`${T.titolo} ${nomeMese(mese)}: risulta pagato, cancellare comunque il totale?`, 'Cancella'))) return ridisegna();
        await u.db.elimina(rec.id);
        u.toast(`${T.titolo} ${nomeMese(mese)}: totale cancellato`);
        return ridisegna();
      }
      rec.importo = tondo(v);
      rec.eliminato = false;
    } else if (campo === 'pagato') {
      rec.pagato = e.target.checked;
      rec.dataPagamento = rec.pagato ? rec.dataPagamento || u.oggiISO() : null;
    } else if (campo === 'dataPagamento') {
      rec.dataPagamento = e.target.value || null;
      rec.pagato = !!rec.dataPagamento;
    } else if (campo === 'note') rec.note = e.target.value.trim();
    await u.db.salva(rec);
    if (campo === 'pagato' && rec.pagato) u.toast(`${T.titolo} ${nomeMese(mese)}: pagato il ${u.dataIT(rec.dataPagamento)}`);
    ridisegna();
  };
}

function scaricaExcel(tipo, righe, scadenza) {
  const T = TIPI_MENSILI[tipo];
  const testa = ['Mese', 'Totale', 'Pagato', 'Data pagamento', 'Scadenza', 'Note'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' }));
  const elenco = righe.filter(conImporto).sort((a, b) => a.mese.localeCompare(b.mese))
    .map(r => [nomeMese(r.mese), Number(r.importo) || 0, r.pagato ? 'Sì' : 'No', r.dataPagamento ? u.dataIT(r.dataPagamento) : '', u.dataIT(scadenzaMese(r.mese, scadenza)), r.note || '']);
  const anni = [...new Set(righe.filter(conImporto).map(r => r.mese.slice(0, 4)))].sort();
  const riass = [['Anno', 'Totale', 'Mesi', 'Media mensile', 'Pagato', 'Da pagare'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' })),
    ...anni.map(a => { const x = riepilogoMensile(righe, a, u.oggiISO(), scadenza); return [a, tondo(x.totale), x.mesi, tondo(x.media), tondo(x.pagato), tondo(x.daPagare)]; })];
  const blob = creaXlsx([
    { nome: T.titolo, righe: [testa, ...elenco], larghezze: [16, 12, 8, 15, 11, 30], blocca: { righe: 1 } },
    { nome: 'Per anno', righe: riass, larghezze: [8, 12, 6, 14, 12, 12], blocca: { righe: 1 } },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${T.percorso}-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
