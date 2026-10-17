// Lettura degli ordini dall'Admin API di Shopify (GraphQL), usata dal proxy dell'app
// (netlify/functions/shopify.mjs) e dall'import automatico (netlify/lib/automazioni.mjs).
// Variabili d'ambiente: vedi netlify/functions/shopify.mjs

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

export const negozio = () => (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
export const configurato = () => !!negozio() && !!(process.env.SHOPIFY_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET));

// { documenti: [{ id, numero, data, cliente, stato, spedito, righe: [{ codice, nome, qta }] }], altri }
export async function ordini(dal) {
  const host = negozio().includes('.') ? negozio() : `${negozio()}.myshopify.com`;
  const versione = process.env.SHOPIFY_API_VERSION || '2026-07';
  const token = await tokenShopify(host);
  const lista = [];
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
    lista.push(...o.nodes);
    if (!o.pageInfo.hasNextPage) break;
    if (lista.length >= MAX) { altri = true; break; }
    dopo = o.pageInfo.endCursor;
  }
  return {
    altri,
    documenti: lista.filter(o => !o.cancelledAt).map(o => {
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
  };
}
