/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { check, expect, handler, instrument, metadata, reply, test } from '../helpers/harness.js';

// These execute the documented assertion. Playwright reports unexpected passes when a gap is fixed.
test('GAP-001: overlapping context listeners each receive a broadcast exactly once', async ({ sender, receiver }) => {
    await sender.call('getOrCreateChannel', ['overlap'], 'agent', 'channel');
    await receiver.call('getOrCreateChannel', ['overlap'], 'agent', 'channel');
    await receiver.call('addContextListener', [null, handler('first')], 'channel');
    await receiver.call('addContextListener', [null, handler('second')], 'channel');
    await sender.call('broadcast', [instrument], 'channel');
    await receiver.received('second', [instrument]);
    // An acknowledged read in the receiver follows the queued broadcast deliveries.
    await receiver.call('getCurrentContext', [], 'channel');
    test.fail(true, 'GAP-001: one broadcast is delivered once per matching remote subscription to all local handlers');
    await receiver.eventCount('first', 1);
});

for (const method of ['findIntent', 'findIntentsByContext']) {
    test(`GAP-002: ${method} excludes running apps with incompatible result types`, async ({
        sender,
        receiver: _receiver,
    }) => {
        const args =
            method === 'findIntent'
                ? ['HarnessIntent', instrument, 'incompatible.result']
                : [instrument, 'incompatible.result'];
        await sender.start(method, args);
        const outcome = await sender.outcome();
        test.fail(true, 'GAP-002: resultType filters directory apps but not running instances');
        await check(
            'no incompatible apps are returned',
            outcome,
            method === 'findIntent' ? { ok: false, error: 'NoAppsFound' } : { ok: true, value: [] },
        );
    });
}

test('GAP-004: agent traceId takes precedence over intent result metadata traceId', async ({ sender, receiver }) => {
    await receiver.call('addIntentListener', [
        'TraceIntent',
        handler('intent', { context: reply, metadata: { traceId: 'handler-trace' } }),
    ]);
    await sender.call(
        'raiseIntent',
        ['TraceIntent', instrument, await receiver.identity(), false, metadata],
        'agent',
        'resolution',
    );
    const result = await sender.call('getResultMetadata', [], 'resolution');
    await check('the result has metadata', result, expect.objectContaining({ traceId: expect.any(String) }));
    test.fail(true, 'GAP-004: result metadata uses the handler traceId instead of the agent traceId');
    await check('agent traceId wins', result.traceId === 'handler-trace', false);
});
