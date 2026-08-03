/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

/* istanbul ignore file */
// exhaustive-switch guards below are compile-time safety nets - not all branches are reachable in tests

import { BridgingTypes } from '@finos/fdc3';

function neverCheck(_value: never): false {
    return false;
}

export function isRequestMessageType(value: any): value is BridgingTypes.RequestMessageType {
    const type: BridgingTypes.RequestMessageType = value;

    switch (type) {
        case 'broadcastRequest':
        case 'findInstancesRequest':
        case 'findIntentRequest':
        case 'findIntentsByContextRequest':
        case 'getAppMetadataRequest':
        case 'openRequest':
        case 'PrivateChannel.broadcast':
        case 'PrivateChannel.eventListenerAdded':
        case 'PrivateChannel.eventListenerRemoved':
        case 'PrivateChannel.onAddContextListener':
        case 'PrivateChannel.onDisconnect':
        case 'PrivateChannel.onUnsubscribe':
        case 'raiseIntentRequest':
            return true;
        default:
            return neverCheck(type);
    }
}

export function isResponseMessageType(value: any): value is BridgingTypes.ResponseMessageType {
    const type: BridgingTypes.ResponseMessageType = value;

    switch (type) {
        case 'findInstancesResponse':
        case 'findIntentResponse':
        case 'findIntentsByContextResponse':
        case 'getAppMetadataResponse':
        case 'openResponse':
        case 'raiseIntentResponse':
        case 'raiseIntentResultResponse':
            return true;
        default:
            return neverCheck(type);
    }
}

/**
 * A message from a Desktop Agent to the Bridge, requesting an FDC3 API call be routed to (or
 * collated across) the other connected agents. Unlike the client's isBridgeRequestMessage, this
 * does NOT require meta.source.desktopAgent - AgentRequestMetadata.source is fully optional per
 * schema, and it is the bridge's job to stamp meta.source.desktopAgent on the way out, not the
 * agent's job to supply it on the way in.
 */
export function isAgentRequestMessage(value: any): value is BridgingTypes.AgentRequestMessage {
    const message = value as BridgingTypes.AgentRequestMessage;

    return (
        message != null &&
        typeof message.payload === 'object' &&
        message.payload != null &&
        isRequestMessageType(message.type) &&
        typeof message.meta?.requestUuid === 'string' &&
        message.meta?.timestamp instanceof Date
    );
}

/**
 * A response from a Desktop Agent to the Bridge, either to a request the bridge forwarded to it, or
 * (for raiseIntentResultResponse) an unsolicited follow-up correlated by the original
 * raiseIntentRequest's requestUuid. Success and error responses share this same shape - the only
 * discriminator is whether payload.error is a string, see isAgentErrorResponseMessage.
 */
export function isAgentResponseMessage(value: any): value is BridgingTypes.AgentResponseMessage {
    const message = value as BridgingTypes.AgentResponseMessage;

    return (
        message != null &&
        typeof message.payload === 'object' &&
        message.payload != null &&
        isResponseMessageType(message.type) &&
        typeof message.meta?.requestUuid === 'string' &&
        typeof message.meta?.responseUuid === 'string' &&
        message.meta?.timestamp instanceof Date
    );
}

export function isAgentErrorResponseMessage(value: any): value is BridgingTypes.AgentErrorResponseMessage {
    return isAgentResponseMessage(value) && typeof (value as any).payload?.error === 'string';
}

/**
 * Handshake message sent by a Desktop Agent to the Bridge (step 3). meta has no source (the
 * connection itself is the source), unlike every other request/response family.
 */
export function isHandshakeMessage(value: any): value is BridgingTypes.ConnectionStep3Handshake {
    const message = value as BridgingTypes.ConnectionStep3Handshake;

    return (
        message?.type === 'handshake' &&
        typeof message.meta?.requestUuid === 'string' &&
        typeof message.payload?.requestedName === 'string' &&
        message.payload?.implementationMetadata != null &&
        message.payload?.channelsState != null &&
        typeof message.payload.channelsState === 'object'
    );
}

/**
 * Shallow FDC3 Context shape check - only `type` is required. Deliberately not a deep schema
 * validation: the destination agent is the authority on payload semantics (see
 * BRIDGING_SERVER_DESIGN.md#Edge-cases - "Payload validation stays shallow").
 */
export function isContextLike(value: any): value is { type: string } {
    return value != null && typeof value === 'object' && typeof value.type === 'string';
}
