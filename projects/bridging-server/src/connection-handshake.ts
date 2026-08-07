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
import { randomUUID } from 'node:crypto';
import { AgentRegistry } from './agent-registry.js';
import { AgentSession, createAgentSession } from './agent-session.js';
import { ChannelsState } from './channels-state.js';
import { BRIDGING_SERVER } from './constants.js';
import { IAgentConnection } from './contracts.js';
import { Logger } from './logger.js';
import {
    createAuthenticationFailedMessage,
    createConnectedAgentsUpdateMessage,
    createHelloMessage,
} from './message.factory.js';
import { isHandshakeMessage } from './type-predicate.helper.js';

export interface ConnectionHandshakeParams {
    registry: AgentRegistry;
    channelsState: ChannelsState;
    logger: Logger;
    handshakeTimeoutMs?: number;
    /** Whether hello.payload.authRequired is advertised - true iff validateAuthToken is supplied. */
    authRequired: boolean;
    /** Sent as hello.payload.authToken, for the connecting agent's own validateBridgeAuthToken. */
    authToken?: string;
    /** Validates handshake.payload.authToken. Omitted => no validation, any handshake is accepted. */
    validateAuthToken?: (authToken: string | undefined) => boolean | Promise<boolean>;
    /** Called for every message once the session is past the handshake. */
    onMessage: (session: AgentSession, message: unknown) => void;
    onAgentConnected?: (name: string) => void;
    onAgentDisconnected?: (name: string) => void;
}

/**
 * Owns FDC3 Desktop Agent Bridging connection steps 2-6 for one connection: sends `hello`
 * unprompted, awaits `handshake` within a timeout, validates auth, allocates a name, merges
 * channelsState, and broadcasts `connectedAgentsUpdate` on join and on departure. Everything after
 * the handshake is handed off to `onMessage`, which is where request/response routing lives (see
 * message-router.ts).
 */
export class ConnectionHandshake {
    private readonly handshakeTimeoutMs: number;

    constructor(private readonly params: ConnectionHandshakeParams) {
        this.handshakeTimeoutMs = params.handshakeTimeoutMs ?? BRIDGING_SERVER.HANDSHAKE_TIMEOUT_MS;
    }

    public attach(connection: IAgentConnection): void {
        const session = createAgentSession(connection);
        this.params.registry.add(session);

        connection.send(
            createHelloMessage({ authRequired: this.params.authRequired, authToken: this.params.authToken }),
        );

        // Required: the client's per-port connect budget is 750ms, so a client whose timer expires
        // just as `hello` lands can abandon the socket without ever handshaking. Without this timer
        // such sockets accumulate for the process lifetime.
        session.handshakeTimer = setTimeout(() => {
            this.params.logger.warn(
                `Closing connection ${connection.id}: no handshake received within ${this.handshakeTimeoutMs}ms`,
            );
            connection.close();
        }, this.handshakeTimeoutMs);

        connection.subscribe(message => this.onMessage(session, message));
        connection.onClose(() => this.onClose(session));
    }

    private onMessage(session: AgentSession, message: unknown): void {
        if (session.state === 'awaiting-handshake') {
            if (isHandshakeMessage(message)) {
                void this.handleHandshake(session, message);
            } else {
                this.dropMalformed(
                    session,
                    `Dropping message from ${session.connection.id} before handshake completed`,
                );
            }
            return;
        }

        // A second `handshake` (or any other unroutable type) on an already-connected socket falls
        // through to onMessage's own "not a request/response" drop+WARN - re-assigning a name
        // mid-flight would corrupt every outstanding correlation, so it must never be actioned here.
        this.params.onMessage(session, message);
    }

    /**
     * Covers unparseable JSON (delivered as `undefined` by the transport's parseBridgeMessage) as
     * well as a structurally-invalid message received before the handshake completes - neither can
     * be responded to (no requestUuid to correlate against). Closes the socket once
     * MAX_PARSE_FAILURES consecutive failures accumulate, to shed a broken or hostile peer.
     */
    private dropMalformed(session: AgentSession, reason: string): void {
        this.params.logger.warn(reason);
        session.parseFailureCount++;

        if (session.parseFailureCount >= BRIDGING_SERVER.MAX_PARSE_FAILURES) {
            this.params.logger.warn(`Closing connection ${session.connection.id}: too many malformed messages`);
            session.connection.close();
        }
    }

    private async handleHandshake(
        session: AgentSession,
        message: BridgingTypes.ConnectionStep3Handshake,
    ): Promise<void> {
        if (session.handshakeTimer != null) {
            clearTimeout(session.handshakeTimer);
            session.handshakeTimer = undefined;
        }

        if (this.params.validateAuthToken != null) {
            const isValid = await this.params.validateAuthToken(message.payload.authToken);

            if (!isValid) {
                session.connection.send(
                    createAuthenticationFailedMessage(message.meta.requestUuid, 'Invalid authentication token'),
                );
                session.connection.close();
                return;
            }
        }

        const name = this.params.registry.register(
            session,
            message.payload.requestedName,
            message.payload.implementationMetadata,
        );

        this.params.channelsState.mergeFromHandshake(message.payload.channelsState);

        const roster = this.params.registry.roster();

        session.connection.send(
            createConnectedAgentsUpdateMessage({
                requestUuid: message.meta.requestUuid,
                allAgents: roster,
                addAgent: name,
                channelsState: this.params.channelsState.toWireFormat(),
            }),
        );

        const updateForOthers = createConnectedAgentsUpdateMessage({
            requestUuid: message.meta.requestUuid,
            allAgents: roster,
            addAgent: name,
        });

        this.params.registry.allExcept(name).forEach(other => other.connection.send(updateForOthers));

        this.params.logger.info(`Agent connected: ${name} (${session.connection.id})`);
        this.params.onAgentConnected?.(name);
    }

    private onClose(session: AgentSession): void {
        if (session.handshakeTimer != null) {
            clearTimeout(session.handshakeTimer);
        }

        this.params.registry.remove(session);

        if (session.state === 'connected' && session.name != null) {
            const name = session.name;
            const update = createConnectedAgentsUpdateMessage({
                requestUuid: randomUUID(),
                allAgents: this.params.registry.roster(),
                removeAgent: name,
            });

            this.params.registry.allExcept(name).forEach(other => other.connection.send(update));

            this.params.logger.info(`Agent disconnected: ${name} (${session.connection.id})`);
            this.params.onAgentDisconnected?.(name);
        }
    }
}
