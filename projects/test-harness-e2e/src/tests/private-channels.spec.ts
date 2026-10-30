/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { check, expect, handler, instrument, metadata, ref, test } from '../helpers/harness.js';

for (const eventType of [null, 'addContextListener', 'unsubscribe', 'disconnect', 'contextCleared']) {
    test(`PrivateChannel.addEventListener(${JSON.stringify(eventType)}) observes lifecycle events`, async ({
        sender,
        receiver,
    }) => {
        const channel = await receiver.call('createPrivateChannel', [], 'agent', 'private');
        await check(
            'private channels have a unique id and private type',
            channel,
            expect.objectContaining({ id: expect.any(String), type: 'private' }),
        );
        await receiver.call('addEventListener', [eventType, handler('lifecycle')], 'private', 'eventListener');
        await receiver.call('addIntentListener', ['PrivateStream', handler('intent', ref('private'))]);
        await sender.call(
            'raiseIntent',
            ['PrivateStream', instrument, await receiver.identity()],
            'agent',
            'resolution',
        );
        await check(
            'the intent shares the same private channel',
            await sender.call('getResult', [], 'resolution', 'private'),
            expect.objectContaining({ id: channel.id, type: 'private' }),
        );
        await sender.call('addContextListener', [instrument.type, handler('stream')], 'private', 'contextListener');
        if (eventType === null || eventType === 'addContextListener')
            await receiver.received('lifecycle', [expect.objectContaining({ type: 'addContextListener' })]);
        await receiver.call('broadcast', [instrument, metadata], 'private');
        await sender.received('stream', [instrument, expect.objectContaining(metadata)]);
        await sender.call('clearContext', [instrument.type], 'private');
        if (eventType === null || eventType === 'contextCleared')
            await receiver.received('lifecycle', [expect.objectContaining({ type: 'contextCleared' })]);
        await sender.call('unsubscribe', [], 'contextListener');
        if (eventType === null || eventType === 'unsubscribe')
            await receiver.received('lifecycle', [expect.objectContaining({ type: 'unsubscribe' })]);
        await sender.call('disconnect', [], 'private');
        if (eventType === null || eventType === 'disconnect')
            await receiver.received('lifecycle', [expect.objectContaining({ type: 'disconnect' })]);
        await receiver.call('unsubscribe', [], 'eventListener');
    });
}

test('createPrivateChannel allocates distinct channels and does not expose them as app channels', async ({
    sender,
    receiver,
}) => {
    const first = await sender.call('createPrivateChannel', [], 'agent', 'first');
    const second = await sender.call('createPrivateChannel', [], 'agent', 'second');
    await check('each private channel has a distinct identity', first.id === second.id, false);
    await receiver.rejects('getOrCreateChannel', [first.id], 'AccessDenied');
});
