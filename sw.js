/* Lưu các tệp của trang trên máy để mở được cả khi mất mạng.
   - Trang, app.js, dieu_tri.json: ưu tiên bản mới trên mạng (sửa trên GitHub là bà con thấy ngay), mất mạng thì dùng bản đã lưu.
   - Mô hình, thư viện: dùng bản đã lưu (nặng, ít thay đổi). Khi thay mô hình mới, đổi số phiên bản CACHE. */
const CACHE = 'caykhoeai-v2';
const FILES = ['./', 'index.html', 'app.js', 'dieu_tri.json', 'manifest.webmanifest',
  'vendor/tf.min.js', 'vendor/html2pdf.bundle.min.js',
  'model/model.json', 'model/group1-shard1of1.bin',
  'img/icon-64.png', 'img/icon-192.png', 'img/icon-512.png'];
const NET_FIRST = /(\/|index\.html|app\.js|dieu_tri\.json|manifest\.webmanifest)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromCache(req) { return caches.match(req, { ignoreSearch: true }); }

function networkFirst(req) {
  const net = fetch(new Request(req.url, { cache: 'no-cache' })).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  // mạng quá chậm (4 giây) thì dùng tạm bản đã lưu
  const slow = new Promise((resolve) => setTimeout(resolve, 4000)).then(() => fromCache(req));
  return Promise.race([net, slow])
    .then((res) => res || net)
    .catch(() => fromCache(req).then((hit) => hit || net));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (NET_FIRST.test(url.pathname)) e.respondWith(networkFirst(e.request));
  else e.respondWith(fromCache(e.request).then((hit) => hit || fetch(e.request)));
});
