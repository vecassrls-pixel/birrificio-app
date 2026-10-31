// Service worker: tiene in cache l'app così si apre anche senza internet.
// Cambiare VERSIONE a ogni rilascio per far scaricare i file aggiornati.
const VERSIONE = 'birrificio-v116';
const FILE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'img/logo-kashmir.png', 'img/gb-logo.png', 'img/gb-logo-chiaro.png', 'img/gb-monogramma.png', 'img/gb-monogramma-chiaro.png', 'img/gb-anim-lettere.png', 'img/gb-anim-arco-su.png', 'img/gb-anim-arco-giu.png', 'img/gb-anim-scritta.png',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/serbatoio.js', 'js/brewfather.js', 'js/db.js', 'js/dominio.js', 'js/sync.js', 'js/xlsx.js', 'js/versione.js', 'js/magazzino.js', 'js/vista-magazzino.js', 'js/bolla-pdf.js', 'js/vista-statistiche.js', 'js/grafico-ferm.js', 'js/birra.js', 'js/vista-birra.js', 'js/costi.js', 'js/vista-costi.js', 'js/ordine.js', 'js/vista-ordine.js', 'js/vista-cerca.js', 'js/backup.js', 'js/allegati.js', 'js/listini.js', 'js/vista-listini.js', 'js/vista-home.js', 'js/vista-haccp.js', 'js/logo-kashmir.js', 'js/etichetta.js', 'js/preventivi.js', 'js/vista-preventivi.js', 'js/haccp.js', 'js/temperature.js', 'js/vista-cantina.js', 'js/agenda.js', 'js/previsioni.js', 'js/riepilogo.js', 'js/pianificatore.js', 'js/vista-previsioni.js', 'js/ai.js', 'js/vista-chiedi.js', 'js/automazioni.js', 'js/vista-automazioni.js', 'js/cassa.js', 'js/vista-cassa.js', 'js/mensili.js', 'js/vista-mensili.js', 'js/corrispettivi.js', 'js/vista-scontrini.js', 'js/economia.js', 'js/eshop.js', 'js/vista-eshop.js', 'js/sezioni.js', 'js/contenitori.js', 'js/beerfirm.js', 'js/ferie.js', 'js/sposta-cotta.js', 'js/vista-contenitori.js', 'js/trebbie.js', 'js/xlsx-leggi.js', 'js/qr.js', 'js/vista-qr.js', 'js/portale.js', 'js/vista-ordini.js', 'js/consegne.js', 'js/carrello.js', 'js/vista-carrello.js', 'js/vista-ricette.js', 'js/vendor/qrcode.js', 'data/storico.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSIONE && k !== 'birrificio-allegati').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Rete prima (per avere sempre l'ultima versione), cache se offline.
// Le chiamate al cloud (altri domini) non passano dalla cache.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copia = res.clone();
        caches.open(VERSIONE).then(c => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
