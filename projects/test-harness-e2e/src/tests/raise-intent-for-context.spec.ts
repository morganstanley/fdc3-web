/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { expect, test } from '../helpers/dual-container-fixtures.js';
import { TestHarnessContainer } from '../helpers/test-harness-container.js';
import { TEST_MODES } from '../helpers/test-modes.js';

/**
 * Exercises `DesktopAgent.raiseIntentForContext()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#raiseintentforcontext), run once per
 * {@link TEST_MODES}.
 *
 * Unlike `raiseIntent()` (which names a specific intent up front), `raiseIntentForContext()` only
 * supplies a context - the Desktop Agent/resolver is responsible for finding every intent registered
 * against that context type, across every candidate app (local, and in bridged mode also remote), and
 * presenting all of them for the user to choose from.
 *
 * - `bridged`: two independent "containers" (browser tabs) both opt in to Desktop Agent Bridging via
 *   `?bridge=true` and connect to the same bridging server. Container A raises an intent for the
 *   default `fdc3.contact` context; the resolver's *remote* "App-1-domain-A.com" entry (identified by
 *   its `data-desktop-agent` attribute) is selected, and the app is expected to open in container B.
 * - `non-bridged`: there is only ever one container, so "container B" is simply an alias for
 *   container A, and the resolver's *local* entry is selected instead, opening the app within the same
 *   container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Raise intent for context to a specific target app (${mode})`, () => {
        test('raises an intent for a context from container A and opens/receives it on the target app', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });

            // Only bridged mode needs (or can make use of) a second, independent container - in
            // non-bridged mode container A can never resolve to a different container's apps, so
            // reuse containerA as "containerB" rather than opening/wasting a second browser context.
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            // Raise an intent for the (default) "fdc3.contact" context from app-1-root in container
            // A. Multiple candidate apps/intents (local, and in bridged mode also remote) will cause
            // the resolver popup to appear.
            await containerA.raiseIntentForContext('app-1-root');

            // In bridged mode, select the "App-1-domain-A.com" entry hosted by container B's Desktop
            // Agent. In non-bridged mode, select the equivalent local entry instead (the only one
            // available), which will open within container A itself.
            await containerA.selectAppInResolver('app-1-domain-A', { remote: bridged });

            // The new app should open in container B (which, in non-bridged mode, is container A).
            await containerB.verifyAppOpen('app-1-domain-A');
            if (containerB !== containerA) {
                await expect(page.locator('app-container[data-app-id="app-1-domain-A"]')).toHaveCount(0);
            }

            // It should have received the raised intent, with a `source` describing app-1-root.
            // Bridged mode additionally expects a `desktopAgent` identifying the bridge that relayed
            // the intent; non-bridged mode must NOT have a `desktopAgent` key at all, since that
            // property is only ever attached by the bridging layer.
            const sourcePattern = bridged
                ? /"source":\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+","desktopAgent":"test-harness-root-app(-\d+)?"\}/
                : /"source":\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+"\}/;

            await containerB.verifyConsoleContains(
                'app-1-domain-A',
                new RegExp(`Received Intent:: \\[\\{"type":"fdc3\\.contact"[\\s\\S]*${sourcePattern.source}\\}\\]`),
            );
        });
    });
});
