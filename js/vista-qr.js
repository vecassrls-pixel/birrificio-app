// QR di fusti e cartoni: #/scansiona apre la fotocamera, #/qr?… mostra il lotto (dal QR dell'etichetta)
// con quanto ne resta e lo scarico veloce (taproom, spaccio, eventi…).

import { MOTIVI_SCARICO, ID_IMPOSTAZIONI, giacenzeBirra, nomeProdotto, rinominati } from './birra.js';
import { leggiLinkQr, scansiona } from './qr.js';

let u; // { $app, html, db, toast, stato, dataIT, oggiISO }
export function init(strumenti) { u = strumenti; }

let fermaCamera = null;
export const fermaScansione = () => { if (fermaCamera) { fermaCamera(); fermaCamera = null; } };

export function vistaScansiona() {
  const { html } = u;
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a></div>
    <h1>Scansiona</h1>
    <p class="totale">Inquadra il QR sull'etichetta del fusto o del cartone.</p>
    <div class="qr-video"><video muted></video></div>
    <p class="totale" id="qr-stato">Avvio la fotocamera…</p>`;
  const stato = u.$app.querySelector('#qr-stato');
  scansiona(u.$app.querySelector('video'), testo => {
    fermaCamera = null;
    if (leggiLinkQr(testo)) location.hash = testo.slice(testo.indexOf('#/qr?'));
    else stato.textContent = `Questo QR non è di un'etichetta Global Brewing: ${testo}`;
  }).then(f => { fermaCamera = f; stato.textContent = 'Inquadra il QR…'; })
    .catch(e => { stato.textContent = /Permission|NotAllowed/i.test(e.name || e.message) ? 'Serve il permesso per la fotocamera (impostazioni del browser).' : `Fotocamera non disponibile: ${e.message}`; });
  return fermaScansione;
}

export async function vistaQr() {
  const { html } = u;
  const q = leggiLinkQr(location.hash);
  if (!q) { location.hash = '#/scansiona'; return; }
  const oggi = u.oggiISO();
  const [movimenti, inventari, prodotti, imp] = await Promise.all([u.db.tutti('movbirra'), u.db.tutti('inventariobirra'), u.db.tutti('prodottobirra'), u.db.leggi(ID_IMPOSTAZIONI)]);
  const prodotto = rinominati(prodotti).get(q.prodotto) || q.prodotto;
  const impB = imp && !imp.eliminato ? imp : null;
  const g = impB ? giacenzeBirra({ cotte: u.stato.cotte, durate: u.stato.durate, movimenti, inventari, prodotti, impostazioni: impB }, oggi).get(prodotto) : null;
  const delLotto = g?.lotti?.find(l => l.lotto === q.lotto);
  const cotta = u.stato.cotte.find(c => c.id === q.cotta);
  const unita = q.pezzi > 1 ? `cartone da ${q.pezzi}` : g?.tipo === 'fusto' || /\|fusto\|/.test(prodotto) ? 'fusto' : 'pezzo';
  const recenti = movimenti.filter(m => !m.eliminato && m.qr && m.data === oggi && (m.righe || []).some(r => r.prodotto === prodotto)).sort((a, b) => String(b.creato).localeCompare(String(a.creato)));
  let quanti = 1;
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/birra" class="btn">← Birra</a><span class="spazio"></span><a class="btn" href="#/scansiona">📷 Scansiona un altro</a></div>
    <div class="scheda qr-scheda">
      <h1 style="margin:0">${nomeProdotto(prodotto)}</h1>
      <p class="qr-lotto">Lotto <b>${q.lotto || '—'}</b>${delLotto?.scadenza ? html` · scade ${u.dataIT(delLotto.scadenza)}` : ''}${q.pezzi > 1 ? html` · cartone da ${q.pezzi} pezzi` : ''}</p>
      <p class="totale">${!impB ? 'Magazzino birra non avviato: la giacenza non è nota.' : g ? html`In magazzino: <b>${g.giacenza}</b> pezzi di questo formato${delLotto ? html`, di cui <b>${delLotto.pezzi}</b> di questo lotto` : ', nessuno di questo lotto'}.` : 'Prodotto non ancora in magazzino.'}</p>
      <div class="barra">
        ${cotta ? html`<a class="btn" href="#/rintracciabilita/${encodeURIComponent(cotta.id)}">🔎 Rintracciabilità</a><a class="btn" href="#/cotta/${encodeURIComponent(cotta.id)}">Scheda cotta</a>` : ''}
        <a class="btn" href="#/birra-prodotto/${encodeURIComponent(prodotto)}">Movimenti del prodotto</a>
      </div>
    </div>
    <div class="scheda solo-editori">
      <h2>Scarica ${unita === 'fusto' ? 'il fusto' : unita === 'pezzo' ? 'il pezzo' : 'il cartone'}</h2>
      <div class="barra" style="margin-top:0">
        <span class="totale" style="margin:0">Quanti ${unita === 'fusto' ? 'fusti' : unita === 'pezzo' ? 'pezzi' : 'cartoni'}</span>
        <button class="piccolo" data-q="-1">−</button><b id="qr-n" class="qr-n">1</b><button class="piccolo" data-q="1">+</button>
      </div>
      <label>Cliente o nota <input id="qr-cliente" placeholder="facoltativo"></label>
      <div class="qr-motivi">${Object.entries(MOTIVI_SCARICO).map(([k, v]) => html`<button class="${k === 'taproom' ? 'primario' : ''}" data-motivo="${k}">${v}</button>`)}</div>
    </div>
    ${recenti.length ? html`<div class="scheda"><h2>Scaricati oggi con il QR</h2><ul class="w-lista">${recenti.map(m => html`<li><a href="#/movbirra/${encodeURIComponent(m.id)}"><span class="w-testo"><b>${MOTIVI_SCARICO[m.motivo] || m.motivo}</b>${m.cliente ? ` · ${m.cliente}` : ''}<small>lotto ${m.righe[0].lotto || '—'}</small></span><span class="w-num">${m.righe[0].pezzi} pz</span></a></li>`)}</ul></div>` : ''}`;
  u.$app.onclick = async e => {
    const b = e.target.closest('[data-q]');
    if (b) { quanti = Math.max(1, quanti + Number(b.dataset.q)); u.$app.querySelector('#qr-n').textContent = quanti; return; }
    const m = e.target.closest('[data-motivo]');
    if (!m) return;
    m.disabled = true;
    const cliente = u.$app.querySelector('#qr-cliente').value.trim();
    const pezzi = quanti * q.pezzi;
    await u.db.salva({
      id: u.db.nuovoId('movbirra'), tipo: 'movbirra', verso: 'scarico', data: oggi, motivo: m.dataset.motivo, scontrinato: false,
      cliente, documento: '', note: 'Scarico da QR', origine: 'manuale', qr: true, creato: new Date().toISOString(),
      righe: [{ prodotto, pezzi, lotto: q.lotto, scadenza: '' }],
    });
    u.toast(`Scaricati ${pezzi} pezzi (${MOTIVI_SCARICO[m.dataset.motivo]})`);
    vistaQr();
  };
}
