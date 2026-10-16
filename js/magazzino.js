// Magazzino materie prime: giacenze calcolate, mai scritte a mano.
// giacenza = ultimo inventario dell'articolo + carichi (bolle) dopo quella data
//            − scarichi delle cotte (ingredienti) e dei DH dopo quella data.
// Le cotte non ancora fatte (e i DH futuri) sono "impegnato": non tolgono dalla giacenza
// di oggi ma dal disponibile.
//
// Record nell'archivio:
//   articolo   { nome, categoria, unita, scortaMin, pesoPezzo, densita, alias: [], creato }  (creato: senza inventario, gli scarichi contano da quel giorno; pesoPezzo: peso di un sacco/pezzo nell'unità dell'articolo; densita: kg/L per passare da ml a kg)
//   bolla      { data, fornitore, numero, righe: [{ articoloId, qta, unita, lotto, scadenza }] }
//   inventario { data, righe: [{ articoloId, qta, lotto, scadenza }] }
// Lotto e scadenza sono facoltativi. Le cotte non dicono quale lotto usano: si assume che
// esca prima la merce più vecchia, quindi la giacenza è fatta dai carichi più recenti.

import { addGiorni, oggiISO } from './dominio.js';

export const CATEGORIE = {
  malto: 'Malti', zucchero: 'Zuccheri', luppolo: 'Luppoli', lievito: 'Lieviti', spezia: 'Spezie',
  sale: 'Sali', aggiunta: 'Aggiunte', coadiuvante: 'Coadiuvanti',
};
export const GIORNI_IN_SCADENZA = 30;
export const UNITA = ['kg', 'g', 'L', 'ml', 'pz'];
const FATTORE = { kg: 1000, g: 1, L: 1000, ml: 1, pz: 1 };
const FAMIGLIA = { kg: 'peso', g: 'peso', L: 'volume', ml: 'volume', pz: 'pezzi' };

// Converte qta da un'unità all'altra; null se non confrontabili (es. kg → pz)
export function converti(qta, da, a) {
  const q = Number(qta);
  if (!Number.isFinite(q)) return null;
  if (!da || da === a) return q;
  if (!FAMIGLIA[da] || FAMIGLIA[da] !== FAMIGLIA[a]) return null;
  return (q * FATTORE[da]) / FATTORE[a];
}

// Come converti, ma i pezzi (sacchi, confezioni) valgono il peso per pezzo dell'articolo, se c'è:
// lolla di riso 3 pz con pesoPezzo 20 (kg) = 60 kg
// e i liquidi passano da volume a peso con la densità (acido lattico 5 ml con articolo in kg = 0,006 kg)
export function convertiPer(art, qta, da) {
  const q = converti(qta, da, art.unita);
  if (q !== null) return q;
  const n = Number(qta);
  if (!Number.isFinite(n)) return null;
  if (da === 'pz') return art.pesoPezzo > 0 ? n * art.pesoPezzo : null;
  const d = densitaArticolo(art);
  if (!d) return null;
  if (FAMIGLIA[da] === 'volume' && FAMIGLIA[art.unita] === 'peso') return converti(converti(n, da, 'L') * d, 'kg', art.unita);
  if (FAMIGLIA[da] === 'peso' && FAMIGLIA[art.unita] === 'volume') return converti(converti(n, da, 'kg') / d, 'L', art.unita);
  return null;
}
// densità in kg/L: quella dell'articolo, altrimenti 1,2 per l'acido lattico (all'80%)
export const DENSITA_ACIDO = 1.2;
export function densitaArticolo(art) {
  if (Number(art?.densita) > 0) return Number(art.densita);
  return /acido\s+lattico/i.test(art?.nome || '') ? DENSITA_ACIDO : null;
}

// Nome "pulito" di un ingrediente delle schede: toglie tempi, giorni di DH, usi.
// "Mosaic DH giorno 13" → "mosaic", "Herkules 60mn" → "herkules", "Citra CRYO 0mn" → "citra cryo"
export function chiaveNome(nome) {
  return String(nome || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(dh|dry ?hop|whirlpool|wp|dip|mash ?hop|first ?wort|bollitura|recuperat[oa]|recupero|secco)\b/g, ' ')
    .replace(/\b(giorno|gg|g)\s*\d+\b/g, ' ')
    .replace(/\b\d+\s*(mn|min|')\b/g, ' ').replace(/\bomn\b/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(gr|g|kg|l|ml|%)(\/hl)?\b/g, ' ')
    .replace(/[^a-z0-9à-ù]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function categoriaDa(sezione, nome) {
  const n = String(nome || '').toLowerCase();
  if (sezione === 'luppoli') return 'luppolo';
  if (sezione === 'lievito') return 'lievito';
  if (sezione === 'malti') return /destros|zucchero|saccaros|maltodestr|miele|lattosio|candi/.test(n) ? 'zucchero' : 'malto';
  if (sezione === 'acido') return 'aggiunta';
  if (/cannella|arancia|scorza|coriandolo|zenzero|pepe|vaniglia|spezi|cacao|caff/.test(n)) return 'spezia';
  if (/gypsum|gesso|clorur|chlorur|magnesi|\bsale\b|brewmix|bicarbonat|baking|soda|solfato|calcio/.test(n)) return 'sale';
  if (/protafloc|polygel|spindasol|antifoam|antischiuma|\bgel\b|vit|antioxin|\bams\b|enzim|enzym|endozym|aeb|nutrient|clarity|kieselsol|colla|whirlfloc/.test(n)) return 'coadiuvante';
  return 'aggiunta';
}

// articolo che corrisponde a un nome di ingrediente (nome o alias, confrontati "puliti")
// parole in ordine alfabetico: "Cryo Citra" e "Citra Cryo" sono lo stesso articolo
const compatta = n => chiaveNome(n).split(' ').sort().join('');

// Sali, acidi e additivi: nomi inglesi di Brewfather e sinonimi italiani dello stesso prodotto.
// Il primo nome è quello italiano usato quando in magazzino non c'è ancora l'articolo.
// Le parole generiche (cloruro, magnesio, sale…) valgono solo come nome intero, non dentro un nome più lungo.
export const SINONIMI = [
  ['Gesso (solfato di calcio)', ['gypsum', 'gesso', 'calcium sulfate', 'calcium sulphate', 'solfato di calcio', 'caso4']],
  ['Cloruro di calcio', ['calcium chloride', 'cloruro di calcio', 'cacl2', 'cloruro', 'chlorure', 'clorure']],
  ['Solfato di magnesio (sale inglese)', ['epsom salt', 'epsom', 'magnesium sulfate', 'magnesium sulphate', 'solfato di magnesio', 'sale inglese', 'mgso4', 'magnesio']],
  ['Cloruro di magnesio', ['magnesium chloride', 'cloruro di magnesio', 'mgcl2']],
  ['Bicarbonato di sodio', ['baking soda', 'sodium bicarbonate', 'bicarbonato di sodio', 'bicarbonato', 'nahco3']],
  ['Cloruro di sodio (sale)', ['table salt', 'sodium chloride', 'non iodized salt', 'canning salt', 'cloruro di sodio', 'salt', 'sale', 'nacl']],
  ['Carbonato di calcio', ['chalk', 'calcium carbonate', 'carbonato di calcio', 'caco3']],
  ['Idrossido di calcio', ['slaked lime', 'pickling lime', 'calcium hydroxide', 'idrossido di calcio', 'calce']],
  ['Acido lattico', ['lactic acid', 'acido lattico']],
  ['Acido fosforico', ['phosphoric acid', 'acido fosforico']],
  ['Acido citrico', ['citric acid', 'acido citrico']],
  ['Metabisolfito', ['campden tablet', 'campden', 'potassium metabisulfite', 'sodium metabisulfite', 'metabisolfito']],
  ['Protafloc', ['protafloc', 'whirlfloc', 'irish moss', 'muschio irlandese']],
  ['Nutriente lievito', ['yeast nutrient', 'nutriente lievito', 'nutrienti lievito', 'yeastvit', 'yeast vit', 'vit yeast', 'servomyces', 'fermaid']],
  ['Antifoam', ['antifoam', 'anti foam', 'antischiuma', 'fermcap']],
];
const GENERICI = new Set(['cloruro', 'chlorure', 'clorure', 'magnesio', 'bicarbonato', 'sale', 'salt', 'chalk', 'calce', 'epsom', 'campden']);
const GRUPPI = SINONIMI.map(([nome, sin]) => ({ nome, esatti: new Set([nome, ...sin].map(compatta)), dentro: sin.filter(x => !GENERICI.has(x)).map(chiaveNome) }));
const gruppoDi = nome => {
  const k = compatta(nome);
  if (!k) return null;
  const c = ` ${chiaveNome(nome)} `;
  return GRUPPI.find(g => g.esatti.has(k)) || GRUPPI.find(g => g.dentro.some(x => c.includes(` ${x} `))) || null;
};
// Nome italiano per un ingrediente di Brewfather (se è un sale/additivo conosciuto), altrimenti il nome com'è
export const nomeItaliano = nome => gruppoDi(nome)?.nome || nome;

export function trovaArticolo(articoli, nome) {
  const k = compatta(nome);
  if (!k) return null;
  const diretto = articoli.find(a => compatta(a.nome) === k || (a.alias || []).some(x => compatta(x) === k));
  if (diretto) return diretto;
  // stesso prodotto con un altro nome (Gypsum = Gesso, Epsom = Solfato di magnesio…)
  const g = gruppoDi(nome);
  const nomi = a => [a.nome, ...(a.alias || [])];
  if (!g) return null;
  return articoli.find(a => nomi(a).some(n => gruppoDi(n) === g)) || null;
}

// Parole equivalenti nei nomi di malti e luppoli (Brewfather in inglese, magazzino in italiano o abbreviato)
const PAROLE_UGUALI = [['pilsner', 'pils', 'pilsen'], ['munich', 'monaco', 'munchen'], ['wheat', 'frumento', 'weizen'], ['oat', 'oats', 'avena'],
  ['rye', 'segale'], ['maris', 'marris'], ['chit', 'chito'], ['caramel', 'cara'], ['torrified', 'torrefatto'], ['cryo', 'lupulin', 'lupomax']];
const PAROLE_VUOTE = new Set(['malt', 'malto', 'malti', 'di', 'd', 'del', 'hop', 'hops', 'luppolo', 'pellet', 'pellets', 'malz', 'mälz', 'maltings', 'malting', 'malterie', 'malteries', 't90', 't 90', 'type', 'r', 'tm', 'ebc', 'l']);
const formaParola = w => (PAROLE_UGUALI.find(x => x.includes(w)) || [w])[0];
const paroleDi = n => chiaveNome(n).split(' ').filter(w => w && !PAROLE_VUOTE.has(w)).map(formaParola);
const stessaParola = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

// Solo per l'import da Brewfather (l'articolo trovato dà il nome alla riga, poi l'abbinamento è esatto).
// Prova anche nomi scritti in modo diverso: "Pilsner Dingemans" → "PILS dingemans", "Mosaic Cryo" → "Cryo Mosaic".
// Tutte le parole cercate devono esserci nell'articolo; cryo/non cryo deve coincidere.
// Vince l'articolo con meno parole in più; se sono pari non sceglie (meglio nessuno che quello sbagliato).
export function articoloSimile(articoli, nome) {
  const cerca = paroleDi(nome);
  if (!cerca.length) return null;
  const cryo = cerca.includes('cryo');
  let migliore = null, extraMin = Infinity, pari = false;
  for (const a of articoli) {
    for (const n of [a.nome, ...(a.alias || [])]) {
      const parole = paroleDi(n);
      if (parole.includes('cryo') !== cryo || !cerca.every(w => parole.some(p => stessaParola(w, p)))) continue;
      const extra = parole.filter(p => !cerca.some(w => stessaParola(w, p))).length;
      if (extra < extraMin) { migliore = a; extraMin = extra; pari = false; } else if (extra === extraMin && a !== migliore) pari = true;
    }
  }
  return pari ? null : migliore;
}

// Ingredienti importati da Brewfather: nome dell'articolo di magazzino se c'è, altrimenti il nome italiano
export function nomiDaMagazzino(c, articoli) {
  for (const sez of ['malti', 'luppoli', 'lievito', 'sali']) {
    c[sez] = (c[sez] || []).map(r => {
      const art = trovaArticolo(articoli, r.nome) || (sez === 'malti' || sez === 'luppoli' ? articoloSimile(articoli, r.nome) : null);
      return { ...r, nome: art ? art.nome : sez === 'sali' ? nomeItaliano(r.nome) : r.nome };
    });
  }
  return c;
}

const SEZIONI = ['malti', 'luppoli', 'lievito', 'sali'];
export const NOME_ACIDO = 'Acido lattico';

// Giorno in cui un ingrediente esce dal magazzino: DH al suo giorno, il resto il giorno di cotta
export function dataUscita(c, sezione, r) {
  if (sezione === 'luppoli') {
    const dh = r.uso === 'dry hop' || /\b(dh|dry ?hop)\b/i.test(r.nome || '');
    const g = r.giorno ?? Number((/\b(?:giorno|g)\s*(\d+)\b/i.exec(r.nome || '') || [])[1]);
    if (dh && g > 0) return addGiorni(c.data, g - 1);
  }
  return c.data;
}

// Lievito recuperato da un'altra cotta: spunta nella scheda (o "recuperato" nel nome, schede vecchie).
// Non esce dal magazzino.
export const lievitoRecuperato = (sezione, r) => sezione === 'lievito' && (!!r.recuperato || /recuperat|recupero/i.test(r.nome || ''));

// Tutti gli scarichi delle cotte: [{ articolo|null, nome, sezione, qta, unita, data, cotta }]
export function scarichiCotte(cotte, articoli) {
  const out = [];
  for (const c of cotte) {
    if (!c.data || c.eliminato) continue;
    for (const sez of SEZIONI) {
      for (const [i, r] of (c[sez] || []).entries()) {
        if (!r.nome || !(Number(r.qta) > 0) || lievitoRecuperato(sez, r)) continue;
        // nelle schede l'acido lattico è scritto in "g" ma sono ml
        const unita = /acido/i.test(r.nome) && r.unita === 'g' ? 'ml' : r.unita || '';
        out.push({ articolo: trovaArticolo(articoli, r.nome), nome: r.nome, sezione: /acido/i.test(r.nome) ? 'acido' : sez, qta: Number(r.qta), unita, data: dataUscita(c, sez, r), cotta: c, lotto: r.lotto || '', dove: { tipo: 'cotta', id: c.id, path: `${sez}.${i}` } });
      }
    }
    // correzioni pH con acido lattico (ml), ognuna alla sua data
    for (const [i, r] of (c.acido || []).entries()) {
      if (!(Number(r.ml) > 0)) continue;
      out.push({ articolo: trovaArticolo(articoli, NOME_ACIDO), nome: NOME_ACIDO, sezione: 'acido', qta: Number(r.ml), unita: 'ml', data: r.data || c.data, cotta: c, lotto: r.lotto || '', dove: { tipo: 'cotta', id: c.id, path: `acido.${i}` } });
    }
  }
  return out;
}

// Giacenze di tutti gli articoli a una data. Ritorna Map id → riepilogo con i movimenti.
export function giacenze({ articoli, bolle, inventari, cotte, scarichi = [] }, oggi = oggiISO()) {
  const res = new Map(articoli.map(a => [a.id, {
    articolo: a, inventario: null, giacenza: 0, impegnato: 0, movimenti: [], nonConvertibili: 0,
  }]));
  // ultimo inventario (fino a oggi) per articolo; due inventari nello stesso giorno: vale l'ultimo salvato
  for (const inv of [...inventari].filter(i => i.data && i.data <= oggi).sort((x, y) => x.data.localeCompare(y.data) || String(x.aggiornato || '').localeCompare(String(y.aggiornato || '')))) {
    for (const [i, r] of (inv.righe || []).entries()) {
      const g = res.get(r.articoloId);
      if (g && r.qta !== null && r.qta !== '' && r.qta !== undefined) g.inventario = { data: inv.data, qta: Number(r.qta), id: inv.id, lotto: r.lotto || '', scadenza: r.scadenza || '', dove: { tipo: 'inventario', id: inv.id, path: `righe.${i}` } };
    }
  }
  for (const g of res.values()) {
    if (g.inventario) {
      g.giacenza = g.inventario.qta;
      g.movimenti.push({ data: g.inventario.data, tipo: 'inventario', qta: g.inventario.qta, rif: 'Inventario', id: g.inventario.id, lotto: g.inventario.lotto, scadenza: g.inventario.scadenza, dove: g.inventario.dove });
    }
  }
  // senza inventario: tutte le bolle, ma solo gli scarichi da quando l'articolo esiste
  const dopoInventario = (g, data, tipo) => (g.inventario ? data > g.inventario.data : tipo === 'carico' || !g.articolo.creato || data >= g.articolo.creato);
  const muovi = (g, data, qta, unita, mov) => {
    const q = convertiPer(g.articolo, qta, unita);
    if (q === null) { g.nonConvertibili++; return; }
    if (data > oggi) { if (mov.tipo === 'scarico') g.impegnato += q; g.movimenti.push({ ...mov, data, qta: mov.tipo === 'scarico' ? -q : q, futuro: true }); return; }
    if (!dopoInventario(g, data, mov.tipo)) return;
    g.giacenza += mov.tipo === 'scarico' ? -q : q;
    g.movimenti.push({ ...mov, data, qta: mov.tipo === 'scarico' ? -q : q });
  };
  for (const b of bolle) {
    for (const [i, r] of (b.righe || []).entries()) {
      const g = res.get(r.articoloId);
      if (g && b.data) muovi(g, b.data, r.qta, r.unita || g.articolo.unita, { tipo: 'carico', rif: `Bolla ${b.numero || ''} ${b.fornitore || ''}`.trim(), id: b.id, dove: { tipo: 'bolla', id: b.id, path: `righe.${i}` }, lotto: r.lotto || '', scadenza: r.scadenza || '', chi: [b.fornitore, b.numero && `DDT ${b.numero}`].filter(Boolean).join(' · ') });
    }
  }
  for (const s of scarichiCotte(cotte, articoli)) {
    const g = s.articolo && res.get(s.articolo.id);
    if (g) muovi(g, s.data, s.qta, s.unita || g.articolo.unita, { tipo: 'scarico', rif: `${s.cotta.birra || ''} ${s.cotta.lotto || ''}`.trim(), id: s.cotta.id, nome: s.nome, chi: destinoCotta(s), lottoScelto: s.lotto, dove: s.dove });
  }
  // movimenti manuali. Scarichi (vendita, reso, scarto): se è indicato il lotto esce da quello.
  // Carichi (reso da cliente, prestito, rettifica…): entrano con il loro lotto e scadenza, come una bolla.
  for (const sc of scarichi) {
    const carico = sc.verso === 'carico';
    const chi = [[(carico ? MOTIVI_CARICO : MOTIVI_SCARICO)[sc.motivo] || (carico ? 'Carico' : 'Scarico'), sc.documento].filter(Boolean).join(' '), sc.destinatario].filter(Boolean).join(' · ');
    for (const [i, r] of (sc.righe || []).entries()) {
      const g = res.get(r.articoloId);
      if (!g || !sc.data) continue;
      const dove = { tipo: 'scarico', id: sc.id, path: `righe.${i}` };
      if (carico) muovi(g, sc.data, r.qta, r.unita || g.articolo.unita, { tipo: 'carico', manuale: true, rif: chi, id: sc.id, dove, lotto: r.lotto || '', scadenza: r.scadenza || '', chi });
      else muovi(g, sc.data, r.qta, r.unita || g.articolo.unita, { tipo: 'scarico', manuale: true, rif: chi, id: sc.id, dove, lottoScelto: r.lotto || '', chi });
    }
  }
  for (const g of res.values()) {
    g.movimenti.sort((x, y) => y.data.localeCompare(x.data));
    g.disponibile = g.giacenza - g.impegnato;
    g.sottoScorta = g.articolo.scortaMin > 0 && g.disponibile < g.articolo.scortaMin;
    g.lotti = simulaLotti(g);
    const scad = g.lotti.map(l => l.scadenza).filter(Boolean).sort();
    g.scadenza = scad[0] || null;
    g.statoScadenza = statoScadenza(g.scadenza, oggi);
  }
  return res;
}

export function statoScadenza(scadenza, oggi = oggiISO()) {
  if (!scadenza) return null;
  if (scadenza < oggi) return 'scaduto';
  return scadenza <= addGiorni(oggi, GIORNI_IN_SCADENZA) ? 'vicino' : null;
}

// Lotti: si scorrono i movimenti in ordine di data; ogni scarico prende dal lotto entrato
// da più tempo (o da quello indicato nello scarico manuale) e passa al successivo se finisce.
// Ogni scarico riceve m.lotti = [{ lotto, scadenza, qta }]; ritorna i lotti rimasti.
function simulaLotti(g) {
  const coda = [];
  let debito = 0; // scaricato più di quanto c'era: lo copre il carico successivo
  const mov = g.movimenti.filter(m => !m.futuro)
    .sort((x, y) => x.data.localeCompare(y.data) || ORDINE_MOV[x.tipo] - ORDINE_MOV[y.tipo]);
  for (const m of mov) {
    if (m.tipo !== 'scarico') {
      if (m.tipo === 'inventario') { coda.length = 0; debito = 0; }
      const copre = Math.min(debito, m.qta);
      debito -= copre;
      coda.push({ lotto: m.lotto || '', scadenza: m.scadenza || '', data: m.data, qta: m.qta - copre, rif: m.rif, id: m.id, tipo: m.tipo, dove: m.dove });
      continue;
    }
    m.lotti = [];
    let resto = -m.qta;
    const preso = l => { const q = Math.min(resto, l.qta); l.qta -= q; resto -= q; m.lotti.push({ lotto: l.lotto, scadenza: l.scadenza, qta: q }); };
    const scelto = m.lottoScelto && coda.find(l => l.qta > 1e-9 && l.lotto.toLowerCase() === m.lottoScelto.toLowerCase());
    if (scelto) preso(scelto);
    for (const l of coda) { if (resto <= 1e-9) break; if (l.qta > 1e-9) preso(l); }
    if (resto > 1e-9) { m.lotti.push({ lotto: m.lottoScelto || '', scadenza: '', qta: resto }); debito += resto; } // più di quanto risulta in magazzino
  }
  return coda.filter(l => l.qta > 1e-9).reverse(); // i più recenti per primi
}
const ORDINE_MOV = { inventario: 0, carico: 1, scarico: 2 };

export const MOTIVI_SCARICO = { vendita: 'Vendita', reso: 'Reso al fornitore', scarto: 'Scarto / rottura', altro: 'Altro' };
export const MOTIVI_CARICO = { ddt: 'DDT', fattura: 'Fattura', acquisto: 'Acquisto senza documento', reso_cliente: 'Reso da cliente', prestito: 'Prestito / scambio', omaggio: 'Campione / omaggio', rettifica: 'Rettifica', altro: 'Altro' };
const destinoCotta = s => `${s.sezione === 'acido' ? 'Correzione pH' : s.data !== s.cotta.data || /\b(dh|dry ?hop)\b/i.test(s.nome) ? 'Dry hop' : 'Cotta'} ${s.cotta.lotto || ''} ${s.cotta.birra || ''}`.replace(/\s+/g, ' ').trim();

// Ingredienti delle cotte (da una data in poi) che non corrispondono a nessun articolo
export function daCollegare(cotte, articoli, da) {
  const m = new Map();
  for (const s of scarichiCotte(cotte, articoli)) {
    if (s.articolo || s.data < da) continue;
    const k = compatta(s.nome);
    if (!k) continue;
    const x = m.get(k) || { chiave: chiaveNome(s.nome), nome: s.nome, sezione: s.sezione, volte: 0, ultima: s.data };
    x.volte++;
    if (s.data > x.ultima) x.ultima = s.data;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.volte - a.volte);
}

export const unitaDa = sezione => (sezione === 'malti' ? 'kg' : sezione === 'acido' ? 'ml' : 'g');

// Proposta di catalogo dagli ingredienti usati nelle cotte recenti (per il primo inventario)
export function articoliDaRicette(cotte, articoli, da) {
  return daCollegare(cotte, articoli, da).map(x => ({
    nome: x.chiave.replace(/\b\w/g, l => l.toUpperCase()),
    categoria: categoriaDa(x.sezione, x.nome),
    unita: unitaDa(x.sezione),
    scortaMin: 0,
    alias: [],
    volte: x.volte,
  }));
}

// Registro HACCP S6 carico/scarico: righe C (bolle) e S (cotte, DH, acido, scarichi manuali)
// in ordine di data, con gli stessi lotti delle giacenze: uno scarico che svuota un lotto
// e prosegue sul successivo diventa due righe.
export function registroS6(dati, da, a) {
  const oggi = oggiISO();
  const fino = a && a < oggi ? a : oggi;
  const righe = [];
  const giaInRegistro = new Set(); // scarichi delle cotte già presi dalle giacenze (con il lotto)
  for (const g of giacenze(dati, fino).values()) {
    const art = g.articolo;
    const base = { prodotto: art.nome, unita: art.unita, categoria: art.categoria };
    for (const m of g.movimenti) {
      if (m.futuro) continue;
      if (m.tipo === 'carico') righe.push({ ...base, cs: 'C', data: m.data, lotto: m.lotto, scadenza: m.scadenza, qta: m.qta, chi: m.chi, dove: m.dove });
      // lotto scritto a mano (scheda cotta o registro): vale quello, anche se non risulta tra i lotti caricati
      if (m.tipo === 'scarico' && m.lottoScelto && !(m.lotti || []).some(l => l.lotto.toLowerCase() === m.lottoScelto.toLowerCase())) {
        righe.push({ ...base, cs: 'S', data: m.data, lotto: m.lottoScelto, scadenza: '', qta: -m.qta, chi: m.chi, dove: m.dove });
      } else if (m.tipo === 'scarico') for (const l of m.lotti || []) righe.push({ ...base, cs: 'S', data: m.data, lotto: l.lotto, scadenza: l.scadenza, qta: l.qta, chi: m.chi, dove: m.dove });
      if (m.tipo === 'scarico' && !m.manuale) giaInRegistro.add(`${m.id}|${m.nome}|${m.data}`);
    }
  }
  // Il registro elenca TUTTO quello che le cotte hanno usato, anche se non conta per la giacenza:
  // cotte fatte prima dell'inventario o della creazione dell'articolo, o ingredienti non ancora
  // collegati a un articolo del magazzino (lotto sconosciuto).
  for (const sc of scarichiCotte(dati.cotte || [], dati.articoli || [])) {
    if (sc.data > fino || giaInRegistro.has(`${sc.cotta.id}|${sc.nome}|${sc.data}`)) continue;
    const art = sc.articolo;
    const q = art ? convertiPer(art, sc.qta, sc.unita || art.unita) : sc.qta;
    righe.push({
      prodotto: art?.nome || chiaveNome(sc.nome).replace(/\b\w/g, l => l.toUpperCase()) || sc.nome, unita: art ? art.unita : sc.unita || unitaDa(sc.sezione),
      categoria: art?.categoria || categoriaDa(sc.sezione, sc.nome),
      cs: 'S', data: sc.data, lotto: sc.lotto, scadenza: '', qta: q ?? sc.qta, chi: destinoCotta(sc), scollegato: !art, dove: sc.dove,
    });
  }
  return righe.filter(r => (!da || r.data >= da) && (!a || r.data <= a))
    .sort((x, y) => x.data.localeCompare(y.data) || x.cs.localeCompare(y.cs) || x.prodotto.localeCompare(y.prodotto, 'it'));
}

// Unisce un doppione: tutto ciò che era di `togli` (bolle, inventari, scarichi manuali) passa a `tieni`,
// il nome e gli alias di `togli` diventano alias di `tieni` (così le cotte lo trovano ancora).
// Un inventario vale come giacenza dell'articolo: se in un inventario c'è solo uno dei due, la riga unita
// prende anche la giacenza che l'altro aveva in quel giorno, così le quantità si sommano (Romain 2026-10-16).
// Restituisce i record da salvare, oppure { errore } se le quantità degli inventari non sono convertibili.
export function unisciArticoli(tieni, togli, dati) {
  const { bolle, inventari, scarichi = [] } = dati;
  // giacenza di un articolo in un giorno, calcolata sui dati prima dell'unione (mai sotto zero)
  const giacenzaAl = (art, data) => Math.max(0, giacenze({ ...dati, articoli: [art], scarichi }, data).get(art.id)?.giacenza || 0);
  const k = chiaveNome(tieni.nome);
  const alias = [...new Set([...(tieni.alias || []), togli.nome, ...(togli.alias || [])])].filter(x => chiaveNome(x) !== k);
  const art = {
    ...tieni, alias,
    scortaMin: tieni.scortaMin || togli.scortaMin || 0,
    pesoPezzo: tieni.pesoPezzo || (tieni.unita === togli.unita ? togli.pesoPezzo : null) || null,
    creato: [tieni.creato, togli.creato].filter(Boolean).sort()[0] || tieni.creato,
  };
  const modificati = [art];
  for (const b of [...bolle, ...scarichi]) {
    if (!(b.righe || []).some(r => r.articoloId === togli.id)) continue;
    modificati.push({ ...b, righe: b.righe.map(r => (r.articoloId === togli.id ? { ...r, articoloId: tieni.id, ...(r.nome !== undefined ? { nome: tieni.nome } : {}) } : r)) });
  }
  for (const inv of inventari) {
    const ha = id => (inv.righe || []).some(r => r.articoloId === id && r.qta !== null && r.qta !== '' && r.qta !== undefined);
    if (ha(tieni.id) && !ha(togli.id) && inv.data) {
      // contato solo `tieni`: si aggiunge la giacenza di `togli` in quel giorno
      const extra = converti(giacenzaAl(togli, inv.data), togli.unita, tieni.unita);
      if (extra === null) return { errore: `${togli.nome} è in ${togli.unita} e non si converte in ${tieni.unita}. Cambia prima l'unità di uno dei due.` };
      if (extra) modificati.push({ ...inv, righe: inv.righe.map(r => (r.articoloId === tieni.id ? { ...r, qta: Number(r.qta) + extra } : r)) });
      continue;
    }
    if (!(inv.righe || []).some(r => r.articoloId === togli.id)) continue;
    // contato solo `togli`: alla sua riga (che passa a `tieni`) si aggiunge la giacenza di `tieni` in quel giorno
    const extraTieni = ha(togli.id) && !ha(tieni.id) && inv.data ? giacenzaAl(tieni, inv.data) : 0;
    const righe = [];
    for (const r of inv.righe) {
      if (r.articoloId !== togli.id) { righe.push(r); continue; }
      const q0 = r.qta === null || r.qta === '' || r.qta === undefined ? r.qta : converti(r.qta, togli.unita, tieni.unita);
      if (q0 === null && r.qta !== null) return { errore: `L'inventario del ${inv.data} ha ${togli.nome} in ${togli.unita}: non si converte in ${tieni.unita}. Cambia prima l'unità di uno dei due.` };
      const q = typeof q0 === 'number' ? q0 + extraTieni : q0;
      const gia = righe.find(x => x.articoloId === tieni.id);
      if (gia) gia.qta = (Number(gia.qta) || 0) + (Number(q) || 0);
      else righe.push({ ...r, articoloId: tieni.id, qta: q });
    }
    // la riga di `tieni` già presente nello stesso inventario va sommata anche se viene dopo
    const doppie = righe.filter(x => x.articoloId === tieni.id);
    if (doppie.length > 1) {
      const somma = { ...doppie[0], qta: doppie.reduce((t, x) => t + (Number(x.qta) || 0), 0) };
      modificati.push({ ...inv, righe: [...righe.filter(x => x.articoloId !== tieni.id), somma] });
    } else modificati.push({ ...inv, righe });
  }
  return { modificati };
}
