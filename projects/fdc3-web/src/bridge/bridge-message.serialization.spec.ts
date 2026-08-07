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
import { parseBridgeMessage, serializeBridgeMessage } from './bridge-message.serialization.js';

describe(`bridge-message.serialization`, () => {
    describe(`serializeBridgeMessage`, () => {
        it(`should render meta.timestamp as an ISO string`, () => {
            const message = { type: 'hello', payload: {}, meta: { timestamp: new Date(2024, 0, 1) } };

            const result = serializeBridgeMessage(message);

            expect(JSON.parse(result).meta.timestamp).toBe(new Date(2024, 0, 1).toISOString());
        });
    });

    describe(`parseBridgeMessage`, () => {
        it(`should revive meta.timestamp to a Date with the right epoch value`, () => {
            const date = new Date(2024, 0, 1);
            const wire = JSON.stringify({ type: 'hello', payload: {}, meta: { timestamp: date } });

            const result = parseBridgeMessage(wire) as { meta: { timestamp: Date } };

            expect(result.meta.timestamp).toBeInstanceOf(Date);
            expect(result.meta.timestamp.getTime()).toBe(date.getTime());
        });

        it(`should return undefined for a non-JSON string`, () => {
            expect(parseBridgeMessage('not-json')).toBeUndefined();
        });

        it(`should pass a non-object parsed value through unchanged`, () => {
            expect(parseBridgeMessage('3')).toBe(3);
            expect(parseBridgeMessage('null')).toBeNull();
        });

        it(`should pass an already-parsed object through unchanged`, () => {
            const alreadyParsed = { type: 'hello', payload: {} };

            expect(parseBridgeMessage(alreadyParsed)).toBe(alreadyParsed);
        });

        it(`should leave an object with no meta untouched`, () => {
            const message = { type: 'hello', payload: { foo: 'bar' } };

            expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
        });

        it(`should leave meta untouched when timestamp is not a string`, () => {
            const message = { type: 'hello', payload: {}, meta: { requestUuid: 'abc' } };

            expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
        });
    });
});
