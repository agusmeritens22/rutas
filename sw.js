// sw.js (v15)
const CACHE = 'rutas-timewin-v15';
const FILES = [
  './',
  './index.html',
  './app.js?v=15',
  './manifest.webmanifest?v=15',
  './banner.png'
];

// Instala y precachea
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES))
  );
});

// Activa y borra caches viejos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

// Estrategia: cache-first para nuestros archivos + fallback a red
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Sólo GET
  if (req.method !== 'GET') return;

  // Navegación (HTML): intentá red y cae a cache
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Archivos estáticos: cache primero, luego red
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cloná y guardá en cache si es una respuesta válida
        const resClone = res.clone();
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE).then((cache) => cache.put(req, resClone)).catch(()=>{});
        }
        return res;
      }).catch(() => cached); // si falla red, devolvé lo que hubiera en cache
    })
  );
});

// (Opcional) permitir saltar espera desde la página
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
