// Le tre sorgenti di temperatura. Ognuna restituisce un elenco di letture:
//   { fv, temperatura, setpoint, raffreddamento, errore, fonte }
// temperatura/setpoint in °C (null se non disponibili), raffreddamento true/false/null, errore = testo o null.
// Una sorgente che non risponde non blocca le altre.

import { ModbusTcp, conSegno } from './modbus.mjs';
import { ModbusRtu } from './modbus-rtu.mjs';
import { S7Client, AREE, indirizzo, intero16, reale32 } from './s7.mjs';
import { leggiEsp32 } from './esp32.mjs';

const arrotonda = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const numHex = v => (typeof v === 'string' ? Number.parseInt(v, v.startsWith('0x') ? 16 : 10) : v);

export function valida(l, validita) {
  if (l.temperatura === null || l.temperatura === undefined) return l;
  if (l.temperatura < validita.temp_min || l.temperatura > validita.temp_max) {
    return { ...l, errore: `lettura fuori campo (${arrotonda(l.temperatura, 1)} °C): sonda guasta o scollegata?`, temperatura: null };
  }
  return l;
}

// ---------- Blocco FV1-FV5: Autonics TK4S via Modbus ----------
export class SorgenteModbus {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
    this.client = new ModbusTcp({ host: cfg.host, porta: cfg.porta, timeoutMs: cfg.timeout_ms });
    this.fonte = 'modbus';
  }

  async _uno(d) {
    const r = this.cfg.registri;
    const unita = d.unita;
    let pvGrezzo, punti = r.punto_decimale_fisso;
    if (punti === null || punti === undefined) {
      if (r.punto_decimale && r.punto_decimale.funzione === r.pv.funzione && r.punto_decimale.indirizzo === r.pv.indirizzo + 1) {
        [pvGrezzo, punti] = await this.client.leggiRegistri(unita, r.pv.funzione, r.pv.indirizzo, 2); // un'unica richiesta
      } else {
        [pvGrezzo] = await this.client.leggiRegistri(unita, r.pv.funzione, r.pv.indirizzo, 1);
        punti = r.punto_decimale ? (await this.client.leggiRegistri(unita, r.punto_decimale.funzione, r.punto_decimale.indirizzo, 1))[0] : 0;
      }
    } else {
      [pvGrezzo] = await this.client.leggiRegistri(unita, r.pv.funzione, r.pv.indirizzo, 1);
    }
    if (!(punti >= 0 && punti <= 3)) punti = 0;
    const div = 10 ** punti;
    const pv = conSegno(pvGrezzo);
    this.log.debug(`modbus ${d.fv} unità ${unita}: pv grezzo ${pv}, decimali ${punti}`);
    const out = { fv: d.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: null, fonte: this.fonte };
    if (Math.abs(pv) >= (r.errore_da ?? 30000)) out.errore = `il regolatore segnala un errore della sonda (valore ${pv})`;
    else out.temperatura = arrotonda(pv / div);
    if (r.sv) {
      try {
        const [sv] = await this.client.leggiRegistri(unita, r.sv.funzione, r.sv.indirizzo, 1);
        out.setpoint = arrotonda(conSegno(sv) / div);
      } catch (e) { this.log.debug(`modbus ${d.fv}: setpoint non letto (${e.message})`); }
    }
    if (r.uscita) {
      try {
        const [u] = await this.client.leggiRegistri(unita, r.uscita.funzione, r.uscita.indirizzo, 1);
        out.raffreddamento = r.uscita.bit === undefined || r.uscita.bit === null ? u !== 0 : !!((u >> r.uscita.bit) & 1);
      } catch (e) { this.log.debug(`modbus ${d.fv}: uscita non letta (${e.message})`); }
    }
    return out;
  }

  async leggi() {
    const out = [];
    for (const d of this.cfg.dispositivi || []) { // in fila: il bus RS485 è uno solo
      try { out.push(await this._uno(d)); }
      catch (e) { out.push({ fv: d.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: e.message, fonte: this.fonte }); }
    }
    return out;
  }

  chiudi() { this.client.chiudi(); }
}

// ---------- Blocco FV6-FV7: termostati ESP32 (ESPHome) ----------
export class SorgenteEsp32 {
  constructor(cfg, log) { this.cfg = cfg; this.log = log; this.fonte = 'esp32'; }

  leggi() {
    return Promise.all((this.cfg.dispositivi || []).map(async d => {
      try { return { fv: d.fv, ...(await leggiEsp32(d, { timeoutMs: this.cfg.timeout_ms })), fonte: this.fonte }; }
      catch (e) {
        const msg = e.name === 'TimeoutError' || /fetch failed|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED/.test(`${e.message} ${e.cause?.code || ''}`) ? `scheda ${d.host} non raggiungibile` : e.message;
        return { fv: d.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: msg, fonte: this.fonte };
      }
    }));
  }

  chiudi() {}
}

// ---------- Blocco FV8-FV11: PLC Siemens S7-200 SMART (SOLO LETTURA) ----------
export class SorgentePlc {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
    this.fonte = 'plc';
    this.client = new S7Client({
      host: cfg.host, porta: cfg.porta || 102, timeoutMs: cfg.timeout_ms || 3000,
      tsapLocale: numHex(cfg.tsap_locale ?? '0x0100'), tsapRemoto: numHex(cfg.tsap_remoto ?? '0x0101'),
    });
  }

  async _valore(testo) {
    const a = indirizzo(testo, this.cfg.area_ai || 'AI200');
    const b = await this.client.leggi(a.area, a.db, a.byte, a.lunghezza);
    if (a.tipo === 'bit') return !!((b[0] >> a.bit) & 1);
    if (a.tipo === 'real') return reale32(b);
    if (a.tipo === 'byte') return b[0];
    return intero16(b);
  }

  // grezzo → °C: retta tra (grezzo_min, temp_min) e (grezzo_max, temp_max), più la correzione di taratura
  static scala(grezzo, c) {
    return c.temp_min + (grezzo - c.grezzo_min) * (c.temp_max - c.temp_min) / (c.grezzo_max - c.grezzo_min) + (Number(c.offset) || 0);
  }

  async _uno(c) {
    const out = { fv: c.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: null, fonte: this.fonte };
    const a = indirizzo(c.ingresso, this.cfg.area_ai || 'AI200');
    const v = await this._valore(c.ingresso);
    if (a.tipo === 'real') out.temperatura = arrotonda(v + (Number(c.offset) || 0)); // già in gradi nella memoria V
    else if (v >= 32767 || v <= -32768) out.errore = 'ingresso analogico fuori campo (sonda o trasmettitore scollegato?)';
    else out.temperatura = arrotonda(SorgentePlc.scala(v, c));
    this.log.debug(`plc ${c.fv} ${c.ingresso}: grezzo ${v} → ${out.temperatura}`);
    if (c.setpoint) {
      try { out.setpoint = arrotonda((await this._valore(c.setpoint)) * (Number(c.setpoint_fattore) || 1)); }
      catch (e) { this.log.debug(`plc ${c.fv}: setpoint non letto (${e.message})`); }
    }
    if (c.raffreddamento) {
      try { out.raffreddamento = !!(await this._valore(c.raffreddamento)); }
      catch (e) { this.log.debug(`plc ${c.fv}: raffreddamento non letto (${e.message})`); }
    }
    return out;
  }

  async leggi() {
    const out = [];
    for (const c of (this.cfg.canali || []).filter(x => x.ingresso)) {
      try { out.push(await this._uno(c)); }
      catch (e) { out.push({ fv: c.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: e.message, fonte: this.fonte }); }
    }
    return out;
  }

  // per --test: prova le due aree possibili degli ingressi analogici su un canale
  async provaAree(c) {
    const a = indirizzo(c.ingresso, 'AI200');
    const esiti = [];
    for (const nome of ['AI200', 'P']) {
      try { esiti.push(`${nome}: grezzo ${intero16(await this.client.leggi(AREE[nome], 0, a.byte, 2))}`); }
      catch (e) { esiti.push(`${nome}: ${e.message}`); }
    }
    return esiti;
  }

  chiudi() { this.client.chiudi(); }
}

// ---------- Celle frigo: regolatori Pego ECP200 Expert via Modbus RTU (USB-RS485), SOLO LETTURA ----------
// Mappa registri dal documento Pego "MODBUS-RTU protocol specifications" (ECP200 EXPERT): DA VERIFICARE con --test.
export const PEGO = {
  temperatura: 0x0100,  // sonda ambiente, 0x0101 evaporatore: decimi di °C con segno, > 45 °C = sonda guasta
  setpoint: 0x0300,     // decimi di °C con segno
  stato: 0x0500,        // 0x0500 uscite, 0x0501 ingressi, 0x0502 allarmi
};
const ALLARMI_PEGO = [
  [0, 'sonda ambiente guasta (E0)'], [1, 'sonda evaporatore guasta (E1)'], [2, 'errore memoria (EE)'],
  [3, 'temperatura alta (EH)'], [4, 'temperatura bassa (EL)'], [5, 'porta aperta (Ed)'],
  [6, 'allarme uomo in cella (E8)'], [7, 'protezione compressore (Ec)'], [8, 'luce accesa da troppo (E9)'], [9, 'batteria orologio scarica (E6)'],
];

export class SorgentePego {
  constructor(cfg, log, trasporto = null) {
    this.cfg = cfg;
    this.log = log;
    this.fonte = 'pego';
    this.client = new ModbusRtu({ porta: cfg.porta, baud: cfg.baud || 9600, parita: cfg.parita || 'none', timeoutMs: cfg.timeout_ms || 1000, trasporto });
  }

  async _uno(d) {
    const out = { fv: d.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: null, fonte: this.fonte };
    const [ambiente, evaporatore] = await this.client.leggiRegistri(d.indirizzo, PEGO.temperatura, 2);
    const t = conSegno(ambiente) / 10;
    this.log.debug(`pego ${d.fv} indirizzo ${d.indirizzo}: ambiente ${t} °C, evaporatore ${conSegno(evaporatore) / 10} °C`);
    if (t > 45) out.errore = 'il Pego segnala la sonda ambiente guasta';
    else out.temperatura = arrotonda(t + (Number(d.offset) || 0));
    try { out.setpoint = arrotonda(conSegno((await this.client.leggiRegistri(d.indirizzo, PEGO.setpoint, 1))[0]) / 10); }
    catch (e) { this.log.debug(`pego ${d.fv}: setpoint non letto (${e.message})`); }
    try {
      const [uscite, , allarmi] = await this.client.leggiRegistri(d.indirizzo, PEGO.stato, 3);
      out.raffreddamento = !!(uscite & 1); // bit 0 = relè compressore
      if (uscite & 2) this.log.debug(`pego ${d.fv}: sbrinamento in corso`);
      const attivi = ALLARMI_PEGO.filter(([bit]) => (allarmi >> bit) & 1).map(([, testo]) => testo);
      if (attivi.length) {
        this.log.debug(`pego ${d.fv}: allarmi ${attivi.join(', ')}`);
        if (allarmi & 1 && !out.errore) { out.errore = 'il Pego segnala la sonda ambiente guasta (E0)'; out.temperatura = null; }
      }
    } catch (e) { this.log.debug(`pego ${d.fv}: stato non letto (${e.message})`); }
    return out;
  }

  async leggi() {
    const out = [];
    for (const d of this.cfg.dispositivi || []) { // in fila: il bus RS485 è uno solo
      try { out.push(await this._uno(d)); }
      catch (e) { out.push({ fv: d.fv, temperatura: null, setpoint: null, raffreddamento: null, errore: e.message, fonte: this.fonte }); }
    }
    return out;
  }

  chiudi() { this.client.chiudi(); }
}

export function creaSorgenti(config, log) {
  const s = [];
  if (config.modbus?.attivo) s.push(new SorgenteModbus(config.modbus, log));
  if (config.pego?.attivo) s.push(new SorgentePego(config.pego, log));
  if (config.esp32?.attivo) s.push(new SorgenteEsp32(config.esp32, log));
  if (config.plc?.attivo) s.push(new SorgentePlc(config.plc, log));
  return s;
}

// FV configurati, per registrare i sensori in Supabase
export function fvConfigurati(config) {
  return [
    ...(config.modbus?.attivo ? (config.modbus.dispositivi || []).map(d => ({ fv: d.fv, tipo: 'modbus', nome: `Autonics TK4S indirizzo ${d.unita}` })) : []),
    ...(config.pego?.attivo ? (config.pego.dispositivi || []).map(d => ({ fv: d.fv, tipo: 'modbus', nome: `Pego ECP200 indirizzo ${d.indirizzo}` })) : []),
    ...(config.esp32?.attivo ? (config.esp32.dispositivi || []).map(d => ({ fv: d.fv, tipo: 'esp32', nome: `ESP32 ${d.host}` })) : []),
    ...(config.plc?.attivo ? (config.plc.canali || []).map(c => ({ fv: c.fv, tipo: 'plc', nome: `PLC ${c.ingresso || 'da collegare'}` })) : []),
  ];
}
