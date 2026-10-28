// Accise (Romain 2026-10-28): ogni mese si scrive a mano il totale da pagare, poi si segna pagato e quando.
//   accisa { id: 'accisa-AAAA-MM', tipo: 'accisa', mese: 'AAAA-MM', importo, pagato, dataPagamento, note }
// Un record per mese (id fisso, così non si doppia). Scadenza: il 16 del mese dopo (versamento mensile).

export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const idAccisa = mese => `accisa-${mese}`;
export const nomeMese = mese => `${MESI[Number(mese.slice(5, 7)) - 1]} ${mese.slice(0, 4)}`;

// 'AAAA-MM' → data di scadenza 'AAAA-MM-16' del mese dopo
export function scadenzaAccisa(mese) {
  const [a, m] = mese.split('-').map(Number);
  return m === 12 ? `${a + 1}-01-16` : `${a}-${String(m + 1).padStart(2, '0')}-16`;
}

const val = r => Number(r?.importo) || 0;
const conImporto = r => r && !r.eliminato && r.importo != null && r.importo !== '';

// Riepilogo di un anno: totale, media sui mesi inseriti, pagato / da pagare, scaduti, confronto con l'anno prima
export function riepilogoAccise(accise, anno, oggi) {
  const delAnno = accise.filter(r => conImporto(r) && r.mese?.startsWith(anno));
  const totale = delAnno.reduce((t, r) => t + val(r), 0);
  const pagate = delAnno.filter(r => r.pagato), aperte = delAnno.filter(r => !r.pagato);
  const scadute = aperte.filter(r => scadenzaAccisa(r.mese) < oggi);
  // anno prima negli stessi mesi inseriti quest'anno (confronto alla pari a metà anno)
  const mesiQui = new Set(delAnno.map(r => r.mese.slice(5)));
  const prima = accise.filter(r => conImporto(r) && r.mese?.startsWith(String(Number(anno) - 1)));
  const primaStessiMesi = prima.filter(r => mesiQui.has(r.mese.slice(5))).reduce((t, r) => t + val(r), 0);
  const maxMese = delAnno.reduce((m, r) => (!m || val(r) > val(m) ? r : m), null);
  return {
    totale, mesi: delAnno.length, media: delAnno.length ? totale / delAnno.length : 0,
    pagato: pagate.reduce((t, r) => t + val(r), 0), daPagare: aperte.reduce((t, r) => t + val(r), 0), nAperte: aperte.length,
    scadute, primaTotale: prima.reduce((t, r) => t + val(r), 0), primaStessiMesi, haPrima: prima.length > 0, maxMese,
  };
}

// Media degli ultimi 12 mesi inseriti fino al mese di oggi compreso (anche a cavallo d'anno)
export function mediaUltimi12(accise, oggi) {
  const fine = oggi.slice(0, 7);
  const [a, m] = fine.split('-').map(Number);
  const inizio = m === 12 ? `${a}-01` : `${a - 1}-${String(m + 1).padStart(2, '0')}`;
  const r = accise.filter(x => conImporto(x) && x.mese >= inizio && x.mese <= fine);
  return { media: r.length ? r.reduce((t, x) => t + val(x), 0) / r.length : 0, mesi: r.length };
}
