/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import {
    appId,
    check,
    contact,
    expect,
    handler,
    instrument,
    metadata,
    omitted,
    ref,
    reply,
    test,
} from '../helpers/harness.js';

for (const args of [[], [instrument], [instrument, 'e2e.reply'], [omitted, 'e2e.reply']]) {
    test(`findIntent with arguments ${JSON.stringify(args)}`, async ({ sender, receiver: _receiver }) => {
        const result = await sender.call('findIntent', ['HarnessIntent', ...args]);
        await check(
            'discovery returns the declared intent and receiver',
            result,
            expect.objectContaining({
                intent: expect.objectContaining({ name: 'HarnessIntent' }),
                apps: expect.arrayContaining([expect.objectContaining(appId('app-2-root'))]),
            }),
        );
    });
}
for (const args of [[instrument], [instrument, 'e2e.reply']]) {
    test(`findIntentsByContext with arguments ${JSON.stringify(args)}`, async ({ sender, receiver: _receiver }) => {
        const result = await sender.call('findIntentsByContext', args);
        await check(
            'matching intent is discoverable',
            result,
            expect.arrayContaining([
                expect.objectContaining({ intent: expect.objectContaining({ name: 'HarnessIntent' }) }),
            ]),
        );
    });
}

test('findIntent rejects an unknown intent and filters an unopened app by result type', async ({ sender }) => {
    await sender.rejects('findIntent', ['DoesNotExist'], 'NoAppsFound');
    await sender.rejects('findIntent', ['CrossOriginIntent', instrument, 'unknown-result'], 'NoAppsFound');
});

for (const filter of [undefined, 'fdc3.instrument', ['fdc3.instrument', 'fdc3.contact']]) {
    test(`register, invoke and unsubscribe an intent listener (${JSON.stringify(filter) ?? 'unfiltered'})`, async ({
        sender,
        receiver,
    }) => {
        const method = filter === undefined ? 'addIntentListener' : 'addIntentListenerWithContext';
        const args =
            filter === undefined
                ? ['DynamicIntent', handler('intent', reply)]
                : ['DynamicIntent', filter, handler('intent', reply)];
        await receiver.call(method, args, 'agent', 'listener');
        const target = await receiver.identity();
        const resolution = await sender.call(
            'raiseIntent',
            ['DynamicIntent', instrument, target],
            'agent',
            'resolution',
        );
        await check(
            'intent resolution identifies the exact receiver',
            resolution,
            expect.objectContaining({ intent: 'DynamicIntent', source: target }),
        );
        await receiver.received('intent', [instrument]);
        await check('getResult delivers handler context', await sender.call('getResult', [], 'resolution'), reply);
        await receiver.rejects('addIntentListener', ['DynamicIntent', handler('conflict')], 'IntentListenerConflict');
        await receiver.call('unsubscribe', [], 'listener');
        // Successful re-registration proves the previous listener was removed.
        await receiver.call(method, args, 'agent', 'replacement');
        await sender.call('raiseIntent', ['DynamicIntent', instrument, target], 'agent', 'again');
        await receiver.eventCount('intent', 2);
    });
}

const variations = [
    { name: 'optional arguments omitted', args: [] },
    { name: 'null context', args: [null] },
    { name: 'undefined context', args: [omitted] },
    { name: 'explicit nothing context', args: [{ type: 'fdc3.nothing' }] },
    { name: 'context only', args: [instrument] },
    { name: 'app target', args: [instrument, appId('app-2-root')] },
    { name: 'null app and null newInstance', args: [instrument, null, null] },
    { name: 'existing instance required', args: [instrument, appId('app-2-root'), false] },
    { name: 'metadata without app preference', args: [instrument, null, omitted, metadata] },
];
for (const variation of variations) {
    test(`raiseIntent: ${variation.name}`, async ({ sender, receiver }) => {
        // Use a unique runtime listener so omitted targets resolve unambiguously.
        await receiver.call('addIntentListener', ['RuntimeIntent', handler('intent', reply)]);
        await sender.call('raiseIntent', ['RuntimeIntent', ...variation.args], 'agent', 'resolution');
        const context =
            variation.args.length === 0 || variation.args[0] === null || variation.args[0] === omitted
                ? { type: 'fdc3.nothing' }
                : variation.args[0];
        await receiver.received('intent', [context]);
        if (variation.name.startsWith('metadata'))
            await receiver.received('intent', [expect.objectContaining(metadata)]);
        await check('getResult returns the listener result', await sender.call('getResult', [], 'resolution'), reply);
    });
}

for (const mode of ['omitted', 'app', 'instance', 'existing', 'nulls', 'metadata'] as const) {
    test(`raiseIntentForContext: ${mode}`, async ({ sender, receiver }) => {
        const context = { type: 'e2e.specific' };
        await receiver.call('addIntentListenerWithContext', ['ContextIntent', context.type, handler('intent', reply)]);
        const target = await receiver.identity();
        const optional =
            mode === 'omitted'
                ? []
                : mode === 'app'
                  ? [appId('app-2-root')]
                  : mode === 'instance'
                    ? [target]
                    : mode === 'existing'
                      ? [target, false]
                      : mode === 'nulls'
                        ? [null, null]
                        : [null, omitted, metadata];
        await sender.start('raiseIntentForContext', [context, ...optional], 'agent', 'resolution');
        await sender.selectResolver(target, 'ContextIntent');
        await sender.success();
        await receiver.received('intent', [context]);
        if (mode === 'metadata') await receiver.received('intent', [expect.objectContaining(metadata)]);
        await check(
            'result is returned for the resolved context intent',
            await sender.call('getResult', [], 'resolution'),
            reply,
        );
    });
}

for (const resultType of ['void', 'context', 'app channel', 'private channel', 'rejected'] as const) {
    test(`IntentResolution.getResult returns ${resultType}`, async ({ sender, receiver }) => {
        let result: unknown;
        if (resultType === 'context') result = reply;
        if (resultType === 'app channel') {
            await receiver.call('getOrCreateChannel', ['intent-result'], 'agent', 'channel');
            result = ref('channel');
        }
        if (resultType === 'private channel') {
            await receiver.call('createPrivateChannel', [], 'agent', 'channel');
            result = ref('channel');
        }
        await receiver.call('addIntentListener', [
            'ResultIntent',
            resultType === 'rejected'
                ? { $handler: 'intent', rejects: 'deliberate failure' }
                : handler('intent', result),
        ]);
        await sender.call(
            'raiseIntent',
            ['ResultIntent', instrument, await receiver.identity()],
            'agent',
            'resolution',
        );
        if (resultType === 'rejected') {
            test.fail(true, 'GAP-003: a rejected intent handler leaves getResult pending; see README.md');
            await sender.rejects('getResult', [], 'IntentHandlerRejected', 'resolution');
        } else
            await check(
                'the promised result has the expected shape',
                await sender.call('getResult', [], 'resolution'),
                resultType.includes('channel')
                    ? expect.objectContaining({
                          id: expect.any(String),
                          type: resultType === 'app channel' ? 'app' : 'private',
                      })
                    : resultType === 'void'
                      ? omitted
                      : reply,
            );
    });
}

test('context-specific intent listeners can coexist for disjoint types', async ({ sender, receiver }) => {
    await receiver.call('addIntentListenerWithContext', [
        'FilteredIntent',
        instrument.type,
        handler('instrument', reply),
    ]);
    await receiver.call('addIntentListenerWithContext', ['FilteredIntent', contact.type, handler('contact', contact)]);
    const target = await receiver.identity();
    await sender.call('raiseIntent', ['FilteredIntent', contact, target], 'agent', 'resolution');
    await receiver.received('contact', [contact]);
    await receiver.eventCount('instrument', 0);
    await check(
        'only the matching handler supplies the result',
        await sender.call('getResult', [], 'resolution'),
        contact,
    );
});
