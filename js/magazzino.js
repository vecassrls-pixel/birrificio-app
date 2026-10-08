// Magazzino materie prime: giacenze calcolate, mai scritte a mano.
// giacenza = ultimo inventario dell'articolo + carichi (bolle) dopo quella data
//            − scarichi delle cotte (ingredienti) e dei DH dopo quella data.
// Le cotte non ancora fatte (e i DH futuri) sono "impegnato": non tolgono dalla giacenza
// di oggi ma dal disponibile.
//
// Record nell'archivio:
//   articolo   { nome, categoria, unita, scortaMin, alias: [], creato }  (creato: senza inventario, gli scarichi contano da quel giorno)
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
export function trovaArticolo(articoli, nome) {
  const k = compatta(nome);
  if (!k) return null;
  return articoli.find(a => compatta(a.nome) === k || (a.alias || []).some(x => compatta(x) === k)) || null;
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

// Tutti gli scarichi delle cotte: [{ articolo|null, nome, sezione, qta, unita, data, cotta }]
export function scarichiCotte(cotte, articoli) {
  const out = [];
  for (const c of cotte) {
    if (!c.data || c.eliminato) continue;
    for (const sez of SEZIONI) {
      for (const r of c[sez] || []) {
        if (!r.nome || !(Number(r.qta) > 0)) continue;
        // nelle schede l'acido lattico è scritto in "g" ma sono ml
        const unita = /acido/i.test(r.nome) && r.unita === 'g' ? 'ml' : r.unita || '';
        out.push({ articolo: trovaArticolo(articoli, r.nome), nome: r.nome, sezione: /acido/i.test(r.nome) ? 'acido' : sez, qta: Number(r.qta), unita, data: dataUscita(c, sez, r), cotta: c });
      }
    }
    // correzioni pH con acido lattico (ml), ognuna alla sua data
    for (const r of c.acido || []) {
      if (!(Number(r.ml) > 0)) continue;
      out.push({ articolo: trovaArticolo(articoli, NOME_ACIDO), nome: NOME_ACIDO, sezione: 'acido', qta: Number(r.ml), unita: 'ml', data: r.data || c.data, cotta: c });
    }
  }
  return out;
}

// Giacenze di tutti gli articoli a una data. Ritorna Map id → riepilogo con i movimenti.
export function giacenze({ articoli, bolle, inventari, cotte, scarichi = [] }, oggi = oggiISO()) {
  const res = new Map(articoli.map(a => [a.id, {
    articolo: a, inventario: null, giacenza: 0, impegnato: 0, movimenti: [], nonConvertibili: 0,
  }]));
  // ultimo inventario (fino a oggi) per articolo
  for (const inv of [...inventari].filter(i => i.data && i.data <= oggi).sort((x, y) => x.data.localeCompare(y.data))) {
    for (const r of inv.righe || []) {
      const g = res.get(r.articoloId);
      if (g && r.qta !== null && r.qta !== '' && r.qta !== undefined) g.inventario = { data: inv.data, qta: Number(r.qta), id: inv.id, lotto: r.lotto || '', scadenza: r.scadenza || '' };
    }
  }
  for (const g of res.values()) {
    if (g.inventario) {
      g.giacenza = g.inventario.qta;
      g.movimenti.push({ data: g.inventario.data, tipo: 'inventario', qta: g.inventario.qta, rif: 'Inventario', id: g.inventario.id, lotto: g.inventario.lotto, scadenza: g.inventario.scadenza });
    }
  }
  // senza inventario: tutte le bolle, ma solo gli scarichi da quando l'articolo esiste
  const dopoInventario = (g, data, tipo) => (g.inventario ? data > g.inventario.data : tipo === 'carico' || !g.articolo.creato || data >= g.articolo.creato);
  const muovi = (g, data, qta, unita, mov) => {
    const q = converti(qta, unita, g.articolo.unita);
    if (q === null) { g.nonConvertibili++; return; }
    if (data > oggi) { if (mov.tipo === 'scarico') g.impegnato += q; g.movimenti.push({ ...mov, data, qta: mov.tipo === 'scarico' ? -q : q, futuro: true }); return; }
    if (!dopoInventario(g, data, mov.tipo)) return;
    g.giacenza += mov.tipo === 'scarico' ? -q : q;
    g.movimenti.push({ ...mov, data, qta: mov.tipo === 'scarico' ? -q : q });
  };
  for (const b of bolle) {
    for (const r of b.righe || []) {
      const g = res.get(r.articoloId);
      if (g && b.data) muovi(g, b.data, r.qta, r.unita || g.articolo.unita, { tipo: 'carico', rif: `Bolla ${b.numero || ''} ${b.fornitore || ''}`.trim(), id: b.id, lotto: r.lotto || '', scadenza: r.scadenza || '', chi: [b.fornitore, b.numero && `DDT ${b.numero}`].filter(Boolean).join(' · ') });
    }
  }
  for (const s of scarichiCotte(cotte, articoli)) {
    const g = s.articolo && res.get(s.articolo.id);
    if (g) muovi(g, s.data, s.qta, s.unita || g.articolo.unita, { tipo: 'scarico', rif: `${s.cotta.birra || ''} ${s.cotta.lotto || ''}`.trim(), id: s.cotta.id, nome: s.nome, chi: destinoCotta(s) });
  }
  // scarichi manuali (vendita, reso, scarto): se è indicato il lotto esce da quello
  for (const sc of scarichi) {
    for (const r of sc.righe || []) {
      const g = res.get(r.articoloId);
      const chi = [MOTIVI_SCARICO[sc.motivo] || 'Scarico', sc.destinatario].filter(Boolean).join(' · ');
      if (g && sc.data) muovi(g, sc.data, r.qta, r.unita || g.articolo.unita, { tipo: 'scarico', manuale: true, rif: chi, id: sc.id, lottoScelto: r.lotto || '', chi });
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
      coda.push({ lotto: m.lotto || '', scadenza: m.scadenza || '', data: m.data, qta: m.qta - copre, rif: m.rif, id: m.id, tipo: m.tipo });
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
  for (const g of giacenze(dati, fino).values()) {
    const art = g.articolo;
    const base = { prodotto: art.nome, unita: art.unita, categoria: art.categoria };
    for (const m of g.movimenti) {
      if (m.futuro) continue;
      if (m.tipo === 'carico') righe.push({ ...base, cs: 'C', data: m.data, lotto: m.lotto, scadenza: m.scadenza, qta: m.qta, chi: m.chi });
      if (m.tipo === 'scarico') for (const l of m.lotti || []) righe.push({ ...base, cs: 'S', data: m.data, lotto: l.lotto, scadenza: l.scadenza, qta: l.qta, chi: m.chi });
    }
  }
  return righe.filter(r => (!da || r.data >= da) && (!a || r.data <= a))
    .sort((x, y) => x.data.localeCompare(y.data) || x.cs.localeCompare(y.cs) || x.prodotto.localeCompare(y.prodotto, 'it'));
}
