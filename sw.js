/* Lưu các tệp của trang trên máy để mở được cả khi mất mạng. Đổi số phiên bản khi cập nhật trang. */
const CACHE = 'caykhoeai-v1';
const FILES = ['./', 'index.html', 'app.js', 'dieu_tri.json', 'manifest.webmanifest',
  'vendor/tf.min.js', 'vendor/html2pdf.bundle.min.js',
  'model/model.json', 'model/group1-shard1of1.bin',
  'img/icon-64.png', 'img/icon-192.png', 'img/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
