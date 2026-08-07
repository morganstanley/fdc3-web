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
 * Exercises `DesktopAgent.broadcast()` (https://fdc3.finos.org/docs/api/ref/DesktopAgent#broadcast)
 * and `DesktopAgent.addContextListener()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener) together, run once per
 * {@link TEST_MODES}.
 *
 * Both apps must first join the same user channel (there is no default/pre-joined channel), after
 * which a context broadcast from one app should be received by a context listener added in
 * another - both within a single container, and (in `bridged` mode) across two independent,
 * bridge-connected containers.
 *
 * - `bridged`: a second, independent container (container B) is opened. Both `app-1-root` (container
 *   A) and `app-2-root` (container B) join the same user channel, a context listener is added in
 *   container B's `app-2-root`, then `app-1-root` in container A broadcasts a context - the bridge
 *   is expected to relay the broadcast to container B, where the listener should receive it.
 * - `non-bridged`: there is only ever one container, so both apps join the same user channel, the
 *   listener is added in `app-2-root` and the broadcast is made from `app-1-root`, both within that
 *   same, single container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Broadcast and receive context (${mode})`, () => {
        test('broadcasts a context that is received by a context listener on the same user channel', async ({
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

            // Both apps must join the same user channel before a broadcast on "current user
            // channel" can be relayed between them - broadcasting/listening without ever joining a
            // user channel is a no-op.
            await containerB.joinUserChannel('app-2-root', 'fdc3.channel.1');
            await containerA.joinUserChannel('app-1-root', 'fdc3.channel.1');

            // Add a context listener in app-2-root (of container B), for the default "fdc3.contact"
            // context type, on the default "current user channel".
            await containerB.addContextListener('app-2-root', { context: 'fdc3.contact' });
            await containerB.verifyConsoleContains(
                'app-2-root',
                'Context listener added to current user channel for: fdc3.contact',
            );

            // Broadcast the same context type from app-1-root in container A.
            await containerA.broadcast('app-1-root', { context: 'fdc3.contact' });

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
