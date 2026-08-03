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
import { BRIDGING_SERVER } from '../constants.js';
import {
    collateFindInstances,
    collateFindIntent,
    collateFindIntentsByContext,
    collateGetAppMetadata,
    collateOpen,
    collateRaiseIntent,
    ResponsePart,
} from './collate.js';

/**
 * broadcastRequest and the six PrivateChannel.* types have no response - they are pure fan-out, sent
 * to every other connected agent (or a single one, when meta.destination is present).
 */
export interface FanoutRoute {
    kind: 'fanout';
    /** broadcastRequest only - PrivateChannel.broadcast must never touch channelsState, since the
     *  handshake schema explicitly excludes private channels from it. */
    updatesChannelsState: boolean;
}

/**
 * The six request/response families. Whether a given message is collated across every other agent
 * or resolved to a single target is a property of the *message* (meta.destination present or not),
 * not of the family - see message-router.ts. Collation over a single recipient degenerates to
 * pass-through-with-stamping, so open/raiseIntent/getAppMetadata need no special-case code here.
 */
export interface RequestRoute {
    kind: 'request';
    responseType: BridgingTypes.ResponseMessageType;
    timeoutMs: number;
    collate: (parts: ResponsePart[], request: BridgingTypes.AgentRequestMessage) => Record<string, any>;
}

export type Route = FanoutRoute | RequestRoute;

/**
 * One exhaustive table, keyed by the full RequestMessageType union - a missing or excess key is a
 * compile error here, in exactly one place. `satisfies` (rather than a type annotation) is what
 * lets each property keep its own precise literal type - e.g. `REQUEST_ROUTES.findIntentRequest` is
 * typed as `RequestRoute`, not the wider `Route` union - while still checking the table's shape
 * against every key of RequestMessageType.
 */
export const REQUEST_ROUTES = {
    findIntentRequest: {
        kind: 'request',
        responseType: 'findIntentResponse',
        timeoutMs: BRIDGING_SERVER.DISCOVERY_TIMEOUT_MS,
        collate: collateFindIntent,
    },
    findIntentsByContextRequest: {
        kind: 'request',
        responseType: 'findIntentsByContextResponse',
        timeoutMs: BRIDGING_SERVER.DISCOVERY_TIMEOUT_MS,
        collate: collateFindIntentsByContext,
    },
    findInstancesRequest: {
        kind: 'request',
        responseType: 'findInstancesResponse',
        timeoutMs: BRIDGING_SERVER.DISCOVERY_TIMEOUT_MS,
        collate: collateFindInstances,
    },
    getAppMetadataRequest: {
        kind: 'request',
        responseType: 'getAppMetadataResponse',
        timeoutMs: BRIDGING_SERVER.DISCOVERY_TIMEOUT_MS,
        collate: collateGetAppMetadata,
    },
    openRequest: {
        kind: 'request',
        responseType: 'openResponse',
        timeoutMs: BRIDGING_SERVER.TARGETED_TIMEOUT_MS,
        collate: collateOpen,
    },
    raiseIntentRequest: {
        kind: 'request',
        responseType: 'raiseIntentResponse',
        timeoutMs: BRIDGING_SERVER.TARGETED_TIMEOUT_MS,
        collate: collateRaiseIntent,
    },
    broadcastRequest: { kind: 'fanout', updatesChannelsState: true },
    'PrivateChannel.broadcast': { kind: 'fanout', updatesChannelsState: false },
    'PrivateChannel.eventListenerAdded': { kind: 'fanout', updatesChannelsState: false },
    'PrivateChannel.eventListenerRemoved': { kind: 'fanout', updatesChannelsState: false },
    'PrivateChannel.onAddContextListener': { kind: 'fanout', updatesChannelsState: false },
    'PrivateChannel.onDisconnect': { kind: 'fanout', updatesChannelsState: false },
    'PrivateChannel.onUnsubscribe': { kind: 'fanout', updatesChannelsState: false },
} satisfies { [K in BridgingTypes.RequestMessageType]: Route };

/** Builds a per-instance route table, applying any per-family timeout overrides over the defaults
 *  above. Returns the shared default table object unchanged when no overrides are supplied. */
export function buildRequestRoutes(overrides?: Partial<Record<BridgingTypes.RequestMessageType, number>>): {
    [K in BridgingTypes.RequestMessageType]: Route;
} {
    if (overrides == null) {
        return REQUEST_ROUTES;
    }

    // widened back to the general per-key Route type deliberately - REQUEST_ROUTES itself keeps its
    // precise satisfies-narrowed type for ergonomic direct access (e.g. REQUEST_ROUTES.openRequest),
    // but this working copy is heterogeneously overwritten below and must not be narrowed per key.
    const result: { [K in BridgingTypes.RequestMessageType]: Route } = { ...REQUEST_ROUTES };

    for (const [type, timeoutMs] of Object.entries(overrides)) {
        const existing = result[type as BridgingTypes.RequestMessageType];

        if (existing.kind === 'request' && timeoutMs != null) {
            result[type as BridgingTypes.RequestMessageType] = { ...existing, timeoutMs };
        }
    }

    return result;
}
