// The documents folder (packages/dsl-mcp/documents): a folder per document, named by its id (20261028-221009-k3f9),
// with the DSL easy file (dsl.easy), the domain it was made for (domain.txt), and the log of the calls on it
// (log.jsonl, one JSON object per line). A client knows a document by its id only, never by where it is. The calls on
// no document are logged in the folder itself (documents/log.jsonl).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Refusal } from 'dsl-controller';

const FOLDER = new URL('../documents/', import.meta.url);

/** An id the folder gives: the local date and time, and four random letters and digits. */
const ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

export class Documents {
    readonly folder: URL;

    constructor(folder: URL = FOLDER) {
        this.folder = folder;
    }

    /** A new document, empty, for `domain`; its id. */
    create(domain: string): string {
        let id: string;
        do {
            id = `${timestamp(new Date())}-${randomBytes(4).toString('hex').slice(0, 4)}`;
        } while (existsSync(this.file(id, '')));
        mkdirSync(this.file(id, ''), { recursive: true });
        writeFileSync(this.file(id, 'domain.txt'), domain);
        writeFileSync(this.file(id, 'dsl.easy'), '');
        return id;
    }

    /** `id` when the folder has such a document, else a refusal. */
    existing(id: string): string {
        if (!ID.test(id) || !existsSync(this.file(id, 'dsl.easy'))) {
            throw new Refusal(`There is no DSL '${id}': give an id that create_dsl gave, such as 20261028-221009-k3f9.`);
        }
        return id;
    }

    read(id: string): string {
        return readFileSync(this.file(id, 'dsl.easy'), 'utf8');
    }

    write(id: string, text: string): void {
        writeFileSync(this.file(id, 'dsl.easy'), text);
    }

    /** The domain the document was made for. */
    domain(id: string): string {
        return readFileSync(this.file(id, 'domain.txt'), 'utf8');
    }

    /** Adds `entry` to the document's log, as a line of JSON. */
    log(id: string, entry: object): void {
        appendFileSync(this.file(id, 'log.jsonl'), `${JSON.stringify(entry)}\n`);
    }

    /** Adds `entry` to the folder's own log (documents/log.jsonl), for a call on no document. */
    logWithoutDocument(entry: object): void {
        mkdirSync(this.folder, { recursive: true });
        appendFileSync(new URL('log.jsonl', this.folder), `${JSON.stringify(entry)}\n`);
    }

    private file(id: string, name: string): URL {
        return new URL(`${id}/${name}`, this.folder);
    }
}

/** 20261028-221009, in local time */
function timestamp(date: Date): string {
    const two = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-`
        + `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}
