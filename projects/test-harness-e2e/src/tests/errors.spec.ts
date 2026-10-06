/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { appId, handler, instrument, test } from '../helpers/harness.js';

for (const method of ['broadcast', 'raiseIntent', 'raiseIntentForContext']) {
    test(`${method} rejects malformed context`, async ({ sender, receiver }) => {
        await receiver.call('addIntentListener', ['ErrorIntent', handler('intent')]);
        if (method === 'broadcast') {
            const [channel] = await sender.call('getUserChannels');
            await sender.call('joinUserChannel', [channel.id]);
        }
        const args =
            method === 'raiseIntent'
                ? ['ErrorIntent', { name: 'missing type' }, await receiver.identity()]
                : [{ name: 'missing type' }];
        await sender.rejects(method, args, 'MalformedContext');
    });
}

test('Channel.broadcast rejects malformed context', async ({ sender }) => {
    await sender.call('getOrCreateChannel', ['invalid-context'], 'agent', 'channel');
    await sender.rejects('broadcast', [{}], 'MalformedContext', 'channel');
});

for (const method of ['raiseIntent', 'raiseIntentForContext']) {
    for (const target of [appId('missing'), { ...appId('app-2-root'), instanceId: 'missing-instance' }]) {
        test(`${method} rejects unavailable ${'instanceId' in target ? 'instance' : 'app'}`, async ({ sender }) => {
            await sender.rejects(
                method,
                method === 'raiseIntent' ? ['HarnessIntent', instrument, target] : [instrument, target],
                'instanceId' in target ? 'TargetInstanceUnavailable' : 'TargetAppUnavailable',
            );
        });
    }
}
