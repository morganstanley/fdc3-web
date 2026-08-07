/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { test } from '../helpers/dual-container-fixtures.js';
import { TestHarnessContainer } from '../helpers/test-harness-container.js';
import { TEST_MODES } from '../helpers/test-modes.js';

/**
 * Exercises `DesktopAgent.getOrCreateChannel()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#getorcreatechannel), run once per
 * {@link TEST_MODES}.
 *
 * App channels ARE relayed across a Desktop Agent Bridge (unlike private channels) - a context
 * broadcast on an app channel in one bridge-connected container should be received by a context
 * listener on that same app channel id in another, independent container.
 *
 * - `bridged`: a second, independent container (container B) is opened. Both `app-1-root`
 *   (container A) and `app-2-root` (container B) call `getOrCreateChannel()` with the same app
 *   channel id, a context listener is added on it in container B's `app-2-root`, then `app-1-root`
 *   in container A broadcasts a context on that channel - the bridge is expected to relay the
 *   broadcast to container B, where the listener should receive it.
 * - `non-bridged`: there is only ever one container, so both apps call `getOrCreateChannel()` with
 *   the same app channel id, the listener is added in `app-2-root` and the broadcast is made from
 *   `app-1-root`, both within that same, single container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Get or create app channel (${mode})`, () => {
        test('retrieves the same app channel in two apps and broadcasts/receives a context on it', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            // Only bridged mode needs (or can make use of) a second, independent container - in
            // non-bridged mode container A can never broadcast to a different, independent
            // container's listeners, so reuse containerA as "containerB" rather than
            // opening/wasting a second browser context.
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            await containerA.getOrCreateChannel('app-1-root', 'test-app-channel');
            await containerA.verifyConsoleContains('app-1-root', 'App channel has been received');

            await containerB.getOrCreateChannel('app-2-root', 'test-app-channel');
            await containerB.verifyConsoleContains('app-2-root', 'App channel has been received');

            await containerB.addContextListener('app-2-root', { channel: 'test-app-channel', context: 'fdc3.contact' });
            await containerB.verifyConsoleContains(
                'app-2-root',
                'Context listener added to test-app-channel for: fdc3.contact',
            );

            await containerA.broadcast('app-1-root', { channel: 'test-app-channel', context: 'fdc3.contact' });

            // app-2-root (in container B) should have received the broadcast context, with a
            // `source` identifying the broadcasting app (app-1-root) - the exact `instanceId`/
            // `desktopAgent` will vary, so match loosely.
            await containerB.verifyConsoleContains(
                'app-2-root',
                /Received Context:: \[\{"type":"fdc3\.contact"\},\{"source":\{"appId":"app-1-root@localhost"[\s\S]*\}\}\]/,
            );
        });
    });
});
