// Cashflow (Romain 2026-10-23): previsione dei soldi settimana per settimana.
// Senza DOM: lo usano la pagina Cashflow (vista-cashflow.js) e i test.
//
// Fonti:
//   - rate di Fatture in Cloud (fatture emesse, note di credito, acquisti) dal proxy ?scadenze=1:
//     { id, verso: 'entrata'|'uscita', tipo, numero, data, controparte, importo (IVA compresa), scadenza, pagata }
//   - uscite ed entrate fisse ricorrenti e saldo della banca scritti a mano nel record ID_CASHFLOW
//   - contanti: saldo della prima nota di cassa (cassa.js)
//   - materie prime da ordinare per le cotte pianificate (ordine.js) ai prezzi delle ultime bolle (costi.js)
//
// Record { id: ID_CASHFLOW, tipo: 'cashflow',
//   banca: [{ data, saldo, note }]   saldi del conto letti a mano, si usa l'ultimo
//   fisse: [{ id, nome, importo, verso: 'uscita'|'entrata', ogni: 'settimana'|'mese'|'bimestre'|'trimestre'|'semestre'|'anno',
//             prima (data della prima volta), fino (facoltativa), categoria }]
//   soglia (€, sotto si segna la settimana), giorniMp (giorni di pagamento delle materie prime), ivaMp (%),
//   scadutiInEntrata (true: i crediti scaduti si contano nella prima settimana) }
// tipo 'cashflow' è riservato come la cassa (migrazione_cassa_riservata.sql).

import { addGiorni, daISO } from './dominio.js';

export const ID_CASHFLOW = 'cashflow-impostazioni';
export const OGNI = { settimana: 'Ogni settimana', mese: 'Ogni mese', bimestre: 'Ogni 2 mesi', trimestre: 'Ogni 3 mesi', semestre: 'Ogni 6 mesi', anno: 'Ogni anno' };
const MESI = { mese: 1, bimestre: 2, trimestre: 3, semestre: 6, anno: 12 };
export const CATEGORIE_FISSE = { affitto: 'Affitto', stipendi: 'Stipendi', tasse: 'Tasse e F24', accise: 'Accise', rate: 'Rate e mutui', utenze: 'Utenze', assicurazioni: 'Assicurazioni', altro: 'Altro' };
export const impostazioniDa = rec => ({ banca: [], fisse: [], soglia: 0, giorniMp: 30, ivaMp: 22, scadutiInEntrata: false, ...(rec && !rec.eliminato ? rec : {}) });
export const SETTIMANE = 13;

const n = v => Number(v) || 0;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// lunedì della settimana di una data
export function lunedi(data) {
  const g = daISO(data).getDay();
  return addGiorni(data, -((g + 6) % 7));
}

// date in cui cade una voce fissa tra da e a (comprese)
export function ricorrenze(f, da, a) {
  if (!f.prima || !(n(f.importo) > 0)) return [];
  const fine = f.fino && f.fino < a ? f.fino : a;
  const out = [];
  if (f.ogni === 'settimana') {
    for (let d = f.prima, i = 0; d <= fine && i < 2000; d = addGiorni(d, 7), i++) if (d >= da) out.push(d);
    return out;
  }
  const passo = MESI[f.ogni] || 1;
  const p = daISO(f.prima), giorno = p.getDate();
  for (let k = 0; k < 1200; k += passo) {
    const ultimo = new Date(p.getFullYear(), p.getMonth() + k + 1, 0).getDate(); // il 31 nei mesi corti diventa l'ultimo del mese
    const d = iso(new Date(p.getFullYear(), p.getMonth() + k, Math.min(giorno, ultimo)));
    if (d > fine) break;
    if (d >= da) out.push(d);
  }
  return out;
}

// ultimo saldo della banca (o null)
export const ultimaBanca = imp => [...(imp.banca || [])].filter(b => b.data).sort((x, y) => x.data.localeCompare(y.data)).pop() || null;

// Materie prime da ordinare (righe di fabbisogno() in ordine.js) → uscite stimate:
// costo = quantità × ultimo prezzo da bolla + IVA, pagato giorniMp dopo l'ordine (o il giorno "ordina entro").
export function usciteMateriePrime(righe, { prezzo, giorniMp = 30, ivaMp = 22 }) {
  const voci = [], senzaPrezzo = [];
  for (const r of righe) {
    const p = prezzo(r.articolo);
    if (!p) { senzaPrezzo.push(r.articolo.nome); continue; }
    const importo = Math.round(r.ordina * p * (1 + n(ivaMp) / 100) * 100) / 100;
    if (!(importo > 0)) continue;
    voci.push({ id: `mp-${r.articolo.id}`, verso: 'uscita', tipo: 'mp', numero: r.articolo.nome, controparte: r.fornitore || '', importo, scadenza: addGiorni(r.ordinato || r.entro, n(giorniMp)), pagata: null, stimata: true });
  }
  return { voci, senzaPrezzo };
}

// Previsione: { iniziale, banca, contanti, aggiustamento, settimane: [{ da, a, entrate, uscite, netto, saldo, voci, sotto }],
//   scadute: { entrate, uscite, voci }, aperte: { entrate, uscite }, ultime: [{ da, a, entrate, uscite }] }
// Il saldo di partenza è l'ultimo saldo della banca, più quello che è entrato e uscito dopo quella data
// (rate segnate pagate in Fatture in Cloud e voci fisse già passate), più i contanti in cassa.
export function previsione({ rate = [], mp = [], imp, contanti = 0, oggi, settimane = SETTIMANE }) {
  const banca = ultimaBanca(imp);
  const segno = v => (v.verso === 'entrata' ? 1 : -1) * n(v.importo);
  const voci = [];
  let aggiustamento = 0;
  const dopoBanca = [];
  if (banca) {
    for (const r of rate) if (r.pagata && r.pagata > banca.data && r.pagata <= oggi) { aggiustamento += segno(r); dopoBanca.push(r); }
  }
  const inizio = lunedi(oggi), fine = addGiorni(inizio, settimane * 7 - 1);
  for (const f of imp.fisse || []) {
    if (banca) for (const d of ricorrenze(f, addGiorni(banca.data, 1), addGiorni(oggi, -1))) { const v = vocefissa(f, d); aggiustamento += segno(v); dopoBanca.push(v); }
    for (const d of ricorrenze(f, oggi, fine)) voci.push(vocefissa(f, d));
  }
  const iniziale = (banca ? n(banca.saldo) : 0) + aggiustamento + n(contanti);

  const aperte = rate.filter(r => !r.pagata);
  const scadute = aperte.filter(r => r.scadenza < oggi);
  for (const r of aperte) if (r.scadenza >= oggi) voci.push(r);
  for (const r of scadute) if (r.verso === 'uscita' || imp.scadutiInEntrata) voci.push({ ...r, scaduta: true, quando: oggi });
  for (const m of mp) voci.push(m.scadenza < oggi ? { ...m, quando: oggi } : m);

  const out = [];
  let saldo = iniziale;
  for (let i = 0; i < settimane; i++) {
    const da = addGiorni(inizio, i * 7), a = addGiorni(da, 6);
    const qui = voci.filter(v => { const d = v.quando || v.scadenza; return d >= da && d <= a; })
      .sort((x, y) => (x.quando || x.scadenza).localeCompare(y.quando || y.scadenza) || segno(x) - segno(y));
    const entrate = qui.filter(v => v.verso === 'entrata').reduce((t, v) => t + n(v.importo), 0);
    const uscite = qui.filter(v => v.verso === 'uscita').reduce((t, v) => t + n(v.importo), 0);
    saldo += entrate - uscite;
    out.push({ da, a, entrate, uscite, netto: entrate - uscite, saldo, voci: qui, sotto: saldo < n(imp.soglia) });
  }
  const somma = (lista, verso) => lista.filter(r => r.verso === verso).reduce((t, r) => t + n(r.importo), 0);
  // ultime 8 settimane: rate pagate secondo Fatture in Cloud
  const ultime = [];
  for (let i = 8; i >= 1; i--) {
    const da = addGiorni(inizio, -i * 7), a = addGiorni(da, 6);
    const pagate = rate.filter(r => r.pagata && r.pagata >= da && r.pagata <= a);
    ultime.push({ da, a, entrate: somma(pagate, 'entrata'), uscite: somma(pagate, 'uscita') });
  }
  return {
    iniziale, banca, contanti: n(contanti), aggiustamento, dopoBanca, settimane: out,
    scadute: { entrate: somma(scadute, 'entrata'), uscite: somma(scadute, 'uscita'), voci: scadute },
    aperte: { entrate: somma(aperte, 'entrata'), uscite: somma(aperte, 'uscita') },
    ultime,
  };
}

function vocefissa(f, data) {
  return { id: `fissa-${f.id}-${data}`, verso: f.verso === 'entrata' ? 'entrata' : 'uscita', tipo: 'fissa', numero: f.nome, controparte: CATEGORIE_FISSE[f.categoria] || '', importo: n(f.importo), scadenza: data, pagata: null, stimata: true };
}
