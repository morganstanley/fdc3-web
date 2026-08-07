/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

/**
 * The two modes every test in this suite should be able to run under:
 *  - `bridged`: each container connects to the shared FDC3 Desktop Agent Bridge (`?bridge=true`), so
 *    apps opened/intents raised in one container can be resolved to apps in the *other* container.
 *  - `non-bridged`: each container runs its own independent, unconnected Desktop Agent - apps/intents
 *    can only resolve to apps within the *same* container.
 *
 * New tests should be written once, parameterized over `TEST_MODES`, e.g.:
 * ```ts
 * TEST_MODES.forEach(mode => {
 *     test.describe(`My scenario (${mode})`, () => {
 *         test('does the thing', async ({ page, pageB }) => {
 *             const containerA = await TestHarnessContainer.open(page, { bridge: mode === 'bridged' });
 *             const containerB = await TestHarnessContainer.open(pageB, { bridge: mode === 'bridged' });
 *             // ...
 *         });
 *     });
 * });
 * ```
 */
export const TEST_MODES = ['bridged', 'non-bridged'] as const;

/** One of the values in {@link TEST_MODES}. */
export type TestMode = (typeof TEST_MODES)[number];

/** Convenience predicate: whether the given mode expects containers to be connected via the bridge. */
export function isBridgedMode(mode: TestMode): boolean {
    return mode === 'bridged';
}
