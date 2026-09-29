const CACHE_NAME = "task-planner-v20";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=13",
  "./js/app.js?v=13",
  "./js/state.js?v=13",
  "./js/storage.js?v=13",
  "./js/dates.js?v=13",
  "./js/sync.js?v=13",
  "./js/store.js?v=13",
  "./js/boot.js?v=1",
  "./css/app.css?v=1",
  "./js/ui/app.js",
  "./js/ui/views.js",
  "./js/ui/derive.js",
  "./js/ui/lib.js",
  "./js/ui/icons.js",
  "./js/mark/store.js",
  "./js/mark/engine.js",
  "./js/mark/localdb.js",
  "./js/mark/transport.js",
  "./manifest.json",
  "./icons/icon-192.png?v=6",
  "./icons/icon-512.png?v=6",
  "./icons/icon-180.png?v=6",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" — мимо HTTP-кэша браузера: иначе новый воркер мог
    // закрепить в своём кэше прошлую версию index.html и старые ссылки.
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
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

// Only this app's own static files may be cached. Auth, REST, Realtime and Edge
// Function calls must always hit the network: serving one of those from cache
// can show another account's data or silently replay a stale answer.
function isCacheable(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.includes("/auth/") || url.pathname.includes("/rest/")) return false;
  if (url.pathname.includes("/functions/") || url.pathname.includes("/realtime/")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!isCacheable(event.request)) return; // straight to the network, untouched

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
