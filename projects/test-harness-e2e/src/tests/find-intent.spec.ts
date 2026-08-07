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
 * Exercises `DesktopAgent.findIntent()` (https://fdc3.finos.org/docs/api/ref/DesktopAgent#findintent),
 * run once per {@link TEST_MODES}.
 *
 * `app-1-root`'s default selected intent/context (the "StartCall"/"fdc3.contact" pair pre-selected in
 * the UI) is registered as something `app-1-root` itself can *raise*, and something `app-2-root` and
 * `app-1-domain-A` (both known locally in every container, per `test-harness.config.json`) can
 * *listen for* - so `findIntent("StartCall", { type: "fdc3.contact" })` from `app-1-root` should
 * always resolve to an `AppIntent` listing (at least) those two local apps as candidates.
 *
 * In `bridged` mode, a second, independent container (container B) is also opened, with its own
 * default instance of `app-2-root` (also a "StartCall" listener) - so the same `findIntent()` call
 * should *additionally* list container B's remote instance, tagged with a `desktopAgent` identifying
 * container B's bridge-connected Desktop Agent.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Find intent (${mode})`, () => {
        test('finds local (and, when bridged, remote) apps registered for an intent/context', async ({
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

            await containerA.findIntent('app-1-root');

            // The two local apps registered to listen for "StartCall"/"fdc3.contact" should always be
            // listed, without a `desktopAgent` property - that property is only ever attached by the
            // bridging layer.
            await containerA.verifyConsoleContains('app-1-root', /AppIntent for StartCall:: \{"apps":\[/);
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
