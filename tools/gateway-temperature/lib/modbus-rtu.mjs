// Client Modbus RTU minimo su porta seriale (adattatore USB-RS485 sul mini PC), SOLO LETTURA (funzione 03), senza librerie.
// Serve per i regolatori Pego ECP200 Expert delle celle (parametro AU = 7, indirizzo Ad = 1, 2…).
// Non esiste nessuna funzione di scrittura (06, 16): il codice non può cambiare i regolatori.
//
// La porta si imposta con `stty` (Linux) e si legge/scrive come un file: niente moduli nativi da compilare.
// Il "trasporto" si può sostituire (prove senza hardware): { scrivi(buf), suDati(fn), ascolta(si), chiudi() }.

import { openSync, closeSync, writeSync, readSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const PARITA = { none: ['-parenb'], even: ['parenb', '-parodd'], odd: ['parenb', 'parodd'] };

export function apriSeriale({ porta, baud = 9600, parita = 'none' }) {
  if (!PARITA[parita]) throw new Error(`Modbus RTU: parità "${parita}" non valida (none, even, odd)`);
  try {
    execFileSync('stty', ['-F', porta, String(baud), 'cs8', '-cstopb', ...PARITA[parita], 'raw', '-echo', '-ixon', '-ixoff', '-crtscts', 'clocal', 'cread'], { stdio: 'pipe' });
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/No such file/i.test(msg)) throw new Error(`Modbus RTU: porta ${porta} non trovata (adattatore USB-RS485 collegato? ls /dev/ttyUSB*)`);
    if (/Permission denied/i.test(msg)) throw new Error(`Modbus RTU: permesso negato su ${porta} (l'utente deve essere nel gruppo dialout)`);
    throw new Error(`Modbus RTU: impossibile impostare ${porta}: ${msg.trim()}`);
  }
  // porta non bloccante, letta solo mentre si aspetta una risposta: nessun thread resta appeso sulla seriale
  const fd = openSync(porta, constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK);
  const blocco = Buffer.alloc(256);
  let ricevi = () => {};
  let timer = null;
  const leggi = () => {
    for (;;) {
      let n = 0;
      try { n = readSync(fd, blocco, 0, blocco.length, null); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
      if (!n) return;
      ricevi(Buffer.from(blocco.subarray(0, n)));
    }
  };
  return {
    scrivi: buf => { try { leggi(); } catch {} writeSync(fd, buf); }, // prima si butta via quello che è arrivato fuori tempo
    suDati: fn => { ricevi = fn; },
    ascolta: si => {
      clearInterval(timer);
      timer = si ? setInterval(() => { try { leggi(); } catch {} }, 3) : null;
    },
    chiudi: () => { clearInterval(timer); try { closeSync(fd); } catch {} },
  };
}

export class ModbusRtu {
  constructor({ porta, baud = 9600, parita = 'none', timeoutMs = 1000, trasporto = null }) {
    this.opz = { porta, baud, parita };
    this.timeoutMs = timeoutMs;
    this.trasporto = trasporto;
    this.esterno = !!trasporto;
    if (trasporto) trasporto.suDati(d => this._ricevi(d));
    this.coda = Promise.resolve(); // una richiesta alla volta: il bus RS485 è unico
    this.attesa = null;
    this.buffer = Buffer.alloc(0);
    // pausa tra due messaggi: almeno 3,5 caratteri (minimo 2 ms), il Pego chiede 4,5 ms
    this.pausaMs = Math.max(5, Math.ceil(3.5 * 11 * 1000 / baud));
  }

  _apri() {
    if (this.trasporto) return;
    this.trasporto = apriSeriale(this.opz);
    this.trasporto.suDati(d => this._ricevi(d));
  }

  chiudi() {
    if (this.trasporto && !this.esterno) this.trasporto.chiudi();
    if (!this.esterno) this.trasporto = null;
  }

  _ricevi(dati) {
    if (!this.attesa) return; // byte fuori tempo: scartati
    this.buffer = Buffer.concat([this.buffer, dati]);
    const b = this.buffer;
    if (b.length < 5) return;
    const lunghezza = b[1] & 0x80 ? 5 : b[1] === 3 ? 5 + b[2] : null;
    if (lunghezza === null) { this.attesa.reject(new Error(`Modbus RTU: risposta inattesa (funzione ${b[1]})`)); return; }
    if (b.length < lunghezza) return;
    this.attesa.resolve(b.subarray(0, lunghezza));
  }

  // Legge `quanti` holding register (funzione 03). Restituisce interi senza segno (0-65535).
  leggiRegistri(unita, indirizzo, quanti = 1) {
    const p = this.coda.then(() => this._richiesta(unita, indirizzo, quanti));
    this.coda = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, this.pausaMs)));
    return p;
  }

  async _richiesta(unita, indirizzo, quanti) {
    if (!(unita >= 1 && unita <= 247)) throw new Error(`Modbus RTU: indirizzo ${unita} non valido (1-247)`);
    this._apri();
    const req = Buffer.alloc(8);
    req[0] = unita; req[1] = 3;
    req.writeUInt16BE(indirizzo, 2);
    req.writeUInt16BE(quanti, 4);
    req.writeUInt16LE(crc16(req.subarray(0, 6)), 6);
    this.buffer = Buffer.alloc(0);
    const frame = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.attesa = null; this.trasporto?.ascolta?.(false); reject(new Error(`Modbus RTU: lo strumento ${unita} non risponde`)); }, this.timeoutMs);
      const fine = () => { clearTimeout(t); this.attesa = null; this.trasporto?.ascolta?.(false); };
      this.attesa = {
        resolve: f => { fine(); resolve(f); },
        reject: e => { fine(); reject(e); },
      };
      this.trasporto.ascolta?.(true);
      try { this.trasporto.scrivi(req); } catch (e) { this.attesa.reject(new Error(`Modbus RTU: scrittura sulla porta fallita (${e.message})`)); }
    });
    const n = frame.length;
    if (crc16(frame.subarray(0, n - 2)) !== frame.readUInt16LE(n - 2)) throw new Error(`Modbus RTU: risposta dello strumento ${unita} disturbata (CRC errato: cavo, schermo o 120 Ω?)`);
    if (frame[0] !== unita) throw new Error(`Modbus RTU: ha risposto lo strumento ${frame[0]} invece di ${unita}`);
    if (frame[1] === 0x83) throw new Error(`Modbus RTU: lo strumento ${unita} risponde con l'errore ${frame[2]} (${ECCEZIONI[frame[2]] || 'sconosciuto'})`);
    if (frame[2] !== quanti * 2) throw new Error('Modbus RTU: risposta incompleta');
    return Array.from({ length: quanti }, (_, i) => frame.readUInt16BE(3 + i * 2));
  }
}

const ECCEZIONI = { 1: 'funzione non supportata', 2: 'indirizzo del registro non valido', 3: 'valore non valido', 4: 'guasto dello strumento' };
