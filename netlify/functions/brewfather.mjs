// Proxy verso l'API di Brewfather (https://docs.brewfather.app/api).
// Le credenziali restano sul server come variabili d'ambiente Netlify:
//   BREWFATHER_USER_ID, BREWFATHER_API_KEY   (Brewfather > Impostazioni > API)
//   SUPABASE_URL, SUPABASE_ANON_KEY          (per controllare chi chiama)
// Risponde solo a utenti loggati nell'app e presenti in utenti_autorizzati.
// Lettura: batches, letture di fermentazione e ricette.
// Scrittura (PATCH /batches/:id): solo stato e valori misurati della cotta, campi elencati in MODIFICABILI.
// Per scrivere la chiave API di Brewfather deve avere il permesso "Edit Batches".
//
// Uso dall'app:  /.netlify/functions/brewfather?path=/batches&complete=true&limit=50

const BASE = 'https://api.brewfather.app/v2';
const MODIFICABILI = ['status', 'measuredMashPh', 'measuredOg', 'measuredFg', 'measuredBatchSize', 'measuredBottlingSize'];
const STATI = ['Planning', 'Brewing', 'Fermenting', 'Conditioning', 'Completed', 'Archived'];
const CONSENTITI = [/^\/batches$/, /^\/batches\/[\w-]+$/, /^\/batches\/[\w-]+\/readings$/, /^\/recipes$/, /^\/recipes\/[\w-]+$/];

export default async req => {
  const user = process.env.BREWFATHER_USER_ID, key = process.env.BREWFATHER_API_KEY;
  if (!user || !key) return json({ errore: 'Brewfather non configurato sul server' }, 503);
  if (req.method !== 'GET' && req.method !== 'PATCH') return json({ errore: 'Metodo non consentito' }, 405);
  if (!(await autorizzato(req, req.method === 'PATCH'))) return json({ errore: 'Accesso non autorizzato' }, 401);

  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '';
  url.searchParams.delete('path');
  const basic = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

  if (req.method === 'PATCH') {
    if (!/^\/batches\/[\w-]+$/.test(path)) return json({ errore: 'Percorso non consentito' }, 400);
    let dati;
    try { dati = await req.json(); } catch { return json({ errore: 'Dati non validi' }, 400); }
    const corpo = {};
    for (const k of MODIFICABILI) {
      const v = dati?.[k];
      if (v === undefined) continue;
      if (k === 'status' ? STATI.includes(v) : typeof v === 'number' && Number.isFinite(v)) corpo[k] = v;
      else return json({ errore: `Valore non valido: ${k}` }, 400);
    }
    if (!Object.keys(corpo).length) return json({ errore: 'Niente da inviare' }, 400);
    const res = await fetch(`${BASE}${path}`, { method: 'PATCH', headers: { Authorization: basic, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const testo = await res.text();
    return res.ok ? json({ ok: true, risposta: testo }, 200) : json({ errore: testo || res.statusText }, res.status);
  }

  if (!CONSENTITI.some(re => re.test(path))) return json({ errore: 'Percorso non consentito' }, 400);
  const res = await fetch(`${BASE}${path}?${url.searchParams}`, {
    headers: { Authorization: basic },
  });
  const body = await res.text();
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const retry = res.headers.get('Retry-After');
  if (retry) headers['Retry-After'] = retry;
  return new Response(body, { status: res.status, headers });
};

// Il token dell'utente deve essere valido e la sua email in utenti_autorizzati:
// la tabella, con le sue regole, restituisce la riga solo all'utente stesso.
// Per scrivere serve un profilo che può modificare (non "lettore").
async function autorizzato(req, scrittura = false) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization') || '';
  if (!url || !anon || !/^Bearer .+/.test(auth)) return false;
  const base = url.replace(/\/$/, '');
  if (scrittura) {
    // stessa regola del database: puo_scrivere() (admin o editore, vedi migrazione_ruoli.sql)
    const r = await fetch(`${base}/rest/v1/rpc/puo_scrivere`, { method: 'POST', headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
    return r.ok && (await r.json()) === true;
  }
  const res = await fetch(`${base}/rest/v1/utenti_autorizzati?select=email&limit=1`, {
    headers: { apikey: anon, Authorization: auth },
  });
  if (!res.ok) return false;
  const righe = await res.json();
  return Array.isArray(righe) && righe.length > 0;
}

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
