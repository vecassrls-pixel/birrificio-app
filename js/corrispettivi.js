// Scontrini (corrispettivi del registratore telematico) presi dal portale Fatture e Corrispettivi
// dell'Agenzia delle Entrate. Senza DOM: lo usano la pagina Scontrini, il Cashflow e i test.
//
// Record (Romain 2026-10-30):
//   corrispettivo { id 'corrispettivo-<id invio>', idInvio, matricola, rilevato (AAAA-MM-GGTHH:MM:SS), trasmesso,
//                   data (giorno delle vendite, vedi giornoChiusura), imponibile, imposta, resi, annulli, nonRiscossi,
//                   contanti, elettronico, documenti, aliquote [{ aliquota, imponibile, imposta }] }
// Un invio = una chiusura del registratore. Gli invii a zero (solo periodo di inattività) non si salvano.
// contanti/elettronico/documenti/aliquote ci sono solo se letti dal dettaglio dell'invio:
// la tabella esportata dal portale ha solo imponibile e imposta.

const n = v => Number(v) || 0;
const tondo = v => Math.round(n(v) * 100) / 100;

export const idCorrispettivo = idInvio => `corrispettivo-${idInvio}`;

// giorno delle vendite: una chiusura fatta dopo mezzanotte (prima delle 5) è della sera prima
export function giornoChiusura(rilevato) {
  const giorno = String(rilevato || '').slice(0, 10);
  if (!giorno || Number(String(rilevato).slice(11, 13)) >= 5) return giorno;
  return new Date(Date.parse(`${giorno}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

// venduto IVA compresa, al netto di resi e annulli (è quello che il registratore ha incassato davvero)
export const totale = r => tondo(n(r.imponibile) + n(r.imposta));

// incasso diviso fra contanti e POS. Il "pagato" del portale comprende anche i documenti poi annullati,
// quindi si usa solo la proporzione e si riporta al venduto. Senza dettaglio: tutto in "non diviso".
export function incasso(r) {
  const t = totale(r), c = n(r.contanti), e = n(r.elettronico);
  if (c + e <= 0) return { contanti: 0, elettronico: 0, nonDiviso: t };
  const contanti = tondo(t * c / (c + e));
  return { contanti, elettronico: tondo(t - contanti), nonDiviso: 0 };
}

export const scontrini = record => record.filter(r => !r.eliminato && r.data && totale(r) > 0);

function somma(elenco) {
  const s = { totale: 0, imponibile: 0, imposta: 0, contanti: 0, elettronico: 0, nonDiviso: 0, documenti: 0, chiusure: 0, giorni: 0 };
  const giorni = new Set();
  for (const r of elenco) {
    const i = incasso(r);
    s.totale += totale(r); s.imponibile += n(r.imponibile); s.imposta += n(r.imposta);
    s.contanti += i.contanti; s.elettronico += i.elettronico; s.nonDiviso += i.nonDiviso;
    s.documenti += n(r.documenti); s.chiusure++; giorni.add(r.data);
  }
  for (const k of ['totale', 'imponibile', 'imposta', 'contanti', 'elettronico', 'nonDiviso']) s[k] = tondo(s[k]);
  s.giorni = giorni.size;
  s.medioGiorno = s.giorni ? tondo(s.totale / s.giorni) : 0;
  s.medioScontrino = s.documenti ? tondo(s.totale / s.documenti) : 0;
  return s;
}
export const totaliScontrini = somma;

// un giorno per riga (più chiusure nello stesso giorno si sommano), dal più recente
export function perGiorno(elenco) {
  const g = new Map();
  for (const r of elenco) (g.get(r.data) || g.set(r.data, []).get(r.data)).push(r);
  return [...g].map(([data, rr]) => ({ data, ...somma(rr), invii: rr })).sort((a, b) => b.data.localeCompare(a.data));
}

// i 12 mesi dell'anno
export function perMese(elenco, anno) {
  return Array.from({ length: 12 }, (_, i) => {
    const mese = `${anno}-${String(i + 1).padStart(2, '0')}`;
    return { mese, ...somma(elenco.filter(r => r.data.startsWith(mese))) };
  });
}

// imponibile e imposta per aliquota (per la liquidazione IVA)
export function perAliquota(elenco) {
  const a = new Map();
  for (const r of elenco) {
    const righe = r.aliquote?.length ? r.aliquote : [{ aliquota: null, imponibile: r.imponibile, imposta: r.imposta }];
    for (const x of righe) {
      const k = x.aliquota == null ? '' : String(Number(x.aliquota));
      const v = a.get(k) || a.set(k, { aliquota: x.aliquota == null ? null : Number(x.aliquota), imponibile: 0, imposta: 0 }).get(k);
      v.imponibile = tondo(v.imponibile + n(x.imponibile)); v.imposta = tondo(v.imposta + n(x.imposta));
    }
  }
  return [...a.values()].sort((x, y) => (y.aliquota ?? -1) - (x.aliquota ?? -1));
}

// Per il Cashflow: incassi giornalieri del registratore fra dal e al (compresi), divisi contanti / POS.
// I contanti finiscono in cassa, il POS in banca (di solito il giorno lavorativo dopo).
export function incassiScontrini(record, dal = '0000-00-00', al = '9999-12-31') {
  return perGiorno(scontrini(record).filter(r => r.data >= dal && r.data <= al))
    .map(g => ({ data: g.data, importo: g.totale, contanti: g.contanti, elettronico: g.elettronico, nonDiviso: g.nonDiviso }))
    .reverse();
}

// ---- lettura dei dati del portale ----

// "1.234,56 €" | "1234.56" | 1234.56 → numero
export function numeroIT(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[€\s]/g, '');
  if (!s) return 0;
  return Number(/,\d{1,2}$/.test(s) || /\.\d{3}(,|$)/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
}
// "30/10/2026 15:18:29" | "2026-10-30T15:18:29" | numero Excel → "AAAA-MM-GGTHH:MM:SS"
export function dataOraIT(v) {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400) * 1000);
    return d.toISOString().slice(0, 19);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  return '';
}

const COLONNE = {
  idInvio: /id\s*invio|identificativo/i,
  matricola: /matricola/i,
  rilevato: /rilevazione/i,
  trasmesso: /trasmissione/i,
  imponibile: /imponibile/i,
  imposta: /imposta/i,
  ammontare: /ammontare/i,
  // colonne in più del file preparato da Claude con il dettaglio di ogni invio
  contanti: /contanti/i,
  elettronico: /elettronic|\bpos\b/i,
  documenti: /documenti|scontrini/i,
  annulli: /annull/i,
  aliquote: /aliquot/i,
};
// "10:54,55:5,45 22:24,59:5,41" → [{ aliquota, imponibile, imposta }]
const aliquoteDa = v => String(v ?? '').split(/[\s|]+/).filter(Boolean).map(x => x.split(':'))
  .filter(x => x.length === 3).map(([a, i, t]) => ({ aliquota: numeroIT(a), imponibile: numeroIT(i), imposta: numeroIT(t) }));

// Tabella "Corrispettivi relativi a Registratori telematici" (Esporta la tabella, CSV o Excel,
// o copiata dalla pagina): righe = array di array, con la riga d'intestazione da qualche parte in cima.
export function daTabellaPortale(righe) {
  const iTesta = righe.findIndex(r => r?.some(c => COLONNE.idInvio.test(String(c ?? ''))) && r.some(c => COLONNE.imponibile.test(String(c ?? ''))));
  if (iTesta < 0) throw new Error('Non trovo le colonne "Id Invio" e "Imponibile vendite": è la tabella dei corrispettivi del portale?');
  const testa = righe[iTesta].map(c => String(c ?? ''));
  const col = Object.fromEntries(Object.entries(COLONNE).map(([k, re]) => [k, testa.findIndex(c => re.test(c))]));
  const out = [];
  for (const r of righe.slice(iTesta + 1)) {
    const idInvio = String(r?.[col.idInvio] ?? '').replace(/\D/g, '');
    if (!idInvio) continue;
    const rilevato = dataOraIT(r[col.rilevato]);
    const imponibile = tondo(numeroIT(r[col.imponibile])), imposta = tondo(numeroIT(r[col.imposta]));
    if (!rilevato || imponibile + imposta <= 0) continue; // invii a zero: solo inattività
    out.push({
      id: idCorrispettivo(idInvio), tipo: 'corrispettivo', idInvio,
      matricola: col.matricola >= 0 ? String(r[col.matricola] ?? '').trim() : '',
      rilevato, data: giornoChiusura(rilevato),
      trasmesso: col.trasmesso >= 0 ? dataOraIT(r[col.trasmesso]) : '',
      imponibile, imposta,
      ...(col.contanti >= 0 && col.elettronico >= 0 ? { contanti: tondo(numeroIT(r[col.contanti])), elettronico: tondo(numeroIT(r[col.elettronico])) } : {}),
      ...(col.documenti >= 0 && r[col.documenti] !== '' && r[col.documenti] != null ? { documenti: numeroIT(r[col.documenti]) } : {}),
      ...(col.annulli >= 0 ? { annulli: tondo(numeroIT(r[col.annulli])) } : {}),
      ...(col.aliquote >= 0 && aliquoteDa(r[col.aliquote]).length ? { aliquote: aliquoteDa(r[col.aliquote]) } : {}),
    });
  }
  return out;
}

// CSV (separatore ; o , o tab, virgolette) → righe
export function righeCsv(testo) {
  const t = String(testo).replace(/^﻿/, '');
  const prima = t.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = ['\t', ';', ','].sort((a, b) => prima.split(b).length - prima.split(a).length)[0];
  const righe = [];
  let riga = [], cella = '', virg = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (virg) {
      if (ch === '"' && t[i + 1] === '"') { cella += '"'; i++; } else if (ch === '"') virg = false; else cella += ch;
    } else if (ch === '"') virg = true;
    else if (ch === sep) { riga.push(cella); cella = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      riga.push(cella); righe.push(riga); riga = []; cella = '';
    } else cella += ch;
  }
  if (cella || riga.length) { riga.push(cella); righe.push(riga); }
  return righe.map(r => r.map(c => c.trim()));
}

// Unisce i dati nuovi a quelli già salvati: quello che il nuovo non ha (contanti/POS, aliquote…) resta.
// Restituisce solo i record da salvare (nuovi o cambiati).
export function unisci(esistenti, nuovi) {
  const per = new Map(esistenti.map(r => [r.id, r]));
  const out = [];
  for (const x of nuovi) {
    const v = per.get(x.id);
    if (!v || v.eliminato) { out.push(x); continue; }
    const { aggiornato: _a, daSincronizzare: _d, ...vecchio } = v;
    const unito = { ...vecchio };
    for (const [k, val] of Object.entries(x)) if (val !== '' && val != null) unito[k] = val;
    if (JSON.stringify(unito) !== JSON.stringify(vecchio)) out.push(unito);
  }
  return out;
}
