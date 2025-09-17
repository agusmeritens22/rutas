// Después:
const CACHE = 'rutas-timewin-v14';
const FILES = [
  './',
  './index.html',
  './app.js?v=14',
  './manifest.webmanifest?v=14',
  './logo.png' // <-- cachear el logo para offline
];
self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE?caches.delete(k):null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(r=>r || fetch(e.request).catch(()=>caches.match('./index.html')))
  );
});
