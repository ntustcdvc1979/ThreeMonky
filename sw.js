/* 離線快取。

   為什麼值得做：整包資產不到 60 KB，而大學禮堂的 wifi / 4G 是這個活動
   唯一的單點失效 —— 比劃猴的手機載不進來，那一組就整場報廢。

   策略是 stale-while-revalidate：先把快取裡的東西丟出去（所以離線也能玩、
   開場也不會卡），同時在背景抓新版寫回快取，下一次開就是新的。
   比純 cache-first 好在「改了題目卻怎麼重整都是舊的」不會發生。

   CACHE 版號只在要強制清掉所有舊檔時才需要 +1。 */

var CACHE = "tm-v6";   // 手機端文案精簡，舊快取整包丟掉

var FILES = [
  "./",
  "./index.html",
  "./play.html",
  "./assets/theme.css",
  "./assets/stage.css",
  "./assets/play.css",
  "./assets/util.js",
  "./assets/terms.js",
  "./assets/roles.js",
  "./assets/deck.js",
  "./assets/qrcode.js",
  "./assets/bgm.js",
  "./assets/stage.js",
  "./assets/play.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") { return; }
  if (new URL(e.request.url).origin !== self.location.origin) { return; }

  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) { c.put(e.request, res.clone()); }
        return res;
      })["catch"](function () { return hit; });   // 離線：就用快取裡的
      return hit || net;
    });
  }));
});
