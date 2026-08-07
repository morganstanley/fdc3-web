/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isFindIntentBridgeResponse as isFindIntentResponse,
    isRaiseIntentBridgeResponse,
    isRaiseIntentResultBridgeResponse,
} from '../helpers/index.js';
import { BridgeMessageCorrelator } from './bridge-message-correlator.js';
import { FakeBridgeTransport } from './bridge-transport.fake.js';

describe(`BridgeMessageCorrelator`, () => {
    let transport: FakeBridgeTransport;
    let correlator: BridgeMessageCorrelator;

    beforeEach(() => {
        vi.useFakeTimers();
        transport = new FakeBridgeTransport();
        correlator = new BridgeMessageCorrelator({ transport, responseTimeoutMs: 1000 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it(`should resolve on a matching success response`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse);

        transport.receive({
            type: 'findIntentResponse',
            payload: { appIntent: { apps: [] } },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r1', timestamp: new Date() },
        });

        await expect(promise).resolves.toEqual(
            expect.objectContaining({ meta: expect.objectContaining({ requestUuid: 'uuid-1' }) }),
        );
    });

    it(`should ignore a response with a different requestUuid`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 100);

        transport.receive({
            type: 'findIntentResponse',
            payload: {},
            meta: { requestUuid: 'other-uuid', responseUuid: 'r1', timestamp: new Date() },
        });

        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toBe('ApiTimeout');
    });

    it(`should ignore a response with the right uuid but the wrong type`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 100);

        transport.receive({
            type: 'openResponse',
            payload: {},
            meta: { requestUuid: 'uuid-1', responseUuid: 'r1', timestamp: new Date() },
        });

        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toBe('ApiTimeout');
    });

    it(`should resolve (not reject) a success response carrying partial errorSources`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse);

        transport.receive({
            type: 'findIntentResponse',
            payload: { appIntent: { apps: [] } },
            meta: {
                requestUuid: 'uuid-1',
                responseUuid: 'r1',
                timestamp: new Date(),
                errorSources: [{ desktopAgent: 'agent-b' }],
                errorDetails: ['ApiTimeout'],
            },
        });

        const result = await promise;
        expect((result as any).meta.errorSources).toEqual([{ desktopAgent: 'agent-b' }]);
    });

    it(`should reject with payload.error on a BridgeErrorResponse`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse);

        transport.receive({
            type: 'findIntentResponse',
            payload: { error: 'NoAppsFound' },
            meta: {
                requestUuid: 'uuid-1',
                responseUuid: 'r1',
                timestamp: new Date(),
                errorSources: [{ desktopAgent: 'agent-b' }],
                errorDetails: ['NoAppsFound'],
            },
        });

        await expect(promise).rejects.toBe('NoAppsFound');
    });

    it(`should reject with 'ApiTimeout' after the configured timeout`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 500);

        vi.advanceTimersByTime(500);

        await expect(promise).rejects.toBe('ApiTimeout');
    });

    it(`should be a no-op if the same message is injected again after resolving`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse);

        const message = {
            type: 'findIntentResponse',
            payload: { appIntent: { apps: [] } },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r1', timestamp: new Date() },
        };

        transport.receive(message);
        await promise;

        expect(() => transport.receive(message)).not.toThrow();
    });

    it(`should support two entries under one uuid: raiseIntent immediate response and a later raiseIntentResult`, async () => {
        const resolutionPromise = correlator.awaitResponse('uuid-1', isRaiseIntentBridgeResponse);
        const late = correlator.awaitLateResponse('uuid-1', isRaiseIntentResultBridgeResponse, 5000);

        transport.receive({
            type: 'raiseIntentResponse',
            payload: { intentResolution: { intent: 'ViewChart', source: { appId: 'a', instanceId: 'i' } } },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r1', timestamp: new Date() },
        });

        await resolutionPromise;

        let lateSettled = false;
        void late.promise.then(() => (lateSettled = true));
        await Promise.resolve();
        expect(lateSettled).toBe(false);

        transport.receive({
            type: 'raiseIntentResultResponse',
            payload: { intentResult: { context: { type: 'fdc3.contact' } } },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r2', timestamp: new Date() },
        });

        await expect(late.promise).resolves.toEqual(
            expect.objectContaining({ payload: { intentResult: { context: { type: 'fdc3.contact' } } } }),
        );
    });

    it(`awaitLateResponse().cancel() should stop a later matching message and clear its timer`, async () => {
        const late = correlator.awaitLateResponse('uuid-1', isRaiseIntentResultBridgeResponse, 5000);
        const timersBefore = vi.getTimerCount();

        late.cancel();

        expect(vi.getTimerCount()).toBe(timersBefore - 1);

        const rejectionHandler = vi.fn();
        late.promise.catch(rejectionHandler);

        transport.receive({
            type: 'raiseIntentResultResponse',
            payload: { intentResult: {} },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r2', timestamp: new Date() },
        });

        await Promise.resolve();
        expect(rejectionHandler).not.toHaveBeenCalled();
    });

    it(`should reject the late promise with the error when raiseIntentResultResponse arrives as a BridgeErrorResponse`, async () => {
        const late = correlator.awaitLateResponse('uuid-1', isRaiseIntentResultBridgeResponse, 5000);

        transport.receive({
            type: 'raiseIntentResultResponse',
            payload: { error: 'IntentHandlerRejected' },
            meta: {
                requestUuid: 'uuid-1',
                responseUuid: 'r2',
                timestamp: new Date(),
                errorSources: [],
                errorDetails: [],
            },
        });

        await expect(late.promise).rejects.toBe('IntentHandlerRejected');
    });

    it(`should reject all pending entries with 'AgentDisconnected' when the transport disconnects`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 5000);

        transport.setState('disconnected');

        await expect(promise).rejects.toBe('AgentDisconnected');
    });

    it(`should ignore non-response inbound messages`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 100);

        transport.receive({
            type: 'hello',
            payload: { desktopAgentBridgeVersion: '1.0' },
            meta: { timestamp: new Date() },
        });

        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toBe('ApiTimeout');
    });

    it(`close() should reject all pending and stop delivery`, async () => {
        const promise = correlator.awaitResponse('uuid-1', isFindIntentResponse);

        correlator.close();

        await expect(promise).rejects.toBe('AgentDisconnected');

        // further messages after close() must not resolve anything (subscription torn down)
        const secondPromise = correlator.awaitResponse('uuid-1', isFindIntentResponse, 50);
        transport.receive({
            type: 'findIntentResponse',
            payload: { appIntent: { apps: [] } },
            meta: { requestUuid: 'uuid-1', responseUuid: 'r1', timestamp: new Date() },
        });
        vi.advanceTimersByTime(50);
        await expect(secondPromise).rejects.toBe('ApiTimeout');
    });
});
