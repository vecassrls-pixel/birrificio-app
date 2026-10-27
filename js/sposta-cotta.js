// Modifiche alle date di una cotta trascinando la sua barra nel planning (Romain 2026-10-22).
// Senza DOM: ritornano la cotta modificata (copia), o un testo d'errore.
import { addGiorni, fineCotta, travasoCotta } from './dominio.js';

const misurata = e => [e.densita, e.ph].some(v => v !== null && v !== undefined && v !== '');

// Sposta tutta la cotta di "giorni": data, fine, travaso, profilo di fermentazione. Solo cotte non ancora fatte.
export function spostaCotta(c, giorni, oggi) {
  if (!giorni) return { ...c };
  const data = addGiorni(c.data, giorni);
  if (c.data <= oggi) return `${[c.birra, c.lotto].filter(Boolean).join(' ')} è già stata fatta: puoi solo allungarla, accorciarla o cambiare FV.`;
  if (data < oggi) return 'Non si può spostare una cotta prima di oggi.';
  const out = { ...c, data };
  if (c.fine) out.fine = addGiorni(c.fine, giorni);
  if (c.travaso?.data) out.travaso = { ...c.travaso, data: addGiorni(c.travaso.data, giorni) };
  out.fermentazione = (c.fermentazione || []).map(e => (e.data ? { ...e, data: addGiorni(e.data, giorni) } : e));
  out.confezionato = (c.confezionato || []).map(x => (x.data ? { ...x, data: addGiorni(x.data, giorni) } : x));
  return out;
}

// Nuova fine in FV. Il profilo si accorcia togliendo i giorni senza misure dopo la fine, o si allunga
// ripetendo l'ultima temperatura.
export function cambiaFine(c, fine, durate, fvs) {
  const t = travasoCotta(c, fvs);
  const minimo = t && t.data > c.data ? t.data : c.data;
  if (fine < minimo) return t ? 'La fine non può venire prima del travaso.' : 'La fine non può venire prima della cotta.';
  const out = { ...c, fine };
  const log = (c.fermentazione || []).filter(e => !e.data || e.data <= fine || misurata(e));
  const ultimo = log[log.length - 1];
  if (ultimo?.data && ultimo.data < fine && fine > fineCotta(c, durate)) {
    for (let d = addGiorni(ultimo.data, 1), g = (ultimo.giorno || log.length) + 1; d <= fine; d = addGiorni(d, 1), g++) log.push({ data: d, giorno: g, temp: ultimo.temp ?? null });
  }
  out.fermentazione = log;
  return out;
}

// Nuovo giorno del travaso (la barra nel primo FV finisce il giorno prima)
export function cambiaTravaso(c, data, durate, fvs) {
  const t = travasoCotta(c, fvs);
  if (data <= c.data) return 'Il travaso deve venire dopo la cotta.';
  if (data > fineCotta(c, durate)) return 'Il travaso deve venire prima della fine della cotta.';
  return { ...c, travaso: { fv: t?.fv || c.travaso?.fv || '', data } };
}

// Cambia FV: quello di partenza, o quello di arrivo del travaso
export function cambiaFv(c, fv, travaso, fvs) {
  if (!travaso) return { ...c, fv };
  const t = travasoCotta(c, fvs);
  return { ...c, travaso: { fv, data: t?.data || c.travaso?.data } };
}
