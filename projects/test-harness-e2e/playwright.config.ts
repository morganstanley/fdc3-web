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
import { fileURLToPath } from 'node:url';

// Retain local routing when running behind a corporate proxy (as in the bridging suite).
for (const key of ['NO_PROXY', 'no_proxy']) {
    process.env[key] = `localhost,127.0.0.1,${process.env[key] ?? ''}`;
}
export default defineConfig({
    testDir: './src/tests',
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : 4,
    reporter: [
        ['list'],
        ['json', { outputFile: fileURLToPath(new URL('../../reports/playwright-results.json', import.meta.url)) }],
        ['html', { outputFolder: fileURLToPath(new URL('../../playwright-report', import.meta.url)), open: 'never' }],
    ],
    outputDir: '../../test-results',
    use: {
        baseURL: 'http://localhost:4200',
        testIdAttribute: 'automation-id',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        viewport: { width: 1600, height: 1200 },
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: [
        {
            command: 'npx nx serve-node test-harness',
            url: 'http://localhost:4299/v2/apps',
            timeout: 180_000,
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            reuseExistingServer: !process.env.CI,
            env: { NX_DAEMON: 'false' },
        },
        {
            command: 'npx nx serve-ui test-harness --open=false',
            url: 'http://localhost:4200/index.html',
            timeout: 180_000,
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            reuseExistingServer: !process.env.CI,
            env: { NX_DAEMON: 'false' },
        },
    ],
});
