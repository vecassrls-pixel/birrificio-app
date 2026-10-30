// Vendite dell'eshop (Shopify) con gli importi, per l'unghia Eshop in Economia (Romain 2026-10-30).
// Senza DOM: lo usano la pagina (js/vista-eshop.js) e l'import notturno (netlify/lib/automazioni.mjs).
//
// Record venditaeshop, id 'venditaeshop-<id ordine Shopify>', riscritto a ogni aggiornamento (rimborsi compresi):
//   { numero, ordinato, spedito (data o ''), stato, pagamento, canale, valuta,
//     totale (attuale, dopo sconti e rimborsi), lordo (totale dell'ordine all'acquisto), spedizione, sconti, rimborsato,
//     righe: [{ codice, nome, qta, importo }] }
// Lo scarico del magazzino birra resta il movbirra con rifEsterno 'shopify:<id>' (import in Birra).

export const idVendita = idOrdine => `venditaeshop-${idOrdine}`;

const n = v => Number(v) || 0;
const tondo = v => Math.round(n(v) * 100) / 100;

// ordine nel formato di netlify/lib/shopify.mjs → record venditaeshop
export function venditaDaOrdine(d) {
  return {
    id: idVendita(d.id), tipo: 'venditaeshop', rifEsterno: `shopify:${d.id}`,
    numero: d.numero, ordinato: d.ordinato || d.data, spedito: d.spedito ? d.data : '', stato: d.stato || '', pagamento: d.pagamento || '',
    canale: d.canale || '', valuta: d.valuta || 'EUR',
    totale: tondo(d.totale), lordo: tondo(d.lordo), spedizione: tondo(d.spedizione), sconti: tondo(d.sconti), rimborsato: tondo(d.rimborsato),
    righe: (d.righe || []).map(r => ({ codice: r.codice || '', nome: r.nome || '', qta: n(r.qta), importo: tondo(r.importo) })),
  };
}

// stessi dati, senza i campi di servizio: per non riscrivere record uguali
export function uguale(a, b) {
  if (!a || a.eliminato) return false;
  const pulito = ({ aggiornato: _a, daSincronizzare: _d, eliminato: _e, ...r }) => JSON.stringify(r);
  return pulito(a) === pulito(b);
}

export const vendite = record => record.filter(v => !v.eliminato && v.ordinato);

// Totali di un elenco di vendite
export function totaliEshop(elenco) {
  const t = { ordini: elenco.length, totale: 0, lordo: 0, spedizione: 0, sconti: 0, rimborsato: 0, pezzi: 0 };
  for (const v of elenco) {
    for (const k of ['totale', 'lordo', 'spedizione', 'sconti', 'rimborsato']) t[k] += n(v[k]);
    t.pezzi += (v.righe || []).reduce((s, r) => s + n(r.qta), 0);
  }
  t.medio = t.ordini ? t.totale / t.ordini : 0;
  return t;
}

// Per mese dell'anno: [{ mese 'AAAA-MM', ...totali }] dei 12 mesi
export function perMese(elenco, anno) {
  return Array.from({ length: 12 }, (_, i) => {
    const mese = `${anno}-${String(i + 1).padStart(2, '0')}`;
    return { mese, ...totaliEshop(elenco.filter(v => v.ordinato.startsWith(mese))) };
  });
}

// Da che giorno chiedere a Shopify: una settimana prima dell'ultimo ordine salvato (rimborsi e spedizioni recenti),
// altrimenti dall'inizio dell'anno
export function partenzaEshop(elenco, oggi, addGiorni) {
  const ultimo = elenco.map(v => v.ordinato).sort().pop();
  return ultimo ? addGiorni(ultimo, -7) : `${oggi.slice(0, 4)}-01-01`;
}

// Stato del magazzino per la vendita: scaricato, nessuna birra, da scaricare
// (inizio = giorno da cui conta il magazzino birra: gli ordini spediti prima non vanno scaricati)
export function statoMagazzino(v, movPerRif, inizio = '') {
  const m = movPerRif.get(v.rifEsterno);
  if (!m) return !v.spedito ? 'da-spedire' : inizio && v.spedito < inizio ? 'prima' : 'da-scaricare';
  return m.ignorato ? 'nessuna-birra' : 'scaricato';
}
