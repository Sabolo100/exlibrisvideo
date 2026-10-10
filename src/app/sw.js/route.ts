import { APP_VERSION, BUILD_ID } from '@/lib/version';

export const dynamic = 'force-static';

/**
 * GET /sw.js – the service worker that makes the site an installable app (PWA). The cache name carries the
 * version and build id, so a new release drops the old cache. Static build assets are cached, everything
 * else (pages, API, media) always goes to the network.
 */
export function GET(): Response {
  const cache = `exlibris-v${APP_VERSION}-${BUILD_ID}`;
  const js = `const CACHE = ${JSON.stringify(cache)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('exlibris-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_next/static/')) return;
  event.respondWith(
    caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))),
  );
});
`;
  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    },
  });
}
