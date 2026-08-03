/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { IAgentConnection, IServerTransport, Subscription } from './contracts.js';
import { parseBridgeMessage, serializeBridgeMessage } from './message.serialization.js';

/**
 * A test double for IAgentConnection - one simulated peer. Lets a spec both assert exactly what was
 * sent (including the exact wire JSON, via sentWire) and inject arbitrary inbound messages
 * (including malformed ones, since `receive` takes `unknown`).
 */
export class FakeAgentConnection implements IAgentConnection {
    public readonly sent: unknown[] = [];
    public closeCallCount = 0;
    public lastCloseReason: { code?: number; reason?: string } | undefined;

    private readonly messageCallbacks = new Set<(message: unknown) => void>();
    private readonly closeCallbacks = new Set<() => void>();

    constructor(public readonly id: string) {}

    public send(message: unknown): void {
        this.sent.push(message);
    }

    public subscribe(callback: (message: unknown) => void): Subscription {
        this.messageCallbacks.add(callback);
        return { unsubscribe: () => this.messageCallbacks.delete(callback) };
    }

    public onClose(callback: () => void): Subscription {
        this.closeCallbacks.add(callback);
        return { unsubscribe: () => this.closeCallbacks.delete(callback) };
    }

    public close(code?: number, reason?: string): void {
        this.closeCallCount++;
        this.lastCloseReason = { code, reason };
        this.simulateClose();
    }

    /** Test driver: injects an arbitrary inbound message (already parsed - not wire JSON). */
    public receive(message: unknown): void {
        [...this.messageCallbacks].forEach(callback => callback(message));
    }

    /** Test driver: simulates the remote peer disconnecting (as opposed to the server closing it). */
    public simulateClose(): void {
        [...this.closeCallbacks].forEach(callback => callback());
    }

    /** Exactly what would cross the wire for the message at `sent[index]`, round-tripped through serialize+parse. */
    public sentWire(index: number): unknown {
        return parseBridgeMessage(serializeBridgeMessage(this.sent[index]));
    }
}

/**
 * A test double for IServerTransport - lets a spec supply it via BridgingServerOptions.transportFactory
 * so no real WebSocketServer is ever constructed. Excluded from the shipped lib build and from
 * coverage accounting (see tsconfig.lib.json / vitest.config.ts).
 */
export class FakeServerTransport implements IServerTransport {
    public readonly connections: FakeAgentConnection[] = [];
    public closeCallCount = 0;

    private readonly connectionCallbacks = new Set<(connection: IAgentConnection) => void>();
    private nextId = 1;

    public listen(): Promise<{ port: number }> {
        return Promise.resolve({ port: 4475 });
    }

    public onConnection(callback: (connection: IAgentConnection) => void): Subscription {
        this.connectionCallbacks.add(callback);
        return { unsubscribe: () => this.connectionCallbacks.delete(callback) };
    }

    public close(): Promise<void> {
        this.closeCallCount++;
        return Promise.resolve();
    }

    /** Test driver: simulates a new agent connecting, and returns the fake connection to drive it with. */
    public simulateConnection(): FakeAgentConnection {
        const connection = new FakeAgentConnection(`connection-${this.nextId++}`);
        this.connections.push(connection);
        [...this.connectionCallbacks].forEach(callback => callback(connection));
        return connection;
    }
}
