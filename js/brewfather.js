// Import di cotte e ricette da Brewfather.
//
// Brewfather resta il posto dove si scrivono ricette e cotte. L'app le importa e ci aggiunge
// quello che Brewfather non ha: fermentatore, tacche del serbatoio, letture, confezionamento.
// Le chiamate passano dal proxy netlify/functions/brewfather.mjs, che tiene la chiave API sul server.
//
// Cosa arriva da Brewfather e sovrascrive: birra, n° cotta, data, ricetta (malti, luppoli,
// lievito, sali/additivi), OG/FG/litri/pH misurati, letture del densimetro.
// Cosa resta dell'app: FV, fine in FV, tacche, confezionamento, note, letture scritte a mano.

import { addGiorni, conAdditiviDefault, toISO, fasiCotta, gruppoCotta, litriConfezionati, oggiISO, platoASG, statoCotta } from './dominio.js';

export const PROXY_DEFAULT = '/.netlify/functions/brewfather';
const STATI_ATTIVI = ['Planning', 'Brewing', 'Fermenting', 'Conditioning'];

export const sgAPlato = sg => {
  if (!sg) return null;
  if (sg > 2) return sg; // già in °P
  return Math.round((-616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3) * 10) / 10;
};
const giornoISO = ms => (ms ? toISO(new Date(ms)) : null);
const num = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// ---------- chiamate ----------
// Il proxy risponde solo agli utenti loggati: ogni chiamata porta il token dell'utente
let tokenFn = async () => null;
export const usaToken = fn => { tokenFn = fn; };

async function chiama(proxy, path, params = {}, corpo = null) {
  const q = new URLSearchParams({ path, ...params });
  const t = await tokenFn();
  const res = await fetch(`${proxy}?${q}`, {
    method: corpo ? 'PATCH' : 'GET',
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (res.status === 401) throw new Error('Brewfather: accesso scaduto, rientra nell\'app');
  if (res.status === 429) throw new Error('Brewfather: troppe richieste, riprova tra qualche minuto');
  if (res.status === 403 && corpo) throw new Error('Brewfather: la chiave API non può modificare le cotte. Crea in Brewfather una chiave con il permesso "Edit Batches" e aggiornala su Netlify.');
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).errore || msg; } catch { /* risposta non JSON */ }
    throw new Error(`Brewfather: ${msg} (${res.status})`);
  }
  const testo = await res.text();
  try { return JSON.parse(testo); } catch { return testo; } // PATCH risponde "Updated"
}

async function tuttiIBatch(proxy, extra = {}) {
  const out = [];
  let dopo;
  for (;;) {
    const pagina = await chiama(proxy, '/batches', { complete: 'true', limit: '50', ...extra, ...(dopo ? { start_after: dopo } : {}) });
    out.push(...pagina);
    if (pagina.length < 50) return out;
    dopo = pagina[pagina.length - 1]._id;
  }
}

// completo = tutto lo storico; altrimenti solo le cotte non ancora chiuse
export async function scaricaBatch(proxy = PROXY_DEFAULT, { completo = false } = {}) {
  if (completo) return tuttiIBatch(proxy);
  const liste = [];
  for (const status of STATI_ATTIVI) liste.push(...await tuttiIBatch(proxy, { status }));
  return liste;
}

export async function scaricaLetture(proxy, batchId) {
  try { return await chiama(proxy, `/batches/${batchId}/readings`); } catch { return []; }
}

// ---------- conversione ----------
const USO_LUPPOLO = { Boil: 'bollitura', 'Dry Hop': 'dry hop', Aroma: 'dip hop', Whirlpool: 'whirlpool', 'First Wort': 'first wort', Mash: 'mash hop' };

// Nome del malto con la marca (supplier), che in magazzino distingue "Pils Dingemans" da "Pils Soufflet"
const conMarca = (nome, marca) => {
  const m = String(marca || '').trim();
  return m && !String(nome || '').toLowerCase().includes(m.toLowerCase().split(/\s+/)[0]) ? `${nome} ${m}` : nome;
};
// Luppolo in forma cryo/lupulina (tipo in Brewfather): "Mosaic" → "Mosaic Cryo"
const conCryo = (nome, tipo) => (/cryo|lupulin|powder|lupomax/i.test(tipo || '') && !/cryo|lupulin|lupomax/i.test(nome || '') ? `${nome} Cryo` : nome);

export function ricettaDaBatch(b) {
  const r = b.recipe || {};
  const unita = u => ({ g: 'g', kg: 'kg', ml: 'ml', l: 'L', pkg: '' }[(u || '').toLowerCase()] ?? (u || ''));
  return {
    ...(r.style?.name ? { stile: r.style.name } : {}),
    malti: (r.fermentables || []).map(f => ({ nome: conMarca(f.name, f.supplier), qta: num(f.amount), unita: 'kg' })),
    luppoli: (r.hops || []).map(h => ({
      nome: conCryo(h.name, h.type), qta: num(h.amount), unita: 'g',
      ...(num(h.time) !== null && h.use !== 'Dry Hop' ? { minuti: num(h.time) } : {}),
      uso: USO_LUPPOLO[h.use] ?? '',
      ...(h.use === 'Dry Hop' && num(h.day) !== null ? { giorno: num(h.day) } : {}),
    })),
    lievito: (r.yeasts || []).map(y => ({ nome: [y.name, y.productId].filter(Boolean).join(' '), qta: num(y.amount), unita: unita(y.unit) })),
    sali: conAdditiviDefault((r.miscs || []).map(m => ({ nome: m.name, qta: num(m.amount), unita: unita(m.unit) }))),
  };
}

// Profilo di temperatura dalla ricetta (step di fermentazione in giorni)
export function profiloDaRicetta(b, dataCotta) {
  const steps = b.recipe?.fermentation?.steps || [];
  const out = [];
  let g = 0;
  for (const s of steps) {
    const giorni = Math.max(1, Math.round(num(s.stepTime) || 1));
    for (let i = 0; i < giorni; i++, g++) out.push({ data: addGiorni(dataCotta, g), giorno: g + 1, temp: num(s.stepTemp) });
  }
  return out;
}

// Una lettura al giorno (l'ultima) da densimetri tipo Tilt/iSpindel
export function lettureGiornaliere(letture) {
  const perGiorno = new Map();
  for (const l of letture || []) {
    const d = giornoISO(l.time || l.timepoint);
    if (d) perGiorno.set(d, l);
  }
  return [...perGiorno].map(([data, l]) => ({ data, densita: sgAPlato(num(l.sg)), temp: num(l.temp) }));
}

// Unisce un batch Brewfather in una cotta (nuova o esistente). Non tocca i dati di sala.
export function unisci(esistente, b, letture = []) {
  const data = giornoISO(b.brewDate) || esistente?.data || null;
  const anno = data ? Number(data.slice(0, 4)) : esistente?.anno;
  const numero = num(b.batchNo) ?? esistente?.numero ?? null;
  const birra = (b.recipe?.name || b.name || esistente?.birra || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const c = esistente ? JSON.parse(JSON.stringify(esistente)) : {
    tipo: 'cotta', fv: '', sali: [], malti: [], luppoli: [], lievito: [], acquaMash: {}, acquaSparge: {},
    fermentazione: [], confezionato: [], note: '',
  };
  if (esistente?.data && data && esistente.data !== data && !esistente.brewfather) {
    // la data è cambiata rispetto al planning: sposta fine in FV e profilo
    const delta = Math.round((new Date(data) - new Date(esistente.data)) / 86400000);
    if (c.fine) c.fine = addGiorni(c.fine, delta);
    c.fermentazione = (c.fermentazione || []).map(e => (e.data ? { ...e, data: addGiorni(e.data, delta) } : e));
    if (c.travaso?.data) c.travaso = { ...c.travaso, data: addGiorni(c.travaso.data, delta) };
  }
  Object.assign(c, { birra, numero, anno, data, lotto: numero && anno ? `${numero}/${String(anno).slice(2)}` : c.lotto });
  if ((b.recipe?.fermentables || []).length) Object.assign(c, ricettaDaBatch(b));

  const misurati = {
    og: sgAPlato(num(b.measuredOg)), fg: sgAPlato(num(b.measuredFg)),
    litri: num(b.measuredBatchSize), phMash: num(b.measuredMashPh),
  };
  for (const [k, v] of Object.entries(misurati)) if (v !== null) c[k] = v;
  if (c.og == null && b.recipe?.og) c.og = sgAPlato(num(b.recipe.og));
  if (c.litri == null && num(b.recipe?.batchSize) > 0) c.litri = Math.round(num(b.recipe.batchSize)); // litri previsti in FV
  completaDaRicetta(c, b.recipe);

  // fermentazione: profilo dalla ricetta se manca, poi letture del densimetro sui giorni corrispondenti
  if (!c.fermentazione.length && data) c.fermentazione = profiloDaRicetta(b, data);
  for (const l of lettureGiornaliere(letture)) {
    const e = c.fermentazione.find(x => x.data === l.data);
    if (e) {
      if (e.densita == null && l.densita !== null) e.densita = l.densita;
    } else {
      c.fermentazione.push({ data: l.data, temp: l.temp, densita: l.densita, nota: 'densimetro' });
    }
  }
  c.fermentazione.sort((x, y) => (x.data || '').localeCompare(y.data || ''));

  // valori misurati come arrivano da Brewfather: servono per capire cosa è cambiato nell'app
  const misure = { og: misurati.og, fg: misurati.fg, litri: misurati.litri, phMash: misurati.phMash, ogRicetta: sgAPlato(num(b.recipe?.og)) };
  c.brewfather = { ...(esistente?.brewfather || {}), id: b._id, stato: b.status || null, importato: new Date().toISOString(), misure };
  return c;
}

// Acqua di mash e sparge, temperatura di mash e whirlpool dalla ricetta.
// Import dei batch: solo se non già scritti nell'app; import di una ricetta scelta (forza): sempre, se la ricetta li ha.
function completaDaRicetta(c, r = {}, forza = false) {
  const w = r.data || {};
  const metti = (o, k, v) => { if (v !== null && (forza || o[k] == null)) o[k] = v; };
  c.acquaMash = { ...c.acquaMash };
  c.acquaSparge = { ...c.acquaSparge };
  // durata del whirlpool: il tempo più lungo dei luppoli in whirlpool (in Brewfather "Aroma" è il dip hop)
  const wp = (r.hops || []).filter(h => h.use === 'Whirlpool').map(h => num(h.time)).filter(t => t > 0);
  metti(c, 'whirlpoolMin', wp.length ? Math.max(...wp) : null);
  metti(c.acquaMash, 'litri', num(w.mashWaterAmount) !== null ? Math.round(num(w.mashWaterAmount)) : null);
  metti(c.acquaSparge, 'litri', num(w.spargeWaterAmount) !== null ? Math.round(num(w.spargeWaterAmount)) : null);
  metti(c.acquaMash, 'tempMash', num(r.mash?.steps?.[0]?.stepTemp));
}

// ---------- ricette ----------
// Per una cotta solo pianificata (il batch in Brewfather non c'è ancora): si sceglie la ricetta
// e la scheda prende ingredienti, acqua, whirlpool e profilo di fermentazione.
export async function elencoRicette(proxy = PROXY_DEFAULT) {
  const out = [];
  let dopo;
  for (;;) {
    const pagina = await chiama(proxy, '/recipes', { limit: '50', ...(dopo ? { start_after: dopo } : {}) });
    out.push(...pagina);
    if (pagina.length < 50) break;
    dopo = pagina[pagina.length - 1]._id;
  }
  return out.map(r => ({ id: r._id, nome: r.name || '', stile: r.style?.name || '' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

export const scaricaRicetta = (proxy, id) => chiama(proxy || PROXY_DEFAULT, `/recipes/${id}`);

// Campi della cotta da una ricetta Brewfather. Il profilo di fermentazione si sostituisce solo se
// nel registro non c'è ancora nessuna misura (densità o pH).
export function ricettaPerCotta(c, r) {
  const b = { recipe: r };
  const nuovo = { ...c, ...ricettaDaBatch(b) };
  completaDaRicetta(nuovo, r, true);
  if (r.og) nuovo.og = sgAPlato(num(r.og)); // OG della ricetta (°P), poi si sovrascrive con la misurata
  // litri finali previsti (volume in fermentatore della ricetta), se non c'è già quello misurato
  if (num(r.batchSize) > 0 && c.brewfather?.misure?.litri == null) nuovo.litri = Math.round(num(r.batchSize));
  nuovo.dh = nuovo.luppoli.some(h => h.uso === 'dry hop');
  const misurato = (c.fermentazione || []).some(e => [e.densita, e.ph].some(v => v !== null && v !== undefined && v !== ''));
  if (!misurato && c.data && (r.fermentation?.steps || []).length) nuovo.fermentazione = profiloDaRicetta(b, c.data);
  nuovo.ricettaBf = { id: r._id, nome: r.name || '', importata: new Date().toISOString() };
  return nuovo;
}

// Nomi "simili": LAMORTESUA ~ "La Morte Sua DIPA", ignorando spazi e punteggiatura
const chiave = n => (n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function nomiSimili(a, b) {
  const x = chiave(a), y = chiave(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
const distanzaGiorni = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;

// Trova la cotta locale da collegare a un batch Brewfather:
// 1. già collegata (stesso id Brewfather)
// 2. stesso n° e anno, con birra simile o data entro un giorno
// 3. cotta pianificata nell'app (non ancora collegata) della stessa birra entro 14 giorni:
//    il planning si fa prima nell'app e la cotta in Brewfather arriva dopo, magari con la data spostata
export function cottaCorrispondente(cotte, b) {
  const perId = cotte.find(c => c.brewfather?.id === b._id);
  if (perId) return perId;
  const data = giornoISO(b.brewDate);
  const anno = data ? Number(data.slice(0, 4)) : null;
  const birra = b.recipe?.name || b.name || '';
  const liberi = cotte.filter(c => !c.brewfather && !c.eliminato);
  const perNumero = liberi.find(c => c.numero === num(b.batchNo) && c.anno === anno
    && (nomiSimili(c.birra, birra) || (data && c.data && distanzaGiorni(c.data, data) <= 1)));
  if (perNumero) return perNumero;
  if (!data) return null;
  const candidati = liberi
    .filter(c => c.data && nomiSimili(c.birra, birra) && distanzaGiorni(c.data, data) <= 14)
    .sort((x, y) => distanzaGiorni(x.data, data) - distanzaGiorni(y.data, data));
  return candidati[0] || null;
}

// Collegamento manuale: la cotta pianificata nell'app prende i dati della cotta arrivata da Brewfather.
// Restano quelli dell'app: FV, tacche, confezionamento, note, profilo/letture già scritti.
export function uniscaManuale(pianificata, daBf) {
  const c = JSON.parse(JSON.stringify(pianificata));
  for (const k of ['birra', 'stile', 'numero', 'anno', 'lotto', 'malti', 'luppoli', 'lievito', 'sali', 'og', 'fg', 'litri', 'phMash', 'brewfather']) {
    if (daBf[k] !== undefined && daBf[k] !== null) c[k] = daBf[k];
  }
  if (daBf.data && c.data && daBf.data !== c.data) {
    const delta = Math.round((new Date(daBf.data) - new Date(c.data)) / 86400000);
    if (c.fine) c.fine = addGiorni(c.fine, delta);
    c.fermentazione = (c.fermentazione || []).map(e => (e.data ? { ...e, data: addGiorni(e.data, delta) } : e));
    if (c.travaso?.data) c.travaso = { ...c.travaso, data: addGiorni(c.travaso.data, delta) };
    c.data = daBf.data;
  }
  if (!(c.fermentazione || []).length) c.fermentazione = daBf.fermentazione || [];
  return c;
}

// ---------- invio dei valori misurati a Brewfather ----------
// L'API permette di cambiare solo stato e valori misurati della cotta (non ricetta né letture).
// Si inviano OG, FG (in SG), litri in FV, pH mash, litri confezionati (cotte singole) e lo stato,
// che va solo avanti (Planning → Fermenting → Conditioning → Completed), mai indietro.
const ORDINE_STATI = ['Planning', 'Brewing', 'Fermenting', 'Conditioning', 'Completed', 'Archived'];
const sg = p => (p === null || p === undefined || p === '' ? null : Math.round(platoASG(Number(p)) * 10000) / 10000);
export const ETICHETTE_BF = { og: 'OG', fg: 'FG', litri: 'Litri in FV', phMash: 'pH mash', litriConf: 'Litri confezionati', stato: 'Stato' };

export function statoBrewfather(c, durate, oggi = oggiISO(), cotte = null) {
  const s = statoCotta(c, durate, oggi, cotte);
  if (s === 'pianificata') return 'Planning';
  if (s === 'tank') {
    const f = fasiCotta(c, durate).find(x => x.da <= oggi && x.a >= oggi);
    return f?.fase === 'maturazione' ? 'Conditioning' : 'Fermenting';
  }
  return 'Completed';
}

// Valori dell'app (in °P e litri) e cosa è diverso da quanto Brewfather ha già
export function daInviare(c, cotte, durate) {
  if (!c.brewfather?.id) return null;
  const g = gruppoCotta(c, cotte);
  const app = { og: c.og ?? null, fg: c.fg ?? null, litri: c.litri ?? null, phMash: c.phMash ?? null, litriConf: g.length === 1 && litriConfezionati(c) ? litriConfezionati(c) : null };
  const noti = { ...(c.brewfather.misure || {}), ...(c.brewfather.inviato?.valori || {}) };
  const diversi = {};
  for (const [k, v] of Object.entries(app)) {
    if (v === null || v === '' || Number.isNaN(Number(v))) continue;
    if (k === 'og' && noti.og == null && noti.ogRicetta != null && Math.abs(noti.ogRicetta - v) < 0.05) continue; // OG stimato dalla ricetta, non misurato
    if (noti[k] === undefined || noti[k] === null || Math.abs(Number(noti[k]) - Number(v)) > (k === 'og' || k === 'fg' || k === 'phMash' ? 0.05 : 0.5)) diversi[k] = Number(v);
  }
  const stato = statoBrewfather(c, durate, undefined, cotte);
  if (ORDINE_STATI.indexOf(stato) > ORDINE_STATI.indexOf(c.brewfather.stato || 'Planning')) diversi.stato = stato;
  return diversi;
}

// Corpo della richiesta PATCH /batches/:id
export function corpoBrewfather(diversi) {
  const corpo = {};
  if (diversi.og !== undefined) corpo.measuredOg = sg(diversi.og);
  if (diversi.fg !== undefined) corpo.measuredFg = sg(diversi.fg);
  if (diversi.litri !== undefined) corpo.measuredBatchSize = diversi.litri;
  if (diversi.phMash !== undefined) corpo.measuredMashPh = diversi.phMash;
  if (diversi.litriConf !== undefined) corpo.measuredBottlingSize = diversi.litriConf;
  if (diversi.stato !== undefined) corpo.status = diversi.stato;
  return corpo;
}

// Invia e restituisce la cotta aggiornata (da salvare) con quanto inviato
export async function inviaMisure(proxy, c, diversi) {
  const corpo = corpoBrewfather(diversi);
  if (!Object.keys(corpo).length) return c;
  await chiama(proxy, `/batches/${c.brewfather.id}`, {}, corpo);
  const { stato, ...valori } = diversi;
  return {
    ...c,
    brewfather: {
      ...c.brewfather,
      ...(stato ? { stato } : {}),
      inviato: { data: new Date().toISOString(), valori: { ...(c.brewfather.inviato?.valori || {}), ...valori } },
    },
  };
}
