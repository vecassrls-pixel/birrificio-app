// Listini di vendita: dal prezzo base di ogni prodotto (birra + formato) un ricarico in % dà il prezzo del listino.
//
// Prezzo base = prezzo di vendita della pagina Costi (record 'impostazione-prezzi', vedi costi.js):
// quello della birra ("BIRRA|tipo|litri") o, se manca, quello del formato ("*|tipo|litri").
// Così listini, ricavi e margini partono dagli stessi numeri.
//
// Record nell'archivio:
//   listino { id: 'listino-…', tipo: 'listino', nome, ricarico (% sul prezzo base, anche negativo = sconto),
//             arrotonda (€, 0 = al centesimo; per eccesso), iva (true = prezzi IVA inclusa),
//             prodotti: 'magazzino' (solo con giacenza) | 'tutti', esclusi: [chiavi prodotto],
//             fissi: { chiave: € } (prezzo scritto a mano, vince sul calcolo), note }

import { daChiave, nomeFormato } from './birra.js';

export const ALIQUOTA_IVA = 22;
export const ARROTONDA = [[0, 'Al centesimo'], [0.05, '0,05 €'], [0.1, '0,10 €'], [0.5, '0,50 €'], [1, '1 €']];

export const nuovoListino = (id, nome) => ({
  id, tipo: 'listino', nome, ricarico: 30, arrotonda: 0.1, iva: false, prodotti: 'magazzino', esclusi: [], fissi: {}, note: '',
});
export const listinoDa = rec => ({ ...nuovoListino(rec.id, rec.nome || 'Listino'), ...rec, esclusi: rec.esclusi || [], fissi: rec.fissi || {} });

const chiaveFormato = p => `*|${p.tipo}|${p.litri}`;
export function prezzoBase(vendita, chiave) {
  const v = vendita[chiave] ?? vendita[chiaveFormato(daChiave(chiave))];
  return Number(v) > 0 ? Number(v) : null;
}
// per eccesso al passo scelto (0,10 € → 4,32 diventa 4,40); i centesimi sempre
export function arrotonda(x, passo) {
  const cent = Math.round(x * 100) / 100;
  if (!(passo > 0)) return cent;
  return Math.round(Math.ceil(cent / passo - 1e-9) * passo * 100) / 100;
}
export function prezzoListino(base, l) {
  if (!(base > 0)) return null;
  const netto = base * (1 + (Number(l.ricarico) || 0) / 100);
  return arrotonda(l.iva ? netto * (1 + ALIQUOTA_IVA / 100) : netto, Number(l.arrotonda) || 0);
}

// Righe del listino. giacenze: Map chiave → { giacenza } (da giacenzeBirra), chiavi: tutti i prodotti conosciuti.
export function righeListino(l, chiavi, giacenze, vendita) {
  const esclusi = new Set(l.esclusi);
  return chiavi
    .map(chiave => {
      const p = daChiave(chiave);
      const giacenza = giacenze.get(chiave)?.giacenza ?? 0;
      const base = prezzoBase(vendita, chiave);
      const calcolato = prezzoListino(base, l);
      const fisso = Number(l.fissi[chiave]) > 0 ? Number(l.fissi[chiave]) : null;
      const prezzo = fisso ?? calcolato;
      return { ...p, formato: nomeFormato(p.tipo, p.litri), giacenza, base, baseBirra: vendita[chiave] ?? null, calcolato, fisso, prezzo, escluso: esclusi.has(chiave), alLitro: prezzo && p.litri ? prezzo / p.litri : null };
    })
    .filter(r => l.prodotti === 'tutti' || r.giacenza > 0)
    .sort((a, b) => a.birra.localeCompare(b.birra, 'it') || a.tipo.localeCompare(b.tipo) || b.litri - a.litri);
}
// righe che finiscono nel testo copiato
export const righeDaCopiare = righe => righe.filter(r => !r.escluso && r.prezzo);

export const soldi = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = n => `€ ${soldi(n)}`;
const testoIva = l => (l.iva ? `Prezzi IVA ${ALIQUOTA_IVA}% inclusa` : 'Prezzi IVA esclusa');

// Testo da incollare in un messaggio o una mail: una birra per blocco, un formato per riga.
export function testoListino(l, righe, data) {
  const out = [`${l.nome.toUpperCase()} · listino del ${data}`, testoIva(l)];
  if (l.note?.trim()) out.push(l.note.trim());
  let birra = '';
  for (const r of righeDaCopiare(righe)) {
    if (r.birra !== birra) { out.push('', r.birra); birra = r.birra; }
    out.push(`  ${r.formato}: ${euro(r.prezzo)}`);
  }
  return out.join('\n');
}
// Tabella da incollare in Excel o Numbers (colonne separate da tabulazione, numeri all'italiana)
export function tabellaListino(l, righe) {
  return [['Birra', 'Formato', `Prezzo € (${l.iva ? 'IVA inclusa' : 'IVA esclusa'})`].join('\t'),
    ...righeDaCopiare(righe).map(r => [r.birra, r.formato, soldi(r.prezzo)].join('\t'))].join('\n');
}
