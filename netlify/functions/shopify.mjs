// Proxy verso l'Admin API di Shopify (GraphQL), sola lettura degli ordini.
// Le credenziali restano sul server come variabili d'ambiente Netlify:
//   SHOPIFY_SHOP            negozio, es. kashmir-brewing (o kashmir-brewing.myshopify.com)
//   SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET   app creata nel Dev Dashboard di Shopify con permesso read_orders
//                           (e read_all_orders per ordini più vecchi di 60 giorni), installata sul negozio
//   oppure SHOPIFY_TOKEN    token Admin API di una vecchia app personalizzata (shpat_…)
//   SHOPIFY_API_VERSION     facoltativo, default 2026-07
//   SUPABASE_URL, SUPABASE_ANON_KEY  per controllare chi chiama
//
// Uso dall'app:  /.netlify/functions/shopify?dal=2026-10-01
// Risponde: { documenti: [{ id, numero, data, cliente, stato, spedito, righe: [{ codice, nome, qta }] }], altri }
// data = giorno della prima spedizione, altrimenti dell'ordine.

import { autorizzato, json, dataValida } from '../lib/accesso.mjs';

const MAX = 100;
let cache = null; // { token, scade }

async function tokenShopify(negozio) {
  if (process.env.SHOPIFY_TOKEN) return process.env.SHOPIFY_TOKEN;
  if (cache && cache.scade > Date.now() + 60_000) return cache.token;
  const res = await fetch(`https://${negozio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Shopify: accesso non riuscito (${res.status}) ${await res.text()}`.slice(0, 300));
  const b = await res.json();
  cache = { token: b.access_token, scade: Date.now() + (Number(b.expires_in) || 3600) * 1000 };
  return cache.token;
}

const QUERY = `query ($q: String!, $dopo: String) {
  orders(first: 50, after: $dopo, query: $q, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name processedAt cancelledAt displayFinancialStatus displayFulfillmentStatus
      fulfillments(first: 5) { createdAt }
      lineItems(first: 100) { nodes { sku name variantTitle quantity currentQuantity } }
    }
  }
}`;

const STATI = { FULFILLED: 'spedito', PARTIALLY_FULFILLED: 'spedito in parte', UNFULFILLED: 'da spedire', IN_PROGRESS: 'in preparazione', ON_HOLD: 'in attesa', SCHEDULED: 'programmato' };

export default async req => {
  const negozio = (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const conToken = process.env.SHOPIFY_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
  if (!negozio || !conToken) return json({ errore: 'Shopify non configurato sul server' }, 503);
  if (req.method !== 'GET') return json({ errore: 'Solo lettura' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);
  const dal = dataValida(new URL(req.url).searchParams.get('dal'));
  if (!dal) return json({ errore: 'Data non valida' }, 400);
  const host = negozio.includes('.') ? negozio : `${negozio}.myshopify.com`;
  const versione = process.env.SHOPIFY_API_VERSION || '2026-07';

  try {
    const token = await tokenShopify(host);
    const ordini = [];
    let dopo = null, altri = false;
    for (;;) {
      const res = await fetch(`https://${host}/admin/api/${versione}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: QUERY, variables: { q: `processed_at:>=${dal} status:any`, dopo } }),
      });
      if (!res.ok) throw new Error(`Shopify: errore ${res.status} ${(await res.text()).slice(0, 200)}`);
      const b = await res.json();
      if (b.errors?.length) throw new Error(`Shopify: ${b.errors.map(e => e.message).join('; ')}`);
      const o = b.data.orders;
      ordini.push(...o.nodes);
      if (!o.pageInfo.hasNextPage) break;
      if (ordini.length >= MAX) { altri = true; break; }
      dopo = o.pageInfo.endCursor;
    }
    return json({
      altri,
      documenti: ordini.filter(o => !o.cancelledAt).map(o => {
        const spedizione = (o.fulfillments || []).map(f => f.createdAt).filter(Boolean).sort()[0];
        return {
          id: o.id.split('/').pop(),
          numero: `Ordine ${o.name}`,
          data: (spedizione || o.processedAt).slice(0, 10),
          cliente: '',
          stato: STATI[o.displayFulfillmentStatus] || String(o.displayFulfillmentStatus || '').toLowerCase(),
          spedito: !!spedizione,
          righe: o.lineItems.nodes.map(r => ({ codice: r.sku || '', nome: [r.name].filter(Boolean).join(''), qta: Number(r.currentQuantity ?? r.quantity) || 0 })).filter(r => r.qta > 0),
        };
      }),
    });
  } catch (e) {
    return json({ errore: e.message }, 500);
  }
};
