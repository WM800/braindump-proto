const CACHE = 'braindump-proto-8';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.includes('/models/')) return; // models are cached by the TTS engine itself (cache-first)
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) caches.open(CACHE).then(c => c.put(u.pathname, r.clone()));
      return r;
    }).catch(() => caches.match(u.pathname))
  );
});
