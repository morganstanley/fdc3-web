/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { check, contact, expect, handler, instrument, metadata, test } from '../helpers/harness.js';

for (const filter of [null, 'fdc3.instrument', ['fdc3.instrument', 'fdc3.contact']]) {
    for (const withMetadata of [false, true]) {
        test(`DesktopAgent broadcast ${withMetadata ? 'with' : 'without'} metadata; listener filter ${JSON.stringify(filter)}`, async ({
            sender,
            receiver,
        }) => {
            const channels = await sender.call('getUserChannels', [], 'agent', 'channels');
            await check(
                'user channels have stable IDs, user type and display metadata',
                channels,
                expect.arrayContaining([
                    expect.objectContaining({
                        id: expect.any(String),
                        type: 'user',
                        displayMetadata: expect.any(Object),
                    }),
                ]),
            );
            await sender.call('joinUserChannel', [channels[0].id]);
            await receiver.call('joinUserChannel', [channels[0].id]);
            await receiver.call('addContextListener', [filter, handler('broadcasts')], 'agent', 'listener');
            await sender.call('broadcast', withMetadata ? [instrument, metadata] : [instrument]);
            await receiver.received('broadcasts', [
                instrument,
                expect.objectContaining(withMetadata ? metadata : { source: expect.any(Object) }),
            ]);
            await receiver.call('unsubscribe', [], 'listener');
            // A second active listener provides an ordering barrier for the negative assertion.
            await receiver.call('addContextListener', [null, handler('barrier')]);
            await sender.call('broadcast', [contact]);
            await receiver.received('barrier', [contact, expect.any(Object)]);
            await receiver.eventCount('broadcasts', 1);
        });
    }
}

test('getCurrentChannel, joinUserChannel and leaveCurrentChannel reflect membership', async ({ sender }) => {
    await check('initial membership is null', await sender.call('getCurrentChannel'), null);
    const [channel] = await sender.call('getUserChannels');
    await sender.call('joinUserChannel', [channel.id]);
    await check(
        'the joined channel is current',
        await sender.call('getCurrentChannel'),
        expect.objectContaining({ id: channel.id, type: 'user' }),
    );
    await sender.call('joinUserChannel', [channel.id]);
    await sender.call('leaveCurrentChannel');
    await sender.call('leaveCurrentChannel');
    await check('leaving is idempotent and clears membership', await sender.call('getCurrentChannel'), null);
    await sender.rejects('joinUserChannel', ['missing-channel'], 'NoChannelFound');
});

for (const filter of [null, 'userChannelChanged']) {
    test(`DesktopAgent.addEventListener(${JSON.stringify(filter)}) and unsubscribe`, async ({ sender }) => {
        await sender.call('addEventListener', [filter, handler('membership')], 'agent', 'listener');
        const [channel] = await sender.call('getUserChannels');
        await sender.call('joinUserChannel', [channel.id]);
        await sender.received('membership', [expect.objectContaining({ type: 'userChannelChanged' })]);
        await sender.call('leaveCurrentChannel');
        await sender.eventCount('membership', 2);
        await sender.call('unsubscribe', [], 'listener');
        await sender.call('addEventListener', [null, handler('barrier')]);
        await sender.call('joinUserChannel', [channel.id]);
        await sender.received('barrier', [expect.objectContaining({ type: 'userChannelChanged' })]);
        await sender.eventCount('membership', 2);
    });
}

for (const kind of ['app', 'user', 'private'] as const) {
    for (const withMetadata of [false, true]) {
        test(`${kind} Channel.broadcast ${withMetadata ? 'with' : 'without'} metadata and context reads`, async ({
            sender,
        }) => {
            if (kind === 'app') await sender.call('getOrCreateChannel', ['e2e.channel'], 'agent', 'channel');
            if (kind === 'private') await sender.call('createPrivateChannel', [], 'agent', 'channel');
            if (kind === 'user') {
                const [channel] = await sender.call('getUserChannels');
                await sender.call('joinUserChannel', [channel.id]);
                await sender.call('getCurrentChannel', [], 'agent', 'channel');
            }
            await check('an empty channel has no context', await sender.call('getCurrentContext', [], 'channel'), null);
            await sender.call('broadcast', withMetadata ? [instrument, metadata] : [instrument], 'channel');
            await sender.call('broadcast', [contact], 'channel');
            for (const [args, expected] of [
                [[], contact],
                [['fdc3.instrument'], instrument],
                [['missing'], null],
            ] as const) {
                await check(
                    `getCurrentContext(${JSON.stringify(args)}) returns the correct context`,
                    await sender.call('getCurrentContext', [...args], 'channel'),
                    expected,
                );
                await check(
                    `getCurrentContextWithMetadata(${JSON.stringify(args)}) preserves provenance`,
                    await sender.call('getCurrentContextWithMetadata', [...args], 'channel'),
                    expected === null
                        ? null
                        : expect.objectContaining({
                              context: expected,
                              metadata: expect.objectContaining(
                                  withMetadata && expected === instrument ? metadata : { source: expect.any(Object) },
                              ),
                          }),
                );
            }
            await sender.call('clearContext', ['fdc3.instrument'], 'channel');
            await check(
                'clearing one type removes it',
                await sender.call('getCurrentContext', ['fdc3.instrument'], 'channel'),
                null,
            );
            await check(
                'clearing one type preserves other types',
                await sender.call('getCurrentContext', ['fdc3.contact'], 'channel'),
                contact,
            );
            await sender.call('clearContext', [], 'channel');
            await check(
                'clearing without arguments removes all context',
                await sender.call('getCurrentContext', [], 'channel'),
                null,
            );
            await check(
                'clearing also removes metadata',
                await sender.call('getCurrentContextWithMetadata', ['fdc3.contact'], 'channel'),
                null,
            );
        });
    }
}

for (const filter of [null, 'fdc3.instrument', ['fdc3.instrument', 'fdc3.contact']]) {
    test(`Channel.addContextListener(${JSON.stringify(filter)}) filters and unsubscribes across apps`, async ({
        sender,
        receiver,
    }) => {
        await sender.call('getOrCreateChannel', ['shared'], 'agent', 'channel');
        await receiver.call('getOrCreateChannel', ['shared'], 'agent', 'channel');
        await receiver.call('addContextListener', [filter, handler('contexts')], 'channel', 'listener');
        await sender.call('broadcast', [instrument], 'channel');
        await receiver.received('contexts', [instrument, expect.any(Object)]);
        await sender.call('broadcast', [contact], 'channel');
        await receiver.eventCount('contexts', typeof filter === 'string' ? 1 : 2);
        await receiver.call('unsubscribe', [], 'listener');
        await receiver.call('addContextListener', [null, handler('barrier')], 'channel');
        await sender.call('broadcast', [instrument], 'channel');
        await receiver.received('barrier', [instrument, expect.any(Object)]);
        await receiver.eventCount('contexts', typeof filter === 'string' ? 1 : 2);
    });
}

for (const filter of [null, 'contextCleared']) {
    test(`Channel.addEventListener(${JSON.stringify(filter)}) observes clearContext and unsubscribes`, async ({
        sender,
        receiver,
    }) => {
        await sender.call('getOrCreateChannel', ['shared'], 'agent', 'channel');
        await receiver.call('getOrCreateChannel', ['shared'], 'agent', 'channel');
        await receiver.call('addEventListener', [filter, handler('cleared')], 'channel', 'listener');
        await sender.call('broadcast', [instrument], 'channel');
        await sender.call('clearContext', ['fdc3.instrument'], 'channel');
        await receiver.received('cleared', [expect.objectContaining({ type: 'contextCleared' })]);
        await receiver.call('unsubscribe', [], 'listener');
        await receiver.call('addEventListener', [null, handler('barrier')], 'channel');
        await sender.call('broadcast', [contact], 'channel');
        await sender.call('clearContext', [], 'channel');
        await receiver.received('barrier', [expect.objectContaining({ type: 'contextCleared' })]);
        await receiver.eventCount('cleared', 1);
    });
}

test('getOrCreateChannel returns the same shared app channel on repeated calls', async ({ sender, receiver }) => {
    const first = await sender.call('getOrCreateChannel', ['stable']);
    const second = await receiver.call('getOrCreateChannel', ['stable']);
    await check('channel identity is shared', second, first);
    await check('app channel type is app', first.type, 'app');
});
