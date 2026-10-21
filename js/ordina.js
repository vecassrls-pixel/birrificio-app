// Pagina pubblica degli ordini (ordina.html#<token>): birre disponibili con i prezzi del listino del cliente,
// carrello e invio dell'ordine alla funzione netlify/functions/ordini.mjs. Niente login: vale il token del link.

const $ = document.getElementById('or');
const token = location.hash.slice(1);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
const euro = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dataIT = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const STATI = { nuovo: 'ricevuto', confermato: 'confermato', pronto: 'pronto', spedito: 'spedito', consegnato: 'consegnato', annullato: 'annullato' };
const MODI = { ritiro: 'Ritiro in birrificio', zona: 'Consegna in zona', corriere: 'Spedizione con corriere' };
const CAMPI = ['consegna', 'note', 'indirizzo', 'comune', 'telefono'];
const carrello = new Map(); // chiave → pezzi
let dati = null;

async function carica() {
  if (!/^[a-f0-9]{32}$/.test(token)) { $.innerHTML = '<p class="vuoto">Link non valido: chiedi al birrificio il tuo link per gli ordini.</p>'; return; }
  try {
    const res = await fetch(`/.netlify/functions/ordini?t=${token}`);
    const b = await res.json();
    if (!res.ok) throw new Error(b.errore || `Errore ${res.status}`);
    dati = b;
    disegna();
    mostraIndirizzo();
  } catch (e) { $.innerHTML = `<p class="vuoto">${esc(e.message)}</p>`; }
}

function disegna(msg = '') {
  const formati = dati.catalogo.flatMap(b => b.formati.map(f => ({ ...f, birra: b.birra })));
  const scelti = formati.filter(f => carrello.get(f.chiave) > 0);
  const totale = scelti.reduce((t, f) => t + (f.prezzo || 0) * carrello.get(f.chiave), 0);
  const conIva = scelti.some(f => f.iva);
  $.innerHTML = `
    <h1>Ciao ${esc(dati.cliente)}</h1>
    <p class="totale">Birre disponibili oggi, ${dataIT(dati.oggi)}. Scegli le quantità e invia l'ordine: ti confermiamo noi la consegna.</p>
    ${msg}
    ${!dati.catalogo.length ? '<p class="vuoto">Al momento non ci sono birre disponibili.</p>' : dati.catalogo.map(b => `
      <section class="scheda or-birra"><h2>${esc(b.birra)}</h2>
        <p class="totale">${esc([b.stile, b.abv !== null && b.abv !== undefined ? `${String(b.abv).replace('.', ',')}% vol` : ''].filter(Boolean).join(' · '))}</p>
        ${b.formati.map(f => `<div class="or-riga">
          <span class="or-formato"><b>${esc(f.formato)}</b><small>${f.prezzo ? `${euro(f.prezzo)} ${f.iva ? 'IVA inclusa' : '+ IVA'}` : 'prezzo su richiesta'}${f.disponibili !== null ? ` · ultimi ${f.disponibili}` : ''}</small></span>
          <span class="or-qta"><button type="button" data-meno="${esc(f.chiave)}" aria-label="Meno">−</button><b>${carrello.get(f.chiave) || 0}</b><button type="button" data-piu="${esc(f.chiave)}" data-max="${f.disponibili ?? ''}" aria-label="Più">+</button></span>
        </div>`).join('')}
      </section>`).join('')}
    ${dati.catalogo.length ? `<form class="scheda" id="or-invia">
      <h2>Il tuo ordine</h2>
      ${scelti.length ? `<ul class="or-elenco">${scelti.map(f => `<li>${carrello.get(f.chiave)} × ${esc(f.birra)} · ${esc(f.formato)}</li>`).join('')}</ul>
        ${totale ? `<p><b>Totale indicativo: ${euro(totale)}</b> ${conIva ? 'IVA inclusa' : '+ IVA'}</p>` : ''}` : '<p class="totale">Nessuna birra scelta.</p>'}
      <fieldset class="or-modi"><legend>Come la ricevi</legend>
        ${Object.entries(MODI).map(([k, v]) => `<label class="spunta"><input type="radio" name="modo" value="${k}" ${(dati.recapito?.modo || 'zona') === k ? 'checked' : ''}> ${v}</label>`).join('')}</fieldset>
      <div class="or-indirizzo">
        <label>Indirizzo<input name="indirizzo" maxlength="200" autocomplete="street-address" value="${esc(dati.recapito?.indirizzo)}" placeholder="via e numero"></label>
        <label>Comune<input name="comune" maxlength="80" autocomplete="address-level2" value="${esc(dati.recapito?.comune)}"></label>
      </div>
      <label>Telefono<input name="telefono" type="tel" maxlength="30" autocomplete="tel" value="${esc(dati.recapito?.telefono)}" placeholder="per avvisarti della consegna"></label>
      <label>Data desiderata (facoltativa)<input type="date" name="consegna" min="${dati.oggi}"></label>
      <label>Note<textarea name="note" rows="2" maxlength="1000" placeholder="orari, citofono, altro"></textarea></label>
      <button class="primario" ${scelti.length ? '' : 'disabled'}>Invia l'ordine</button>
    </form>` : ''}
    ${dati.ordini.length ? `<section class="scheda"><h2>I tuoi ultimi ordini</h2><ul class="or-elenco">${dati.ordini.map(o => `<li><b>${dataIT(o.data)}</b> · ${esc(STATI[o.stato] || o.stato)}${o.consegna ? ` · consegna ${dataIT(o.consegna)}` : ''}${o.tracking ? ` · ${esc(o.corriere)} n. ${esc(o.tracking)}` : ''}<br><small>${o.righe.map(r => `${r.pezzi} × ${esc(r.nome)}`).join(', ')}</small></li>`).join('')}</ul></section>` : ''}`;
}

$.addEventListener('click', e => {
  const piu = e.target.closest('[data-piu]'), meno = e.target.closest('[data-meno]');
  if (!piu && !meno) return;
  const k = (piu || meno).dataset.piu || (meno && meno.dataset.meno);
  const max = piu && piu.dataset.max ? Number(piu.dataset.max) : Infinity;
  const n = Math.max(0, Math.min(max, (carrello.get(k) || 0) + (piu ? 1 : -1)));
  carrello.set(k, n);
  const form = document.getElementById('or-invia');
  const tieni = form ? Object.fromEntries([...CAMPI, 'modo'].map(k => [k, form[k].value])) : null;
  disegna();
  if (tieni) { const f = document.getElementById('or-invia'); for (const k of [...CAMPI, 'modo']) f[k].value = tieni[k]; mostraIndirizzo(); }
});
// l'indirizzo serve solo per consegna e spedizione
function mostraIndirizzo() {
  const f = document.getElementById('or-invia');
  if (f) f.querySelector('.or-indirizzo').hidden = f.modo.value === 'ritiro';
}
$.addEventListener('change', e => { if (e.target.name === 'modo') mostraIndirizzo(); });
$.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, b = f.querySelector('button.primario');
  if (f.modo.value !== 'ritiro' && !f.indirizzo.value.trim()) { alert('Scrivi l\'indirizzo per la consegna'); f.indirizzo.focus(); return; }
  b.disabled = true; b.textContent = 'Invio…';
  try {
    const res = await fetch('/.netlify/functions/ordini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, modo: f.modo.value, ...Object.fromEntries(CAMPI.map(k => [k, f[k].value])), righe: [...carrello].filter(([, n]) => n > 0).map(([prodotto, pezzi]) => ({ prodotto, pezzi })) }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.errore || `Errore ${res.status}`);
    carrello.clear();
    await carica();
    disegna('<p class="avviso-riga">✓ Ordine inviato, grazie! Ti contattiamo per la conferma.</p>');
    mostraIndirizzo();
    scrollTo({ top: 0, behavior: 'smooth' });
  } catch (ex) {
    b.disabled = false; b.textContent = 'Invia l\'ordine';
    alert(ex.message);
  }
});
carica();
