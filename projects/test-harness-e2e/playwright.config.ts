/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { defineConfig } from '@playwright/test';

const repoRoot = new URL('../../', import.meta.url).pathname;

/**
 * Ensures localhost/127.0.0.1 traffic bypasses any corporate HTTP(S) proxy configured via env vars.
 * Without this, environments with an `HTTP_PROXY`/`http_proxy` set (common on corporate networks)
 * cause both Playwright's own `webServer` readiness checks and, in some Node versions, page requests
 * to be routed through the proxy - which cannot reach localhost - and time out.
 */
function bypassProxyForLocalhost(): void {
    for (const key of ['NO_PROXY', 'no_proxy']) {
        const existing = process.env[key];
        const additions = ['localhost', '127.0.0.1'];
        process.env[key] =
            existing != null && existing.length > 0 ? `${additions.join(',')},${existing}` : additions.join(',');
    }
}

bypassProxyForLocalhost();

/**
 * Playwright config for the FDC3 Test Harness automation suite.
 *
 * Boots the two services the harness depends on before running any test:
 *  - `test-harness` (`nx serve test-harness`): serves the root app UI on port 4200 and, via its
 *    node process, the per-domain app servers (4300-4305) and the mock app-directory (4299).
 *  - `fdc3-web-bridging-server` (`nx serve fdc3-web-bridging-server`): the Desktop Agent Bridge
 *    websocket server, used by any test that opens a container with `?bridge=true`.
 */
export default defineConfig({
    testDir: './src/tests',
    timeout: 60_000,
    expect: {
        timeout: 15_000,
    },
    fullyParallel: false,
    forbidOnly: !!process.env['CI'],
    retries: process.env['CI'] ? 1 : 0,
    workers: 1,
    // `html` always writes a browsable report to `playwright-report/` (even on a fully passing
    // run) so results can be reviewed after the fact with `npx playwright show-report`.
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:4200',
        trace: 'retain-on-failure',
        // NOTE: video/screenshot/viewport here only apply to contexts/pages created via the default
        // `context`/`page` fixtures. This suite's spec creates its own two contexts (one per
        // container) so it reads these same settings back out of `testInfo.project.use` rather than
        // hardcoding them again - see `src/helpers/dual-container-fixtures.ts`.
        video: 'on',
        screenshot: 'on',
        viewport: { width: 1920, height: 1080 },
    },
    webServer: [
        {
            // Uses `serve-e2e` (not `serve`) so the dev server doesn't auto-open a real browser tab
            // in addition to the ones Playwright itself drives.
            command: 'npx nx serve-e2e test-harness',
            cwd: repoRoot,
            url: 'http://localhost:4200/index.html',
            timeout: 180_000,
            reuseExistingServer: !process.env['CI'],
        },
        {
            command: 'npx nx serve fdc3-web-bridging-server',
            cwd: repoRoot,
            port: 4475,
            // Slightly generous timeout: on a fully cold start the TCP port can be accepting
            // connections briefly before the websocket server is fully ready to upgrade them.
            timeout: 90_000,
            reuseExistingServer: !process.env['CI'],
        },
    ],
});
