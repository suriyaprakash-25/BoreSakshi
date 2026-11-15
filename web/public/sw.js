// sw.js — keeps the app shell available with no signal so an operator can open the
// drill log in the field. API responses are never cached: they must stay live.
const CACHE = "boresakshi-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// The page lists the assets it already loaded, which were fetched before this
// worker existed and would otherwise be missing offline.
self.addEventListener("message", (event) => {
  if (Array.isArray(event.data?.cacheUrls)) {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(event.data.cacheUrls)).catch(() => {}));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/index.html", response.clone());
    return response;
  } catch {
    return cache.match("/index.html");
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(event.request.mode === "navigate" ? networkFirstPage(event.request) : cacheFirstAsset(event.request));
});
