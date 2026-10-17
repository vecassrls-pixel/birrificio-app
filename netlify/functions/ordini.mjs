// Ordini dei clienti online (pagina pubblica ordina.html, senza login: vale il token personale del cliente).
//   GET  ?t=<token>                                   → { cliente, catalogo, ordini } birre disponibili con i prezzi del suo listino
//   POST { t, righe: [{ prodotto, pezzi }], note, consegna } → salva l'ordine (record 'ordinecliente') e avvisa su Telegram
// Il token si crea nell'app (Birra → Clienti → Link ordini) e si può disattivare in ogni momento.

import { json, dataValida } from '../lib/accesso.mjs';
import * as db from '../lib/db.mjs';
import * as telegram from '../lib/telegram.mjs';
import { ID_IMP, impostazioni, oraItalia } from '../lib/automazioni.mjs';
import { durateTipiche, dataIT, numIT } from '../../js/dominio.js';
import { ID_IMPOSTAZIONI, nomeProdotto } from '../../js/birra.js';
import { esc } from '../../js/riepilogo.js';
import { catalogoCliente, righeOrdine, tokenValido, totaleOrdine } from '../../js/portale.js';

async function clienteDa(token) {
  if (!tokenValido(token)) return null;
  const r = await db.rest(`records?select=dati&tipo=eq.cliente&eliminato=is.false&dati->portale->>token=eq.${token}&limit=1`);
  const c = r[0]?.dati;
  return c && c.portale?.attivo !== false ? c : null;
}

async function catalogo(cliente, oggi) {
  const [t, impBirra] = await Promise.all([db.tipi(['cotta', 'movbirra', 'inventariobirra', 'prodottobirra', 'listino']), db.leggi(ID_IMPOSTAZIONI)]);
  if (!impBirra?.inizio || impBirra.eliminato) return [];
  const datiBirra = { cotte: t.cotta, durate: durateTipiche(t.cotta), movimenti: t.movbirra, inventari: t.inventariobirra, prodotti: t.prodottobirra, impostazioni: impBirra };
  return catalogoCliente(datiBirra, t.listino, cliente, oggi);
}

export default async req => {
  if (!db.configurato()) return json({ errore: 'Servizio non disponibile' }, 503);
  const oggi = oraItalia().data;
  try {
    if (req.method === 'GET') {
      const cliente = await clienteDa(new URL(req.url).searchParams.get('t'));
      if (!cliente) return json({ errore: 'Link non valido o disattivato: chiedi un link nuovo al birrificio' }, 404);
      const [cat, ordini] = await Promise.all([
        catalogo(cliente, oggi),
        db.rest(`records?select=dati&tipo=eq.ordinecliente&eliminato=is.false&dati->>clienteId=eq.${encodeURIComponent(cliente.id)}&order=aggiornato.desc&limit=5`),
      ]);
      return json({
        cliente: cliente.nome, oggi, catalogo: cat,
        ordini: ordini.map(o => ({ data: o.dati.data, consegna: o.dati.consegna, stato: o.dati.stato, righe: o.dati.righe.map(r => ({ nome: nomeProdotto(r.prodotto), pezzi: r.pezzi })) })),
      });
    }
    if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
    let corpo;
    try { corpo = await req.json(); } catch { return json({ errore: 'Richiesta non valida' }, 400); }
    const cliente = await clienteDa(corpo?.t);
    if (!cliente) return json({ errore: 'Link non valido o disattivato' }, 404);
    const cat = await catalogo(cliente, oggi);
    const { righe, errori } = righeOrdine(cat, corpo.righe);
    if (errori.length) return json({ errore: errori.join('. ') }, 409);
    if (!righe.length) return json({ errore: 'L\'ordine è vuoto' }, 400);
    const consegna = dataValida(corpo.consegna) && corpo.consegna >= oggi ? corpo.consegna : '';
    const note = String(corpo.note || '').trim().slice(0, 1000);
    const ordine = { id: db.nuovoId('ordinecliente'), tipo: 'ordinecliente', cliente: cliente.nome, clienteId: cliente.id, data: oggi, consegna, righe, note, stato: 'nuovo', creato: new Date().toISOString() };
    await db.salva([ordine]);
    if (telegram.configurato()) {
      const imp = impostazioni(await db.leggi(ID_IMP));
      const tot = totaleOrdine(righe);
      const testo = [`🛒 <b>Nuovo ordine da ${esc(cliente.nome)}</b>`, ...righe.map(r => `${r.pezzi} × ${esc(nomeProdotto(r.prodotto))}`),
        consegna ? `Consegna richiesta: ${dataIT(consegna)}` : '', note ? `<i>${esc(note)}</i>` : '', tot ? `Totale circa ${numIT(tot, 2)} €` : '',
        process.env.URL ? `<a href="${esc(process.env.URL)}/#/ordini-clienti">Apri gli ordini</a>` : ''].filter(Boolean).join('\n');
      await telegram.invia(testo, imp.chatId || undefined).catch(() => {}); // l'ordine è salvato anche se Telegram non risponde
    }
    return json({ ok: true });
  } catch (e) {
    return json({ errore: `Errore del server: ${e.message}` }, 500);
  }
};
