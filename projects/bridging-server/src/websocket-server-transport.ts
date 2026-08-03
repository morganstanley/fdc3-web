/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { randomUUID } from 'node:crypto';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { BRIDGING_SERVER } from './constants.js';
import { IAgentConnection, IServerTransport, Subscription } from './contracts.js';
import { parseBridgeMessage, serializeBridgeMessage } from './message.serialization.js';

class WebSocketAgentConnection implements IAgentConnection {
    public readonly id = randomUUID();

    constructor(private readonly socket: WebSocket) {}

    public send(message: unknown): void {
        this.socket.send(serializeBridgeMessage(message));
    }

    public subscribe(callback: (message: unknown) => void): Subscription {
        // `ws` delivers a Buffer by default, never a string - parseBridgeMessage passes non-string
        // input through *unchanged*, so a raw Buffer must be stringified before it ever reaches it,
        // or every inbound message would silently bypass parsing (and timestamp revival) entirely.
        const listener = (data: RawData): void => callback(parseBridgeMessage(data.toString()));
        this.socket.on('message', listener);
        return { unsubscribe: () => this.socket.off('message', listener) };
    }

    public onClose(callback: () => void): Subscription {
        // `ws` invokes its 'close' listener with (code, reason) - our own contract takes no
        // arguments, so those must be discarded rather than passed through to the callback.
        const listener = (): void => callback();
        this.socket.on('close', listener);
        return { unsubscribe: () => this.socket.off('close', listener) };
    }

    public close(code?: number, reason?: string): void {
        this.socket.close(code, reason);
    }
}

export interface WebSocketServerTransportParams {
    host?: string;
    portRange?: [number, number];
}

/**
 * Real IServerTransport, backed by `ws`. Binds the first free port in portRange on host (defaults
 * matching the fdc3-web client's own scan range: 127.0.0.1, 4475-4575), retrying the next port on
 * EADDRINUSE.
 */
export class WebSocketServerTransport implements IServerTransport {
    private server: WebSocketServer | undefined;

    private readonly connectionCallbacks = new Set<(connection: IAgentConnection) => void>();

    constructor(private readonly params: WebSocketServerTransportParams = {}) {}

    public listen(): Promise<{ port: number }> {
        const host = this.params.host ?? BRIDGING_SERVER.DEFAULT_HOST;
        const [start, end] = this.params.portRange ?? BRIDGING_SERVER.DEFAULT_PORT_RANGE;

        return this.tryListen(host, start, end);
    }

    public onConnection(callback: (connection: IAgentConnection) => void): Subscription {
        this.connectionCallbacks.add(callback);
        return { unsubscribe: () => this.connectionCallbacks.delete(callback) };
    }

    public close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.server == null) {
                resolve();
                return;
            }

            // wss.close() only stops the underlying HTTP server from accepting new connections and
            // fires its callback once that server (not the still-open client sockets) has closed -
            // per `ws`'s own docs it does NOT terminate already-connected clients, so without this,
            // close() hangs forever whenever any agent is still connected at shutdown.
            this.server.clients.forEach(client => client.terminate());
            this.server.close(error => (error != null ? reject(error) : resolve()));
        });
    }

    private tryListen(host: string, port: number, end: number): Promise<{ port: number }> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({ host, port });

            const onListening = (): void => {
                server.off('error', onError);
                this.server = server;
                server.on('connection', socket => this.handleConnection(socket));
                resolve({ port });
            };

            const onError = (error: NodeJS.ErrnoException): void => {
                server.off('listening', onListening);
                server.removeAllListeners();

                if (error.code === 'EADDRINUSE' && port < end) {
                    this.tryListen(host, port + 1, end).then(resolve, reject);
                } else {
                    reject(error);
                }
            };

            server.once('listening', onListening);
            server.once('error', onError);
        });
    }

    private handleConnection(socket: WebSocket): void {
        const connection = new WebSocketAgentConnection(socket);
        [...this.connectionCallbacks].forEach(callback => callback(connection));
    }
}
