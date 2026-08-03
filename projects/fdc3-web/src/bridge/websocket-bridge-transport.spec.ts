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
import { WebSocketBridgeTransport, WebSocketFactory } from './websocket-bridge-transport.js';

class FakeWebSocket {
    public static readonly OPEN = 1;
    public readonly OPEN = 1;
    public readyState = 0;
    public sent: string[] = [];
    public onopen: (() => void) | null = null;
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    public onerror: (() => void) | null = null;
    public onclose: (() => void) | null = null;

    constructor(public readonly url: string) {}

    public send(data: string): void {
        this.sent.push(data);
    }

    public close(): void {
        this.readyState = 3;
    }

    public triggerOpen(): void {
        this.readyState = this.OPEN;
        this.onopen?.();
    }

    public triggerMessage(data: unknown): void {
        this.onmessage?.({ data });
    }

    public triggerError(): void {
        // mirrors real WebSocket semantics: a connection error is always followed by a close event
        this.onerror?.();
        this.onclose?.();
    }

    public triggerClose(): void {
        this.onclose?.();
    }
}

describe(`WebSocketBridgeTransport`, () => {
    let sockets: FakeWebSocket[];
    let webSocketFactory: WebSocketFactory;
    let factoryCallCount: number;

    beforeEach(() => {
        vi.useFakeTimers();
        sockets = [];
        factoryCallCount = 0;
        webSocketFactory = (url: string) => {
            factoryCallCount++;
            const socket = new FakeWebSocket(url);
            sockets.push(socket);
            return socket as unknown as WebSocket;
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function createInstance(
        overrides: Partial<ConstructorParameters<typeof WebSocketBridgeTransport>[0]> = {},
    ): WebSocketBridgeTransport {
        return new WebSocketBridgeTransport({ webSocketFactory, portRange: [4475, 4476], ...overrides });
    }

    it(`should not construct a socket until connect() is called`, () => {
        createInstance();
        expect(factoryCallCount).toBe(0);
    });

    it(`should connect to the first port in the range by default`, () => {
        const instance = createInstance();
        instance.connect();

        expect(sockets[0]?.url).toBe('ws://127.0.0.1:4475');
    });

    it(`should honour a custom host and portRange`, () => {
        const instance = createInstance({ host: 'localhost', portRange: [5000, 5001] });
        instance.connect();

        expect(sockets[0]?.url).toBe('ws://localhost:5000');
    });

    it(`should advance to the next port when the socket reports an error`, () => {
        const instance = createInstance();
        instance.connect();
        sockets[0]?.triggerError();

        expect(sockets[1]?.url).toBe('ws://127.0.0.1:4476');
    });

    it(`should advance to the next port when the factory throws`, () => {
        let calls = 0;
        const throwingFactory: WebSocketFactory = (url: string) => {
            calls++;
            if (calls === 1) {
                throw new Error('construction failed');
            }
            const socket = new FakeWebSocket(url);
            sockets.push(socket);
            return socket as unknown as WebSocket;
        };
        const instance = createInstance({ webSocketFactory: throwingFactory });

        instance.connect();

        expect(sockets[0]?.url).toBe('ws://127.0.0.1:4476');
    });

    it(`should advance to the next port when no open occurs within the connect timeout`, () => {
        const instance = createInstance({ portConnectTimeoutMs: 100 });
        instance.connect();

        vi.advanceTimersByTime(100);

        expect(sockets[1]?.url).toBe('ws://127.0.0.1:4476');
    });

    it(`should pause at least 5s (floored, not capped) after exhausting the port range`, () => {
        const instance = createInstance({ retryPauseMs: 1000 });
        instance.connect();
        sockets[0]?.triggerError();
        sockets[1]?.triggerError();

        expect(factoryCallCount).toBe(2);

        vi.advanceTimersByTime(4999);
        expect(factoryCallCount).toBe(2);

        vi.advanceTimersByTime(1);
        expect(factoryCallCount).toBe(3);
        expect(sockets[2]?.url).toBe('ws://127.0.0.1:4475');
    });

    it(`should transition to connected and notify state listeners on open`, () => {
        const instance = createInstance();
        const states: string[] = [];
        instance.onStateChange(state => states.push(state));

        instance.connect();
        expect(instance.state).toBe('connecting');

        sockets[0]?.triggerOpen();

        expect(instance.state).toBe('connected');
        expect(states).toEqual(['connecting', 'connected']);
    });

    it(`should deliver a parsed inbound message with a revived Date timestamp`, () => {
        const instance = createInstance();
        const received: unknown[] = [];
        instance.subscribe(message => received.push(message));

        instance.connect();
        sockets[0]?.triggerOpen();
        sockets[0]?.triggerMessage(
            JSON.stringify({ type: 'hello', payload: {}, meta: { timestamp: new Date(2024, 0, 1) } }),
        );

        expect(received).toHaveLength(1);
        expect((received[0] as any).meta.timestamp).toBeInstanceOf(Date);
    });

    it(`should not call subscribers for malformed inbound JSON`, () => {
        const instance = createInstance();
        const received: unknown[] = [];
        instance.subscribe(message => received.push(message));

        instance.connect();
        sockets[0]?.triggerOpen();
        sockets[0]?.triggerMessage('not-json');

        expect(received).toHaveLength(0);
    });

    it(`should not send before the socket is open`, () => {
        const instance = createInstance();
        instance.connect();

        instance.send({ type: 'handshake' });

        expect(sockets[0]?.sent).toHaveLength(0);
    });

    it(`should send exact JSON once the socket is open`, () => {
        const instance = createInstance();
        instance.connect();
        sockets[0]?.triggerOpen();

        instance.send({ type: 'handshake', payload: {}, meta: {} });

        expect(sockets[0]?.sent[0]).toBe(JSON.stringify({ type: 'handshake', payload: {}, meta: {} }));
    });

    it(`should reconnect to the last good port after a clean close following a successful connection`, () => {
        const instance = createInstance();
        instance.connect();
        sockets[0]?.triggerError(); // advance to port 4476
        sockets[1]?.triggerOpen(); // connected on 4476
        sockets[1]?.triggerClose();

        expect(instance.state).toBe('disconnected');
        expect(sockets[2]?.url).toBe('ws://127.0.0.1:4476');
    });

    it(`should stop retrying and not construct further sockets after close()`, () => {
        const instance = createInstance();
        instance.connect();
        sockets[0]?.triggerOpen();

        instance.close();
        expect(sockets[0]?.readyState).toBe(3);

        vi.advanceTimersByTime(60000);
        expect(factoryCallCount).toBe(1);

        sockets[0]?.triggerClose();
        expect(factoryCallCount).toBe(1);
    });

    it(`should advance to a different port on reset()`, () => {
        const instance = createInstance();
        instance.connect();
        sockets[0]?.triggerOpen();

        instance.reset();

        expect(instance.state).toBe('disconnected');
        expect(sockets[1]?.url).toBe('ws://127.0.0.1:4476');
    });

    it(`should stop delivering messages after unsubscribe()`, () => {
        const instance = createInstance();
        const received: unknown[] = [];
        const subscription = instance.subscribe(message => received.push(message));

        instance.connect();
        sockets[0]?.triggerOpen();
        subscription.unsubscribe();
        sockets[0]?.triggerMessage(JSON.stringify({ type: 'hello', payload: {}, meta: { timestamp: new Date() } }));

        expect(received).toHaveLength(0);
    });

    it(`connect() should be a no-op when already connecting or connected`, () => {
        const instance = createInstance();
        instance.connect();
        instance.connect();

        expect(factoryCallCount).toBe(1);
    });
});
