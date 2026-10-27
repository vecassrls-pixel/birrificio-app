// Pagina "Da ordinare": materie prime che servono alle cotte pianificate, divise per fornitore,
// con il testo dell'ordine da copiare.

import { decimaliUnita, giacenze } from './magazzino.js';
import { fabbisogno, testoOrdine, ID_ORDINATI, ordinatiDa } from './ordine.js';

let u; // { $app, html, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni, copia }
export function init(strumenti) { u = strumenti; }

const PREF = 'gb-ordine';
function leggiPref() {
  try { return { settimane: 6, anticipo: 7, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { settimane: 6, anticipo: 7 }; }
}
function scriviPref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* navigazione privata */ } }
const fmt = (n, unita) => `${u.numIT(n, decimaliUnita(unita))} ${unita}`;

export async function vistaOrdine() {
  const { html } = u;
  const pref = leggiPref();
  const [articoli, bolle, inventari, scarichi] = await Promise.all(['articolo', 'bolla', 'inventario', 'scarico'].map(t => u.db.tutti(t)));
  const recOrd = await u.db.leggi(ID_ORDINATI);
  const ordinati = ordinatiDa(recOrd && !recOrd.eliminato ? recOrd : null, bolle);
  const dati = { articoli, bolle, inventari, scarichi, cotte: u.stato.cotte };
  const oggi = u.oggiISO();
  const fino = u.addGiorni(oggi, pref.settimane * 7);
  const { righe, scollegati } = fabbisogno(giacenze(dati, oggi), dati, { fino, anticipo: pref.anticipo, oggi, ordinati });
  const perFornitore = new Map();
  for (const r of righe) {
    const k = r.fornitore || 'Fornitore non indicato';
    if (!perFornitore.has(k)) perFornitore.set(k, []);
    perFornitore.get(k).push(r);
  }
  const daFare = u.stato.cotte.filter(c => c.data && c.data > oggi && c.data <= fino && !c.eliminato).sort((a, b) => a.data.localeCompare(b.data));
  const senzaMp = daFare.filter(c => !c.materiePrime);

  u.$app.innerHTML = html`
    <div class="barra"><a href="#/materie-prime" class="btn">← Materie prime</a><h1 style="margin:0">Da ordinare</h1></div>
    <div class="scheda">
      <div class="griglia">
        <label>Cotte fino a <select id="ord-sett" class="st-libero">${[2, 4, 6, 8, 12, 16].map(n => html`<option value="${n}" ${n === pref.settimane ? 'selected' : ''}>${n} settimane (${u.dataIT(u.addGiorni(oggi, n * 7))})</option>`)}</select></label>
        <label>Giorni di consegna <input id="ord-anticipo" class="st-libero" type="number" min="0" step="1" inputmode="numeric" value="${pref.anticipo}"></label>
      </div>
      <p class="totale">${righe.some(r => r.ordinato) ? `${righe.filter(r => r.ordinato).length} già ordinati (spuntati), restano in fondo finché non carichi la bolla. ` : ''}${daFare.length} cotte pianificate in questo periodo${senzaMp.length ? `, ${senzaMp.length} senza la spunta "materie prime ordinate"` : ''}. Il calcolo parte dalla giacenza di oggi, toglie ricette e DH delle cotte pianificate, aggiunge le bolle con data futura e tiene la scorta minima.</p>
    </div>
    ${!righe.length ? html`<div class="scheda"><p style="margin:0">✓ Non serve ordinare niente per le cotte fino al ${u.dataIT(fino)}.</p></div>` : ''}
    ${[...perFornitore].map(([forn, rr], gi) => html`<div class="scheda">
      <div class="barra" style="margin-top:0"><h2 style="margin:0">${forn}</h2><span class="spazio"></span>
        <button class="piccolo st-libero" data-copia-ord="${gi}">⧉ Copia ordine</button></div>
      <div class="scroll-x"><table class="tab-mag">
        <thead><tr><th title="Spunta quando hai fatto l'ordine: resta finché non carichi la bolla">Ordinato</th><th>Articolo</th><th class="n">Giacenza</th><th class="n">Serve</th><th class="n">In arrivo</th><th class="n">Da ordinare</th><th>Ordina entro</th><th>Per le cotte</th></tr></thead>
        <tbody>${rr.map(r => html`<tr class="${r.urgente ? 'neg' : ''} ${r.ordinato ? 'ordinato' : ''}">
          <td><label class="spunta" style="min-height:34px" title="Spunta quando hai fatto l'ordine: resta finché non carichi la bolla"><input type="checkbox" data-ord="${r.articolo.id}" ${r.ordinato ? 'checked' : ''}>${r.ordinato ? html` <span class="totale">${u.dataIT(r.ordinato)}</span>` : ''}</label></td>
          <td><a href="#/materia/${encodeURIComponent(r.articolo.id)}">${r.articolo.nome}</a></td>
          <td class="n">${fmt(r.giacenza, r.articolo.unita)}${r.negativa ? html`<div class="totale" style="margin:0" title="Le cotte hanno scaricato più di quanto risulta caricato: fai l'inventario. Il calcolo parte da zero.">fai l'inventario</div>` : ''}</td>
          <td class="n">${fmt(r.serve, r.articolo.unita)}</td>
          <td class="n">${r.inArrivo ? fmt(r.inArrivo, r.articolo.unita) : '—'}</td>
          <td class="n"><b>${fmt(r.ordina, r.articolo.unita)}</b>${r.pezzi ? html`<div class="totale" style="margin:0">${r.pezzi} × ${u.numIT(r.articolo.pesoPezzo)} ${r.articolo.unita}</div>` : ''}</td>
          <td>${r.urgente ? html`<b>subito</b>` : u.dataIT(r.entro)}<div class="totale" style="margin:0">manca dal ${u.dataIT(r.quando)}</div></td>
          <td>${r.cotte.map((c, i) => html`${i ? ', ' : ''}<a href="#/cotta/${encodeURIComponent(c.id)}">${c.rif}</a>`)}</td>
        </tr>`)}</tbody></table></div></div>`)}
    ${scollegati.length ? html`<div class="scheda"><h2>Ingredienti non collegati al magazzino</h2>
      <p class="totale">Questi ingredienti delle cotte pianificate non corrispondono a nessun articolo, quindi non sono nel calcolo. Collegali dalla pagina Materie prime.</p>
      <div class="scroll-x"><table class="tab-mag"><thead><tr><th>Nome nella ricetta</th><th class="n">Quantità</th><th>Cotte</th></tr></thead>
      <tbody>${scollegati.map(s => html`<tr><td>${s.nome}</td><td class="n">${u.numIT(s.qta, decimaliUnita(s.unita) || 2)} ${s.unita}</td><td>${s.cotte.join(', ')}</td></tr>`)}</tbody></table></div></div>` : ''}
    ${senzaMp.length ? html`<div class="scheda solo-editori"><h2>Dopo aver ordinato</h2>
      <p class="totale">Spunta "Materie prime ordinate o in magazzino" sulle cotte pianificate fino al ${u.dataIT(fino)}: nel planning il numero di cotta diventa verde.</p>
      <button id="ord-segna">Segna ordinate ${senzaMp.length} cotte</button></div>` : ''}`;

  u.$app.onchange = async e => {
    if (e.target.dataset.ord) {
      const id = e.target.dataset.ord;
      const rec = (await u.db.leggi(ID_ORDINATI)) || {};
      const segnati = { ...(rec.eliminato ? {} : rec.segnati || {}) };
      if (e.target.checked) segnati[id] = oggi; else delete segnati[id];
      // via i segni già superati da una bolla
      for (const k of Object.keys(segnati)) if (!ordinatiDa({ segnati: { [k]: segnati[k] } }, bolle).has(k)) delete segnati[k];
      await u.db.salva({ id: ID_ORDINATI, tipo: 'impostazione', segnati });
      vistaOrdine();
      return;
    }
    if (e.target.id === 'ord-sett') { scriviPref({ ...pref, settimane: Number(e.target.value) }); vistaOrdine(); }
    if (e.target.id === 'ord-anticipo') { scriviPref({ ...pref, anticipo: Math.max(0, Number(e.target.value) || 0) }); vistaOrdine(); }
  };
  u.$app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.copiaOrd !== undefined) {
      const [forn, rr] = [...perFornitore][Number(t.dataset.copiaOrd)];
      const daCopiare = rr.filter(r => !r.ordinato);
      if (!daCopiare.length) return u.toast('Tutto già ordinato per questo fornitore');
      u.copia(`Ordine ${forn.startsWith('Fornitore') ? '' : forn} del ${u.dataIT(oggi)}\n${testoOrdine(daCopiare, u.numIT)}`.replace('Ordine  del', 'Ordine del'));
    } else if (t.id === 'ord-segna') {
      if (!(await u.chiedi(`Segnare le materie prime come ordinate su ${senzaMp.length} cotte pianificate fino al ${u.dataIT(fino)}?`, 'Segna'))) return;
      await u.db.salvaMolti(senzaMp.map(({ aggiornato: _a, ...c }) => ({ ...c, materiePrime: true })));
      u.toast(`${senzaMp.length} cotte segnate`);
    }
  };
}
