// Automazioni sul server (girano anche ad app chiusa):
//   agenda del mattino e report del lunedì su Telegram, import notturno da Fatture in Cloud e Shopify,
//   allarmi temperatura dei fermentatori.
// Le lanciano le funzioni programmate (netlify/functions/automazioni-orarie.mjs, allarmi-temperatura.mjs)
// e, a richiesta, l'app da Impostazioni → Automazioni (netlify/functions/automazioni.mjs).
//
// Record nel database (tabella records, come il resto dell'app):
//   'impostazione-automazioni'  scelte fatte in Impostazioni (vedi IMPOSTAZIONI_DEFAULT)
//   'stato-automazioni'         ultimo invio e ultimo import, scritto solo dal server
//   tipo 'importsospeso'        documenti importati con righe da collegare a mano (Birra / Materie prime)
//   tipo 'cliente'              telefono ed email dei clienti presi dalle fatture

import * as db from './db.mjs';
import * as telegram from './telegram.mjs';
import * as fic from './fic.mjs';
import * as shopify from './shopify.mjs';
import { durateTipiche, addGiorni, periodiCotta } from '../../js/dominio.js';
import { testoAgenda, testoReport, esc } from '../../js/riepilogo.js';
import { elencoProdotti, impostazioniDa, trovaProdotto, FORMATO_SHOPIFY, ID_IMPOSTAZIONI } from '../../js/birra.js';
import { idCliente } from '../../js/previsioni.js';
import { ID_PREZZI, prezziDa } from '../../js/costi.js';
import { ID_IMP, ID_STATO, IMPOSTAZIONI_DEFAULT, impostazioni } from '../../js/automazioni.js';
import { caricoDaFattura, righeVuoti } from '../../js/contenitori.js';

export { ID_IMP, ID_STATO, IMPOSTAZIONI_DEFAULT, impostazioni };

// ora italiana (le funzioni programmate girano in UTC)
export function oraItalia(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, ora: Number(p.hour), lunedi: p.weekday === 'Mon' };
}
const urlApp = () => process.env.URL || '';

async function leggiStato() {
  return (await db.leggi(ID_STATO)) || { id: ID_STATO, tipo: 'statoautomazioni' };
}
async function salvaStato(stato, patch) {
  Object.assign(stato, patch);
  await db.salva([{ ...stato, id: ID_STATO, tipo: 'statoautomazioni' }]);
}

// Tutti i dati che servono ad agenda e report
const TIPI = ['cotta', 'fv', 'articolo', 'bolla', 'inventario', 'scarico', 'movbirra', 'inventariobirra', 'prodottobirra', 'scadenzahaccp', 'pulizia', 'importsospeso', 'cliente', 'ordinecliente', 'movcassa'];
export async function datiBirrificio() {
  const [t, impBirra, prezzi] = await Promise.all([db.tipi(TIPI), db.leggi(ID_IMPOSTAZIONI), db.leggi(ID_PREZZI)]);
  const cotte = t.cotta;
  return {
    cotte, fv: t.fv.sort((a, b) => a.nome.localeCompare(b.nome, 'it', { numeric: true })), durate: durateTipiche(cotte),
    articoli: t.articolo, bolle: t.bolla, inventari: t.inventario, scarichi: t.scarico, movimenti: t.movbirra,
    inventariBirra: t.inventariobirra, prodotti: t.prodottobirra, impBirra: impBirra && !impBirra.eliminato ? impBirra : null,
    scadenze: t.scadenzahaccp, pulizie: t.pulizia, sospesi: t.importsospeso, clienti: t.cliente, ordini: t.ordinecliente, cassa: t.movcassa,
    prezzi: prezzi && !prezzi.eliminato ? prezziDa(prezzi) : null,
  };
}

// ---------- messaggi ----------
export async function inviaAgenda({ imp, oggi = oraItalia().data } = {}) {
  imp ||= impostazioni(await db.leggi(ID_IMP));
  const testo = testoAgenda(await datiBirrificio(), oggi, { url: urlApp() });
  await telegram.invia(testo, imp.chatId || undefined);
  return testo;
}
export async function inviaReport({ imp, oggi = oraItalia().data } = {}) {
  imp ||= impostazioni(await db.leggi(ID_IMP));
  const dati = await datiBirrificio();
  const testo = testoReport(dati, oggi, { url: urlApp(), prezzi: dati.prezzi });
  await telegram.invia(testo, imp.chatId || undefined);
  return testo;
}

// ---------- import da Fatture in Cloud e Shopify ----------
// Ogni documento nuovo con tutte le righe riconosciute diventa subito un movimento della birra
// (come l'import a mano in Birra); se qualche riga non si riconosce resta "da controllare" nell'app.
// Gli acquisti dei fornitori restano sempre da controllare: diventano bolle quando li confermi.
// Un documento già visto (anche se poi eliminato nell'app) non si importa più in automatico.
export async function importa({ imp } = {}) {
  imp ||= impostazioni(await db.leggi(ID_IMP));
  const oggi = oraItalia().data;
  const [t, impBirraRec, stato] = await Promise.all([
    db.tipi(['movbirra', 'importsospeso', 'bolla', 'movcontenitore'], { ancheEliminati: true }), db.leggi(ID_IMPOSTAZIONI), leggiStato(),
  ]);
  const vivi = await db.tipi(['prodottobirra', 'cotta', 'cliente', 'contenitore']);
  const { prodottobirra: prodottiRec, cotta: cotte, cliente: clienti, contenitore: contenitori = [] } = vivi;
  const impBirra = impostazioniDa(impBirraRec && !impBirraRec.eliminato ? impBirraRec : null);
  const visti = new Set([...t.movbirra, ...t.importsospeso, ...t.bolla, ...t.movcontenitore].map(r => r.rifEsterno).filter(Boolean));
  const chiavi = elencoProdotti({ cotte, movimenti: t.movbirra.filter(m => !m.eliminato), inventari: [], prodotti: prodottiRec });
  const conteggi = { movimenti: 0, sospesi: 0, acquisti: 0, vuoti: 0, visti: 0, errori: [] };
  const dalPrec = stato.importa?.dal || {};
  const dal = {};
  const nuovi = [];
  const schede = new Map(clienti.map(c => [c.id, c]));

  const partenza = fonte => {
    const ultimo = t.movbirra.filter(m => m.origine === fonte && !m.eliminato).map(m => m.data).sort().pop();
    const base = [dalPrec[fonte], ultimo, impBirra.inizio].find(Boolean) || addGiorni(oggi, -30);
    return addGiorni(base > oggi ? oggi : base, -7); // una settimana di sovrapposizione: i doppioni si scartano
  };

  const registra = (fonte, d, { verso = 'scarico', motivo = 'vendita' } = {}) => {
    const rif = `${fonte === 'shopify' ? 'shopify' : 'fic'}:${d.id}`;
    if (visti.has(rif)) { conteggi.visti++; return; }
    visti.add(rif);
    const righe = d.righe.map(r => {
      const p = trovaProdotto(r, chiavi, prodottiRec, impBirra, fonte === 'shopify' ? FORMATO_SHOPIFY : null);
      return { ...r, prodotto: p?.ignora ? '-' : p?.prodotto || '', x: p?.x || 1 };
    });
    // telefono ed email del cliente, se la scheda non li ha
    if (d.cliente && (d.telefono || d.email)) {
      const id = idCliente(d.cliente);
      const s = schede.get(id) || { id, tipo: 'cliente', nome: d.cliente };
      if ((!s.telefono && d.telefono) || (!s.email && d.email)) {
        const agg = { ...s, telefono: s.telefono || d.telefono || '', email: s.email || d.email || '' };
        schede.set(id, agg);
        nuovi.push(agg);
      }
    }
    if (righe.some(r => !r.prodotto)) {
      nuovi.push({ id: `importsospeso-${rif.replace(':', '-')}`, tipo: 'importsospeso', fonte: rif.split(':')[0], verso, motivo, rifEsterno: rif, doc: { ...d, righe }, importato: oggi });
      conteggi.sospesi++;
      return;
    }
    const birra = righe.filter(r => r.prodotto !== '-' && r.qta > 0).map(r => ({ prodotto: r.prodotto, pezzi: r.qta * r.x, lotto: '', ...(r.prezzo > 0 ? { prezzo: Math.round(r.prezzo / r.x * 10000) / 10000 } : {}) })); // prezzo al pezzo, per i listini
    nuovi.push({
      tipo: 'movbirra', id: db.nuovoId('movbirra'), verso, data: d.data, motivo, cliente: d.cliente || '', documento: d.numero, note: 'importato in automatico',
      origine: fonte === 'shopify' ? 'shopify' : 'fic', rifEsterno: rif, righe: birra, ...(birra.length ? {} : { ignorato: true }),
    });
    if (birra.length) conteggi.movimenti++;
  };

  if (fic.configurato()) {
    try {
      const c = await fic.client();
      dal.fic = partenza('fic');
      const tipi = [imp.importa.vendite === 'ddt' ? 'delivery_note' : 'invoice', 'receipt'];
      for (const tipo of tipi) for (const d of (await fic.documentiEmessi(c, { tipo, dal: dal.fic })).documenti) registra('fic', d);
      for (const d of (await fic.documentiEmessi(c, { tipo: 'credit_note', dal: dal.fic })).documenti) registra('fic', d, { verso: 'carico', motivo: 'reso' });
      if (imp.importa.acquisti) {
        dal.acquisti = addGiorni(dalPrec.acquisti || addGiorni(oggi, -30), -7);
        try {
          for (const d of (await fic.acquisti(c, { dal: dal.acquisti })).documenti) {
            const rif = `ficacq:${d.id}`;
            if (visti.has(rif) || !d.righe.length) continue;
            visti.add(rif);
            // lattine e fusti vuoti già riconosciuti una volta: carico in Contenitori, il resto resta da controllare
            const { sicure, proposte, altre } = righeVuoti(d, contenitori);
            if (sicure.length) {
              nuovi.push({ ...caricoDaFattura(d, sicure, rif), id: db.nuovoId('movcontenitore'), note: 'importato in automatico' });
              conteggi.vuoti++;
            }
            if (proposte.length || altre.length) {
              nuovi.push({ id: `importsospeso-ficacq-${d.id}`, tipo: 'importsospeso', fonte: 'acquisti', rifEsterno: rif, doc: { ...d, righe: [...proposte, ...altre].map(({ contenitoreId, x, ...r }) => r) }, importato: oggi });
              conteggi.acquisti++;
            }
          }
        } catch (e) { conteggi.errori.push(`Acquisti: ${e.message}`); }
      }
    } catch (e) { conteggi.errori.push(e.message); }
  }
  if (imp.importa.shopify && shopify.configurato()) {
    try {
      dal.shopify = addGiorni(oggi, -30);
      for (const d of (await shopify.ordini(dal.shopify)).documenti) if (d.spedito) registra('shopify', d);
    } catch (e) { conteggi.errori.push(e.message); }
  }
  await db.salva(nuovi);
  // la prossima volta si riparte da oggi (meno la settimana di sovrapposizione)
  const prossimo = Object.fromEntries(Object.keys(dal).map(k => [k, oggi]));
  await salvaStato(stato, { importa: { ultimo: new Date().toISOString(), dal: { ...dalPrec, ...prossimo }, ...conteggi } });
  return conteggi;
}

// ---------- allarmi temperatura ----------
// Ogni ora (allarmi-temperatura.mjs): per i FV con una cotta dentro, allarme se
//   - nessun dato dal sensore da più dei minuti_offline del sensore (o il gateway non manda niente)
//   - errore della sonda
//   - fuori da temp_min / temp_max
//   - lontano dal setpoint più della soglia: più caldo con il freddo spento per 15 minuti (freddo che non parte),
//     più caldo con il freddo acceso per 8 ore (non ce la fa), più freddo per 30 minuti
// Messaggio quando l'allarme scatta e quando rientra.
const MINUTI = { caldoFermo: 15, caldoAcceso: 480, freddo: 30, limiti: 15 };
export function condizioneFv(s, a, adesso = Date.now()) {
  if (!a) return null;
  const minuti = (adesso - Date.parse(a.ricevuto || a.ts)) / 60_000;
  if (minuti > (Number(s.minuti_offline) || 10)) return { tipo: 'muto', attesa: 0, testo: `nessun dato da ${Math.round(minuti)} minuti` };
  if (a.errore) return { tipo: 'errore', attesa: 0, testo: `sonda: ${a.errore}` };
  const t = Number(a.temperatura);
  if (a.temperatura === null || a.temperatura === undefined || !Number.isFinite(t)) return null;
  if (s.temp_max !== null && s.temp_max !== undefined && t > Number(s.temp_max)) return { tipo: 'max', attesa: MINUTI.limiti, testo: `${fmt(t)} °C, sopra il massimo di ${fmt(s.temp_max)} °C` };
  if (s.temp_min !== null && s.temp_min !== undefined && t < Number(s.temp_min)) return { tipo: 'min', attesa: MINUTI.limiti, testo: `${fmt(t)} °C, sotto il minimo di ${fmt(s.temp_min)} °C` };
  if (a.setpoint === null || a.setpoint === undefined) return null;
  const sp = Number(a.setpoint), soglia = Number(s.soglia_scostamento) || 1.5;
  if (t > sp + soglia) {
    const acceso = a.raffreddamento === true;
    return { tipo: acceso ? 'caldo-acceso' : 'caldo', attesa: acceso ? MINUTI.caldoAcceso : MINUTI.caldoFermo, testo: `${fmt(t)} °C con setpoint ${fmt(sp)} °C${acceso ? ', il freddo è acceso ma non scende' : a.raffreddamento === false ? ', il freddo è spento' : ''}` };
  }
  if (t < sp - soglia) return { tipo: 'freddo', attesa: MINUTI.freddo, testo: `${fmt(t)} °C con setpoint ${fmt(sp)} °C: troppo freddo` };
  return null;
}
const fmt = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function controllaTemperature({ imp } = {}) {
  imp ||= impostazioni(await db.leggi(ID_IMP));
  if (!imp.allarmi.attivi || !telegram.configurato()) return { saltato: true };
  let sensori, attuali;
  try {
    [sensori, attuali] = await Promise.all([db.rest('sensori?select=*&attivo=is.true'), db.rest('temperature_attuali?select=*')]);
  } catch (e) {
    if (e.status === 404 || /42P01|PGRST20/.test(e.message)) return { saltato: true }; // tabelle non ancora create
    throw e;
  }
  if (!attuali.length) return { saltato: true }; // gateway mai partito
  const adesso = Date.now();
  const perFv = new Map(attuali.map(a => [a.fv, a]));
  const condizioni = new Map();
  for (const s of sensori) { const c = condizioneFv(s, perFv.get(s.fv), adesso); if (c) condizioni.set(s.fv, c); }
  const stato = await leggiStato();
  const prima = stato.allarmi || {};
  if (!condizioni.size && !Object.keys(prima).length) return { ok: true }; // niente di nuovo: nessuna scrittura
  // solo i FV con una cotta dentro oggi (i FV vuoti non interessano): le cotte si leggono solo se serve
  let occupati = new Set();
  if (condizioni.size) {
    const t = await db.tipi(['cotta', 'fv']);
    const oggi = oraItalia().data, durate = durateTipiche(t.cotta);
    occupati = new Set(t.cotta.flatMap(c => periodiCotta(c, durate, t.fv)).filter(p => p.fv && p.da <= oggi && p.a >= oggi).map(p => p.fv));
  }
  const tuttiMuti = sensori.length > 1 && sensori.every(s => condizioni.get(s.fv)?.tipo === 'muto');
  const messaggi = [];
  const ora = {};
  for (const [fv, c] of condizioni) {
    if (!occupati.has(fv)) continue;
    const p = prima[fv];
    const da = p && p.tipo === c.tipo ? p.da : new Date(adesso).toISOString();
    const maturo = (adesso - Date.parse(da)) / 60_000 >= c.attesa;
    const inviato = p?.inviato && p.tipo === c.tipo;
    ora[fv] = { tipo: c.tipo, da, inviato: inviato || maturo };
    if (maturo && !inviato && !tuttiMuti) messaggi.push(`🚨 <b>${esc(fv)}</b>: ${esc(c.testo)}`);
  }
  if (tuttiMuti && !prima._gateway) { messaggi.push('🚨 <b>Nessun dato dai fermentatori</b>: il gateway in birrificio non risponde (corrente, internet o mini PC spento?).'); }
  if (tuttiMuti) ora._gateway = { tipo: 'muto', da: prima._gateway?.da || new Date(adesso).toISOString(), inviato: true };
  for (const [fv, p] of Object.entries(prima)) {
    if (fv === '_gateway') { if (!tuttiMuti && p.inviato) messaggi.push('✅ I fermentatori mandano di nuovo i dati.'); continue; }
    if (!ora[fv] && p.inviato) { const a = perFv.get(fv); messaggi.push(`✅ <b>${esc(fv)}</b> di nuovo a posto${a?.temperatura !== null && a?.temperatura !== undefined ? ` (${fmt(a.temperatura)} °C)` : ''}`); }
  }
  if (messaggi.length) await telegram.invia(messaggi.join('\n'), imp.chatId || undefined);
  if (JSON.stringify(ora) !== JSON.stringify(prima)) await salvaStato(stato, { allarmi: ora });
  return { messaggi: messaggi.length };
}

// ---------- giro orario: decide cosa fare a quest'ora ----------
export async function giroOrario(adesso = new Date()) {
  if (!db.configurato()) return { saltato: 'database non configurato (SUPABASE_SERVICE_KEY)' };
  const imp = impostazioni(await db.leggi(ID_IMP));
  const { data: oggi, ora, lunedi } = oraItalia(adesso);
  const stato = await leggiStato();
  const fatto = [];
  const esito = async (chiave, fn) => {
    try { await fn(); await salvaStato(stato, { [chiave]: { data: oggi, ok: true, quando: new Date().toISOString() } }); fatto.push(chiave); }
    catch (e) { await salvaStato(stato, { [chiave]: { data: oggi, ok: false, errore: e.message, quando: new Date().toISOString() } }); fatto.push(`${chiave}: ${e.message}`); }
  };
  // l'import prima dei messaggi: l'agenda vede già le vendite della notte
  if (imp.importa.attivo && ora >= imp.importa.ora && (!stato.importa?.ultimo || oraItalia(new Date(stato.importa.ultimo)).data !== oggi)) {
    try { fatto.push(`import: ${JSON.stringify(await importa({ imp }))}`); } catch (e) { fatto.push(`import: ${e.message}`); }
  }
  if (telegram.configurato()) {
    if (imp.agenda.attiva && ora >= imp.agenda.ora && ora < imp.agenda.ora + 3 && stato.agenda?.data !== oggi) await esito('agenda', () => inviaAgenda({ imp, oggi }));
    if (imp.report.attivo && lunedi && ora >= imp.report.ora && ora < imp.report.ora + 3 && stato.report?.data !== oggi) await esito('report', () => inviaReport({ imp, oggi }));
  }
  return { oggi, ora, fatto };
}
