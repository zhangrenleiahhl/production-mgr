// 铸运通 PWA Service Worker
// 策略：全站 network-first（页面和 JS 都拿最新 —— 2026-09-24 取证：手机端 cache-first 的旧
//      scan-lib.js 让「质保书/车到」门禁失效，出现没有质保书却点成已完成的单子）；
//      断网时才回退缓存。跨域（supabase.co 等）一律直接走网络，绝不拦截云同步。
const CACHE = "zytd-shell-v2";
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

  // 同源一律 network-first：拿到新的就顺手更新缓存；断网才用缓存兜底
  e.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (net.ok) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || (await caches.match("index.html")) || Response.error();
    }
  })());
});
