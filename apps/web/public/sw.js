/* global self */
// Minimal service worker so the dashboard can be installed as an app. It caches nothing:
// listings come from Supabase and must always be fresh. Offline, page loads show a short note.
const OFFLINE =
  '<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px">You are offline. Apprenticeship Finder needs a connection.</body>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});
