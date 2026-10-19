// Scelte delle automazioni sul server (agenda, report, import, allarmi): le salva l'app in
// Impostazioni → Automazioni e le legge il server (netlify/lib/automazioni.mjs).
// Lo stato (ultimo invio, ultimo import, allarmi aperti) lo scrive solo il server.

export const ID_IMP = 'impostazione-automazioni';
export const ID_STATO = 'stato-automazioni';
export const IMPOSTAZIONI_DEFAULT = {
  chatId: '',
  agenda: { attiva: true, ora: 7 },
  report: { attivo: true, ora: 8 }, // il lunedì
  importa: { attivo: true, ora: 3, vendite: 'fatture', shopify: true, acquisti: true },
  allarmi: { attivi: true },
};
export function impostazioni(rec) {
  const r = rec && !rec.eliminato ? rec : {};
  return {
    chatId: r.chatId || '',
    agenda: { ...IMPOSTAZIONI_DEFAULT.agenda, ...r.agenda },
    report: { ...IMPOSTAZIONI_DEFAULT.report, ...r.report },
    importa: { ...IMPOSTAZIONI_DEFAULT.importa, ...r.importa },
    allarmi: { ...IMPOSTAZIONI_DEFAULT.allarmi, ...r.allarmi },
  };
}

