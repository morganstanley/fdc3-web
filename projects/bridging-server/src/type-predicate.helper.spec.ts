/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it } from 'vitest';
import {
    isAgentErrorResponseMessage,
    isAgentRequestMessage,
    isAgentResponseMessage,
    isContextLike,
    isHandshakeMessage,
    isRequestMessageType,
    isResponseMessageType,
} from './type-predicate.helper.js';

describe(`isRequestMessageType`, () => {
    const validTypes = [
        'broadcastRequest',
        'findInstancesRequest',
        'findIntentRequest',
        'findIntentsByContextRequest',
        'getAppMetadataRequest',
        'openRequest',
        'PrivateChannel.broadcast',
        'PrivateChannel.eventListenerAdded',
        'PrivateChannel.eventListenerRemoved',
        'PrivateChannel.onAddContextListener',
        'PrivateChannel.onDisconnect',
        'PrivateChannel.onUnsubscribe',
        'raiseIntentRequest',
    ];

    it.each(validTypes)(`should return true for '%s'`, type => {
        expect(isRequestMessageType(type)).toBe(true);
    });

    it(`should return false for an unknown type`, () => {
        expect(isRequestMessageType('somethingElse')).toBe(false);
    });

    it(`should return false for a response type`, () => {
        expect(isRequestMessageType('findIntentResponse')).toBe(false);
    });
});

describe(`isResponseMessageType`, () => {
    const validTypes = [
        'findInstancesResponse',
        'findIntentResponse',
        'findIntentsByContextResponse',
        'getAppMetadataResponse',
        'openResponse',
        'raiseIntentResponse',
        'raiseIntentResultResponse',
    ];

    it.each(validTypes)(`should return true for '%s'`, type => {
        expect(isResponseMessageType(type)).toBe(true);
    });

    it(`should return false for an unknown type`, () => {
        expect(isResponseMessageType('somethingElse')).toBe(false);
    });
});

describe(`isAgentRequestMessage`, () => {
    it(`should return true for a minimal valid request with no meta.source`, () => {
        expect(
            isAgentRequestMessage({
                type: 'findIntentRequest',
                payload: { intent: 'ViewChart' },
                meta: { requestUuid: 'uuid-1', timestamp: new Date() },
            }),
        ).toBe(true);
    });

    it(`should return false when payload is missing`, () => {
        expect(
            isAgentRequestMessage({ type: 'findIntentRequest', meta: { requestUuid: 'u', timestamp: new Date() } }),
        ).toBe(false);
    });

    it(`should return false when meta.timestamp is not a Date`, () => {
        expect(
            isAgentRequestMessage({
                type: 'findIntentRequest',
                payload: {},
                meta: { requestUuid: 'u', timestamp: '2024-01-01' },
            }),
        ).toBe(false);
    });

    it(`should return false when type is not a request type`, () => {
        expect(
            isAgentRequestMessage({
                type: 'findIntentResponse',
                payload: {},
                meta: { requestUuid: 'u', timestamp: new Date() },
            }),
        ).toBe(false);
    });

    it(`should return false for null`, () => {
        expect(isAgentRequestMessage(null)).toBe(false);
    });
});

describe(`isAgentResponseMessage`, () => {
    it(`should return true for a valid response`, () => {
        expect(
            isAgentResponseMessage({
                type: 'findIntentResponse',
                payload: { appIntent: { apps: [] } },
                meta: { requestUuid: 'u', responseUuid: 'r', timestamp: new Date() },
            }),
        ).toBe(true);
    });

    it(`should return false when responseUuid is missing`, () => {
        expect(
            isAgentResponseMessage({
                type: 'findIntentResponse',
                payload: {},
                meta: { requestUuid: 'u', timestamp: new Date() },
            }),
        ).toBe(false);
    });
});

describe(`isAgentErrorResponseMessage`, () => {
    it(`should return true when payload.error is a string`, () => {
        expect(
            isAgentErrorResponseMessage({
                type: 'findIntentResponse',
                payload: { error: 'NoAppsFound' },
                meta: { requestUuid: 'u', responseUuid: 'r', timestamp: new Date() },
            }),
        ).toBe(true);
    });

    it(`should return false when payload.error is absent`, () => {
        expect(
            isAgentErrorResponseMessage({
                type: 'findIntentResponse',
                payload: { appIntent: { apps: [] } },
                meta: { requestUuid: 'u', responseUuid: 'r', timestamp: new Date() },
            }),
        ).toBe(false);
    });
});

describe(`isHandshakeMessage`, () => {
    it(`should return true for a valid handshake`, () => {
        expect(
            isHandshakeMessage({
                type: 'handshake',
                payload: {
                    requestedName: 'AgentA',
                    implementationMetadata: { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} },
                    channelsState: {},
                },
                meta: { requestUuid: 'u', timestamp: new Date() },
            }),
        ).toBe(true);
    });

    it(`should return false when requestedName is missing`, () => {
        expect(
            isHandshakeMessage({
                type: 'handshake',
                payload: { implementationMetadata: {}, channelsState: {} },
                meta: { requestUuid: 'u', timestamp: new Date() },
            }),
        ).toBe(false);
    });

    it(`should return false for a non-handshake type`, () => {
        expect(isHandshakeMessage({ type: 'hello', payload: {}, meta: {} })).toBe(false);
    });

    it(`should return false when channelsState is missing`, () => {
        expect(
            isHandshakeMessage({
                type: 'handshake',
                payload: { requestedName: 'AgentA', implementationMetadata: {} },
                meta: { requestUuid: 'u', timestamp: new Date() },
            }),
        ).toBe(false);
    });
});

describe(`isContextLike`, () => {
    it(`should return true when type is a string`, () => {
        expect(isContextLike({ type: 'fdc3.contact' })).toBe(true);
    });

    it(`should return false when type is missing`, () => {
        expect(isContextLike({})).toBe(false);
    });

    it(`should return false for null`, () => {
        expect(isContextLike(null)).toBe(false);
    });

    it(`should return false for a non-object`, () => {
        expect(isContextLike('fdc3.contact')).toBe(false);
    });
});
