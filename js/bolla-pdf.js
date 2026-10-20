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
  ['codice', /^(articolo|codice|cod\.?|art\.?)(\s+articolo)?$/i],
  ['descrizione', /^descrizione/i],
  ['lotto', /^lotto/i],
  ['scadenza', /scadenza|^tmc/i],
  ['um', /^(u\.?\s?m\.?|unit)/i],
  ['qta', /^(quantit|q\.?t[aà]\.?)/i],
  // colonne che non servono, riconosciute solo perché i loro numeri non finiscano nella quantità
  ['prezzo', /^prezzo/i],
  ['sconti', /^scont/i],
  ['importo', /^importo/i],
  ['consegna', /^data$/i],
  ['iva', /iva$/i],
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
  [/bioenologia/i, 'Bioenologia 2.0'],
];

export function leggiDdt(pagine) {
  const out = { numero: '', data: '', fornitore: '', righe: [] };
  const testo = pagine.flat().map(i => i.s).join(' ');
  out.fornitore = (FORNITORI.find(([re]) => re.test(testo)) || [])[1] || '';
  for (const pagina of pagine) {
    const righe = righeDi(pagina);
    // numero e data del documento: la cella dopo l'etichetta, o quella sotto (intestazioni a tabella)
    const sotto = c => pagina.filter(x => x.y < c.y && c.y - x.y <= 30 && Math.abs(x.x - c.x) <= 40).sort((a, b) => b.y - a.y);
    for (const r of righe) {
      r.celle.forEach((c, i) => {
        const valori = [r.celle[i + 1]?.s || '', ...sotto(c).map(x => x.s)];
        if (!out.numero && /^(n\.?|num\.?|numero)\s*(doc|ddt|documento)?\.?:?$/i.test(c.s)) out.numero = valori.find(v => /\d/.test(v) && !dataISO(v)) || '';
        if (!out.data && /^data\s*(doc|ddt|documento)?\.?:?$/i.test(c.s)) out.data = dataISO(valori.find(v => dataISO(v)) || '');
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
      // riga sotto l'articolo con "lotto: 6126B130 data scadenza: 24/11/2026" (Bioenologia)
      const testoRiga = r.celle.map(c => c.s).join(' ');
      const ultima = out.righe[out.righe.length - 1];
      if (qta === null && ultima && /\blotto\b/i.test(testoRiga)) {
        ultima.lotto ||= (/\blotto\s*:?\s*([\w/-]+)/i.exec(testoRiga) || [])[1] || '';
        ultima.scadenza ||= dataISO((/scadenza\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(testoRiga) || [])[1]);
        continue;
      }
      if (qta === null || !v.descrizione) continue; // note, testi di legge, totali
      out.righe.push({
        codice: v.codice || '', descrizione: v.descrizione, lotto: v.lotto || '',
        scadenza: dataISO(v.scadenza), um: (v.um || '').toUpperCase(), qta,
        ...(numeroIT(v.prezzo) > 0 ? { prezzo: numeroIT(v.prezzo) } : {}),
      });
    }
  }
  if (!out.numero) out.numero = (/\b(?:ddt|documento di trasporto)\D{0,15}(\d[\w/-]*)/i.exec(testo) || [])[1] || '';
  return out;
}

// ---------- 3. righe per la bolla ----------
const UNITA_PDF = { kg: 'kg', g: 'g', gr: 'g', l: 'L', lt: 'L', ml: 'ml' };
// unità scritta in fattura o bolla: "KG", "Kg.", "KGM", "kilogrammi", "LT.", "litri"
const unitaDaUm = um => {
  const x = String(um || '').toLowerCase().replace(/[^a-z]/g, '');
  return UNITA_PDF[x] || (/^(kgm|kgs|kili|kilo|kilogramm|chilo|chilogramm)/.test(x) ? 'kg' : /^(grammi|grm)/.test(x) ? 'g' : /^(litr|ltr|ltn)/.test(x) ? 'L' : null);
};
const PEZZI = /^(pz|nr|n|cf|conf|sc|sac|pc|pcs|un)\.?$/i;
// confezione nella descrizione: "20 kg", "kg 25", "g 100"
export function confezione(desc) {
  const d = String(desc || '').toLowerCase().replace(/®|™/g, ' ');
  const m = /(?<![a-z0-9])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/.exec(d) || /\b(kg|gr|g|lt|l|ml)\s*(\d+(?:[.,]\d+)?)\b/.exec(d);
  if (!m) return null;
  const [n, u] = /\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  return { qta: Number(n.replace(',', '.')), unita: UNITA_PDF[u] };
}

// nome pulito per un articolo nuovo: "Cryo Hops® pellets Simcoe® kg 5" → "Cryo Simcoe"
export function nomeDaDescrizione(desc) {
  return String(desc || '').replace(/®|™/g, ' ')
    .replace(/\s+(rif\.?|riferimento|contratto|ordine|vs\.?\s*ord)\b.*$/i, ' ') // "Dingemans Pilsner Rif. contratto n. 39/M26…"
    .replace(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/gi, ' ').replace(/\b(kg|gr|g|lt|l|ml)\s*\d+(?:[.,]\d+)?\b/gi, ' ')
    .replace(/\bconf(ezione)?\.?(\s+da)?\b/gi, ' ')
    .replace(/\b(luppolo|hops|pellets?|t90|t45|malto|monoidratato|in grani)\b/gi, ' ')
    .replace(/\s+[1-9]\d*\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function categoriaDaDescrizione(desc) {
  const d = String(desc || '').toLowerCase();
  if (/luppol|hops?\b|pellet/.test(d)) return 'luppolo';
  if (/lievit|yeast|atecrem|fermoale|fermolager|safale|saflager|safale|\bus-?05\b|\bw-?34|nottingham|verdant|novalager|\bwlp|wyeast/.test(d)) return 'lievito';
  if (/zucchero|destros|saccaros|maltodestr|lattosio|miele|candi/.test(d)) return 'zucchero';
  if (/malt|fiocchi|avena|frumento|wheat|oats|orzo|segale|lolla|riso|mais/.test(d)) return 'malto';
  if (/gypsum|gesso|clorur|chlorur|solfato|calcio|magnesi|bicarbonat|\bsale\b|brewmix/.test(d)) return 'sale';
  if (/acido|lactic/.test(d)) return 'aggiunta';
  if (/cannella|arancia|scorza|coriandolo|zenzero|pepe|vaniglia|spezi|cacao|caff/.test(d)) return 'spezia';
  if (/antifoam|antischiuma|zym|enzim|protafloc|polygel|spindasol|clarity|kieselsol|whirlfloc|nutrient|vit\b|silice|pvpp|gel\b|antiox|metabisolfit|tannin|ascorbic/.test(d)) return 'coadiuvante';
  return null; // fusti, imballi, spese: non sono materie prime
}

const compatta = n => chiaveNome(n).split(' ').sort().join('');
// prime due parole uguali a quelle di un solo articolo: "Dingemans Pilsner …" = "Dingemans Pilsner" (Romain 2026-10-20)
const primeDue = n => { const w = chiaveNome(n).split(' ').filter(Boolean); return w.length >= 2 ? `${w[0]} ${w[1]}` : ''; };
function perPrimeDue(articoli, nome) {
  const k = primeDue(nome);
  if (!k) return null;
  const trovati = articoli.filter(a => [a.nome, ...(a.alias || [])].some(x => primeDue(x) === k));
  return trovati.length === 1 ? trovati[0] : null;
}

export function proponiRighe(ddt, articoli) {
  return ddt.righe.map(r => {
    const conf = confezione(r.descrizione);
    const pezzi = PEZZI.test(r.um) || !r.um;
    let qta = pezzi && conf ? r.qta * conf.qta : r.qta;
    let unita = pezzi ? (conf?.unita || 'pz') : (unitaDaUm(r.um) || 'pz');
    // articolo già noto: stessa descrizione vista in una bolla precedente, oppure nome uguale
    const parole = new Set(chiaveNome(r.descrizione).split(' '));
    const art = articoli.find(a => (a.alias || []).some(x => compatta(x) === compatta(r.descrizione)))
      || trovaArticolo(articoli, nomeDaDescrizione(r.descrizione))
      // nome corto dentro la descrizione: articolo "LN3" per "ATECREM ALE LN3 Conf. da Kg 1"
      || articoli.find(a => { const p = chiaveNome(a.nome).split(' ').filter(Boolean); return p.join('').length >= 3 && p.every(x => parole.has(x)) && /\d/.test(a.nome); })
      || perPrimeDue(articoli, nomeDaDescrizione(r.descrizione));
    // senza peso nella descrizione: il peso per pezzo dell'articolo (lolla di riso: 1 sacco = 20 kg)
    if (pezzi && !conf && art?.pesoPezzo > 0) { qta = r.qta * art.pesoPezzo; unita = art.unita; }
    // fattura senza unità di misura (1175 per il Pilsner sfuso): vale l'unità dell'articolo, non "pz"
    else if (!r.um && !conf && art?.unita && art.unita !== 'pz') unita = art.unita;
    const categoria = art?.categoria || categoriaDaDescrizione(r.descrizione);
    return {
      nome: art?.nome || nomeDaDescrizione(r.descrizione),
      categoria: categoria || 'aggiunta',
      qta: Math.round(qta * 1000) / 1000,
      unita,
      lotto: r.lotto,
      scadenza: r.scadenza,
      // prezzo per unità del magazzino (se la riga è a pezzi convertiti in kg, diviso per la confezione)
      ...(r.prezzo > 0 ? { prezzo: Math.round((qta && r.qta ? r.prezzo * r.qta / qta : r.prezzo) * 10000) / 10000 } : {}),
      descrizione: r.descrizione,
      codice: r.codice,
      // si caricano solo le materie prime con un codice articolo: niente spese, CONAI, fusti
      includi: !!r.codice && !!(art || (categoria && (conf || r.lotto))),
    };
  });
}


// Fattura d'acquisto + bolla (DDT) dello stesso arrivo: dalla bolla si prendono lotti e scadenze
// (la fattura non li ha) e si segnalano le differenze di quantità. Entrambe già passate da proponiRighe.
// Due righe di bolla per la stessa riga di fattura (due lotti): la riga si divide.
// tieni(riga): le righe della bolla senza corrispondenza si aggiungono solo se sono materie prime.
const GENERICHE = new Set(['confezione', 'sacco', 'sacchi', 'flacone', 'tanica', 'busta', 'barattolo', 'pellet', 'pellets', 'luppolo', 'malto', 'lievito', 'birra', 'liquido', 'polvere']);
const paroleForti = s => chiaveNome(s).split(' ').filter(w => w.length >= 5 && !/\d/.test(w) && !GENERICHE.has(w));
export function incrociaBolla(fattura, bolla, tieni = () => true) {
  const norm = s => String(s || '').replace(/\s+/g, '').toUpperCase();
  const uguali = (f, d) => (f.codice && d.codice && norm(f.codice) === norm(d.codice))
    || (f.nome && d.nome && chiaveNome(f.nome) === chiaveNome(d.nome))
    || (f.descrizione && d.descrizione && compatta(f.descrizione) === compatta(d.descrizione));
  // ultima prova: fattura e bolla scrivono la descrizione in modo diverso ma con lo stesso nome proprio ("ANTIOXIN SBT")
  const simili = (f, d) => { const p = new Set(paroleForti(d.descrizione || d.nome)); return paroleForti(f.descrizione || f.nome).some(w => p.has(w)); };
  const gruppi = fattura.map(() => []);
  const sole = [];
  for (const d of bolla) {
    // prima per codice, poi per nome o descrizione
    const i = fattura.findIndex(f => f.codice && d.codice && norm(f.codice) === norm(d.codice));
    let j = i >= 0 ? i : fattura.findIndex(f => uguali(f, d));
    if (j < 0) j = fattura.findIndex((f, k) => f.includi !== false && !gruppi[k].length && simili(f, d));
    if (j >= 0) gruppi[j].push(d); else if (tieni(d)) sole.push(d);
  }
  const fmt = n => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const righe = fattura.flatMap((f, i) => {
    const g = gruppi[i];
    if (!g.length) return [{ ...f, nota: f.includi === false ? f.nota || '' : 'non è nella bolla' }];
    const tot = g.reduce((t, d) => t + (Number(d.qta) || 0), 0);
    const diversa = g.every(d => d.unita === f.unita) && Math.abs(tot - Number(f.qta)) > 1e-6;
    const nota = diversa ? `in bolla ${fmt(tot)} ${f.unita}, in fattura ${fmt(Number(f.qta))}` : '';
    if (g.length === 1) return [{ ...f, lotto: g[0].lotto || f.lotto || '', scadenza: g[0].scadenza || f.scadenza || '', nota }];
    return g.map((d, k) => ({ ...f, qta: d.qta, unita: d.unita, lotto: d.lotto || '', scadenza: d.scadenza || '', nota: k ? '' : nota }));
  });
  for (const d of sole) righe.push({ ...d, nota: 'solo nella bolla, non in fattura' });
  // la nota delle righe escluse (es. vuoti per Contenitori) non è una differenza tra fattura e bolla
  return { righe, avvisi: righe.filter(r => r.nota && (r.includi !== false || r.nota.startsWith('solo nella bolla'))).length };
}
