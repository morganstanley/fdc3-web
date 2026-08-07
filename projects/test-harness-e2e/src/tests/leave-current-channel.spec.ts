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

/**
 * Exercises `DesktopAgent.leaveCurrentChannel()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#leavecurrentchannel).
 *
 * This is a purely local/per-app FDC3 capability with no bridging-specific behaviour - so, unlike
 * most of the other tests in this suite, this is only run once rather than parameterized over
 * `TEST_MODES`.
 *
 * The `<ms-channel-selector>` widget (see {@link TestHarnessContainer.joinUserChannel}) calls
 * `leaveCurrentChannel()` when its already-joined channel button is clicked again - so leaving is
 * exercised by joining the same channel twice, and `getCurrentChannel()` is used to confirm the app
 * is joined, then no longer joined, to it.
 */
test.describe('Leave current channel', () => {
    test('leaves the currently joined user channel, reverting getCurrentChannel() to null', async ({ page }) => {
        const container = await TestHarnessContainer.open(page, { bridge: false });

        await container.joinUserChannel('app-1-root', 'fdc3.channel.1');
        await container.getCurrentChannel('app-1-root');
        await container.verifyConsoleContains('app-1-root', 'Current Channel:: {"id":"fdc3.channel.1","type":"user"}');
        await container.clearConsole('app-1-root');

        // Clicking the already-joined channel button again calls leaveCurrentChannel().
        await container.joinUserChannel('app-1-root', 'fdc3.channel.1');

        await container.getCurrentChannel('app-1-root');
        await container.verifyConsoleContains('app-1-root', 'Current Channel:');
    });
});
