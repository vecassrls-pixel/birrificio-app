// Proxy verso l'API di Fatture in Cloud (https://developers.fattureincloud.it): letture, e la fattura dal carrello.
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
//                /.netlify/functions/fattureincloud?elenco=clienti    anagrafica clienti (permesso Clienti: lettura)
//                  → { clienti: [{ id, nome, piva, indirizzo, comune, telefono }] }
//   POST { azione: 'fattura', data, cliente: { id?, nome }, lordo, note, righe: [{ codice, nome, descrizione, qta, prezzo }],
//          accompagnatoria: { colli, peso, causale, destinazione, trasportatore } | null }
//                  crea la fattura (permesso Fatture: lettura e scrittura) → { id, numero, url }
// Risponde nello stesso formato del proxy Shopify:
//   { documenti: [{ id, numero, data, cliente, stato, righe: [{ codice, nome, qta }] }], altri }

import { autorizzato, puoScrivere, json, dataValida } from '../lib/accesso.mjs';
import * as fic from '../lib/fic.mjs';

const TIPI = ['invoice', 'delivery_note', 'receipt', 'credit_note', 'acquisti'];
const PERMESSO = {
  clienti: 'Il token di Fatture in Cloud non può leggere i clienti: nell\'app "Global Brewing" di Fatture in Cloud aggiungi il permesso Clienti in lettura e rigenera il token.',
  fattura: 'Il token di Fatture in Cloud non può creare fatture: nell\'app "Global Brewing" di Fatture in Cloud dai il permesso Fatture in lettura e scrittura (e Impostazioni in lettura, per le aliquote IVA) e rigenera il token.',
};

async function fattura(req) {
  if (!(await puoScrivere(req))) return json({ errore: 'Accesso non autorizzato' }, 401);
  let b;
  try { b = await req.json(); } catch { return json({ errore: 'Richiesta non valida' }, 400); }
  const data = dataValida(b?.data);
  const nome = String(b?.cliente?.nome || '').trim().slice(0, 200);
  const testo = (s, max) => String(s ?? '').trim().slice(0, max);
  const righe = (Array.isArray(b?.righe) ? b.righe : []).slice(0, 100).map(r => ({
    codice: testo(r?.codice, 60), nome: testo(r?.nome, 200), descrizione: testo(r?.descrizione, 500),
    qta: Number(r?.qta), prezzo: r?.prezzo === null || r?.prezzo === '' || r?.prezzo === undefined ? null : Number(r.prezzo),
  }));
  if (!data || !nome || !righe.length) return json({ errore: 'Servono data, cliente e almeno una riga' }, 400);
  if (righe.some(r => !r.nome || !(r.qta > 0) || (r.prezzo !== null && !(r.prezzo >= 0)))) return json({ errore: 'Righe non valide' }, 400);
  try {
    const c = await fic.client();
    const a = b.accompagnatoria;
    const accompagnatoria = a && typeof a === 'object' ? {
      colli: testo(a.colli, 20), peso: testo(a.peso, 20), causale: testo(a.causale, 100), destinazione: testo(a.destinazione, 300), trasportatore: testo(a.trasportatore, 100),
    } : null;
    return json(await fic.creaFattura(c, { data, cliente: { id: Number(b.cliente.id) || null, nome }, righe, lordo: !!b.lordo, note: testo(b.note, 1000), accompagnatoria }));
  } catch (e) {
    if (e.status === 401 || e.status === 403) return json({ errore: PERMESSO.fattura }, 502);
    return json({ errore: e.message }, e.status === 422 ? 400 : 500);
  }
}

export default async req => {
  if (!fic.configurato()) return json({ errore: 'Fatture in Cloud non configurato sul server' }, 503);
  if (req.method === 'POST') return fattura(req);
  if (req.method !== 'GET') return json({ errore: 'Metodo non ammesso' }, 405);
  if (!(await autorizzato(req))) return json({ errore: 'Accesso non autorizzato' }, 401);

  const url = new URL(req.url);
  const elenco = ['prodotti', 'clienti'].includes(url.searchParams.get('elenco')) ? url.searchParams.get('elenco') : '';
  const dal = dataValida(url.searchParams.get('dal'));
  const tipo = TIPI.includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'invoice';
  if (!dal && !elenco) return json({ errore: 'Data non valida' }, 400);

  try {
    const c = await fic.client();
    if (elenco === 'clienti') return json({ clienti: await fic.clienti(c) });
    if (elenco) return json({ prodotti: await fic.prodotti(c) });
    if (tipo === 'acquisti') return json(await fic.acquisti(c, { dal }));
    return json(await fic.documentiEmessi(c, { tipo, dal }));
  } catch (e) {
    if (elenco === 'clienti' && e.status === 403) return json({ errore: PERMESSO.clienti }, 502);
    if (elenco && e.status === 403) return json({ errore: 'Il token di Fatture in Cloud non può leggere i prodotti: nell\'app "Global Brewing" di Fatture in Cloud aggiungi il permesso Prodotti in lettura e rigenera il token.' }, 502);
    return json({ errore: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
  }
};
