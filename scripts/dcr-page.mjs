// Builds the DCR page of legal-dcr-frontend (its COMPONENT.md), which the browser editor shows, when it is missing or
// older than what it is built from: first its packages (Yarn), when they are missing or older than its yarn.lock. Run
// before the browser editor starts or is built (package.json: predev, preweb:dev, preweb:build); `--force` builds it
// anyway (npm run dcr-page).

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../legal-dcr-frontend');
const bundle = path.join(root, 'app/dist-component/dcr-page.js');
const installed = path.join(root, 'node_modules/.yarn-integrity');

/** The time of the newest file in `paths` (folders: all their files, but node_modules). */
function newest(paths) {
    return Math.max(0, ...paths.filter(existsSync).map(file => statSync(file).isDirectory()
        ? newest(readdirSync(file).filter(name => name !== 'node_modules').map(name => path.join(file, name)))
        : statSync(file).mtimeMs));
}

const time = file => existsSync(file) ? statSync(file).mtimeMs : 0;
const yarn = command => execSync(`yarn ${command}`, { cwd: root, stdio: 'inherit' });

if (time(installed) < time(path.join(root, 'yarn.lock'))) {
    yarn('install');
    utimesSync(installed, new Date(), new Date());   // Yarn may rewrite yarn.lock after it: installed as it is now
}
const sources = ['app/src', 'app/vite.component.config.ts', 'app/package.json', 'modeler/lib', 'dcr-engine/src', 'dcr-engine/index.ts', 'yarn.lock']
    .map(file => path.join(root, file));
if (process.argv.includes('--force') || time(bundle) < newest(sources)) {
    yarn('build:component');
} else {
    console.log('The DCR page is up to date.');
}
