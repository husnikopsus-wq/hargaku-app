/* Service worker HargaKu Online — cache shell aplikasi saja.
   Panggilan API ke Google Apps Script TIDAK pernah di-cache. */
const CACHE = "jualanku-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/printer.js",
  "./manifest.json",
  "./img/logo-192.png",
  "./img/logo-512.png",
  "./img/logo-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST/API diteruskan apa adanya
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // permintaan lintas domain (API) diteruskan
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
