/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { appId, AppSteps, check, expect, handler, test } from '../helpers/harness.js';

const variants = [
    { name: 'no options', args: [] },
    { name: 'empty options', args: [{}] },
    { name: 'timeoutMs', args: [{ timeoutMs: 5000 }] },
    { name: 'identityUrl', args: [{ identityUrl: 'http://localhost:4301/connection.html' }] },
    { name: 'channelSelector and intentResolver enabled', args: [{ channelSelector: true, intentResolver: true }] },
    { name: 'channelSelector and intentResolver disabled', args: [{ channelSelector: false, intentResolver: false }] },
    { name: 'dontSetWindowFdc3', args: [{ dontSetWindowFdc3: true }] },
    { name: 'logLevels', args: [{ logLevels: { connection: 0, proxy: 0 } }] },
    { name: 'failover supplied but agent available', args: [{ timeoutMs: 5000, failover: handler('failover') }] },
];
for (const { name, args } of variants) {
    test(`getAgent first connection with ${name}`, async ({ sender, page }) => {
        await sender.start('open', [appId('connection-app')]);
        const app = new AppSteps(page, 'http://localhost:4301/connection.html', 'Connection explorer');
        await app.show();
        const connected = await app.call('getAgent', args);
        await check('this is the first connection', connected, expect.objectContaining({ sameAgent: false }));
        await check('the connection acquired the opened identity', await sender.success(), await app.identity());
        await app.eventCount('failover', 0);
        await check(
            'later getAgent calls reuse the agent',
            await app.call('getAgent'),
            expect.objectContaining({ sameAgent: true }),
        );
        if (name === 'dontSetWindowFdc3') {
            test.fail(true, 'GAP-005: getAgent ignores dontSetWindowFdc3 when creating a proxy');
            await check('window.fdc3 stays unset', connected.windowFdc3Set, false);
        }
    });
}

test('getAgent rejects when no desktop agent is available', async ({ page }) => {
    await page.goto('http://localhost:4301/connection.html');
    const app = new AppSteps(page, '', 'Standalone connection explorer');
    await app.show();
    await app.rejects('getAgent', [{ timeoutMs: 100 }], 'AgentNotFound');
});
