// Network-first: сайт всегда берётся свежим, кэш нужен только для офлайна.
const CACHE = "journal-v72";
const SHELL = ["./", "./index.html", "./mini.css", "./flat.css", "./mini.js", "./diary-sheet.css", "./diary-sheet.js", "./lib.css", "./lib.js", "./pptx-view.js", "./pdf-view.js", "./pdf.min.js", "./pdf.worker.min.js", "./settings-merge.css", "./settings-merge.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // Firebase, Telegram и Worker не трогаем
  if (url.pathname.indexOf("/api/") !== -1) return;

  e.respondWith((async () => {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4000);   // слабая сеть: через 4 с берём сохранённую копию
      let res;
      try { res = await fetch(req, { cache: "no-store", signal: ac.signal }); } finally { clearTimeout(timer); }
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (err && err.name === "AbortError") { try { return await fetch(req); } catch (e2) {} }   // копии нет — ждём сеть как раньше
      if (req.mode === "navigate") {
        return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error();
      }
      return Response.error();
    }
  })());
});
