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
import { getTimestamp } from '../helpers/timestamp.helper.js';
import { generateUUID } from '../helpers/uuid.helper.js';

/**
 * Constructs a message sent by this Desktop Agent up to the Bridge (a request, or this agent's
 * response/error-response to a request the Bridge forwarded to it). `destination` is only assigned
 * onto `meta` when supplied, so the constructed object never carries a stray `destination:
 * undefined` key.
 */
export function createBridgeAgentRequest(
    type: BridgingTypes.RequestMessageType,
    payload: Record<string, any>,
    source: BridgingTypes.SourceIdentifier,
    destination?: BridgingTypes.BridgeParticipantIdentifier,
): BridgingTypes.AgentRequestMessage {
    return {
        type,
        payload,
        meta: {
            requestUuid: generateUUID(),
            timestamp: getTimestamp(),
            source,
            ...(destination != null ? { destination } : {}),
        },
    };
}

export function createBridgeAgentResponse(
    type: BridgingTypes.ResponseMessageType,
    payload: Record<string, any>,
    requestUuid: string,
): BridgingTypes.AgentResponseMessage {
    return {
        type,
        payload,
        meta: { requestUuid, responseUuid: generateUUID(), timestamp: getTimestamp() },
    };
}

export function createBridgeAgentErrorResponse(
    type: BridgingTypes.ResponseMessageType,
    error: BridgingTypes.ResponseErrorDetail,
    requestUuid: string,
): BridgingTypes.AgentErrorResponseMessage {
    return {
        type,
        payload: { error },
        meta: { requestUuid, responseUuid: generateUUID(), timestamp: getTimestamp() },
    };
}

export function createHandshakeMessage(
    requestUuid: string,
    payload: BridgingTypes.ConnectionStep3HandshakePayload,
): BridgingTypes.ConnectionStep3Handshake {
    return {
        type: 'handshake',
        payload,
        meta: { requestUuid, timestamp: getTimestamp() },
    };
}
