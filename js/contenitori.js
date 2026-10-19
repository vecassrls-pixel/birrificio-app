// Magazzino contenitori vuoti (lattine, fusti a perdere, coperchi, cartoni): giacenze calcolate, mai scritte a mano.
// giacenza = ultimo inventario del contenitore + carichi (acquisti, rientri) − scarichi (scarti, ceduti)
//            − confezionamenti delle cotte, dopo quella data.
// Senza inventario si conta dal giorno in cui il contenitore è stato creato: lo storico delle cotte
// non deve consumare lattine che non sono mai state caricate.
//
// Record nell'archivio:
//   contenitore           { nome, categoria: 'lattina'|'fusto'|'altro', formati, ogni, pezziConfezione, scortaMin, note, creato }
//                         formati = formati del Confezionamento delle cotte che lo consumano ("lattina/bottiglia|0.33", "fusto|25"):
//                         il polykeg 24 L si riempie a 25 L, quindi consuma "fusto|25" e "fusto|24". [] = solo movimenti a mano.
//                         ogni = 1 contenitore ogni N pezzi confezionati (cartone da 12 = 12).
//                         Se due lattine/fusti consumano lo stesso formato (polykeg 24 L con e senza sacca), la riga del
//                         Confezionamento dice quale con confezionato[i].contenitore (id); senza, il primo. Gli "altro"
//                         (coperchi, cartoni) si consumano sempre tutti.
//                         pezziConfezione = pezzi per bancale/confezione d'acquisto (facoltativo, aiuta a contare).
//   movcontenitore        { verso: 'carico'|'scarico', data, motivo, fornitore, documento, note, righe: [{ contenitoreId, pezzi }] }
//   inventariocontenitori { data, righe: [{ contenitoreId, pezzi }] }

import { gruppoCotta, numIT } from './dominio.js';

export const CATEGORIE_CONT = { lattina: 'Lattine', fusto: 'Fusti', altro: 'Altro (coperchi, cartoni…)' };
export const MOTIVI_CARICO = { acquisto: 'Acquisto', rientro: 'Rientro vuoti', rettifica: 'Rettifica', altro: 'Altro' };
export const MOTIVI_SCARICO = { scarto: 'Scarto / danneggiati', ceduti: 'Ceduti', rettifica: 'Rettifica', altro: 'Altro' };
export const nomeMotivoCont = m => (m.verso === 'carico' ? MOTIVI_CARICO : MOTIVI_SCARICO)[m.motivo] || (m.verso === 'carico' ? 'Carico' : 'Scarico');
// formati proposti anche se nessuna cotta li ha ancora (gli stessi pulsanti del Confezionamento)
export const FORMATI_BASE = ['lattina/bottiglia|0.33', 'fusto|24', 'fusto|25', 'fusto|20', 'fusto|12'];

export const chiaveFormato = (tipo, litri) => `${tipo || 'fusto'}|${Number(litri) || 0}`;
export function nomeFormato(chiave) {
  const [tipo, l] = String(chiave || '').split('|');
  const litri = Number(l) || 0;
  return `${tipo === 'fusto' ? 'Fusti' : 'Lattine'} ${numIT(litri, litri < 1 ? 2 : 0)} L`;
}
export const categoriaDaFormato = chiave => (String(chiave).startsWith('fusto') ? 'fusto' : 'lattina');
export const formatiDi = k => k.formati || (k.formato ? [k.formato] : []);
const ordine = (a, b) => String(a.creato || '').localeCompare(String(b.creato || '')) || a.nome.localeCompare(b.nome, 'it', { numeric: true });
// lattine/fusti che si possono usare per una riga del Confezionamento (più di uno: si sceglie nella riga)
export function contenitoriPerRiga(contenitori, tipo, litri) {
  const f = chiaveFormato(tipo, litri);
  return contenitori.filter(k => !k.eliminato && k.categoria !== 'altro' && formatiDi(k).includes(f)).sort(ordine);
}

// Formati usati nei confezionamenti delle cotte, più quelli di base
export function formatiUsati(cotte) {
  const s = new Set(FORMATI_BASE);
  for (const c of cotte) if (!c.eliminato) for (const r of c.confezionato || []) if (Number(r.litri) > 0) s.add(chiaveFormato(r.tipo, r.litri));
  return [...s].sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
}

// Contenitori consumati dai confezionamenti delle cotte (le cotte doppie hanno il confezionamento sulla prima del gruppo)
export function usiConfezionamento(cotte, contenitori) {
  const out = [];
  if (!contenitori.some(k => !k.eliminato && formatiDi(k).length)) return out;
  const accessori = contenitori.filter(k => !k.eliminato && k.categoria === 'altro');
  for (const c of cotte) {
    if (c.eliminato || !(c.confezionato || []).length) continue;
    const g = gruppoCotta(c, cotte);
    if (g[0].id !== c.id && (g[0].confezionato || []).length) continue;
    for (const r of c.confezionato) {
      const data = r.data || c.fine || c.data || '';
      const pezzi = Number(r.pezzi);
      if (!(pezzi > 0) || !(Number(r.litri) > 0) || !data) continue;
      const f = chiaveFormato(r.tipo, r.litri);
      const principali = contenitoriPerRiga(contenitori, r.tipo, r.litri);
      const scelto = principali.find(k => k.id === r.contenitore) || principali[0];
      for (const k of [...(scelto ? [scelto] : []), ...accessori.filter(k => formatiDi(k).includes(f))]) {
        out.push({ contenitoreId: k.id, data, pezzi: Math.ceil(pezzi / (Number(k.ogni) > 1 ? Number(k.ogni) : 1)), confezionati: pezzi, cotta: c });
      }
    }
  }
  return out;
}

// Tutti i movimenti di un contenitore in ordine di data: inventari, carichi, scarichi, confezionamenti.
// Ogni riga ha pezzi (+ entra, − esce; per l'inventario il valore contato) e il saldo dopo la riga.
// Le righe prima della creazione (senza un inventario prima) e quelle future non toccano il saldo.
export function registroContenitore(k, { movimenti, inventari, usi }, oggi) {
  const righe = [];
  for (const inv of inventari) {
    if (inv.eliminato || !inv.data) continue;
    const r = (inv.righe || []).find(x => x.contenitoreId === k.id && x.pezzi !== null && x.pezzi !== '' && Number.isFinite(Number(x.pezzi)));
    if (r) righe.push({ tipo: 'inventario', data: inv.data, pezzi: Number(r.pezzi), rec: inv });
  }
  for (const m of movimenti) {
    if (m.eliminato || !m.data) continue;
    const tot = (m.righe || []).filter(x => x.contenitoreId === k.id).reduce((t, x) => t + (Number(x.pezzi) || 0), 0);
    if (tot) righe.push({ tipo: m.verso === 'carico' ? 'carico' : 'scarico', data: m.data, pezzi: m.verso === 'carico' ? tot : -tot, rec: m });
  }
  for (const x of usi) if (x.contenitoreId === k.id) righe.push({ tipo: 'confezionamento', data: x.data, pezzi: -x.pezzi, uso: x });
  // a parità di giorno: l'inventario vale a fine giornata
  righe.sort((a, b) => a.data.localeCompare(b.data) || (a.tipo === 'inventario') - (b.tipo === 'inventario'));
  const inizio = k.creato || '';
  let saldo = 0, contato = false;
  for (const r of righe) {
    r.conta = r.data <= oggi && (contato || r.tipo === 'inventario' || r.data >= inizio);
    if (!r.conta) { r.saldo = null; continue; }
    if (r.tipo === 'inventario') { r.differenza = r.pezzi - saldo; saldo = r.pezzi; contato = true; } else saldo += r.pezzi;
    r.saldo = saldo;
  }
  return righe;
}

const GIORNI_CONSUMO = 90;
// Giacenza, consumo degli ultimi 90 giorni e copertura (giorni) di ogni contenitore. Map id → dati.
export function giacenzeContenitori({ contenitori, movimenti, inventari, cotte }, oggi) {
  const usi = usiConfezionamento(cotte, contenitori);
  const da = new Date(Date.parse(`${oggi}T12:00:00Z`) - GIORNI_CONSUMO * 864e5).toISOString().slice(0, 10);
  const out = new Map();
  for (const k of contenitori) {
    if (k.eliminato) continue;
    const registro = registroContenitore(k, { movimenti, inventari, usi }, oggi);
    const contate = registro.filter(r => r.conta);
    const giacenza = contate.length ? contate.at(-1).saldo : 0;
    const consumo = registro.filter(r => r.tipo === 'confezionamento' && r.data > da && r.data <= oggi).reduce((t, r) => t - r.pezzi, 0);
    const alGiorno = consumo / GIORNI_CONSUMO;
    const ultimoInv = contate.filter(r => r.tipo === 'inventario').at(-1)?.data || null;
    out.set(k.id, {
      contenitore: k, giacenza, consumo, registro, ultimoInventario: ultimoInv,
      giorni: alGiorno > 0 ? Math.max(0, Math.floor(giacenza / alGiorno)) : null,
      sottoScorta: Number(k.scortaMin) > 0 && giacenza < Number(k.scortaMin),
      confezioni: Number(k.pezziConfezione) > 0 ? giacenza / Number(k.pezziConfezione) : null,
    });
  }
  return out;
}

// Contenitori proposti la prima volta: quelli del birrificio (Romain 2026-10-19).
// I polykeg 24 L si riempiono a 25 L: consumano i fusti da 25 e da 24 L del Confezionamento.
export function contenitoriProposti() {
  return [
    { nome: 'Lattine 0,33 L', categoria: 'lattina', formati: ['lattina/bottiglia|0.33'], ogni: 1 },
    { nome: 'Polykeg 24 L', categoria: 'fusto', formati: ['fusto|25', 'fusto|24'], ogni: 1 },
    { nome: 'Polykeg 24 L con sacca', categoria: 'fusto', formati: ['fusto|25', 'fusto|24'], ogni: 1 },
    { nome: 'Polykeg 20 L', categoria: 'fusto', formati: ['fusto|20'], ogni: 1 },
    { nome: 'Polykeg 12 L', categoria: 'fusto', formati: ['fusto|12'], ogni: 1 },
  ];
}
