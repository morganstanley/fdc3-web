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
 * Exercises `DesktopAgent.getUserChannels()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#getuserchannels).
 *
 * This is a purely local/per-app FDC3 capability with no bridging-specific behaviour - the list of
 * user/system channels is a fixed, agent-local constant (`recommendedChannels`, see
 * `channel-message-handler.ts`), not something that varies between bridged and non-bridged mode, or
 * between local and remote Desktop Agents - so, unlike most of the other tests in this suite, this is
 * only run once rather than parameterized over `TEST_MODES`.
 */
test.describe('Get user channels', () => {
    test('logs the fixed list of available user channels', async ({ page }) => {
        const container = await TestHarnessContainer.open(page, { bridge: false });

        await container.getUserChannels('app-1-root');

        await container.verifyConsoleContains('app-1-root', 'User Channels::');
        await container.verifyConsoleContains('app-1-root', /"id":"fdc3\.channel\.1"[\s\S]*"id":"fdc3\.channel\.8"/);
    });
});
