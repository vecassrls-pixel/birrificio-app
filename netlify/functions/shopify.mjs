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
// Risponde: { documenti: [{ id, numero, data, cliente, stato, spedito, righe: [{ codice, nome, qta, importo }], ordinato, totale, … }], altri }
// (campi completi in netlify/lib/shopify.mjs)
// data = giorno della prima spedizione, altrimenti dell'ordine.

import { autorizzato, json, dataValida } from '../lib/accesso.mjs';
import * as shopify from '../lib/shopify.mjs';

export default async req => {
  if (!shopify.configurato()) return json({ errore: 'Shopify non configurato sul server' }, 503);
  if (req.method !== 'GET') return json({ errore: 'Solo lettura' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);
  const dal = dataValida(new URL(req.url).searchParams.get('dal'));
  if (!dal) return json({ errore: 'Data non valida' }, 400);
  try {
    return json(await shopify.ordini(dal));
  } catch (e) {
    return json({ errore: e.message }, 500);
  }
};
