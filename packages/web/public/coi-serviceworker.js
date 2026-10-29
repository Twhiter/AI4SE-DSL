// Makes the page cross-origin isolated on a web server that does not send the COOP/COEP headers itself, such as a
// static host: this service worker adds them to every response for the page. Z3's threads need it (they share
// memory). Registered by src/cross-origin-isolation.ts only when the page is not isolated already; the dev server
// and `vite preview` send the headers themselves.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
        return; // a request a service worker cannot make
    }
    event.respondWith(fetch(request).then(response => {
        if (response.status === 0) {
            return response; // opaque: its headers cannot be read or changed
        }
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }));
});
