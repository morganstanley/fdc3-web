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
 * Exercises `DesktopAgent.open()` (https://fdc3.finos.org/docs/api/ref/DesktopAgent#open), run once
 * per {@link TEST_MODES}.
 *
 * In `bridged` mode, a second, independent container (container B) is opened, and `open()` is called
 * from container A targeting container B's Desktop Agent explicitly - via the "Open on Desktop Agent"
 * dropdown (`renderDesktopAgentSelector` in `default-app.ts`), populated by first calling
 * `findInstances()` for an app known to be open in container B (`app-1-root`, open by default) and
 * extracting its `desktopAgent` - so the new instance is expected to open in container B, not A.
 *
 * In `non-bridged` mode there is only ever one container (container B is aliased to container A,
 * since a container can never target another, independent container's Desktop Agent without
 * bridging), no remote `desktopAgent` can be discovered, and `open()` is called with no `desktopAgent`
 * at all - so the new instance is expected to open in that same, single container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Open a new app instance (${mode})`, () => {
        test('opens a new instance of a target app that is not yet open', async ({ page, openPageB }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            // app-1-domain-A is not one of the two apps opened automatically on startup.
            await containerA.verifyApps(['app-1-root', 'app-2-root']);

            // app-1-root is open by default in both containers. In bridged mode, selecting it in
            // container A's app selector and clicking "Find Instances" discovers container B's
            // instance as a remote one (tagged with its desktopAgent name) - this is exactly how the
            // "Open on Desktop Agent" dropdown discovers which remote agents are available to target
            // for open(). In non-bridged mode there is no remote agent to discover, so the dropdown
            // stays on its default "local (no desktopAgent)" option and open() behaves like a normal,
            // local open.
            let desktopAgent: string | undefined;
            if (bridged) {
                await containerA.findInstances('app-1-root', 'app-1-root');
                const remoteAgents = await containerA.getDesktopAgentOptions('app-1-root');
                expect(remoteAgents).toHaveLength(1);
                [desktopAgent] = remoteAgents;
            }

            await containerA.open('app-1-root', 'app-1-domain-A', { desktopAgent });

            // A new app-container/iframe for app-1-domain-A should now be rendered in container B
            // (which, in non-bridged mode, is container A itself), and the calling app's console
            // should confirm the new instance was opened.
            await containerB.verifyAppOpen('app-1-domain-A');
            if (containerB !== containerA) {
                await expect(page.locator('app-container[data-app-id="app-1-domain-A"]')).toHaveCount(0);
            }
            await containerA.verifyConsoleContains('app-1-root', /New instance opened: : \{"appId":"app-1-domain-A/);
        });

        test('opens a second, independent instance of an already-open target app', async ({ page, openPageB }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            // app-2-root is already open (one of the two default apps) in both containers. As above,
            // discover container B's desktopAgent (bridged mode only) so the new instance can be
            // targeted there specifically.
            let desktopAgent: string | undefined;
            if (bridged) {
                await containerA.findInstances('app-1-root', 'app-2-root');
                const remoteAgents = await containerA.getDesktopAgentOptions('app-1-root');
                expect(remoteAgents).toHaveLength(1);
                [desktopAgent] = remoteAgents;
            }

            // Opening app-2-root again via open() should create a *second*, independent instance in
            // container B rather than reusing container B's existing, default one.
            await containerA.open('app-1-root', 'app-2-root', { desktopAgent });

            await containerA.verifyConsoleContains('app-1-root', /New instance opened: : \{"appId":"app-2-root/);

            // Both the original and the newly opened instance of app-2-root should now be findable
            // from container B's own perspective (the container the new instance actually opened in).
            await containerB.findInstances('app-1-root', 'app-2-root');
            await containerB.verifyConsoleContains(
                'app-1-root',
                /Instances of app app-2-root@localhost: \[\{"appId":"app-2-root[\s\S]*\},\{"appId":"app-2-root/,
            );
        });
    });
});
