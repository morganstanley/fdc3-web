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
 * Exercises `DesktopAgent.findInstances()` (https://fdc3.finos.org/docs/api/ref/DesktopAgent#findinstances),
 * run once per {@link TEST_MODES}.
 *
 * `app-1-root` is open by default in every container. In `bridged` mode, a second, independent
 * container (container B) is also opened with its own default instance of `app-1-root` - so calling
 * `findInstances()` for `app-1-root` from container A should return *both* the local instance (no
 * `desktopAgent` property) and container B's remote instance (with a `desktopAgent` property
 * identifying container B's bridge-connected Desktop Agent).
 *
 * In `non-bridged` mode there is only ever one container (container B is aliased to container A,
 * since a container can never discover another, independent container's instances without bridging),
 * so `findInstances()` should return only the single local instance.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Find instances of an app (${mode})`, () => {
        test('lists instances from both the local and, when bridged, a remote Desktop Agent', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            // Only bridged mode needs (or can make use of) a second, independent container - in
            // non-bridged mode container A can never discover another container's instances, so reuse
            // containerA as "containerB" rather than opening/wasting a second browser context.
            if (bridged) {
                await TestHarnessContainer.open(await openPageB(), { bridge: bridged });
            }

            await containerA.findInstances('app-1-root', 'app-1-root');

            // The local instance (container A's own) should always be listed, without a
            // `desktopAgent` property - that property is only ever attached by the bridging layer.
            await containerA.verifyConsoleContains(
                'app-1-root',
                /Instances of app app-1-root@localhost: \[\{"appId":"app-1-root@localhost","instanceId":"[0-9a-f-]+"/,
            );

            if (bridged) {
                // Container B's instance should also be listed, tagged with a `desktopAgent`
                // identifying container B's bridge-connected Desktop Agent.
                await containerA.verifyConsoleContains('app-1-root', /"desktopAgent":"test-harness-root-app(-\d+)?"/);

                // Exactly two instances should be found in total: the local one and container B's.
                const consoleText = await containerA.getConsoleText('app-1-root');
                const instanceCount = (consoleText.match(/"appId":"app-1-root@localhost"/g) ?? []).length;
                expect(instanceCount).toBe(2);
            } else {
                // Only the single local instance should be found - no other, independent container
                // exists to discover instances from.
                const consoleText = await containerA.getConsoleText('app-1-root');
                const instanceCount = (consoleText.match(/"appId":"app-1-root@localhost"/g) ?? []).length;
                expect(instanceCount).toBe(1);
            }
        });
    });
});
