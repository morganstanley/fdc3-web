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
 * Exercises `DesktopAgent.createPrivateChannel()`
 * (https://fdc3.finos.org/docs/api/ref/DesktopAgent#createprivatechannel) and the `PrivateChannel`
 * bridging events described in the agent-bridging spec
 * (https://fdc3.finos.org/docs/agent-bridging/spec) - `PrivateChannel.broadcast`/
 * `onAddContextListener` - run once per {@link TEST_MODES}.
 *
 * A private channel is never shared with a remote Desktop Agent by simply creating it - it only
 * becomes known to another app/agent once handed over as the result of a resolved `raiseIntent()`
 * call (see `sharedWithAgents`/`markPrivateChannelShared` in `channel-message-handler.ts`). So this
 * test: creates a private channel in `app-2-root` and selects it as the "Add Intent Listener"
 * handler's returned `IntentResult`, raises `StartCall` from `app-1-root` targeting `app-2-root`,
 * then uses the private channel handed back to `app-1-root` (via `resolution.getResult()`) to add a
 * context listener there, before broadcasting a context on the same channel from `app-2-root`'s end.
 *
 * - `bridged`: two independent containers are opened, so the private channel is shared *across* the
 *   bridge - the broadcast from container B's `app-2-root` must be relayed by the bridge to
 *   container A's `app-1-root` for the listener to receive it.
 * - `non-bridged`: there is only ever one container, so both apps interact with the same private
 *   channel within that single container.
 */
TEST_MODES.forEach(mode => {
    const bridged = mode === 'bridged';

    test.describe(`Create private channel (${mode})`, () => {
        test('shares a private channel as an intent result and broadcasts/receives a context on it', async ({
            page,
            openPageB,
        }) => {
            const containerA = await TestHarnessContainer.open(page, { bridge: bridged });
            const containerB = bridged
                ? await TestHarnessContainer.open(await openPageB(), { bridge: bridged })
                : containerA;

            // app-2-root creates a private channel and selects it, so its dynamically-added intent
            // listener (see setupIntentListeners/selectedPrivateChannel in default-app.ts) hands it
            // back as the raiseIntent result instead of the default
            // ms.test-harness.raiseIntentResult context.
            await containerB.createPrivateChannel('app-2-root');
            await containerB.verifyConsoleContains('app-2-root', 'Private channel has been received with id:');

            const consoleText = await containerB.getConsoleText('app-2-root');
            const [, privateChannelId] = /Private channel has been received with id: (\S+)/.exec(consoleText) ?? [];
            if (privateChannelId == null) {
                throw new Error(`Could not find created private channel id in app-2-root's console`);
            }

            await containerB.selectPrivateChannel('app-2-root', privateChannelId);

            // app-2-root statically listens for StartCall (see test-harness.config.json) and
            // app-1-root can raise it - since app-2-root is already open by default in both
            // containers, and is the only running candidate, raising StartCall resolves
            // automatically without an app resolver popup.
            await containerA.raiseIntent('app-1-root', { intent: 'StartCall' });
            await containerA.selectAppInResolver('app-2-root', { remote: bridged });

            // app-1-root's console should show the private channel it got back as the intent
            // result.
            await containerA.verifyConsoleContains('app-1-root', /Intent Result:: \{"id":"[^"]+","type":"private"\}/);

            // Add a context listener on that private channel from app-1-root's side.
            await containerA.addContextListener('app-1-root', { channel: privateChannelId, context: 'fdc3.contact' });
            await containerA.verifyConsoleContains(
                'app-1-root',
                `Context listener added to ${privateChannelId} for: fdc3.contact`,
            );

            // Broadcast a context on the same private channel from app-2-root's side - in bridged
            // mode this must be relayed across the bridge to app-1-root in container A.
            await containerB.broadcast('app-2-root', { channel: privateChannelId, context: 'fdc3.contact' });

            await containerA.verifyConsoleContains(
                'app-1-root',
                /Received Context:: \[\{"type":"fdc3\.contact"\},\{"source":\{"appId":"app-2-root@localhost"[\s\S]*\}\}\]/,
            );
        });
    });
});
