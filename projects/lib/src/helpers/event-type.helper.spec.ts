/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it } from 'vitest';
import { convertToEventListenerIndex, convertToFDC3EventTypes } from './event-type.helper.js';

describe(`event-type.helper`, () => {
    describe(`${convertToFDC3EventTypes.name} (event-type.helper)`, () => {
        it(`should return 'userChannelChanged' if type === 'channelChangedEvent`, () => {
            const result = convertToFDC3EventTypes('channelChangedEvent');
            expect(result).toEqual('userChannelChanged');
        });

        it(`should return null if type != 'channelChangedEvent'`, () => {
            const result = convertToFDC3EventTypes('broadcastEvent');
            expect(result).toBeNull();
        });
    });

    describe(`${convertToEventListenerIndex.name} (event-type.helper)`, () => {
        it(`should return 'userChannelChanged' if type === 'USER_CHANNEL_CHANGED'`, () => {
            const result = convertToEventListenerIndex('USER_CHANNEL_CHANGED');
            expect(result).toEqual('userChannelChanged');
        });

        it(`should return 'allEvents' if type === null`, () => {
            const result = convertToEventListenerIndex(null);
            expect(result).toEqual('allEvents');
        });
    });
});
