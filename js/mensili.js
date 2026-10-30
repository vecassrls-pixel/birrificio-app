// Pagamenti mensili scritti a mano (Romain 2026-10-28): Accise, Stipendi, F24, Affitti. Ogni mese si scrive il totale
// da pagare, poi si segna pagato e quando.
//   accisa | stipendio | f24 | affitto { id: '<tipo>-AAAA-MM', tipo, mese: 'AAAA-MM', importo, pagato, dataPagamento, note }
//   impostazione { id: 'impostazione-<tipo>', tipo: 'impostazione', giorno, meseDopo, importo?, dal? } scelte nella pagina
// L'affitto è fisso (Romain 2026-10-30): dal mese "dal" a quello di oggi i mesi senza record valgono l'importo
// predefinito (612 €, scadenza il 18 dello stesso mese), così basta spuntare "Pagato".
// Un record per mese (id fisso, così non si doppia).

export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// Scadenza predefinita: accise il 16 del mese dopo (versamento mensile), F24 il 16 dello stesso mese
// (il mese è quello del versamento), stipendi il 15 del mese dopo. Si cambia dalla pagina.
export const TIPI_MENSILI = {
  accisa: { percorso: 'accise', titolo: 'Accise', voce: 'accise', scadenza: { giorno: 16, meseDopo: true } },
  stipendio: { percorso: 'stipendi', titolo: 'Stipendi', voce: 'stipendi', scadenza: { giorno: 15, meseDopo: true } },
  f24: { percorso: 'f24', titolo: 'F24', voce: 'F24', scadenza: { giorno: 16, meseDopo: false } },
  affitto: { percorso: 'affitti', titolo: 'Affitti', voce: 'affitto', scadenza: { giorno: 18, meseDopo: false }, fisso: { importo: 612, dal: '2026-10' } },
};

// Importo fisso e mese di partenza (solo i tipi con "fisso"), con le scelte salvate nella pagina
export function fissoDi(tipo, imp) {
  const f = TIPI_MENSILI[tipo]?.fisso;
  if (!f) return null;
  const v = imp && !imp.eliminato ? imp : {};
  return { importo: v.importo != null && v.importo !== '' ? Number(v.importo) : f.importo, dal: /^\d{4}-\d{2}$/.test(v.dal || '') ? v.dal : f.dal };
}

// Record del tipo più i mesi fissi non ancora salvati (virtuale: true) fino al mese di oggi.
// Anche il Cashflow le legge da qui per avere gli affitti tra le uscite.
export function righeMensili(tipo, righe, imp, oggi) {
  const f = fissoDi(tipo, imp);
  const vive = righe.filter(r => !r.eliminato);
  if (!f || !(f.importo > 0)) return vive;
  const ci = new Set(vive.map(r => r.mese));
  const fine = oggi.slice(0, 7), extra = [];
  for (let [a, m] = f.dal.split('-').map(Number); `${a}-${String(m).padStart(2, '0')}` <= fine; m === 12 ? (a++, m = 1) : m++) {
    const mese = `${a}-${String(m).padStart(2, '0')}`;
    if (!ci.has(mese)) extra.push({ id: idMensile(tipo, mese), tipo, mese, importo: f.importo, pagato: false, virtuale: true });
  }
  return [...vive, ...extra];
}

export const idMensile = (tipo, mese) => `${tipo}-${mese}`;
export const nomeMese = mese => `${MESI[Number(mese.slice(5, 7)) - 1]} ${mese.slice(0, 4)}`;

// 'AAAA-MM' → data di scadenza, con il giorno limitato alla fine del mese
export function scadenzaMese(mese, { giorno = 16, meseDopo = true } = {}) {
  let [a, m] = mese.split('-').map(Number);
  if (meseDopo) { m += 1; if (m === 13) { m = 1; a += 1; } }
  const g = Math.min(Math.max(1, Number(giorno) || 1), new Date(a, m, 0).getDate());
  return `${a}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

const val = r => Number(r?.importo) || 0;
export const conImporto = r => !!r && !r.eliminato && r.importo != null && r.importo !== '';

// Riepilogo di un anno: totale, media sui mesi inseriti, pagato / da pagare, scaduti, confronto con l'anno prima
export function riepilogoMensile(righe, anno, oggi, scadenza) {
  const delAnno = righe.filter(r => conImporto(r) && r.mese?.startsWith(anno));
  const totale = delAnno.reduce((t, r) => t + val(r), 0);
  const pagate = delAnno.filter(r => r.pagato), aperte = delAnno.filter(r => !r.pagato);
  const scadute = aperte.filter(r => scadenzaMese(r.mese, scadenza) < oggi);
  // anno prima negli stessi mesi inseriti quest'anno (confronto alla pari a metà anno)
  const mesiQui = new Set(delAnno.map(r => r.mese.slice(5)));
  const prima = righe.filter(r => conImporto(r) && r.mese?.startsWith(String(Number(anno) - 1)));
  const primaStessiMesi = prima.filter(r => mesiQui.has(r.mese.slice(5))).reduce((t, r) => t + val(r), 0);
  const maxMese = delAnno.reduce((m, r) => (!m || val(r) > val(m) ? r : m), null);
  return {
    totale, mesi: delAnno.length, media: delAnno.length ? totale / delAnno.length : 0,
    pagato: pagate.reduce((t, r) => t + val(r), 0), daPagare: aperte.reduce((t, r) => t + val(r), 0), nAperte: aperte.length,
    scadute, primaTotale: prima.reduce((t, r) => t + val(r), 0), primaStessiMesi, haPrima: prima.length > 0, maxMese,
  };
}

// Da pagare di tutti gli anni (anche quelli prima), per la vista Economia
export function apertiMensili(righe, oggi, scadenza) {
  const aperte = righe.filter(r => conImporto(r) && !r.pagato);
  return { n: aperte.length, importo: aperte.reduce((t, r) => t + val(r), 0), scadute: aperte.filter(r => scadenzaMese(r.mese, scadenza) < oggi).length };
}

// Media degli ultimi 12 mesi inseriti fino al mese di oggi compreso (anche a cavallo d'anno)
export function mediaUltimi12(righe, oggi) {
  const fine = oggi.slice(0, 7);
  const [a, m] = fine.split('-').map(Number);
  const inizio = m === 12 ? `${a}-01` : `${a - 1}-${String(m + 1).padStart(2, '0')}`;
  const r = righe.filter(x => conImporto(x) && x.mese >= inizio && x.mese <= fine);
  return { media: r.length ? r.reduce((t, x) => t + val(x), 0) / r.length : 0, mesi: r.length };
}
