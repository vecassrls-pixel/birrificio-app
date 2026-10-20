// Magazzino contenitori vuoti (lattine, fusti a perdere, coperchi, cartoni): giacenze calcolate, mai scritte a mano.
// giacenza = ultimo inventario del contenitore + carichi (acquisti, rientri) − scarichi (scarti, ceduti)
//            − confezionamenti delle cotte, dopo quella data.
// Senza inventario i confezionamenti contano dal giorno in cui il contenitore è stato creato: lo storico
// delle cotte non deve consumare lattine che non sono mai state caricate. Carichi e scarichi contano sempre
// (anche una fattura arrivata prima di creare il contenitore).
//
// Record nell'archivio:
//   contenitore           { nome, categoria: 'lattina'|'fusto'|'altro', formati, ogni, pezziConfezione, perCotta, perCottaSacca, note, creato }
//                         perCotta / perCottaSacca = pezzi che servono per ogni cotta da confezionare (vedi fabbisognoContenitori)
//                         formati = formati del Confezionamento delle cotte che lo consumano ("lattina/bottiglia|0.33", "fusto|25"):
//                         il polykeg 24 L si riempie a 25 L, quindi consuma "fusto|25" e "fusto|24". [] = solo movimenti a mano.
//                         ogni = 1 contenitore ogni N pezzi confezionati (cartone da 12 = 12).
//                         Se due lattine/fusti consumano lo stesso formato (polykeg 24 L con e senza sacca), la riga del
//                         Confezionamento dice quale con confezionato[i].contenitore (id); senza, il primo. Gli "altro"
//                         (coperchi, cartoni) si consumano sempre tutti.
//                         pezziConfezione = pezzi per bancale/confezione d'acquisto (facoltativo, aiuta a contare).
//   movcontenitore        { verso: 'carico'|'scarico', data, motivo, fornitore, documento, note, origine, rifEsterno,
//                           righe: [{ contenitoreId, pezzi, lotto }] }
//   inventariocontenitori { data, righe: [{ contenitoreId, pezzi, lotto }] }
//
// Lotti (lotto del fornitore delle lattine/fusti, per la rintracciabilità HACCP): entrano con i carichi;
// confezionamenti e scarichi senza lotto prendono dal lotto arrivato prima (FIFO), quindi ogni confezionamento
// sa da quali lotti di vuoti viene. Un inventario con il lotto dice che i pezzi contati sono tutti di quel lotto;
// senza lotto restano i lotti arrivati per ultimi, fino al numero contato.

import { addGiorni, fineCotta, gruppoCotta, numIT } from './dominio.js';

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
// I confezionamenti prima della creazione (senza un inventario prima) e le righe future non toccano il saldo.
export function registroContenitore(k, { movimenti, inventari, usi }, oggi) {
  const righe = [];
  for (const inv of inventari) {
    if (inv.eliminato || !inv.data) continue;
    const r = (inv.righe || []).find(x => x.contenitoreId === k.id && x.pezzi !== null && x.pezzi !== '' && Number.isFinite(Number(x.pezzi)));
    if (r) righe.push({ tipo: 'inventario', data: inv.data, pezzi: Number(r.pezzi), lotto: String(r.lotto || '').trim(), rec: inv });
  }
  for (const m of movimenti) {
    if (m.eliminato || !m.data) continue;
    const parti = (m.righe || []).filter(x => x.contenitoreId === k.id && Number(x.pezzi) > 0).map(x => ({ pezzi: Number(x.pezzi), lotto: String(x.lotto || '').trim() }));
    const tot = parti.reduce((t, x) => t + x.pezzi, 0);
    if (tot) righe.push({ tipo: m.verso === 'carico' ? 'carico' : 'scarico', data: m.data, pezzi: m.verso === 'carico' ? tot : -tot, parti, rec: m });
  }
  for (const x of usi) if (x.contenitoreId === k.id) righe.push({ tipo: 'confezionamento', data: x.data, pezzi: -x.pezzi, uso: x });
  // a parità di giorno: l'inventario vale a fine giornata
  righe.sort((a, b) => a.data.localeCompare(b.data) || (a.tipo === 'inventario') - (b.tipo === 'inventario'));
  const inizio = k.creato || '';
  let saldo = 0, contato = false;
  let coda = []; // lotti in magazzino, dal più vecchio: { lotto, pezzi, data, rec }
  const prendi = (n, lotto) => {
    const presi = [];
    const da = (x, q) => { const v = Math.min(q, x.pezzi); x.pezzi -= v; if (v) presi.push({ lotto: x.lotto, pezzi: v, arrivo: x.data, rec: x.rec }); return q - v; };
    if (lotto) for (const x of coda.filter(y => y.lotto === lotto)) n = da(x, n);
    for (const x of coda) if (n > 0) n = da(x, n);
    if (n > 0) presi.push({ lotto: '', pezzi: n, arrivo: '', rec: null }); // più pezzi di quelli caricati
    coda = coda.filter(x => x.pezzi > 0);
    return presi;
  };
  for (const r of righe) {
    r.conta = r.data <= oggi && (contato || r.tipo !== 'confezionamento' || r.data >= inizio);
    if (!r.conta) { r.saldo = null; continue; }
    if (r.tipo === 'inventario') {
      r.differenza = r.pezzi - saldo; saldo = r.pezzi; contato = true;
      if (r.lotto) { const prima = coda.find(y => y.lotto === r.lotto); coda = r.pezzi > 0 ? [{ lotto: r.lotto, pezzi: r.pezzi, data: prima?.data || r.data, rec: prima?.rec || r.rec }] : []; }
      else {
        // restano i lotti arrivati per ultimi; quello che manca è senza lotto
        let resto = r.pezzi;
        const tenuti = [];
        for (const x of [...coda].reverse()) { if (resto <= 0) break; const v = Math.min(resto, x.pezzi); tenuti.unshift({ ...x, pezzi: v }); resto -= v; }
        if (resto > 0) tenuti.unshift({ lotto: '', pezzi: resto, data: r.data, rec: r.rec });
        coda = tenuti;
      }
    } else if (r.tipo === 'carico') {
      for (const x of r.parti) coda.push({ lotto: x.lotto, pezzi: x.pezzi, data: r.data, rec: r.rec });
      saldo += r.pezzi;
    } else {
      r.lotti = r.tipo === 'scarico' ? r.parti.flatMap(x => prendi(x.pezzi, x.lotto)) : prendi(-r.pezzi, '');
      saldo += r.pezzi;
    }
    r.saldo = saldo;
  }
  // lotti in magazzino oggi (stesso lotto unito)
  const lotti = [];
  for (const x of coda) {
    const l = lotti.find(y => y.lotto === x.lotto);
    if (l) l.pezzi += x.pezzi; else lotti.push({ lotto: x.lotto, pezzi: x.pezzi, arrivo: x.data, fornitore: x.rec?.fornitore || '', documento: x.rec?.documento || '' });
  }
  righe.lotti = lotti;
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
      contenitore: k, giacenza, consumo, registro, ultimoInventario: ultimoInv, lotti: registro.lotti,
      giorni: alGiorno > 0 ? Math.max(0, Math.floor(giacenza / alGiorno)) : null,
      confezioni: Number(k.pezziConfezione) > 0 ? giacenza / Number(k.pezziConfezione) : null,
    });
  }
  return out;
}

// Contenitori proposti la prima volta: quelli del birrificio (Romain 2026-10-19).
// I polykeg 24 L si riempiono a 25 L: consumano i fusti da 25 e da 24 L del Confezionamento.
export function contenitoriProposti() {
  return [
    { nome: 'Lattine 0,33 L', categoria: 'lattina', formati: ['lattina/bottiglia|0.33'], ogni: 1, perCotta: 800 },
    { nome: 'Polykeg 24 L', categoria: 'fusto', formati: ['fusto|25', 'fusto|24'], ogni: 1, perCotta: 30 },
    { nome: 'Polykeg 24 L con sacca', categoria: 'fusto', formati: ['fusto|25', 'fusto|24'], ogni: 1, perCottaSacca: 40 },
    { nome: 'Polykeg 20 L', categoria: 'fusto', formati: ['fusto|20'], ogni: 1 },
    { nome: 'Polykeg 12 L', categoria: 'fusto', formati: ['fusto|12'], ogni: 1 },
  ];
}

// ---------- fatture dei fornitori (Fatture in Cloud, documenti ricevuti) ----------
// Le righe di lattine e fusti vuoti si riconoscono:
//  - "sicure": codice o descrizione già confermati una volta (contenitore.codici [{ chiave, x }], x = pezzi per unità
//    della fattura, es. 1 bancale = 8.000 lattine). Queste il server le carica da solo nell'import notturno.
//  - "proposte": dalle parole (lattine 33 cl, keg/fusto 20 L, sacca, coperchi): si confermano nella pagina Contenitori.
export const chiaveRiga = r => String(r.codice || r.descrizione || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const UM_CONFEZIONE = /^(BAN|BANC|BANCALE|BANCALI|PAL|PALLET|CF|CONF|CRT|CARTONE|CT|SCATOLA|COLLO|COLLI)$/;

export function trovaContenitore(riga, contenitori) {
  const vivi = contenitori.filter(k => !k.eliminato);
  const ch = chiaveRiga(riga);
  if (ch) for (const k of vivi) {
    const c = (k.codici || []).find(x => x.chiave === ch);
    if (c) return c.ignora ? { ignora: true, sicuro: true } : { contenitore: k, x: Number(c.x) || 1, sicuro: true };
  }
  const d = ` ${String(riga.descrizione || '').toLowerCase().replace(/[^a-z0-9,.]+/g, ' ')} `;
  const conX = k => ({ contenitore: k, x: UM_CONFEZIONE.test(String(riga.um || '').toUpperCase()) && Number(k.pezziConfezione) > 0 ? Number(k.pezziConfezione) : 1, sicuro: false });
  if (/ (coperch|lid|lids|end|ends|tappi) /.test(d) || / coperch/.test(d)) {
    const k = vivi.find(x => x.categoria === 'altro' && /coperch|lid|end/i.test(x.nome));
    return k ? conX(k) : null;
  }
  if (/ (lattin|can |cans |lattine)/.test(d) && !/ candi/.test(d)) {
    const cl = d.match(/(?:^|[^0-9])(\d{2})\s*cl\b/) || d.match(/0[,.](\d{2})\b/);
    const litri = cl ? Number(cl[1]) / 100 : 0.33;
    const k = vivi.filter(x => x.categoria === 'lattina').find(x => formatiDi(x).includes(chiaveFormato('lattina/bottiglia', litri))) || vivi.find(x => x.categoria === 'lattina');
    return k ? conX(k) : null;
  }
  if (/ (keg|polykeg|fust|fusti|fusto|petainer|keykeg)/.test(d)) {
    const l = d.match(/(?:^|[^0-9,.])(\d{2})\s*(?:l|lt|litri)\b/);
    const litri = l ? Number(l[1]) : null;
    const sacca = / (sacca|bag|bib|inner)/.test(d);
    const fusti = vivi.filter(x => x.categoria === 'fusto');
    const perLitri = litri ? fusti.filter(x => formatiDi(x).some(f => Math.abs(Number(f.split('|')[1]) - litri) <= 1) || x.nome.includes(String(litri))) : fusti;
    // litri non trovati tra i contenitori: si propone comunque un fusto, la misura si corregge nella conferma
    const k = perLitri.find(x => /sacca|bag/i.test(x.nome) === sacca) || perLitri[0] || fusti.find(x => /sacca|bag/i.test(x.nome) === sacca) || fusti[0];
    return k ? conX(k) : null;
  }
  return null;
}

// Divide una fattura d'acquisto: righe di vuoti già conosciute (si caricano da sole), righe da confermare, altre (materie prime)
export function righeVuoti(doc, contenitori) {
  const sicure = [], proposte = [], altre = [];
  for (const r of doc.righe || []) {
    const t = trovaContenitore(r, contenitori);
    if (t?.ignora) altre.push(r);
    else if (t?.sicuro) sicure.push({ ...r, contenitoreId: t.contenitore.id, x: t.x });
    else if (t) proposte.push({ ...r, contenitoreId: t.contenitore.id, x: t.x });
    else altre.push(r);
  }
  return { sicure, proposte, altre };
}

// Carico di vuoti da una fattura: rifEsterno uguale a quello dell'import (ficacq:<id>) così non si importa di nuovo
export const caricoDaFattura = (doc, righe, rifEsterno) => ({
  tipo: 'movcontenitore', verso: 'carico', data: doc.data, motivo: 'acquisto', fornitore: doc.fornitore || '', documento: doc.numero || '',
  note: 'da Fatture in Cloud', origine: 'fic', rifEsterno,
  righe: righe.map(r => ({ contenitoreId: r.contenitoreId, pezzi: Math.round(Number(r.qta) * (Number(r.x) || 1)), lotto: r.lotto || '' })).filter(r => r.pezzi > 0),
});

// Rintracciabilità (HACCP): da quali lotti di lattine/fusti vuoti viene il confezionamento delle cotte indicate.
// [{ data, contenitore, pezzi, lotti: [{ lotto, pezzi, arrivo, fornitore, documento }] }]
export function vuotiDelleCotte(idsCotte, dati, oggi) {
  const ids = new Set(idsCotte);
  const out = [];
  for (const g of giacenzeContenitori(dati, oggi).values()) {
    for (const r of g.registro) {
      if (r.tipo !== 'confezionamento' || !ids.has(r.uso.cotta.id)) continue;
      out.push({
        data: r.data, contenitore: g.contenitore, pezzi: -r.pezzi, contato: r.conta,
        lotti: (r.lotti || []).map(x => ({ lotto: x.lotto, pezzi: x.pezzi, arrivo: x.arrivo, fornitore: x.rec?.fornitore || '', documento: x.rec?.documento || '' })),
      });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.contenitore.nome.localeCompare(b.contenitore.nome, 'it'));
}

// ---------- fabbisogno: vuoti che servono per le cotte da confezionare ----------
// Romain 2026-10-19: per ogni cotta che si confeziona nei prossimi 20 giorni servono 30 polykeg 24 L e 800 lattine;
// le Nitro e le cotte dei beerfirm "con sacca" (Chimera) invece 40 polykeg 24 L con sacca.
// Cotta da confezionare = fine in FV da 7 giorni fa a fra 20 giorni e nessun confezionamento scritto nel suo lotto.
// Le cotte doppie contano una per cotta. I numeri per cotta si cambiano nella scheda di ogni contenitore.
export const GIORNI_FABBISOGNO = 20;
const PER_COTTA_DEFAULT = Object.fromEntries(contenitoriProposti().map(k => [k.nome.toLowerCase(), k]));
export function perCottaDi(k) {
  const d = PER_COTTA_DEFAULT[String(k.nome || '').toLowerCase()] || {};
  const v = (x, y) => (x === undefined || x === null || x === '' ? Number(y) || 0 : Number(x) || 0);
  return { normale: v(k.perCotta, d.perCotta), sacca: v(k.perCottaSacca, d.perCottaSacca) };
}
export const cottaConSacca = (c, beerfirm = []) => /nitro/i.test(c.birra || '') || beerfirm.some(b => b.sacca && b.nome === c.beerfirm);

export function fabbisognoContenitori({ contenitori, cotte, durate, beerfirm = [] }, oggi, giorni = GIORNI_FABBISOGNO) {
  const da = addGiorni(oggi, -7), fino = addGiorni(oggi, giorni);
  const daConfezionare = [];
  for (const c of cotte) {
    if (c.eliminato || !c.data) continue;
    const fine = fineCotta(c, durate);
    if (!fine || fine < da || fine > fino) continue;
    if (gruppoCotta(c, cotte).some(x => (x.confezionato || []).some(r => Number(r.pezzi) > 0))) continue;
    daConfezionare.push({ cotta: c, fine, sacca: cottaConSacca(c, beerfirm) });
  }
  daConfezionare.sort((a, b) => a.fine.localeCompare(b.fine));
  const servono = new Map();
  for (const k of contenitori) {
    if (k.eliminato) continue;
    const p = perCottaDi(k);
    const tot = daConfezionare.reduce((t, x) => t + (x.sacca ? p.sacca : p.normale), 0);
    if (tot) servono.set(k.id, tot);
  }
  return { cotte: daConfezionare, servono, giorni };
}
