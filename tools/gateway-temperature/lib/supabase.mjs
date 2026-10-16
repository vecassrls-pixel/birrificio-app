// Invio a Supabase (REST, senza librerie) con la chiave segreta del progetto.
// La chiave segreta salta le regole di accesso: sta SOLO nel config.json del gateway (permessi 600).

export class Supabase {
  constructor({ url, chiave, timeoutMs = 15000 }) {
    if (!url || !chiave || /INCOLLA|XXXX/.test(url + chiave)) throw new Error('Supabase non configurato: compilare supabase.url e supabase.chiave in config.json');
    this.base = url.replace(/\/$/, '') + '/rest/v1/';
    // le chiavi segrete nuove (sb_secret_…) vanno solo in apikey, quelle vecchie (JWT service_role) anche in Authorization
    this.headers = { apikey: chiave, 'Content-Type': 'application/json', ...(chiave.startsWith('eyJ') ? { Authorization: `Bearer ${chiave}` } : {}) };
    this.timeoutMs = timeoutMs;
  }

  async _post(tabella, righe, { conflitto, ignora = false }) {
    const res = await fetch(`${this.base}${tabella}?on_conflict=${conflitto}`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: `resolution=${ignora ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(righe),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Supabase ${tabella}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  // stato attuale: una riga per FV, sovrascritta
  aggiornaAttuali(righe) { return righe.length ? this._post('temperature_attuali', righe, { conflitto: 'fv' }) : null; }
  // storico: le righe già presenti (stesso FV e ora) si ignorano, così il buffer offline si può rimandare
  inserisciStorico(righe) { return righe.length ? this._post('letture_temperature', righe, { conflitto: 'fv,ts', ignora: true }) : null; }
  // sensori: si creano quelli mancanti, le soglie già scritte non si toccano
  registraSensori(righe) { return righe.length ? this._post('sensori', righe, { conflitto: 'fv', ignora: true }) : null; }

  async prova() {
    const res = await fetch(`${this.base}sensori?select=fv&limit=1`, { headers: this.headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404) throw new Error('tabelle non trovate: eseguire supabase/migrazione_temperature.sql');
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return true;
  }
}
