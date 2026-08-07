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
 * Exercises `DesktopAgent.getAppMetadata()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#getappmetadata), run once per {@link TEST_MODES}.
 *
 * In `bridged` mode, a second, independent container (container B) is opened, and `getAppMetadata()`
 * is called from container A targeting container B's Desktop Agent explicitly - via the "Open on
 * Desktop Agent" dropdown (as with `open()`/{@link TestHarnessContainer.open}) - so the returned
 * metadata is expected to be stamped with container B's `desktopAgent` name.
 *
 * In `non-bridged` mode there is only ever one container, no remote `desktopAgent` can be discovered,
 * and `getAppMetadata()` is called with no `desktopAgent` at all - so the returned metadata describes
 * the local app directory entry, with no `desktopAgent` property.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Get app metadata (${mode})`, () => {
        test('fetches metadata for a target app', async ({ page, openPageB }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            if (bridged) {
                await TestHarnessContainer.open(await openPageB(), { bridge: bridged });
            }

            let desktopAgent: string | undefined;
            if (bridged) {
                // app-1-root is open by default in both containers - discover container B's
                // desktopAgent the same way open.spec.ts does, so getAppMetadata() can target it.
                await containerA.findInstances('app-1-root', 'app-1-root');
                const remoteAgents = await containerA.getDesktopAgentOptions('app-1-root');
                expect(remoteAgents).toHaveLength(1);
                [desktopAgent] = remoteAgents;
            }

            await containerA.getAppMetadata('app-1-root', 'app-1-root', { desktopAgent });

            if (bridged) {
                await containerA.verifyConsoleContains(
                    'app-1-root',
                    /Metadata for app-1-root@localhost:: \{"appId":"app-1-root[\s\S]*"desktopAgent":"[^"]+"/,
                );
            } else {
                await containerA.verifyConsoleContains(
                    'app-1-root',
                    /Metadata for app-1-root@localhost:: \{"appId":"app-1-root/,
                );
            }
        });
    });
});
