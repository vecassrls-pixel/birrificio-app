// Buffer offline: se internet cade, le letture dello storico finiscono in un file (una riga JSON per lettura)
// e si inviano appena Supabase torna raggiungibile. Il file sopravvive ai riavvii del mini PC.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class BufferOffline {
  constructor({ file, maxRighe = 200000 }) {
    this.file = file;
    this.maxRighe = maxRighe;
    mkdirSync(dirname(file), { recursive: true });
  }

  leggi() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).flatMap(r => { try { return [JSON.parse(r)]; } catch { return []; } });
  }

  quante() { return this.leggi().length; }

  aggiungi(righe) {
    if (!righe.length) return;
    appendFileSync(this.file, righe.map(r => JSON.stringify(r)).join('\n') + '\n');
    const tutte = this.leggi();
    // troppe righe (mesi senza internet): si tengono le più recenti
    if (tutte.length > this.maxRighe) this._scrivi(tutte.slice(-this.maxRighe));
  }

  _scrivi(righe) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, righe.map(r => JSON.stringify(r)).join('\n') + (righe.length ? '\n' : ''));
    renameSync(tmp, this.file);
  }

  // invia a blocchi; si ferma al primo errore e tiene il resto per la volta dopo
  async svuota(invia, blocco = 500) {
    const righe = this.leggi();
    let inviate = 0;
    try {
      for (let i = 0; i < righe.length; i += blocco) {
        await invia(righe.slice(i, i + blocco));
        inviate = i + Math.min(blocco, righe.length - i);
      }
    } finally {
      if (inviate) {
        // righe aggiunte nel frattempo (non dovrebbe succedere: il gateway è un solo processo) restano
        const ora = this.leggi();
        this._scrivi(ora.slice(inviate));
      }
    }
    return inviate;
  }
}
