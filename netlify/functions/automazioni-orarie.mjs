// Funzione programmata: ogni ora decide se è il momento dell'import da Fatture in Cloud e Shopify,
// dell'agenda del mattino o del report del lunedì (orari in Impostazioni → Automazioni). Vedi netlify/lib/automazioni.mjs
import { giroOrario } from '../lib/automazioni.mjs';

export default async () => {
  const esito = await giroOrario();
  console.log(JSON.stringify(esito));
  return new Response('ok');
};

export const config = { schedule: '@hourly' };
