// HACCP: rintracciabilità per lotto di birra, controllo materie prime in arrivo, scadenzario.
//
// Record nell'archivio:
//   bolla.controllo  { imballo, etichetta, scadenza, trasporto: bool, esito: 'conforme'|'non conforme', chi, note }
//   scadenzahaccp    { nome, ogniMesi, ultima: 'AAAA-MM-GG', note, storico: [{ data }] }
//   pulizia          { data, cosa (nome del FV o della linea), fasi: [], prodotti, chi, note }

import { addGiorni, diffGiorni, gruppoCotta, nomeBirra, oggiISO, periodiCotta } from './dominio.js';
import { registroS6 } from './magazzino.js';
import { lottoEtichetta, registroBirra } from './birra.js';

// ---------- rintracciabilità ----------
// Lotti di birra già prodotti (una riga per gruppo di cotte doppie), i più recenti per primi
export function lottiBirra(cotte, oggi = oggiISO()) {
  const visti = new Set();
  const out = [];
  for (const c of [...cotte].filter(x => !x.eliminato && x.data && x.data <= oggi).sort((a, b) => b.data.localeCompare(a.data))) {
    if (visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    out.push({ id: g[0].id, gruppo: g, lotto: lottoEtichetta(g), birra: g[0].birra || '', data: g[0].data, fv: g[0].fv || '' });
  }
  return out;
}

const k = s => String(s || '').trim().toLowerCase();
// Tutto quello che serve in un controllo o in un richiamo: da quali lotti di materie prime è fatta la birra
// (con fornitore e DDT) e dove è andata (confezionamenti e scarichi del magazzino birra)
export function rintracciabilita(lotto, datiMag, datiBirra) {
  const ids = new Set(lotto.gruppo.map(c => c.id));
  const s6 = registroS6(datiMag);
  const carichi = s6.filter(r => r.cs === 'C');
  const materie = s6.filter(r => r.cs === 'S' && r.dove?.tipo === 'cotta' && ids.has(r.dove.id)).map(r => {
    const origine = r.lotto ? carichi.find(x => x.prodotto === r.prodotto && k(x.lotto) === k(r.lotto)) : null;
    return { ...r, qta: Math.abs(Number(r.qta) || 0), fornitore: origine?.chi || '', arrivo: origine?.data || '', scadenzaLotto: r.scadenza || origine?.scadenza || '' };
  });
  // la stessa materia prima usata in giorni diversi (DH) resta su righe separate, ordinate per data
  materie.sort((a, b) => a.data.localeCompare(b.data) || a.prodotto.localeCompare(b.prodotto, 'it'));
  const confezionato = lotto.gruppo.flatMap(c => (c.confezionato || []).filter(r => Number(r.pezzi) > 0)
    .map(r => ({ data: r.data || c.fine || '', tipo: r.tipo, litri: Number(r.litri) || 0, pezzi: Number(r.pezzi) })));
  const movimenti = lotto.lotto ? registroBirra(datiBirra).filter(r => k(r.lotto) === k(lotto.lotto)) : [];
  return { materie, confezionato, uscite: movimenti.filter(r => r.cs === 'S') };
}

// ---------- controllo materie prime in arrivo ----------
export const CONTROLLI_ARRIVO = [
  ['imballo', 'Imballi integri'],
  ['etichetta', 'Etichette e lotti leggibili'],
  ['scadenza', 'Scadenze ok'],
  ['trasporto', 'Mezzo di trasporto pulito'],
];
export const controlloFatto = b => !!(b.controllo && b.controllo.esito);

// ---------- scadenzario ----------
export const SCADENZE_CONSIGLIATE = [
  ['Analisi dell\'acqua', 12],
  ['Taratura termometri', 12],
  ['Taratura pHmetro', 1],
  ['Manutenzione impianto e celle frigo', 12],
  ['Disinfestazione e derattizzazione', 3],
  ['Formazione HACCP del personale', 24],
  ['Revisione del piano HACCP', 12],
];
export const GIORNI_PREAVVISO = 30;
export function addMesi(iso, mesi) {
  const [y, m, d] = iso.split('-').map(Number);
  const fine = new Date(Date.UTC(y, m - 1 + Number(mesi) + 1, 0)).getUTCDate(); // 31 gennaio + 1 mese = 28/29 febbraio
  return new Date(Date.UTC(y, m - 1 + Number(mesi), Math.min(d, fine))).toISOString().slice(0, 10);
}
// { prossima, giorni, stato: 'scaduta'|'vicina'|'ok'|'manca' }
export function statoScadenzaHaccp(s, oggi = oggiISO()) {
  if (!s.ultima || !(Number(s.ogniMesi) > 0)) return { prossima: '', giorni: null, stato: 'manca' };
  const prossima = addMesi(s.ultima, s.ogniMesi);
  const giorni = diffGiorni(oggi, prossima);
  return { prossima, giorni, stato: giorni < 0 ? 'scaduta' : giorni <= GIORNI_PREAVVISO ? 'vicina' : 'ok' };
}
// per la Home: scadute e in scadenza, le più urgenti prima
export function scadenzeDaFare(scadenze, oggi = oggiISO()) {
  return scadenze.filter(s => !s.eliminato).map(s => ({ s, ...statoScadenzaHaccp(s, oggi) }))
    .filter(x => x.stato === 'scaduta' || x.stato === 'vicina').sort((a, b) => a.giorni - b.giorni);
}

// ---------- pulizie e sanificazioni (CIP) ----------
export const FASI_PULIZIA = ['Risciacquo', 'Alcalino (soda)', 'Acido', 'Sanificante'];
export const LINEE = ['Sala cottura', 'Linea fusti', 'Linea lattine', 'Tubi e raccordi', 'Scambiatore'];
export const GIORNI_AVVISO_PULIZIA = 14;
const kc = s => String(s || '').trim().toLowerCase();

// Per ogni FV: com'è oggi (pieno o vuoto), ultima pulizia, se è stato pulito dopo l'ultimo svuotamento
// e il prossimo riempimento. Una cotta doppia nello stesso FV conta come un solo riempimento.
// Il FV "si svuota" il giorno dopo la fine in FV (o il giorno del travaso): la pulizia vale da quel giorno
// fino al giorno del riempimento compreso.
export function statoFermentatori(cotte, durate, fvs, pulizie, oggi = oggiISO()) {
  const valide = pulizie.filter(p => !p.eliminato && p.data);
  return fvs.map(fv => {
    const periodi = cotte.filter(c => !c.eliminato).flatMap(c => periodiCotta(c, durate, fvs)).filter(p => p.fv === fv.nome)
      .sort((a, b) => a.da.localeCompare(b.da));
    const riempimenti = [];
    for (const p of periodi) {
      const ultimo = riempimenti[riempimenti.length - 1];
      if (ultimo && p.da <= ultimo.a && nomeBirra(p.cotta.birra) === nomeBirra(ultimo.cotte[0].birra)) { if (p.a > ultimo.a) ultimo.a = p.a; ultimo.cotte.push(p.cotta); continue; }
      riempimenti.push({ da: p.da, a: p.a, cotte: [p.cotta], travaso: !!p.travaso });
    }
    const sue = valide.filter(p => kc(p.cosa) === kc(fv.nome)).sort((a, b) => b.data.localeCompare(a.data));
    const pulitoTra = (da, a) => sue.some(p => (!da || p.data >= da) && p.data <= a);
    riempimenti.forEach((r, i) => {
      r.svuotatoPrima = i ? addGiorni(riempimenti[i - 1].a, 1) : '';
      r.pulito = pulitoTra(r.svuotatoPrima ? addGiorni(r.svuotatoPrima, -1) : '', r.da);
    });
    const ora = riempimenti.find(r => r.da <= oggi && r.a >= oggi) || null;
    const prima = riempimenti.filter(r => r.a < oggi).pop() || null;
    const prossimo = riempimenti.find(r => r.da > oggi) || null;
    const svuotato = ora ? '' : prima ? addGiorni(prima.a, 1) : '';
    // vuoto oggi: pulito se c'è una pulizia dal giorno dello svuotamento in poi
    const pulitoOra = ora ? ora.pulito : pulitoTra(svuotato ? addGiorni(svuotato, -1) : '', '9999-12-31');
    return { fv, ora, prossimo, svuotato, ultima: sue[0] || null, pulitoOra, riempimenti };
  });
}
// FV da pulire prima di un riempimento vicino (entro GIORNI_AVVISO_PULIZIA giorni) o vuoti e sporchi.
// Si parte dal giorno della prima pulizia registrata: prima di allora il registro non c'era.
export const inizioRegistroPulizie = pulizie => pulizie.filter(p => !p.eliminato && p.data).map(p => p.data).sort()[0] || '';
export function fvDaPulire(stati, pulizie, oggi = oggiISO()) {
  const inizio = inizioRegistroPulizie(pulizie);
  if (!inizio) return [];
  return stati.filter(s => !s.ora && !s.pulitoOra
    && ((s.svuotato && s.svuotato >= inizio) || (s.prossimo && diffGiorni(oggi, s.prossimo.da) <= GIORNI_AVVISO_PULIZIA)))
    .map(s => ({ ...s, giorni: s.prossimo ? diffGiorni(oggi, s.prossimo.da) : null }))
    .sort((a, b) => (a.giorni ?? 999) - (b.giorni ?? 999));
}
