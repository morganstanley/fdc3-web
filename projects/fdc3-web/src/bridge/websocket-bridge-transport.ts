/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { GetAgentLogLevels, LogLevel } from '@finos/fdc3';
import { BRIDGE } from '../constants.js';
import { BridgeConnectionState, IBridgeTransport, Subscription } from '../contracts.js';
import { createLogger, LoggerFunction } from '../helpers/index.js';
import { parseBridgeMessage, serializeBridgeMessage } from './bridge-message.serialization.js';

export type WebSocketFactory = (url: string) => WebSocket;

export type WebSocketBridgeTransportParams = {
    host?: string;
    portRange?: [number, number];
    /** Milliseconds to pause after exhausting the port range before scanning again. */
    retryPauseMs?: number;
    portConnectTimeoutMs?: number;
    /** Defaults to `url => new WebSocket(url)`, evaluated lazily inside connect(). */
    webSocketFactory?: WebSocketFactory;
    logLevels?: GetAgentLogLevels;
};

/**
 * Implements Desktop Agent Bridging connection Step 1
 * (https://fdc3.finos.org/docs/agent-bridging/spec): scans a port range on a host for a bridge
 * websocket, retrying with a floor on the pause between full scans. Moves JSON payloads only - it
 * never interprets them (that's BridgeConnection/BridgeMessageCorrelator/BridgeInboundRouter's job).
 */
export class WebSocketBridgeTransport implements IBridgeTransport {
    private readonly log: LoggerFunction;
    private readonly ports: number[];

    private portIndex = 0;
    private lastGoodPortIndex: number | undefined;
    private socket: WebSocket | undefined;
    private connectTimeoutId: ReturnType<typeof setTimeout> | undefined;
    private retryTimeoutId: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private currentState: BridgeConnectionState = 'disconnected';

    private readonly messageCallbacks = new Map<number, (message: unknown) => void>();
    private readonly stateCallbacks = new Map<number, (state: BridgeConnectionState) => void>();
    private nextCallbackId = 0;

    constructor(private readonly params: WebSocketBridgeTransportParams = {}) {
        this.log = createLogger(WebSocketBridgeTransport, 'connection', params.logLevels);

        const [start, end] = params.portRange ?? BRIDGE.DEFAULT_PORT_RANGE;
        this.ports = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }

    public get state(): BridgeConnectionState {
        return this.currentState;
    }

    public connect(): void {
        if (this.disposed || this.currentState !== 'disconnected') {
            return;
        }

        this.setState('connecting');
        this.attemptCurrentPort();
    }

    public send(message: unknown): void {
        if (this.socket == null || this.socket.readyState !== this.socket.OPEN) {
            this.log('Cannot send - not connected to a Desktop Agent Bridge', LogLevel.WARN);
            return;
        }

        this.socket.send(serializeBridgeMessage(message));
    }

    public subscribe(callback: (message: unknown) => void): Subscription {
        const id = this.nextCallbackId++;
        this.messageCallbacks.set(id, callback);

        return { unsubscribe: () => this.messageCallbacks.delete(id) };
    }

    public onStateChange(callback: (state: BridgeConnectionState) => void): Subscription {
        const id = this.nextCallbackId++;
        this.stateCallbacks.set(id, callback);

        return { unsubscribe: () => this.stateCallbacks.delete(id) };
    }

    public reset(): void {
        this.detachAndClose();
        this.setState('disconnected');
        this.advance();
    }

    public close(): void {
        this.disposed = true;

        if (this.connectTimeoutId != null) {
            clearTimeout(this.connectTimeoutId);
        }
        if (this.retryTimeoutId != null) {
            clearTimeout(this.retryTimeoutId);
        }

        this.detachAndClose();
        this.messageCallbacks.clear();
        this.stateCallbacks.clear();
        this.setState('disconnected');
    }

    private setState(state: BridgeConnectionState): void {
        this.currentState = state;
        [...this.stateCallbacks.values()].forEach(callback => callback(state));
    }

    private attemptCurrentPort(): void {
        if (this.disposed) {
            return;
        }

        const port = this.ports[this.portIndex];

        if (port == null) {
            this.portIndex = 0;
            // spec: pause at least 5s after exhausting the port range before scanning again
            const pause = Math.max(this.params.retryPauseMs ?? BRIDGE.RETRY_PAUSE_MS, BRIDGE.RETRY_PAUSE_MS);
            this.retryTimeoutId = setTimeout(() => this.attemptCurrentPort(), pause);
            return;
        }

        const host = this.params.host ?? BRIDGE.DEFAULT_HOST;
        const url = `ws://${host}:${port}`;
        const webSocketFactory = this.params.webSocketFactory ?? ((wsUrl: string) => new WebSocket(wsUrl));

        try {
            this.log(`Attempting connection to Desktop Agent Bridge at ${url}`, LogLevel.DEBUG);
            this.socket = webSocketFactory(url);
        } catch (err) {
            this.log(`WebSocket construction failed for ${url}`, LogLevel.WARN, err);
            this.advance();
            return;
        }

        this.attachSocketHandlers();
    }

    private attachSocketHandlers(): void {
        const socket = this.socket;

        if (socket == null) {
            return;
        }

        const portConnectTimeoutMs = this.params.portConnectTimeoutMs ?? BRIDGE.PORT_CONNECT_TIMEOUT_MS;

        this.connectTimeoutId = setTimeout(() => {
            this.log(
                `Timed out waiting for ${socket.url} to open after ${portConnectTimeoutMs}ms - trying the next port`,
                LogLevel.WARN,
            );
            this.detachAndClose();
            this.advance();
        }, portConnectTimeoutMs);

        socket.onopen = () => {
            if (this.connectTimeoutId != null) {
                clearTimeout(this.connectTimeoutId);
                this.connectTimeoutId = undefined;
            }
            this.lastGoodPortIndex = this.portIndex;
            this.log(`Connected to Desktop Agent Bridge at ${socket.url}`, LogLevel.INFO);
            this.setState('connected');
        };

        socket.onmessage = event => {
            const message = parseBridgeMessage(event.data);

            if (message == null) {
                this.log('Received non-JSON message from bridge, ignoring', LogLevel.WARN);
                return;
            }

            [...this.messageCallbacks.values()].forEach(callback => callback(message));
        };

        socket.onerror = () => {
            this.log('WebSocket error', LogLevel.WARN);
        };

        socket.onclose = () => {
            const wasConnected = this.currentState === 'connected';

            this.detachAndClose();

            if (this.disposed) {
                return;
            }

            if (wasConnected) {
                // reconnect: retry the port that worked last before resuming the scan
                this.portIndex = this.lastGoodPortIndex ?? 0;
                this.setState('disconnected');
                this.attemptCurrentPort();
            } else {
                this.advance();
            }
        };
    }

    private advance(): void {
        this.portIndex++;
        this.attemptCurrentPort();
    }

    private detachAndClose(): void {
        if (this.connectTimeoutId != null) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = undefined;
        }

        const socket = this.socket;

        if (socket != null) {
            // detach handlers first so the close() we initiate here doesn't re-enter onclose
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;

            try {
                socket.close();
            } catch {
                // ignore - socket may already be closed/closing
            }
        }

        this.socket = undefined;
    }
}
