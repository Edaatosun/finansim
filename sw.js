// Uygulama kabuğunu önbelleğe alır (yalnızca HTTPS veya localhost'ta çalışır).
const CACHE = 'finansim-v12';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Ağ öncelikli, çevrimdışıysa önbellek
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
