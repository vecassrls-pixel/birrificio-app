// HACCP: rintracciabilità per lotto di birra, controllo materie prime in arrivo, scadenzario.
//
// Record nell'archivio:
//   bolla.controllo  { imballo, etichetta, scadenza, trasporto: bool, esito: 'conforme'|'non conforme', chi, note }
//   scadenzahaccp    { nome, ogniMesi, ultima: 'AAAA-MM-GG', note, storico: [{ data }] }
//   pulizia          { data, cosa (nome del FV o della linea), fasi: [], prodotti, chi, note, auto?, nonFatta? }
//                    auto: nata dallo svuotamento di un FV (id 'pulizia-auto-<FV>-<data>'), nonFatta: riga automatica tolta a mano

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

// ---------- operatori ----------
// Elenco ordinato in Impostazioni (record condiviso): il primo è quello proposto in pulizie e controllo merci.
export const ID_OPERATORI = 'impostazione-operatori';
export const OPERATORI_DEFAULT = ['LUCA FERRI'];
export const operatoriDa = rec => (rec && !rec.eliminato && rec.nomi?.filter(Boolean).length ? rec.nomi.filter(Boolean) : OPERATORI_DEFAULT);
// voci del menu: gli operatori, più il nome già salvato su un record vecchio se non è più in elenco
export const opzioniOperatori = (nomi, scelto) => (scelto && !nomi.includes(scelto) ? [...nomi, scelto] : nomi);

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
export const LINEE = ['Sala cottura', 'Inlattinatrice', 'Linea fusti', 'Linea lattine', 'Tubi e raccordi', 'Scambiatore'];
export const GIORNI_AVVISO_PULIZIA = 14;
const kc = s => String(s || '').trim().toLowerCase();

// Per ogni FV: com'è oggi (pieno o vuoto), ultima pulizia, se è stato pulito dopo l'ultimo svuotamento
// e il prossimo riempimento. Una cotta doppia nello stesso FV conta come un solo riempimento.
// Il FV "si svuota" il giorno dopo la fine in FV (o il giorno del travaso): la pulizia vale da quel giorno
// fino al giorno del riempimento compreso.
export function statoFermentatori(cotte, durate, fvs, pulizie, oggi = oggiISO()) {
  const valide = pulizie.filter(p => !p.eliminato && !p.nonFatta && p.data);
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
// Pulizie automatiche (Romain 2026-10-20): ogni FV che si svuota (fine in FV o travaso) ha la sua pulizia
// il giorno dello svuotamento, con fasi e prodotti di default e il primo operatore, se non ce n'è già una registrata
// tra lo svuotamento e il riempimento dopo. Restituisce le pulizie registrate più quelle automatiche (non salvate).
export const PRODOTTI_PULIZIE = 'Soda 3%, sanificante 2%'; // default di Romain, 2026-10-15
export const FASI_DEFAULT_PULIZIA = FASI_PULIZIA.filter(f => f !== 'Acido');
export const INLATTINATRICE = 'Inlattinatrice';
export const idPuliziaAuto = (fv, data) => `pulizia-auto-${fv}-${data}`;
export function conPulizieAutomatiche(cotte, durate, fvs, pulizie, chi = '', oggi = oggiISO()) {
  const registrate = pulizie.filter(p => !p.eliminato);
  const ids = new Set(registrate.map(p => p.id));
  const auto = [];
  for (const s of statoFermentatori(cotte, durate, fvs, registrate, oggi)) {
    s.riempimenti.forEach((r, i) => {
      const data = addGiorni(r.a, 1);
      if (data > oggi) return;
      const id = idPuliziaAuto(s.fv.nome, data);
      if (ids.has(id)) return;
      const prossimo = s.riempimenti[i + 1]?.da || oggi;
      const fatta = registrate.some(p => !p.nonFatta && kc(p.cosa) === kc(s.fv.nome) && p.data >= addGiorni(data, -1) && p.data <= prossimo);
      if (!fatta) auto.push({ id, tipo: 'pulizia', auto: true, data, cosa: s.fv.nome, fasi: FASI_DEFAULT_PULIZIA, prodotti: PRODOTTI_PULIZIE, chi, note: '', birra: r.cotte[0]?.birra || '' });
    });
  }
  // inlattinatrice (Romain 2026-10-20): una pulizia per ogni giorno di confezionamento in lattina
  const giorniLattine = new Map();
  for (const c of cotte.filter(x => !x.eliminato)) {
    for (const r of c.confezionato || []) {
      const data = r.data || c.fine || '';
      if (data && data <= oggi && Number(r.pezzi) > 0 && /lattin/i.test(r.tipo || '') && !giorniLattine.has(data)) giorniLattine.set(data, c.birra || '');
    }
  }
  for (const [data, birra] of giorniLattine) {
    const id = idPuliziaAuto(INLATTINATRICE, data);
    if (ids.has(id) || registrate.some(p => !p.nonFatta && p.data === data && /inlattinatrice|linea lattine/i.test(p.cosa || ''))) continue;
    auto.push({ id, tipo: 'pulizia', auto: true, data, cosa: INLATTINATRICE, fasi: FASI_DEFAULT_PULIZIA, prodotti: PRODOTTI_PULIZIE, chi, note: '', birra });
  }
  return [...registrate.filter(p => !p.nonFatta), ...auto];
}
// FV da pulire prima di un riempimento vicino (entro GIORNI_AVVISO_PULIZIA giorni) o vuoti e sporchi.
// Si parte dal giorno della prima pulizia registrata: prima di allora il registro non c'era.
export const inizioRegistroPulizie = pulizie => pulizie.filter(p => !p.eliminato && !p.nonFatta && p.data).map(p => p.data).sort()[0] || '';
export function fvDaPulire(stati, pulizie, oggi = oggiISO()) {
  const inizio = inizioRegistroPulizie(pulizie);
  if (!inizio) return [];
  return stati.filter(s => !s.ora && !s.pulitoOra
    && ((s.svuotato && s.svuotato >= inizio) || (s.prossimo && diffGiorni(oggi, s.prossimo.da) <= GIORNI_AVVISO_PULIZIA)))
    .map(s => ({ ...s, giorni: s.prossimo ? diffGiorni(oggi, s.prossimo.da) : null }))
    .sort((a, b) => (a.giorni ?? 999) - (b.giorni ?? 999));
}

// ---------- schede ISSAN: monitoraggio insetti e roditori, esecuzione pulizie ambienti ----------
// Moduli del consulente HACCP (ISSAN SRL), annata da marzo a febbraio. Si compilano da soli e si correggono:
//   infestanti       { mese: 'AAAA-MM', voci: { chiave: 'assenza'|'presenza' }, chi, note }  (id 'infestanti-AAAA-MM')
//   puliziaambiente  { data, fatta: bool, chi }  (id 'pamb-AAAA-MM-GG'; fatta false = riga automatica tolta)
export const MODULO_ISSAN = { ditta: 'VECAS DI ROMAIN VERRECCHIA', consulente: 'ISSAN SRL', dottoressa: 'Dott.ssa Mariagrazia Mercuri', rev: 'Rev. 01', revData: '13/03/2025' };
export const VOCI_INFESTANTI = [
  ['peli', 'Peli o piume'], ['rasure', 'Rasure o segni di roditori'], ['insettiVivi', 'Insetti vivi'], ['insettiMorti', 'Insetti morti'],
  ['roditori', 'Roditori'], ['contenitori', 'Contenitori danneggiati da insetti o roditori'], ['feci', 'Feci o altri escrementi di roditori'],
  ['esche', 'Animali infestanti nelle esche/ trappole'],
];
export const INIZIO_SCHEDE = '2026-03'; // da qui le schede si compilano da sole (prima c'era la carta)
export const GIORNI_PULIZIA_AMBIENTI = [7, 21]; // circa due volte al mese, come sul foglio
export const annataHaccp = iso => (Number(iso.slice(5, 7)) >= 3 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
export const mesiAnnata = anno => Array.from({ length: 12 }, (_, i) => {
  const m = 3 + i, y = anno + (m > 12 ? 1 : 0);
  return `${y}-${String(m > 12 ? m - 12 : m).padStart(2, '0')}`;
});
const MESI_CORTI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseCorto = ym => `${MESI_CORTI[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const meseLungo = ym => `${MESI_LUNGHI[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const giorniDelMese = ym => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// Scheda del mese: quella salvata, oppure tutto "Assenza" col primo operatore (dal mese di INIZIO_SCHEDE fino a quello in corso)
export function schedaInfestanti(mese, salvate, chi, oggi = oggiISO()) {
  const s = salvate.find(x => !x.eliminato && x.mese === mese);
  if (s) return { ...s, auto: false };
  if (mese < INIZIO_SCHEDE || mese > oggi.slice(0, 7)) return null;
  return { id: `infestanti-${mese}`, tipo: 'infestanti', mese, voci: Object.fromEntries(VOCI_INFESTANTI.map(([k]) => [k, 'assenza'])), chi, note: '', auto: true };
}

// Giorni di pulizia ambienti di un mese: i GIORNI_PULIZIA_AMBIENTI (sabato e domenica vanno al venerdì prima),
// fino a oggi e da INIZIO_SCHEDE, più quelli segnati a mano. Map 'AAAA-MM-GG' -> { data, chi, auto }
export function pulizieAmbientiMese(mese, salvate, chi, oggi = oggiISO()) {
  const out = new Map();
  if (mese >= INIZIO_SCHEDE) {
    for (const g of GIORNI_PULIZIA_AMBIENTI) {
      let d = `${mese}-${String(Math.min(g, giorniDelMese(mese))).padStart(2, '0')}`;
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow === 6) d = addGiorni(d, -1); else if (dow === 0) d = addGiorni(d, -2);
      if (d <= oggi) out.set(d, { data: d, chi, auto: true });
    }
  }
  for (const r of salvate.filter(x => !x.eliminato && x.data?.startsWith(mese))) {
    if (r.fatta === false) out.delete(r.data);
    else out.set(r.data, { data: r.data, chi: r.chi || chi, auto: false });
  }
  return out;
}
export const sigla = nome => String(nome || '').trim().split(/\s+/).filter(Boolean).map(p => `${p[0].toUpperCase()}.`).join('');
