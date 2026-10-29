//@ts-check
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const success = watch ? 'Watch build succeeded' : 'Build succeeded';

function getTime() {
    const date = new Date();
    return `[${`${padZeroes(date.getHours())}:${padZeroes(date.getMinutes())}:${padZeroes(date.getSeconds())}`}] `;
}

function padZeroes(i) {
    return i.toString().padStart(2, '0');
}

const plugins = [{
    name: 'watch-plugin',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length === 0) {
                console.log(getTime() + success);
            }
        });
    },
}];

const extension = await esbuild.context({
    // Entry points for the vscode extension and the language server
    entryPoints: ['src/extension/main.ts', 'src/language/main.ts'],
    outdir: 'out',
    bundle: true,
    target: "ES2017",
    // VSCode's extension host is still using cjs, so we need to transform the code
    format: 'cjs',
    // To prevent confusing node, we explicitly use the `.cjs` extension
    outExtension: {
        '.js': '.cjs'
    },
    loader: { '.ts': 'ts' },
    // z3-solver starts Z3's threads from its own files, so it stays in node_modules
    external: ['vscode', 'z3-solver'],
    platform: 'node',
    sourcemap: !minify,
    minify,
    plugins
});

// The DCR graph panel's page, for the webview: out/webview/dcr.js and dcr.css
const webview = await esbuild.context({
    entryPoints: ['src/webview/dcr.ts'],
    outdir: 'out/webview',
    bundle: true,
    target: 'ES2022',
    format: 'iife',
    platform: 'browser',
    sourcemap: !minify,
    minify,
    plugins
});

if (watch) {
    await Promise.all([extension.watch(), webview.watch()]);
} else {
    await Promise.all([extension.rebuild(), webview.rebuild()]);
    await Promise.all([extension.dispose(), webview.dispose()]);
}
