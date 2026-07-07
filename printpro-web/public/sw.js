// Минимальный service worker PrintPro — включает установку как приложения (PWA)
// и базовый офлайн-фолбэк. Сетевые запросы идут в сеть; кэшируем только оболочку.
const CACHE = 'printpro-v2';
const SHELL = ['/login', '/icon.svg'];

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/display/') ||
    /\.(?:css|js|svg|png|jpe?g|webp|gif|ico|woff2?)$/i.test(pathname)
  );
}

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
  const url = new URL(request.url);
  // Только GET и тот же источник; API не кэшируем
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/login')),
    );
    return;
  }

  if (!isStaticAsset(url.pathname)) return;

  e.respondWith(
    caches.match(request).then((cached) =>
      fetch(request)
      .then((res) => {
        if (!res.ok) return res;
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => cached || caches.match('/icon.svg')),
    ),
  );
});
