// Lettura dei termostati ESP32 di FV6-FV7 (firmware ESPHome in tools/esphome) tramite il loro web server.
// Solo richieste GET: il gateway non cambia il setpoint (lo si cambia dalla pagina web della scheda o dal display).
//
//   GET http://<host>/sensor/temperatura           → {"id":"sensor-temperatura","value":18.3,"state":"18.3 °C"}
//   GET http://<host>/number/setpoint              → {"id":"number-setpoint","value":18,"state":"18.0"}
//   GET http://<host>/binary_sensor/raffreddamento → {"id":"binary_sensor-raffreddamento","value":true,"state":"ON"}
//   GET http://<host>/binary_sensor/sonda_ok       → sonda valida (se OFF il relè è forzato spento)

async function leggiJson(url, { timeoutMs, utente, password }) {
  const headers = utente ? { Authorization: `Basic ${Buffer.from(`${utente}:${password || ''}`).toString('base64')}` } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 401) throw new Error('utente o password del web server ESPHome errati');
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return res.json();
}

const numero = j => (typeof j?.value === 'number' && Number.isFinite(j.value) ? j.value : null);

export async function leggiEsp32(d, { timeoutMs = 3000 } = {}) {
  const base = `http://${d.host}`;
  const opz = { timeoutMs, utente: d.utente, password: d.password };
  const e = d.entita || {};
  const [t, sp, raf, ok] = await Promise.all([
    leggiJson(`${base}/sensor/${e.temperatura || 'temperatura'}`, opz),
    leggiJson(`${base}/number/${e.setpoint || 'setpoint'}`, opz).catch(() => null),
    leggiJson(`${base}/binary_sensor/${e.raffreddamento || 'raffreddamento'}`, opz).catch(() => null),
    leggiJson(`${base}/binary_sensor/${e.sonda_ok || 'sonda_ok'}`, opz).catch(() => null),
  ]);
  const temperatura = numero(t);
  const errore = ok && ok.value === false ? 'sonda non valida (relè spento per sicurezza)' : temperatura === null ? 'sonda non valida' : null;
  return {
    temperatura: errore ? null : temperatura,
    setpoint: numero(sp),
    raffreddamento: typeof raf?.value === 'boolean' ? raf.value : null,
    errore,
  };
}
