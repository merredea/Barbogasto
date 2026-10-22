const CACHE = "barbogasto-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest"))) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const home = await caches.match("/");
          if (home) return home;
        }
        throw new Error("offline");
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Barbogasto", {
      body: data.body || "Fin de mes: revisa los gastos compartidos y salda tus cuentas pendientes.",
      icon: "/icons/icon-192.png",
      data: { url: data.url || "/saldos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.openWindow(target));
});
