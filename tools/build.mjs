// Prepara la cartella dist/ da pubblicare su Netlify (comando di build in netlify.toml).
// - scrive js/config.js con SUPABASE_URL e SUPABASE_ANON_KEY dalle variabili d'ambiente
// - NON copia lo storico (data/), gli script (tools/), il database (supabase/): i dati stanno solo nel database protetto
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL, chiave = process.env.SUPABASE_ANON_KEY;
if (!url || !chiave) {
  console.error('Mancano SUPABASE_URL e/o SUPABASE_ANON_KEY nelle variabili d\'ambiente di Netlify');
  process.exit(1);
}
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'js']) {
  cpSync(f, `dist/${f}`, { recursive: true });
}
writeFileSync('dist/js/config.js', `export const CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: chiave }, null, 2)};\n`);
// la cache offline non deve cercare lo storico, che sul sito non c'è
const sw = readFileSync('dist/sw.js', 'utf8').replace(", 'data/storico.json'", '');
writeFileSync('dist/sw.js', sw.replace(/const VERSIONE = '([^']+)'/, (_, v) => `const VERSIONE = '${v}-${Date.now()}'`));
console.log('dist/ pronta');
