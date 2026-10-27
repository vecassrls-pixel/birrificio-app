// Consegne degli ordini piccoli: come arriva l'ordine (ritiro, giro in zona, corriere), giro del giorno
// con le tappe e il carico del furgone, testi per WhatsApp. Senza DOM: lo usano le viste ordini e giro.

import { nomeProdotto, daChiave } from './birra.js';
import { MODI_CONSEGNA } from './portale.js';
import { oggiISO } from './dominio.js';

export const APERTI = ['nuovo', 'confermato', 'pronto', 'spedito'];
export const ICONA_MODO = { ritiro: '🏠', zona: '🚐', corriere: '📦' };
export const nomeModo = o => MODI_CONSEGNA[o.modo] || 'Da decidere';

// Passo successivo di un ordine aperto: { stato, testo } (null = nessuno)
export function prossimoPasso(o) {
  if (o.stato === 'nuovo') return { stato: 'confermato', testo: 'Conferma' };
  if (o.stato === 'confermato') return { stato: 'pronto', testo: 'Preparato' };
  if (o.stato === 'pronto') {
    if (o.modo === 'corriere') return { stato: 'spedito', testo: 'Spedito' };
    return { stato: 'consegnato', testo: o.modo === 'ritiro' ? 'Ritirato' : 'Consegnato' };
  }
  if (o.stato === 'spedito') return { stato: 'consegnato', testo: 'Consegnato' };
  return null;
}

export const indirizzoCompleto = o => [o.indirizzo, o.comune].map(x => String(x || '').trim()).filter(Boolean).join(', ');
export const linkMappa = o => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(indirizzoCompleto(o))}`;

// Percorso su Google Maps dalla posizione attuale passando per le tappe in ordine (fino a 10 tappe per link)
export function linkPercorso(tappe) {
  const ind = tappe.map(indirizzoCompleto).filter(Boolean);
  if (!ind.length) return '';
  const fine = ind[ind.length - 1], mezzo = ind.slice(0, -1).slice(0, 9);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(fine)}${mezzo.length ? `&waypoints=${encodeURIComponent(mezzo.join('|'))}` : ''}`;
}

// Ordini del giro di un giorno: in zona, aperti, con consegna fino a quel giorno (i ritardi restano dentro).
// Ordinati come li ha messi Romain (giroPosto), poi per comune.
export function tappeGiro(ordini, giorno) {
  return ordini.filter(o => o.modo === 'zona' && ['confermato', 'pronto', 'spedito'].includes(o.stato) && o.consegna && o.consegna <= giorno)
    .sort((a, b) => (a.giroPosto ?? 999) - (b.giroPosto ?? 999) || String(a.comune || '').localeCompare(String(b.comune || ''), 'it') || String(a.cliente).localeCompare(String(b.cliente), 'it'));
}

// Cosa caricare sul furgone: pezzi per prodotto, fusti e lattine separati
export function caricoGiro(tappe) {
  const per = new Map();
  for (const o of tappe) for (const r of o.righe || []) per.set(r.prodotto, (per.get(r.prodotto) || 0) + (Number(r.pezzi) || 0));
  return [...per].map(([prodotto, pezzi]) => ({ prodotto, nome: nomeProdotto(prodotto), tipo: daChiave(prodotto).tipo, pezzi }))
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome, 'it'));
}

const nome1 = o => String(o.cliente || '').split(/\s+/)[0];
export function messaggioOrdine(o, dataIT) {
  const ciao = `Ciao ${nome1(o)}, `;
  if (o.stato === 'spedito') return `${ciao}il tuo ordine è partito con ${o.corriere || 'il corriere'}${o.colli ? ` (${o.colli} ${o.colli === 1 ? 'collo' : 'colli'})` : ''}.${o.tracking ? ` Numero di spedizione: ${o.tracking}.` : ''} Grazie!`;
  if (o.modo === 'zona' && o.consegna) return `${ciao}ti confermiamo la consegna del tuo ordine ${o.consegna === oggiISO() ? 'oggi' : `il ${dataIT(o.consegna)}`}. A presto!`;
  if (o.modo === 'ritiro') return `${ciao}il tuo ordine è pronto, puoi passare a ritirarlo${o.consegna ? ` dal ${dataIT(o.consegna)}` : ''}. A presto!`;
  return `${ciao}abbiamo ricevuto il tuo ordine del ${dataIT(o.data)}. `;
}
export const messaggioArrivo = o => `Ciao ${nome1(o)}, sto arrivando con il tuo ordine. A tra poco!`;
