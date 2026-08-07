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
import {
    createAuthenticationFailedMessage,
    createBridgeErrorResponseMessage,
    createBridgeRequestMessage,
    createBridgeResponseMessage,
    createConnectedAgentsUpdateMessage,
    createHelloMessage,
} from './message.factory.js';

describe(`message.factory`, () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe(`createHelloMessage`, () => {
        it(`should set authRequired and omit authToken when not supplied`, () => {
            const message = createHelloMessage({ authRequired: false });

            expect(message).toEqual({
                type: 'hello',
                payload: {
                    desktopAgentBridgeVersion: expect.any(String),
                    supportedFDC3Versions: expect.any(Array),
                    authRequired: false,
                },
                meta: { timestamp: new Date('2024-01-01T00:00:00.000Z') },
            });
        });

        it(`should include authToken when supplied`, () => {
            const message = createHelloMessage({ authRequired: true, authToken: 'bridge-token' });

            expect(message.payload.authToken).toBe('bridge-token');
            expect(message.payload.authRequired).toBe(true);
        });
    });

    describe(`createAuthenticationFailedMessage`, () => {
        it(`should always send a non-null payload object even with no message`, () => {
            const result = createAuthenticationFailedMessage('req-1');

            expect(result.payload).toEqual({});
            expect(result.meta.requestUuid).toBe('req-1');
            expect(result.meta.responseUuid).toEqual(expect.any(String));
        });

        it(`should include the message when supplied`, () => {
            const result = createAuthenticationFailedMessage('req-1', 'bad token');

            expect(result.payload).toEqual({ message: 'bad token' });
        });
    });

    describe(`createConnectedAgentsUpdateMessage`, () => {
        it(`should omit addAgent/removeAgent/channelsState when not supplied`, () => {
            const result = createConnectedAgentsUpdateMessage({ requestUuid: 'req-1', allAgents: [] });

            expect(result.payload).toEqual({ allAgents: [] });
        });

        it(`should include addAgent and channelsState for a join`, () => {
            const result = createConnectedAgentsUpdateMessage({
                requestUuid: 'req-1',
                allAgents: [{ desktopAgent: 'AgentA' } as BridgingTypes.DesktopAgentImplementationMetadata],
                addAgent: 'AgentA',
                channelsState: { channel1: [] },
            });

            expect(result.payload).toEqual({
                allAgents: [{ desktopAgent: 'AgentA' }],
                addAgent: 'AgentA',
                channelsState: { channel1: [] },
            });
            expect(result.payload.removeAgent).toBeUndefined();
        });

        it(`should include removeAgent for a departure`, () => {
            const result = createConnectedAgentsUpdateMessage({
                requestUuid: 'req-2',
                allAgents: [],
                removeAgent: 'AgentB',
            });

            expect(result.payload).toEqual({ allAgents: [], removeAgent: 'AgentB' });
        });
    });

    describe(`createBridgeRequestMessage`, () => {
        const request: BridgingTypes.AgentRequestMessage = {
            type: 'findIntentRequest',
            payload: { intent: 'ViewChart' },
            meta: { requestUuid: 'req-1', timestamp: new Date(), source: { appId: 'app1', instanceId: 'i1' } },
        };

        it(`should stamp meta.source.desktopAgent from the socket's assigned name, preserving other source fields`, () => {
            const result = createBridgeRequestMessage(request, 'AgentA');

            expect(result.meta.source).toEqual({ appId: 'app1', instanceId: 'i1', desktopAgent: 'AgentA' });
        });

        it(`should overwrite an agent-supplied source.desktopAgent rather than trust it`, () => {
            const spoofed: BridgingTypes.AgentRequestMessage = {
                ...request,
                meta: { ...request.meta, source: { appId: 'app1', desktopAgent: 'NotMe' } },
            };

            const result = createBridgeRequestMessage(spoofed, 'AgentA');

            expect(result.meta.source.desktopAgent).toBe('AgentA');
        });

        it(`should preserve the original requestUuid and payload`, () => {
            const result = createBridgeRequestMessage(request, 'AgentA');

            expect(result.meta.requestUuid).toBe('req-1');
            expect(result.payload).toBe(request.payload);
        });

        it(`should omit destination when not supplied`, () => {
            const result = createBridgeRequestMessage(request, 'AgentA');

            expect(result.meta.destination).toBeUndefined();
        });

        it(`should include destination when supplied`, () => {
            const result = createBridgeRequestMessage(request, 'AgentA', { desktopAgent: 'AgentB', appId: 'app2' });

            expect(result.meta.destination).toEqual({ desktopAgent: 'AgentB', appId: 'app2' });
        });

        it(`should not leak meta.responseUuid from a malformed source request`, () => {
            const withResponseUuid = {
                ...request,
                meta: { ...request.meta, responseUuid: 'should-not-appear' } as any,
            };

            const result = createBridgeRequestMessage(withResponseUuid, 'AgentA');

            expect((result.meta as any).responseUuid).toBeUndefined();
        });
    });

    describe(`createBridgeResponseMessage`, () => {
        it(`should omit sources/errorSources/errorDetails when empty or absent`, () => {
            const result = createBridgeResponseMessage('findIntentResponse', { appIntent: { apps: [] } }, 'req-1');

            expect(result.meta).toEqual({
                requestUuid: 'req-1',
                responseUuid: expect.any(String),
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
            });
        });

        it(`should include non-empty collation arrays`, () => {
            const result = createBridgeResponseMessage('findIntentResponse', { appIntent: { apps: [] } }, 'req-1', {
                sources: [{ desktopAgent: 'AgentB' }],
                errorSources: [{ desktopAgent: 'AgentC' }],
                errorDetails: ['ResponseToBridgeTimedOut'],
            });

            expect(result.meta.sources).toEqual([{ desktopAgent: 'AgentB' }]);
            expect(result.meta.errorSources).toEqual([{ desktopAgent: 'AgentC' }]);
            expect(result.meta.errorDetails).toEqual(['ResponseToBridgeTimedOut']);
        });

        it(`should omit an explicitly empty sources array`, () => {
            const result = createBridgeResponseMessage('findIntentResponse', {}, 'req-1', { sources: [] });

            expect(result.meta.sources).toBeUndefined();
        });
    });

    describe(`createBridgeErrorResponseMessage`, () => {
        it(`should always set errorSources and errorDetails (required by the schema)`, () => {
            const result = createBridgeErrorResponseMessage(
                'openResponse',
                'DesktopAgentNotFound',
                'req-1',
                [{ desktopAgent: 'AgentB' }],
                ['DesktopAgentNotFound'],
            );

            expect(result).toEqual({
                type: 'openResponse',
                payload: { error: 'DesktopAgentNotFound' },
                meta: {
                    requestUuid: 'req-1',
                    responseUuid: expect.any(String),
                    timestamp: new Date('2024-01-01T00:00:00.000Z'),
                    errorSources: [{ desktopAgent: 'AgentB' }],
                    errorDetails: ['DesktopAgentNotFound'],
                },
            });
        });
    });
});
