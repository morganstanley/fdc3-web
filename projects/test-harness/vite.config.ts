/// <reference types='vitest' />
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: join(__dirname, '../../', 'node_modules', '.vitest', 'test-harness'),
    server: {
        port: 4200,
        host: 'localhost',
    },
    preview: {
        port: 4300,
        host: 'localhost',
    },
    plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md', '*.svg'])],
    build: {
        outDir: '../../build/test-harness/ui',
        emptyOutDir: true,
        reportCompressedSize: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                rootApp: resolve(__dirname, 'index.html'),
                appA: resolve(__dirname, 'app-a.html'),
                appB: resolve(__dirname, 'app-b.html'),
            },
        },
    },
}));
