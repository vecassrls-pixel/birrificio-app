// Funzione programmata: ogni 5 minuti controlla le temperature dei fermentatori e manda gli allarmi su Telegram.
// Non fa niente finché il gateway in birrificio non manda dati. Vedi netlify/lib/automazioni.mjs
import { controllaTemperature } from '../lib/automazioni.mjs';
import * as db from '../lib/db.mjs';

export default async () => {
  if (!db.configurato()) return new Response('database non configurato');
  try { console.log(JSON.stringify(await controllaTemperature())); }
  catch (e) { console.error(e.message); }
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
