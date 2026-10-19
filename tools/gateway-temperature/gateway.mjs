#!/usr/bin/env node
// Gateway temperature dei fermentatori: legge le sonde in birrificio e le manda a Supabase.
//
//   FV1-FV5   Autonics TK4S   → Modbus TCP (gateway Waveshare RS485)
//   FV6-FV7   ESP32 ESPHome   → web server REST della scheda
//   FV8-FV11  PLC S7-200 SMART → protocollo S7, SOLO LETTURA
//
// Ogni ~15 s aggiorna temperature_attuali (pagina Cantina, in tempo reale); ogni 5 min salva una riga di storico
// per FV in letture_temperature (media del periodo). Senza internet lo storico va in un file e parte al ritorno.
//
// Uso:
//   node gateway.mjs                         servizio normale (come lo avvia systemd)
//   node gateway.mjs --test                  legge ogni sorgente UNA volta e stampa i valori (messa in servizio), non invia nulla
//   node gateway.mjs --simula                letture finte inviate a Supabase (per provare l'app senza hardware)
//   node gateway.mjs --simula --secco        letture finte solo stampate, nessun invio
//   node gateway.mjs --simula --storico 30   in più carica 30 giorni di storico finto (per vedere le curve delle cotte)
//   node gateway.mjs --cerca-plc 192.168.1.0/24   cerca il PLC (porta 102 aperta) nella rete
//   node gateway.mjs --cerca-v 0 400         cerca nella memoria V (VB0..VB400) valori che sembrano temperature (sola lettura)
//   --config /percorso/config.json           file di configurazione (predefinito: config.json accanto a questo file)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { creaSorgenti, fvConfigurati, SorgentePlc, valida } from './lib/sorgenti.mjs';
import { SorgenteSimulata } from './lib/simulazione.mjs';
import { Supabase } from './lib/supabase.mjs';
import { BufferOffline } from './lib/buffer.mjs';
import { AREE, intero16, reale32 } from './lib/s7.mjs';

const qui = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opz = nome => argv.includes(nome);
const val = (nome, def) => { const i = argv.indexOf(nome); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };

// ---------- log (systemd li raccoglie: journalctl -u gateway-temperature) ----------
const ora = () => new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' });
const log = {
  livello: 'info',
  info: m => console.log(`${ora()} ${m}`),
  avviso: m => console.warn(`${ora()} ATTENZIONE ${m}`),
  errore: m => console.error(`${ora()} ERRORE ${m}`),
  debug: m => { if (log.livello === 'debug') console.log(`${ora()} [debug] ${m}`); },
};

function caricaConfig() {
  const file = val('--config', join(qui, 'config.json'));
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (opz('--simula') && e.code === 'ENOENT') return {}; // la simulazione "secca" funziona anche senza configurazione
    console.error(`Configurazione non leggibile (${file}): ${e.message}\nCopiare config.esempio.json in config.json e compilarlo.`);
    process.exit(1);
  }
}

const config = caricaConfig();
log.livello = config.log?.livello || 'info';
const validita = { temp_min: -30, temp_max: 60, ...(config.validita || {}) };
const intervalloLettura = (config.intervalli?.lettura_s || 15) * 1000;
const minutiStorico = config.intervalli?.storico_min || 5;

// ---------- --test: una lettura di tutto, a schermo ----------
async function modoTest() {
  const sorgenti = creaSorgenti(config, { ...log, livello: 'debug', debug: m => console.log(`  · ${m}`) });
  if (!sorgenti.length) console.log('Nessuna sorgente attiva in config.json (modbus/esp32/plc "attivo": true).');
  for (const s of sorgenti) {
    console.log(`\n=== ${s.fonte.toUpperCase()} ===`);
    const letture = (await s.leggi()).map(l => ({ ...l }));
    for (const l of letture) {
      const fuori = l.temperatura !== null && (l.temperatura < validita.temp_min || l.temperatura > validita.temp_max);
      console.log(`${l.fv.padEnd(5)} T ${l.temperatura ?? '—'} °C   setpoint ${l.setpoint ?? '—'}   freddo ${l.raffreddamento === null ? '—' : l.raffreddamento ? 'ACCESO' : 'spento'}${l.errore ? `   ERRORE: ${l.errore}` : ''}${fuori ? '   (fuori dall\'intervallo valido: verrebbe scartata)' : ''}`);
    }
    if (s instanceof SorgentePlc) {
      for (const c of (config.plc.canali || []).filter(x => x.ingresso && /^AIW/i.test(x.ingresso))) {
        console.log(`  ${c.fv} ${c.ingresso}, prova delle aree: ${(await s.provaAree(c)).join(' | ')}`);
      }
      console.log('  Confrontare i valori con il pannello MCGS e correggere "offset" (o la scala) in config.json.');
    }
    s.chiudi();
  }
  if (config.supabase?.url) {
    try { await new Supabase({ url: config.supabase.url, chiave: config.supabase.chiave }).prova(); console.log('\nSupabase: collegamento OK, tabelle presenti.'); }
    catch (e) { console.log(`\nSupabase: ${e.message}`); }
  }
}

// ---------- --cerca-plc: chi ha la porta 102 aperta ----------
async function cercaPlc(rete) {
  const m = String(rete || '').match(/^(\d+\.\d+\.\d+)\.\d+(\/24)?$/);
  if (!m) { console.log('Uso: --cerca-plc 192.168.1.0/24'); return; }
  console.log(`Cerco dispositivi con la porta S7 (102) aperta in ${m[1]}.1-254…`);
  const prova = ip => new Promise(res => {
    const s = net.createConnection({ host: ip, port: 102 });
    const fine = ok => { s.destroy(); res(ok); };
    s.setTimeout(800, () => fine(false));
    s.once('connect', () => fine(true));
    s.once('error', () => fine(false));
  });
  const trovati = [];
  for (let i = 1; i < 255; i += 32) {
    const blocco = Array.from({ length: Math.min(32, 255 - i) }, (_, k) => `${m[1]}.${i + k}`);
    const esiti = await Promise.all(blocco.map(prova));
    blocco.forEach((ip, k) => { if (esiti[k]) trovati.push(ip); });
  }
  console.log(trovati.length ? `Trovati: ${trovati.join(', ')} (probabile PLC Siemens)` : 'Nessuno trovato.');
}

// ---------- --cerca-v: valori della memoria V che sembrano temperature (sola lettura) ----------
async function cercaV(da, a) {
  const plc = new SorgentePlc(config.plc, log).client;
  console.log(`Leggo VB${da}..VB${a} (sola lettura) e cerco numeri tra -5 e 40: possibili temperature o setpoint.`);
  const dati = [];
  for (let b = da; b < a; b += 200) dati.push(...(await plc.leggi(AREE.V, 1, b, Math.min(200, a - b))));
  const buf = Buffer.from(dati);
  for (let i = 0; i + 4 <= buf.length; i += 2) {
    const r = reale32(buf.subarray(i, i + 4));
    if (Number.isFinite(r) && r > -5 && r < 40 && Math.abs(r) > 0.05) console.log(`VD${da + i}  reale ${r.toFixed(2)}`);
  }
  for (let i = 0; i + 2 <= buf.length; i += 2) {
    const w = intero16(buf.subarray(i, i + 2));
    if (w > -50 && w < 400 && w !== 0) console.log(`VW${da + i}  intero ${w}  (÷10 = ${(w / 10).toFixed(1)})`);
  }
  plc.chiudi();
}

// ---------- servizio ----------
async function servizio({ simula = false, secco = false } = {}) {
  const sorgenti = simula ? [new SorgenteSimulata(config.simulazione?.fv)] : creaSorgenti(config, log);
  if (!sorgenti.length) { log.errore('nessuna sorgente attiva in config.json'); process.exit(1); }
  let sb = null;
  if (!secco) {
    try { sb = new Supabase({ url: config.supabase?.url, chiave: config.supabase?.chiave }); }
    catch (e) { log.errore(e.message); process.exit(1); }
  }
  const buffer = secco ? null : new BufferOffline({ file: config.offline?.file || join(qui, 'buffer.jsonl'), maxRighe: config.offline?.max_righe });
  log.info(`Gateway avviato${simula ? ' in SIMULAZIONE' : ''}${secco ? ' senza invio (--secco)' : ''}: ${sorgenti.map(s => s.fonte).join(', ')}; lettura ogni ${intervalloLettura / 1000} s, storico ogni ${minutiStorico} min.`);
  if (buffer) { const n = buffer.quante(); if (n) log.info(`${n} letture in attesa nel buffer offline.`); }

  // sensori mancanti in Supabase (le soglie già impostate non si toccano)
  let sensoriOk = secco;
  const registraSensori = async () => {
    if (sensoriOk) return;
    const righe = simula ? sorgenti[0].stati.map(s => ({ fv: s.fv, tipo: 'esp32', nome: 'simulazione' })) : fvConfigurati(config);
    try { await sb.registraSensori(righe); sensoriOk = true; } catch (e) { log.debug(`sensori non registrati: ${e.message}`); }
  };

  if (simula && Number(val('--storico', 0)) > 0 && sb) {
    const righe = sorgenti[0].storico(Number(val('--storico')), minutiStorico);
    log.info(`Carico ${righe.length} righe di storico finto…`);
    for (let i = 0; i < righe.length; i += 1000) await sb.inserisciStorico(righe.slice(i, i + 1000));
    log.info('Storico finto caricato.');
  }

  // campioni del periodo di storico in corso, per FV
  const campioni = new Map();
  const periodo = minutiStorico * 60_000;
  let finePeriodo = (Math.floor(Date.now() / periodo) + 1) * periodo;
  let online = null;
  const statoRete = ok => {
    if (ok === online) return;
    online = ok;
    if (ok) log.info('Supabase raggiungibile.'); else log.avviso('Supabase non raggiungibile: lo storico va nel buffer offline.');
  };
  const erroriPrecedenti = new Map();

  async function giro() {
    const letture = (await Promise.all(sorgenti.map(s => s.leggi()))).flat().map(l => (simula ? l : valida(l, validita)));
    const adesso = new Date();
    // errori: nel log solo quando cambiano, per non riempirlo
    for (const l of letture) {
      if ((l.errore || null) !== (erroriPrecedenti.get(l.fv) ?? null)) {
        if (l.errore) log.avviso(`${l.fv}: ${l.errore}`); else if (erroriPrecedenti.has(l.fv)) log.info(`${l.fv}: lettura tornata normale`);
        erroriPrecedenti.set(l.fv, l.errore || null);
      }
      if (l.temperatura !== null) {
        const c = campioni.get(l.fv) || { t: [], sp: null, acceso: 0, conosciuto: 0, fonte: l.fonte };
        c.t.push(l.temperatura);
        if (l.setpoint !== null) c.sp = l.setpoint;
        if (l.raffreddamento !== null) { c.conosciuto++; if (l.raffreddamento) c.acceso++; }
        campioni.set(l.fv, c);
      }
    }
    const attuali = letture.map(l => ({ fv: l.fv, ts: adesso.toISOString(), temperatura: l.temperatura, setpoint: l.setpoint, raffreddamento: l.raffreddamento, errore: l.errore || null, fonte: l.fonte }));
    if (secco) log.info(letture.map(l => `${l.fv} ${l.temperatura ?? '—'}°${l.raffreddamento ? '❄' : ''}`).join('  '));
    else {
      try { await sb.aggiornaAttuali(attuali); statoRete(true); } catch (e) { statoRete(false); log.debug(e.message); }
      await registraSensori();
    }

    // fine del periodo: una riga di storico per FV (media)
    if (Date.now() >= finePeriodo) {
      const ts = new Date(finePeriodo).toISOString();
      finePeriodo = (Math.floor(Date.now() / periodo) + 1) * periodo;
      const righe = [...campioni].map(([fv, c]) => ({
        fv, ts,
        temperatura: Math.round(c.t.reduce((s, x) => s + x, 0) / c.t.length * 100) / 100,
        setpoint: c.sp,
        raffreddamento: c.conosciuto ? c.acceso > 0 : null,
        raffreddamento_pct: c.conosciuto ? Math.round(c.acceso / c.conosciuto * 100) : null,
        fonte: c.fonte,
      }));
      campioni.clear();
      if (secco) log.info(`storico (non inviato): ${righe.map(r => `${r.fv} ${r.temperatura}`).join(', ')}`);
      else if (righe.length) {
        try { await sb.inserisciStorico(righe); statoRete(true); }
        catch (e) { statoRete(false); buffer.aggiungi(righe); log.debug(e.message); }
      }
    }
    // al ritorno di internet si svuota il buffer
    if (!secco && online && buffer.quante()) {
      try { const n = await buffer.svuota(r => sb.inserisciStorico(r)); if (n) log.info(`Inviate ${n} letture dal buffer offline.`); }
      catch (e) { log.debug(`buffer: ${e.message}`); }
    }
  }

  let fermo = false;
  const ciclo = async () => {
    const inizio = Date.now();
    try { await giro(); } catch (e) { log.errore(e.stack || e.message); }
    if (!fermo) setTimeout(ciclo, Math.max(1000, intervalloLettura - (Date.now() - inizio)));
  };
  const stop = sig => {
    if (fermo) return;
    fermo = true;
    log.info(`Arresto (${sig}).`);
    // il periodo in corso non è completo: si salva comunque nel buffer, verrà inviato al prossimo avvio
    if (buffer && campioni.size) {
      buffer.aggiungi([...campioni].map(([fv, c]) => ({ fv, ts: new Date().toISOString(), temperatura: Math.round(c.t.reduce((s, x) => s + x, 0) / c.t.length * 100) / 100, setpoint: c.sp, raffreddamento: c.conosciuto ? c.acceso > 0 : null, raffreddamento_pct: c.conosciuto ? Math.round(c.acceso / c.conosciuto * 100) : null, fonte: c.fonte })));
    }
    sorgenti.forEach(s => s.chiudi());
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  ciclo();
}

if (opz('--test')) await modoTest();
else if (opz('--cerca-plc')) await cercaPlc(val('--cerca-plc'));
else if (opz('--cerca-v')) {
  const i = argv.indexOf('--cerca-v');
  await cercaV(Number(argv[i + 1] ?? 0), Number(argv[i + 2] ?? 400));
} else await servizio({ simula: opz('--simula'), secco: opz('--secco') });

