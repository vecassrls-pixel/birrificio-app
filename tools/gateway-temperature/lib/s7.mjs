// Client S7 (protocollo "S7comm" su ISO-on-TCP, porta 102) minimo e SOLO LETTURA, senza librerie.
// Serve a leggere il PLC Siemens S7-200 SMART di FV8-FV11 senza toccarne il programma.
//
// SOLO LETTURA PER COSTRUZIONE: questo file sa costruire solo tre messaggi
//   1. richiesta di connessione (COTP CR)   2. negoziazione PDU (Setup communication)   3. "Read Var" (funzione 0x04)
// Non esiste il codice della funzione di scrittura (0x05) né di avvio/arresto del PLC.
//
// Aree di memoria usate:
//   V (memoria variabili)      = DB1 (area 0x84, numero 1) sulla famiglia S7-200
//   AIW (ingressi analogici)   = area 0x06 "analog inputs 200 family"; in alternativa 0x80 (periferia).
//                                Quale funziona va VERIFICATO sul posto con  node gateway.mjs --test

import net from 'node:net';

export const AREE = { AI200: 0x06, P: 0x80, I: 0x81, Q: 0x82, M: 0x83, V: 0x84 };
const FUNZIONE_LETTURA = 0x04;
const RISPOSTE = { 0x01: 'errore hardware', 0x03: 'accesso negato', 0x05: 'indirizzo fuori campo', 0x06: 'tipo di dato non supportato', 0x07: 'tipo di dato incoerente', 0x0a: 'area o oggetto inesistente' };

export class S7Client {
  constructor({ host, porta = 102, tsapLocale = 0x0100, tsapRemoto = 0x0101, timeoutMs = 3000 }) {
    Object.assign(this, { host, porta, tsapLocale, tsapRemoto, timeoutMs });
    this.socket = null;
    this.pdu = 240;
    this.rif = 0;
    this.buffer = Buffer.alloc(0);
    this.attesa = null;
    this.coda = Promise.resolve();
  }

  connetti() {
    const p = this.coda.then(() => this._connetti());
    this.coda = p.catch(() => {});
    return p;
  }

  async _connetti() {
    if (this.socket && !this.socket.destroyed && this.pronto) return;
    this.chiudi();
    await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.porta });
      const t = setTimeout(() => { s.destroy(); reject(new Error(`PLC: nessuna risposta da ${this.host}:${this.porta}`)); }, this.timeoutMs);
      s.once('connect', () => { clearTimeout(t); resolve(); });
      s.once('error', e => { clearTimeout(t); reject(new Error(`PLC: ${e.message}`)); });
      s.on('data', d => this._ricevi(d));
      s.on('close', () => { this.pronto = false; if (this.attesa) this.attesa.reject(new Error('PLC: connessione chiusa')); });
      s.on('error', () => {});
      s.setNoDelay(true);
      this.socket = s;
    });
    // 1. connessione ISO (COTP Connection Request)
    const cr = Buffer.from([
      0x03, 0x00, 0x00, 0x16,                  // TPKT, 22 byte
      0x11, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x00, // COTP CR
      0xc0, 0x01, 0x0a,                        // TPDU 1024
      0xc1, 0x02, this.tsapLocale >> 8, this.tsapLocale & 0xff,
      0xc2, 0x02, this.tsapRemoto >> 8, this.tsapRemoto & 0xff,
    ]);
    const cc = await this._scambia(cr);
    if (cc.length < 6 || cc[5] !== 0xd0) throw new Error('PLC: connessione ISO rifiutata (controllare rack/slot o TSAP)');
    // 2. negoziazione della dimensione dei messaggi
    const pn = Buffer.from([
      0x03, 0x00, 0x00, 0x19,
      0x02, 0xf0, 0x80,
      0x32, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00,
      0xf0, 0x00, 0x00, 0x01, 0x00, 0x01, 0x01, 0xe0,
    ]);
    const r = await this._scambia(pn);
    if (r.length < 27 || r[7] !== 0x32 || r[8] !== 0x03) throw new Error('PLC: negoziazione S7 non riuscita');
    if (r[17] || r[18]) throw new Error(`PLC: negoziazione rifiutata (errore ${r[17]}/${r[18]})`);
    this.pdu = r.readUInt16BE(25);
    this.pronto = true;
  }

  chiudi() {
    this.pronto = false;
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }

  // TPKT: 03 00 LL LL; un messaggio è completo quando ci sono LL byte
  _ricevi(d) {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (this.buffer.length >= 4) {
      const n = this.buffer.readUInt16BE(2);
      if (n < 4) { this.buffer = Buffer.alloc(0); return; }
      if (this.buffer.length < n) return;
      const msg = this.buffer.subarray(0, n);
      this.buffer = this.buffer.subarray(n);
      if (this.attesa) this.attesa.resolve(msg);
    }
  }

  _scambia(msg) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.attesa = null; this.chiudi(); reject(new Error('PLC: tempo scaduto')); }, this.timeoutMs);
      this.attesa = {
        resolve: m => { clearTimeout(t); this.attesa = null; resolve(m); },
        reject: e => { clearTimeout(t); this.attesa = null; reject(e); },
      };
      this.socket.write(msg);
    });
  }

  // Legge `byte` byte dall'area indicata, a partire dal byte `inizio`. db = numero del DB (1 per la memoria V).
  leggi(area, db, inizio, byte) {
    const p = this.coda.then(async () => {
      await this._connetti();
      if (byte > this.pdu - 18) throw new Error(`PLC: lettura troppo lunga (${byte} byte, massimo ${this.pdu - 18})`);
      this.rif = (this.rif + 1) & 0xffff;
      const bit = inizio * 8;
      const req = Buffer.from([
        0x03, 0x00, 0x00, 0x1f,                 // TPKT, 31 byte
        0x02, 0xf0, 0x80,                       // COTP dati
        0x32, 0x01, 0x00, 0x00, this.rif >> 8, this.rif & 0xff, 0x00, 0x0e, 0x00, 0x00, // S7: job, 14 byte di parametri
        FUNZIONE_LETTURA, 0x01,                 // Read Var, 1 elemento
        0x12, 0x0a, 0x10, 0x02,                 // indirizzo S7ANY, tipo BYTE
        byte >> 8, byte & 0xff,
        db >> 8, db & 0xff,
        area,
        (bit >> 16) & 0xff, (bit >> 8) & 0xff, bit & 0xff,
      ]);
      const r = await this._scambia(req);
      if (r.length < 21 || r[7] !== 0x32 || r[8] !== 0x03) throw new Error('PLC: risposta non valida');
      if (r[17] || r[18]) throw new Error(`PLC: richiesta rifiutata (errore ${r[17]}/${r[18]})`);
      if (r[19] !== FUNZIONE_LETTURA) throw new Error('PLC: risposta inattesa');
      const codice = r[21];
      if (codice !== 0xff) throw new Error(`PLC: lettura non riuscita (${RISPOSTE[codice] || `codice ${codice}`})`);
      const tipo = r[22];
      let n = r.readUInt16BE(23);
      if (tipo === 0x04 || tipo === 0x03) n = Math.ceil(n / 8); // lunghezza in bit
      return r.subarray(25, 25 + Math.min(n, byte));
    });
    this.coda = p.catch(() => {});
    return p;
  }
}

// Interpretazione dei byte (Siemens: big-endian)
export const intero16 = b => b.readInt16BE(0);
export const reale32 = b => b.readFloatBE(0);

// "AIW16" → { area: AI, byte: 16 } ; "VW100" / "VD200" → memoria V (DB1) ; "Q0.3" / "V10.1" / "M2.0" → un bit
export function indirizzo(testo, areaAi = 'AI200') {
  const t = String(testo || '').trim().toUpperCase();
  const b = t.match(/^(Q|I|M|V)(\d+)\.([0-7])$/);
  if (b) return { area: AREE[b[1]], db: b[1] === 'V' ? 1 : 0, byte: Number(b[2]), bit: Number(b[3]), lunghezza: 1, tipo: 'bit' };
  const m = t.match(/^(AIW|VW|VD|VB)(\d+)$/);
  if (!m) throw new Error(`Indirizzo PLC non valido: "${testo}" (esempi: AIW16, VW100, VD200, Q0.3)`);
  const [, tipo, n] = m;
  if (tipo === 'AIW') return { area: AREE[areaAi] ?? Number(areaAi), db: 0, byte: Number(n), lunghezza: 2, tipo: 'int' };
  return { area: AREE.V, db: 1, byte: Number(n), lunghezza: tipo === 'VD' ? 4 : tipo === 'VW' ? 2 : 1, tipo: tipo === 'VD' ? 'real' : tipo === 'VW' ? 'int' : 'byte' };
}
