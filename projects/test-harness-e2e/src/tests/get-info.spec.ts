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
 * Exercises `DesktopAgent.getInfo()` (https://fdc3.finos.org/docs/api/ref/DesktopAgent#getinfo).
 *
 * `getInfo()` has no bridging-specific behaviour, so this is only run once rather than parameterized
 * over `TEST_MODES`.
 */
test.describe('Get info', () => {
    test('logs the ImplementationMetadata for the desktop agent', async ({ page }) => {
        const container = await TestHarnessContainer.open(page, { bridge: false });

        await container.getInfo('app-1-root');

        await container.verifyConsoleContains(
            'app-1-root',
            /Information about DesktopAgent:: \{"fdc3Version":"[\d.]+","provider":"[^"]+"/,
        );
    });
});
