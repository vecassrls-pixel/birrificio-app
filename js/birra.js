// Magazzino birra finita: giacenze calcolate, mai scritte a mano (come le materie prime).
// Prodotto = birra + formato ("LA MORTE SUA · Fusto 24 L"), contato in pezzi.
//
// giacenza = ultimo inventario del prodotto + confezionamenti delle cotte + carichi manuali
//            − scarichi (manuali, fatture di Fatture in Cloud, ordini Shopify) dopo quella data.
// Senza inventario contano solo i movimenti dal giorno di inizio del magazzino birra:
// lo storico delle cotte non deve risultare ancora in magazzino.
//
// Record nell'archivio:
//   movbirra        { verso: 'carico'|'scarico', data, motivo, cliente, documento, note,
//                     origine: 'manuale'|'fic'|'shopify', rifEsterno, ignorato, scontrinato (solo scarichi manuali),
//                     righe: [{ prodotto, pezzi, lotto, scadenza }] }   (prodotto = chiave del prodotto)
//   inventariobirra { data, righe: [{ prodotto, lotto, scadenza, pezzi }] }
//   prodottobirra   { id: 'prodottobirra-<chiave>', chiave, codici: [{ codice, x }] }
//                   codici/SKU/descrizioni con cui il prodotto compare in Fatture in Cloud e Shopify;
//                   x = pezzi per unità venduta (cartone da 24 = 24)
//   impostazione    { id: 'impostazione-birra', inizio, codiciIgnorati: [] }
//
// Lotti: lotto e scadenza sono quelli dell'etichetta, dalla sezione Confezionamento della cotta.
// Gli scarichi senza lotto escono dal lotto che scade prima.

import { abv, gruppoCotta, lottoGruppo, nomeBirra, numIT, oggiISO, scadenzaCotta } from './dominio.js';
import { statoScadenza } from './magazzino.js';

export const ID_IMPOSTAZIONI = 'impostazione-birra';
export const FORMATI = { fusto: 'Fusto', 'lattina/bottiglia': 'Lattina' };
// scelte dello scarico manuale; 'vendita' è degli scarichi importati da fatture e ordini
export const MOTIVI_SCARICO = { taproom: 'Taproom', autoconsumo: 'Autoconsumo', spaccio: 'Spaccio', eventi: 'Eventi', altro: 'Altro' };
const NOMI_MOTIVO = { ...MOTIVI_SCARICO, vendita: 'Vendita' };
export const nomeMotivo = (m) => (m.verso === 'carico' ? MOTIVI_CARICO[m.motivo] || 'Carico' : NOMI_MOTIVO[m.motivo] || 'Scarico');
// scontrinato: solo per gli scarichi manuali (true / false), undefined per carichi e import
export const testoScontrino = m => (m.verso !== 'carico' && typeof m.scontrinato === 'boolean' ? (m.scontrinato ? 'scontrinato' : 'non scontrinato') : '');
export const MOTIVI_CARICO = { reso: 'Reso da cliente', rettifica: 'Rettifica', altro: 'Altro' };
export const ORIGINI = { manuale: 'Manuale', fic: 'Fatture in Cloud', shopify: 'Shopify' };

export const impostazioniDa = rec => ({
  inizio: rec?.inizio || null,
  codiciIgnorati: rec?.codiciIgnorati || [],
});

// ---------- prodotti ----------
export const chiaveProdotto = (birra, tipo, litri) => `${nomeBirra(birra)}|${tipo || 'fusto'}|${Number(litri) || 0}`;
export function daChiave(chiave) {
  const [birra, tipo, litri] = String(chiave).split('|');
  return { chiave, birra, tipo, litri: Number(litri) || 0 };
}
export const nomeFormato = (tipo, litri) => `${FORMATI[tipo] || tipo} ${numIT(litri, litri < 1 ? 2 : 0)} L`;
export const nomeProdotto = chiave => { const p = daChiave(chiave); return `${p.birra} · ${nomeFormato(p.tipo, p.litri)}`; };
export const idProdotto = chiave => `prodottobirra-${chiave.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

// Lotto e scadenza come in etichetta (sezione Confezionamento della cotta, vedi testoLottoScadenza in dominio.js):
// lotto "51/52/25" per le cotte doppie, scadenza = fine del mese di scadenza della cotta.
export function lottoEtichetta(g) {
  const c = g[0];
  return g.length > 1 ? `${lottoGruppo(g)}/${String(c.anno || c.data.slice(0, 4)).slice(2)}` : c.lotto || '';
}
export function fineMese(mese) {
  if (!/^\d{4}-\d{2}$/.test(mese || '')) return '';
  const [y, m] = mese.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Confezionamenti di tutte le cotte = carichi di birra. Le cotte doppie/triple hanno il
// confezionamento solo sulla prima del gruppo.
// Prodotti rinominati: il record del vecchio nome tiene rinominatoIn (serve per i confezionamenti
// delle cotte, che hanno ancora il nome vecchio). Ritorna Map vecchia chiave → chiave attuale.
export function rinominati(prodotti = []) {
  const m = new Map(prodotti.filter(p => !p.eliminato && p.chiave && p.rinominatoIn).map(p => [p.chiave, p.rinominatoIn]));
  for (const k of m.keys()) { let v = m.get(k); for (let i = 0; i < 10 && m.has(v); i++) v = m.get(v); m.set(k, v); }
  return m;
}

export function confezionamenti(cotte, durate, alias = new Map()) {
  const out = [];
  for (const c of cotte) {
    if (c.eliminato || !(c.confezionato || []).length) continue;
    const g = gruppoCotta(c, cotte);
    if (g[0].id !== c.id && (g[0].confezionato || []).length) continue;
    const lotto = lottoEtichetta(g);
    const scadenza = fineMese(scadenzaCotta(c, cotte, durate)?.mese);
    for (const [i, r] of c.confezionato.entries()) {
      const data = r.data || c.fine || c.data || '';
      if (!(Number(r.pezzi) > 0) || !(Number(r.litri) > 0) || !data) continue;
      const k = chiaveProdotto(c.birra, r.tipo, r.litri);
      out.push({ prodotto: alias.get(k) || k, pezzi: Number(r.pezzi), data, lotto, scadenza, cotta: c, dove: { tipo: 'cotta', id: c.id, path: `confezionato.${i}` } });
    }
  }
  return out;
}

// Prodotti conosciuti: dai confezionamenti, dai movimenti, dagli inventari e dai codici salvati
export function elencoProdotti({ cotte, movimenti = [], inventari = [], prodotti = [] }) {
  const s = new Set();
  const al = rinominati(prodotti);
  for (const c of cotte) if (!c.eliminato) for (const r of c.confezionato || []) if (Number(r.litri) > 0) { const k = chiaveProdotto(c.birra, r.tipo, r.litri); s.add(al.get(k) || k); }
  for (const m of [...movimenti, ...inventari]) for (const r of m.righe || []) if (r.prodotto) s.add(al.get(r.prodotto) || r.prodotto);
  for (const p of prodotti) if (p.chiave && !p.eliminato) s.add(al.get(p.chiave) || p.chiave);
  return [...s].sort((a, b) => a.localeCompare(b, 'it'));
}

// Grado alcolico e stile di una birra (uguali per tutti i formati): quelli scritti nei prodotti,
// altrimenti proposti dall'ultima cotta della birra (stile, ABV da OG e FG).
export function caratteristiche(birra, prodotti = [], cotte = []) {
  const mie = prodotti.filter(p => !p.eliminato && !p.rinominatoIn && p.chiave && daChiave(p.chiave).birra === birra);
  const conAbv = mie.find(p => p.abv !== null && p.abv !== undefined && p.abv !== '');
  const conStile = mie.find(p => p.stile);
  const recenti = cotte.filter(c => !c.eliminato && nomeBirra(c.birra) === birra).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const misurato = recenti.map(c => abv(Number(c.og), c.fg === null || c.fg === undefined || c.fg === '' ? null : Number(c.fg))).find(x => x > 0);
  return {
    abv: conAbv ? Number(conAbv.abv) : null, stile: conStile?.stile || '',
    abvProposto: misurato ? Math.round(misurato * 10) / 10 : null, stileProposto: recenti.find(c => c.stile)?.stile || '',
  };
}

// Da un nome libero (prodotto di Fatture in Cloud, riga di un ordine) prova a capire birra e formato.
// birreNote: nomi delle birre già conosciute (dalle cotte). Ritorna { birra, tipo, litri, sicuro }.
export function indovinaProdotto(nome, birreNote = []) {
  const n = ` ${pulito(nome)} `;
  let litri = null;
  const cl = /(?:^|[^0-9,.])(\d{2})\s*cl\b/.exec(n);
  const dec = /(?:^|[^0-9])0[,.](\d{2})\b/.exec(n);
  const l = /(?:^|[^0-9,.])(\d{1,2})\s*(?:l|lt|litri)\b/.exec(n);
  if (cl) litri = Number(cl[1]) / 100;
  else if (dec) litri = Number(`0.${dec[1]}`);
  else if (l) litri = Number(l[1]);
  const fusto = /\b(fust|keg)/.test(n), lattina = /\b(lattin|can|bottigl)/.test(n);
  const tipo = fusto ? 'fusto' : lattina || (litri && litri < 1) ? 'lattina/bottiglia' : litri ? 'fusto' : '';
  if (!litri && tipo === 'lattina/bottiglia') litri = 0.33;
  const compatto = n.replace(/ /g, '');
  const nota = [...birreNote].sort((a, b) => b.length - a.length).find(b => n.includes(` ${pulito(b)} `) || compatto.includes(pulito(b).replace(/ /g, '')));
  // senza una birra conosciuta: il nome senza le parole del formato
  const birra = nota || pulito(nome).replace(/\b\d+([,.]\d+)?\s*(cl|lt|l|litri)\b/g, ' ').replace(/\b(fusto|fusti|keg|lattina|lattine|can|bottiglia|bottiglie|birra|cl|lt|l|litri|x)\b/g, ' ')
    .replace(/\b\d+([,.]\d+)?\b/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  return { birra: nomeBirra(birra), tipo: tipo || 'fusto', litri: litri || 0, sicuro: !!(nota && tipo && litri), birraNota: !!nota, formatoNoto: !!(tipo && litri) };
}

// ---------- giacenze ----------
const ORDINE = { inventario: 0, carico: 1, scarico: 2 };
const chiaveLotto = l => String(l || '').trim().toLowerCase();

// dati: { cotte, durate, movimenti, inventari, prodotti, impostazioni }
export function giacenzeBirra(dati, oggi = oggiISO()) {
  const imp = impostazioniDa(dati.impostazioni);
  const inizio = imp.inizio || oggi;
  const res = new Map();
  const al = rinominati(dati.prodotti);
  const di = k => {
    const chiave = al.get(k) || k;
    if (!res.has(chiave)) res.set(chiave, { ...daChiave(chiave), nome: nomeProdotto(chiave), inventario: null, movimenti: [], futuri: [], prima: [] });
    return res.get(chiave);
  };
  for (const k of elencoProdotti(dati)) di(k);

  // ultimo inventario (fino a oggi) di ogni prodotto: tutte le sue righe di quel giorno
  for (const inv of [...(dati.inventari || [])].filter(i => i.data && i.data <= oggi).sort((x, y) => x.data.localeCompare(y.data) || String(x.aggiornato || '').localeCompare(String(y.aggiornato || '')))) {
    const per = new Map();
    for (const r of inv.righe || []) {
      if (!r.prodotto || r.pezzi === null || r.pezzi === '' || r.pezzi === undefined) continue;
      if (!per.has(r.prodotto)) per.set(r.prodotto, []);
      per.get(r.prodotto).push({ lotto: r.lotto || '', scadenza: r.scadenza || '', pezzi: Number(r.pezzi) || 0 });
    }
    for (const [k, righe] of per) di(k).inventario = { data: inv.data, id: inv.id, righe };
  }
  const conta = (g, data) => (g.inventario ? data > g.inventario.data : data >= inizio);
  const aggiungi = (k, m) => {
    const g = di(k);
    if (m.data > oggi) { g.futuri.push(m); return; }
    if (conta(g, m.data)) g.movimenti.push(m);
    else g.prima.push(m); // già compreso nell'inventario (o prima dell'inizio): non tocca la giacenza ma resta nel registro
  };
  for (const cf of confezionamenti(dati.cotte, dati.durate, al)) {
    aggiungi(cf.prodotto, { tipo: 'carico', data: cf.data, pezzi: cf.pezzi, lotto: cf.lotto, scadenza: cf.scadenza, rif: `Confezionamento ${cf.cotta.lotto || ''}`.trim(), chi: 'Confezionamento', link: `#/cotta/${encodeURIComponent(cf.cotta.id)}`, dove: cf.dove });
  }
  for (const mv of dati.movimenti || []) {
    if (mv.eliminato || mv.ignorato || !mv.data) continue;
    const carico = mv.verso === 'carico';
    const chi = [nomeMotivo(mv), testoScontrino(mv), mv.cliente, mv.documento].filter(Boolean).join(' · ');
    for (const [i, r] of (mv.righe || []).entries()) {
      if (!r.prodotto || !(Number(r.pezzi) > 0)) continue;
      aggiungi(r.prodotto, {
        tipo: carico ? 'carico' : 'scarico', manuale: true, origine: mv.origine || 'manuale', data: mv.data, pezzi: Number(r.pezzi),
        lotto: carico ? r.lotto || '' : '', scadenza: carico ? r.scadenza || '' : '', lottoScelto: carico ? '' : r.lotto || '',
        rif: chi, chi, link: `#/movbirra/${encodeURIComponent(mv.id)}`, dove: { tipo: 'movbirra', id: mv.id, path: `righe.${i}` },
      });
    }
  }
  for (const g of res.values()) simula(g, oggi);
  return res;
}

// Scorre i movimenti in ordine di data: i carichi creano o allungano un lotto, gli scarichi
// prendono dal lotto scelto e poi da quello che scade prima. Ogni scarico riceve m.lotti.
function simula(g, oggi) {
  const lotti = new Map();
  let debito = 0;
  const entra = (lotto, scadenza, data, pezzi, rif) => {
    const k = chiaveLotto(lotto);
    const l = lotti.get(k) || { lotto: lotto || '', scadenza: scadenza || '', data, pezzi: 0, rif };
    if (scadenza && (!l.scadenza || scadenza < l.scadenza)) l.scadenza = scadenza;
    const copre = Math.min(debito, pezzi);
    debito -= copre;
    l.pezzi += pezzi - copre;
    lotti.set(k, l);
  };
  if (g.inventario) for (const r of g.inventario.righe) entra(r.lotto, r.scadenza, g.inventario.data, r.pezzi, 'Inventario');
  g.movimenti.sort((x, y) => x.data.localeCompare(y.data) || ORDINE[x.tipo] - ORDINE[y.tipo]);
  for (const m of g.movimenti) {
    if (m.tipo === 'carico') { entra(m.lotto, m.scadenza, m.data, m.pezzi, m.rif); continue; }
    m.lotti = [];
    let resto = m.pezzi;
    const prendi = l => { const q = Math.min(resto, l.pezzi); if (q <= 0) return; l.pezzi -= q; resto -= q; m.lotti.push({ lotto: l.lotto, scadenza: l.scadenza, pezzi: q }); };
    const scelto = m.lottoScelto && lotti.get(chiaveLotto(m.lottoScelto));
    if (scelto) prendi(scelto);
    for (const l of perScadenza([...lotti.values()])) { if (resto <= 0) break; prendi(l); }
    if (resto > 0) { m.lotti.push({ lotto: m.lottoScelto || '', scadenza: '', pezzi: resto }); debito += resto; }
  }
  if (g.inventario) g.movimenti.push({ tipo: 'inventario', data: g.inventario.data, pezzi: g.inventario.righe.reduce((t, r) => t + r.pezzi, 0), rif: 'Inventario', link: '#/birra-inventario' });
  g.movimenti.sort((x, y) => y.data.localeCompare(x.data) || ORDINE[y.tipo] - ORDINE[x.tipo]);
  g.lotti = perScadenza([...lotti.values()].filter(l => l.pezzi > 0));
  g.giacenza = g.lotti.reduce((t, l) => t + l.pezzi, 0) - debito;
  g.mancanti = debito; // scaricati più pezzi di quelli che risultano: manca un confezionamento o un inventario
  g.litriTot = g.giacenza * g.litri;
  g.scadenza = g.lotti.map(l => l.scadenza).filter(Boolean).sort()[0] || null;
  g.statoScadenza = statoScadenza(g.scadenza, oggi);
}
// prima il lotto che scade prima; senza scadenza in fondo, in ordine di carico
const perScadenza = ll => ll.sort((a, b) => (a.scadenza || '9999').localeCompare(b.scadenza || '9999') || (a.data || '').localeCompare(b.data || ''));

// Registro di carico e scarico della birra: una riga per lotto movimentato
export function registroBirra(dati, da, a) {
  const oggi = oggiISO();
  const righe = [];
  for (const g of giacenzeBirra(dati, a && a < oggi ? a : oggi).values()) {
    for (const m of [...g.movimenti, ...g.prima]) {
      if (m.tipo === 'inventario' || (da && m.data < da) || (a && m.data > a)) continue;
      const base = { data: m.data, prodotto: g.nome, chiave: g.chiave, birra: g.birra, chi: m.chi, link: m.link, origine: m.origine };
      const lp = g.litri;
      if (m.tipo === 'carico') righe.push({ ...base, cs: 'C', lotto: m.lotto, scadenza: m.scadenza, pezzi: m.pezzi, litri: m.pezzi * lp });
      else for (const l of m.lotti || [{ lotto: m.lottoScelto, scadenza: '', pezzi: m.pezzi }]) righe.push({ ...base, cs: 'S', lotto: l.lotto, scadenza: l.scadenza, pezzi: l.pezzi, litri: l.pezzi * lp });
    }
  }
  return righe.sort((x, y) => x.data.localeCompare(y.data) || x.cs.localeCompare(y.cs) || x.prodotto.localeCompare(y.prodotto, 'it'));
}

// ---------- righe dei documenti esterni (Fatture in Cloud, Shopify) ----------
const pulito = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9,.]+/g, ' ').trim();

// Cerca il prodotto di una riga: prima tra i codici salvati, poi dal nome (birra + formato)
// Ritorna { prodotto, x } oppure { ignora: true } oppure null
export function trovaProdotto({ codice, nome }, chiavi, prodotti, imp) {
  const cod = [codice, nome].map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  if (imp.codiciIgnorati.some(c => cod.includes(String(c).toLowerCase()))) return { ignora: true };
  for (const p of prodotti) {
    const hit = (p.codici || []).find(c => cod.includes(String(c.codice).toLowerCase()));
    if (hit && chiavi.includes(p.chiave)) return { prodotto: p.chiave, x: Number(hit.x) || 1 };
  }
  // dal nome: deve contenere il nome della birra; il formato dai litri (24, 24l, 0,33, 33cl) o dalla parola
  const n = ` ${pulito(`${nome} ${codice}`)} `;
  const candidati = chiavi.map(daChiave).filter(p => n.includes(` ${pulito(p.birra)} `) || n.includes(pulito(p.birra).replace(/ /g, '')));
  if (!candidati.length) return null;
  const lungo = Math.max(...candidati.map(p => p.birra.length));
  const migliori = candidati.filter(p => p.birra.length === lungo); // "LA MORTE SUA HOLIDAY" prima di "LA MORTE SUA"
  const perFormato = migliori.filter(p => {
    const l = p.litri;
    const cl = Math.round(l * 100);
    const segni = l < 1 ? [`${cl}cl`, `${cl} cl`, `0,${cl}`, `0.${cl}`, `${cl}`] : [`${l}l`, `${l} l`, `${l}lt`, `${l} lt`, `${l}`];
    return segni.some(s => new RegExp(`(^|[^0-9,.])${s.replace('.', '\\.')}($|[^0-9])`).test(n));
  });
  if (perFormato.length === 1) return { prodotto: perFormato[0].chiave, x: 1 };
  // c'è un volume nel nome ma non corrisponde a nessun formato di questa birra: si sceglie a mano
  if (/\d\s*(l|lt|litri|cl)\b/.test(n) || perFormato.length > 1) return null;
  const perParola = migliori.filter(p => (p.tipo === 'fusto' ? /\b(fust|keg)/ : /\b(lattin|can|bottigl|bott)/).test(n));
  if (perParola.length === 1) return { prodotto: perParola[0].chiave, x: 1 };
  if (migliori.length === 1) return { prodotto: migliori[0].chiave, x: 1 };
  return null;
}

// Salva il codice di una riga sul prodotto scelto (così la prossima volta lo trova da solo)
export function conCodice(prodotti, chiave, codice, x = 1) {
  const c = String(codice || '').trim();
  if (!c) return null;
  const p = prodotti.find(z => z.chiave === chiave) || { tipo: 'prodottobirra', id: idProdotto(chiave), chiave, codici: [] };
  const codici = (p.codici || []).filter(z => String(z.codice).toLowerCase() !== c.toLowerCase());
  return { ...p, codici: [...codici, { codice: c, x: Number(x) || 1 }] };
}

