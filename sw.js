// 経営ポータル Service Worker
//
// ぶちゃるで実際に問題を踏んで直したものを、最初から取り込んでいる。
//
//  1. 通信の待ち時間に上限を設ける。
//     完全に圏外なら通信は即座に失敗してキャッシュが使われるが、
//     「弱電波（繋がってはいるがデータが流れない）」だと失敗もせず待ち続け、
//     画面が真っ白になる。それを防ぐ。
//  2. インストールは1ファイルずつ。1個失敗しても他は入る。
//  3. 同一オリジンのファイルだけを扱う。Firestore の通信には触れない。
//  4. 取り直すときはブラウザ自身のキャッシュを迂回する。
//
// ★★★ index.html を更新したら、必ず下の番号を上げること ★★★
//     上げないと、各端末は古い版を使い続ける（ぶちゃるで実際に起きた）。

const CACHE = 'kp-v5';

const NET_TIMEOUT_MS = 3000;   // これを過ぎたらキャッシュを返す（通信は裏で続く）

const ASSETS = [
  './', './index.html', './manifest.json',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && res.ok) await cache.put(url, res);
      } catch (err) { /* 1つ失敗しても他は入れる */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // 外部通信には触らない

  const network = fetch(req).then(res => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => null);

  e.waitUntil(network);

  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (!cached) {
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'offline' });
    }
    const timeout = new Promise(r => setTimeout(() => r(null), NET_TIMEOUT_MS));
    const fresh = await Promise.race([network, timeout]);
    return (fresh && fresh.ok) ? fresh : cached;
  })());
});
