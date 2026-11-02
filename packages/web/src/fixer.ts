// The DCR graphs' fixer (the adapters' fixInclusion): an action that no include relation goes to starts included, as
// it could otherwise never happen. One setting for the DCR graph view and the Export menu, each with a checkbox for it,
// kept in this browser; on by default.

const KEY = 'easy-fix-inclusion';
const listeners: Array<(on: boolean) => void> = [];
let on = load();

/** Whether the fixer is on. */
export function fixInclusion(): boolean {
    return on;
}

/** Called whenever the fixer is turned on or off. */
export function onFixInclusion(listener: (on: boolean) => void): void {
    listeners.push(listener);
}

/** A checkbox that turns the fixer on and off, in step with the others. */
export function fixerCheckbox(className: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = className;
    label.title = 'An action that nothing makes available starts included: otherwise it could never happen';
    label.innerHTML = '<input type="checkbox"> Fix inclusion';
    const box = label.querySelector('input')!;
    box.checked = on;
    box.onchange = () => turn(box.checked);
    onFixInclusion(value => box.checked = value);
    return label;
}

function turn(value: boolean): void {
    on = value;
    try {
        localStorage.setItem(KEY, String(value));
    } catch {
        // not kept: it stays as it is until the page is reloaded
    }
    listeners.forEach(listener => listener(value));
}

function load(): boolean {
    try {
        return localStorage.getItem(KEY) !== 'false';
    } catch {
        return true;
    }
}
