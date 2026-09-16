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
import {
    convertToEventListenerIndex,
    convertToFDC3EventTypes,
    convertToPrivateChannelEventMessageTypes,
    convertToPrivateChannelEventTypes,
} from './event-type.helper.js';

describe(`event-type.helper`, () => {
    describe(`${convertToFDC3EventTypes.name} (event-type.helper)`, () => {
        it(`should return 'userChannelChanged' if type === 'channelChangedEvent`, () => {
            const result = convertToFDC3EventTypes('channelChangedEvent');
            expect(result).toEqual('userChannelChanged');
        });

        it('should convert context-cleared events', () => {
            expect(convertToFDC3EventTypes('contextClearedEvent')).toBe('contextCleared');
        });

        it('should return null for non-API events', () => {
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

// Both API aliases must route to the same wire event and canonical listener key.
describe('private channel event conversions', () => {
    it.each([
        ['addContextListener', 'privateChannelOnAddContextListenerEvent'],
        ['disconnect', 'privateChannelOnDisconnectEvent'],
        ['unsubscribe', 'privateChannelOnUnsubscribeEvent'],
    ] as const)('normalizes %s and %s', (apiType, messageType) => {
        expect(convertToPrivateChannelEventMessageTypes(apiType)).toBe(messageType);
        expect(convertToPrivateChannelEventMessageTypes(messageType)).toBe(messageType);
        expect(convertToPrivateChannelEventTypes(apiType)).toBe(apiType);
        expect(convertToPrivateChannelEventTypes(messageType)).toBe(apiType);
    });

    it('converts context-cleared events in both directions', () => {
        expect(convertToPrivateChannelEventMessageTypes('contextCleared')).toBe('contextClearedEvent');
        expect(convertToPrivateChannelEventTypes('contextClearedEvent')).toBe('contextCleared');
        expect(convertToPrivateChannelEventTypes('contextCleared')).toBe('contextCleared');
    });
});
