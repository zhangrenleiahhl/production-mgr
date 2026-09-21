// 铸运通 PWA Service Worker
// 策略：页面导航 network-first（保证 APP_VER 缓存刷新仍生效）；同源静态资源 cache-first；
//      跨域（supabase.co 等）一律直接走网络，绝不拦截云同步。
const CACHE = "zytd-shell-v1";
const STATIC = ["manifest.json", "icon.svg", "auth.js", "cloud-config.js", "cloud-sync.js", "scan-lib.js", "staff-config.js"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {})).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // 跨域直走网络（云同步不受影响）

  if (req.mode === "navigate") {                      // HTML 页面：network-first
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
        return net;
      } catch (_) {
        const cached = await caches.match(req);
        return cached || (await caches.match("index.html")) || Response.error();
      }
    })());
    return;
  }

  // 同源静态资源：cache-first（命中即返，未命中再拉并缓存）
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      if (net.ok) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (_) {
      return Response.error();
    }
  })());
});
