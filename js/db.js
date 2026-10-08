// Archivio locale (IndexedDB). Tutti i dati vivono qui: l'app funziona offline
// e la sincronizzazione cloud legge/scrive solo attraverso questo modulo.
//
// Ogni record ha: id, tipo ('cotta' | 'fv' | ...), aggiornato (ISO), eliminato,
// e daSincronizzare (1 se modificato in locale e non ancora inviato al cloud).

const DB_NAME = 'birrificio';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const rec = db.createObjectStore('records', { keyPath: 'id' });
        rec.createIndex('tipo', 'tipo');
        rec.createIndex('daSincronizzare', 'daSincronizzare');
        db.createObjectStore('meta', { keyPath: 'chiave' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const asPromise = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function nuovoId(prefisso) {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return `${prefisso}-${r}`;
}

export async function tutti(tipo, { ancheEliminati = false } = {}) {
  const rows = await tx('records', 'readonly', s => asPromise(s.index('tipo').getAll(tipo)));
  return ancheEliminati ? rows : rows.filter(r => !r.eliminato);
}

export async function leggi(id) {
  return tx('records', 'readonly', s => asPromise(s.get(id)));
}

// Salvataggio da parte dell'utente: marca il record da sincronizzare.
export async function salva(record) {
  const r = { ...record, aggiornato: new Date().toISOString(), daSincronizzare: 1 };
  await tx('records', 'readwrite', s => asPromise(s.put(r)));
  notifica();
  return r;
}

export async function salvaMolti(records, { daSincronizzare = 1 } = {}) {
  const ora = new Date().toISOString();
  await tx('records', 'readwrite', s => {
    for (const rec of records) s.put({ aggiornato: ora, ...rec, daSincronizzare });
  });
  notifica();
}

export async function elimina(id) {
  const r = await leggi(id);
  if (r) await salva({ ...r, eliminato: true });
}

export async function daInviare() {
  return tx('records', 'readonly', s => asPromise(s.index('daSincronizzare').getAll(1)));
}

// Applica record arrivati dal cloud: vince la modifica più recente.
export async function applicaRemoti(remoti) {
  let cambiati = 0;
  await tx('records', 'readwrite', async s => {
    for (const r of remoti) {
      const locale = await asPromise(s.get(r.id));
      if (!locale || (r.aggiornato || '') > (locale.aggiornato || '')) {
        s.put({ ...r, daSincronizzare: 0 });
        cambiati++;
      }
    }
  });
  if (cambiati) notifica();
  return cambiati;
}

export async function segnaInviati(records) {
  await tx('records', 'readwrite', async s => {
    for (const r of records) {
      const attuale = await asPromise(s.get(r.id));
      // se nel frattempo è stato modificato di nuovo, resta da inviare
      if (attuale && attuale.aggiornato === r.aggiornato) s.put({ ...attuale, daSincronizzare: 0 });
    }
  });
}

export async function meta(chiave, valore) {
  if (valore === undefined) {
    const r = await tx('meta', 'readonly', s => asPromise(s.get(chiave)));
    return r ? r.valore : undefined;
  }
  await tx('meta', 'readwrite', s => asPromise(s.put({ chiave, valore })));
}

export async function esporta() {
  const records = await tx('records', 'readonly', s => asPromise(s.getAll()));
  return { app: 'birrificio', versione: 1, esportato: new Date().toISOString(), records };
}

// Cancella tutti i dati di questo dispositivo (all'uscita dall'account)
export async function svuota() {
  await tx('records', 'readwrite', s => asPromise(s.clear()));
  await tx('meta', 'readwrite', s => asPromise(s.clear()));
}

const ascoltatori = new Set();
export function onCambio(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function notifica() { for (const fn of ascoltatori) fn(); }
