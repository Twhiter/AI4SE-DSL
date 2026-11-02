// The capacity of every list and queue: the most elements one holds, one holding that many being full. One setting for
// the Z3 checks (the Problems panel, with a field for it) and the DCR Solutions export, kept in this browser;
// easy-language's DEFAULT_CAPACITY by default.

import { DEFAULT_CAPACITY } from 'easy-language';

const KEY = 'easy-list-capacity';
const listeners: Array<(capacity: number) => void> = [];
let capacity = load();

/** The capacity of every list and queue. */
export function listCapacity(): number {
    return capacity;
}

/** Called whenever the capacity changes. */
export function onListCapacity(listener: (capacity: number) => void): void {
    listeners.push(listener);
}

/** A field for the capacity, a whole number of at least 1: another one is put back as it was. */
export function capacityField(className: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = className;
    label.title = 'The most elements a list or queue holds: one holding that many is full';
    label.innerHTML = 'List capacity <input type="number" min="1" step="1">';
    const field = label.querySelector('input')!;
    field.value = String(capacity);
    field.onchange = () => {
        const value = Number(field.value);
        if (isCapacity(value)) {
            set(value);
        } else {
            field.value = String(capacity);
        }
    };
    return label;
}

function set(value: number): void {
    capacity = value;
    try {
        localStorage.setItem(KEY, String(value));
    } catch {
        // not kept: it stays as it is until the page is reloaded
    }
    listeners.forEach(listener => listener(value));
}

function load(): number {
    try {
        const value = Number(localStorage.getItem(KEY) ?? undefined);
        return isCapacity(value) ? value : DEFAULT_CAPACITY;
    } catch {
        return DEFAULT_CAPACITY;
    }
}

function isCapacity(value: number): boolean {
    return Number.isInteger(value) && value >= 1;
}
