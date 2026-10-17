// Testi dei messaggi automatici su Telegram: agenda del mattino e report del lunedì.
// Senza DOM: li prepara il server (netlify/lib/automazioni.mjs) dai record del database,
// e l'app li mostra in anteprima in Impostazioni → Automazioni.
//
// dati: { cotte, fv, durate, articoli, bolle, inventari, scarichi, movimenti, inventariBirra, prodotti,
//         impBirra, scadenze, pulizie, sospesi, clienti }
// Il testo usa l'HTML di Telegram (<b>, <i>, <a>): i valori passano da esc().

import { attivitaGiorno, etichetteDaOrdinare } from './agenda.js';
import { giacenze } from './magazzino.js';
import { fabbisogno } from './ordine.js';
import { confezionamenti, giacenzeBirra, rinominati } from './birra.js';
import { fvDaPulire, scadenzeDaFare, statoFermentatori } from './haccp.js';
import { coperturaBirre, statoClienti } from './previsioni.js';
import { prezzoVendita } from './costi.js';
import { addGiorni, dataIT, diffGiorni, numIT, periodiCotta, gruppoCotta, lottoGruppo } from './dominio.js';

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const giornoLungo = d => { const x = new Date(`${d}T12:00:00Z`); return `${GIORNI[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()]}`; };
const L = n => `${numIT(n, 0)} L`;
const lottoDi = g => (g.length > 1 ? lottoGruppo(g) : g[0].lotto || '');

// I calcoli comuni ai due messaggi (e alla Home)
export function calcoli(dati, oggi) {
  const { cotte, durate, fv } = dati;
  const giacMp = giacenze({ articoli: dati.articoli, bolle: dati.bolle, inventari: dati.inventari, cotte, scarichi: dati.scarichi }, oggi);
  const { righe: daOrdinare } = fabbisogno(giacMp, { articoli: dati.articoli, bolle: dati.bolle, cotte }, { fino: addGiorni(oggi, 42), anticipo: 7, oggi });
  const datiBirra = { cotte, durate, movimenti: dati.movimenti, inventari: dati.inventariBirra, prodotti: dati.prodotti, impostazioni: dati.impBirra };
  const giacB = giacenzeBirra(datiBirra, oggi);
  // senza magazzino birra avviato (inventario iniziale) non si sa quanta birra c'è: niente previsioni
  const copertura = dati.impBirra?.inizio ? coperturaBirre({ giac: giacB, cotte, durate }, { oggi }) : [];
  const clienti = statoClienti(dati.movimenti, dati.clienti, dati.prodotti, oggi);
  const sporchi = fvDaPulire(statoFermentatori(cotte, durate, fv, dati.pulizie, oggi), dati.pulizie, oggi);
  const scadHaccp = scadenzeDaFare(dati.scadenze, oggi);
  const etichette = etichetteDaOrdinare(cotte, durate, oggi).filter(x => diffGiorni(oggi, x.fine) <= 21);
  return { giacMp, daOrdinare, giacB, datiBirra, copertura, clienti, sporchi, scadHaccp, etichette };
}

const voce = v => `${v.icona} <b>${esc(v.testo)}</b> · ${esc(v.birra)} ${esc(v.lotto || '')}${v.fv && v.tipo !== 'travaso' ? ` · ${esc(v.fv)}` : ''}${v.dett ? `\n     <i>${esc(v.dett)}</i>` : ''}`;

// ---------- agenda del mattino ----------
export function testoAgenda(dati, oggi, { url = '' } = {}) {
  const ctx = { durate: dati.durate, fv: dati.fv };
  const c = calcoli(dati, oggi);
  const domani = addGiorni(oggi, 1);
  const out = [`☀️ <b>Agenda di ${giornoLungo(oggi)}</b>`];
  const sez = (titolo, righe) => { if (righe.length) out.push('', `<b>${titolo}</b>`, ...righe); };

  const oggiVoci = attivitaGiorno(dati.cotte, oggi, ctx);
  sez('Oggi', oggiVoci.length ? oggiVoci.map(voce) : ['Niente in programma sulle cotte.']);
  sez('Domani', attivitaGiorno(dati.cotte, domani, ctx).map(voce));
  sez('🧽 FV da pulire', c.sporchi.map(x => `${esc(x.fv.nome)}: ${x.prossimo ? `si riempie ${x.giorni <= 0 ? 'oggi' : `tra ${x.giorni} gg`} con ${esc(x.prossimo.cotte[0].birra)}` : `vuoto dal ${dataIT(x.svuotato)}`}`));
  sez('🗓️ Scadenze HACCP', c.scadHaccp.slice(0, 5).map(x => `${esc(x.s.nome)}: ${x.stato === 'scaduta' ? '<b>scaduta</b>' : x.giorni === 0 ? 'oggi' : `tra ${x.giorni} gg`}`));
  const urgenti = c.daOrdinare.filter(r => r.urgente);
  sez('🛒 Materie prime da ordinare subito', urgenti.slice(0, 8).map(r => `${esc(r.articolo.nome)}: ${numIT(r.ordina, r.articolo.unita === 'kg' || r.articolo.unita === 'L' ? 1 : 0)} ${esc(r.articolo.unita)}${r.fornitore ? ` (${esc(r.fornitore)})` : ''}`));
  sez('🏷️ Etichette da ordinare', c.etichette.slice(0, 5).map(x => `${esc(x.g[0].birra)} ${esc(lottoDi(x.g))}: da confezionare ${diffGiorni(oggi, x.fine) <= 0 ? 'ora' : `il ${dataIT(x.fine)}`}`));
  sez('📉 Birre da ripianificare', c.copertura.filter(b => b.stato !== 'ok').slice(0, 5).map(b => `${esc(b.birra)}: ${b.esaurita ? 'esaurita' : `finisce verso il ${dataIT(b.esaurimento)}`}, cotta ${b.stato === 'ritardo' ? '<b>in ritardo</b>' : `entro il ${dataIT(b.cottaEntro)}`}`));
  const fermi = c.clienti.filter(x => x.daRichiamare);
  if (fermi.length) sez(`📞 Clienti da richiamare (${fermi.length})`, [`${fermi.slice(0, 5).map(x => esc(x.nome)).join(', ')}${fermi.length > 5 ? '…' : ''}`]);
  const sospesi = (dati.sospesi || []).filter(s => !s.eliminato);
  if (sospesi.length) sez('📥 Documenti importati da controllare', [`${sospesi.length} documenti di Fatture in Cloud o Shopify aspettano una scelta nell'app.`]);
  if (url) out.push('', `<a href="${esc(url)}">Apri Global Brewing</a>`);
  return out.join('\n');
}

// ---------- report del lunedì: la settimana appena finita e quella che inizia ----------
export function testoReport(dati, oggi, { url = '', prezzi = null } = {}) {
  const { cotte, durate, fv } = dati;
  const c = calcoli(dati, oggi);
  const da = addGiorni(oggi, -7), a = addGiorni(oggi, -1);
  const nella = d => d >= da && d <= a;
  const fatte = cotte.filter(x => !x.eliminato && x.data && nella(x.data));
  const al = rinominati(dati.prodotti);
  const conf = confezionamenti(cotte, durate, al).filter(x => nella(x.data));
  const litriConf = conf.reduce((t, x) => t + x.pezzi * Number(x.prodotto.split('|')[2] || 0), 0);
  let venduti = 0, valore = 0, senzaPrezzo = false;
  const perBirra = new Map();
  for (const g of c.giacB.values()) {
    for (const m of [...g.movimenti, ...g.prima]) {
      if (m.tipo !== 'scarico' || !nella(m.data)) continue;
      venduti += m.pezzi * g.litri;
      perBirra.set(g.birra, (perBirra.get(g.birra) || 0) + m.pezzi * g.litri);
      if (prezzi) {
        const p = prezzoVendita(prezzi, g.birra, g.tipo, g.litri);
        if (p > 0) valore += p * m.pezzi; else senzaPrezzo = true;
      }
    }
  }
  const occupati = new Set(cotte.filter(x => !x.eliminato).flatMap(x => periodiCotta(x, durate, fv)).filter(p => p.fv && p.da <= oggi && p.a >= oggi).map(p => p.fv));
  const out = [`📊 <b>Settimana dal ${dataIT(da)} al ${dataIT(a)}</b>`, ''];
  out.push(`🍺 Cotte: <b>${fatte.length}</b>${fatte.length ? ` · ${L(fatte.reduce((t, x) => t + (Number(x.litri) || 0), 0))}` : ''}`);
  out.push(`📦 Confezionato: <b>${L(litriConf)}</b>`);
  out.push(`🚚 Uscito dal magazzino: <b>${L(venduti)}</b>${prezzi && valore > 0 ? ` · circa ${numIT(valore, 0)} € IVA esclusa${senzaPrezzo ? ' (alcuni formati senza prezzo)' : ''}` : ''}`);
  if (perBirra.size) out.push(`     <i>${[...perBirra].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([b, l]) => `${esc(b)} ${L(l)}`).join(' · ')}</i>`);
  out.push(`🛢️ Fermentatori occupati oggi: <b>${occupati.size} su ${fv.length}</b>`);

  const prossima = Array.from({ length: 7 }, (_, i) => addGiorni(oggi, i));
  const nuove = [];
  for (const x of cotte) {
    if (x.eliminato || !x.data || !prossima.includes(x.data) || nuove.some(g => g.some(y => y.id === x.id))) continue;
    nuove.push(gruppoCotta(x, cotte));
  }
  const ctx = { durate, fv };
  const eventi = prossima.flatMap(d => attivitaGiorno(cotte, d, ctx).filter(v => ['dh', 'travaso', 'freddo', 'fine'].includes(v.tipo)).map(v => ({ d, v })));
  out.push('', '<b>Questa settimana</b>');
  out.push(nuove.length ? `🍺 Cotte: ${nuove.map(g => `${esc(g[0].birra)} (${giornoLungo(g[0].data).split(' ')[0]})`).join(', ')}` : '🍺 Nessuna cotta pianificata.');
  const conta = t => eventi.filter(e => e.v.tipo === t).length;
  out.push(`🌿 Dry hop ${conta('dh')} · ❄️ crash cooling ${conta('freddo')} · ↪️ travasi ${conta('travaso')} · 📦 da confezionare ${conta('fine')}`);

  const allerta = c.copertura.filter(b => b.stato !== 'ok');
  if (allerta.length) {
    out.push('', '<b>📉 Birre in esaurimento</b>');
    for (const b of allerta.slice(0, 6)) out.push(`${esc(b.birra)}: ${numIT(b.settimana, 0)} L/settimana, ${b.esaurita ? 'esaurita' : `finisce verso il ${dataIT(b.esaurimento)}`} · cotta ${b.stato === 'ritardo' ? '<b>in ritardo</b>' : `entro il ${dataIT(b.cottaEntro)}`}`);
  }
  const fermi = c.clienti.filter(x => x.daRichiamare);
  if (fermi.length) {
    out.push('', `<b>📞 Clienti da richiamare (${fermi.length})</b>`);
    for (const x of fermi.slice(0, 6)) out.push(`${esc(x.nome)}: ultimo ordine ${x.giorni} giorni fa (di solito ogni ${x.ritmo})`);
  }
  if (c.daOrdinare.length) out.push('', `🛒 Materie prime da ordinare per le prossime 6 settimane: <b>${c.daOrdinare.length}</b>${c.daOrdinare.some(r => r.urgente) ? `, di cui ${c.daOrdinare.filter(r => r.urgente).length} subito` : ''}`);
  if (url) out.push('', `<a href="${esc(url)}">Apri Global Brewing</a>`);
  return out.join('\n');
}
