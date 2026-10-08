// Logica di produzione: date, stati delle cotte, durate tipiche, conflitti sui fermentatori.

export const DURATA_DEFAULT = 21; // giorni in FV se non c'è storico per la birra

export const oggiISO = () => toISO(new Date());
export function toISO(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function daISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addGiorni(iso, n) {
  const d = daISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function diffGiorni(a, b) {
  return Math.round((daISO(b) - daISO(a)) / 86400000);
}
export function dataIT(iso, opz = { day: '2-digit', month: '2-digit', year: '2-digit' }) {
  return iso ? daISO(iso).toLocaleDateString('it-IT', opz) : '—';
}
export function numIT(n, dec = 1) {
  if (n === null || n === undefined || n === '' || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('it-IT', { maximumFractionDigits: dec });
}

// °Plato -> peso specifico, e gradi alcolici stimati
export const platoASG = p => 1 + p / (258.6 - (p / 258.2) * 227.1);
export function abv(og, fg) {
  if (!og || fg === null || fg === undefined || fg === '') return null;
  return (platoASG(og) - platoASG(fg)) * 131.25;
}

export const nomeBirra = s => (s || '').trim().toUpperCase().replace(/\s+/g, ' ');

// Ultimo giorno in cui la cotta occupa il fermentatore
export function fineCotta(c, durate) {
  if (c.fine) return c.fine;
  const log = c.fermentazione || [];
  if (log.length) return log[log.length - 1].data;
  const d = (durate && durate.get(nomeBirra(c.birra))) || DURATA_DEFAULT;
  return addGiorni(c.data, d - 1);
}

// Durata tipica (mediana) in FV per birra, dallo storico
export function durateTipiche(cotte) {
  const per = new Map();
  for (const c of cotte) {
    const log = c.fermentazione || [];
    if (!c.data || (!c.fine && log.length < 5)) continue;
    const g = diffGiorni(c.data, c.fine || log[log.length - 1].data) + 1;
    if (g < 3 || g > 120) continue;
    const k = nomeBirra(c.birra);
    if (!per.has(k)) per.set(k, []);
    per.get(k).push(g);
  }
  const out = new Map();
  for (const [k, v] of per) {
    v.sort((a, b) => a - b);
    out.set(k, v[Math.floor(v.length / 2)]);
  }
  return out;
}

export const STATI = {
  pianificata: 'Pianificata',
  tank: 'In fermentatore',
  confezionata: 'Confezionata',
  chiusa: 'Chiusa',
};

export function statoCotta(c, durate, oggi = oggiISO()) {
  if (!c.data || c.data > oggi) return 'pianificata';
  if ((c.confezionato || []).length) return 'confezionata';
  if (fineCotta(c, durate) >= oggi) return 'tank';
  return 'chiusa';
}

export function prossimoNumero(cotte, anno) {
  const nums = cotte.filter(c => c.anno === anno).map(c => c.numero || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
export const lottoDi = (numero, anno) => `${numero}/${String(anno).slice(2)}`;

export function litriConfezionati(c) {
  return (c.confezionato || []).reduce((t, x) => t + (Number(x.pezzi) || 0) * (Number(x.litri) || 0), 0);
}

// Cotte che occupano gli stessi FV negli stessi giorni.
// Due cotte della stessa birra a <=2 giorni di distanza nello stesso FV sono una cotta doppia, non un conflitto.
export function conflitti(cotte, durate) {
  const perFv = new Map();
  for (const c of cotte) {
    if (!c.fv || !c.data) continue;
    if (!perFv.has(c.fv)) perFv.set(c.fv, []);
    perFv.get(c.fv).push(c);
  }
  const out = [];
  for (const [fv, lista] of perFv) {
    lista.sort((a, b) => a.data.localeCompare(b.data));
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        if (b.data > fineCotta(a, durate)) break;
        const doppia = nomeBirra(a.birra) === nomeBirra(b.birra) && Math.abs(diffGiorni(a.data, b.data)) <= 2;
        if (!doppia) out.push({ fv, a, b });
      }
    }
  }
  return out;
}

// FV liberi per l'intervallo [da, a]
export function fvLiberi(fvs, cotte, da, a, durate, escludiId) {
  return fvs.map(f => {
    const occ = cotte.filter(c => c.id !== escludiId && c.fv === f.nome && c.data && c.data <= a && fineCotta(c, durate) >= da);
    return { fv: f, occupatoDa: occ };
  });
}

// Copia ricetta e profilo di temperatura da una cotta precedente
export function copiaDa(src, { data, numero, anno, fv }) {
  const clone = JSON.parse(JSON.stringify(src));
  const profilo = (src.fermentazione || [])
    .filter(e => e.giorno || e.data)
    .map((e, i) => {
      const giorno = e.giorno || i + 1;
      return { data: addGiorni(data, giorno - 1), giorno, temp: e.temp ?? null };
    });
  return {
    tipo: 'cotta',
    birra: src.birra,
    numero, anno, lotto: lottoDi(numero, anno), data, fv: fv || src.fv,
    og: src.og ?? null, fg: null, phMash: null, litri: src.litri ?? null,
    sali: clone.sali || [], malti: clone.malti || [], luppoli: clone.luppoli || [], lievito: clone.lievito || [],
    acquaMash: { tempMash: src.acquaMash?.tempMash ?? null, litri: src.acquaMash?.litri ?? null, tempAcqua: src.acquaMash?.tempAcqua ?? null },
    acquaSparge: { temp: src.acquaSparge?.temp ?? null, litri: src.acquaSparge?.litri ?? null },
    fermentazione: profilo,
    confezionato: [],
    note: src.note || '',
    origine: src.lotto,
  };
}
