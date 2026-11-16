// public/sw.js — keeps SwimZone opening with no signal (Registers), and Poolside (installable app; registered
// from public/poolside/index.html too, so Poolside works offline without the main app ever being opened).
// Hand-written, no build step. Registered from src/main.jsx in production builds only.
//
//   page loads (navigation)   network first (4 s), else the saved copy; the app's routes all share
//                             index.html, Poolside pages are saved under their own URL
//   /assets/*                 saved forever once seen (Vite gives each build new file names)
//   other same-origin files   saved copy at once, refreshed in the background
//   anything else (Supabase)  untouched — the app's own offline queue handles data
//
// Bump VERSION only to throw every saved copy away.
const VERSION = 'sz-v1';
const SHELL = VERSION + '-shell';
const ASSETS = VERSION + '-assets';
const MAX_ASSETS = 80;
const NET_TIMEOUT_MS = 4000;
const POOLSIDE_FILES = [
  '/poolside/', '/poolside/manifest.webmanifest',
  '/poolside/hrMetrics.js', '/poolside/hrMonitor.js', '/poolside/protocolFormat.js', '/poolside/setFormat.js',
  '/poolside/types.js', '/poolside/schemes.js', '/poolside/writeups.js',
  '/poolside/icons/icon-192.png', '/poolside/icons/icon-512.png', '/poolside/icons/icon-maskable-512.png', '/poolside/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch('/index.html', { cache: 'no-store' });
      if (res.ok) {
        await c.put('/index.html', res.clone());
        await cacheAssetsFrom(await res.text());
      }
    } catch (e) { /* offline at install: the next online load fills it */ }
    // Poolside (installable app, 2026-11-12): save it whole at install, so the
    // installed app opens at the pool even if it has only been opened once.
    await Promise.all(POOLSIDE_FILES.map(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) await c.put(u, r); } catch (e) { /* later */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') { event.respondWith(page(req, url)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(asset(req)); return; }
  event.respondWith(staleWhileRevalidate(req));
});

async function page(req, url) {
  const poolside = url.pathname.startsWith('/poolside');
  const key = poolside ? url.pathname : '/index.html';
  const c = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), NET_TIMEOUT_MS);
    if (res.ok) {
      await c.put(key, res.clone());
      if (!poolside) res.clone().text().then(cacheAssetsFrom).catch(() => {});
    }
    return res;
  } catch (e) {
    const saved = await c.match(key);
    if (saved) return saved;
    return new Response('<h3 style="font-family:sans-serif">No signal, and SwimZone isn\'t saved on this device yet. Open it once with internet.</h3>',
      { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

async function asset(req) {
  const c = await caches.open(ASSETS);
  const saved = await c.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) { await c.put(req, res.clone()); trim(c); }
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL);
  const saved = await c.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return saved || (await fresh) || new Response('', { status: 504 });
}

// Save the JS/CSS a page needs, so the next load works with no signal.
async function cacheAssetsFrom(html) {
  const urls = [...String(html).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (!urls.length) return;
  const c = await caches.open(ASSETS);
  await Promise.all(urls.map(async (u) => {
    if (await c.match(u)) return;
    try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch (e) { /* later */ }
  }));
  trim(c);
}

async function trim(c) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await c.delete(keys[i]);
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
