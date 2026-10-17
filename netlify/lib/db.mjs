// Accesso al database dal server (automazioni), con la chiave segreta di Supabase.
// La chiave salta le regole di accesso: questo modulo legge e scrive solo la tabella records
// (stesso formato dell'app, vedi js/sync.js) e le tabelle delle temperature.
// Variabili d'ambiente Netlify: SUPABASE_URL, SUPABASE_SERVICE_KEY

export function configurato() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}
const base = () => `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
const headers = (extra = {}) => ({
  apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra,
});

export async function rest(percorso, { method = 'GET', body, range, prefer } = {}) {
  const res = await fetch(`${base()}/${percorso}`, {
    method,
    headers: headers({ ...(range ? { Range: range } : {}), ...(prefer ? { Prefer: prefer } : {}) }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`Database: ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return res.status === 204 || method !== 'GET' && prefer?.includes('return=minimal') ? null : res.json();
}

// Record di uno o più tipi (senza gli eliminati, salvo ancheEliminati)
export async function tipi(elenco, { ancheEliminati = false } = {}) {
  const out = Object.fromEntries(elenco.map(t => [t, []]));
  const pagina = 1000;
  for (let da = 0; ; da += pagina) {
    const q = `records?select=dati,eliminato&tipo=in.(${elenco.map(encodeURIComponent).join(',')})${ancheEliminati ? '' : '&eliminato=is.false'}&order=id.asc`;
    const righe = await rest(q, { range: `${da}-${da + pagina - 1}` });
    for (const r of righe) (out[r.dati.tipo] ||= []).push({ ...r.dati, eliminato: r.eliminato || r.dati.eliminato || undefined });
    if (righe.length < pagina) break;
  }
  return out;
}

export async function leggi(id) {
  const r = await rest(`records?select=dati&id=eq.${encodeURIComponent(id)}`);
  return r[0]?.dati || null;
}

// Salva (inserisce o aggiorna) dei record: l'app li riceve alla prossima sincronizzazione
export async function salva(records) {
  if (!records.length) return;
  const ora = new Date().toISOString();
  const righe = records.map(r => {
    const { daSincronizzare: _d, ...dati } = { ...r, aggiornato: ora };
    return { id: r.id, tipo: r.tipo, aggiornato: ora, eliminato: !!r.eliminato, dati };
  });
  for (let i = 0; i < righe.length; i += 200) {
    await rest('records?on_conflict=id', { method: 'POST', body: righe.slice(i, i + 200), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}

export const nuovoId = prefisso => `${prefisso}-${crypto.randomUUID()}`;
