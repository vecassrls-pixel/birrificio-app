// Proxy verso l'API di Brewfather (https://docs.brewfather.app/api).
// Le credenziali restano sul server come variabili d'ambiente Netlify:
//   BREWFATHER_USER_ID, BREWFATHER_API_KEY   (Brewfather > Impostazioni > API)
//   SUPABASE_URL, SUPABASE_ANON_KEY          (per controllare chi chiama)
// Risponde solo a utenti loggati nell'app e presenti in utenti_autorizzati.
// Solo lettura: batches, letture di fermentazione e ricette.
//
// Uso dall'app:  /.netlify/functions/brewfather?path=/batches&complete=true&limit=50

const BASE = 'https://api.brewfather.app/v2';
const CONSENTITI = [/^\/batches$/, /^\/batches\/[\w-]+$/, /^\/batches\/[\w-]+\/readings$/, /^\/recipes$/, /^\/recipes\/[\w-]+$/];

export default async req => {
  const user = process.env.BREWFATHER_USER_ID, key = process.env.BREWFATHER_API_KEY;
  if (!user || !key) return json({ errore: 'Brewfather non configurato sul server' }, 503);
  if (req.method !== 'GET') return json({ errore: 'Solo lettura' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);

  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '';
  if (!CONSENTITI.some(re => re.test(path))) return json({ errore: 'Percorso non consentito' }, 400);
  url.searchParams.delete('path');

  const res = await fetch(`${BASE}${path}?${url.searchParams}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64') },
  });
  const body = await res.text();
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const retry = res.headers.get('Retry-After');
  if (retry) headers['Retry-After'] = retry;
  return new Response(body, { status: res.status, headers });
};

// Il token dell'utente deve essere valido e la sua email in utenti_autorizzati:
// la tabella, con le sue regole, restituisce la riga solo all'utente stesso.
async function autorizzato(req) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization') || '';
  if (!url || !anon || !/^Bearer .+/.test(auth)) return false;
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/utenti_autorizzati?select=email&limit=1`, {
    headers: { apikey: anon, Authorization: auth },
  });
  if (!res.ok) return false;
  const righe = await res.json();
  return Array.isArray(righe) && righe.length > 0;
}

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
