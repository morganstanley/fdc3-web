/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { appId, AppSteps, check, expect, handler, instrument, metadata, test } from '../helpers/harness.js';

for (const args of [[], [{}], [{ timeoutMs: 5000, channelSelector: false, intentResolver: false }]]) {
    test(`getAgent(${JSON.stringify(args)}) reuses the connected agent`, async ({ sender }) => {
        await check(
            'getAgent returns the harness agent',
            await sender.call('getAgent', args),
            expect.objectContaining({ sameAgent: true }),
        );
    });
}

test('getInfo identifies the implementation and current app instance', async ({ sender }) => {
    const info = await sender.call('getInfo');
    await check(
        'implementation metadata has the documented fields',
        info,
        expect.objectContaining({
            fdc3Version: expect.stringMatching(/^3\./),
            provider: expect.any(String),
            appMetadata: expect.objectContaining({ ...appId('app-1-root'), instanceId: expect.any(String) }),
        }),
    );
});

for (const instance of [false, true]) {
    test(`getAppMetadata with ${instance ? 'app and instance IDs' : 'app ID only'}`, async ({ sender, receiver }) => {
        const target = instance ? await receiver.identity() : appId('app-2-root');
        await check(
            'metadata describes the requested app',
            await sender.call('getAppMetadata', [target]),
            expect.objectContaining({ ...target, title: 'Receiver' }),
        );
    });
}

test('findInstances includes running instances and excludes unopened apps', async ({ sender, receiver }) => {
    const target = await receiver.identity();
    await check('running receiver is listed', await sender.call('findInstances', [appId('app-2-root')]), [
        expect.objectContaining(target),
    ]);
    await check('an unopened app has no instances', await sender.call('findInstances', [appId('app-1-domain-A')]), []);
});

for (const variant of ['omitted', 'null', 'context', 'context and metadata', 'metadata only'] as const) {
    test(`open across origins with ${variant}`, async ({ sender, page }) => {
        const args =
            variant === 'omitted'
                ? []
                : variant === 'null'
                  ? [null]
                  : variant === 'context'
                    ? [instrument]
                    : variant === 'context and metadata'
                      ? [instrument, metadata]
                      : [null, metadata];
        await sender.start('open', [appId('app-1-domain-A'), ...args]);
        const opened = new AppSteps(page, 'http://localhost:4301/app-a.html', 'Opened cross-origin app');
        await opened.ready();
        if (variant === 'context' || variant === 'context and metadata') {
            await opened.call('addContextListener', [null, handler('initial')]);
            await opened.received('initial', [
                instrument,
                variant === 'context and metadata' ? expect.objectContaining(metadata) : expect.any(Object),
            ]);
        }
        const identity = await sender.success();
        await check('open returns the newly connected instance', identity, await opened.identity());
        await check(
            'findInstances sees the opened instance',
            await sender.call('findInstances', [appId('app-1-domain-A')]),
            [expect.objectContaining(identity)],
        );
    });
}

test('close destroys the calling iframe and removes its instance', async ({ sender, receiver, page }) => {
    await receiver.start('close');
    await test.step('Then the receiver iframe is destroyed', async () => {
        await expect(
            page.locator('[automation-id="fth-app-iframe"][data-app-url="http://localhost:4300/app-b.html"]'),
        ).toHaveCount(0);
    });
    await check(
        'the closed instance is no longer discoverable',
        await sender.call('findInstances', [appId('app-2-root')]),
        [],
    );
});

for (const method of ['raiseIntent', 'raiseIntentForContext']) {
    test(`${method} with newInstance=true launches a fresh receiver`, async ({ sender, receiver, page }) => {
        const existing = await receiver.identity();
        const args =
            method === 'raiseIntent'
                ? ['HarnessIntent', instrument, appId('app-2-root'), true, metadata]
                : [instrument, appId('app-2-root'), true, metadata];
        const resolution = await sender.call(method, args, 'agent', 'resolution');
        await check(
            'a fresh instance handles the intent',
            resolution.source,
            expect.objectContaining({
                ...appId('app-2-root'),
                instanceId: expect.not.stringMatching(`^${existing.instanceId}$`),
            }),
        );
        const opened = new AppSteps(page, 'http://localhost:4300/app-b.html', 'New receiver', 1);
        await opened.ready();
        await check('resolution source is the newly opened receiver', resolution.source, await opened.identity());
        await check(
            'getResult works for a newly opened instance',
            await sender.call('getResult', [], 'resolution'),
            expect.objectContaining({ type: 'ms.test-harness.raiseIntentResult', raisedIntent: 'HarnessIntent' }),
        );
    });
    test(`${method} with newInstance=false never launches an unopened app`, async ({ sender, page }) => {
        const args =
            method === 'raiseIntent'
                ? ['CrossOriginIntent', instrument, appId('app-1-domain-A'), false]
                : [instrument, appId('app-1-domain-A'), false];
        await sender.rejects(method, args, 'TargetInstanceUnavailable');
        await test.step('Then no cross-origin iframe was launched', async () => {
            await expect(
                page.locator('[automation-id="fth-app-iframe"][data-app-url="http://localhost:4301/app-a.html"]'),
            ).toHaveCount(0);
        });
    });
}

test('open rejects an unknown app', async ({ sender }) => {
    await sender.rejects('open', [appId('missing')], 'AppNotFound');
});
