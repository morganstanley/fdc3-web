/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { check, expect, handler, instrument, metadata, ref, reply, test } from '../helpers/harness.js';

for (const kind of ['context', 'context with metadata', 'void', 'channel']) {
    test(`getResultMetadata for ${kind}`, async ({ sender, receiver }) => {
        const identity = await receiver.identity();
        if (kind === 'channel') await receiver.call('createPrivateChannel', [], 'agent', 'private');
        const result =
            kind === 'context'
                ? reply
                : kind === 'context with metadata'
                  ? { context: reply, metadata: { traceId: 'handler-trace', custom: { example: 'value' } } }
                  : kind === 'channel'
                    ? ref('private')
                    : undefined;
        await receiver.call('addIntentListener', ['MetadataIntent', handler('intent', result)]);
        await sender.call(
            'raiseIntent',
            ['MetadataIntent', instrument, identity, false, metadata],
            'agent',
            'resolution',
        );
        const resultMetadata = await sender.call('getResultMetadata', [], 'resolution');
        await check(
            'result metadata includes the source, timestamp and non-empty traceId',
            resultMetadata,
            expect.objectContaining({
                source: identity,
                timestamp: expect.any(String),
                traceId: expect.stringMatching(/.+/),
            }),
        );
        if (kind === 'context with metadata') {
            await check('getResult unwraps the context', await sender.call('getResult', [], 'resolution'), reply);
            await check('custom result metadata is preserved', resultMetadata.custom, { example: 'value' });
        }
        await check(
            'result metadata is stable on repeated reads',
            await sender.call('getResultMetadata', [], 'resolution'),
            resultMetadata,
        );
    });
}
