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
import { ChannelsState } from './channels-state.js';

describe(`${ChannelsState.name}`, () => {
    describe(`applyBroadcast`, () => {
        it(`should record a context against its channel and type`, () => {
            const state = new ChannelsState();

            state.applyBroadcast('channel1', { type: 'fdc3.instrument', id: { ticker: 'AAPL' } });

            expect(state.toWireFormat()).toEqual({
                channel1: [{ type: 'fdc3.instrument', id: { ticker: 'AAPL' } }],
            });
        });

        it(`should keep only the most recent context per type, most recent first`, () => {
            const state = new ChannelsState();

            state.applyBroadcast('channel1', { type: 'fdc3.instrument', id: { ticker: 'AAPL' } });
            state.applyBroadcast('channel1', { type: 'fdc3.contact', name: 'Jane' });
            state.applyBroadcast('channel1', { type: 'fdc3.instrument', id: { ticker: 'MSFT' } });

            expect(state.toWireFormat().channel1).toEqual([
                { type: 'fdc3.instrument', id: { ticker: 'MSFT' } },
                { type: 'fdc3.contact', name: 'Jane' },
            ]);
        });

        it(`should ignore a non-string channelId`, () => {
            const state = new ChannelsState();

            state.applyBroadcast(null, { type: 'fdc3.instrument' });

            expect(state.toWireFormat()).toEqual({});
        });

        it(`should ignore a context with no type`, () => {
            const state = new ChannelsState();

            state.applyBroadcast('channel1', { id: {} });

            expect(state.toWireFormat()).toEqual({});
        });
    });

    describe(`mergeFromHandshake`, () => {
        it(`should adopt a type the bridge does not yet know, preserving the incoming array's order as oldest-first`, () => {
            const state = new ChannelsState();

            state.mergeFromHandshake({
                channel1: [
                    { type: 'fdc3.instrument', id: { ticker: 'AAPL' } },
                    { type: 'fdc3.contact', name: 'Jane' },
                ],
            });

            // both types were unknown, so both are adopted; the incoming array's own
            // most-recent-first order must be preserved in the merged output.
            expect(state.toWireFormat().channel1).toEqual([
                { type: 'fdc3.instrument', id: { ticker: 'AAPL' } },
                { type: 'fdc3.contact', name: 'Jane' },
            ]);
        });

        it(`should prefer existing federation state over a joiner's copy for a known (channelId, type)`, () => {
            const state = new ChannelsState();
            state.applyBroadcast('channel1', { type: 'fdc3.instrument', id: { ticker: 'FEDERATION' } });

            state.mergeFromHandshake({
                channel1: [{ type: 'fdc3.instrument', id: { ticker: 'STALE' } }],
            });

            expect(state.toWireFormat().channel1).toEqual([{ type: 'fdc3.instrument', id: { ticker: 'FEDERATION' } }]);
        });

        it(`should place newly-adopted joiner types behind existing federation state (they get the oldest seq)`, () => {
            const state = new ChannelsState();
            state.applyBroadcast('channel1', { type: 'fdc3.instrument', id: { ticker: 'FEDERATION' } });

            state.mergeFromHandshake({
                channel1: [{ type: 'fdc3.contact', name: 'Jane' }],
            });

            expect(state.toWireFormat().channel1).toEqual([
                { type: 'fdc3.instrument', id: { ticker: 'FEDERATION' } },
                { type: 'fdc3.contact', name: 'Jane' },
            ]);
        });

        it(`should be a no-op when incoming is undefined`, () => {
            const state = new ChannelsState();

            expect(() => state.mergeFromHandshake(undefined)).not.toThrow();
            expect(state.toWireFormat()).toEqual({});
        });

        it(`should skip a channel whose value is not an array`, () => {
            const state = new ChannelsState();

            state.mergeFromHandshake({ channel1: 'not-an-array' as any });

            expect(state.toWireFormat()).toEqual({});
        });

        it(`should skip an individual malformed context within an otherwise-valid array`, () => {
            const state = new ChannelsState();

            state.mergeFromHandshake({ channel1: [{ notAType: true } as any, { type: 'fdc3.contact', name: 'Jane' }] });

            expect(state.toWireFormat().channel1).toEqual([{ type: 'fdc3.contact', name: 'Jane' }]);
        });
    });

    describe(`toWireFormat`, () => {
        it(`should return an empty object when nothing has been recorded`, () => {
            expect(new ChannelsState().toWireFormat()).toEqual({});
        });
    });
});
