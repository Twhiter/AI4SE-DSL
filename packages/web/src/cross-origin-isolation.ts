// Z3's threads share memory, which browsers only allow on a cross-origin isolated page. A web server makes the page
// one with the COOP/COEP headers (the dev server and `vite preview` do); otherwise public/coi-serviceworker.js adds
// them: it is registered here, and the page reloads once so that it is loaded through it. Service workers need
// HTTPS or localhost.

const RELOADED = 'easy-reloaded-for-isolation';

/** True once the page is cross-origin isolated, false if it cannot be; does not settle while the page reloads to be. */
export const crossOriginIsolation: Promise<boolean> = isolate();

async function isolate(): Promise<boolean> {
    if (window.crossOriginIsolated) {
        session(storage => storage.removeItem(RELOADED));
        return true;
    }
    // reload at most once per session, so a browser that ignores the headers does not reload forever
    if (!('serviceWorker' in navigator) || !window.isSecureContext || session(storage => storage.getItem(RELOADED))) {
        return false;
    }
    try {
        await navigator.serviceWorker.register(new URL('coi-serviceworker.js', document.baseURI));
        await navigator.serviceWorker.ready;
    } catch {
        return false;
    }
    session(storage => storage.setItem(RELOADED, 'yes'));
    window.location.reload();
    return new Promise(() => {});
}

/** sessionStorage can be unavailable (e.g. blocked site data); then there is nothing to remember. */
function session<T>(use: (storage: Storage) => T): T | undefined {
    try {
        return use(window.sessionStorage);
    } catch {
        return undefined;
    }
}
