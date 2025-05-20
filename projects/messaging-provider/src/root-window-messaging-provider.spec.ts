/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes } from '@finos/fdc3';
import {
    FullyQualifiedAppIdentifier,
    IRootIncomingMessageEnvelope,
    IRootOutgoingMessageEnvelope,
} from '@morgan-stanley/fdc3-web';
import { defineProperty, IMocked, Mock, setupFunction, setupProperty } from '@morgan-stanley/ts-mocking-bird';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootWindowMessagingProvider } from './root-window-messaging-provider.js';

const channelOne = 'channelOne';
const channelTwo = 'channelTwo';
const mockedGeneratedUuid = `mocked-generated-Uuid`;

vi.mock('@morgan-stanley/fdc3-web', () => {
    return {
        generateUUID: () => mockedGeneratedUuid,
        ___moduleId: 'fdc3-web',
    };
});

describe('RootWindowMessagingProvider', () => {
    let messagingProvider: RootWindowMessagingProvider;
    let mockConsole: IMocked<Console>;

    let newRelayChannel: IMocked<BroadcastChannel>;
    let shutdownRelayChannel: IMocked<BroadcastChannel>;
    let exampleAppChannel: IMocked<BroadcastChannel>;
    let exampleAppChannel2: IMocked<BroadcastChannel>;

    let sourceAppIdentifier: FullyQualifiedAppIdentifier;

    beforeEach(() => {
        sourceAppIdentifier = {
            appId: 'source-app-id',
            instanceId: 'source-app-instance-id',
        };

        mockConsole = Mock.create<Console>().setup(setupFunction('warn'), setupFunction('log'), setupFunction('error'));
    });

    describe('constructor', () => {
        beforeAll(() => {
            function channelMock() {}
            channelMock.prototype = {
                name: null,
                onmessage: null,
            };
            channelMock.prototype.postMessage = function (data: any) {
                this.onmessage({ data });
            };
            (window as any).BroadcastChannel = channelMock;
        });

        it('should throw an error when unable to resolve window location basename', () => {
            // Arrange
            const mockedWindow: Window = {
                addEventListener: vi.fn(),
                location: {
                    href: 'http:',
                },
            } as any as Window;

            // Act
            try {
                new RootWindowMessagingProvider(createMockChannel, mockConsole.mock, mockedWindow);
                throw new Error('Test failed: should not reach here');
            } catch (e: any) {
                expect(e.message).toEqual('Unable to resolve window location basename');
            }
        });
    });

    describe('registerNewDesktopAgentProxyListener', () => {
        let mockWindowMessageListener: ReturnType<typeof vi.fn>;
        let mockedWindow: Window;

        beforeEach(() => {
            mockedWindow = {
                addEventListener: vi.fn().mockImplementation((event, listener) => {
                    if (event === 'message') {
                        mockWindowMessageListener = listener;
                    }
                }),
                location: {
                    href: 'http://mocked-href/',
                },
            } as any as Window;

            messagingProvider = new RootWindowMessagingProvider(createMockChannel, mockConsole.mock, mockedWindow);
        });

        it('should respond to new desktop agent proxy messages', () => {
            // Arrange
            const event = {
                data: {
                    type: 'hello',
                    nonce: 'mocked-nonce',
                },
                source: {
                    postMessage: vi.fn(),
                },
                origin: 'mocked-origin',
            };

            // Act
            mockWindowMessageListener(event as any as MessageEvent);

            // Assert
            expect(event.source.postMessage).toHaveBeenCalledWith(
                {
                    type: 'ack',
                    nonce: 'mocked-nonce',
                    url: 'http://mocked-href/fdc3-iframe-relay/index.html',
                    traceMessagingComms: false,
                },
                {
                    targetOrigin: event.origin,
                },
            );
        });
    });

    describe('publish and subscribe', () => {
        beforeEach(() => {
            messagingProvider = new RootWindowMessagingProvider(createMockChannel, mockConsole.mock);
        });

        it('should post message to the correct channel when channelId is provided in the envelope', () => {
            // Arrange
            const message: IRootOutgoingMessageEnvelope = {
                payload: {
                    payload: {},
                    meta: {
                        requestUuid: 'mocked-request-uuid',
                        responseUuid: 'mocked-response-uuid',
                        timestamp: new Date(),
                    },
                    type: 'raiseIntentResponse',
                },
                channelIds: [channelOne],
            };

            invokeOnMessage(newRelayChannel, channelOne);

            // Act
            messagingProvider.publish(message);

            // Assert
            expect(exampleAppChannel.withFunction('postMessage').withParameters(message.payload)).wasCalledOnce();
        });

        it('should post message to multiple channels when multiple appIdentifiers are provided in the envelope', () => {
            // Arrange
            const message: IRootOutgoingMessageEnvelope = {
                payload: {
                    payload: {},
                    meta: {
                        requestUuid: 'mocked-request-uuid',
                        responseUuid: 'mocked-response-uuid',
                        timestamp: new Date(),
                    },
                    type: 'raiseIntentResponse',
                },
                channelIds: [channelOne, channelTwo],
            };

            invokeOnMessage(newRelayChannel, channelOne);
            invokeOnMessage(newRelayChannel, channelTwo);

            // Act
            messagingProvider.publish(message);

            // Assert
            expect(exampleAppChannel.withFunction('postMessage').withParameters(message.payload)).wasCalledOnce();
            expect(exampleAppChannel2.withFunction('postMessage').withParameters(message.payload)).wasCalledOnce();
        });

        it('should log an error when channel is not found for channelId', () => {
            // Arrange
            const message: IRootOutgoingMessageEnvelope = {
                payload: {
                    payload: {},
                    meta: {
                        requestUuid: 'mocked-request-uuid',
                        responseUuid: 'mocked-response-uuid',
                        timestamp: new Date(),
                    },
                    type: 'raiseIntentResponse',
                },
                channelIds: ['unknown-channel-id'],
            };

            // Act
            messagingProvider.publish(message);

            // Assert
            expect(
                mockConsole.withFunction('error').withParameters(`Channel not found for channelId: unknown-channel-id`),
            ).wasCalledOnce();
        });

        it('should not attempt to shut down the channel when no channel exists', () => {
            // Act
            messagingProvider['shutdownChannel']('unknown-channel-id');

            // Assert
            expect(exampleAppChannel.withFunction('close')).wasNotCalled();
        });

        it('should shut down the channel when a shutdown message is received', () => {
            // Arrange
            invokeOnMessage(newRelayChannel, channelOne);

            // Act
            invokeOnMessage(shutdownRelayChannel, channelOne);

            // Assert
            expect(exampleAppChannel.withFunction('close')).wasCalledOnce();
        });

        it('should subscribe to messages from FDC3 Desktop Agents', () => {
            // Arrange
            const callback = Mock.create<IHasCallback>().setup(setupFunction('callback'));
            const message: BrowserTypes.RaiseIntentRequest = {
                payload: {
                    context: {
                        type: 'mocked-context-type',
                        name: 'mocked-context-name',
                    },
                    intent: 'mocked-intent',
                    app: sourceAppIdentifier,
                },
                meta: {
                    requestUuid: 'mocked-request-uuid',
                    timestamp: new Date(),
                },
                type: 'raiseIntentRequest',
            };
            messagingProvider.subscribe(callback.mock.callback);

            // Act
            invokeOnMessage(newRelayChannel, channelOne);
            invokeOnMessage(exampleAppChannel, message);

            const expectedMessage: IRootIncomingMessageEnvelope = {
                payload: message,
                channelId: channelOne,
            };

            // Assert
            expect(callback.withFunction('callback').withParametersEqualTo(expectedMessage)).wasCalledOnce();
        });

        it('should decorate messages from the root window to another channel with direction', () => {
            // Arrange
            const message: IRootOutgoingMessageEnvelope = {
                payload: {
                    payload: {},
                    meta: {
                        requestUuid: 'mocked-request-uuid',
                        responseUuid: 'mocked-response-uuid',
                        timestamp: new Date(),
                    },
                    type: 'raiseIntentResponse',
                },
                channelIds: [channelOne],
            };
            invokeOnMessage(newRelayChannel, channelOne);

            // Act
            messagingProvider.publish(message);

            // Assert
            expect(
                exampleAppChannel.withFunction('postMessage').withParametersEqualTo({
                    ...message.payload,
                    meta: {
                        ...(message.payload as any).meta,
                        direction: 'from-root',
                    },
                }),
            ).wasCalledOnce();
        });
    });

    describe('when traceMessagingComms is enabled', () => {
        beforeEach(() => {
            const mockWindow = {
                addEventListener: vi.fn(),
                location: {
                    href: 'http://mocked-href/',
                    search: '?traceMessagingComms=true',
                },
            } as any as Window;
            messagingProvider = new RootWindowMessagingProvider(
                createMockChannel,
                mockConsole.mock,
                mockWindow as any as Window,
            );
        });

        it('should log incoming messages', () => {
            // Arrange
            const message: BrowserTypes.RaiseIntentRequest = {
                payload: {
                    context: {
                        type: 'mocked-context-type',
                        name: 'mocked-context-name',
                    },
                    intent: 'mocked-intent',
                    app: sourceAppIdentifier,
                },
                meta: {
                    requestUuid: 'mocked-request-uuid',
                    timestamp: new Date(),
                },
                type: 'raiseIntentRequest',
            };

            // Act
            invokeOnMessage(newRelayChannel, channelOne);
            invokeOnMessage(exampleAppChannel, message);

            // Assert
            expect(
                mockConsole
                    .withFunction('log')
                    .withParameters(`[MESSAGE] relay > root: ${JSON.stringify(message, null, 2)}`),
            ).wasCalledOnce();
            expect(
                mockConsole
                    .withFunction('log')
                    .withParameters(`[NEWCHANNEL] relay > root: ${JSON.stringify(channelOne, null, 2)}`),
            ).wasCalledOnce();
        });
    });

    function invokeOnMessage(mockChannel: IMocked<BroadcastChannel>, messageData: any): void {
        const message = Mock.create<MessageEvent>().setup(setupProperty('data', messageData)).mock;

        const onMessageFunc = mockChannel.setterCallLookup.onmessage?.[0]?.[0];

        onMessageFunc?.apply(mockChannel.mock, [message]);
    }

    function createMockChannel(name: string): BroadcastChannel {
        const mockChannel = Mock.create<BroadcastChannel>().setup(
            defineProperty('onmessage'),
            setupFunction('postMessage'),
            setupFunction('close'),
            setupProperty('name', name),
        );

        switch (name) {
            case 'fdc3-iframe-relay-new-channel':
                newRelayChannel = mockChannel;
                break;
            case 'fdc3-iframe-relay-shutdown-channel':
                shutdownRelayChannel = mockChannel;
                break;
            case channelOne:
                exampleAppChannel = mockChannel;
                break;
            case channelTwo:
                exampleAppChannel2 = mockChannel;
                break;
        }

        return mockChannel.mock;
    }
});

interface IHasCallback {
    callback: (message: IRootIncomingMessageEnvelope) => void;
}
