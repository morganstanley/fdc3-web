/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgeConnectionState, IBridgeTransport, Subscription } from '../contracts.js';
import { parseBridgeMessage, serializeBridgeMessage } from './bridge-message.serialization.js';

/**
 * A test double for IBridgeTransport - lets a spec supply it via BridgeParams.transportFactory so
 * no real WebSocket is ever constructed, and lets a spec both assert exactly what was sent and
 * inject arbitrary inbound messages (including malformed ones, since `receive` takes `unknown`).
 * Excluded from the shipped lib build and from coverage accounting (see tsconfig.lib.json /
 * shared/vitest.config.ts).
 */
export class FakeBridgeTransport implements IBridgeTransport {
    public readonly sent: unknown[] = [];
    public connectCallCount = 0;
    public resetCallCount = 0;
    public closeCallCount = 0;
    public state: BridgeConnectionState = 'disconnected';

    private readonly messageCallbacks = new Set<(message: unknown) => void>();
    private readonly stateCallbacks = new Set<(state: BridgeConnectionState) => void>();

    public connect(): void {
        this.connectCallCount++;
    }

    public send(message: unknown): void {
        this.sent.push(message);
    }

    public subscribe(callback: (message: unknown) => void): Subscription {
        this.messageCallbacks.add(callback);
        return { unsubscribe: () => this.messageCallbacks.delete(callback) };
    }

    public onStateChange(callback: (state: BridgeConnectionState) => void): Subscription {
        this.stateCallbacks.add(callback);
        return { unsubscribe: () => this.stateCallbacks.delete(callback) };
    }

    public reset(): void {
        this.resetCallCount++;
    }

    public close(): void {
        this.closeCallCount++;
    }

    /** Test driver: sets state and notifies subscribers, exactly as a real transport would. */
    public setState(state: BridgeConnectionState): void {
        this.state = state;
        [...this.stateCallbacks].forEach(callback => callback(state));
    }

    /** Test driver: injects an arbitrary inbound message (already parsed - not wire JSON). */
    public receive(message: unknown): void {
        [...this.messageCallbacks].forEach(callback => callback(message));
    }

    /** Exactly what would cross the wire for the message at `sent[index]`, round-tripped through serialize+parse. */
    public sentWire(index: number): unknown {
        return parseBridgeMessage(serializeBridgeMessage(this.sent[index]));
    }
}
