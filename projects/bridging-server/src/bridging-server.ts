/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AgentRegistry } from './agent-registry.js';
import { ChannelsState } from './channels-state.js';
import { ConnectionHandshake } from './connection-handshake.js';
import { BRIDGING_SERVER } from './constants.js';
import { BridgingServerOptions, IServerTransport, Subscription } from './contracts.js';
import { Logger } from './logger.js';
import { IntentResultRelay } from './routing/intent-result-relay.js';
import { MessageRouter } from './routing/message-router.js';
import { PendingRequests } from './routing/pending-requests.js';
import { buildRequestRoutes } from './routing/request-routes.js';
import { WebSocketServerTransport } from './websocket-server-transport.js';

/**
 * Composition root for the FDC3 Desktop Agent Bridge server: wires the connection handshake, the
 * request/response router, and the two correlation tables (PendingRequests for the ordinary
 * request/response families, IntentResultRelay for the later raiseIntentResultResponse) together
 * over one IServerTransport.
 */
export class BridgingServer {
    private readonly transport: IServerTransport;
    private readonly registry = new AgentRegistry();
    private readonly channelsState = new ChannelsState();
    private readonly logger: Logger;
    private readonly pendingRequests: PendingRequests;
    private readonly intentResultRelay: IntentResultRelay;
    private readonly connectionHandshake: ConnectionHandshake;
    private connectionSubscription: Subscription | undefined;

    constructor(options: BridgingServerOptions = {}) {
        const routes = buildRequestRoutes(options.requestTimeoutsMs);
        validateTimeoutHeadroom(routes, options);

        this.logger = new Logger(options.logLevel);
        this.transport =
            options.transportFactory?.() ??
            new WebSocketServerTransport({ host: options.host, portRange: options.portRange });

        this.pendingRequests = new PendingRequests(this.registry, this.logger);
        this.intentResultRelay = new IntentResultRelay(
            this.registry,
            options.intentResultRelayTtlMs ?? BRIDGING_SERVER.INTENT_RESULT_RELAY_TTL_MS,
            this.logger,
        );

        const messageRouter = new MessageRouter(
            routes,
            this.registry,
            this.channelsState,
            this.pendingRequests,
            this.intentResultRelay,
            this.logger,
        );

        this.connectionHandshake = new ConnectionHandshake({
            registry: this.registry,
            channelsState: this.channelsState,
            logger: this.logger,
            handshakeTimeoutMs: options.handshakeTimeoutMs,
            authRequired: options.validateAuthToken != null,
            authToken: options.authToken,
            validateAuthToken: options.validateAuthToken,
            onMessage: (session, message) => messageRouter.handle(session, message),
            onAgentDisconnected: name => {
                this.pendingRequests.handleAgentDisconnected(name);
                this.intentResultRelay.handleAgentDisconnected(name);
            },
        });
    }

    public async start(): Promise<{ port: number }> {
        const { port } = await this.transport.listen();
        this.connectionSubscription = this.transport.onConnection(connection =>
            this.connectionHandshake.attach(connection),
        );
        this.logger.info(`Bridging server listening on port ${port}`);
        return { port };
    }

    public async close(): Promise<void> {
        this.connectionSubscription?.unsubscribe();
        await this.transport.close();
    }
}

/**
 * Turns a misconfigured timeout into a startup failure instead of a mysterious client-side
 * ApiTimeout: every request-family timeout must leave RESPONSE_HEADROOM_MS of headroom under the
 * connecting client's own response timeout, or the bridge's error can never reach the originator
 * before the client gives up waiting.
 */
function validateTimeoutHeadroom(routes: ReturnType<typeof buildRequestRoutes>, options: BridgingServerOptions): void {
    const clientResponseTimeoutMs = options.clientResponseTimeoutMs ?? BRIDGING_SERVER.CLIENT_RESPONSE_TIMEOUT_MS;
    const maxAllowedMs = clientResponseTimeoutMs - BRIDGING_SERVER.RESPONSE_HEADROOM_MS;

    for (const [type, route] of Object.entries(routes)) {
        if (route.kind === 'request' && route.timeoutMs > maxAllowedMs) {
            throw new Error(
                `Configured timeout for '${type}' (${route.timeoutMs}ms) leaves no headroom under the client's ` +
                    `response timeout (${clientResponseTimeoutMs}ms) - it must be <= ${maxAllowedMs}ms.`,
            );
        }
    }
}
