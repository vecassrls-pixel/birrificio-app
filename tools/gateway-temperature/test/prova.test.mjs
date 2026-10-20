// Prove senza hardware: finti Waveshare (Modbus TCP), Pego (Modbus RTU), PLC (S7) e scheda ESP32 in locale.
//   npm test
// Verificano che i messaggi siano costruiti e letti come da protocollo; NON sostituiscono la prova sul posto (--test).

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SorgenteModbus, SorgenteEsp32, SorgentePlc, SorgentePego, valida } from '../lib/sorgenti.mjs';
import { crc16 } from '../lib/modbus-rtu.mjs';
import { indirizzo } from '../lib/s7.mjs';
import { BufferOffline } from '../lib/buffer.mjs';
import { SorgenteSimulata } from '../lib/simulazione.mjs';

const log = { info() {}, avviso() {}, errore() {}, debug() {} };
const ascolta = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
// chiude il server e le connessioni rimaste aperte (altrimenti la prova non termina)
const chiudi = srv => { srv.closeAllConnections?.(); for (const s of srv.socketAperti || []) s.destroy(); srv.close(); };
const conSocket = srv => { srv.socketAperti = new Set(); srv.on('connection', s => { srv.socketAperti.add(s); s.on('close', () => srv.socketAperti.delete(s)); }); return srv; };

test('Modbus: TK4S con PV 23.4 °C, un decimale, SV 18.0', async () => {
  const richieste = [];
  const srv = conSocket(net.createServer(s => s.on('data', d => {
    const tid = d.readUInt16BE(0), unita = d[6], fc = d[7], ind = d.readUInt16BE(8), n = d.readUInt16BE(10);
    richieste.push({ unita, fc, ind, n });
    let dati;
    if (unita === 3) { // strumento con errore di sonda (OPEN)
      dati = fc === 4 ? [31000, 1] : [180];
    } else if (unita === 9) { // indirizzo non valido → eccezione Modbus
      const r = Buffer.from([0, 0, 0, 0, 0, 3, unita, fc | 0x80, 2]); r.writeUInt16BE(tid, 0); s.write(r); return;
    } else dati = fc === 4 && ind === 1000 ? [234, 1].slice(0, n) : fc === 3 && ind === 0 ? [180] : [0];
    const r = Buffer.alloc(9 + dati.length * 2);
    r.writeUInt16BE(tid, 0); r.writeUInt16BE(0, 2); r.writeUInt16BE(3 + dati.length * 2, 4);
    r[6] = unita; r[7] = fc; r[8] = dati.length * 2;
    dati.forEach((v, i) => r.writeUInt16BE(v, 9 + i * 2));
    s.write(r);
  })));
  const porta = await ascolta(srv);
  const cfg = JSON.parse(readFileSync(new URL('../config.esempio.json', import.meta.url))).modbus;
  const sorg = new SorgenteModbus({ ...cfg, host: '127.0.0.1', porta, dispositivi: [{ fv: 'FV1', unita: 1 }, { fv: 'FV3', unita: 3 }, { fv: 'FV9', unita: 9 }] }, log);
  const [a, b, c] = await sorg.leggi();
  assert.equal(a.temperatura, 23.4);
  assert.equal(a.setpoint, 18);
  assert.equal(a.errore, null);
  assert.equal(b.temperatura, null);
  assert.match(b.errore, /errore della sonda/);
  assert.match(c.errore, /indirizzo del registro/);
  assert.ok(richieste.every(r => r.fc === 3 || r.fc === 4), 'solo funzioni di lettura');
  assert.deepEqual(richieste[0], { unita: 1, fc: 4, ind: 1000, n: 2 });
  sorg.chiudi(); chiudi(srv);
});

// finto bus RS485 con due Pego: indirizzo 1 cella a 3,5 °C, setpoint 2,0, compressore acceso; indirizzo 2 sonda guasta (E0)
function busPego({ disturbo = false } = {}) {
  const richieste = [];
  let ricevi = () => {};
  const registri = {
    1: { 0x0100: 35, 0x0101: 0x10000 - 52, 0x0300: 20, 0x0500: 0b101, 0x0501: 0, 0x0502: 0 },
    2: { 0x0100: 470, 0x0101: 0x10000 - 80, 0x0300: 20, 0x0500: 0, 0x0501: 0, 0x0502: 0b1 },
  };
  const trasporto = {
    suDati: fn => { ricevi = fn; },
    ascolta() {},
    chiudi() {},
    scrivi(req) {
      const unita = req[0], fc = req[1], ind = req.readUInt16BE(2), n = req.readUInt16BE(4);
      assert.equal(crc16(req.subarray(0, 6)), req.readUInt16LE(6), 'CRC della richiesta');
      richieste.push({ unita, fc, ind, n });
      if (!registri[unita]) return; // nessuno risponde
      const dati = Array.from({ length: n }, (_, k) => registri[unita][ind + k] ?? 0);
      const r = Buffer.alloc(5 + n * 2);
      r[0] = unita; r[1] = fc; r[2] = n * 2;
      dati.forEach((v, k) => r.writeUInt16BE(v, 3 + k * 2));
      r.writeUInt16LE(crc16(r.subarray(0, 3 + n * 2)), 3 + n * 2);
      if (disturbo) r[3] ^= 0xff;
      // risposta a pezzi, come arriva dalla seriale
      setTimeout(() => { ricevi(r.subarray(0, 3)); setTimeout(() => ricevi(r.subarray(3)), 2); }, 2);
    },
  };
  return { trasporto, richieste };
}

test('Pego: celle via Modbus RTU, solo funzione 03', async () => {
  const { trasporto, richieste } = busPego();
  const cfg = { baud: 9600, timeout_ms: 200, dispositivi: [{ fv: 'CELLA1', indirizzo: 1 }, { fv: 'CELLA2', indirizzo: 2 }, { fv: 'CELLA3', indirizzo: 3 }] };
  const s = new SorgentePego(cfg, log, trasporto);
  const [c1, c2, c3] = await s.leggi();
  assert.deepEqual(c1, { fv: 'CELLA1', temperatura: 3.5, setpoint: 2, raffreddamento: true, errore: null, fonte: 'pego' });
  assert.equal(c2.temperatura, null);
  assert.match(c2.errore, /sonda ambiente guasta/);
  assert.match(c3.errore, /non risponde/);
  assert.ok(richieste.every(r => r.fc === 3), 'mai funzioni di scrittura');
  assert.deepEqual(richieste.filter(r => r.unita === 1).map(r => [r.ind, r.n]), [[0x0100, 2], [0x0300, 1], [0x0500, 3]]);
});

test('Pego: risposta disturbata (CRC errato) scartata', async () => {
  const { trasporto } = busPego({ disturbo: true });
  const s = new SorgentePego({ timeout_ms: 200, dispositivi: [{ fv: 'CELLA1', indirizzo: 1 }] }, log, trasporto);
  const [c1] = await s.leggi();
  assert.equal(c1.temperatura, null);
  assert.match(c1.errore, /CRC/);
});

test('S7: lettura AIW e bit Q, mai funzioni di scrittura', async () => {
  const funzioni = [];
  const srv = conSocket(net.createServer(s => s.on('data', d => {
    if (d[5] === 0xe0) { // COTP CR → CC
      s.write(Buffer.from([3, 0, 0, 0x16, 0x11, 0xd0, 0, 1, 0, 1, 0, 0xc0, 1, 0x0a, 0xc1, 2, 1, 0, 0xc2, 2, 1, 1])); return;
    }
    const fz = d[17];
    funzioni.push(fz);
    if (fz === 0xf0) { // setup communication
      s.write(Buffer.from([3, 0, 0, 27, 2, 0xf0, 0x80, 0x32, 3, 0, 0, d[11], d[12], 0, 8, 0, 0, 0, 0, 0xf0, 0, 0, 1, 0, 1, 0, 240])); return;
    }
    // read var: area d[27], byte = bit/8
    const area = d[27], byte = ((d[28] << 16) | (d[29] << 8) | d[30]) / 8, n = d.readUInt16BE(23);
    let dati;
    if (area === 0x06 && byte === 16) dati = [0x3e, 0x80]; // 16000
    else if (area === 0x82 && byte === 0) dati = [0b00001000]; // Q0.3 acceso
    else { // area inesistente
      s.write(Buffer.from([3, 0, 0, 25, 2, 0xf0, 0x80, 0x32, 3, 0, 0, d[11], d[12], 0, 2, 0, 4, 0, 0, 4, 1, 0x0a, 0, 0, 0])); return;
    }
    const r = Buffer.from([3, 0, 0, 25 + n, 2, 0xf0, 0x80, 0x32, 3, 0, 0, d[11], d[12], 0, 2, 0, 4 + n, 0, 0, 4, 1, 0xff, 4, (n * 8) >> 8, (n * 8) & 0xff, ...dati]);
    s.write(r);
  })));
  const porta = await ascolta(srv);
  const canale = { fv: 'FV10', ingresso: 'AIW16', grezzo_min: 5530, grezzo_max: 27648, temp_min: -50, temp_max: 150, offset: -0.3, setpoint: null, raffreddamento: 'Q0.3' };
  const plc = new SorgentePlc({ host: '127.0.0.1', porta, area_ai: 'AI200', canali: [canale, { ...canale, fv: 'FV8', ingresso: 'AIW20', raffreddamento: null }] }, log);
  const [a, b] = await plc.leggi();
  const atteso = Math.round((-50 + (16000 - 5530) * 200 / (27648 - 5530) - 0.3) * 100) / 100;
  assert.equal(a.temperatura, atteso);
  assert.equal(a.raffreddamento, true);
  assert.match(b.errore, /area o oggetto inesistente/);
  assert.ok(!funzioni.includes(0x05), 'nessuna richiesta di scrittura');
  assert.ok(funzioni.every(f => f === 0xf0 || f === 0x04));
  plc.chiudi(); chiudi(srv);
});

test('S7: indirizzi', () => {
  assert.deepEqual(indirizzo('AIW32'), { area: 0x06, db: 0, byte: 32, lunghezza: 2, tipo: 'int' });
  assert.deepEqual(indirizzo('AIW32', 'P').area, 0x80);
  assert.deepEqual(indirizzo('VD200'), { area: 0x84, db: 1, byte: 200, lunghezza: 4, tipo: 'real' });
  assert.equal(indirizzo('V10.2').bit, 2);
  assert.throws(() => indirizzo('DB1.DBW0'));
});

test('ESP32: REST di ESPHome con autenticazione', async () => {
  const srv = http.createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from('admin:pw').toString('base64')}`) { res.writeHead(401); res.end(); return; }
    const r = { '/sensor/temperatura': { id: 'sensor-temperatura', value: 18.37, state: '18.4 °C' }, '/number/setpoint': { id: 'number-setpoint', value: 18, state: '18.0' }, '/binary_sensor/raffreddamento': { value: true, state: 'ON' }, '/binary_sensor/sonda_ok': { value: true, state: 'ON' } }[req.url];
    res.writeHead(r ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r || {}));
  });
  const porta = await ascolta(srv);
  const [a, b] = await new SorgenteEsp32({ timeout_ms: 1000, dispositivi: [{ fv: 'FV6', host: `127.0.0.1:${porta}`, utente: 'admin', password: 'pw' }, { fv: 'FV7', host: `127.0.0.1:${porta}`, utente: 'admin', password: 'no' }] }, log).leggi();
  assert.deepEqual({ t: a.temperatura, sp: a.setpoint, f: a.raffreddamento, e: a.errore }, { t: 18.37, sp: 18, f: true, e: null });
  assert.match(b.errore, /password/);
  chiudi(srv);
});

test('validità e buffer offline', async () => {
  assert.equal(valida({ fv: 'FV1', temperatura: -62.5 }, { temp_min: -10, temp_max: 60 }).temperatura, null);
  const buf = new BufferOffline({ file: join(mkdtempSync(join(tmpdir(), 'gw-')), 'b.jsonl'), maxRighe: 5 });
  buf.aggiungi([1, 2, 3, 4].map(i => ({ fv: 'FV1', ts: `t${i}` })));
  buf.aggiungi([5, 6, 7].map(i => ({ fv: 'FV1', ts: `t${i}` })));
  assert.equal(buf.quante(), 5);
  let volte = 0;
  await assert.rejects(buf.svuota(async () => { if (volte++) throw new Error('offline'); }, 2));
  assert.equal(buf.quante(), 3);
  const inviate = [];
  assert.equal(await buf.svuota(async r => inviate.push(...r)), 3);
  assert.deepEqual(inviate.map(r => r.ts), ['t5', 't6', 't7']);
  assert.equal(buf.quante(), 0);
});

test('simulazione', async () => {
  const s = new SorgenteSimulata(['FV1', 'FV2']);
  const l = await s.leggi();
  assert.equal(l.length, 2);
  assert.ok(l.every(x => typeof x.temperatura === 'number' && x.fonte === 'simulazione'));
  const st = s.storico(1, 5, Date.UTC(2026, 9, 16, 12));
  assert.equal(st.length, 2 * 289);
  assert.ok(st.every(r => r.temperatura > -5 && r.temperatura < 30));
});
