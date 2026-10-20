// Beerfirm: cotte prodotte per un altro marchio (Romain 2026-10-19). Nella cotta c.beerfirm = nome
// ('' = nostra). L'elenco dei nomi si imposta in Impostazioni ed è uguale per tutti (record condiviso).
// sacca: le cotte di quel beerfirm vanno nei polykeg con sacca (fabbisogno dei Contenitori).
export const ID_BEERFIRM = 'impostazione-beerfirm';
export const BEERFIRM_DEFAULT = [{ nome: 'Chimera', sacca: true }];
export const beerfirmDa = rec => (rec && !rec.eliminato && Array.isArray(rec.elenco) ? rec.elenco.filter(b => b.nome) : BEERFIRM_DEFAULT);
