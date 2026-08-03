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
import { BRIDGING_SERVER } from './constants.js';

export function createHelloMessage(params: {
    authRequired: boolean;
    authToken?: string;
}): BridgingTypes.ConnectionStep2Hello {
    return {
        type: 'hello',
        payload: {
            desktopAgentBridgeVersion: BRIDGING_SERVER.DESKTOP_AGENT_BRIDGE_VERSION,
            supportedFDC3Versions: BRIDGING_SERVER.SUPPORTED_FDC3_VERSIONS,
            authRequired: params.authRequired,
            ...(params.authToken != null ? { authToken: params.authToken } : {}),
        },
        meta: { timestamp: new Date() },
    };
}

/**
 * payload is always a real object (never omitted): the fdc3-web client dereferences
 * `message.payload.message` unconditionally inside a voided async handler - an absent payload
 * throws an unhandled rejection there and wedges the client on that port permanently.
 */
export function createAuthenticationFailedMessage(
    requestUuid: string,
    message?: string,
): BridgingTypes.ConnectionStep4AuthenticationFailed {
    return {
        type: 'authenticationFailed',
        payload: message != null ? { message } : {},
        meta: { requestUuid, responseUuid: randomUUID(), timestamp: new Date() },
    };
}

export function createConnectedAgentsUpdateMessage(params: {
    requestUuid: string;
    allAgents: BridgingTypes.DesktopAgentImplementationMetadata[];
    addAgent?: string;
    removeAgent?: string;
    channelsState?: Record<string, BridgingTypes.Context[]>;
}): BridgingTypes.ConnectionStep6ConnectedAgentsUpdate {
    return {
        type: 'connectedAgentsUpdate',
        payload: {
            allAgents: params.allAgents,
            ...(params.addAgent != null ? { addAgent: params.addAgent } : {}),
            ...(params.removeAgent != null ? { removeAgent: params.removeAgent } : {}),
            ...(params.channelsState != null ? { channelsState: params.channelsState } : {}),
        },
        meta: { requestUuid: params.requestUuid, responseUuid: randomUUID(), timestamp: new Date() },
    };
}

/**
 * Forwards an inbound AgentRequestMessage on to another agent. meta is rebuilt from scratch rather
 * than spread from the original request - this is what guarantees meta.source.desktopAgent is
 * always the bridge-assigned name (never an agent-supplied value, which would be an impersonation
 * vector) and prevents a stale agent-supplied field leaking onto the forwarded message.
 */
export function createBridgeRequestMessage(
    request: BridgingTypes.AgentRequestMessage,
    sourceDesktopAgent: string,
    destination?: BridgingTypes.BridgeParticipantIdentifier,
): BridgingTypes.BridgeRequestMessage {
    return {
        type: request.type,
        payload: request.payload,
        meta: {
            requestUuid: request.meta.requestUuid,
            timestamp: new Date(),
            source: { ...request.meta.source, desktopAgent: sourceDesktopAgent },
            ...(destination != null ? { destination } : {}),
        },
    };
}

export function createBridgeResponseMessage(
    type: BridgingTypes.ResponseMessageType,
    payload: Record<string, any>,
    requestUuid: string,
    collation?: {
        sources?: BridgingTypes.DesktopAgentIdentifier[];
        errorSources?: BridgingTypes.DesktopAgentIdentifier[];
        errorDetails?: BridgingTypes.ResponseErrorDetail[];
    },
): BridgingTypes.BridgeResponseMessage {
    return {
        type,
        payload,
        meta: {
            requestUuid,
            responseUuid: randomUUID(),
            timestamp: new Date(),
            ...(collation?.sources != null && collation.sources.length > 0 ? { sources: collation.sources } : {}),
            ...(collation?.errorSources != null && collation.errorSources.length > 0
                ? { errorSources: collation.errorSources }
                : {}),
            ...(collation?.errorDetails != null && collation.errorDetails.length > 0
                ? { errorDetails: collation.errorDetails }
                : {}),
        },
    };
}

export function createBridgeErrorResponseMessage(
    type: BridgingTypes.ResponseMessageType,
    error: BridgingTypes.ResponseErrorDetail,
    requestUuid: string,
    errorSources: BridgingTypes.DesktopAgentIdentifier[],
    errorDetails: BridgingTypes.ResponseErrorDetail[],
): BridgingTypes.BridgeErrorResponseMessage {
    return {
        type,
        payload: { error },
        meta: { requestUuid, responseUuid: randomUUID(), timestamp: new Date(), errorSources, errorDetails },
    };
}
