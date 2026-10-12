// Proxy verso l'API di Fatture in Cloud (https://developers.fattureincloud.it), sola lettura.
// Le credenziali restano sul server come variabili d'ambiente Netlify:
//   FIC_TOKEN        token di accesso (Fatture in Cloud > Impostazioni > App collegate / sviluppatori, token manuale
//                    con permesso di lettura sui documenti emessi: issued_documents.invoices:r e .delivery_notes:r)
//   FIC_COMPANY_ID   id dell'azienda (facoltativo: se manca si usa la prima azienda collegata al token, da GET /user/companies)
//   SUPABASE_URL, SUPABASE_ANON_KEY  per controllare chi chiama
//
// Uso dall'app:  /.netlify/functions/fattureincloud?dal=2026-10-01&tipo=invoice
// Risponde nello stesso formato del proxy Shopify:
//   { documenti: [{ id, numero, data, cliente, stato, righe: [{ codice, nome, qta }] }], altri }

import { autorizzato, json, dataValida } from '../lib/accesso.mjs';

const BASE = 'https://api-v2.fattureincloud.it';
const TIPI = ['invoice', 'delivery_note', 'receipt'];
const MAX = 60; // documenti per chiamata: oltre, l'app chiede di cercare di nuovo

export default async req => {
  const token = process.env.FIC_TOKEN;
  if (!token) return json({ errore: 'Fatture in Cloud non configurato sul server' }, 503);
  if (req.method !== 'GET') return json({ errore: 'Solo lettura' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);

  const url = new URL(req.url);
  const dal = dataValida(url.searchParams.get('dal'));
  const tipo = TIPI.includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'invoice';
  if (!dal) return json({ errore: 'Data non valida' }, 400);

  const chiama = async (path, params = {}, conAzienda = true) => {
    const res = await fetch(`${BASE}${conAzienda ? `/c/${encodeURIComponent(azienda)}` : ''}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const b = await res.json(); msg = b.error?.message || b.error?.validation_result?.toString() || msg; } catch { /* non JSON */ }
      throw Object.assign(new Error(`Fatture in Cloud: ${msg} (${res.status})`), { status: res.status });
    }
    return res.json();
  };

  let azienda = process.env.FIC_COMPANY_ID;
  try {
    if (!azienda) {
      const u = await chiama('/user/companies', {}, false);
      azienda = u.data?.companies?.[0]?.id;
      if (!azienda) return json({ errore: 'Il token di Fatture in Cloud non ha accesso a nessuna azienda' }, 502);
    }
    const docs = [];
    let altri = false;
    for (let pagina = 1; ; pagina++) {
      const r = await chiama('/issued_documents', {
        type: tipo, fieldset: 'detailed', sort: 'date', page: pagina, per_page: 50, q: `date >= '${dal}'`,
      });
      docs.push(...(r.data || []));
      if (docs.length >= MAX) { altri = docs.length > MAX || pagina < (r.last_page || 1); break; }
      if (pagina >= (r.last_page || 1)) break;
    }
    const scelti = docs.slice(0, MAX);
    // l'elenco di solito porta già le righe; se no, si legge ogni documento (5 alla volta)
    for (let i = 0; i < scelti.length; i += 5) {
      await Promise.all(scelti.slice(i, i + 5).map(async (d, j) => {
        if (Array.isArray(d.items_list)) return;
        scelti[i + j] = (await chiama(`/issued_documents/${d.id}`, { fieldset: 'detailed' })).data;
      }));
    }
    return json({
      altri,
      documenti: scelti.map(d => ({
        id: String(d.id),
        numero: `${tipo === 'delivery_note' ? 'DDT' : tipo === 'receipt' ? 'Ricevuta' : 'Fattura'} ${d.number ?? ''}${d.numeration || ''}`.trim(),
        data: d.date,
        cliente: d.entity?.name || '',
        stato: '',
        righe: (d.items_list || []).filter(r => Number(r.qty) > 0).map(r => ({ codice: r.code || '', nome: r.name || r.description || '', qta: Number(r.qty) })),
      })),
    });
  } catch (e) {
    return json({ errore: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
  }
};
