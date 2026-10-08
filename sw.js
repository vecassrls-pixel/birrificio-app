// Service worker: tiene in cache l'app così si apre anche senza internet.
// Cambiare VERSIONE a ogni rilascio per far scaricare i file aggiornati.
const VERSIONE = 'birrificio-v14';
const FILE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/serbatoio.js', 'js/brewfather.js', 'js/db.js', 'js/dominio.js', 'js/sync.js', 'data/storico.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSIONE).map(k => caches.delete(k))))
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
