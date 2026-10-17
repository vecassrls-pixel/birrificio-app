// QR di uso interno su fusti e cartoni di lattine: il QR è un link all'app (#/qr?…) con prodotto,
// lotto, cotta e pezzi per scansione. Inquadrato con la fotocamera del telefono apre l'app sul lotto;
// dall'app c'è anche "Scansiona" (BarcodeDetector, o jsQR dove manca, es. iPhone).
// Le librerie in js/vendor si caricano solo quando servono.

const caricati = new Map();
function script(src) {
  if (!caricati.has(src)) {
    caricati.set(src, new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => { caricati.delete(src); ko(new Error('Libreria QR non caricata: serve internet la prima volta')); };
      document.head.appendChild(s);
    }));
  }
  return caricati.get(src);
}

// Link del QR: { prodotto (chiave birra|tipo|litri), lotto, cotta (id), pezzi }
export function linkQr({ prodotto, lotto, cotta, pezzi = 1 }, base = `${location.origin}${location.pathname}`) {
  const p = new URLSearchParams({ p: prodotto, l: lotto || '', ...(cotta ? { c: cotta } : {}), ...(pezzi > 1 ? { x: String(pezzi) } : {}) });
  return `${base}#/qr?${p}`;
}
export function leggiLinkQr(testo) {
  const i = String(testo || '').indexOf('#/qr?');
  if (i < 0) return null;
  const p = new URLSearchParams(testo.slice(i + 5));
  if (!p.get('p')) return null;
  return { prodotto: p.get('p'), lotto: p.get('l') || '', cotta: p.get('c') || '', pezzi: Math.max(1, Number(p.get('x')) || 1) };
}

// SVG del QR (quadrato, scalabile)
export async function svgQr(testo) {
  await script('js/vendor/qrcode.js');
  const q = window.qrcode(0, 'M');
  q.addData(testo);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Scansione dalla fotocamera dentro un <video>: chiama suTesto(testo) al primo QR letto.
// Ritorna la funzione per fermare la fotocamera.
export async function scansiona(video, suTesto) {
  const flusso = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = flusso;
  video.setAttribute('playsinline', '');
  await video.play();
  let fermo = false;
  const ferma = () => { fermo = true; flusso.getTracks().forEach(t => t.stop()); };
  let leggi;
  if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    leggi = async () => (await det.detect(video))[0]?.rawValue;
  } else {
    await script('js/vendor/jsQR.js');
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    leggi = async () => {
      const k = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
      c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
      if (!c.width) return null;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      return window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' })?.data;
    };
  }
  const giro = async () => {
    if (fermo) return;
    try {
      const t = await leggi();
      if (t) { ferma(); suTesto(t); return; }
    } catch { /* fotogramma non pronto */ }
    setTimeout(giro, 250);
  };
  giro();
  return ferma;
}
