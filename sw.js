const CACHE_NAME = "accordatore-v36";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=36",
  "./app.js?v=36",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response.ok || new URL(event.request.url).origin !== self.location.origin) {
          return response;
        }

        const cachedResponse = response.clone();
        const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;
        return caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(cacheKey, cachedResponse))
          .catch(() => {
            // A failed cache write must not block the online response.
          })
          .then(() => response);
      })
      .catch(() =>
        event.request.mode === "navigate"
          ? caches.match("./index.html")
          : caches.match(event.request),
      ),
  );
});
