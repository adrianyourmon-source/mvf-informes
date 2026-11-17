// Service worker: guarda la app en el teléfono para que abra sin internet.
// Al cambiar archivos de la app, sube el número de CACHE.
const CACHE = 'mvf-informes-web-v2';
const FILES = ['./', 'index.html', 'mobile-ui.css', 'mobile-ui.js', 'history-app.js', 'drive-config.js', 'drive-sync.js',
  'jszip.min.js', 'calera-template.docx', 'mvf-logo.png', 'signature.png', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
  'fonts/PlutoSansCondBlack.otf', 'fonts/PlutoSansCondLight.otf', 'fonts/PlutoSansCondThin.otf'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
