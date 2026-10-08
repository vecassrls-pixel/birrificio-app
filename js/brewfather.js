// Import di cotte e ricette da Brewfather.
//
// Brewfather resta il posto dove si scrivono ricette e cotte. L'app le importa e ci aggiunge
// quello che Brewfather non ha: fermentatore, tacche del serbatoio, letture, confezionamento.
// Le chiamate passano dal proxy netlify/functions/brewfather.mjs, che tiene la chiave API sul server.
//
// Cosa arriva da Brewfather e sovrascrive: birra, n° cotta, data, ricetta (malti, luppoli,
// lievito, sali/additivi), OG/FG/litri/pH misurati, letture del densimetro.
// Cosa resta dell'app: FV, fine in FV, tacche, confezionamento, note, letture scritte a mano.

import { addGiorni, toISO } from './dominio.js';

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

async function chiama(proxy, path, params = {}) {
  const q = new URLSearchParams({ path, ...params });
  const t = await tokenFn();
  const res = await fetch(`${proxy}?${q}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (res.status === 401) throw new Error('Brewfather: accesso scaduto, rientra nell\'app');
  if (res.status === 429) throw new Error('Brewfather: troppe richieste, riprova tra qualche minuto');
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).errore || msg; } catch { /* risposta non JSON */ }
    throw new Error(`Brewfather: ${msg} (${res.status})`);
  }
  return res.json();
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
const USO_LUPPOLO = { Boil: 'bollitura', 'Dry Hop': 'dry hop', Aroma: 'whirlpool', Whirlpool: 'whirlpool', 'First Wort': 'bollitura', Mash: '' };

export function ricettaDaBatch(b) {
  const r = b.recipe || {};
  const unita = u => ({ g: 'g', kg: 'kg', ml: 'ml', l: 'L', pkg: '' }[(u || '').toLowerCase()] ?? (u || ''));
  return {
    malti: (r.fermentables || []).map(f => ({ nome: f.name, qta: num(f.amount), unita: 'kg' })),
    luppoli: (r.hops || []).map(h => ({
      nome: h.name, qta: num(h.amount), unita: 'g',
      ...(num(h.time) !== null && h.use !== 'Dry Hop' ? { minuti: num(h.time) } : {}),
      uso: USO_LUPPOLO[h.use] ?? '',
      ...(h.use === 'Dry Hop' && num(h.day) !== null ? { giorno: num(h.day) } : {}),
    })),
    lievito: (r.yeasts || []).map(y => ({ nome: [y.name, y.productId].filter(Boolean).join(' '), qta: num(y.amount), unita: unita(y.unit) })),
    sali: (r.miscs || []).map(m => ({ nome: m.name, qta: num(m.amount), unita: unita(m.unit) })),
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
  }
  Object.assign(c, { birra, numero, anno, data, lotto: numero && anno ? `${numero}/${String(anno).slice(2)}` : c.lotto });
  if ((b.recipe?.fermentables || []).length) Object.assign(c, ricettaDaBatch(b));

  const misurati = {
    og: sgAPlato(num(b.measuredOg)), fg: sgAPlato(num(b.measuredFg)),
    litri: num(b.measuredBatchSize), phMash: num(b.measuredMashPh),
  };
  for (const [k, v] of Object.entries(misurati)) if (v !== null) c[k] = v;
  if (c.og == null && b.recipe?.og) c.og = sgAPlato(num(b.recipe.og));
  const w = b.recipe?.data || {};
  c.acquaMash = { ...c.acquaMash };
  c.acquaSparge = { ...c.acquaSparge };
  if (c.acquaMash.litri == null && num(w.mashWaterAmount) !== null) c.acquaMash.litri = Math.round(num(w.mashWaterAmount));
  if (c.acquaSparge.litri == null && num(w.spargeWaterAmount) !== null) c.acquaSparge.litri = Math.round(num(w.spargeWaterAmount));
  const step = b.recipe?.mash?.steps?.[0];
  if (c.acquaMash.tempMash == null && step && num(step.stepTemp) !== null) c.acquaMash.tempMash = num(step.stepTemp);

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

  c.brewfather = { id: b._id, stato: b.status || null, importato: new Date().toISOString() };
  return c;
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
  for (const k of ['birra', 'numero', 'anno', 'lotto', 'malti', 'luppoli', 'lievito', 'sali', 'og', 'fg', 'litri', 'phMash', 'brewfather']) {
    if (daBf[k] !== undefined && daBf[k] !== null) c[k] = daBf[k];
  }
  if (daBf.data && c.data && daBf.data !== c.data) {
    const delta = Math.round((new Date(daBf.data) - new Date(c.data)) / 86400000);
    if (c.fine) c.fine = addGiorni(c.fine, delta);
    c.fermentazione = (c.fermentazione || []).map(e => (e.data ? { ...e, data: addGiorni(e.data, delta) } : e));
    c.data = daBf.data;
  }
  if (!(c.fermentazione || []).length) c.fermentazione = daBf.fermentazione || [];
  return c;
}
