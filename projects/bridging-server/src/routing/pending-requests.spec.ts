/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes } from '@finos/fdc3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../agent-registry.js';
import { createAgentSession } from '../agent-session.js';
import { Logger } from '../logger.js';
import { FakeAgentConnection } from '../server-transport.fake.js';
import { PendingRequests } from './pending-requests.js';
import { REQUEST_ROUTES } from './request-routes.js';

const metadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };
const request = {
    type: 'findIntentRequest',
    payload: { intent: 'ViewChart' },
    meta: { requestUuid: 'req-1', timestamp: new Date() },
} as unknown as BridgingTypes.AgentRequestMessage;

function registerAgent(registry: AgentRegistry, name: string): FakeAgentConnection {
    const connection = new FakeAgentConnection(name);
    const session = createAgentSession(connection);
    registry.add(session);
    registry.register(session, name, metadata);
    return connection;
}

describe(`${PendingRequests.name}`, () => {
    let registry: AgentRegistry;
    let logger: Logger;
    let pendingRequests: PendingRequests;
    let originatorConnection: FakeAgentConnection;

    beforeEach(() => {
        registry = new AgentRegistry();
        logger = new Logger('error');
        pendingRequests = new PendingRequests(registry, logger);
        originatorConnection = registerAgent(registry, 'AgentA');
    });

    it(`should settle immediately with the route's own empty collation when there are zero recipients`, () => {
        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: [],
        });

        expect(originatorConnection.sent).toEqual([
            {
                type: 'findIntentResponse',
                payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } },
                meta: { requestUuid: 'req-1', responseUuid: expect.any(String), timestamp: expect.any(Date) },
            },
        ]);
    });

    it(`should collate a single successful response with sources set and no error keys`, () => {
        registerAgent(registry, 'AgentB');

        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: ['AgentB'],
        });

        pendingRequests.recordResponse('req-1', 'AgentB', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'app1' }] } },
        });

        const response = originatorConnection.sent[0] as any;
        expect(response.type).toBe('findIntentResponse');
        expect(response.payload.appIntent.apps).toEqual([{ appId: 'app1', desktopAgent: 'AgentB' }]);
        expect(response.meta.sources).toEqual([{ desktopAgent: 'AgentB' }]);
        expect(response.meta.errorSources).toBeUndefined();
        expect(response.meta.errorDetails).toBeUndefined();
    });

    it(`should collate a mix of success and error across multiple recipients`, () => {
        registerAgent(registry, 'AgentB');
        registerAgent(registry, 'AgentC');

        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: ['AgentB', 'AgentC'],
        });

        pendingRequests.recordResponse('req-1', 'AgentB', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'app1' }] } },
        });
        pendingRequests.recordResponse('req-1', 'AgentC', { err: 'NoAppsFound' });

        const response = originatorConnection.sent[0] as any;
        expect(response.payload.appIntent.apps).toEqual([{ appId: 'app1', desktopAgent: 'AgentB' }]);
        expect(response.meta.sources).toEqual([{ desktopAgent: 'AgentB' }]);
        expect(response.meta.errorSources).toEqual([{ desktopAgent: 'AgentC' }]);
        expect(response.meta.errorDetails).toEqual(['NoAppsFound']);
    });

    it(`should preserve recipient-enumeration order in the collated arrays regardless of response arrival order`, () => {
        registerAgent(registry, 'AgentB');
        registerAgent(registry, 'AgentC');

        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: ['AgentB', 'AgentC'],
        });

        // AgentC answers first, AgentB second - output must still list B before C.
        pendingRequests.recordResponse('req-1', 'AgentC', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'appC' }] } },
        });
        pendingRequests.recordResponse('req-1', 'AgentB', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'appB' }] } },
        });

        const response = originatorConnection.sent[0] as any;
        expect(response.payload.appIntent.apps).toEqual([
            { appId: 'appB', desktopAgent: 'AgentB' },
            { appId: 'appC', desktopAgent: 'AgentC' },
        ]);
    });

    describe(`all-error aggregation`, () => {
        it(`should emit a BridgeErrorResponse when every recipient errors`, () => {
            registerAgent(registry, 'AgentB');

            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });
            pendingRequests.recordResponse('req-1', 'AgentB', { err: 'NoAppsFound' });

            const response = originatorConnection.sent[0] as any;
            expect(response.payload).toEqual({ error: 'NoAppsFound' });
            expect(response.meta.errorSources).toEqual([{ desktopAgent: 'AgentB' }]);
            expect(response.meta.errorDetails).toEqual(['NoAppsFound']);
        });

        it(`should use the identical error when all recipients agree`, () => {
            registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB', 'AgentC'],
            });

            pendingRequests.recordResponse('req-1', 'AgentB', { err: 'NoAppsFound' });
            pendingRequests.recordResponse('req-1', 'AgentC', { err: 'NoAppsFound' });

            expect((originatorConnection.sent[0] as any).payload.error).toBe('NoAppsFound');
        });

        it(`should prefer the first non-timeout error when mixed`, () => {
            registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB', 'AgentC'],
            });

            pendingRequests.recordResponse('req-1', 'AgentB', { err: 'ResponseToBridgeTimedOut' });
            pendingRequests.recordResponse('req-1', 'AgentC', { err: 'NoAppsFound' });

            expect((originatorConnection.sent[0] as any).payload.error).toBe('NoAppsFound');
        });

        it(`should fall back to ResponseToBridgeTimedOut when all errors are timeouts`, () => {
            registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB', 'AgentC'],
            });

            pendingRequests.recordResponse('req-1', 'AgentB', { err: 'ResponseToBridgeTimedOut' });
            pendingRequests.recordResponse('req-1', 'AgentC', { err: 'ResponseToBridgeTimedOut' });

            expect((originatorConnection.sent[0] as any).payload.error).toBe('ResponseToBridgeTimedOut');
        });
    });

    describe(`timeout`, () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it(`should settle with ResponseToBridgeTimedOut for any recipient that never responds`, () => {
            registerAgent(registry, 'AgentB');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: { ...REQUEST_ROUTES.findIntentRequest, timeoutMs: 1000 },
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });

            vi.advanceTimersByTime(1000);

            expect((originatorConnection.sent[0] as any).payload.error).toBe('ResponseToBridgeTimedOut');
            expect((originatorConnection.sent[0] as any).meta.errorDetails).toEqual(['ResponseToBridgeTimedOut']);
        });

        it(`should not fire the timeout for a request that already settled`, () => {
            registerAgent(registry, 'AgentB');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: { ...REQUEST_ROUTES.findIntentRequest, timeoutMs: 1000 },
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });

            pendingRequests.recordResponse('req-1', 'AgentB', {
                ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } },
            });

            expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
            expect(originatorConnection.sent.length).toBe(1);
        });
    });

    it(`should ignore a duplicate response - the first one wins`, () => {
        registerAgent(registry, 'AgentB');
        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: ['AgentB'],
        });

        pendingRequests.recordResponse('req-1', 'AgentB', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'first' }] } },
        });
        pendingRequests.recordResponse('req-1', 'AgentB', {
            ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'second' }] } },
        });

        expect(originatorConnection.sent.length).toBe(1);
        expect((originatorConnection.sent[0] as any).payload.appIntent.apps).toEqual([
            { appId: 'first', desktopAgent: 'AgentB' },
        ]);
    });

    it(`should ignore a response for an unknown or already-settled requestUuid without throwing`, () => {
        expect(() => pendingRequests.recordResponse('unknown-uuid', 'AgentB', { ok: {} })).not.toThrow();
    });

    describe(`handleAgentDisconnected`, () => {
        it(`should resolve a still-outstanding responder as AgentDisconnected immediately, not waiting for its timer`, () => {
            registerAgent(registry, 'AgentB');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });

            pendingRequests.handleAgentDisconnected('AgentB');

            const response = originatorConnection.sent[0] as any;
            expect(response.payload.error).toBe('AgentDisconnected');
            expect(response.meta.errorDetails).toEqual(['AgentDisconnected']);
        });

        it(`should discard the whole collation silently when the originator disconnects`, () => {
            registerAgent(registry, 'AgentB');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });

            pendingRequests.handleAgentDisconnected('AgentA');
            pendingRequests.recordResponse('req-1', 'AgentB', {
                ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } },
            });

            // the originator's own connection never receives anything - it's gone, and the late
            // response from AgentB lands on the unknown-requestUuid no-op path.
            expect(originatorConnection.sent.length).toBe(0);
        });

        it(`should not affect an unrelated pending request`, () => {
            registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            pendingRequests.open({
                requestUuid: 'req-1',
                route: REQUEST_ROUTES.findIntentRequest,
                request,
                originator: 'AgentA',
                recipients: ['AgentB'],
            });

            pendingRequests.handleAgentDisconnected('AgentC');

            expect(originatorConnection.sent.length).toBe(0);
        });
    });

    it(`should send nothing if the originator vanished from the registry without going through handleAgentDisconnected`, () => {
        const connectionB = registerAgent(registry, 'AgentB');
        pendingRequests.open({
            requestUuid: 'req-1',
            route: REQUEST_ROUTES.findIntentRequest,
            request,
            originator: 'AgentA',
            recipients: ['AgentB'],
        });

        registry.remove(registry.getByName('AgentA')!);

        expect(() =>
            pendingRequests.recordResponse('req-1', 'AgentB', {
                ok: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } },
            }),
        ).not.toThrow();
        expect(originatorConnection.sent.length).toBe(0);
        expect(connectionB.sent.length).toBe(0);
    });
});
