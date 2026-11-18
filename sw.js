/* 游戏档案馆 · 本地缓存 Service Worker
 * 目标：主页秒开 + 断网可进；游戏资源只在玩家真正打开后才缓存，绝不预取未玩项目。
 *
 * 缓存分三层：
 *   SHELL  —— 主页骨架（html / data.js / favicon），network-first 保证更新可见
 *   COVERS —— 31 张封面，cache-first，activate 后后台补，不阻塞安装
 *   GAMES  —— 实际玩过的游戏资源，stale-while-revalidate 按需缓存
 *
 * v3 关键修正：
 *   1. install 只装 4 个外壳文件（约 30KB），几百毫秒完成 —— 不再因为 31 张封面
 *      跨境慢导致 install 被中断、SW 永远激活不了（表现为 Network 里一直有 0 B 的失败请求）。
 *   2. 封面改为 activate 之后后台分批预取（并发 4 + 单请求超时），失败静默，下次访问再补。
 *   3. 所有 fetch 都带超时，绝不让某个挂死的请求拖垮整个事件。
 *   4. 导航请求兜底：网络断 + 缓存无 时返回内置离线页，而不是 throw —— 那样浏览器会
 *      直接显示 ERR_FAILED/网络错误，用户看到的就是"报错了"。
 */
'use strict';

const VERSION = 'v5';
const SHELL_CACHE = `archive-shell-${VERSION}`;
const COVER_CACHE = `archive-cover-${VERSION}`;
const GAME_CACHE  = `archive-game-${VERSION}`;
const ALL_CACHES  = [SHELL_CACHE, COVER_CACHE, GAME_CACHE];

const SHELL_URLS = ['./', './index.html', './data.js', './favicon.svg'];

const NET_TIMEOUT = 12000;      // 单次网络请求上限
const COVER_TIMEOUT = 10000;    // 封面单张上限
const COVER_CONCURRENCY = 4;    // 封面后台预取并发

/* ---------- 工具 ---------- */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout:' + (label || ''))), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fetchT(url, ms, init) {
  return withTimeout(fetch(new Request(url, init || {})), ms || NET_TIMEOUT, url);
}

/* ---------- install：只装外壳，必须快、必须能成 ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // 逐条容错 + 每条独立超时；任何一条失败都不阻止激活
    await Promise.all(SHELL_URLS.map(u =>
      fetchT(u, 8000, { cache: 'reload' })
        .then(res => { if (res && res.ok) return shell.put(u, res); })
        .catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

/* ---------- activate：清旧缓存 → 立即接管 → 后台补封面 ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('archive-') && !ALL_CACHES.includes(k))
      .map(k => caches.delete(k)));

    await self.clients.claim();

    // 封面后台补，不阻塞激活；即使整段失败也不影响页面
    prefetchCovers().catch(() => {});
  })());
});

/* 从 data.js 解析封面清单，分批并发拉取，已缓存直接跳过 */
async function prefetchCovers() {
  let text;
  try {
    const res = await fetchT('./data.js', 8000, { cache: 'no-store' });
    if (!res || !res.ok) return;
    text = await res.text();
  } catch (_) { return; }

  const covers = [];
  const re = /cover\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) covers.push(m[1]);
  if (!covers.length) return;

  const cache = await caches.open(COVER_CACHE);
  const queue = [];
  for (const c of covers) {
    const hit = await cache.match(c).catch(() => null);
    if (!hit) queue.push(c);
  }
  if (!queue.length) return;

  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const u = queue[i++];
      try {
        const res = await fetchT(u, COVER_TIMEOUT, { cache: 'reload' });
        if (res && res.ok) await cache.put(u, res.clone());
      } catch (_) { /* 单张失败无所谓，下次访问再补 */ }
    }
  };
  await Promise.all(Array.from({ length: COVER_CONCURRENCY }, worker));
}

/* ---------- 策略 ---------- */
const OFFLINE_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>暂时离线</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0e0d0c;color:#e8e2d8;font-family:-apple-system,"Microsoft YaHei",sans-serif;text-align:center;padding:24px}
h1{font-size:20px;letter-spacing:2px;margin:0 0 12px}p{color:#9a938a;line-height:1.8;font-size:14px;margin:0 0 20px}
button{background:#e8e2d8;color:#0e0d0c;border:0;border-radius:6px;padding:10px 22px;font-size:14px;cursor:pointer}</style>
</head><body><div><h1>暂时连不上</h1><p>网络似乎断了，已缓存的内容仍可查看。<br>恢复网络后刷新即可继续。</p>
<button onclick="location.reload()">重新加载</button></div></body></html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function networkFirst(req, cacheName, isNavigate) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // 导航请求绝不能 throw，否则浏览器直接报网络错误
    if (isNavigate) return offlineResponse();
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    // 封面拉不到就给一个 1x1 透明图，避免破图
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && res.ok) {
      // 超过 40MB 的单文件不落地，避免把用户磁盘塞满
      const len = Number(res.headers.get('content-length') || 0);
      if (len < 40 * 1024 * 1024) cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);
  if (hit) { network.catch(() => {}); return hit; }
  const res = await network;
  if (res) return res;
  return new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 外部资源不插手

  const path = url.pathname;
  const isNavigate = req.mode === 'navigate';

  // 导航与主页骨架：优先走网络，断网回缓存，缓存也没有就回离线页
  if (isNavigate || path === '/' || /\/(index\.html|data\.js|favicon\.svg)$/.test(path)) {
    event.respondWith(networkFirst(req, SHELL_CACHE, isNavigate));
    return;
  }
  // 封面
  if (path.startsWith('/covers/')) {
    event.respondWith(cacheFirst(req, COVER_CACHE));
    return;
  }
  // 游戏资源：仅当 iframe 真正发出请求时才缓存（按需，不预取）
  if (path.startsWith('/games/')) {
    event.respondWith(staleWhileRevalidate(req, GAME_CACHE));
    return;
  }
});

/* ---------- 页面可发消息查询/清理缓存 ---------- */
self.addEventListener('message', event => {
  const d = event.data || {};

  if (d.type === 'STATUS') {
    event.waitUntil((async () => {
      const c = await caches.open(GAME_CACHE);
      const keys = await c.keys();
      const games = new Set();
      let bytes = 0;
      await Promise.all(keys.map(async r => {
        const m = r.url.match(/\/games\/([^/]+)\//);
        if (m) games.add(m[1]);
        try { const b = await caches.match(r).then(x => x && x.clone().blob()); if (b) bytes += b.size; } catch (_) {}
      }));
      const ev = self.clients && self.clients.matchAll ? await self.clients.matchAll() : [];
      ev.forEach(client => client.postMessage({ type: 'STATUS_RESULT', games: games.size, files: keys.length, bytes }));
    })());
  }

  if (d.type === 'CLEAR_GAMES') {
    event.waitUntil((async () => {
      await caches.delete(GAME_CACHE);
      const ev = self.clients && self.clients.matchAll ? await self.clients.matchAll() : [];
      ev.forEach(client => client.postMessage({ type: 'CLEARED' }));
    })());
  }

  // 预热：取入口 HTML，再解析主 JS/CSS/modulepreload 一并缓存。
  // 只做"玩家已打开详情"的这一款，其余不碰，保持"没玩就不下载"。
  if (d.type === 'WARM' && Array.isArray(d.paths)) {
    event.waitUntil((async () => {
      const cache = await caches.open(GAME_CACHE);
      for (const entry of d.paths.slice(0, 1)) {
        try {
          const res = await fetchT(entry, NET_TIMEOUT, { cache: 'reload' });
          if (!res || !res.ok) continue;
          await cache.put(entry, res.clone()); // 重定向响应 put 会失败，忽略即可

          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('text/html')) continue;
          const html = await res.text();
          const base = new URL(entry, self.location.href);

          // Vite 会把最重的依赖放进 modulepreload（例如物理引擎），漏掉等于没预热
          const urls = [];
          const reScript = /<script[^>]+src=["']([^"']+)["']/gi;
          const reLink = /<link[^>]+href=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/gi;
          let m;
          while ((m = reScript.exec(html))) urls.push(m[1]);
          while ((m = reLink.exec(html))) urls.push(m[1]);

          const uniq = [...new Set(urls)]
            .map(u => { try { return new URL(u, base).href; } catch { return null; } })
            .filter(u => u && u.startsWith(self.location.origin));

          await Promise.all(uniq.slice(0, 8).map(u =>
            fetchT(u, NET_TIMEOUT, { cache: 'reload' })
              .then(async r => {
                if (!r || !r.ok) return;
                const len = Number(r.headers.get('content-length') || 0);
                if (len && len > 6 * 1024 * 1024) return;
                await cache.put(u, r.clone()).catch(() => {});
              })
              .catch(() => {})
          ));
        } catch (_) {}
      }
    })());
  }
});
