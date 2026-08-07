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

/**
 * Exercises FDC3 Desktop Agent Bridging (https://fdc3.finos.org/docs/agent-bridging/spec) end to end:
 *
 * 1. Starts two independent "containers" (browser tabs), both opted in to bridging via `?bridge=true`,
 *    each connecting to the same bridging server and each hosting their own two default apps
 *    (`app-1-root`, `app-2-root`). Container A uses Playwright's default `page` fixture; container B
 *    uses the equivalent `pageB` fixture (see `dual-container-fixtures.ts`) since a single test can
 *    only get one context/page from the defaults.
 * 2. Raises an intent from `app-1-root` in container A.
 * 3. Because multiple apps across both bridged Desktop Agents can handle the intent, the FDC3 App
 *    Resolver pops up in container A - the "App-1-domain-A.com" entry belonging to container B
 *    (identified by its remote `data-desktop-agent` attribute) is selected.
 * 4. Verifies that container B - not container A - opens a new iframe for `app-1-domain-A` and that
 *    the newly opened app's console shows it received the intent (with a `source` identifying the
 *    raising app from the *other* Desktop Agent).
 */
test.describe('Desktop Agent Bridging - raise intent to a specific app on another container', () => {
    test('raises an intent from container A and opens/receives it on the target app in container B', async ({
        page,
        pageB,
    }) => {
        const containerA = await TestHarnessContainer.open(page, { bridge: true });
        const containerB = await TestHarnessContainer.open(pageB, { bridge: true });

        // Start from a clean slate in every default app in both containers.
        await containerA.clearConsoles(['app-1-root', 'app-2-root']);
        await containerB.clearConsoles(['app-1-root', 'app-2-root']);

        // Raise the (default) intent/context from app-1-root in container A. Multiple candidate
        // apps (local and, via the bridge, remote) will cause the resolver popup to appear.
        await containerA.raiseIntent('app-1-root');

        // Select the "App-1-domain-A.com" entry that is hosted by container B's Desktop Agent
        // (rather than the equivalent, not-yet-opened local entry in container A itself).
        await containerA.selectAppInResolver('app-1-domain-A', { remote: true });

        // The new app should open in container B, not container A.
        await containerB.verifyAppOpen('app-1-domain-A');
        await expect(page.locator('app-container[data-app-id="app-1-domain-A"]')).toHaveCount(0);

        // It should have received the raised intent, with a `source` describing app-1-root from
        // container A's (different) Desktop Agent/instance - without pinning the exact instanceId
        // or desktopAgent name, since both are generated at runtime.
        await containerB.verifyConsoleContains(
            'app-1-domain-A',
            /Received Intent:: \[\{"type":"fdc3\.contact"[\s\S]*"source":\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+","desktopAgent":"test-harness-root-app(-\d+)?"\}\}\]/,
        );
    });
});
