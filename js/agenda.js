// Agenda del birrificio: cosa c'è da fare giorno per giorno, dalle cotte (cotta, DH, crash cooling, travasi,
// spurghi, fine in FV) ed etichette da ordinare. Senza DOM: la usano la Home e le automazioni sul server
// (agenda del mattino su Telegram, netlify/lib/automazioni.mjs).

import {
  SIMBOLI, addGiorni, diffGiorni, eventiGiorno, fasiCotta, fineCotta, gruppoCotta, lottoGruppo, numIT, statoCotta, travasoCotta,
} from './dominio.js';

// cotta doppia/tripla: se i giorni del dry hop sono scritti solo su un'altra cotta del gruppo, valgono per tutto il lotto
const conDh = x => (x.luppoli || []).some(r => r.uso === 'dry hop' && Number(r.giorno) > 0);
export function conGiorniDh(cotte) {
  const c0 = cotte[0], altra = conDh(c0) ? null : cotte.find(conDh);
  if (!altra) return c0;
  const sposta = diffGiorni(c0.data, altra.data);
  return { ...c0, luppoli: altra.luppoli.map(r => (r.uso === 'dry hop' && Number(r.giorno) > 0 ? { ...r, giorno: Number(r.giorno) + sposta } : r)) };
}

// Cosa c'è da fare in un giorno, per lotto (le cotte doppie una volta sola)
export function attivitaGiorno(cotte, d, { durate, fv }) {
  const out = [];
  const visti = new Set();
  for (const c of cotte) {
    if (c.eliminato || !c.data || visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    const c0 = conGiorniDh(g);
    const fine = fineCotta(g[0], durate);
    if (d < g[0].data || d > fine) continue;
    const nome = g[0].birra;
    const lotto = g.length > 1 ? lottoGruppo(g) : g[0].lotto;
    const base = { id: g[0].id, birra: nome, lotto, fv: g[0].fv };
    if (g.some(x => x.data === d)) out.push({ ...base, tipo: 'cotta', icona: '🍺', testo: `Cotta${g.length > 1 ? ` ${g.length === 2 ? 'doppia' : 'tripla'}` : ''}`, dett: '' });
    const dh = (c0.luppoli || []).filter(r => r.uso === 'dry hop' && Number(r.giorno) > 0 && addGiorni(c0.data, Number(r.giorno) - 1) === d);
    const fasi = fasiCotta(c0, durate);
    if (dh.length) out.push({ ...base, tipo: 'dh', icona: '🌿', testo: 'Dry hop', dett: dh.map(r => `${r.nome}${r.qta ? ` ${numIT(r.qta, 1)} ${r.unita || 'g'}` : ''}`).join(', ') });
    else if (fasi.some(f => f.fase === 'dh' && f.da === d && d !== g[0].data)) out.push({ ...base, tipo: 'dh', icona: '🌿', testo: 'Inizio dry hop', dett: '' });
    if (fasi.some(f => f.fase === 'maturazione' && f.da === d)) out.push({ ...base, tipo: 'freddo', icona: '❄️', testo: 'Crash cooling', dett: 'scendere a freddo, inizio maturazione' });
    const t = travasoCotta(g[0], fv);
    if (t?.data === d) out.push({ ...base, tipo: 'travaso', icona: '↪️', testo: 'Travaso', dett: `${g[0].fv} → ${t.fv || 'FV da scegliere'}${t.stimato ? ' (stimato)' : ''}` });
    const ev = (g[0].fermentazione || []).filter(e => e.data === d).flatMap(eventiGiorno);
    for (const k of new Set(ev)) out.push({ ...base, tipo: k, icona: SIMBOLI[k], testo: k === 'spurgo' ? 'Spurgo' : 'Bubbling', dett: '' });
    if (fine === d && !g.some(x => (x.confezionato || []).length)) out.push({ ...base, tipo: 'fine', icona: '📦', testo: 'Ultimo giorno in FV', dett: 'da confezionare' });
  }
  const ordine = ['cotta', 'travaso', 'dh', 'freddo', 'spurgo', 'bubbling', 'fine'];
  return out.sort((a, b) => ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo) || String(a.fv).localeCompare(String(b.fv), 'it', { numeric: true }));
}

// Etichette da ordinare: cotte pianificate o ancora nei fermentatori senza la spunta "Etichette pronte"
// (le etichette sono del lotto: basta la spunta su una cotta). Ordine per fine in FV.
export function etichetteDaOrdinare(cotte, durate, oggi) {
  const out = [];
  for (const c of cotte) {
    if (c.eliminato || !c.data || out.some(x => x.g.some(y => y.id === c.id))) continue;
    if (!['pianificata', 'tank'].includes(statoCotta(c, durate, oggi, cotte))) continue;
    const g = gruppoCotta(c, cotte);
    if (g.some(x => x.etichetteOk)) continue;
    out.push({ g, fine: fineCotta(g[0], durate), inFv: g[0].data <= oggi });
  }
  return out.sort((x, y) => x.fine.localeCompare(y.fine));
}
