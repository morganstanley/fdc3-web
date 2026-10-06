/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { test as base } from '@playwright/test';
import { AppSteps } from './app-steps.js';
export { AppSteps, check } from './app-steps.js';
export * from './test-data.js';

// Only the app directory is controlled. All agent discovery, API calls, messages and UIs are real.
const directory = {
    message: 'OK',
    applications: [
        {
            appId: 'connection-app',
            title: 'Connection explorer',
            type: 'web',
            details: { url: 'http://localhost:4301/connection.html' },
        },
        { appId: 'app-1-root', title: 'Sender', type: 'web', details: { url: 'http://localhost:4300/app-a.html' } },
        {
            appId: 'app-2-root',
            title: 'Receiver',
            type: 'web',
            details: { url: 'http://localhost:4300/app-b.html' },
            interop: {
                intents: {
                    listensFor: {
                        HarnessIntent: { contexts: ['fdc3.instrument', 'fdc3.nothing'], resultType: 'e2e.reply' },
                    },
                },
            },
        },
        {
            appId: 'app-1-domain-A',
            title: 'Cross origin',
            type: 'web',
            details: { url: 'http://localhost:4301/app-a.html' },
            interop: {
                intents: {
                    listensFor: { CrossOriginIntent: { contexts: ['fdc3.instrument'], resultType: 'e2e.reply' } },
                },
            },
        },
    ],
};

export const test = base.extend<{ sender: AppSteps; receiver: AppSteps }>({
    page: async ({ page }, use) => {
        await base.step('Given an isolated harness with a deterministic app directory', async () => {
            await page.route('http://localhost:4299/v2/apps', route => route.fulfill({ json: directory }));
            await page.goto('/index.html');
        });
        await use(page);
    },
    sender: async ({ page }, use) => {
        const app = new AppSteps(page, 'http://localhost:4300/app-a.html', 'Sender');
        await app.ready();
        await use(app);
    },
    receiver: async ({ page }, use) => {
        const app = new AppSteps(page, 'http://localhost:4300/app-b.html', 'Receiver');
        await app.ready();
        await use(app);
    },
});
export { expect } from '@playwright/test';
