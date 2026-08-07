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
 * Exercises `DesktopAgent.addIntentListener()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#addintentlistener), run once per
 * {@link TEST_MODES}.
 *
 * `ViewNews` is raised by `app-1-root` but its statically configured listener (`app-1-domain-D`) is
 * never opened in this test, so dynamically registering a listener for it on `app-2-root` via the
 * "Add Intent Listener" section makes `app-2-root` the sole *running* candidate. Raising `ViewNews`
 * therefore resolves automatically (no app resolver popup, since inactive/never-opened candidates
 * are deprioritized behind running ones - see `filterActiveApps`/`filterInactiveApps` in
 * `app-resolver.default.ts`), letting this test focus purely on confirming the dynamically-added
 * listener receives the intent.
 *
 * - `bridged`: two independent containers are opened. The listener is added to `app-2-root` in
 *   container B; raising the intent from `app-1-root` in container A is expected to relay across the
 *   bridge to container B's `app-2-root`, which should log `Received Intent::`.
 * - `non-bridged`: there is only ever one container, so the listener is added to `app-2-root` and the
 *   intent is raised from `app-1-root`, both within that same, single container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Add intent listener (${mode})`, () => {
        test('dynamically registers an intent listener that then receives a raised intent', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            // Register a listener for "ViewNews" (which app-1-root can raise, but for which no app
            // is listening by default in `test-harness.config.json`) on app-2-root - in container B
            // (or container A, when non-bridged/aliased).
            await containerB.addIntentListener('app-2-root', 'ViewNews');
            await containerB.verifyConsoleContains('app-2-root', 'Adding Intent Listener for: ViewNews');

            // Raise the "ViewNews" intent (with the default "fdc3.contact" context) from app-1-root
            // in container A. app-2-root (which just added the listener) is the only *running*
            // candidate app registered to handle it (the statically configured listener,
            // app-1-domain-D, is never opened), so this resolves automatically without an app
            // resolver popup.
            await containerA.raiseIntent('app-1-root', { intent: 'ViewNews' });

            // app-2-root (in container B) should have received the raised intent, with a `source`
            // describing app-1-root. Bridged mode additionally expects a `desktopAgent` identifying
            // the bridge that relayed the intent; non-bridged mode must NOT have a `desktopAgent` key
            // at all, since that property is only ever attached by the bridging layer.
            const sourcePattern = bridged
                ? /"source":\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+","desktopAgent":"test-harness-root-app(-\d+)?"\}/
                : /"source":\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+"\}/;

            await containerB.verifyConsoleContains(
                'app-2-root',
                new RegExp(`Received Intent:: \\[\\{"type":"fdc3\\.contact"[\\s\\S]*${sourcePattern.source}\\}\\]`),
            );
        });
    });
});
