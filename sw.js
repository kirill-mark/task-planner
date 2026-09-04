const CACHE_NAME = "task-planner-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=7",
  "./js/app.js?v=8",
  "./js/state.js",
  "./js/storage.js",
  "./js/dates.js",
  "./js/sync.js",
  "./manifest.json",
  "./icons/icon-192.png?v=6",
  "./icons/icon-512.png?v=6",
  "./icons/icon-180.png?v=6",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
