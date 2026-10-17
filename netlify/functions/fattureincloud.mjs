// Proxy verso l'API di Fatture in Cloud (https://developers.fattureincloud.it), sola lettura.
// Le credenziali restano sul server come variabili d'ambiente Netlify:
//   FIC_TOKEN        token di accesso (Fatture in Cloud > Impostazioni > App collegate / sviluppatori, token manuale
//                    con permesso di lettura sui documenti emessi: issued_documents.invoices:r e .delivery_notes:r,
//                    sui documenti ricevuti per gli acquisti)
//   FIC_COMPANY_ID   id dell'azienda (facoltativo: se manca si usa la prima azienda collegata al token, da GET /user/companies)
//   SUPABASE_URL, SUPABASE_ANON_KEY  per controllare chi chiama
//
// Uso dall'app:  /.netlify/functions/fattureincloud?dal=2026-10-01&tipo=invoice   (invoice, delivery_note, receipt, credit_note)
//                /.netlify/functions/fattureincloud?dal=2026-10-01&tipo=acquisti  documenti dei fornitori
//                /.netlify/functions/fattureincloud?elenco=prodotti   anagrafica prodotti (serve il permesso Prodotti: lettura)
//                  → { prodotti: [{ id, nome, codice }] }
// Risponde nello stesso formato del proxy Shopify:
//   { documenti: [{ id, numero, data, cliente, stato, righe: [{ codice, nome, qta }] }], altri }

import { autorizzato, json, dataValida } from '../lib/accesso.mjs';
import * as fic from '../lib/fic.mjs';

const TIPI = ['invoice', 'delivery_note', 'receipt', 'credit_note', 'acquisti'];

export default async req => {
  if (!fic.configurato()) return json({ errore: 'Fatture in Cloud non configurato sul server' }, 503);
  if (req.method !== 'GET') return json({ errore: 'Solo lettura' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);

  const url = new URL(req.url);
  const elenco = url.searchParams.get('elenco') === 'prodotti';
  const dal = dataValida(url.searchParams.get('dal'));
  const tipo = TIPI.includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'invoice';
  if (!dal && !elenco) return json({ errore: 'Data non valida' }, 400);

  try {
    const c = await fic.client();
    if (elenco) return json({ prodotti: await fic.prodotti(c) });
    if (tipo === 'acquisti') return json(await fic.acquisti(c, { dal }));
    return json(await fic.documentiEmessi(c, { tipo, dal }));
  } catch (e) {
    if (elenco && e.status === 403) return json({ errore: 'Il token di Fatture in Cloud non può leggere i prodotti: nell\'app "Global Brewing" di Fatture in Cloud aggiungi il permesso Prodotti in lettura e rigenera il token.' }, 502);
    return json({ errore: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
  }
};
