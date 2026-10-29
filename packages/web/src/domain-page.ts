// The page before the editor and the chat: the user describes the domain first. The description is kept in the
// session's shared document (its text 'domain'), so that the server and its agents have it; a session that has one,
// such as a reloaded tab, goes straight to the editor. Until the document server answers, the page waits for it.
// Ctrl+Enter (Cmd+Enter on a Mac) continues, as the button does.

import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

/** Shows the page over the editor and the chat until the session has a domain description; then calls `enter`. */
export function createDomainPage(page: HTMLElement, domain: Y.Text, provider: WebsocketProvider, enter: () => void): void {
    page.innerHTML = `
        <form class="domain-form">
            <h1>Start with your domain</h1>
            <label for="domain-text">Domain description</label>
            <textarea id="domain-text" rows="12" required disabled
                placeholder="Who takes part, what they work with, and what happens to it."></textarea>
            <div class="actions">
                <span class="status">Connecting to the document server…</span>
                <button type="submit" disabled>Continue</button>
            </div>
        </form>`;
    const form = page.querySelector<HTMLFormElement>('.domain-form')!;
    const input = form.querySelector('textarea')!;
    const status = form.querySelector<HTMLElement>('.status')!;
    const button = form.querySelector('button')!;

    const open = () => {
        if (!page.hidden) {
            page.hidden = true;
            enter();
        }
    };

    // the session's document is here: it has a description already, or the user writes one
    const ready = () => {
        if (domain.length > 0) {
            open();
            return;
        }
        status.textContent = '';
        input.disabled = false;
        input.focus();
    };
    if (provider.synced) {
        ready();
    } else {
        provider.once('sync', ready);
    }

    input.addEventListener('input', () => {
        button.disabled = input.value.trim() === '';
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const description = input.value.trim();
        if (description === '') {
            return;
        }
        domain.doc!.transact(() => {
            if (domain.length === 0) {
                domain.insert(0, description);
            }
        });
        open();
    });

    // another tab of the same session described the domain
    domain.observe(() => {
        if (domain.length > 0) {
            open();
        }
    });
}
