import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const directory = dirname(fileURLToPath(import.meta.url));

/** Minification drops ordinary comments, and highlight.js ships its licence only as a file. */
function bundledLicenseBanner(): string {
    const marked = readFileSync(resolve(directory, 'node_modules/marked/LICENSE.md'), 'utf8');
    const highlight = readFileSync(resolve(directory, 'node_modules/highlight.js/LICENSE'), 'utf8');
    const body = [
        `marked (MIT License)\n\n${marked.trim()}`,
        `highlight.js (BSD-3-Clause License)\n\n${highlight.trim()}`,
    ]
        .join('\n\n')
        .replaceAll('*/', '* /');
    return `/*!\n${body}\n*/`;
}

export default defineConfig({
    base: process.env.DOCS_BASE || '/fdc3-web/',
    build: {
        target: 'es2022',
        rollupOptions: {
            output: {
                banner: bundledLicenseBanner(),
            },
        },
    },
});
