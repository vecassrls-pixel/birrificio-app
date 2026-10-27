// Giorni non lavorativi (ferie, chiusure) (Romain 2026-10-22): in giallo nel planning, mai proposti in "Pianifica cotta".
// Un record impostazione con i periodi { da, a, tipo, nota }.
import { addGiorni } from './dominio.js';

export const ID_FERIE = 'impostazione-ferie';
export const ferieDa = rec => (rec && !rec.eliminato && Array.isArray(rec.periodi) ? rec.periodi.filter(p => p.da) : []);

// Tipi di giorno (Romain 2026-10-22): non lavorativo in giallo, solo pulizie e lavaggi in grigio.
// Tutti e due esclusi dalle date proposte per una cotta.
export const TIPI_GIORNO = { chiuso: 'Non lavorativo', pulizie: 'Pulizie e lavaggi' };

// Map giorno (YYYY-MM-DD) -> tipo, per ogni giorno dei periodi
export function giorniFerie(periodi) {
  const out = new Map();
  for (const p of periodi || []) {
    const a = p.a && p.a >= p.da ? p.a : p.da;
    for (let d = p.da, i = 0; d <= a && i < 400; d = addGiorni(d, 1), i++) out.set(d, p.tipo === 'pulizie' ? 'pulizie' : 'chiuso');
  }
  return out;
}
