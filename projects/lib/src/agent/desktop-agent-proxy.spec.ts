/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type {
    AppIdentifier,
    AppIntent,
    AppMetadata,
    BrowserTypes,
    Channel,
    Contact,
    Context,
    ContextHandler,
    EventHandler,
    ImplementationMetadata,
    IntentHandler,
    IntentResolution,
    IntentResult,
    Listener,
    PrivateChannel,
} from '@finos/fdc3';
import { OpenError, ResolveError } from '@finos/fdc3';
import {
    IMocked,
    Mock,
    proxyJestModule,
    registerMock,
    setupFunction,
    setupProperty,
    toBe,
} from '@morgan-stanley/ts-mocking-bird';
import { AppDirectory } from '../app-directory';
import { ChannelFactory, Channels } from '../channel';
import { ChannelMessageHandler } from '../channel/channel-message-handler';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
    ResponseMessage,
} from '../contracts';
import * as helpersImport from '../helpers';
import { RootMessagePublisher } from '../messaging/';
import { DesktopAgentImpl } from './desktop-agent';
import { DesktopAgentProxy } from './desktop-agent-proxy';

jest.mock('../helpers', () => proxyJestModule(require.resolve('../helpers')));

const mockedAppId = `mocked-app-id`;
const mockedInstanceId = `mocked-instance-id`;

const mockedRequestUuid = `mocked-request-uuid`;
const mockedRequestUuid2 = `mocked-request-uuid-2`;
const mockedResponseUuid = `mocked-response-uuid`;
const mockedDate = new Date(2024, 1, 0, 0, 0, 0);

const mockedChannelId = `mocked-channel-id`;
const mockedHeartbeatEventUuid = 'mocked-heartbeat-event-uuid';

// we run all these tests on DesktopAgentProxy and on DesktopAgentImpl as both are implemented the same
const tests = [{ proxy: true }, { proxy: false }];

tests.forEach(({ proxy }) => {
    const description = proxy
        ? `${DesktopAgentProxy.name} (desktop-agent-proxy)`
        : `${DesktopAgentImpl.name} Base Class (desktop-agent-proxy)`;

    describe(description, () => {
        let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
        let mockChannels: IMocked<Channels>;
        let mockedHelpers: IMocked<typeof helpersImport>;

        let appIdentifier: FullyQualifiedAppIdentifier;

        let requestUuIdentifier: string;
        let requestUuIdentifier2: string;
        let currentDate: Date;

        let contact: Contact;

        //  An array of functions to call when publish is called on messaging provider
        let publishCallbacks: ((message: IProxyOutgoingMessageEnvelope) => void)[];

        beforeEach(() => {
            publishCallbacks = [];
            mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(
                setupFunction('sendMessage', message =>
                    publishCallbacks.forEach(callback => callback(message as IProxyOutgoingMessageEnvelope)),
                ),
                setupFunction('addResponseHandler'),
            );

            mockChannels = Mock.create<Channels>();

            mockedHelpers = Mock.create<typeof helpersImport>().setup(
                setupFunction('generateUUID', () => mockedRequestUuid),
                setupFunction('getTimestamp', () => mockedDate),
                setupFunction(
                    'createRequestMessage',
                    (type, source, payload) =>
                        ({
                            type,
                            payload,
                            meta: { requestUuid: mockedRequestUuid, timestamp: currentDate, source },
                        }) as any,
                ),
            );
            registerMock(helpersImport, mockedHelpers.mock);

            appIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };
            requestUuIdentifier = mockedRequestUuid;
            requestUuIdentifier2 = mockedRequestUuid2;
            currentDate = mockedDate;

            contact = {
                type: 'fdc3.contact',
                name: 'Joe Bloggs',
                id: {
                    username: 'jo_bloggs',
                    phone: '079712345678',
                },
            };
        });

        async function createInstance(): Promise<DesktopAgentProxy> {
            const agent = proxy
                ? new DesktopAgentProxy({
                      appIdentifier,
                      messagingProvider: mockMessagingProvider.mock,
                      channelFactory: Mock.create<ChannelFactory>().setup(
                          setupFunction('createChannels', () => mockChannels.mock),
                      ).mock,
                  })
                : new DesktopAgentImpl({
                      appIdentifier,
                      rootMessagePublisher: mockMessagingProvider.mock as RootMessagePublisher,
                      directory: Mock.create<AppDirectory>().mock,
                      channelFactory: Mock.create<ChannelFactory>().setup(
                          setupFunction('createChannels', () => mockChannels.mock),
                          setupFunction('createMessageHandler', () => Mock.create<ChannelMessageHandler>().mock),
                      ).mock,
                  });

            // Wait for messaging provider to be resolved
            await wait();

            return agent;
        }

        it(`should create`, async () => {
            const instance = await createInstance();
            expect(instance).toBeDefined();

            expect(mockMessagingProvider.withFunction('addResponseHandler')).wasCalledOnce();
        });

        //https://fdc3.finos.org/docs/next/api/ref/DesktopAgent#addeventlistener
        describe('addEventListener', () => {
            let mockHandler: IMocked<{ handler: EventHandler }>;

            beforeEach(() => {
                mockHandler = Mock.create<{ handler: EventHandler }>().setup(setupFunction('handler'));
            });

            it('should request addition of listener for non-context and non-intent events from Desktop Agent when FDC3EventType is passed for type', async () => {
                const instance = await createInstance();

                instance.addEventListener('userChannelChanged', mockHandler.mock.handler);

                const expectedMessage: BrowserTypes.AddEventListenerRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        type: 'USER_CHANNEL_CHANGED',
                    },
                    type: 'addEventListenerRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request addition of listener for non-context and non-intent events from Desktop Agent when null is passed for type', async () => {
                const instance = await createInstance();

                instance.addEventListener(null, mockHandler.mock.handler);

                const expectedMessage: BrowserTypes.AddEventListenerRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        type: null,
                    },
                    type: 'addEventListenerRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return promise that resolves to added event listener', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);
                const listener = await listenerPromise;

                expect(typeof listener.unsubscribe).toBe('function');
            });

            it('should call event handler and pass it FDC3Event object when AgentEventMessage of correct type is received', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const channelChangedEvent: BrowserTypes.ChannelChangedEvent = {
                    type: 'channelChangedEvent',
                    meta: {
                        eventUuid: 'mocked-event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        newChannelId: mockedChannelId,
                    },
                };

                postMessage(channelChangedEvent);
                expect(
                    mockHandler.withFunction('handler').withParametersEqualTo({
                        type: 'userChannelChanged',
                        details: { newChannelId: mockedChannelId },
                    }),
                ).wasCalledOnce();
            });

            it('should not call event handler and pass it event object when AgentEventMessage message of incorrect type is received', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                    meta: {
                        eventUuid: 'mocked-event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        privateChannelId: mockedChannelId,
                    },
                    type: 'privateChannelOnDisconnectEvent',
                };

                postMessage(eventMessage);
                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should publish EventListenerUnsubscribeRequest when unsubscribe is called', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };

                postMessage(responseMessage);
                const listener = await listenerPromise;

                listener.unsubscribe();

                const expectedMessage: BrowserTypes.EventListenerUnsubscribeRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'eventListenerUnsubscribeRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should not call event handler after unsubscribe is called', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);
                const listener = await listenerPromise;

                listener.unsubscribe();
                const eventListenerUnsubscribeResponse: BrowserTypes.EventListenerUnsubscribeResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'eventListenerUnsubscribeResponse',
                };

                postMessage(eventListenerUnsubscribeResponse);

                await wait();

                const channelChangedEvent: BrowserTypes.ChannelChangedEvent = {
                    type: 'channelChangedEvent',
                    meta: {
                        eventUuid: 'mocked-event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        newChannelId: mockedChannelId,
                    },
                };

                postMessage(channelChangedEvent);
                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should not return event listener when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let listener: Listener | undefined;

                const mockedListenerUuid: string = `mocked-listener-uuid`;

                instance
                    .addEventListener('userChannelChanged', mockHandler.mock.handler)
                    .then(value => (listener = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(listener).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.NoAppsFound,
                    },
                    type: 'addEventListenerResponse',
                };
                postMessage(responseMessage);

                await expect(listenerPromise).rejects.toStrictEqual(ResolveError.NoAppsFound);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener
        describe('addContextListener', () => {
            let mockHandler: IMocked<{ handler: ContextHandler }>;
            let returnedPromise: Promise<Listener>;

            beforeEach(() => {
                mockHandler = Mock.create<{ handler: ContextHandler }>().setup(setupFunction('handler'));
                returnedPromise = Mock.create<Promise<Listener>>().mock;
                mockChannels.setupFunction('addContextListener', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.addContextListener('fdc3.action', mockHandler.mock.handler);

                expect(
                    mockChannels
                        .withFunction('addContextListener')
                        .withParameters('fdc3.action', toBe(mockHandler.mock.handler)),
                ).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });

            it(`should pass call to channels when only handler passed`, async () => {
                const instance = await createInstance();

                const result = instance.addContextListener(mockHandler.mock.handler);

                expect(
                    mockChannels
                        .withFunction('addContextListener')
                        .withParameters(null, toBe(mockHandler.mock.handler)),
                ).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });

            it(`should pass call to channels when null context type passed`, async () => {
                const instance = await createInstance();

                const result = instance.addContextListener(null, mockHandler.mock.handler);

                expect(
                    mockChannels
                        .withFunction('addContextListener')
                        .withParameters(null, toBe(mockHandler.mock.handler)),
                ).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#addintentlistener
        describe('addIntentListener', () => {
            let mockHandler: IMocked<{ handler: IntentHandler }>;
            let handlerResult: void | IntentResult;

            beforeEach(() => {
                handlerResult = undefined;
                mockHandler = Mock.create<{ handler: IntentHandler }>().setup(
                    setupFunction('handler', () => Promise.resolve(handlerResult)),
                );
            });

            it('should request addition of listener for intents raised by other applications', async () => {
                const instance = await createInstance();

                instance.addIntentListener('StartChat', mockHandler.mock.handler);

                const expectedMessage: BrowserTypes.AddIntentListenerRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return promise that resolves to added intent listener', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                const listener = await listenerPromise;

                expect(typeof listener.unsubscribe).toBe('function');
            });

            it('should call intent handler when IntentEvent message is received with correct context', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const intentEvent: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: 'event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentEvent',
                };

                postMessage(intentEvent);
                expect(mockHandler.withFunction('handler')).wasCalledOnce();
            });

            it(`when intent handler return promise resolves to a context object it should be published in an intentResultRequest message`, async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                handlerResult = { type: 'example.context' };

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const intentEvent: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: 'event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentEvent',
                };

                postMessage(intentEvent);

                expect(mockHandler.withFunction('handler')).wasCalledOnce();

                await wait();

                const expectedMessage: BrowserTypes.IntentResultRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intentEventUuid: 'event-uuid',
                        intentResult: { context: { type: 'example.context' } },
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentResultRequest',
                };

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it(`when intent handler return promise resolves to a channel object it should be published in an intentResultRequest message`, async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                handlerResult = Mock.create<Channel>().setup(
                    setupProperty('id', 'returned-channel-id'),
                    setupProperty('type', 'app'),
                ).mock;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const intentEvent: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: 'event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentEvent',
                };

                postMessage(intentEvent);

                expect(mockHandler.withFunction('handler')).wasCalledOnce();

                await wait();

                const expectedMessage: BrowserTypes.IntentResultRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intentEventUuid: 'event-uuid',
                        intentResult: {
                            channel: { id: 'returned-channel-id', type: 'app', displayMetadata: undefined },
                        },
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentResultRequest',
                };

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it(`when intent handler return promise resolves to undefined an intentResultRequest message should be published`, async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                await listenerPromise;

                const intentEvent: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: 'event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentEvent',
                };

                postMessage(intentEvent);

                expect(mockHandler.withFunction('handler')).wasCalledOnce();

                await wait();

                const expectedMessage: BrowserTypes.IntentResultRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intentEventUuid: 'event-uuid',
                        intentResult: {},
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentResultRequest',
                };

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should publish IntentListenerUnsubscribeRequest when unsubscribe is called', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };

                postMessage(responseMessage);
                const listener = await listenerPromise;

                listener.unsubscribe();

                const expectedMessage: BrowserTypes.IntentListenerUnsubscribeRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'intentListenerUnsubscribeRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should not call intent handler after unsubscribe is called', async () => {
                const mockedListenerUuid: string = `mocked-listener-uuid`;

                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);
                const listener = await listenerPromise;

                listener.unsubscribe();
                const intentListenerUnsubscribeResponse: BrowserTypes.IntentListenerUnsubscribeResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'intentListenerUnsubscribeResponse',
                };

                postMessage(intentListenerUnsubscribeResponse);

                await wait();

                const intentEvent: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: 'event-uuid',
                        timestamp: currentDate,
                    },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        raiseIntentRequestUuid: 'raise-intent-request-uuid',
                    },
                    type: 'intentEvent',
                };

                postMessage(intentEvent);
                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should not return intent listener when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let listener: Listener | undefined;

                const mockedListenerUuid: string = `mocked-listener-uuid`;

                instance
                    .addIntentListener('StartChat', mockHandler.mock.handler)
                    .then(value => (listener = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(listener).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const listenerPromise = instance.addIntentListener('StartChat', mockHandler.mock.handler);
                const responseMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.NoAppsFound,
                    },
                    type: 'addIntentListenerResponse',
                };
                postMessage(responseMessage);

                await expect(listenerPromise).rejects.toStrictEqual(ResolveError.NoAppsFound);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#broadcast
        describe('broadcast', () => {
            let returnedPromise: Promise<void>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<void>>().mock;
                mockChannels.setupFunction('broadcast', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const context: Context = { type: 'fdc3.sampleContext' };

                const result = instance.broadcast(context);

                expect(mockChannels.withFunction('broadcast').withParameters(context)).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#createprivatechannel
        describe('createPrivateChannel', () => {
            let returnedPromise: Promise<PrivateChannel>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<PrivateChannel>>().mock;
                mockChannels.setupFunction('createPrivateChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.createPrivateChannel();

                expect(mockChannels.withFunction('createPrivateChannel')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#findinstances
        describe('findInstances', () => {
            it('should request AppIdentifiers for all available instances for particular application', async () => {
                const instance = await createInstance();

                instance.findInstances(appIdentifier);

                const expectedMessage: BrowserTypes.FindInstancesRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: appIdentifier,
                    },
                    type: 'findInstancesRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return all available instances for particular application', async () => {
                const instance = await createInstance();

                const instancesPromise = instance.findInstances(appIdentifier);
                const responseMessage: BrowserTypes.FindInstancesResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIdentifiers: [appIdentifier],
                    },
                    type: 'findInstancesResponse',
                };
                postMessage(responseMessage);
                const instances = await instancesPromise;

                expect(instances).toEqual([appIdentifier]);
            });

            it('should return promise that resolves to empty array if app is known to agent but there are no instances of it', async () => {
                const instance = await createInstance();

                const appIdentifier2: AppIdentifier = { appId: `mocked-app-id-2` };

                const instancesPromise = instance.findInstances(appIdentifier2);
                const responseMessage: BrowserTypes.FindInstancesResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIdentifiers: [],
                    },
                    type: 'findInstancesResponse',
                };
                postMessage(responseMessage);
                const instances = await instancesPromise;

                expect(instances).toEqual([]);
            });

            it('should not return list of AppIdentifiers when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let instances: AppIdentifier[] | undefined;

                instance
                    .findInstances(appIdentifier)
                    .then(value => (instances = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.FindInstancesResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIdentifiers: [appIdentifier],
                    },
                    type: 'findInstancesResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(instances).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject returned promise with ResolveError.NoAppsFound message if app is not known to agent', async () => {
                const instance = await createInstance();

                const instancesPromise = instance.findInstances({ appId: `not-an-app` });
                const responseMessage: BrowserTypes.FindInstancesResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.NoAppsFound,
                    },
                    type: 'findInstancesResponse',
                };
                postMessage(responseMessage);

                await expect(instancesPromise).rejects.toStrictEqual(ResolveError.NoAppsFound);
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const instancesPromise = instance.findInstances(appIdentifier);
                const responseMessage: BrowserTypes.FindInstancesResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.ResolverTimeout,
                    },
                    type: 'findInstancesResponse',
                };
                postMessage(responseMessage);

                await expect(instancesPromise).rejects.toStrictEqual(ResolveError.ResolverTimeout);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#findintent
        describe('findIntent', () => {
            it('should request info about specified intent', async () => {
                const instance = await createInstance();

                instance.findIntent('StartChat');

                const expectedMessage: BrowserTypes.FindIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intent: 'StartChat',
                        context: undefined,
                        resultType: undefined,
                    },
                    type: 'findIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request info about specified intent and metadata about apps and app instances that are registered to handle it, filtered by context', async () => {
                const instance = await createInstance();

                instance.findIntent('StartChat', contact);

                const expectedMessage: BrowserTypes.FindIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        resultType: undefined,
                    },
                    type: 'findIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request info about specified intent and metadata about apps and app instances that are registered to handle it, filtered by resultType', async () => {
                const instance = await createInstance();

                instance.findIntent('StartChat', undefined, 'fdc3.chat.room');

                const expectedMessage: BrowserTypes.FindIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        intent: 'StartChat',
                        context: undefined,
                        resultType: 'fdc3.chat.room',
                    },
                    type: 'findIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request info about specified intent and metadata about apps and app instances that are registered to handle it, filtered by context and resultType', async () => {
                const instance = await createInstance();

                instance.findIntent('StartChat', contact, 'fdc3.chat.room');

                const expectedMessage: BrowserTypes.FindIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        resultType: 'fdc3.chat.room',
                    },
                    type: 'findIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return promise resolving to AppIntent returned in response message, containing all apps registered to handle intent', async () => {
                const instance = await createInstance();

                const intentPromise = instance.findIntent('StartChat');
                const responseMessage: BrowserTypes.FindIntentResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIntent: {
                            intent: {
                                name: 'StartChat',
                                displayName: 'StartChat',
                            },
                            apps: [
                                {
                                    appId: appIdentifier.appId,
                                    instanceId: appIdentifier.instanceId,
                                },
                            ],
                        },
                    },
                    type: 'findIntentResponse',
                };
                postMessage(responseMessage);
                const intent = await intentPromise;

                const expectedAppIntent: AppIntent = {
                    intent: {
                        name: 'StartChat',
                        displayName: 'StartChat',
                    },
                    apps: [
                        {
                            appId: appIdentifier.appId,
                            instanceId: appIdentifier.instanceId,
                        },
                    ],
                };

                expect(intent).toEqual(expectedAppIntent);
            });

            it('should not return AppIntent object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let intent: AppIntent | undefined;

                instance
                    .findIntent('StartChat')
                    .then(value => (intent = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.FindIntentResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIntent: {
                            intent: {
                                name: 'StartChat',
                                displayName: 'StartChat',
                            },
                            apps: [
                                {
                                    appId: appIdentifier.appId,
                                    instanceId: appIdentifier.instanceId,
                                },
                            ],
                        },
                    },
                    type: 'findIntentResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(intent).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const intentPromise = instance.findIntent('StartChat');
                const responseMessage: BrowserTypes.FindIntentResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.MalformedContext,
                    },
                    type: 'findIntentResponse',
                };
                postMessage(responseMessage);

                await expect(intentPromise).rejects.toStrictEqual(ResolveError.MalformedContext);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#findintentsbycontext
        describe('findIntentsByContext', () => {
            it('should request all available intents for a particular context', async () => {
                const instance = await createInstance();

                instance.findIntentsByContext(contact);

                const expectedMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        context: contact,
                        resultType: undefined,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request all available intents for a particular context and resultType if resultType is specified', async () => {
                const instance = await createInstance();

                instance.findIntentsByContext(contact, 'fdc3.chat.room');

                const expectedMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        context: contact,
                        resultType: 'fdc3.chat.room',
                    },
                    type: 'findIntentsByContextRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return all available intents for a particular context that were returned in response message', async () => {
                const instance = await createInstance();

                const intentsPromise = instance.findIntentsByContext(contact);
                const responseMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIntents: [
                            {
                                intent: {
                                    name: 'StartChat',
                                    displayName: 'StartChat',
                                },
                                apps: [
                                    {
                                        appId: appIdentifier.appId,
                                        instanceId: appIdentifier.instanceId,
                                    },
                                ],
                            },
                        ],
                    },
                    type: 'findIntentsByContextResponse',
                };
                postMessage(responseMessage);
                const intents = await intentsPromise;

                const expectedAppIntent: AppIntent = {
                    intent: {
                        name: 'StartChat',
                        displayName: 'StartChat',
                    },
                    apps: [
                        {
                            appId: appIdentifier.appId,
                            instanceId: appIdentifier.instanceId,
                        },
                    ],
                };

                expect(intents).toEqual([expectedAppIntent]);
            });

            it('should not return list of AppIntent objects when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let intents: AppIntent[] | undefined;

                instance
                    .findIntentsByContext(contact)
                    .then(value => (intents = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIntents: [
                            {
                                intent: {
                                    name: 'StartChat',
                                    displayName: 'StartChat',
                                },
                                apps: [
                                    {
                                        appId: appIdentifier.appId,
                                        instanceId: appIdentifier.instanceId,
                                    },
                                ],
                            },
                        ],
                    },
                    type: 'findIntentsByContextResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(intents).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const intentsPromise = instance.findIntentsByContext(contact);
                const responseMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.MalformedContext,
                    },
                    type: 'findIntentsByContextResponse',
                };
                postMessage(responseMessage);

                await expect(intentsPromise).rejects.toStrictEqual(ResolveError.MalformedContext);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getappmetadata
        describe('getAppMetadata', () => {
            it('should request AppMetaData for an AppIdentifier', async () => {
                const instance = await createInstance();

                instance.getAppMetadata(appIdentifier);

                const expectedMessage: BrowserTypes.GetAppMetadataRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: appIdentifier,
                    },
                    type: 'getAppMetadataRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return AppMetadata for an AppIdentifier', async () => {
                const instance = await createInstance();

                const appMetadataPromise = instance.getAppMetadata(appIdentifier);
                const responseMessage: BrowserTypes.GetAppMetadataResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appMetadata: {
                            appId: appIdentifier.appId,
                            instanceId: appIdentifier.instanceId,
                        },
                    },
                    type: 'getAppMetadataResponse',
                };
                postMessage(responseMessage);
                const appMetadata = await appMetadataPromise;

                const expectedAppMetadata: AppMetadata = {
                    appId: appIdentifier.appId,
                    instanceId: appIdentifier.instanceId,
                };

                expect(appMetadata).toEqual(expectedAppMetadata);
            });

            it('should not return AppMetadata object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let appMetadata: AppMetadata | undefined;

                instance
                    .getAppMetadata(appIdentifier)
                    .then(value => (appMetadata = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.GetAppMetadataResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appMetadata: {
                            appId: appIdentifier.appId,
                            instanceId: appIdentifier.instanceId,
                        },
                    },
                    type: 'getAppMetadataResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(appMetadata).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const metadataPromise = instance.getAppMetadata(appIdentifier);
                const responseMessage: BrowserTypes.GetAppMetadataResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.TargetAppUnavailable,
                    },
                    type: 'getAppMetadataResponse',
                };
                postMessage(responseMessage);

                await expect(metadataPromise).rejects.toStrictEqual(ResolveError.TargetAppUnavailable);
            });
        });

        //OPTIONAL
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getcurrentchannel
        describe('getCurrentChannel', () => {
            let returnedPromise: Promise<Channel>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<Channel>>().mock;
                mockChannels.setupFunction('getCurrentChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.getCurrentChannel();

                expect(mockChannels.withFunction('getCurrentChannel')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getinfo
        describe('getInfo', () => {
            it('should request info about fdc3 desktop agent implementation', async () => {
                const instance = await createInstance();

                instance.getInfo();

                const expectedMessage: BrowserTypes.GetInfoRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {},
                    type: 'getInfoRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it(`should return correct agent info`, async () => {
                const instance = await createInstance();

                const infoPromise = instance.getInfo();

                const expectedMetadata: ImplementationMetadata = {
                    fdc3Version: '2.1',
                    appMetadata: {
                        appId: mockedAppId,
                        instanceId: mockedInstanceId,
                    },
                    optionalFeatures: {
                        DesktopAgentBridging: false,
                        OriginatingAppMetadata: false,
                        UserChannelMembershipAPIs: false,
                    },
                    provider: 'Morgan Stanley',
                };

                const responseMessage: BrowserTypes.GetInfoResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        implementationMetadata: expectedMetadata,
                    },
                    type: 'getInfoResponse',
                };
                postMessage(responseMessage);
                const info = await infoPromise;

                expect(info).toEqual(expectedMetadata);
            });

            it('should not return ImplementationMetadata object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let metadata: ImplementationMetadata | undefined;

                const expectedMetadata: ImplementationMetadata = {
                    fdc3Version: '2.1',
                    appMetadata: {
                        appId: mockedAppId,
                        instanceId: mockedInstanceId,
                    },
                    optionalFeatures: {
                        DesktopAgentBridging: false,
                        OriginatingAppMetadata: false,
                        UserChannelMembershipAPIs: false,
                    },
                    provider: 'Morgan Stanley',
                };

                instance
                    .getInfo()
                    .then(value => (metadata = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.GetInfoResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        implementationMetadata: expectedMetadata,
                    },
                    type: 'getInfoResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(metadata).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const infoPromise = instance.getInfo();
                const responseMessage: BrowserTypes.GetInfoResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.MalformedContext,
                    },
                    type: 'getInfoResponse',
                };
                postMessage(responseMessage);

                await expect(infoPromise).rejects.toStrictEqual(ResolveError.MalformedContext);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getorcreatechannel
        describe('getOrCreateChannel', () => {
            let returnedPromise: Promise<Channel>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<Channel>>().mock;
                mockChannels.setupFunction('getOrCreateChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.getOrCreateChannel('channel_Id');

                expect(mockChannels.withFunction('getOrCreateChannel').withParameters('channel_Id')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getuserchannels
        describe('getUserChannels', () => {
            let returnedPromise: Promise<Channel[]>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<Channel[]>>().mock;
                mockChannels.setupFunction('getUserChannels', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.getUserChannels();

                expect(mockChannels.withFunction('getUserChannels')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //OPTIONAL
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#joinuserchannel
        describe('joinUserChannel', () => {
            let returnedPromise: Promise<void>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<void>>().mock;
                mockChannels.setupFunction('joinUserChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.joinUserChannel('channelId');

                expect(mockChannels.withFunction('joinUserChannel').withParameters('channelId')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //OPTIONAL
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#leavecurrentchannel
        describe('leaveCurrentChannel', () => {
            let returnedPromise: Promise<void>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<void>>().mock;
                mockChannels.setupFunction('leaveCurrentChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.leaveCurrentChannel();

                expect(mockChannels.withFunction('leaveCurrentChannel')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#open
        describe('open', () => {
            it('should launch app specified via AppIdentifier', async () => {
                const instance = await createInstance();

                instance.open(appIdentifier);

                const expectedMessage: BrowserTypes.OpenRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: appIdentifier,
                        context: undefined,
                    },
                    type: 'openRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return AppIdentifier object returned in response with instanceId field set to identify instance of opened app', async () => {
                const instance = await createInstance();
                const expectedInstanceId = `mocked-instance-id-2`;
                const newAppId = `new-app-id`;

                const instanceIdentifierPromise = instance.open({ appId: newAppId });
                const responseMessage: BrowserTypes.OpenResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIdentifier: { instanceId: expectedInstanceId, appId: newAppId },
                    },
                    type: 'openResponse',
                };
                postMessage(responseMessage);
                const instanceIdentifier = await instanceIdentifierPromise;

                expect(instanceIdentifier).toEqual({ instanceId: expectedInstanceId, appId: newAppId });
            });

            it('should not return AppIdentifier object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();
                const expectedInstanceId = `mocked-instance-id-2`;
                const newAppId = `new-app-id`;

                let error: Error | undefined;
                let instanceIdentifier: AppIdentifier | undefined;

                instance
                    .open({ appId: newAppId })
                    .then(identifier => (instanceIdentifier = identifier))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.OpenResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        appIdentifier: { instanceId: expectedInstanceId, appId: newAppId },
                    },
                    type: 'openResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(instanceIdentifier).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();
                const newAppId = `new-app-id`;

                const identifierPromise = instance.open({ appId: newAppId });
                const responseMessage: BrowserTypes.OpenResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: OpenError.AppNotFound,
                    },
                    type: 'openResponse',
                };
                postMessage(responseMessage);

                await expect(identifierPromise).rejects.toStrictEqual(OpenError.AppNotFound);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#raiseintent
        describe('raiseIntent', () => {
            it('should raise specific intent for resolution against apps registered with desktop agent', async () => {
                const instance = await createInstance();

                instance.raiseIntent('StartChat', contact);

                const expectedMessage: BrowserTypes.RaiseIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: undefined,
                        context: contact,
                        intent: 'StartChat',
                    },
                    type: 'raiseIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should raise specific intent supported by specified application', async () => {
                const instance = await createInstance();

                instance.raiseIntent('StartChat', contact, appIdentifier);

                const expectedMessage: BrowserTypes.RaiseIntentRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: appIdentifier,
                        context: contact,
                        intent: 'StartChat',
                    },
                    type: 'raiseIntentRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return IntentResolution object with details of app instance that was selected to respond to intent', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntent('StartChat', contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentResponse = {
                    type: 'raiseIntentResponse',
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                };
                postMessage(responseMessage);
                const intent = await intentPromise;

                const expectedResponse: IntentResolution = {
                    source: appIdentifier,
                    intent: 'StartChat',
                    getResult: intent.getResult,
                };

                expect(intent).toEqual(expectedResponse);
            });

            it('should not return IntentResolution object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let intent: IntentResolution | undefined;

                instance
                    .raiseIntent('StartChat', contact, appIdentifier)
                    .then(value => (intent = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.RaiseIntentResponse = {
                    type: 'raiseIntentResponse',
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                };
                postMessage(responseMessage);

                await wait();
                expect(intent).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should resolve promise of issuing app with the Context object or Channel object, or void that is provided as resolution of intent within receiving app if issuing app is waiting for promise returned by getResult()', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntent('StartChat', contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                    type: 'raiseIntentResponse',
                };
                postMessage(responseMessage);

                const intent = await intentPromise;

                const expectedResponse: IntentResolution = {
                    source: appIdentifier,
                    intent: 'StartChat',
                    getResult: intent.getResult,
                };

                const intentResultMessage: BrowserTypes.RaiseIntentResultResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResult: {
                            context: contact,
                        },
                    },
                    type: 'raiseIntentResultResponse',
                };
                postMessage(intentResultMessage);

                expect(intent).toEqual(expectedResponse);
                expect(await intent.getResult()).toEqual(contact);
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntent('StartChat', contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.TargetAppUnavailable,
                    },
                    type: 'raiseIntentResponse',
                };
                postMessage(responseMessage);

                await expect(intentPromise).rejects.toStrictEqual(ResolveError.TargetAppUnavailable);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#raiseintentforcontext
        describe('raiseIntentForContext', () => {
            it('should find and raise intent against apps registered with desktop agent based only on type of context data', async () => {
                const instance = await createInstance();

                instance.raiseIntentForContext(contact);

                const expectedMessage: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: undefined,
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should find and raise intent supported by specified application based on provided context', async () => {
                const instance = await createInstance();

                instance.raiseIntentForContext(contact, appIdentifier);

                const expectedMessage: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        app: appIdentifier,
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should return IntentResolution object with details of app instance that was selected to respond to intent', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntentForContext(contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                    type: 'raiseIntentForContextResponse',
                };
                postMessage(responseMessage);
                const intent = await intentPromise;

                const expectedResponse: IntentResolution = {
                    source: appIdentifier,
                    intent: 'StartChat',
                    getResult: intent.getResult,
                };

                expect(intent).toEqual(expectedResponse);
            });

            it('should not return IntentResolution object when non-matching requestUuid is passed', async () => {
                const instance = await createInstance();

                let error: Error | undefined;
                let intent: IntentResolution | undefined;

                instance
                    .raiseIntentForContext(contact, appIdentifier)
                    .then(value => (intent = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier2,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                    type: 'raiseIntentForContextResponse',
                };
                postMessage(responseMessage);

                await wait();
                expect(intent).toBeUndefined();
                expect(error).toBeUndefined();
            });

            it('should resolve promise of issuing app with the Context object or Channel object, or void that is provided as resolution of intent within receiving app if issuing app is waiting for promise returned by getResult()', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntentForContext(contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResolution: {
                            source: appIdentifier,
                            intent: 'StartChat',
                        },
                    },
                    type: 'raiseIntentForContextResponse',
                };
                postMessage(responseMessage);
                const intent = await intentPromise;

                const expectedResponse: IntentResolution = {
                    source: appIdentifier,
                    intent: 'StartChat',
                    getResult: intent.getResult,
                };

                const intentResultMessage: BrowserTypes.RaiseIntentResultResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        intentResult: {
                            context: contact,
                        },
                    },
                    type: 'raiseIntentResultResponse',
                };
                postMessage(intentResultMessage);

                expect(intent).toEqual(expectedResponse);
                expect(await intent.getResult()).toEqual(contact);
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                const intentPromise = instance.raiseIntentForContext(contact, appIdentifier);
                const responseMessage: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: {
                        requestUuid: requestUuIdentifier,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ResolveError.TargetAppUnavailable,
                    },
                    type: 'raiseIntentForContextResponse',
                };
                postMessage(responseMessage);

                await expect(intentPromise).rejects.toStrictEqual(ResolveError.TargetAppUnavailable);
            });
        });

        //DEPRECATED
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#getsystemchannels-deprecated
        describe('getSystemChannels', () => {
            let returnedPromise: Promise<Channel[]>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<Channel[]>>().mock;
                mockChannels.setupFunction('getUserChannels', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.getSystemChannels();

                expect(mockChannels.withFunction('getUserChannels')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        //DEPRECATED
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#joinchannel-deprecated
        describe('joinChannel', () => {
            let returnedPromise: Promise<void>;

            beforeEach(() => {
                returnedPromise = Mock.create<Promise<void>>().mock;
                mockChannels.setupFunction('joinUserChannel', () => returnedPromise);
            });

            it(`should pass call to channels`, async () => {
                const instance = await createInstance();

                const result = instance.joinChannel('channelId');

                expect(mockChannels.withFunction('joinUserChannel').withParameters('channelId')).wasCalledOnce();
                expect(result).toBe(returnedPromise);
            });
        });

        async function wait(delay: number = 50): Promise<void> {
            return new Promise(resolve => {
                setTimeout(() => resolve(), delay);
            });
        }

        function createExpectedRequestMeta(): BrowserTypes.AddContextListenerRequestMeta {
            return {
                requestUuid: mockedRequestUuid,
                timestamp: currentDate,
                source: appIdentifier,
            };
        }

        /**
         * pushes a message to any subscribers of the Mock messaging provider
         */
        function postMessage(message: ResponseMessage | EventMessage): void {
            mockMessagingProvider.functionCallLookup.addResponseHandler?.forEach(params =>
                params[0]({ payload: message }),
            );
        }

        describe('heartbeat handling', () => {
            it('should acknowledge heartbeat events', async () => {
                createInstance();

                const heartbeatEvent: BrowserTypes.HeartbeatEvent = {
                    meta: {
                        eventUuid: mockedHeartbeatEventUuid,
                        timestamp: currentDate,
                    },
                    type: 'heartbeatEvent',
                    payload: {},
                };

                postMessage(heartbeatEvent);

                await wait();

                // Verify acknowledgment was sent
                expect(
                    mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({
                        payload: {
                            meta: {
                                requestUuid: mockedRequestUuid,
                                timestamp: currentDate,
                                source: {
                                    appId: mockedAppId,
                                    instanceId: mockedInstanceId,
                                },
                            },
                            payload: {
                                heartbeatEventUuid: mockedHeartbeatEventUuid,
                            },
                            type: 'heartbeatAcknowledgementRequest',
                        },
                    }),
                ).wasCalledOnce();
            });

            it('should ignore non-heartbeat events', async () => {
                createInstance();

                const otherEvent: BrowserTypes.AgentEventMessage = {
                    meta: {
                        eventUuid: 'test-event-uuid',
                        timestamp: currentDate,
                    },
                    type: 'channelChangedEvent',
                    payload: {
                        newChannelId: 'test-channel',
                    },
                };

                postMessage(otherEvent);

                await wait();

                // Verify no acknowledgment was sent
                expect(
                    mockMessagingProvider.withFunction('sendMessage').withParameters({
                        isExpectedValue: message => message.payload.type === 'heartbeatAcknowledgementRequest',
                        expectedDisplayValue: 'Heartbeat Acknowledgement Request',
                    }),
                ).wasNotCalled();
            });
        });
    });
});
