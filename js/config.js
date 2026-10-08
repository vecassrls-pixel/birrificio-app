// Configurazione del cloud. Vuota = app "solo locale" (anteprima, prove).
// Sul sito pubblicato questo file viene riscritto da tools/build.mjs con le variabili
// d'ambiente di Netlify SUPABASE_URL e SUPABASE_ANON_KEY (la anon key è pubblica per
// natura: i dati sono protetti dalle regole del database, vedi supabase/schema.sql).
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
