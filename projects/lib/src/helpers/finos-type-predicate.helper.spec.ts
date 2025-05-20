/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it, vi } from 'vitest';
import * as typePredicates from './finos-type-predicate.helper.js';

const defaultInvalidValues: unknown[] = ['', 'simpleString', [], {}, null, undefined];
const mockDate = new Date();

describe('finos-type-predicate.helper', () => {
    // Request message type tests
    it('should identify valid request message types', () => {
        // Sample all request message types
        const validTypes = [
            'addContextListenerRequest',
            'addEventListenerRequest',
            'addIntentListenerRequest',
            'broadcastRequest',
            'contextListenerUnsubscribeRequest',
            'createPrivateChannelRequest',
            'raiseIntentRequest',
            'heartbeatAcknowledgementRequest',
        ];

        validTypes.forEach(type => {
            expect(typePredicates.isRequestMessageType(type)).toBe(true);
        });
    });

    it('should reject invalid request message types', () => {
        expect(typePredicates.isRequestMessageType('invalidType')).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isRequestMessageType(value)).toBe(false);
        });
    });

    // App request message tests
    it('should identify valid app request messages', () => {
        const validAppRequestMessage = {
            type: 'broadcastRequest',
            meta: {
                requestUuid: '1234-5678',
                timestamp: mockDate,
            },
            payload: {},
        };

        expect(typePredicates.isAppRequestMessage(validAppRequestMessage)).toBe(true);
    });

    it('should reject invalid app request messages', () => {
        const invalidAppRequestMessages = [
            { type: 'broadcastRequest', meta: {}, payload: {} },
            { type: 'broadcastRequest', meta: { requestUuid: '1234' }, payload: {} },
            { type: 'broadcastRequest', meta: { timestamp: mockDate }, payload: {} },
            { type: 'invalidType', meta: { requestUuid: '1234', timestamp: mockDate }, payload: {} },
            { meta: { requestUuid: '1234', timestamp: mockDate }, payload: {} },
        ];

        invalidAppRequestMessages.forEach(msg => {
            expect(typePredicates.isAppRequestMessage(msg)).toBe(false);
        });

        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isAppRequestMessage(value)).toBe(false);
        });
    });

    // App response message tests
    it('should identify valid app response messages', () => {
        const validAppResponseMessage = {
            type: 'broadcastResponse',
            meta: {
                requestUuid: '1234-5678',
                responseUuid: '8765-4321',
                timestamp: mockDate,
            },
            payload: {},
        };

        expect(typePredicates.isAppResponseMessage(validAppResponseMessage)).toBe(true);
    });

    it('should reject invalid app response messages', () => {
        const invalidAppResponseMessages = [
            { type: 'broadcastResponse', meta: {}, payload: {} },
            { type: 'broadcastResponse', meta: { requestUuid: '1234', timestamp: mockDate }, payload: {} },
            { type: 'broadcastResponse', meta: { responseUuid: '4321', timestamp: mockDate }, payload: {} },
            { meta: { requestUuid: '1234', responseUuid: '4321', timestamp: mockDate }, payload: {} },
        ];

        invalidAppResponseMessages.forEach(msg => {
            expect(typePredicates.isAppResponseMessage(msg)).toBe(false);
        });

        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isAppResponseMessage(value)).toBe(false);
        });
    });

    // App event message tests
    it('should identify valid app event messages', () => {
        const validAppEventMessage = {
            type: 'broadcastEvent',
            meta: {
                eventUuid: '1234-5678',
                timestamp: mockDate,
            },
            payload: {},
        };

        expect(typePredicates.isAppEventMessage(validAppEventMessage)).toBe(true);
    });

    it('should reject invalid app event messages', () => {
        const invalidAppEventMessages = [
            { type: 'broadcastEvent', meta: {}, payload: {} },
            { type: 'broadcastEvent', meta: { timestamp: mockDate }, payload: {} },
            { type: 'broadcastEvent', meta: { eventUuid: '1234' }, payload: {} },
            { meta: { eventUuid: '1234', timestamp: mockDate }, payload: {} },
        ];

        invalidAppEventMessages.forEach(msg => {
            expect(typePredicates.isAppEventMessage(msg)).toBe(false);
        });

        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isAppEventMessage(value)).toBe(false);
        });
    });

    // Private channel event tests
    it('should identify valid private channel events', () => {
        const validPrivateChannelEvents = [
            {
                type: 'privateChannelOnAddContextListenerEvent',
                meta: { eventUuid: '1234', timestamp: mockDate },
                payload: {},
            },
            {
                type: 'privateChannelOnUnsubscribeEvent',
                meta: { eventUuid: '1234', timestamp: mockDate },
                payload: {},
            },
            {
                type: 'privateChannelOnDisconnectEvent',
                meta: { eventUuid: '1234', timestamp: mockDate },
                payload: {},
            },
        ];

        validPrivateChannelEvents.forEach(event => {
            expect(typePredicates.isPrivateChannelEvent(event)).toBe(true);
        });
    });

    it('should reject invalid private channel events', () => {
        const invalidPrivateChannelEvent = {
            type: 'otherEvent',
            meta: { eventUuid: '1234', timestamp: mockDate },
            payload: {},
        };

        expect(typePredicates.isPrivateChannelEvent(invalidPrivateChannelEvent)).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isPrivateChannelEvent(value)).toBe(false);
        });
    });

    // Response payload error tests
    it('should identify valid response payload errors', () => {
        const validErrors = [
            'ApiTimeout',
            'AccessDenied',
            'CreationFailed',
            'MalformedContext',
            'NoChannelFound',
            'AppNotFound',
        ];

        validErrors.forEach(error => {
            expect(typePredicates.isResponsePayloadError(error)).toBe(true);
        });
    });

    it('should reject invalid response payload errors', () => {
        expect(typePredicates.isResponsePayloadError('InvalidError')).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isResponsePayloadError(value)).toBe(false);
        });
    });

    // Find instances errors tests
    it('should identify valid find instances errors', () => {
        const validErrors = ['ApiTimeout', 'MalformedContext', 'DesktopAgentNotFound', 'ResolverUnavailable'];

        validErrors.forEach(error => {
            expect(typePredicates.isFindInstancesErrors(error)).toBe(true);
        });
    });

    it('should reject invalid find instances errors', () => {
        expect(typePredicates.isFindInstancesErrors('InvalidError')).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isFindInstancesErrors(value)).toBe(false);
        });
    });

    // Open error tests
    it('should identify valid open errors', () => {
        const validErrors = ['ApiTimeout', 'AgentDisconnected', 'AppNotFound', 'AppTimeout'];

        validErrors.forEach(error => {
            expect(typePredicates.isOpenError(error)).toBe(true);
        });
    });

    it('should reject invalid open errors', () => {
        expect(typePredicates.isOpenError('InvalidError')).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isOpenError(value)).toBe(false);
        });
    });

    // Private channel event types tests
    it('should identify valid private channel event types', () => {
        const validTypes = ['addContextListener', 'unsubscribe', 'disconnect'];

        validTypes.forEach(type => {
            expect(typePredicates.isPrivateChannelEventTypes(type)).toBe(true);
        });
    });

    it('should reject invalid private channel event types', () => {
        expect(typePredicates.isPrivateChannelEventTypes('invalidType')).toBe(false);
        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isPrivateChannelEventTypes(value)).toBe(false);
        });
    });

    // Private channel tests
    it('should identify valid private channels', () => {
        const validPrivateChannel = {
            id: 'channel-id',
            type: 'private',
            disconnect: vi.fn(),
            addEventListener: vi.fn(),
            addContextListener: vi.fn(),
            broadcast: vi.fn(),
            getCurrentContext: vi.fn(),
        };

        expect(typePredicates.isPrivateChannel(validPrivateChannel)).toBe(true);
    });

    it('should reject invalid private channels', () => {
        const invalidPrivateChannels = [
            { id: 'channel-id', type: 'app' },
            { id: 'channel-id', type: 'private' }, // missing methods
            { type: 'private', disconnect: vi.fn() }, // missing id
            { id: 'channel-id', type: 'private', disconnect: 'not-a-function' },
        ];

        invalidPrivateChannels.forEach(channel => {
            expect(typePredicates.isPrivateChannel(channel)).toBe(false);
        });

        defaultInvalidValues.forEach(value => {
            expect(typePredicates.isPrivateChannel(value)).toBe(false);
        });
    });

    // WCP message tests
    it('should identify valid WCP Hello messages', () => {
        const validMessage = { type: 'WCP1Hello' };
        expect(typePredicates.isWCPHelloMessage(validMessage)).toBe(true);
    });

    it('should identify valid WCP Success Response messages', () => {
        const validMessage = { type: 'WCP5ValidateAppIdentityResponse' };
        expect(typePredicates.isWCPSuccessResponse(validMessage)).toBe(true);
    });

    it('should identify valid WCP Validate App Identity messages', () => {
        const validMessage = { type: 'WCP4ValidateAppIdentity' };
        expect(typePredicates.isWCPValidateAppIdentity(validMessage)).toBe(true);
    });

    it('should identify valid WCP Handshake messages', () => {
        const validMessage = { type: 'WCP3Handshake' };
        expect(typePredicates.isWCPHandshake(validMessage)).toBe(true);
    });

    // Specific request message type tests
    const requestMessageTypes = [
        { func: typePredicates.isBroadcastRequest, type: 'broadcastRequest' },
        { func: typePredicates.isRaiseIntentRequest, type: 'raiseIntentRequest' },
        { func: typePredicates.isGetCurrentChannelRequest, type: 'getCurrentChannelRequest' },
        { func: typePredicates.isAddIntentListenerRequest, type: 'addIntentListenerRequest' },
        { func: typePredicates.isAddContextListenerRequest, type: 'addContextListenerRequest' },
        { func: typePredicates.isRaiseIntentForContextRequest, type: 'raiseIntentForContextRequest' },
        { func: typePredicates.isCreatePrivateChannelRequest, type: 'createPrivateChannelRequest' },
        { func: typePredicates.isGetCurrentContextRequest, type: 'getCurrentContextRequest' },
        { func: typePredicates.isPrivateChannelDisconnectRequest, type: 'privateChannelDisconnectRequest' },
        { func: typePredicates.isAddEventListenerRequest, type: 'addEventListenerRequest' },
    ];

    requestMessageTypes.forEach(({ func, type }) => {
        it(`should identify valid ${type}`, () => {
            const validMessage = {
                type,
                meta: { requestUuid: '1234', timestamp: mockDate },
                payload: {},
            };
            expect(func(validMessage)).toBe(true);
        });

        it(`should reject invalid ${type}`, () => {
            const invalidMessage = {
                type: 'otherType',
                meta: { requestUuid: '1234', timestamp: mockDate },
                payload: {},
            };
            expect(func(invalidMessage)).toBe(false);
        });
    });

    // Test heartbeat event
    it('should identify valid heartbeat events', () => {
        const validHeartbeatEvent = {
            type: 'heartbeatEvent',
            meta: { eventUuid: '1234', timestamp: mockDate },
            payload: {},
        };
        expect(typePredicates.isHeartbeatEvent(validHeartbeatEvent)).toBe(true);
    });

    // Specific response message type tests
    const responseMessageTypes = [
        { func: typePredicates.isIntentResultResponse, type: 'intentResultResponse' },
        { func: typePredicates.isGetAppMetadataResponse, type: 'getAppMetadataResponse' },
        { func: typePredicates.isGetOrCreateChannelResponse, type: 'getOrCreateChannelResponse' },
        { func: typePredicates.isBroadcastResponse, type: 'broadcastResponse' },
        { func: typePredicates.isJoinUserChannelResponse, type: 'joinUserChannelResponse' },
        { func: typePredicates.isOpenResponse, type: 'openResponse' },
    ];

    responseMessageTypes.forEach(({ func, type }) => {
        it(`should identify valid ${type}`, () => {
            const validMessage = {
                type,
                meta: { requestUuid: '1234', responseUuid: '5678', timestamp: mockDate },
                payload: {},
            };
            expect(func(validMessage)).toBe(true);
        });

        it(`should reject invalid ${type}`, () => {
            const invalidMessage = {
                type: 'otherType',
                meta: { requestUuid: '1234', responseUuid: '5678', timestamp: mockDate },
                payload: {},
            };
            expect(func(invalidMessage)).toBe(false);
        });
    });

    // Specific event message type tests
    const eventMessageTypes = [
        {
            func: typePredicates.isPrivateChannelOnAddContextListenerEvent,
            type: 'privateChannelOnAddContextListenerEvent',
        },
        { func: typePredicates.isPrivateChannelOnUnsubscribeEvent, type: 'privateChannelOnUnsubscribeEvent' },
        { func: typePredicates.isPrivateChannelOnDisconnectEvent, type: 'privateChannelOnDisconnectEvent' },
        { func: typePredicates.isBroadcastEvent, type: 'broadcastEvent' },
        { func: typePredicates.isIntentEvent, type: 'intentEvent' },
        { func: typePredicates.isChannelChangedEvent, type: 'channelChangedEvent' },
    ];

    eventMessageTypes.forEach(({ func, type }) => {
        it(`should identify valid ${type}`, () => {
            const validMessage = {
                type,
                meta: { eventUuid: '1234', timestamp: mockDate },
                payload: {},
            };
            expect(func(validMessage)).toBe(true);
        });

        it(`should reject invalid ${type}`, () => {
            const invalidMessage = {
                type: 'otherType',
                meta: { eventUuid: '1234', timestamp: mockDate },
                payload: {},
            };
            expect(func(invalidMessage)).toBe(false);
        });
    });
});
