// Accise (#/accise): totale mensile scritto a mano, pagato sì/no con la data, riepiloghi dell'anno e Excel.
// Come la cassa, non la vede chi è in sola lettura.

import { MESI, idAccisa, mediaUltimi12, nomeMese, riepilogoAccise, scadenzaAccisa } from './accise.js';
import { creaXlsx } from './xlsx.js';

let u; // { $app, html, db, toast, chiedi, dataIT, numIT, oggiISO }
export function init(strumenti) { u = strumenti; }

const filtro = { anno: null };
const anniAggiunti = new Set(); // anni passati ancora vuoti, aperti con "+ Anno" per compilarli
const euro = v => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const tondo = v => Math.round(Number(v) * 100) / 100;

export async function vistaAccise() {
  const { html } = u;
  const accise = await u.db.tutti('accisa');
  const oggi = u.oggiISO(), annoOggi = oggi.slice(0, 4);
  const anni = [...new Set([annoOggi, ...anniAggiunti, ...accise.map(r => r.mese?.slice(0, 4)).filter(Boolean)])].sort().reverse();
  if (!filtro.anno || !anni.includes(filtro.anno)) filtro.anno = annoOggi;
  const per = new Map(accise.map(r => [r.mese, r]));
  const rie = riepilogoAccise(accise, filtro.anno, oggi);
  const m12 = mediaUltimi12(accise, oggi);
  const mesi = MESI.map((_, i) => `${filtro.anno}-${String(i + 1).padStart(2, '0')}`);
  const diff = rie.primaStessiMesi ? (rie.totale - rie.primaStessiMesi) / rie.primaStessiMesi * 100 : null;

  u.$app.innerHTML = html`
    <div class="barra"><a class="btn" href="#/cassa">← Cassa</a><h1 style="margin:0">Accise</h1><span class="spazio"></span>
      <button id="ac-excel">Scarica Excel</button></div>
    <div class="home-kpi cs-kpi acc-kpi">
      <div class="w-kpi" style="--w:var(--s-pianificata)"><span>Totale ${filtro.anno}</span><b>${euro(rie.totale)}</b>
        <small>${rie.mesi} ${rie.mesi === 1 ? 'mese' : 'mesi'} inseriti${diff != null ? ` · ${diff >= 0 ? '+' : ''}${u.numIT(diff, 0)}% sugli stessi mesi del ${Number(filtro.anno) - 1}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--accent)"><span>Media mensile ${filtro.anno}</span><b>${euro(rie.media)}</b>
        <small>${m12.mesi ? `ultimi 12 mesi: ${euro(m12.media)}` : 'nessun mese negli ultimi 12'}${rie.maxMese ? ` · mese più alto ${MESI[Number(rie.maxMese.mese.slice(5)) - 1].toLowerCase()}` : ''}</small></div>
      <div class="w-kpi" style="--w:var(--ok)"><span>Pagato ${filtro.anno}</span><b>${euro(rie.pagato)}</b><small>${rie.mesi - rie.nAperte} di ${rie.mesi}</small></div>
      <div class="w-kpi" style="--w:var(--warn)"><span>Da pagare</span><b>${euro(rie.daPagare)}</b>
        <small>${rie.scadute.length ? `${rie.scadute.length} scadut${rie.scadute.length === 1 ? 'o' : 'i'}: ${rie.scadute.map(r => MESI[Number(r.mese.slice(5)) - 1].toLowerCase()).join(', ')}` : rie.nAperte ? `${rie.nAperte} ${rie.nAperte === 1 ? 'mese' : 'mesi'}, nessuno scaduto` : 'tutto pagato'}</small></div>
    </div>

    <div class="scheda">
      <div class="barra" style="margin-top:0">
        <div class="segmenti">${anni.map(a => html`<button data-anno="${a}" class="${a === filtro.anno ? 'attivo' : ''}">${a}</button>`)}</div>
        <span class="spazio"></span>
        <button id="ac-anno-nuovo" class="piccolo" title="Aggiungi un anno passato da compilare">+ Anno</button>
      </div>
      <p class="totale">Scrivi il totale del mese: si salva da solo. Spunta "Pagato" quando l'hai versato (la data si mette a oggi, puoi cambiarla). Scadenza: il 16 del mese dopo.</p>
      <div class="scroll-x"><table class="tab-mag acc-tab">
        <thead><tr><th>Mese</th><th class="n">Totale €</th><th>Pagato</th><th>Data pagamento</th><th>Note</th></tr></thead>
        <tbody>${mesi.map(m => {
          const r = per.get(m);
          const c = r?.importo != null && r.importo !== '';
          const sc = scadenzaAccisa(m);
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
        <tfoot><tr><th>Totale</th><th class="n">${euro(rie.totale)}</th><th colspan="3" class="totale">media ${euro(rie.media)} al mese${rie.haPrima ? ` · ${Number(filtro.anno) - 1}: ${euro(rie.primaTotale)}` : ''}</th></tr></tfoot>
      </table></div>
    </div>`;

  u.$app.onclick = async e => {
    const t = e.target;
    const a = t.closest('[data-anno]');
    if (a) { filtro.anno = a.dataset.anno; return vistaAccise(); }
    if (t.id === 'ac-anno-nuovo') { filtro.anno = String(Number(anni.at(-1)) - 1); anniAggiunti.add(filtro.anno); return vistaAccise(); }
    if (t.id === 'ac-excel') return scaricaExcel(accise);
  };
  u.$app.onchange = async e => {
    const tr = e.target.closest('tr[data-mese]');
    if (!tr) return;
    const mese = tr.dataset.mese;
    const vecchio = (await u.db.leggi(idAccisa(mese))) || { id: idAccisa(mese), tipo: 'accisa', mese };
    const { aggiornato: _a, daSincronizzare: _d, ...rec } = vecchio;
    const campo = e.target.name;
    if (campo === 'importo') {
      const v = e.target.value.trim();
      if (v === '') {
        if (!vecchio.aggiornato) return;
        if (rec.pagato && !(await u.chiedi(`${nomeMese(mese)} risulta pagato: cancellare comunque il totale?`, 'Cancella'))) return vistaAccise();
        await u.db.elimina(rec.id);
        u.toast(`${nomeMese(mese)}: totale cancellato`);
        return vistaAccise();
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
    if (campo === 'pagato' && rec.pagato) u.toast(`${nomeMese(mese)}: pagato il ${u.dataIT(rec.dataPagamento)}`);
    vistaAccise();
  };
}

function scaricaExcel(accise) {
  const testa = ['Mese', 'Totale', 'Pagato', 'Data pagamento', 'Scadenza', 'Note'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' }));
  const righe = accise.filter(r => r.importo != null && r.importo !== '').sort((a, b) => a.mese.localeCompare(b.mese))
    .map(r => [nomeMese(r.mese), Number(r.importo) || 0, r.pagato ? 'Sì' : 'No', r.dataPagamento ? u.dataIT(r.dataPagamento) : '', u.dataIT(scadenzaAccisa(r.mese)), r.note || '']);
  const anni = [...new Set(accise.map(r => r.mese.slice(0, 4)))].sort();
  const riass = [['Anno', 'Totale', 'Mesi', 'Media mensile', 'Pagato', 'Da pagare'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' })),
    ...anni.map(a => { const x = riepilogoAccise(accise, a, u.oggiISO()); return [a, tondo(x.totale), x.mesi, tondo(x.media), tondo(x.pagato), tondo(x.daPagare)]; })];
  const blob = creaXlsx([
    { nome: 'Accise', righe: [testa, ...righe], larghezze: [16, 12, 8, 15, 11, 30], blocca: { righe: 1 } },
    { nome: 'Per anno', righe: riass, larghezze: [8, 12, 6, 14, 12, 12], blocca: { righe: 1 } },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `accise-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
