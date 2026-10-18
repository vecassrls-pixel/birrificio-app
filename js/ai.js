// Chiamate alla funzione netlify/functions/ai.mjs (Claude): la risposta arriva a righe JSON.
// chiediAi(corpo, { suTesto }) → { testo, json } ; errore con il messaggio da mostrare.

import { token } from './auth.js';

export async function chiediAi(corpo, { suTesto = () => {} } = {}) {
  if (!navigator.onLine) throw new Error('Serve la connessione a internet');
  const t = await token();
  const res = await fetch('/.netlify/functions/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(corpo),
  });
  if (!res.ok || !res.body) {
    let msg = `Errore ${res.status}`;
    try { msg = (await res.json()).errore || msg; } catch { msg = 'Funzione AI non disponibile qui: funziona sull\'app pubblicata su Netlify'; }
    throw new Error(msg);
  }
  const lettore = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '', testo = '', json = null, finito = false;
  const riga = r => {
    if (!r.trim()) return;
    const o = JSON.parse(r);
    if (o.errore) throw new Error(o.errore);
    if (o.testo) { testo += o.testo; suTesto(testo); }
    if (o.fine) { finito = true; json = o.json ?? null; }
  };
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    resto += value;
    const righe = resto.split('\n');
    resto = righe.pop();
    righe.forEach(riga);
  }
  riga(resto);
  if (!finito) throw new Error('Risposta interrotta: riprova');
  return { testo, json };
}

// Foto dal telefono → JPEG ridotto (lato lungo max 2000 px) in base64, per non superare i limiti di invio
export async function fotoBase64(file, lato = 2000) {
  if (file.type === 'application/pdf') {
    if (file.size > 4.5e6) throw new Error('PDF troppo grande (massimo 4,5 MB)');
    return { media_type: 'application/pdf', data: await base64(file) };
  }
  const img = await createImageBitmap(file);
  const k = Math.min(1, lato / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { media_type: 'image/jpeg', data: await base64(blob) };
}
function base64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => ko(new Error('File non leggibile'));
    r.readAsDataURL(blob);
  });
}
