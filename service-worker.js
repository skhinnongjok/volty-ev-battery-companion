const CACHE = "volty-v18";
const ASSETS = ["./", "./index.html", "./styles.css?v=16", "./src/app.js?v=18", "./src/ble.js", "./src/metrics.js", "./src/protocol.js", "./src/trips.js", "./manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))));
