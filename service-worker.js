const CACHE = 'grit-v3';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icons/exercises/pull-ups.png', './icons/exercises/goblet-squats.png', './icons/exercises/push-ups.png', './icons/exercises/one-arm-dumbbell-rows.png', './icons/exercises/romanian-deadlifts.png', './icons/exercises/hanging-knee-raises.png', './icons/exercises/bulgarian-split-squats.png', './icons/exercises/standing-overhead-press.png', './icons/exercises/bent-over-rows.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
