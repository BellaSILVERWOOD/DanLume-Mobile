/* DanLume Mobile Service Worker：离线壳 + 运行时缓存 */
const VERSION = "danlume-v15";
const SHELL = [
  "./", "./index.html", "./css/app.css", "./manifest.webmanifest",
  "./js/main.js", "./js/shell.js", "./js/ui.js", "./js/util.js", "./js/db.js",
  "./js/icons.js", "./js/ai.js", "./js/markdown.js", "./js/weather.js", "./js/tools.js",
  "./vendor/katex.min.js", "./vendor/auto-render.min.js", "./vendor/marked.umd.js",
  "./vendor/purify.min.js", "./vendor/katex.min.css",
  "./icons/app-192.png", "./icons/app-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 认证/同步接口必须实时走网络，不能吃缓存
  if (url.pathname.startsWith("/api/")) return;
  // 网络优先：APK 更新后能立刻拿到新资源；断网时回落到缓存
  event.respondWith(
    fetch(req).then((resp) => {
      if (resp && resp.ok) caches.open(VERSION).then((c) => c.put(req, resp.clone()));
      return resp;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
