// Client Modbus TCP minimo, SOLO LETTURA (funzioni 03 e 04), senza librerie.
// Parla con il gateway Waveshare "RS485 TO WIFI/ETH" in modalità "Modbus TCP ↔ RTU" (porta 502):
// il campo "unit id" è l'indirizzo Modbus del regolatore TK4S sul bus RS485 (1-5).
// Non esiste nessuna funzione di scrittura (05, 06, 15, 16): il codice non può cambiare i regolatori.

import net from 'node:net';

const LETTURE = new Set([3, 4]); // 03 = holding register, 04 = input register

export class ModbusTcp {
  constructor({ host, porta = 502, timeoutMs = 2000 }) {
    this.host = host;
    this.porta = porta;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.tid = 0;
    this.coda = Promise.resolve(); // una richiesta alla volta: il bus RS485 è unico
    this.attesa = null;
    this.buffer = Buffer.alloc(0);
  }

  async connetti() {
    if (this.socket && !this.socket.destroyed) return;
    await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.porta });
      const t = setTimeout(() => { s.destroy(); reject(new Error(`Modbus: nessuna risposta da ${this.host}:${this.porta}`)); }, this.timeoutMs);
      s.once('connect', () => { clearTimeout(t); resolve(); });
      s.once('error', e => { clearTimeout(t); reject(new Error(`Modbus: ${e.message}`)); });
      s.on('data', d => this._ricevi(d));
      s.on('close', () => { if (this.attesa) this.attesa.reject(new Error('Modbus: connessione chiusa')); this.socket = null; });
      s.on('error', () => {});
      s.setNoDelay(true);
      this.socket = s;
    });
  }

  chiudi() {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }

  _ricevi(dati) {
    this.buffer = Buffer.concat([this.buffer, dati]);
    while (this.buffer.length >= 7) {
      const lunghezza = this.buffer.readUInt16BE(4); // unit id + PDU
      if (this.buffer.length < 6 + lunghezza) return;
      const frame = this.buffer.subarray(0, 6 + lunghezza);
      this.buffer = this.buffer.subarray(6 + lunghezza);
      if (this.attesa && frame.readUInt16BE(0) === this.attesa.tid) this.attesa.resolve(frame);
    }
  }

  // Legge `quanti` registri a 16 bit. Restituisce un array di interi senza segno (0-65535).
  leggiRegistri(unita, funzione, indirizzo, quanti = 1) {
    if (!LETTURE.has(funzione)) throw new Error(`Modbus: funzione ${funzione} non ammessa (solo lettura 03/04)`);
    const p = this.coda.then(() => this._richiesta(unita, funzione, indirizzo, quanti));
    this.coda = p.catch(() => {});
    return p;
  }

  async _richiesta(unita, funzione, indirizzo, quanti) {
    await this.connetti();
    this.tid = (this.tid + 1) & 0xffff;
    const tid = this.tid;
    const req = Buffer.alloc(12);
    req.writeUInt16BE(tid, 0);      // transaction id
    req.writeUInt16BE(0, 2);        // protocollo Modbus
    req.writeUInt16BE(6, 4);        // byte che seguono
    req.writeUInt8(unita, 6);       // indirizzo dello strumento sul bus RS485
    req.writeUInt8(funzione, 7);
    req.writeUInt16BE(indirizzo, 8);
    req.writeUInt16BE(quanti, 10);
    this.buffer = Buffer.alloc(0);
    const frame = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.attesa = null; this.chiudi(); reject(new Error(`Modbus: lo strumento ${unita} non risponde`)); }, this.timeoutMs);
      this.attesa = {
        tid,
        resolve: f => { clearTimeout(t); this.attesa = null; resolve(f); },
        reject: e => { clearTimeout(t); this.attesa = null; reject(e); },
      };
      this.socket.write(req);
    });
    const fc = frame.readUInt8(7);
    if (fc === (funzione | 0x80)) throw new Error(`Modbus: lo strumento ${unita} risponde con l'errore ${frame.readUInt8(8)} (${ECCEZIONI[frame.readUInt8(8)] || 'sconosciuto'})`);
    if (fc !== funzione) throw new Error(`Modbus: risposta inattesa (funzione ${fc})`);
    const n = frame.readUInt8(8);
    if (n !== quanti * 2 || frame.length < 9 + n) throw new Error('Modbus: risposta incompleta');
    return Array.from({ length: quanti }, (_, i) => frame.readUInt16BE(9 + i * 2));
  }
}

const ECCEZIONI = { 1: 'funzione non supportata', 2: 'indirizzo del registro non valido', 3: 'valore non valido', 4: 'guasto dello strumento', 10: 'gateway: percorso non disponibile', 11: 'gateway: lo strumento non risponde' };

export const conSegno = v => (v > 0x7fff ? v - 0x10000 : v);
