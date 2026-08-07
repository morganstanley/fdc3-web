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

import type { BridgingTypes } from '@finos/fdc3';
import { neverCheck } from './finos-type-predicate.helper.js';

/**
 * Identifies the type of the message and it is typically set to the FDC3 function name that the
 * message relates to, e.g. 'findIntent', with 'Request' appended.
 */
export function isBridgingRequestMessageType(value: any): value is BridgingTypes.RequestMessageType {
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

export function isBridgingResponseMessageType(value: any): value is BridgingTypes.ResponseMessageType {
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
 * A request message forwarded from the Bridge onto a Desktop Agent connected to it (or, over the
 * same shape, sent by a Desktop Agent up to the Bridge). meta.source.desktopAgent is required by
 * the schema in both directions, so its presence is part of the shape check.
 */
export function isBridgeRequestMessage(value: any): value is BridgingTypes.BridgeRequestMessage {
    const message = value as BridgingTypes.BridgeRequestMessage;

    return (
        message != null &&
        typeof message.payload === 'object' &&
        isBridgingRequestMessageType(message.type) &&
        typeof message.meta?.requestUuid === 'string' &&
        message.meta?.timestamp instanceof Date &&
        typeof (message.meta?.source as BridgingTypes.BridgeParticipantIdentifier | undefined)?.desktopAgent ===
            'string'
    );
}

/**
 * A response message that contains an error, to be used in preference to the standard response
 * when an error needs to be returned. Success and error responses share the same `type` value, so
 * `payload.error` being a string is the only reliable discriminator.
 */
export function isBridgeErrorResponseMessage(value: any): value is BridgingTypes.BridgeErrorResponseMessage {
    const message = value as BridgingTypes.BridgeErrorResponseMessage;

    return (
        message != null &&
        typeof message.payload === 'object' &&
        typeof message.payload?.error === 'string' &&
        isBridgingResponseMessageType(message.type) &&
        typeof message.meta?.requestUuid === 'string' &&
        typeof message.meta?.responseUuid === 'string' &&
        message.meta?.timestamp instanceof Date
    );
}

/**
 * A (successful) response message from the Bridge back to the original Desktop Agent that raised
 * the request, possibly collated from multiple connected agents.
 */
export function isBridgeResponseMessage(value: any): value is BridgingTypes.BridgeResponseMessage {
    const message = value as BridgingTypes.BridgeResponseMessage;

    return (
        message != null &&
        typeof message.payload === 'object' &&
        isBridgingResponseMessageType(message.type) &&
        typeof message.meta?.requestUuid === 'string' &&
        typeof message.meta?.responseUuid === 'string' &&
        message.meta?.timestamp instanceof Date &&
        !isBridgeErrorResponseMessage(value)
    );
}

/**
 * Handshake Messages (https://fdc3.finos.org/docs/agent-bridging/spec)
 */

export function isBridgingHello(value: any): value is BridgingTypes.ConnectionStep2Hello {
    const message = value as BridgingTypes.ConnectionStep2Hello;

    return message?.type === 'hello' && typeof message.payload?.desktopAgentBridgeVersion === 'string';
}

export function isBridgingAuthenticationFailed(value: any): value is BridgingTypes.ConnectionStep4AuthenticationFailed {
    return (value as BridgingTypes.ConnectionStep4AuthenticationFailed)?.type === 'authenticationFailed';
}

export function isBridgingConnectedAgentsUpdate(
    value: any,
): value is BridgingTypes.ConnectionStep6ConnectedAgentsUpdate {
    const message = value as BridgingTypes.ConnectionStep6ConnectedAgentsUpdate;

    return message?.type === 'connectedAgentsUpdate' && Array.isArray(message.payload?.allAgents);
}

/**
 * Per-family Bridge response predicates, used by the message correlator to route a settled
 * response to the right waiting caller.
 */

export function isFindIntentBridgeResponse(value: any): value is BridgingTypes.FindIntentBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'findIntentResponse';
}

export function isFindIntentsByContextBridgeResponse(
    value: any,
): value is BridgingTypes.FindIntentsByContextBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'findIntentsByContextResponse';
}

export function isFindInstancesBridgeResponse(value: any): value is BridgingTypes.FindInstancesBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'findInstancesResponse';
}

export function isGetAppMetadataBridgeResponse(value: any): value is BridgingTypes.GetAppMetadataBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'getAppMetadataResponse';
}

export function isOpenBridgeResponse(value: any): value is BridgingTypes.OpenBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'openResponse';
}

export function isRaiseIntentBridgeResponse(value: any): value is BridgingTypes.RaiseIntentBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'raiseIntentResponse';
}

export function isRaiseIntentResultBridgeResponse(value: any): value is BridgingTypes.RaiseIntentResultBridgeResponse {
    return isBridgeResponseMessage(value) && value.type === 'raiseIntentResultResponse';
}

export function isRaiseIntentResultError(value: any): value is BridgingTypes.RaiseIntentResultErrorMessage {
    const error: BridgingTypes.RaiseIntentResultErrorMessage = value;

    switch (error) {
        case 'IntentHandlerRejected':
        case 'NoResultReturned':
        case 'ApiTimeout':
        case 'AgentDisconnected':
        case 'NotConnectedToBridge':
        case 'ResponseToBridgeTimedOut':
        case 'MalformedMessage':
            return true;
        default:
            return neverCheck(error);
    }
}
