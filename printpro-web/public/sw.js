// Минимальный service worker PrintPro — включает установку как приложения (PWA)
// и базовый офлайн-фолбэк. Сетевые запросы идут в сеть; кэшируем только оболочку.
const CACHE = 'printpro-v1';
const SHELL = ['/dashboard', '/login', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Только GET и тот же источник; API не кэшируем
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/dashboard'))),
  );
});
