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

export interface Subscription {
    unsubscribe(): void;
}

/**
 * One connected peer. Deliberately narrower than the client's IBridgeTransport: no connect(), no
 * reset(), no reconnect state machine - a server-side peer either exists or is gone.
 */
export interface IAgentConnection {
    /** Stable per-socket id, assigned before the handshake completes (and so before a name exists). */
    readonly id: string;
    /** Serializes the message (including meta.timestamp -> ISO string) before sending. */
    send(message: unknown): void;
    /** Delivers parsed messages, with meta.timestamp already revived to a Date. */
    subscribe(callback: (message: unknown) => void): Subscription;
    onClose(callback: () => void): Subscription;
    close(code?: number, reason?: string): void;
}

export interface IServerTransport {
    listen(): Promise<{ port: number }>;
    onConnection(callback: (connection: IAgentConnection) => void): Subscription;
    close(): Promise<void>;
}

export type ServerTransportFactory = () => IServerTransport;

export type BridgingServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BridgingServerOptions {
    /** Defaults to BRIDGING_SERVER.DEFAULT_HOST ('127.0.0.1'). Ignored when transportFactory is supplied. */
    host?: string;
    /** Defaults to BRIDGING_SERVER.DEFAULT_PORT_RANGE ([4475, 4575]). Ignored when transportFactory is supplied. */
    portRange?: [number, number];
    /** Substitutes the transport - this is how unit tests avoid a real WebSocketServer. */
    transportFactory?: ServerTransportFactory;
    logLevel?: BridgingServerLogLevel;
    /**
     * When supplied, connecting agents are told authRequired: true and their handshake's
     * payload.authToken is passed here; returning false (or a rejected/false-resolving promise)
     * sends authenticationFailed and closes that connection. Omitted entirely => authRequired: false,
     * and any authToken an agent supplies is ignored.
     */
    validateAuthToken?: (authToken: string | undefined) => boolean | Promise<boolean>;
    /** Sent as hello.payload.authToken, for the connecting agent's own validateBridgeAuthToken to check. */
    authToken?: string;
    /** Per-request-family override of the default response timeout. */
    requestTimeoutsMs?: Partial<Record<BridgingTypes.RequestMessageType, number>>;
    handshakeTimeoutMs?: number;
    intentResultRelayTtlMs?: number;
    /**
     * The connecting client's own per-family await timeout, used only to validate (at construction)
     * that every configured request timeout leaves BRIDGING_SERVER.RESPONSE_HEADROOM_MS of headroom.
     * Defaults to BRIDGING_SERVER.CLIENT_RESPONSE_TIMEOUT_MS (the fdc3-web client's default).
     */
    clientResponseTimeoutMs?: number;
}
