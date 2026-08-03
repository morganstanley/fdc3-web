/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { IAgentConnection } from './contracts.js';
import { WebSocketServerTransport } from './websocket-server-transport.js';

// Real-socket tests: this is the one file where a fake transport would hide a real bug (binding the
// wrong host, or a raw Buffer frame silently bypassing parseBridgeMessage - see the comment in
// websocket-server-transport.ts). Uses a high, unlikely-to-collide port range per test.

function waitFor<T>(target: WebSocket, event: string): Promise<T> {
    return new Promise(resolve => target.once(event, (...args: any[]) => resolve(args[0] as T)));
}

describe(`${WebSocketServerTransport.name}`, () => {
    const openTransports: WebSocketServerTransport[] = [];
    const openSockets: WebSocket[] = [];

    afterEach(async () => {
        await Promise.all(openSockets.splice(0).map(socket => socket.close()));
        await Promise.all(openTransports.splice(0).map(transport => transport.close()));
    });

    function track(transport: WebSocketServerTransport): WebSocketServerTransport {
        openTransports.push(transport);
        return transport;
    }

    function trackSocket(socket: WebSocket): WebSocket {
        openSockets.push(socket);
        return socket;
    }

    it(`should listen on the first port in the range and accept a real connection`, async () => {
        const transport = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18475, 18480] }));

        const { port } = await transport.listen();
        expect(port).toBe(18475);

        const connectionPromise = new Promise<IAgentConnection>(resolve => transport.onConnection(resolve));
        const client = trackSocket(new WebSocket(`ws://127.0.0.1:${port}`));
        await waitFor(client, 'open');

        const connection = await connectionPromise;
        expect(connection.id).toEqual(expect.any(String));
    });

    it(`should deliver a message sent by a real client, parsed with meta.timestamp revived to a Date`, async () => {
        const transport = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18481, 18485] }));
        const { port } = await transport.listen();
        const connectionPromise = new Promise<IAgentConnection>(resolve => transport.onConnection(resolve));

        const client = trackSocket(new WebSocket(`ws://127.0.0.1:${port}`));
        await waitFor(client, 'open');
        const connection = await connectionPromise;

        const receivedPromise = new Promise<any>(resolve => connection.subscribe(resolve));
        client.send(JSON.stringify({ type: 'hello', meta: { timestamp: '2024-01-01T00:00:00.000Z' } }));

        const received = await receivedPromise;
        expect(received.meta.timestamp).toBeInstanceOf(Date);
        expect(received.meta.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it(`should serialize and deliver a message sent by the server to the real client`, async () => {
        const transport = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18486, 18490] }));
        const { port } = await transport.listen();
        const connectionPromise = new Promise<IAgentConnection>(resolve => transport.onConnection(resolve));

        const client = trackSocket(new WebSocket(`ws://127.0.0.1:${port}`));
        await waitFor(client, 'open');
        const connection = await connectionPromise;

        const messagePromise = waitFor<Buffer>(client, 'message');
        connection.send({ type: 'hello', meta: { timestamp: new Date('2024-01-01T00:00:00.000Z') } });

        const raw = await messagePromise;
        expect(JSON.parse(raw.toString())).toEqual({
            type: 'hello',
            meta: { timestamp: '2024-01-01T00:00:00.000Z' },
        });
    });

    it(`should call onClose when the remote client disconnects`, async () => {
        const transport = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18491, 18495] }));
        const { port } = await transport.listen();
        const connectionPromise = new Promise<IAgentConnection>(resolve => transport.onConnection(resolve));

        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        await waitFor(client, 'open');
        const connection = await connectionPromise;

        const closedPromise = new Promise<void>(resolve => connection.onClose(resolve));
        client.close();

        await expect(closedPromise).resolves.toBeUndefined();
    });

    it(`should fall through to the next port in the range on EADDRINUSE`, async () => {
        const first = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18496, 18500] }));
        const { port: firstPort } = await first.listen();
        expect(firstPort).toBe(18496);

        const second = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18496, 18500] }));
        const { port: secondPort } = await second.listen();

        expect(secondPort).toBe(18497);
    });

    it(`should reject when the entire port range is exhausted`, async () => {
        const first = track(new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18501, 18501] }));
        await first.listen();

        const second = new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18501, 18501] });

        await expect(second.listen()).rejects.toThrow();
    });

    it(`should resolve close() even when never started`, async () => {
        const transport = new WebSocketServerTransport({ host: '127.0.0.1', portRange: [18502, 18505] });

        await expect(transport.close()).resolves.toBeUndefined();
    });
});
