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
import { AgentRegistry } from '../agent-registry.js';
import { AgentSession } from '../agent-session.js';
import { ChannelsState } from '../channels-state.js';
import { BRIDGING_SERVER } from '../constants.js';
import { Logger } from '../logger.js';
import { createBridgeErrorResponseMessage, createBridgeRequestMessage } from '../message.factory.js';
import {
    isAgentErrorResponseMessage,
    isAgentRequestMessage,
    isAgentResponseMessage,
} from '../type-predicate.helper.js';
import { IntentResultRelay } from './intent-result-relay.js';
import { PendingRequests, RecordedResult } from './pending-requests.js';
import { Route } from './request-routes.js';

/**
 * Routes every post-handshake message on a connected session: responses (dispatched by `type`
 * *before* `requestUuid` is ever consulted - a raiseIntentResultResponse shares its requestUuid with
 * the raiseIntentRequest it follows, and would be swallowed as a duplicate phase-1 response if
 * requestUuid were consulted first) and requests (fanned out or collated per request-routes.ts).
 */
export class MessageRouter {
    constructor(
        private readonly routes: { [K in BridgingTypes.RequestMessageType]: Route },
        private readonly registry: AgentRegistry,
        private readonly channelsState: ChannelsState,
        private readonly pendingRequests: PendingRequests,
        private readonly intentResultRelay: IntentResultRelay,
        private readonly logger: Logger,
    ) {}

    public handle(session: AgentSession, message: unknown): void {
        if (isAgentResponseMessage(message)) {
            this.handleResponse(session, message);
            return;
        }

        if (!isAgentRequestMessage(message)) {
            this.dropMalformed(session, `Dropping unroutable message from ${session.name}`);
            return;
        }

        this.handleRequest(session, message);
    }

    private handleResponse(session: AgentSession, message: BridgingTypes.AgentResponseMessage): void {
        const agentName = session.name as string;
        const result: RecordedResult = isAgentErrorResponseMessage(message)
            ? { err: message.payload.error }
            : { ok: message.payload };

        if (message.type === 'raiseIntentResultResponse') {
            this.intentResultRelay.relay(message.meta.requestUuid, result);
            return;
        }

        this.pendingRequests.recordResponse(message.meta.requestUuid, agentName, result);
    }

    private handleRequest(session: AgentSession, message: BridgingTypes.AgentRequestMessage): void {
        const originator = session.name as string;
        const route = this.routes[message.type];
        const destinationName = message.meta.destination?.desktopAgent;

        if (route.kind === 'fanout') {
            if (route.updatesChannelsState) {
                this.channelsState.applyBroadcast(message.payload.channelId, message.payload.context);
            }

            const recipients =
                destinationName != null ? this.namedSessions([destinationName]) : this.registry.allExcept(originator);

            const forwarded = createBridgeRequestMessage(message, originator, message.meta.destination);
            recipients.forEach(recipient => recipient.connection.send(forwarded));
            return;
        }

        if (destinationName != null && this.registry.getByName(destinationName) == null) {
            session.connection.send(
                createBridgeErrorResponseMessage(
                    route.responseType,
                    'DesktopAgentNotFound',
                    message.meta.requestUuid,
                    [{ desktopAgent: destinationName }],
                    ['DesktopAgentNotFound'],
                ),
            );
            return;
        }

        const recipientSessions =
            destinationName != null ? this.namedSessions([destinationName]) : this.registry.allExcept(originator);
        const recipients = recipientSessions.map(recipient => recipient.name as string);

        const forwarded = createBridgeRequestMessage(message, originator, message.meta.destination);
        recipientSessions.forEach(recipient => recipient.connection.send(forwarded));

        this.pendingRequests.open({
            requestUuid: message.meta.requestUuid,
            route,
            request: message,
            originator,
            recipients,
        });

        // raiseIntent is always schema-targeted (AppDestinationIdentifier.desktopAgent is required),
        // so this is opened at forward time whenever a single target was resolved; a non-compliant
        // caller that omits meta.destination gets no phase-2 relay, since there is no single target
        // to correlate the later raiseIntentResultResponse against.
        if (message.type === 'raiseIntentRequest' && recipients.length === 1) {
            this.intentResultRelay.open(message.meta.requestUuid, originator, recipients[0]);
        }
    }

    private namedSessions(names: string[]): AgentSession[] {
        return names
            .map(name => this.registry.getByName(name))
            .filter((session): session is AgentSession => session != null);
    }

    private dropMalformed(session: AgentSession, reason: string): void {
        this.logger.warn(reason);
        session.parseFailureCount++;

        if (session.parseFailureCount >= BRIDGING_SERVER.MAX_PARSE_FAILURES) {
            this.logger.warn(`Closing connection ${session.connection.id}: too many malformed messages`);
            session.connection.close();
        }
    }
}
