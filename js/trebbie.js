// Registro trebbie (sottoprodotto): una riga per ogni cotta fatta, compilata da sola.
// kg = kg di malti della scheda cotta, destinatario = quello di Impostazioni; si possono correggere riga per riga.
//
// Record nell'archivio:
//   impostazione-trebbie  { destinatario (il predefinito), destinatari: [] (tutti quelli tra cui scegliere),
//                           storico: [{ dal, prima }] (prima del giorno dal il predefinito era prima, così le righe passate non cambiano) }
//   trebbia               { cottaId, kg, destinatario, note }  (id 'trebbia-<cottaId>', solo se la riga è stata corretta)

import { oggiISO } from './dominio.js';

export const ID_TREBBIE = 'impostazione-trebbie';
export const DESTINATARIO_DEFAULT = 'FABIO VALERIO';
export const destinatarioDa = rec => (rec && !rec.eliminato && rec.destinatario?.trim()) || DESTINATARIO_DEFAULT;
// predefinito in vigore in una data: cambiarlo vale dal giorno del cambio in poi
export function destinatarioIl(rec, data) {
  const storico = (rec && !rec.eliminato && rec.storico) || [];
  const prima = storico.filter(s => s.dal > data).sort((a, b) => a.dal.localeCompare(b.dal))[0];
  return prima ? prima.prima : destinatarioDa(rec);
}
// elenco di Impostazioni (Romain 2026-10-20), il predefinito sempre compreso
export const destinatariDa = rec => {
  const elenco = (rec && !rec.eliminato && Array.isArray(rec.destinatari) ? rec.destinatari : []).map(x => String(x).trim()).filter(Boolean);
  const def = destinatarioDa(rec);
  return elenco.includes(def) ? elenco : [def, ...elenco];
};
export const idTrebbia = cottaId => `trebbia-${cottaId}`;

// kg di malti della cotta, arrotondati al kg (le righe in g contano /1000)
export function kgMalti(c) {
  const kg = (c.malti || []).reduce((t, r) => {
    const q = Number(r.qta) || 0;
    const un = String(r.unita || 'kg').toLowerCase();
    return t + (un === 'g' ? q / 1000 : un === 'kg' ? q : 0);
  }, 0);
  return Math.round(kg);
}

// Righe del registro in ordine di data: { cotta, data, numero, birra, kg, kgMalti, destinatario, note, corretta }
// destinatario: il nome, oppure una funzione data -> nome (predefinito in vigore quel giorno)
export function registroTrebbie(cotte, trebbie, destinatario, oggi = oggiISO()) {
  const defIl = typeof destinatario === 'function' ? destinatario : () => destinatario;
  const per = new Map(trebbie.filter(t => !t.eliminato).map(t => [t.cottaId, t]));
  return cotte.filter(c => !c.eliminato && c.data && c.data <= oggi)
    .sort((a, b) => a.data.localeCompare(b.data) || (a.numero || 0) - (b.numero || 0))
    .map(c => {
      const t = per.get(c.id);
      const malti = kgMalti(c);
      return {
        cotta: c, data: c.data, numero: c.numero ?? c.lotto ?? '', birra: c.birra || '',
        kg: t && t.kg != null ? Number(t.kg) : malti || null, kgMalti: malti,
        destinatario: t?.destinatario?.trim() || defIl(c.data), note: t?.note || '', corretta: !!t,
      };
    });
}

// Totali: kg e cotte per destinatario
export function totaliTrebbie(righe) {
  const per = new Map();
  for (const r of righe) {
    const x = per.get(r.destinatario) || { destinatario: r.destinatario, kg: 0, cotte: 0 };
    x.kg += Number(r.kg) || 0; x.cotte += 1;
    per.set(r.destinatario, x);
  }
  return { kg: righe.reduce((t, r) => t + (Number(r.kg) || 0), 0), cotte: righe.length, perDestinatario: [...per.values()].sort((a, b) => b.kg - a.kg) };
}
