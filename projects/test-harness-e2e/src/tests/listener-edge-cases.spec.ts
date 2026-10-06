/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { check, contact, expect, handler, instrument, test } from '../helpers/harness.js';

for (const target of ['agent', 'channel']) {
    for (const filter of [[], ['fdc3.instrument', 42]]) {
        test(`${target}.addContextListener rejects invalid array ${JSON.stringify(filter)}`, async ({ sender }) => {
            if (target === 'channel') await sender.call('getOrCreateChannel', ['validation'], 'agent', 'channel');
            await sender.rejects('addContextListener', [filter, handler('invalid')], 'InvalidArguments', target);
        });
    }
}

test('Channel.addContextListener does not replay context already on the channel', async ({ sender, receiver }) => {
    await sender.call('getOrCreateChannel', ['no-replay'], 'agent', 'channel');
    await receiver.call('getOrCreateChannel', ['no-replay'], 'agent', 'channel');
    await sender.call('broadcast', [instrument], 'channel');
    await receiver.call('addContextListener', [null, handler('late')], 'channel');
    await sender.call('broadcast', [contact], 'channel');
    await receiver.received('late', [contact, expect.any(Object)]);
    await receiver.eventCount('late', 1);
});

test('DesktopAgent.addContextListener replays existing user context and follows channel switches', async ({
    sender,
    receiver,
}) => {
    const [first, second] = await sender.call('getUserChannels');
    await sender.call('joinUserChannel', [first.id]);
    await sender.call('broadcast', [instrument]);
    await receiver.call('joinUserChannel', [first.id]);
    await receiver.call('addContextListener', [instrument.type, handler('replayed')]);
    await receiver.received('replayed', [instrument, expect.any(Object)]);
    await sender.call('joinUserChannel', [second.id]);
    const updated = { ...instrument, id: { ticker: 'AAPL' } };
    await sender.call('broadcast', [updated]);
    await receiver.call('joinUserChannel', [second.id]);
    await receiver.received('replayed', [updated, expect.any(Object)]);
    await receiver.eventCount('replayed', 2);
});

test('cleared context is not replayed to new user-channel listeners', async ({ sender, receiver }) => {
    const [channel] = await sender.call('getUserChannels');
    await sender.call('joinUserChannel', [channel.id]);
    await sender.call('getCurrentChannel', [], 'agent', 'channel');
    await sender.call('broadcast', [instrument]);
    await sender.call('clearContext', [], 'channel');
    await receiver.call('joinUserChannel', [channel.id]);
    await receiver.call('addContextListener', [null, handler('late')]);
    await sender.call('broadcast', [contact]);
    await receiver.received('late', [contact, expect.any(Object)]);
    await receiver.eventCount('late', 1);
});

test('DesktopAgent.addEventListener observes contextCleared on its current channel', async ({ sender, receiver }) => {
    const [channel] = await sender.call('getUserChannels');
    await sender.call('joinUserChannel', [channel.id]);
    await receiver.call('joinUserChannel', [channel.id]);
    await sender.call('getCurrentChannel', [], 'agent', 'channel');
    await receiver.call('addEventListener', ['contextCleared', handler('cleared')]);
    await sender.call('broadcast', [instrument]);
    await sender.call('clearContext', [instrument.type], 'channel');
    await receiver.received('cleared', [
        expect.objectContaining({
            type: 'contextCleared',
            details: expect.objectContaining({ contextType: instrument.type }),
        }),
    ]);
});

test('broadcast without user-channel membership is a successful no-op', async ({ sender, receiver }) => {
    const [channel] = await receiver.call('getUserChannels');
    await receiver.call('joinUserChannel', [channel.id]);
    await sender.call('broadcast', [instrument]);
    await receiver.call('getCurrentChannel', [], 'agent', 'channel');
    await check('no context leaked into a user channel', await receiver.call('getCurrentContext', [], 'channel'), null);
});
