// Etichetta per i fusti e per i cartoni di lattine da stampare sulla Brother QL-700 (rotolo continuo da 62 mm).
// Con il QR di uso interno (js/qr.js): inquadrato apre il lotto nell'app e scarica il fusto o il cartone.
// Si stampa dal browser: l'etichetta va in un iframe con il suo formato pagina (62 mm × lunghezza),
// così non dipende dagli stili dell'app. Nella stampa scegliere la QL-700 e il rotolo 62 mm.

import { LOGO_KASHMIR } from './logo-kashmir.js';
import { linkQr, svgQr } from './qr.js';

const PREF = 'gb-etichetta-2'; // -2: nuovi testi di default (Romain, 2026-10-13)
const ALLERGENI = /\b(ORZO|FRUMENTO|AVENA|SEGALE|FARRO|KAMUT|GLUTINE|LATTOSIO|LATTE|SOLFITI)\b/g;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function leggiPref() {
  try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; }
}
function scriviPref(p) {
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* niente */ }
}
// lattine in un cartone, come scritto sull'ultima etichetta cartone (serve anche al carrello)
export const pezziCartone = () => Number(leggiPref().pezziCartone) || 24;

// Ingredienti dalla ricetta, con gli allergeni in maiuscolo (in stampa vanno in grassetto)
export function ingredientiDa(c) {
  const voci = ['acqua'];
  for (const r of c.malti || []) {
    const n = String(r.nome || '').toLowerCase();
    if (/lolla|husk|hull/.test(n)) continue;
    const fiocchi = /fiocc|flake/.test(n);
    const v = /frument|wheat|weiz/.test(n) ? `${fiocchi ? 'fiocchi' : 'malto'} di FRUMENTO`
      : /avena|oat/.test(n) ? `${fiocchi ? 'fiocchi' : 'malto'} di AVENA`
      : /segale|rye|roggen/.test(n) ? `${fiocchi ? 'fiocchi' : 'malto'} di SEGALE`
      : /farro|spelt|dinkel/.test(n) ? `${fiocchi ? 'fiocchi' : 'malto'} di FARRO`
      : /mais|corn/.test(n) ? 'mais'
      : /riso|rice/.test(n) ? 'riso'
      : /zucchero|sugar|destros|candi/.test(n) ? 'zucchero'
      : /miele|honey/.test(n) ? 'miele'
      : /lattos|lactose/.test(n) ? 'LATTOSIO'
      : `${fiocchi ? 'fiocchi' : 'malto'} d'ORZO`;
    if (!voci.includes(v)) voci.push(v);
  }
  if ((c.luppoli || []).length) voci.push('luppolo');
  if ((c.lievito || []).length) voci.push('lievito');
  const testo = voci.join(', ');
  return testo.charAt(0).toUpperCase() + testo.slice(1) + '.';
}

// "2027-10" → "10/2027"
const meseAnno = m => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : '');

export function htmlEtichetta(d) {
  const L = Math.max(40, Number(d.lunghezza) || 100);
  const ingr = esc(d.ingredienti).replace(ALLERGENI, '<b>$1</b>');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Etichetta ${esc(d.birra)}</title>
<style>
  @page { size: 62mm ${L}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: 62mm; height: ${L}mm; font-family: Arial, Helvetica, sans-serif; overflow: hidden; }
  .et { width: 62mm; height: ${L}mm; padding: 3mm 3.5mm; display: flex; flex-direction: column; gap: 1.6mm; text-align: center; }
  .logo { width: 36mm; margin: 0 auto; display: block; }
  .nome { font-size: 17pt; font-weight: 800; text-transform: uppercase; line-height: 1.05; letter-spacing: .3pt; }
  .stile { font-size: 8pt; margin-top: -1mm; }
  .grado { font-size: 12pt; font-weight: 700; border-top: .3mm solid #000; border-bottom: .3mm solid #000; padding: .8mm 0; }
  .ingr { font-size: 6.6pt; line-height: 1.25; text-align: left; }
  .lotto { font-size: 7.4pt; line-height: 1.3; text-align: left; }
  .prod { font-size: 6.2pt; line-height: 1.25; text-align: left; white-space: pre-line; margin-top: auto; }
  .cons { font-size: 6.2pt; text-align: left; }
  .piede { display: flex; gap: 2mm; align-items: flex-end; margin-top: auto; }
  .piede .prod { margin-top: 0; flex: 1; }
  .qr { width: 16mm; height: 16mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
</style></head><body><div class="et">
  <img class="logo" src="${LOGO_KASHMIR}" alt="">
  <div class="nome">${esc(d.birra)}</div>
  ${d.stile ? `<div class="stile">${esc(d.stile)}</div>` : ''}
  <div class="grado">${esc([d.alcol ? `${d.alcol}% vol` : '', d.formato].filter(Boolean).join(' · '))}</div>
  <div class="ingr"><b>Ingredienti:</b> ${ingr}</div>
  <div class="lotto"><b>Lotto:</b> ${esc(d.lotto)}<br><b>Da consumarsi preferibilmente entro fine:</b> ${esc(d.scadenza)}</div>
  ${d.conservazione ? `<div class="cons">${esc(d.conservazione)}</div>` : ''}
  ${d.qr ? `<div class="piede"><div class="prod">${esc(d.produttore)}</div><div class="qr">${d.qr}</div></div>` : `<div class="prod">${esc(d.produttore)}</div>`}
</div></body></html>`;
}

// Dialog con i campi già compilati dalla cotta, anteprima e stampa.
// ctx: { html, abv, lotto, scadenzaMese, numIT, cartone (etichetta del cartone di lattine), qr: { prodotto(litri, tipo), lotto, cotta } }
export async function apriEtichetta(c, ctx) {
  const pref = leggiPref();
  const cartone = !!ctx.cartone;
  const formati = [...new Set((c.confezionato || []).filter(r => (cartone ? r.tipo !== 'fusto' : r.tipo === 'fusto') && Number(r.litri) > 0).map(r => Number(r.litri)))];
  const litri = formati[0] || (cartone ? 0.33 : 20);
  const d = {
    birra: c.birra || '',
    stile: c.stile || '',
    alcol: ctx.abv ? ctx.numIT(ctx.abv, 1) : '',
    formato: cartone ? `${pref.pezziCartone || 24} × ${ctx.numIT(litri * 100, 0)} cl` : `${ctx.numIT(litri, 0)} L`,
    pezzi: cartone ? Number(pref.pezziCartone) || 24 : 1,
    conQr: pref.conQr !== false,
    qr: '',
    ingredienti: ingredientiDa(c),
    lotto: ctx.lotto,
    scadenza: meseAnno(ctx.scadenzaMese),
    conservazione: pref.conservazione ?? 'Conservare a una temperatura compresa tra 3 e 6 gradi Celsius.',
    produttore: pref.produttore ?? 'Prodotto e confezionato da VECAS SRLS\nvia Milano snc\n86074 Filignano (IS)',
    lunghezza: pref.lunghezza || 80,
  };
  const { html } = ctx;
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg-etichetta';
  const campo = (k, etichetta, attr = '') => html`<label>${etichetta} <input data-et="${k}" value="${d[k]}" ${ctx.raw(attr)}></label>`;
  dlg.innerHTML = html`<form method="dialog">
    <h2>${cartone ? 'Etichetta cartone lattine' : 'Etichetta fusto'}</h2>
    <div class="et-corpo">
      <div class="griglia" style="grid-template-columns:1fr 1fr">
        <label style="grid-column:1/-1">Birra <input data-et="birra" value="${d.birra}"></label>
        ${campo('stile', 'Stile')}
        ${campo('alcol', 'Alcol (% vol)', 'inputmode="decimal"')}
        <label>Formato <input data-et="formato" list="dl-formati-et" value="${d.formato}"></label>
        ${campo('lunghezza', 'Lunghezza etichetta (mm)', 'type="number" min="40" max="300" step="5"')}
        ${campo('lotto', 'Lotto')}
        ${campo('scadenza', 'Da consumarsi entro fine (mm/aaaa)')}
        <label style="grid-column:1/-1">Ingredienti <span class="totale">(gli allergeni in MAIUSCOLO escono in grassetto)</span><textarea data-et="ingredienti" rows="3">${d.ingredienti}</textarea></label>
        <label style="grid-column:1/-1">Conservazione <input data-et="conservazione" value="${d.conservazione}"></label>
        <label style="grid-column:1/-1">Produttore e luogo di produzione <textarea data-et="produttore" rows="3">${d.produttore}</textarea></label>
        <label class="spunta"><input type="checkbox" data-et="conQr" ${d.conQr ? 'checked' : ''}> QR per lo scarico (uso interno)</label>
        ${cartone ? html`<label>Lattine per cartone <input data-et="pezzi" type="number" min="1" max="96" value="${d.pezzi}"></label>` : ''}
      </div>
      <div class="et-anteprima"><iframe title="Anteprima etichetta"></iframe></div>
    </div>
    <datalist id="dl-formati-et">${(cartone ? ['24 × 33 cl', '12 × 33 cl', '24 × 44 cl', '12 × 44 cl'] : [12, 20, 24, 25, 30].map(l => `${l} L`)).map(f => html`<option value="${f}">`)}</datalist>
    <p class="totale">Nella finestra di stampa scegli la Brother QL-700, carta 62 mm (rotolo continuo), margini nessuno e scala 100%.</p>
    <div class="barra"><span class="spazio"></span>
      <button value="chiudi">Chiudi</button>
      <button class="primario" type="button" id="et-stampa">🖨 Stampa</button>
    </div>
  </form>`.s;
  document.body.appendChild(dlg);
  const ant = dlg.querySelector('.et-anteprima iframe');
  // il QR porta prodotto, lotto e pezzi per scansione (un cartone = tutte le sue lattine)
  const disegnaQr = async () => {
    d.qr = d.conQr && ctx.qr ? await svgQr(linkQr({ prodotto: `${ctx.qr.birra}|${cartone ? 'lattina/bottiglia' : 'fusto'}|${litri}`, lotto: ctx.qr.lotto, cotta: ctx.qr.cotta, pezzi: cartone ? d.pezzi : 1 })).catch(() => '') : '';
  };
  const aggiorna = () => {
    ant.srcdoc = htmlEtichetta(d);
    ant.style.height = `${Math.max(40, Number(d.lunghezza) || 100) * 3.78 + 4}px`;
  };
  dlg.addEventListener('input', async e => {
    const k = e.target.dataset.et;
    if (!k) return;
    d[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'pezzi' ? Math.max(1, Number(e.target.value) || 1) : e.target.value;
    if (['produttore', 'conservazione', 'lunghezza', 'conQr', 'pezzi'].includes(k)) scriviPref({ ...leggiPref(), produttore: d.produttore, conservazione: d.conservazione, lunghezza: d.lunghezza, conQr: d.conQr, ...(cartone ? { pezziCartone: d.pezzi } : {}) });
    if (k === 'conQr' || k === 'pezzi') await disegnaQr();
    aggiorna();
  });
  dlg.querySelector('#et-stampa').onclick = () => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    fr.onload = () => {
      const img = fr.contentDocument.querySelector('img');
      const via = () => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 60_000); };
      img && !img.complete ? img.addEventListener('load', via, { once: true }) : via();
    };
    fr.srcdoc = htmlEtichetta(d);
  };
  dlg.addEventListener('close', () => dlg.remove());
  await disegnaQr();
  aggiorna();
  dlg.showModal();
}
