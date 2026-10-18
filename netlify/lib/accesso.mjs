// Controlli comuni ai proxy verso servizi esterni (Fatture in Cloud, Shopify).
// Il token dell'utente deve essere valido e la sua email in utenti_autorizzati:
// la tabella, con le sue regole, restituisce la riga solo all'utente stesso.
export async function autorizzato(req) {
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

export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// data AAAA-MM-GG valida, altrimenti null
export const dataValida = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

// Può modificare i dati (admin o editore): stessa regola del database (puo_scrivere, migrazione_ruoli.sql)
export async function puoScrivere(req) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization') || '';
  if (!url || !anon || !/^Bearer .+/.test(auth)) return false;
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/puo_scrivere`, {
    method: 'POST', headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
  });
  return res.ok && (await res.json()) === true;
}
