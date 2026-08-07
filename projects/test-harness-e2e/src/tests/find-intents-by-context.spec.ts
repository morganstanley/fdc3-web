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
 * Exercises `DesktopAgent.findIntentsByContext()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#findintentsbycontext), run once per
 * {@link TEST_MODES}.
 *
 * `app-1-root`'s default context input value ("fdc3.contact") is registered against several intents
 * across the app directory (per `test-harness.config.json`), including "StartCall" (`app-2-root`,
 * `app-1-domain-A`) and "StartChat" (`app-2-root`) - both apps known locally in every container - so
 * `findIntentsByContext({ type: "fdc3.contact" })` from `app-1-root` should always resolve to an
 * `AppIntent[]` including at least those two intents, each listing their respective local apps as
 * candidates.
 *
 * In `bridged` mode, a second, independent container (container B) is also opened, with its own
 * default instance of `app-2-root` (also a "StartCall"/"StartChat" listener) - so the same
 * `findIntentsByContext()` call should *additionally* list container B's remote instance, tagged with
 * a `desktopAgent` identifying container B's bridge-connected Desktop Agent.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Find intents by context (${mode})`, () => {
        test('finds local (and, when bridged, remote) intents/apps registered for a context', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            // Only bridged mode needs (or can make use of) a second, independent container - in
            // non-bridged mode container A can never discover another container's registrations, so
            // reuse containerA as "containerB" rather than opening/wasting a second browser context.
            if (bridged) {
                await TestHarnessContainer.open(await openPageB(), { bridge: bridged });
            }

            await containerA.findIntentsByContext('app-1-root');

            // Both "StartCall" and "StartChat" (registered against "fdc3.contact" by local apps)
            // should always be listed, and their candidate apps should always include the two local
            // ones, without a `desktopAgent` property - that property is only ever attached by the
            // bridging layer.
            await containerA.verifyConsoleContains('app-1-root', /AppIntents for context 'fdc3\.contact':: \[/);
            await containerA.verifyConsoleContains('app-1-root', /"name":"StartCall"/);
            await containerA.verifyConsoleContains('app-1-root', /"name":"StartChat"/);
            await containerA.verifyConsoleContains('app-1-root', /"appId":"app-2-root@localhost"/);
            await containerA.verifyConsoleContains('app-1-root', /"appId":"app-1-domain-A@localhost"/);

            if (bridged) {
                // Container B's remote instance of app-2-root should also be listed, tagged with a
                // `desktopAgent` identifying container B's bridge-connected Desktop Agent.
                await containerA.verifyConsoleContains('app-1-root', /"desktopAgent":"test-harness-root-app(-\d+)?"/);
            }
        });
    });
});
