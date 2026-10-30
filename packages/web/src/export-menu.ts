// The Export menu in the menu bar at the top, as an IDE has File and Edit there: the document as DCR Solutions XML
// (easy-dcr-solution-adapter), which dcrgraphs.net imports, or as DCR.js editor XML (easy-dcr-js-adapter), which the
// DCR graph view shows; each downloaded as a file. While the document has errors there is nothing to export, and the
// menu says so.

import { buildModel, type EasyModel } from 'easy-language';
import { toDcrJsXml } from 'easy-dcr-js-adapter';
import { toDcrSolutionXml } from 'easy-dcr-solution-adapter';
import { onDocument } from './easy-language.js';

const TITLE = 'DSL easy';

/** What the menu offers: its item's text, the file's name, and the XML of a model. */
const EXPORTS: Array<{ text: string, file: string, xml: (model: EasyModel.Model) => Promise<string> }> = [
    { text: 'DCR Solutions XML (dcrgraphs.net)', file: `${TITLE} - DCR Solutions.xml`, xml: model => toDcrSolutionXml(model, { title: TITLE }) },
    { text: 'DCR.js XML', file: `${TITLE} - DCR.js.xml`, xml: toDcrJsXml }
];

export function createExportMenu(bar: HTMLElement): void {
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = `
        <button class="menu-title" role="menuitem" aria-haspopup="menu" aria-expanded="false">Export</button>
        <div class="menu-items" role="menu" hidden><div class="menu-note">Fix the errors first</div></div>`;
    const title = menu.querySelector<HTMLButtonElement>('.menu-title')!;
    const list = menu.querySelector<HTMLElement>('.menu-items')!;
    const note = menu.querySelector<HTMLElement>('.menu-note')!;
    const show = (shown: boolean) => {
        list.hidden = !shown;
        title.setAttribute('aria-expanded', String(shown));
    };

    let model: EasyModel.Model | undefined;
    const items = EXPORTS.map(({ text, file, xml }) => {
        const item = document.createElement('button');
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        item.textContent = text;
        item.disabled = true;
        item.onclick = async () => {
            show(false);
            if (model) {
                download(await xml(model), file);
            }
        };
        return item;
    });
    list.prepend(...items);
    onDocument(built => {
        model = buildModel(built).model;
        items.forEach(item => item.disabled = model === undefined);
        note.hidden = model !== undefined;
    });

    title.onclick = () => show(list.hidden);
    document.addEventListener('mousedown', event => {
        if (!menu.contains(event.target as Node)) {
            show(false);
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            show(false);
        }
    });
    bar.append(menu);
}

function download(text: string, name: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);   // the browser may still be reading it
}
