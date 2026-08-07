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
import { parseBridgeMessage, serializeBridgeMessage } from './message.serialization.js';

describe(`serializeBridgeMessage`, () => {
    it(`should JSON.stringify the message, converting a Date to an ISO string`, () => {
        const timestamp = new Date('2024-01-01T00:00:00.000Z');

        const wire = serializeBridgeMessage({ type: 'hello', meta: { timestamp } });

        expect(wire).toBe('{"type":"hello","meta":{"timestamp":"2024-01-01T00:00:00.000Z"}}');
    });

    it(`should drop undefined-valued keys`, () => {
        const wire = serializeBridgeMessage({ type: 'openRequest', destination: undefined });

        expect(wire).toBe('{"type":"openRequest"}');
    });
});

describe(`parseBridgeMessage`, () => {
    it(`should parse JSON and revive meta.timestamp from a string into a Date`, () => {
        const wire = '{"type":"hello","meta":{"timestamp":"2024-01-01T00:00:00.000Z"}}';

        const parsed = parseBridgeMessage(wire) as { meta: { timestamp: Date } };

        expect(parsed.meta.timestamp).toBeInstanceOf(Date);
        expect(parsed.meta.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it(`should return undefined for unparseable JSON`, () => {
        expect(parseBridgeMessage('not json')).toBeUndefined();
    });

    it(`should pass non-string input through unchanged`, () => {
        const obj = { type: 'hello' };

        expect(parseBridgeMessage(obj)).toBe(obj);
    });

    it(`should not throw when meta is missing`, () => {
        const parsed = parseBridgeMessage('{"type":"hello"}');

        expect(parsed).toEqual({ type: 'hello' });
    });

    it(`should not throw when meta.timestamp is missing`, () => {
        const parsed = parseBridgeMessage('{"type":"hello","meta":{}}');

        expect(parsed).toEqual({ type: 'hello', meta: {} });
    });

    it(`should leave a non-string meta.timestamp untouched`, () => {
        const parsed = parseBridgeMessage('{"type":"hello","meta":{"timestamp":123}}') as {
            meta: { timestamp: unknown };
        };

        expect(parsed.meta.timestamp).toBe(123);
    });

    it(`should leave a null parsed value untouched (no meta to revive)`, () => {
        expect(parseBridgeMessage('null')).toBeNull();
    });
});
