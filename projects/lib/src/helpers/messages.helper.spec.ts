/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes } from '@finos/fdc3';
import { IMocked, Mock, proxyModule, registerMock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { afterEach, beforeEach, describe, expect, it, Mock as viMock, vi } from 'vitest';
import { FDC3_VERSION } from '../constants.js';
import { FullyQualifiedAppIdentifier, RequestMessage } from '../contracts.js';
import * as finosTypePredicateHelper from './finos-type-predicate.helper.js';
import {
    createEvent,
    createRequestMessage,
    createResponseMessage,
    generateHandshakeResponseMessage,
    generateHelloMessage,
    generateValidateIdentityMessage,
    subscribeToConnectionAttemptUuids,
} from './messages.helper.js';
import * as timestampImport from './timestamp.helper.js';
import * as uuidImport from './uuid.helper.js';

vi.mock('./uuid.helper.js', async () => {
    const actual = await vi.importActual('./uuid.helper.js');
    return proxyModule(actual);
});
vi.mock('./timestamp.helper.js', async () => {
    const actual = await vi.importActual('./timestamp.helper.js');
    return proxyModule(actual);
});
vi.mock('./finos-type-predicate.helper.js', async () => {
    const actual = await vi.importActual('./finos-type-predicate.helper.js');
    return proxyModule(actual);
});

type NonOptionalMessage<
    T extends BrowserTypes.AppRequestMessage | BrowserTypes.AgentResponseMessage | BrowserTypes.AgentEventMessage,
> = T & {
    meta: Required<T['meta']>;
};

const mockedGeneratedUuid = `mocked-generated-Uuid`;
const requestUuid = `mocked-requestUuid-Uuid`;
const mockedDate = new Date(2024, 1, 0, 0, 0, 0);

const source: Readonly<FullyQualifiedAppIdentifier> = { appId: 'mockedAppID', instanceId: 'mockedInstanceId' };

describe(`messages.helper`, () => {
    let mockedUuidHelper: IMocked<typeof uuidImport>;
    let mockedTimestampHelper: IMocked<typeof timestampImport>;
    let mockedTypePredicateHelper: IMocked<typeof finosTypePredicateHelper>;
    let originalWindow: Window;

    beforeEach(() => {
        // Reset all mocks before creating new ones
        vi.resetAllMocks();
        mockedUuidHelper = Mock.create<typeof uuidImport>().setup(
            setupFunction('generateUUID', () => mockedGeneratedUuid),
        );
        mockedTimestampHelper = Mock.create<typeof timestampImport>().setup(
            setupFunction('getTimestamp', () => mockedDate),
        );
        mockedTypePredicateHelper = Mock.create<typeof finosTypePredicateHelper>();
        registerMock(uuidImport, mockedUuidHelper.mock);
        registerMock(timestampImport, mockedTimestampHelper.mock);
        registerMock(finosTypePredicateHelper, mockedTypePredicateHelper.mock);

        // Save original window and create a mock for testing
        originalWindow = global.window;
        global.window = {
            ...global.window,
            location: { href: 'https://test.com' } as Location,
        } as Window & typeof globalThis;
    });

    afterEach(() => {
        // Restore original window
        global.window = originalWindow as Window & typeof globalThis;
    });

    describe(`createRequestMessage`, () => {
        function testRequestMessageCreation<T extends RequestMessage>(
            type: T['type'],
            payload: T['payload'],
            expected: NonOptionalMessage<T>,
        ) {
            it(`should create expected message of type ${type}`, () => {
                const created = createRequestMessage<T>(type, source, payload);

                expect(created).toEqual(expected);
            });
        }

        testRequestMessageCreation<BrowserTypes.AddContextListenerRequest>(
            'addContextListenerRequest',
            {
                channelId: 'mockedChannelID',
                contextType: 'mocked.context',
            },
            {
                type: 'addContextListenerRequest',
                meta: { source, requestUuid: mockedGeneratedUuid, timestamp: mockedDate },
                payload: {
                    channelId: 'mockedChannelID',
                    contextType: 'mocked.context',
                },
            },
        );

        testRequestMessageCreation<BrowserTypes.RaiseIntentRequest>(
            'raiseIntentRequest',
            {
                context: { type: 'fdc3.expectedContext' },
                intent: 'expectedIntent',
            },
            {
                type: 'raiseIntentRequest',
                meta: { source, requestUuid: mockedGeneratedUuid, timestamp: mockedDate },
                payload: {
                    context: { type: 'fdc3.expectedContext' },
                    intent: 'expectedIntent',
                },
            },
        );
    });

    describe(`createResponseMessage`, () => {
        function testResponseMessageCreation<T extends BrowserTypes.AgentResponseMessage>(
            type: T['type'],
            payload: T['payload'],
            expected: NonOptionalMessage<T>,
        ) {
            it(`should create expected message of type ${type}`, () => {
                const created = createResponseMessage<T>(type, payload, requestUuid, source);

                expect(created).toEqual(expected);
            });
        }

        testResponseMessageCreation<BrowserTypes.AddContextListenerResponse>(
            'addContextListenerResponse',
            { listenerUUID: 'expectedUUid' },
            {
                type: 'addContextListenerResponse',
                meta: {
                    source,
                    requestUuid: requestUuid,
                    timestamp: mockedDate,
                    responseUuid: mockedGeneratedUuid,
                },
                payload: { listenerUUID: 'expectedUUid' },
            },
        );

        testResponseMessageCreation<BrowserTypes.AddContextListenerResponse>(
            'addContextListenerResponse',
            {},
            {
                type: 'addContextListenerResponse',
                meta: {
                    source,
                    requestUuid: requestUuid,
                    timestamp: mockedDate,
                    responseUuid: mockedGeneratedUuid,
                },
                payload: {},
            },
        );

        testResponseMessageCreation<BrowserTypes.RaiseIntentResponse>(
            'raiseIntentResponse',
            { appIntent: { apps: [], intent: { name: 'someIntent' } } },
            {
                type: 'raiseIntentResponse',
                meta: {
                    source,
                    requestUuid: requestUuid,
                    timestamp: mockedDate,
                    responseUuid: mockedGeneratedUuid,
                },
                payload: { appIntent: { apps: [], intent: { name: 'someIntent' } } },
            },
        );
    });

    describe(`createEvent`, () => {
        function testEventCreation<T extends BrowserTypes.AgentEventMessage>(
            type: T['type'],
            payload: T['payload'],
            expected: NonOptionalMessage<T>,
        ) {
            it(`should create expected message of type ${type}`, () => {
                const created = createEvent<T>(type, payload);

                expect(created).toEqual(expected);
            });
        }

        testEventCreation<BrowserTypes.IntentEvent>(
            'intentEvent',
            {
                context: { type: 'example.context' },
                intent: 'startChat',
                raiseIntentRequestUuid: requestUuid,
                originatingApp: source,
            },
            {
                type: 'intentEvent',
                meta: { eventUuid: mockedGeneratedUuid, timestamp: mockedDate },
                payload: {
                    context: { type: 'example.context' },
                    intent: 'startChat',
                    raiseIntentRequestUuid: requestUuid,
                    originatingApp: source,
                },
            },
        );

        testEventCreation<BrowserTypes.BroadcastEvent>(
            'broadcastEvent',
            {
                context: { type: 'fdc3.expectedContext' },
                channelId: 'channelIdOne',
            },
            {
                type: 'broadcastEvent',
                meta: { eventUuid: mockedGeneratedUuid, timestamp: mockedDate },
                payload: {
                    context: { type: 'fdc3.expectedContext' },
                    channelId: 'channelIdOne',
                },
            },
        );
    });

    describe('generateHelloMessage', () => {
        it('should create a hello message with default identity URL', () => {
            const helloMessage = generateHelloMessage();

            expect(helloMessage).toEqual({
                meta: { timestamp: mockedDate, connectionAttemptUuid: mockedGeneratedUuid },
                payload: {
                    actualUrl: 'https://test.com',
                    fdc3Version: FDC3_VERSION,
                    identityUrl: 'https://test.com',
                },
                type: 'WCP1Hello',
            });
        });

        it('should create a hello message with provided identity URL', () => {
            const identityUrl = 'https://custom-identity.com';
            const helloMessage = generateHelloMessage(identityUrl);

            expect(helloMessage).toEqual({
                meta: { timestamp: mockedDate, connectionAttemptUuid: mockedGeneratedUuid },
                payload: {
                    actualUrl: 'https://test.com',
                    fdc3Version: FDC3_VERSION,
                    identityUrl: identityUrl,
                },
                type: 'WCP1Hello',
            });
        });
    });

    describe('generateHandshakeResponseMessage', () => {
        it('should create a handshake response message', () => {
            const connectionAttemptUuid = 'test-uuid';
            const helloMessage: BrowserTypes.WebConnectionProtocol1Hello = {
                meta: { timestamp: new Date(), connectionAttemptUuid },
                payload: {
                    actualUrl: 'https://test.com',
                    fdc3Version: '2.0',
                    identityUrl: 'https://test.com',
                },
                type: 'WCP1Hello',
            };

            const response = generateHandshakeResponseMessage(helloMessage);

            expect(response).toEqual({
                type: 'WCP3Handshake',
                meta: {
                    connectionAttemptUuid,
                    timestamp: mockedDate,
                },
                payload: {
                    channelSelectorUrl: false,
                    fdc3Version: FDC3_VERSION,
                    intentResolverUrl: false,
                },
            });
        });
    });

    describe('generateValidateIdentityMessage', () => {
        it('should create a validate identity message with default identity URL', () => {
            const connectionAttemptUuid = 'test-uuid';
            const message = generateValidateIdentityMessage(connectionAttemptUuid);

            expect(message).toEqual({
                meta: { timestamp: mockedDate, connectionAttemptUuid },
                payload: {
                    actualUrl: 'https://test.com',
                    identityUrl: 'https://test.com',
                    instanceId: undefined,
                    instanceUuid: undefined,
                },
                type: 'WCP4ValidateAppIdentity',
            });
        });

        it('should create a validate identity message with all parameters', () => {
            const connectionAttemptUuid = 'test-uuid';
            const identityUrl = 'https://custom-identity.com';
            const instanceId = 'instance-1';
            const instanceUuid = 'uuid-1';

            const message = generateValidateIdentityMessage(
                connectionAttemptUuid,
                identityUrl,
                instanceId,
                instanceUuid,
            );

            expect(message).toEqual({
                meta: { timestamp: mockedDate, connectionAttemptUuid },
                payload: {
                    actualUrl: 'https://test.com',
                    identityUrl,
                    instanceId,
                    instanceUuid,
                },
                type: 'WCP4ValidateAppIdentity',
            });
        });
    });

    describe('subscribeToConnectionAttemptUuids', () => {
        it('should listen for hello messages and call callback with the connection attempt UUID', () => {
            // Create mocks
            const mockWindowRef = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as WindowProxy;

            const mockChildWindow = {} as WindowProxy;
            const mockCallback = vi.fn();

            const mockIsWCPHelloMessage:
                | ((value: any) => value is BrowserTypes.WebConnectionProtocol1Hello)
                | undefined = (() => true) as unknown as typeof mockIsWCPHelloMessage;

            // Setup isWCPHelloMessage mock
            mockedTypePredicateHelper.setup(setupFunction('isWCPHelloMessage', mockIsWCPHelloMessage));
            registerMock(finosTypePredicateHelper, mockedTypePredicateHelper.mock);

            // Subscribe
            const { unsubscribe } = subscribeToConnectionAttemptUuids(mockWindowRef, mockChildWindow, mockCallback);

            // Verify event listener was added
            expect(mockWindowRef.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

            // Get the message handler
            const messageHandler = (mockWindowRef.addEventListener as viMock).mock.calls[0][1];

            // Create a mock message event with matching source
            const mockEvent = {
                source: mockChildWindow,
                data: {
                    meta: { connectionAttemptUuid: 'test-uuid' },
                },
            } as MessageEvent;

            // Call the handler
            messageHandler(mockEvent);

            // Verify the callback was called with the connectionAttemptUuid
            expect(mockCallback).toHaveBeenCalledWith('test-uuid');
            expect(mockWindowRef.removeEventListener).toHaveBeenCalled();

            // Test unsubscribe
            unsubscribe();
            expect(mockWindowRef.removeEventListener).toHaveBeenCalledWith('message', messageHandler);
        });

        it('should not process hello messages from other windows', () => {
            // Create mocks
            const mockWindowRef = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as WindowProxy;

            const mockChildWindow = {} as WindowProxy;
            const mockOtherWindow = {} as WindowProxy;
            const mockCallback = vi.fn();

            const mockIsWCPHelloMessage:
                | ((value: any) => value is BrowserTypes.WebConnectionProtocol1Hello)
                | undefined = (() => true) as unknown as typeof mockIsWCPHelloMessage;

            // Setup isWCPHelloMessage mock
            mockedTypePredicateHelper.setup(setupFunction('isWCPHelloMessage', mockIsWCPHelloMessage));
            registerMock(finosTypePredicateHelper, mockedTypePredicateHelper.mock);

            // Subscribe
            subscribeToConnectionAttemptUuids(mockWindowRef, mockChildWindow, mockCallback);

            // Get the message handler
            const messageHandler = (mockWindowRef.addEventListener as viMock).mock.calls[0][1];

            // Create a mock message event with non-matching source
            const mockEvent = {
                source: mockOtherWindow, // Different window
                data: {
                    meta: { connectionAttemptUuid: 'test-uuid' },
                },
            } as MessageEvent;

            // Call the handler
            messageHandler(mockEvent);

            // Verify the callback was not called
            expect(mockCallback).not.toHaveBeenCalled();
            expect(mockWindowRef.removeEventListener).not.toHaveBeenCalled();
        });
    });
});
