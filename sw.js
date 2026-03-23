// Service Worker — オフラインキャッシュ対応
const CACHE_NAME = 'sedori-v2';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/netsea-tab.js'];

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
    // Network Firstストラテジー — 常に最新を取得し、オフライン時のみキャッシュ使用
    e.respondWith(
        fetch(e.request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
