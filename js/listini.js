// Listini di vendita: si parte dal listino base "Alpha" (prezzi scritti a mano per ogni prodotto: birra + formato);
// gli altri listini sono Alpha + un ricarico in % (anche negativo = sconto).
//
// Record nell'archivio:
//   listino { id: 'listino-…', tipo: 'listino', nome, ricarico (% sui prezzi di Alpha),
//             ricarichi: { fusto, 'lattina/bottiglia' } (% diversa per formato; vuoto = vale ricarico),
//             arrotonda (€, 0 = al centesimo; per eccesso), iva (true = prezzi IVA inclusa),
//             prodotti: 'magazzino' (solo con giacenza) | 'tutti', esclusi: [chiavi prodotto],
//             fissi: { chiave: € } (prezzo scritto a mano, vince sul calcolo), note }
//   Alpha ha id 'listino-alpha' e in più prezzi: { "BIRRA|tipo|litri": € IVA esclusa }; i suoi esclusi = prodotti che non si vendono (fuori da tutti i listini).
//   I prezzi di vendita della pagina Costi restano separati (servono per ricavi e margini).

import { daChiave, nomeFormato } from './birra.js';

export const ALIQUOTA_IVA = 22;
export const ARROTONDA = [[0, 'Al centesimo'], [0.05, '0,05 €'], [0.1, '0,10 €'], [0.5, '0,50 €'], [1, '1 €']];

export const ID_ALPHA = 'listino-alpha';
export const nuovoListino = (id, nome) => ({
  id, tipo: 'listino', nome, ricarico: 30, arrotonda: 0.1, iva: false, prodotti: 'magazzino', esclusi: [], fissi: {}, note: '',
});
export const nuovoAlpha = () => ({ ...nuovoListino(ID_ALPHA, 'Alpha'), ricarico: 0, arrotonda: 0, prodotti: 'tutti', prezzi: {} });
export const listinoDa = rec => ({ ...(rec.id === ID_ALPHA ? nuovoAlpha() : nuovoListino(rec.id, rec.nome || 'Listino')), ...rec, esclusi: rec.esclusi || [], fissi: rec.fissi || {}, ricarichi: rec.ricarichi || {} });
// Alpha non ha ricarico né prezzi fissati: il suo prezzo è quello scritto nella colonna Base
export const perCalcolo = l => (l.id === ID_ALPHA ? { ...l, ricarico: 0, ricarichi: {}, fissi: {} } : l);

// Formati con un ricarico a parte (stessi tipi della chiave prodotto "BIRRA|tipo|litri")
export const GRUPPI_RICARICO = [['fusto', 'Fusti'], ['lattina/bottiglia', 'Lattine']];
// Ricarico in % per un tipo di prodotto: quello del formato se scritto, altrimenti quello generale
export function ricaricoPer(l, tipo) {
  const r = l.ricarichi?.[tipo];
  return r !== undefined && r !== null && r !== '' && Number.isFinite(Number(r)) ? Number(r) : Number(l.ricarico) || 0;
}
// Ricarichi da mostrare: "+30%" oppure "fusti +20% · lattine +35%"
export function testoRicarico(l, numIT = n => String(n)) {
  const pc = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${numIT(Math.abs(n), 1)}%`;
  const valori = GRUPPI_RICARICO.map(([t, n]) => [n.toLowerCase(), ricaricoPer(l, t)]);
  return valori.every(([, v]) => v === valori[0][1]) ? pc(valori[0][1]) : valori.map(([n, v]) => `${n} ${pc(v)}`).join(' · ');
}

export function prezzoBase(vendita, chiave) {
  const v = vendita[chiave];
  return Number(v) > 0 ? Number(v) : null;
}
// per eccesso al passo scelto (0,10 € → 4,32 diventa 4,40); i centesimi sempre
export function arrotonda(x, passo) {
  const cent = Math.round(x * 100) / 100;
  if (!(passo > 0)) return cent;
  return Math.round(Math.ceil(cent / passo - 1e-9) * passo * 100) / 100;
}
export function prezzoListino(base, l, tipo) {
  if (!(base > 0)) return null;
  const netto = base * (1 + ricaricoPer(l, tipo) / 100);
  return arrotonda(l.iva ? netto * (1 + ALIQUOTA_IVA / 100) : netto, Number(l.arrotonda) || 0);
}

// Righe del listino. giacenze: Map chiave → { giacenza } (da giacenzeBirra), chiavi: tutti i prodotti conosciuti,
// vendita: i prezzi di Alpha (alpha.prezzi); fuoriAlpha: prodotti tolti da Alpha (non si vendono).
// Gli altri listini mostrano solo i prodotti con un prezzo in Alpha.
export function righeListino(l, chiavi, giacenze, vendita, fuoriAlpha = []) {
  const alpha = l.id === ID_ALPHA;
  const fuori = new Set(alpha ? [] : fuoriAlpha);
  l = perCalcolo(l);
  const esclusi = new Set(l.esclusi);
  return chiavi
    .map(chiave => {
      const p = daChiave(chiave);
      const giacenza = giacenze.get(chiave)?.giacenza ?? 0;
      const base = prezzoBase(vendita, chiave);
      const calcolato = prezzoListino(base, l, p.tipo);
      const fisso = Number(l.fissi[chiave]) > 0 ? Number(l.fissi[chiave]) : null;
      const prezzo = fisso ?? calcolato;
      return { ...p, formato: nomeFormato(p.tipo, p.litri), giacenza, base, baseBirra: vendita[chiave] ?? null, calcolato, fisso, prezzo, escluso: esclusi.has(chiave), alLitro: prezzo && p.litri ? prezzo / p.litri : null };
    })
    .filter(r => (l.prodotti === 'tutti' || r.giacenza > 0) && (alpha || (r.base && !fuori.has(r.chiave))))
    .sort((a, b) => a.birra.localeCompare(b.birra, 'it') || a.tipo.localeCompare(b.tipo) || b.litri - a.litri);
}
// righe che finiscono nel testo copiato
export const righeDaCopiare = righe => righe.filter(r => !r.escluso && r.prezzo);

export const soldi = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = n => `€ ${soldi(n)}`;
// "IPA · 6,5% vol" dalle righe arricchite con stile e abv (vedi conCaratteristiche)
const numIT1 = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
export const infoBirra = r => [r.stile || '', r.abv > 0 ? `${numIT1(r.abv)}% vol` : ''].filter(Boolean).join(' · ');
// aggiunge a ogni riga stile e grado alcolico della birra. info: (birra) → { stile, abv }
export const conCaratteristiche = (righe, info) => righe.map(r => ({ ...r, ...info(r.birra) }));
const testoIva = l => (l.iva ? `Prezzi IVA ${ALIQUOTA_IVA}% inclusa` : 'Prezzi IVA esclusa');

// Testo da incollare in un messaggio o una mail: una birra per blocco, un formato per riga.
export function testoListino(l, righe, data) {
  const out = [`${l.nome.toUpperCase()} · listino del ${data}`, testoIva(l)];
  if (l.note?.trim()) out.push(l.note.trim());
  let birra = '';
  for (const r of righeDaCopiare(righe)) {
    if (r.birra !== birra) { out.push('', [r.birra, infoBirra(r)].filter(Boolean).join(' · ')); birra = r.birra; }
    out.push(`  ${r.formato}: ${euro(r.prezzo)}`);
  }
  return out.join('\n');
}
// Tabella da incollare in Excel o Numbers (colonne separate da tabulazione, numeri all'italiana)
export function tabellaListino(l, righe) {
  return [['Birra', 'Stile', 'Grado % vol', 'Formato', `Prezzo € (${l.iva ? 'IVA inclusa' : 'IVA esclusa'})`].join('\t'),
    ...righeDaCopiare(righe).map(r => [r.birra, r.stile || '', r.abv > 0 ? numIT1(r.abv) : '', r.formato, soldi(r.prezzo)].join('\t'))].join('\n');
}

// ---------- prezzi dalle fatture ----------
// Il listino di un cliente è quello scelto per il suo link ordini (cliente.portale.listino).
export const listinoCliente = scheda => scheda?.portale?.listino || '';
const cent = n => Math.round(n * 100) / 100;

// Prezzi fatturati per prodotto: righe [{ prodotto, prezzo (al pezzo, IVA esclusa), pezzi, data }]
// → Map chiave → { prezzo (il più frequente; a parità il più recente), volte, ultimo (data), pezzi }
export function prezziFatturati(righe) {
  const per = new Map();
  for (const r of righe) {
    if (!r.prodotto || !(r.prezzo > 0)) continue;
    const p = cent(r.prezzo);
    const x = per.get(r.prodotto) || { conteggi: new Map(), ultimo: '', pezzi: 0, volte: 0 };
    const c = x.conteggi.get(p) || { n: 0, data: '' };
    c.n++; if ((r.data || '') > c.data) c.data = r.data || '';
    x.conteggi.set(p, c);
    x.volte++; x.pezzi += Number(r.pezzi) || 0;
    if ((r.data || '') > x.ultimo) x.ultimo = r.data || '';
    per.set(r.prodotto, x);
  }
  const out = new Map();
  for (const [chiave, x] of per) {
    const [prezzo] = [...x.conteggi].sort((a, b) => b[1].n - a[1].n || b[1].data.localeCompare(a[1].data))[0];
    out.set(chiave, { prezzo, volte: x.volte, ultimo: x.ultimo, pezzi: x.pezzi, diversi: x.conteggi.size });
  }
  return out;
}

const mediana = v => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Listino di un cliente dai suoi prezzi fatturati: ricarico su Alpha (mediano, per fusti e lattine) e,
// dove il cliente paga diverso dal ricarico, il prezzo fisso. Al centesimo e IVA esclusa, come in fattura.
// fatturati: Map da prezziFatturati; alpha: il listino Alpha. → { listino (senza id), senzaAlpha: [chiavi] }
export function listinoDaFatturati(nome, fatturati, alpha) {
  const base = alpha.prezzi || {};
  const conAlpha = [...fatturati].filter(([k]) => prezzoBase(base, k));
  const senzaAlpha = [...fatturati.keys()].filter(k => !prezzoBase(base, k));
  const perTipo = new Map();
  for (const [k, f] of conAlpha) {
    const tipo = k.split('|')[1];
    perTipo.set(tipo, [...(perTipo.get(tipo) || []), (f.prezzo / prezzoBase(base, k) - 1) * 100]);
  }
  const tondo = n => Math.round(n * 10) / 10;
  const tutti = [...perTipo.values()].flat();
  const ricarico = tutti.length ? tondo(mediana(tutti)) : 0;
  const ricarichi = {};
  for (const [tipo, v] of perTipo) { const r = tondo(mediana(v)); if (r !== ricarico) ricarichi[tipo] = r; }
  const l = { ...nuovoListino('', nome), ricarico, ricarichi, arrotonda: 0, prodotti: 'tutti', note: '' };
  delete l.id;
  const fissi = {};
  for (const [k, f] of conAlpha) {
    const calcolato = prezzoListino(prezzoBase(base, k), l, k.split('|')[1]);
    if (Math.abs(calcolato - f.prezzo) >= 0.01) fissi[k] = f.prezzo;
  }
  // i prodotti di Alpha che il cliente non ha mai comprato restano nel listino, con il ricarico
  return { listino: { ...l, fissi }, senzaAlpha };
}

// Righe vendute a un prezzo diverso dal listino del cliente.
// movimenti: movbirra; schede: Map idCliente → cliente; prezziDi(idListino) → { prezzi: Map, iva } (prezziListino del carrello)
// → [{ movimento, riga, cliente, listino (id), atteso (IVA esclusa), prezzo, scarto (%) }], i più recenti prima
export function fuoriListino(movimenti, schede, idCliente, prezziDi, { dal = '', tolleranza = 0.5 } = {}) {
  const out = [];
  const cache = new Map();
  for (const m of movimenti) {
    if (m.eliminato || m.verso !== 'scarico' || m.motivo !== 'vendita' || !m.cliente || (dal && m.data < dal)) continue;
    const id = listinoCliente(schede.get(idCliente(m.cliente)));
    if (!id) continue;
    if (!cache.has(id)) cache.set(id, prezziDi(id));
    const { prezzi, iva } = cache.get(id);
    for (const r of m.righe || []) {
      const lordo = prezzi.get(r.prodotto);
      if (!(r.prezzo > 0) || !lordo) continue;
      const atteso = iva ? cent(lordo / (1 + ALIQUOTA_IVA / 100)) : lordo;
      const scarto = (r.prezzo / atteso - 1) * 100;
      if (Math.abs(r.prezzo - atteso) >= 0.01 && Math.abs(scarto) >= tolleranza) out.push({ movimento: m, riga: r, cliente: m.cliente, listino: id, atteso, prezzo: r.prezzo, scarto });
    }
  }
  return out.sort((a, b) => (b.movimento.data || '').localeCompare(a.movimento.data || ''));
}

// ---------- margine ----------
// Impostazioni dei listini: margine minimo (%) e costo della confezione per tipo (lattina vuota, tappo, etichetta…)
export const ID_IMPOSTAZIONI_LISTINI = 'impostazione-listini';
export const impostazioniListiniDa = rec => ({ margineMin: 30, confezione: {}, ...(rec && !rec.eliminato ? rec : {}), id: ID_IMPOSTAZIONI_LISTINI, tipo: 'impostazione' });
// Costo di un pezzo: birra (costo al litro dell'ultimo lotto × litri) + confezione. null se manca il costo della birra.
export function costoPezzo(r, costiLitro, imp) {
  const c = costiLitro.get(r.birra);
  if (!c || !(r.litri > 0)) return null;
  return c.perLitro * r.litri + (Number(imp.confezione?.[r.tipo]) || 0);
}
// Margine % sul prezzo (IVA esclusa): (prezzo − costo) / prezzo
export function margine(prezzo, iva, costo) {
  if (!(prezzo > 0) || costo === null || costo === undefined) return null;
  const netto = iva ? prezzo / (1 + ALIQUOTA_IVA / 100) : prezzo;
  return (netto - costo) / netto * 100;
}
