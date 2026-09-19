/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { expect, it } from 'vitest';
import type { PrivateChannel } from '../channel/channel.private.js';
import type { PublicChannel } from '../channel/channel.public.js';
import type { DesktopAgentProxy } from './desktop-agent-proxy.js';

it('exposes only the supported 3.0 signatures', () => {
    // Type-checked but deliberately never invoked: these calls document the removed API surface.
    const check = (agent: DesktopAgentProxy, channel: PublicChannel, privateChannel: PrivateChannel) => {
        const handler = () => {};
        // @ts-expect-error removed system-channel alias
        agent.getSystemChannels();
        // @ts-expect-error removed channel-join alias
        agent.joinChannel('red');
        // @ts-expect-error explicit context type is required
        agent.addContextListener(handler);
        // @ts-expect-error explicit context type is required
        channel.addContextListener(handler);
        // @ts-expect-error inherited handler-only overload is removed
        privateChannel.addContextListener(handler);
        // @ts-expect-error string app targets are removed
        agent.open('app');
        // @ts-expect-error string app targets are removed
        agent.raiseIntent('View', { type: 'fdc3.nothing' }, 'app');
        // @ts-expect-error string app targets are removed
        agent.raiseIntentForContext({ type: 'fdc3.nothing' }, 'app');
        // @ts-expect-error use addEventListener
        privateChannel.onAddContextListener(handler);
        // @ts-expect-error use addEventListener
        privateChannel.onUnsubscribe(handler);
        // @ts-expect-error use addEventListener
        privateChannel.onDisconnect(handler);
        agent.getUserChannels();
        agent.joinUserChannel('red');
        agent.addContextListener(null, handler);
        channel.addContextListener(null, handler);
        agent.open({ appId: 'app' });
        agent.raiseIntent('View', { type: 'fdc3.nothing' }, { appId: 'app' });
        agent.raiseIntentForContext({ type: 'fdc3.nothing' }, { appId: 'app' });
        privateChannel.addEventListener('addContextListener', handler);
        privateChannel.addEventListener('unsubscribe', handler);
        privateChannel.addEventListener('disconnect', handler);
    };
    expect(check).toBeTypeOf('function');
});
