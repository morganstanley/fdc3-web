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
 * Exercises `DesktopAgent.addEventListener()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#addeventlistener).
 *
 * This has no bridging-specific behaviour (events are always sourced from the local Desktop Agent
 * only) - so, unlike most of the other tests in this suite, this is only run once rather than
 * parameterized over `TEST_MODES`.
 *
 * A `userChannelChanged` listener is registered, then {@link TestHarnessContainer.joinUserChannel} is
 * used to trigger that event, and the app's console is checked for the resulting `Received Event::`
 * log.
 */
test.describe('Add event listener', () => {
    test('receives a userChannelChanged event after joining a user channel', async ({ page }) => {
        const container = await TestHarnessContainer.open(page, { bridge: false });

        await container.addEventListener('app-1-root', 'userChannelChanged');
        await container.verifyConsoleContains('app-1-root', 'Event listener has been added');

        await container.joinUserChannel('app-1-root', 'fdc3.channel.1');

        await container.verifyConsoleContains(
            'app-1-root',
            /Received Event:: \[\{"type":"userChannelChanged","details":\{"newChannelId":"fdc3\.channel\.1"/,
        );
    });
});
