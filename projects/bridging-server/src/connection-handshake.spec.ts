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
import { AgentRegistry } from './agent-registry.js';
import { ChannelsState } from './channels-state.js';
import { ConnectionHandshake, ConnectionHandshakeParams } from './connection-handshake.js';
import { Logger } from './logger.js';
import { FakeServerTransport } from './server-transport.fake.js';

const implementationMetadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };

function handshakeMessage(requestedName: string, requestUuid = 'req-1', extra: Record<string, any> = {}) {
    return {
        type: 'handshake' as const,
        payload: {
            requestedName,
            implementationMetadata,
            channelsState: {},
            ...extra,
        },
        meta: { requestUuid, timestamp: new Date() },
    };
}

describe(`${ConnectionHandshake.name}`, () => {
    let transport: FakeServerTransport;
    let registry: AgentRegistry;
    let channelsState: ChannelsState;
    let onMessage: ReturnType<typeof vi.fn>;
    let onAgentConnected: ReturnType<typeof vi.fn>;
    let onAgentDisconnected: ReturnType<typeof vi.fn>;

    function createInstance(overrides: Partial<ConnectionHandshakeParams> = {}): ConnectionHandshake {
        return new ConnectionHandshake({
            registry,
            channelsState,
            logger: new Logger('error'),
            authRequired: false,
            onMessage,
            onAgentConnected,
            onAgentDisconnected,
            ...overrides,
        });
    }

    beforeEach(() => {
        transport = new FakeServerTransport();
        registry = new AgentRegistry();
        channelsState = new ChannelsState();
        onMessage = vi.fn();
        onAgentConnected = vi.fn();
        onAgentDisconnected = vi.fn();
    });

    it(`should send hello unprompted on attach, with authRequired false and no authToken by default`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();

        instance.attach(connection);

        expect(connection.sent).toEqual([
            {
                type: 'hello',
                payload: {
                    desktopAgentBridgeVersion: expect.any(String),
                    supportedFDC3Versions: expect.any(Array),
                    authRequired: false,
                },
                meta: { timestamp: expect.any(Date) },
            },
        ]);
    });

    it(`should advertise authRequired and include authToken when configured`, () => {
        const instance = createInstance({ authRequired: true, authToken: 'bridge-secret' });
        const connection = transport.simulateConnection();

        instance.attach(connection);

        const hello = connection.sent[0] as any;
        expect(hello.payload.authRequired).toBe(true);
        expect(hello.payload.authToken).toBe('bridge-secret');
    });

    it(`should register the agent and reply to the joiner with its assigned name and merged channelsState`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();
        instance.attach(connection);

        connection.receive(handshakeMessage('AgentA', 'req-1'));

        const update = connection.sent[1] as any;
        expect(update.type).toBe('connectedAgentsUpdate');
        expect(update.meta.requestUuid).toBe('req-1');
        expect(update.payload.addAgent).toBe('AgentA');
        expect(update.payload.allAgents).toEqual([{ ...implementationMetadata, desktopAgent: 'AgentA' }]);
        expect(update.payload.channelsState).toEqual({});
        expect(onAgentConnected).toHaveBeenCalledWith('AgentA');
    });

    it(`should notify already-connected agents without channelsState and with a fresh responseUuid`, () => {
        const instance = createInstance();
        const connectionA = transport.simulateConnection();
        instance.attach(connectionA);
        connectionA.receive(handshakeMessage('AgentA', 'req-1'));

        const connectionB = transport.simulateConnection();
        instance.attach(connectionB);
        connectionB.receive(handshakeMessage('AgentB', 'req-2'));

        const updateToA = connectionA.sent[2] as any;
        expect(updateToA.type).toBe('connectedAgentsUpdate');
        expect(updateToA.payload.addAgent).toBe('AgentB');
        expect(updateToA.payload.channelsState).toBeUndefined();
        expect(updateToA.meta.requestUuid).toBe('req-2');

        const updateToB = connectionB.sent[1] as any;
        expect(updateToB.meta.responseUuid).not.toBe(updateToA.meta.responseUuid);
    });

    it(`should deterministically suffix a duplicate requestedName`, () => {
        const instance = createInstance();
        const connectionA = transport.simulateConnection();
        instance.attach(connectionA);
        connectionA.receive(handshakeMessage('AgentA'));

        const connectionB = transport.simulateConnection();
        instance.attach(connectionB);
        connectionB.receive(handshakeMessage('AgentA'));

        expect((connectionB.sent[1] as any).payload.addAgent).toBe('AgentA-1');
    });

    it(`should drop a non-handshake message received before the handshake, without calling onMessage`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();
        instance.attach(connection);

        connection.receive({
            type: 'findIntentRequest',
            payload: {},
            meta: { requestUuid: 'u', timestamp: new Date() },
        });

        expect(onMessage).not.toHaveBeenCalled();
    });

    it(`should close the connection once MAX_PARSE_FAILURES non-handshake messages accumulate before the handshake completes`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();
        const closeSpy = vi.spyOn(connection, 'close');
        instance.attach(connection);

        for (let i = 0; i < 10; i++) {
            connection.receive({
                type: 'findIntentRequest',
                payload: {},
                meta: { requestUuid: 'u', timestamp: new Date() },
            });
        }

        expect(closeSpy).toHaveBeenCalled();
    });

    it(`should forward messages to onMessage once the session is connected`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();
        instance.attach(connection);
        connection.receive(handshakeMessage('AgentA'));

        const request = { type: 'findIntentRequest', payload: {}, meta: { requestUuid: 'u', timestamp: new Date() } };
        connection.receive(request);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage.mock.calls[0][1]).toBe(request);
    });

    it(`should ignore a second handshake on an already-connected socket via the default onMessage passthrough (not specially handled)`, () => {
        const instance = createInstance();
        const connection = transport.simulateConnection();
        instance.attach(connection);
        connection.receive(handshakeMessage('AgentA'));

        const secondHandshake = handshakeMessage('AgentB');
        connection.receive(secondHandshake);

        // the connected-state branch simply delegates - it is message-router's job to drop an
        // unroutable type such as a second `handshake`, not connection-handshake's.
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ name: 'AgentA' }), secondHandshake);
        expect(registry.getByName('AgentB')).toBeUndefined();
    });

    describe(`handshake timeout`, () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it(`should close the connection if no handshake arrives within the configured timeout`, () => {
            const instance = createInstance({ handshakeTimeoutMs: 1000 });
            const connection = transport.simulateConnection();
            const closeSpy = vi.spyOn(connection, 'close');

            instance.attach(connection);
            vi.advanceTimersByTime(1000);

            expect(closeSpy).toHaveBeenCalled();
        });

        it(`should not close the connection if the handshake arrives before the timeout`, () => {
            const instance = createInstance({ handshakeTimeoutMs: 1000 });
            const connection = transport.simulateConnection();
            const closeSpy = vi.spyOn(connection, 'close');

            instance.attach(connection);
            connection.receive(handshakeMessage('AgentA'));
            vi.advanceTimersByTime(1000);

            expect(closeSpy).not.toHaveBeenCalled();
        });
    });

    describe(`auth`, () => {
        it(`should reject an invalid auth token with authenticationFailed and close the connection`, async () => {
            const validateAuthToken = vi.fn().mockResolvedValue(false);
            const instance = createInstance({ authRequired: true, validateAuthToken });
            const connection = transport.simulateConnection();
            const closeSpy = vi.spyOn(connection, 'close');
            instance.attach(connection);

            connection.receive(handshakeMessage('AgentA', 'req-1', { authToken: 'bad' }));
            await Promise.resolve();
            await Promise.resolve();

            expect(validateAuthToken).toHaveBeenCalledWith('bad');
            const failure = connection.sent[1] as any;
            expect(failure.type).toBe('authenticationFailed');
            expect(failure.payload).toEqual({ message: expect.any(String) });
            expect(failure.meta.requestUuid).toBe('req-1');
            expect(closeSpy).toHaveBeenCalled();
            expect(registry.getByName('AgentA')).toBeUndefined();
        });

        it(`should accept a valid auth token and proceed with registration`, async () => {
            const validateAuthToken = vi.fn().mockResolvedValue(true);
            const instance = createInstance({ authRequired: true, validateAuthToken });
            const connection = transport.simulateConnection();
            instance.attach(connection);

            connection.receive(handshakeMessage('AgentA', 'req-1', { authToken: 'good' }));
            await Promise.resolve();
            await Promise.resolve();

            expect(registry.getByName('AgentA')).toBeDefined();
        });
    });

    describe(`disconnect`, () => {
        it(`should clean up the registry with no broadcast when a pre-handshake socket closes`, () => {
            const instance = createInstance();
            const connection = transport.simulateConnection();
            instance.attach(connection);

            connection.simulateClose();

            expect(registry.getById(connection.id)).toBeUndefined();
            expect(onAgentDisconnected).not.toHaveBeenCalled();
        });

        it(`should broadcast removeAgent to remaining agents and call onAgentDisconnected when a connected agent closes`, () => {
            const instance = createInstance();
            const connectionA = transport.simulateConnection();
            instance.attach(connectionA);
            connectionA.receive(handshakeMessage('AgentA'));

            const connectionB = transport.simulateConnection();
            instance.attach(connectionB);
            connectionB.receive(handshakeMessage('AgentB'));

            connectionA.simulateClose();

            const departureUpdate = connectionB.sent[connectionB.sent.length - 1] as any;
            expect(departureUpdate.type).toBe('connectedAgentsUpdate');
            expect(departureUpdate.payload.removeAgent).toBe('AgentA');
            expect(departureUpdate.payload.allAgents).toEqual([{ ...implementationMetadata, desktopAgent: 'AgentB' }]);
            expect(onAgentDisconnected).toHaveBeenCalledWith('AgentA');
            expect(registry.getByName('AgentA')).toBeUndefined();
        });

        it(`should clear a pending handshake timer on close so it cannot fire after teardown`, () => {
            vi.useFakeTimers();
            try {
                const instance = createInstance({ handshakeTimeoutMs: 1000 });
                const connection = transport.simulateConnection();
                const closeSpy = vi.spyOn(connection, 'close');
                instance.attach(connection);

                connection.simulateClose();
                vi.advanceTimersByTime(1000);

                expect(closeSpy).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
