// Lettura automatica delle bolle (DDT) in PDF.
// 1. estraiTesto(file): testo del PDF con le posizioni (PDF.js, caricato solo qui);
// 2. leggiDdt(pagine): numero, data, fornitore e righe articolo, cercando la riga di intestazione
//    della tabella (Articolo / Descrizione / Lotto / Scadenza / U.M. / Quantità) e le sue colonne;
// 3. proponiRighe(ddt, articoli): per ogni riga l'articolo del magazzino, la quantità nell'unità
//    giusta (8 PZ di "destrosio kg 25" = 200 kg) e se caricarla (spese, imballi, CONAI no).
// Funziona con i PDF "veri" (testo), non con le scansioni.

import { chiaveNome, trovaArticolo } from './magazzino.js';

// ---------- 1. testo dal PDF ----------
let libreria = null;
function caricaPdfJs() {
  libreria ||= new Promise((ok, ko) => {
    if (globalThis.pdfjsLib) return ok(globalThis.pdfjsLib);
    const s = document.createElement('script');
    s.src = 'js/vendor/pdf.min.js';
    s.onload = () => {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      ok(globalThis.pdfjsLib);
    };
    s.onerror = () => { libreria = null; ko(new Error('Lettore PDF non disponibile: serve internet la prima volta.')); };
    document.head.appendChild(s);
  });
  return libreria;
}

// [[{ x, y, s }]] una lista per pagina
export async function estraiTesto(file) {
  const pdfjs = await caricaPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pagine = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pagine.push(tc.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() })));
  }
  return pagine;
}

// ---------- 2. lettura del DDT ----------
const COLONNE = [
  ['codice', /^(articolo|codice|cod\.?|art\.?)$/i],
  ['descrizione', /^descrizione/i],
  ['lotto', /^lotto/i],
  ['scadenza', /scadenza|^tmc/i],
  ['um', /^(u\.?\s?m\.?|unit)/i],
  ['qta', /^(quantit|q\.?t[aà]\.?)/i],
];
const DATA = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
export const dataISO = s => {
  const m = DATA.exec(String(s || '').trim());
  if (!m) return '';
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
// "1.675,720" → 1675.72, "36,000" → 36
export const numeroIT = s => {
  const t = String(s || '').trim();
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

function righeDi(pagina) {
  const righe = [];
  for (const it of [...pagina].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const r = righe.find(x => Math.abs(x.y - it.y) <= 2);
    if (r) r.celle.push(it); else righe.push({ y: it.y, celle: [it] });
  }
  for (const r of righe) r.celle.sort((a, b) => a.x - b.x);
  return righe;
}

const FORNITORI = [
  [/mr-?\s?malt|mrmalt/i, 'Mr Malt'],
  [/weyermann/i, 'Weyermann'],
  [/castle\s*malting|chateau/i, 'Castle Malting'],
  [/fermentis/i, 'Fermentis'],
  [/lallemand/i, 'Lallemand'],
  [/birramia/i, 'Birramia'],
  [/hopsteiner/i, 'Hopsteiner'],
  [/barth\s?haas/i, 'BarthHaas'],
];

export function leggiDdt(pagine) {
  const out = { numero: '', data: '', fornitore: '', righe: [] };
  const testo = pagine.flat().map(i => i.s).join(' ');
  out.fornitore = (FORNITORI.find(([re]) => re.test(testo)) || [])[1] || '';
  for (const pagina of pagine) {
    const righe = righeDi(pagina);
    // numero e data del documento: la cella dopo l'etichetta
    for (const r of righe) {
      r.celle.forEach((c, i) => {
        const dopo = r.celle[i + 1]?.s || '';
        if (!out.numero && /^(n\.?|num\.?|numero)\s*(doc|ddt|documento)?\.?:?$/i.test(c.s) && /\d/.test(dopo)) out.numero = dopo;
        if (!out.data && /^data\s*(doc|ddt|documento)?\.?:?$/i.test(c.s) && dataISO(dopo)) out.data = dataISO(dopo);
      });
    }
    const iTesta = righe.findIndex(r => r.celle.some(c => COLONNE[1][1].test(c.s)) && r.celle.some(c => COLONNE[5][1].test(c.s)));
    if (iTesta < 0) continue;
    const col = {};
    for (const c of righe[iTesta].celle) {
      const k = COLONNE.find(([, re]) => re.test(c.s))?.[0];
      if (k && col[k] === undefined) col[k] = c.x;
    }
    const ordine = Object.entries(col).sort((a, b) => a[1] - b[1]);
    const colonnaDi = x => (ordine.filter(([, cx]) => cx <= x + 12).pop() || ordine[0])[0];
    for (const r of righe.slice(iTesta + 1)) {
      const v = {};
      for (const c of r.celle) { const k = colonnaDi(c.x); v[k] = v[k] ? `${v[k]} ${c.s}` : c.s; }
      const qta = numeroIT(v.qta);
      if (qta === null || !v.descrizione) continue; // note, testi di legge, totali
      out.righe.push({
        codice: v.codice || '', descrizione: v.descrizione, lotto: v.lotto || '',
        scadenza: dataISO(v.scadenza), um: (v.um || '').toUpperCase(), qta,
      });
    }
  }
  if (!out.numero) out.numero = (/\b(?:ddt|documento di trasporto)\D{0,15}(\d[\w/-]*)/i.exec(testo) || [])[1] || '';
  return out;
}

// ---------- 3. righe per la bolla ----------
const UNITA_PDF = { kg: 'kg', g: 'g', gr: 'g', l: 'L', lt: 'L', ml: 'ml' };
const PEZZI = /^(pz|nr|n|cf|conf|sc|sac|pc|pcs|un)\.?$/i;
// confezione nella descrizione: "20 kg", "kg 25", "g 100"
export function confezione(desc) {
  const d = String(desc || '').toLowerCase().replace(/®|™/g, ' ');
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/.exec(d) || /\b(kg|gr|g|lt|l|ml)\s*(\d+(?:[.,]\d+)?)\b/.exec(d);
  if (!m) return null;
  const [n, u] = /\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  return { qta: Number(n.replace(',', '.')), unita: UNITA_PDF[u] };
}

// nome pulito per un articolo nuovo: "Cryo Hops® pellets Simcoe® kg 5" → "Cryo Simcoe"
export function nomeDaDescrizione(desc) {
  return String(desc || '').replace(/®|™/g, ' ')
    .replace(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/gi, ' ').replace(/\b(kg|gr|g|lt|l|ml)\s*\d+(?:[.,]\d+)?\b/gi, ' ')
    .replace(/\b(luppolo|hops|pellets?|t90|t45|malto|monoidratato|in grani)\b/gi, ' ')
    .replace(/\s+\d+\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function categoriaDaDescrizione(desc) {
  const d = String(desc || '').toLowerCase();
  if (/luppol|hops?\b|pellet/.test(d)) return 'luppolo';
  if (/lievit|yeast|safale|saflager|safale|\bus-?05\b|\bw-?34|nottingham|verdant|novalager|\bwlp|wyeast/.test(d)) return 'lievito';
  if (/zucchero|destros|saccaros|maltodestr|lattosio|miele|candi/.test(d)) return 'zucchero';
  if (/malt|fiocchi|avena|frumento|wheat|oats|orzo|segale|lolla|riso|mais/.test(d)) return 'malto';
  if (/gypsum|gesso|clorur|chlorur|solfato|calcio|magnesi|bicarbonat|\bsale\b|brewmix/.test(d)) return 'sale';
  if (/acido|lactic/.test(d)) return 'aggiunta';
  if (/cannella|arancia|scorza|coriandolo|zenzero|pepe|vaniglia|spezi|cacao|caff/.test(d)) return 'spezia';
  if (/antifoam|antischiuma|zym|enzim|protafloc|polygel|spindasol|clarity|kieselsol|whirlfloc|nutrient|vit\b|silice|pvpp|gel\b/.test(d)) return 'coadiuvante';
  return null; // fusti, imballi, spese: non sono materie prime
}

const compatta = n => chiaveNome(n).split(' ').sort().join('');

export function proponiRighe(ddt, articoli) {
  return ddt.righe.map(r => {
    const conf = confezione(r.descrizione);
    const pezzi = PEZZI.test(r.um) || !r.um;
    const qta = pezzi && conf ? r.qta * conf.qta : r.qta;
    const unita = pezzi ? (conf?.unita || 'pz') : (UNITA_PDF[r.um.toLowerCase()] || 'pz');
    // articolo già noto: stessa descrizione vista in una bolla precedente, oppure nome uguale
    const art = articoli.find(a => (a.alias || []).some(x => compatta(x) === compatta(r.descrizione)))
      || trovaArticolo(articoli, nomeDaDescrizione(r.descrizione));
    const categoria = art?.categoria || categoriaDaDescrizione(r.descrizione);
    return {
      nome: art?.nome || nomeDaDescrizione(r.descrizione),
      categoria: categoria || 'aggiunta',
      qta: Math.round(qta * 1000) / 1000,
      unita,
      lotto: r.lotto,
      scadenza: r.scadenza,
      descrizione: r.descrizione,
      codice: r.codice,
      // si caricano solo le materie prime con un codice articolo: niente spese, CONAI, fusti
      includi: !!r.codice && !!(art || (categoria && (conf || r.lotto))),
    };
  });
}

