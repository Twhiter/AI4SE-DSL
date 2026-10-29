// The editor area shows the document one way at a time, chosen in the bar above it: as DSL text (the editor), as
// tables (Read) or as a DCR graph. At its right end the bar can say something about the views, such as that the editor
// is read-only. A reload keeps the view.

/** A way to show the document: its name in the bar, its element, and what to do whenever it is shown. */
export interface View {
    name: string;
    element: HTMLElement;
    shown?: () => void;
}

const KEY = 'easy-view';

/** The bar over `views`: it shows the view shown before the reload, or the first. */
export function createViewBar(bar: HTMLElement, views: View[]): { say(note: string): void } {
    bar.setAttribute('role', 'tablist');
    const tabs = views.map(view => {
        const tab = document.createElement('button');
        tab.className = 'view-tab';
        tab.setAttribute('role', 'tab');
        tab.textContent = view.name;
        tab.onclick = () => show(view);
        return tab;
    });
    const note = document.createElement('div');
    note.className = 'view-note';
    bar.append(...tabs, note);

    const show = (shown: View) => {
        views.forEach((view, index) => {
            view.element.hidden = view !== shown;
            tabs[index].setAttribute('aria-selected', String(view === shown));
        });
        try {
            sessionStorage.setItem(KEY, shown.name);
        } catch {
            // not kept: a reload shows the first view
        }
        shown.shown?.();
    };

    let kept: string | null = null;
    try {
        kept = sessionStorage.getItem(KEY);
    } catch {
        // no sessionStorage: the first view
    }
    show(views.find(({ name }) => name === kept) ?? views[0]);
    return { say: text => note.textContent = text };
}
