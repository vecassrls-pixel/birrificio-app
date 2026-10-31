// Pianificatore: proposte di data e fermentatore per una cotta nuova, e materie prime che mancherebbero.
// Senza DOM (lo usa il dialog "Pianifica cotta" e la pagina Copertura birra).

import { DURATA_DEFAULT, addGiorni, diffGiorni, fineCotta, fvLiberi, travasoCotta, gruppoCotta, nomeBirra } from './dominio.js';
import { giacenze, scarichiCotte } from './magazzino.js';

export const GIORNI_TRAVASO_DEFAULT = 14; // 10 fermentazione + 4 DH, poi travaso dai FV non isobarici
const weekend = d => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

// Giorni dalla cotta al travaso, dal profilo della cotta da copiare
export function giorniTravasoDa(src, fvs) {
  const t = src && travasoCotta(src, fvs);
  return t?.data ? diffGiorni(src.data, t.data) : GIORNI_TRAVASO_DEFAULT;
}
export const durataDa = (src, durate) => (src?.data ? diffGiorni(src.data, fineCotta(src, durate)) + 1 : DURATA_DEFAULT);

// Giorni in FV proposti per una cotta nuova (Romain 2026-10-31): media delle ultime 2 cotte finite della stessa birra,
// solo singole per una singola e solo doppie (o triple) per una doppia, perché le durate sono diverse.
// Una doppia conta come un lotto: giorni dall'ultima cotta del gruppo alla fine in FV (i giorni in più
// delle cotte in giorni consecutivi il dialog li aggiunge a parte). Ritorna { giorni, lotti: [{ lotto, giorni }] } o null.
export function durataMedia({ birra, quante = 1, cotte, durate, oggi, quanti = 2 }) {
  const k = nomeBirra(birra);
  if (!k) return null;
  const visti = new Set(), lotti = [];
  const stesse = cotte.filter(c => !c.eliminato && c.data && c.data <= oggi && nomeBirra(c.birra) === k)
    .sort((a, b) => b.data.localeCompare(a.data));
  for (const c of stesse) {
    if (lotti.length >= quanti) break;
    if (visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    if (g.length !== quante) continue;
    const fine = g.reduce((m, x) => { const f = fineCotta(x, durate); return f > m ? f : m; }, '');
    if (fine >= oggi) continue; // ancora in FV: la durata non è quella vera
    const giorni = diffGiorni(g[g.length - 1].data, fine) + 1;
    if (giorni < 3 || giorni > 120) continue;
    lotti.push({ lotto: g.length > 1 ? g.map(x => x.numero).join('/') : g[0].lotto || '', giorni });
  }
  return lotti.length ? { giorni: Math.round(lotti.reduce((t, l) => t + l.giorni, 0) / lotti.length), lotti } : null;
}

// Prime date (da "da" in poi) con almeno un FV libero per tutta la durata.
// Un FV non isobarico va bene se il giorno del travaso c'è un FV isobarico libero fino alla fine.
// "escludi": giorni in cui non si fa la cotta (ferie). "giorniCotta": cotte in giorni consecutivi (doppia: 2).
// Ritorna [{ data, opzioni: [{ fv, travaso: { fv, data } | null }] }], le prime "max" date.
export function proponiDate({ fvs, cotte, durate, durata = DURATA_DEFAULT, da, giorniTravaso = GIORNI_TRAVASO_DEFAULT, giorni = 120, conWeekend = false, max = 5, escludi = new Set(), giorniCotta = 1 }) {
  const out = [];
  const iso = fvs.filter(f => f.isobarico !== false);
  for (let i = 0; i <= giorni && out.length < max; i++) {
    const d = addGiorni(da, i);
    // tutti i giorni di cotta (doppia in giorni consecutivi: 2) lavorativi
    const giorniDi = Array.from({ length: giorniCotta }, (_, k) => addGiorni(d, k));
    if (giorniDi.some(g => (!conWeekend && weekend(g)) || escludi.has(g))) continue; // weekend, ferie
    const a = addGiorni(d, durata - 1);
    const opzioni = [];
    for (const { fv, occupatoDa } of fvLiberi(fvs, cotte, d, a, durate)) {
      if (fv.isobarico !== false) { if (!occupatoDa.length) opzioni.push({ fv: fv.nome, travaso: null }); continue; }
      // non isobarico: libero fino al travaso, poi serve un isobarico libero
      const dt = addGiorni(d, giorniTravaso);
      if (dt > a) { if (!occupatoDa.length) opzioni.push({ fv: fv.nome, travaso: null }); continue; }
      if (occupatoDa.some(p => p.da <= addGiorni(dt, -1))) continue;
      const arrivo = fvLiberi(iso, cotte, dt, a, durate).find(x => !x.occupatoDa.length);
      if (arrivo) opzioni.push({ fv: fv.nome, travaso: { fv: arrivo.fv.nome, data: dt } });
    }
    if (opzioni.length) out.push({ data: d, opzioni: opzioni.sort((x, y) => !!x.travaso - !!y.travaso) });
  }
  return out;
}

// Materie prime che mancherebbero per una cotta (non ancora salvata) alla sua data:
// giacenza di oggi + carichi e scarichi già previsti fino al giorno in cui serve ciascun ingrediente.
// datiMag = { articoli, bolle, inventari, cotte, scarichi }
export function materiePrimeMancanti(datiMag, cotta, oggi) {
  const ipotetica = { ...cotta, id: cotta.id || '~nuova' };
  const giac = giacenze({ ...datiMag, cotte: [...datiMag.cotte.filter(c => c.id !== ipotetica.id), ipotetica] }, oggi);
  const mancano = [], scollegati = [];
  const visti = new Set();
  for (const s of scarichiCotte([ipotetica], datiMag.articoli)) {
    if (!s.articolo) { scollegati.push(s.nome); continue; }
    if (visti.has(s.articolo.id)) continue;
    visti.add(s.articolo.id);
    const g = giac.get(s.articolo.id);
    if (!g) continue;
    // saldo più basso fino all'ultima uscita di questa cotta
    const fino = scarichiCotte([ipotetica], datiMag.articoli).filter(x => x.articolo?.id === s.articolo.id).map(x => x.data).sort().pop();
    let saldo = Math.max(0, g.giacenza), minimo = saldo;
    for (const m of g.movimenti.filter(x => x.futuro && x.data <= fino).sort((x, y) => x.data.localeCompare(y.data) || y.qta - x.qta)) {
      saldo += m.qta;
      if (saldo < minimo) minimo = saldo;
    }
    if (minimo < -1e-9) mancano.push({ articolo: s.articolo, manca: -minimo, unita: s.articolo.unita });
  }
  return { mancano, scollegati };
}
