// Previsioni dalle vendite: quanto dura la birra in magazzino (e quando pianificare la prossima cotta)
// e quali clienti non ordinano da più del loro solito. Senza DOM: le usano le viste e le automazioni sul server.

import { addGiorni, diffGiorni, fineCotta, gruppoCotta, nomeBirra, oggiISO, statoCotta, DURATA_DEFAULT } from './dominio.js';

export const SETTIMANE_VENDITE = 8; // vendite considerate per la media
export const MARGINE_CONFEZIONAMENTO = 7; // giorni tra fine in FV e birra disponibile
export const GIORNI_AVVISO_COTTA = 14; // "pianifica ora" quando la cotta va fatta entro questi giorni

// Copertura per birra.
// giac = giacenzeBirra(…) (Map), cotte, durate = durateTipiche(cotte)
// Vendite = tutti gli scarichi (fatture, Shopify, taproom, eventi…) delle ultime settimane, in litri.
// Disponibile = magazzino + birra nei fermentatori; le cotte pianificate si aggiungono quando finiscono in FV.
export function coperturaBirre({ giac, cotte, durate }, { oggi = oggiISO(), settimane = SETTIMANE_VENDITE } = {}) {
  const dal = addGiorni(oggi, -7 * settimane);
  const per = new Map();
  const di = birra => {
    const k = nomeBirra(birra);
    if (!per.has(k)) per.set(k, { birra: k, venduti: 0, magazzino: 0, inFv: 0, inFvCotte: [], pianificate: [], ultimaCotta: null });
    return per.get(k);
  };
  for (const g of giac.values()) {
    const b = di(g.birra);
    b.magazzino += Math.max(0, g.giacenza) * g.litri;
    for (const m of [...g.movimenti, ...g.prima]) {
      if (m.tipo === 'scarico' && m.data >= dal && m.data <= oggi) b.venduti += m.pezzi * g.litri;
    }
  }
  const visti = new Set();
  for (const c of cotte) {
    if (c.eliminato || !c.data || visti.has(c.id)) continue;
    const g = gruppoCotta(c, cotte);
    g.forEach(x => visti.add(x.id));
    const b = per.get(nomeBirra(c.birra));
    if (!b) continue; // birra mai venduta né in magazzino
    const st = statoCotta(g[0], durate, oggi, cotte);
    const litri = g.reduce((t, x) => t + (Number(x.litri) || 0), 0);
    const fine = fineCotta(g[0], durate);
    if (st === 'tank') { b.inFv += litri; b.inFvCotte.push({ g, litri, pronta: addGiorni(fine, MARGINE_CONFEZIONAMENTO) }); }
    if (st === 'pianificata') b.pianificate.push({ g, litri, data: g[0].data, pronta: addGiorni(fine, MARGINE_CONFEZIONAMENTO) });
    if (g[0].data <= oggi && (!b.ultimaCotta || g[0].data > b.ultimaCotta.data)) b.ultimaCotta = g[0];
  }
  const out = [];
  for (const b of per.values()) {
    if (!(b.venduti > 0)) continue;
    const settimana = b.venduti / settimane; // litri a settimana
    const alGiorno = settimana / 7;
    // si consuma il magazzino; le cotte (in FV o pianificate) arrivano quando sono pronte
    const arrivi = [...b.inFvCotte, ...b.pianificate].sort((x, y) => x.pronta.localeCompare(y.pronta));
    let t = oggi, scorta = b.magazzino;
    for (const a of arrivi) {
      const finisce = addGiorni(t, Math.floor(scorta / alGiorno));
      if (a.pronta > finisce) break; // finisce prima che arrivi la cotta: resta un buco
      scorta = scorta - alGiorno * diffGiorni(t, a.pronta) + a.litri;
      t = a.pronta;
    }
    const esaurimento = addGiorni(t, Math.floor(scorta / alGiorno));
    const durata = durate.get(b.birra) || DURATA_DEFAULT;
    const cottaEntro = addGiorni(esaurimento, -(durata + MARGINE_CONFEZIONAMENTO - 1));
    const giorni = diffGiorni(oggi, cottaEntro);
    out.push({
      ...b, settimana, esaurimento, esaurita: b.magazzino <= 0 && b.inFv <= 0, settimaneCopertura: diffGiorni(oggi, esaurimento) / 7, durata, cottaEntro,
      stato: giorni < 0 ? 'ritardo' : giorni <= GIORNI_AVVISO_COTTA ? 'presto' : 'ok',
    });
  }
  return out.sort((x, y) => x.cottaEntro.localeCompare(y.cottaEntro));
}

// ---------- clienti da richiamare ----------
export const idCliente = nome => `cliente-${String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const mediana = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// movimenti: record movbirra; clienti: record 'cliente' (telefono, ritmo a mano, non richiamare, rimanda)
// Ritmo = mediana dei giorni tra un ordine e l'altro (servono almeno 3 ordini), o quello scritto a mano.
// Da richiamare: senza ordini da più del ritmo + 30% (minimo 3 giorni di tolleranza), ultimo ordine nell'ultimo anno.
export function statoClienti(movimenti, clienti = [], prodotti = [], oggi = oggiISO()) {
  const schede = new Map(clienti.filter(c => !c.eliminato).map(c => [c.id, c]));
  const per = new Map();
  for (const m of movimenti) {
    if (m.eliminato || m.ignorato || m.verso === 'carico' || !m.data || !String(m.cliente || '').trim()) continue;
    const id = idCliente(m.cliente);
    if (!per.has(id)) per.set(id, { id, nome: m.cliente.trim(), date: new Set(), litri: 0, birre: new Map(), ultimoDoc: null });
    const c = per.get(id);
    c.date.add(m.data);
    if (!c.ultimoDoc || m.data >= c.ultimoDoc.data) c.ultimoDoc = m;
    for (const r of m.righe || []) {
      const [birra, , litri] = String(r.prodotto || '').split('|');
      const l = (Number(r.pezzi) || 0) * (Number(litri) || 0);
      c.litri += l;
      if (birra) c.birre.set(birra, (c.birre.get(birra) || 0) + l);
    }
  }
  const out = [];
  for (const c of per.values()) {
    const date = [...c.date].sort();
    const intervalli = date.slice(1).map((d, i) => diffGiorni(date[i], d)).filter(g => g > 0);
    const scheda = schede.get(c.id) || null;
    const ritmo = Number(scheda?.ritmoGiorni) > 0 ? Number(scheda.ritmoGiorni) : intervalli.length >= 2 ? mediana(intervalli) : null;
    const ultimo = date[date.length - 1];
    const giorni = diffGiorni(ultimo, oggi);
    const soglia = ritmo ? Math.max(ritmo * 1.3, ritmo + 3) : null;
    const rimandato = scheda?.rimandaFino && scheda.rimandaFino >= oggi;
    const daRichiamare = !!soglia && giorni > soglia && giorni <= 365 && !scheda?.nonRichiamare && !rimandato;
    out.push({
      id: c.id, nome: scheda?.nome || c.nome, scheda, ordini: date.length, ultimo, giorni, ritmo, daRichiamare, rimandato: !!rimandato,
      ritardo: soglia ? giorni - ritmo : 0, litri: c.litri,
      birre: [...c.birre].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b),
      telefono: scheda?.telefono || '',
    });
  }
  return out.sort((a, b) => (b.daRichiamare - a.daRichiamare) || b.ritardo - a.ritardo || a.nome.localeCompare(b.nome, 'it'));
}

// Messaggio WhatsApp per un cliente: saluto + birre disponibili (testo da testoListaBirre)
export function messaggioCliente(cliente, testoLista, firma = 'Kashmir Brewing Company') {
  const nome = cliente.nome.split(/\s+/)[0];
  const preferite = cliente.birre.length ? `\nL'ultima volta avevi preso ${cliente.birre.slice(0, 2).join(' e ')}.` : '';
  return `Ciao ${nome}, come va? Ti scrivo per la birra: ti serve qualcosa per i prossimi giorni?${preferite}\n\n${testoLista}\n\nUn saluto da ${firma}`;
}
// numero per wa.me: solo cifre, prefisso italiano se manca
export function numeroWhatsApp(tel) {
  let n = String(tel || '').replace(/[^\d+]/g, '');
  if (!n) return '';
  if (n.startsWith('+')) return n.slice(1);
  if (n.startsWith('00')) return n.slice(2);
  return n.startsWith('39') && n.length > 10 ? n : `39${n}`;
}
