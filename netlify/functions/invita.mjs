// Invito di un utente direttamente dall'app (Impostazioni → Utenti), senza passare da Supabase.
// Variabili d'ambiente Netlify:
//   SUPABASE_URL, SUPABASE_ANON_KEY   per controllare chi chiama
//   SUPABASE_SERVICE_KEY              chiave segreta di Supabase (Project Settings → API Keys → secret / service_role):
//                                     resta solo su Netlify, serve a mandare l'email di invito
// Solo l'amministratore può invitare, e solo email già presenti in utenti_autorizzati (aggiunte dall'app).
// Se la persona è già registrata riceve invece l'email per impostare una nuova password.
//
// Uso dall'app:  POST /.netlify/functions/invita  { email }   → { ok, tipo: 'invito'|'recupero' }

import { json } from '../lib/accesso.mjs';

export default async req => {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, segreta = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !anon || !segreta) return json({ errore: 'Inviti dall\'app non configurati sul server' }, 503);
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer .+/.test(auth)) return json({ errore: 'Accesso non autorizzato' }, 401);
  const base = url.replace(/\/$/, '');
  const comeUtente = { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' };

  // chi chiama dev'essere admin (stessa regola del database, vedi migrazione_ruoli.sql)
  const r = await fetch(`${base}/rest/v1/rpc/ruolo_utente`, { method: 'POST', headers: comeUtente, body: '{}' });
  if (!r.ok || (await r.json()) !== 'admin') return json({ errore: 'Solo l\'amministratore può invitare' }, 403);

  let email;
  try { email = String((await req.json())?.email || '').trim().toLowerCase(); } catch { email = ''; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ errore: 'Email non valida' }, 400);
  // l'email deve essere già tra gli autorizzati (l'admin con le sue regole vede tutta la tabella)
  const t = await fetch(`${base}/rest/v1/utenti_autorizzati?select=email&email=ilike.${encodeURIComponent(email)}`, { headers: comeUtente });
  const righe = t.ok ? await t.json() : [];
  if (!righe.length) return json({ errore: 'Aggiungi prima l\'email all\'elenco degli utenti' }, 400);

  // le chiavi segrete nuove (sb_secret_…) vanno solo in apikey, quelle vecchie (JWT) anche in Authorization
  const comeServer = { apikey: segreta, 'Content-Type': 'application/json', ...(segreta.startsWith('eyJ') ? { Authorization: `Bearer ${segreta}` } : {}) };
  const inv = await fetch(`${base}/auth/v1/invite`, { method: 'POST', headers: comeServer, body: JSON.stringify({ email }) });
  if (inv.ok) return json({ ok: true, tipo: 'invito' });
  const err = await inv.json().catch(() => ({}));
  const msg = err.msg || err.message || err.error_description || inv.statusText;
  // già registrato: email per impostare la password
  if (inv.status === 422 || /already/i.test(msg)) {
    const rec = await fetch(`${base}/auth/v1/recover`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (rec.ok) return json({ ok: true, tipo: 'recupero' });
    const e = await rec.json().catch(() => ({}));
    return json({ errore: `Utente già registrato, email per la password non inviata (${e.msg || e.message || rec.statusText}). Da Supabase: Users → ⋯ → Send password recovery` }, 502);
  }
  return json({ errore: `Invito non riuscito: ${msg}` }, inv.status === 429 ? 429 : 502);
};
