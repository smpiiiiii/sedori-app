// Service Worker — オフラインキャッシュ対応
const CACHE_NAME = 'sedori-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // API呼び出しはキャッシュしない
    if (e.request.url.includes('/api/')) return;
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
