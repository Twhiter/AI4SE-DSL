import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Z3's threads share memory (SharedArrayBuffer), which browsers only allow on a cross-origin isolated page. On a web
// server that does not send these headers, the page's service worker adds them (src/cross-origin-isolation.ts).
const CROSS_ORIGIN_ISOLATION = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
};

export default defineConfig({
    // relative asset paths, so the built dist/ folder works from any static web server path
    base: './',
    plugins: [z3Files()],
    resolve: {
        alias: [
            // y-monaco imports Monaco by its path before Monaco 0.5x (esm/vs/editor/editor.api.js, now editor/editor.api.js);
            // it gets the Monaco the editor uses
            { find: 'monaco-editor/esm/vs/editor/editor.api.js', replacement: 'monaco-editor' }
        ]
    },
    build: {
        target: 'es2022',
        // Monaco and Langium make one large bundle; that is expected
        chunkSizeWarningLimit: 6000
    },
    worker: {
        format: 'es'
    },
    server: {
        port: 5174,
        strictPort: true,
        headers: CROSS_ORIGIN_ISOLATION
    },
    preview: {
        headers: CROSS_ORIGIN_ISOLATION
    }
});

/**
 * Z3's WebAssembly build at z3/: served by the dev server, copied into dist/z3/ by the build. z3-built.js is a classic
 * script that starts its threads from its own URL and loads z3-built.wasm next to it, so both keep their names.
 */
function z3Files(): Plugin {
    const directory = path.dirname(createRequire(import.meta.url).resolve('z3-solver/build/z3-built.js'));
    const files: Record<string, string> = { 'z3-built.js': 'text/javascript', 'z3-built.wasm': 'application/wasm' };
    return {
        name: 'z3-files',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const name = request.url?.split('?')[0].replace(/^\/z3\//, '');
                if (!name || !(name in files) || !request.url?.startsWith('/z3/')) {
                    return next();
                }
                response.setHeader('Content-Type', files[name]);
                Object.entries(CROSS_ORIGIN_ISOLATION).forEach(([header, value]) => response.setHeader(header, value));
                response.end(readFileSync(path.join(directory, name)));
            });
        },
        generateBundle() {
            for (const name of Object.keys(files)) {
                this.emitFile({ type: 'asset', fileName: `z3/${name}`, source: readFileSync(path.join(directory, name)) });
            }
        }
    };
}
