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
import { BridgingServer } from './bridging-server.js';
import { FakeServerTransport } from './server-transport.fake.js';

const implementationMetadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };

function handshakeMessage(requestedName: string, requestUuid = 'req-1') {
    return {
        type: 'handshake' as const,
        payload: { requestedName, implementationMetadata, channelsState: {} },
        meta: { requestUuid, timestamp: new Date() },
    };
}

describe(`${BridgingServer.name}`, () => {
    it(`should start the transport and attach the handshake to every new connection`, async () => {
        const transport = new FakeServerTransport();
        const server = new BridgingServer({ transportFactory: () => transport });

        const { port } = await server.start();

        expect(port).toBe(4475);
        const connection = transport.simulateConnection();
        expect(connection.sent[0]).toMatchObject({ type: 'hello' });
    });

    it(`should unsubscribe from new connections and close the transport on close()`, async () => {
        const transport = new FakeServerTransport();
        const server = new BridgingServer({ transportFactory: () => transport });
        await server.start();

        await server.close();
        transport.simulateConnection();

        expect(transport.closeCallCount).toBe(1);
        // no hello sent to a connection that arrives after close() unsubscribed.
        expect(transport.connections[transport.connections.length - 1].sent.length).toBe(0);
    });

    it(`should throw at construction when a configured request timeout leaves no headroom under the client's response timeout`, () => {
        expect(
            () =>
                new BridgingServer({
                    transportFactory: () => new FakeServerTransport(),
                    requestTimeoutsMs: { findIntentRequest: 14000 },
                }),
        ).toThrow(/headroom/);
    });

    it(`should not throw for the default configuration`, () => {
        expect(() => new BridgingServer({ transportFactory: () => new FakeServerTransport() })).not.toThrow();
    });

    it(`should route a full findIntentRequest through two handshaken agents end-to-end`, async () => {
        const transport = new FakeServerTransport();
        const server = new BridgingServer({ transportFactory: () => transport });
        await server.start();

        const connectionA = transport.simulateConnection();
        connectionA.receive(handshakeMessage('AgentA'));
        const connectionB = transport.simulateConnection();
        connectionB.receive(handshakeMessage('AgentB'));

        connectionA.receive({
            type: 'findIntentRequest',
            payload: { intent: 'ViewChart' },
            meta: { requestUuid: 'req-find', timestamp: new Date(), source: { appId: 'callerApp' } },
        });

        const forwardedToB = connectionB.sent[connectionB.sent.length - 1] as any;
        expect(forwardedToB.type).toBe('findIntentRequest');
        expect(forwardedToB.meta.source.desktopAgent).toBe('AgentA');

        connectionB.receive({
            type: 'findIntentResponse',
            payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'chartApp' }] } },
            meta: { requestUuid: 'req-find', responseUuid: 'r1', timestamp: new Date() },
        });

        const responseToA = connectionA.sent[connectionA.sent.length - 1] as any;
        expect(responseToA.type).toBe('findIntentResponse');
        expect(responseToA.payload.appIntent.apps).toEqual([{ appId: 'chartApp', desktopAgent: 'AgentB' }]);
    });

    it(`should notify pendingRequests and intentResultRelay when an agent disconnects mid-flight`, async () => {
        const transport = new FakeServerTransport();
        const server = new BridgingServer({ transportFactory: () => transport });
        await server.start();

        const connectionA = transport.simulateConnection();
        connectionA.receive(handshakeMessage('AgentA'));
        const connectionB = transport.simulateConnection();
        connectionB.receive(handshakeMessage('AgentB'));

        connectionA.receive({
            type: 'findIntentRequest',
            payload: { intent: 'ViewChart' },
            meta: { requestUuid: 'req-find', timestamp: new Date(), source: { appId: 'callerApp' } },
        });

        connectionB.simulateClose();

        const responseToA = connectionA.sent[connectionA.sent.length - 1] as any;
        expect(responseToA.payload.error).toBe('AgentDisconnected');
        expect(responseToA.meta.errorDetails).toEqual(['AgentDisconnected']);
    });
});
