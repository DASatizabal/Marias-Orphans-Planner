// Service worker for Maria's Orphans Planner.
//
// NETWORK-FIRST, DELIBERATELY. Do not "fix" this into a cache-first worker.
// This is a realtime app whose entire value is that a vote cast on one phone
// shows up on the other five immediately. A cache-first worker on GitHub Pages
// is the most reliable way to strand your friends on a stale build they cannot
// escape without clearing site data. The cache here is a fallback for offline
// only, never a first choice.
//
// Firebase hosts are skipped outright: the Firestore SDK has its own offline
// persistence and its own transport, and putting a service worker in front of
// its long-lived streams breaks realtime updates.

const CACHE_NAME = 'marias-orphans-v6';

const ASSETS = [
    './',
    './index.html',
    './css/styles.css',
    './js/config.js',
    './js/quarter.js',
    './js/scoring.js',
    './js/store.js',
    './js/calendar.js',
    './js/ics.js',
    './js/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

const SKIP_HOSTS = [
    'firestore.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseio.com',
    'gstatic.com',
    'googleapis.com',
    'cdn.tailwindcss.com',
    'unpkg.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // Individually, so one bad path cannot fail the whole install.
            .then(cache => Promise.allSettled(ASSETS.map(a => cache.add(a))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (SKIP_HOSTS.some(h => url.hostname.endsWith(h))) return;
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(response => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
    );
});
