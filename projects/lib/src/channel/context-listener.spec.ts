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
    BrowserTypes,
    Channel,
    Contact,
    Context,
    ContextHandler,
    DisplayMetadata,
    Listener,
    PrivateChannel,
} from '@finos/fdc3';
import { ChannelError } from '@finos/fdc3';
import {
    IMocked,
    Mock,
    proxyModule,
    registerMock,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
    Message,
    ResponseMessage,
} from '../contracts.js';
import {
    isAddContextListenerRequest,
    isAddEventListenerRequest,
    isGetCurrentChannelRequest,
    isGetCurrentContextRequest,
} from '../helpers/index.js';
import * as helpersImport from '../helpers/index.js';
import { ChannelFactory } from './channels.factory.js';
import { ContextListener } from './context-listener.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedAppId = `mocked-app-id`;
const mockedInstanceId = `mocked-instance-id`;
const mockedChannelId = `mocked-channel-id`;
const mockedRequestUuid = `mocked-request-uuid`;
const mockedResponseUuid = `mocked-response-uuid`;
const contextListenerUuid = `mocked-context-listener-uuid`;
const addEventListenerUuid = `mocked-add-event-listener-uuid`;

describe(`${ContextListener.name} (context-listener)`, () => {
    let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
    let mockedHelpers: IMocked<typeof helpersImport>;
    let mockHandler: IMocked<{ handler: ContextHandler }>;
    let mockChannelFactory: IMocked<ChannelFactory>;

    let appIdentifier: FullyQualifiedAppIdentifier;
    let publishCallbacks: ((message: IProxyOutgoingMessageEnvelope) => void)[];
    let currentDate: Date;
    let contact: Contact;

    beforeEach(() => {
        publishCallbacks = [];
        currentDate = new Date(2024, 1, 0, 0, 0, 0);
        appIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };

        mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(
            setupFunction('sendMessage', message =>
                publishCallbacks.forEach(callback => callback(message as IProxyOutgoingMessageEnvelope)),
            ),
            setupFunction('addResponseHandler'),
        );

        mockChannelFactory = Mock.create<ChannelFactory>().setup(
            setupFunction('createPublicChannel', channel => createMockChannel(channel).mock),
        );

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => mockedRequestUuid),
            setupFunction('getTimestamp', () => currentDate),
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

        contact = {
            type: 'fdc3.contact',
            name: 'Joe Bloggs',
            id: {
                username: 'jo_bloggs',
                phone: '079712345678',
            },
        };

        mockHandler = Mock.create<{ handler: ContextHandler }>().setup(setupFunction('handler'));
    });

    async function createInstance(details?: BrowserTypes.Channel, forCurrentChannel = false): Promise<ContextListener> {
        const instance = new ContextListener(
            details,
            appIdentifier,
            mockMessagingProvider.mock,
            mockChannelFactory.mock,
            forCurrentChannel,
        );

        await wait();

        return instance;
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    const tests: { singleChannel: boolean; details?: BrowserTypes.Channel }[] = [
        {
            singleChannel: true,
            details: {
                id: mockedChannelId,
                type: 'user',
            },
        },
        {
            singleChannel: false,
        },
    ];

    tests.forEach(({ singleChannel, details }) => {
        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener
        describe(`addContextListener ${singleChannel ? '(single-channel mode)' : '(multi-channel mode)'}`, () => {
            /**
             * Single Channel mode is when the context listener is associated with a single channel
             * Multi Channel mode is when the listener is associated with a desktop agent and the channel id will change
             */

            it('should request addition of listener for context broadcasts from the desktop agent of particular type', async () => {
                const instance = await createInstance(details);

                instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                const expectedMessage: BrowserTypes.AddContextListenerRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        channelId: details?.id ?? null, // should be null when in multi channel mode
                        contextType: 'fdc3.contact',
                    },
                    type: 'addContextListenerRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should request addition of listener for context broadcasts from the desktop agent of all types', async () => {
                const instance = await createInstance(details);

                instance.addContextListener(null, mockHandler.mock.handler);

                const expectedMessage: BrowserTypes.AddContextListenerRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        channelId: details?.id ?? null, // should be null when in multi channel mode
                        contextType: null,
                    },
                    type: 'addContextListenerRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            if (singleChannel) {
                it(`should not request latest context for channel`, async () => {
                    const instance = await createInstance(details);

                    instance.addContextListener(null, mockHandler.mock.handler);

                    const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                        meta: createExpectedRequestMeta(),
                        payload: {
                            channelId: mockedChannelId,
                            contextType: 'fdc3.contact',
                        },
                        type: 'getCurrentContextRequest',
                    };

                    await wait();

                    expect(
                        mockMessagingProvider
                            .withFunction('sendMessage')
                            .withParametersEqualTo({ payload: expectedMessage }),
                    ).wasNotCalled();
                });
            } else {
                it(`should request latest context for channel and pass it to listener`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupAddEventListenerResponse();
                    setupGetCurrentContextResponse(contact);

                    instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                        meta: createExpectedRequestMeta(),
                        payload: {
                            channelId: mockedChannelId,
                            contextType: 'fdc3.contact',
                        },
                        type: 'getCurrentContextRequest',
                    };

                    await wait();

                    expect(
                        mockMessagingProvider
                            .withFunction('sendMessage')
                            .withParametersEqualTo({ payload: expectedMessage }),
                    ).wasCalledOnce();
                    expect(mockHandler.withFunction('handler').withParameters(contact)).wasCalledOnce();
                });

                it(`should not request latest context for channel if no channel is selected`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();
                    mockChannelSelection();
                    setupAddEventListenerResponse();
                    setupGetCurrentContextResponse(contact);

                    instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                        meta: createExpectedRequestMeta(),
                        payload: {
                            channelId: mockedChannelId,
                            contextType: 'fdc3.contact',
                        },
                        type: 'getCurrentContextRequest',
                    };

                    await wait();

                    expect(
                        mockMessagingProvider
                            .withFunction('sendMessage')
                            .withParametersEqualTo({ payload: expectedMessage }),
                    ).wasNotCalled();
                    expect(mockHandler.withFunction('handler')).wasNotCalled();
                });

                it(`should not call handler if no context has been set`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();
                    mockChannelSelection();
                    setupAddEventListenerResponse();
                    setupGetCurrentContextResponse(null);

                    instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                        meta: createExpectedRequestMeta(),
                        payload: {
                            channelId: mockedChannelId,
                            contextType: 'fdc3.contact',
                        },
                        type: 'getCurrentContextRequest',
                    };

                    await wait();

                    expect(
                        mockMessagingProvider
                            .withFunction('sendMessage')
                            .withParametersEqualTo({ payload: expectedMessage }),
                    ).wasNotCalled();
                    expect(mockHandler.withFunction('handler')).wasNotCalled();
                });

                it(`should send addEventListenerEvent to subscribe to channel change events`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();

                    instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

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

                it(`should request latest context for channel and pass it to listener when app joins new channel`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();
                    setupAddEventListenerResponse();
                    mockChannelSelection();
                    setupGetCurrentContextResponse(contact);

                    await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    setupGetCurrentContextResponse(contact);
                    mockChannelSelection(mockedChannelId);

                    const userChannelChangedEvent: BrowserTypes.ChannelChangedEvent = {
                        meta: { timestamp: currentDate, eventUuid: `mocked-event-uuid` },
                        payload: {
                            newChannelId: mockedChannelId,
                        },
                        type: 'channelChangedEvent',
                    };

                    postMessage(userChannelChangedEvent);

                    const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                        meta: createExpectedRequestMeta(),
                        payload: {
                            channelId: mockedChannelId,
                            contextType: 'fdc3.contact',
                        },
                        type: 'getCurrentContextRequest',
                    };

                    await wait();

                    expect(
                        mockMessagingProvider
                            .withFunction('sendMessage')
                            .withParametersEqualTo({ payload: expectedMessage }),
                    ).wasCalledOnce();
                    expect(mockHandler.withFunction('handler').withParameters(contact)).wasCalledOnce();
                });
            }

            it('should return promise that resolves to added context listener', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                mockChannelSelection();
                setupAddEventListenerResponse();

                const listener = await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                expect(typeof listener.unsubscribe).toBe('function');
            });

            it('should return rejected promise if response includes error', async () => {
                const instance = await createInstance(details);

                const listenerPromise = instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                const responseMessage: BrowserTypes.AddContextListenerResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: 'MalformedContext',
                    },
                    type: 'addContextListenerResponse',
                };
                postMessage(responseMessage);

                await expect(listenerPromise).rejects.toEqual('MalformedContext');
            });

            it('should call ContextHandler function when BroadcastEvent is received with originatingApp', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                await postBroadcastMessage(mockedChannelId, contact);

                expect(
                    mockHandler.withFunction('handler').withParametersEqualTo(contact, { source: appIdentifier }),
                ).wasCalledOnce();
            });

            it('should call ContextHandler function when BroadcastEvent is received and context listener added for null context', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                await instance.addContextListener(null, mockHandler.mock.handler);

                await postBroadcastMessage(mockedChannelId, contact);

                expect(
                    mockHandler.withFunction('handler').withParametersEqualTo(contact, { source: appIdentifier }),
                ).wasCalledOnce();
            });

            if (!singleChannel) {
                it(`should only pass message to context handler when user channel changed event received for same channel`, async () => {
                    const instance = await createInstance(details);

                    setupContextListenerResponse();
                    if (!singleChannel) {
                        setupAddEventListenerResponse();
                        // no channel selected
                        mockChannelSelection();
                    }

                    await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    await postBroadcastMessage(mockedChannelId, contact);

                    expect(mockHandler.withFunction('handler')).wasNotCalled();

                    await postChannelChangedEvent(mockedChannelId);

                    await postBroadcastMessage(mockedChannelId, contact);

                    expect(
                        mockHandler.withFunction('handler').withParametersEqualTo(contact, { source: appIdentifier }),
                    ).wasCalledOnce();

                    //reset function call counts
                    mockHandler.setupFunction('handler');

                    await postChannelChangedEvent('new-channel-id');
                    await postBroadcastMessage(mockedChannelId, contact);

                    expect(mockHandler.withFunction('handler')).wasNotCalled();

                    const newContact: Context = { type: 'fdc3.contact' };

                    await postBroadcastMessage('new-channel-id', newContact);

                    expect(
                        mockHandler
                            .withFunction('handler')
                            .withParametersEqualTo(newContact, { source: appIdentifier }),
                    ).wasCalledOnce();
                });

                it('should listen to new user channel when app joins new user channel', async () => {
                    const instance = await createInstance(undefined, true);

                    setupContextListenerResponse();
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);

                    await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                    await postBroadcastMessage(mockedChannelId, contact);

                    expect(
                        mockHandler.withFunction('handler').withParametersEqualTo(contact, { source: appIdentifier }),
                    ).wasCalledOnce();

                    mockChannelSelection(`mocked-channel-id-two`);

                    await postBroadcastMessage(`mocked-channel-id-two`, contact);

                    expect(
                        mockHandler.withFunction('handler').withParametersEqualTo(contact, { source: appIdentifier }),
                    ).wasCalledOnce();
                });
            }

            it('should call ContextHandler function when BroadcastEvent is received without originatingApp', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                const broadcastEvent: BrowserTypes.BroadcastEvent = {
                    meta: { eventUuid: 'event-uuid', timestamp: currentDate },
                    payload: {
                        context: contact,
                        channelId: mockedChannelId,
                    },
                    type: 'broadcastEvent',
                };
                postMessage(broadcastEvent);

                await wait();

                expect(mockHandler.withFunction('handler').withParametersEqualTo(contact, undefined)).wasCalledOnce();
            });

            it('should not call ContextHandler function when BroadcastRequest with incorrect channelId is received', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                await postBroadcastMessage('unknown-channel-id', contact);

                await wait();

                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should not call ContextHandler function when raiseIntentRequest with incorrect ContextType is received', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                const currency = {
                    type: 'fdc3.currency',
                    name: 'US Dollar',
                    id: {
                        CURRENCY_ISOCODE: 'USD',
                    },
                };

                await postBroadcastMessage(mockedChannelId, currency);

                await wait();

                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should publish ContextListenerUnsubscribeRequest when unsubscribe is called', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                const listener = await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                listener.unsubscribe();

                const expectedMessage: BrowserTypes.ContextListenerUnsubscribeRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        listenerUUID: contextListenerUuid,
                    },
                    type: 'contextListenerUnsubscribeRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should no longer call ContextHandler function when unsubscribe has been called', async () => {
                const instance = await createInstance(details);

                setupContextListenerResponse();
                if (!singleChannel) {
                    setupAddEventListenerResponse();
                    mockChannelSelection(mockedChannelId);
                    setupGetCurrentContextResponse(null);
                }

                const listener = await instance.addContextListener('fdc3.contact', mockHandler.mock.handler);

                listener.unsubscribe();

                const responseMessage: BrowserTypes.ContextListenerUnsubscribeResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'contextListenerUnsubscribeResponse',
                };

                postMessage(responseMessage);

                await wait();

                await postBroadcastMessage(mockedChannelId, contact);

                expect(mockHandler.withFunction('handler')).wasNotCalled();
            });

            it('should not return context listener when non-matching requestUuid is passed', async () => {
                const instance = await createInstance(details);

                let error: Error | undefined;
                let listener: Listener | undefined;

                const mockedListenerUuid: string = `mocked-listener-uuid`;

                instance
                    .addContextListener('fdc3.contact', mockHandler.mock.handler)
                    .then(value => (listener = value))
                    .catch(err => (error = err));
                const responseMessage: BrowserTypes.AddContextListenerResponse = {
                    meta: {
                        requestUuid: 'nonMAtchingResponseUuid',
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        listenerUUID: mockedListenerUuid,
                    },
                    type: 'addContextListenerResponse',
                };

                postMessage(responseMessage);

                await wait();
                expect(listener).toBeUndefined();
                expect(error).toBeUndefined();
            });
        });
    });

    // https://fdc3.finos.org/docs/api/ref/Channel#getcurrentcontext
    describe('getCurrentContext', () => {
        let details: BrowserTypes.Channel;

        beforeEach(() => {
            details = {
                id: mockedChannelId,
                type: 'user',
            };
        });

        it(`should return null if no channelId is set`, async () => {
            const instance = await createInstance();

            await expect(instance.getCurrentContext('fdc3.contact')).resolves.toBeNull();

            await wait();

            expect(mockMessagingProvider.withFunction('sendMessage')).wasNotCalled();
        });

        it('should request most recent context of specific type broadcast on channel', async () => {
            const instance = await createInstance(details);

            const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    channelId: mockedChannelId,
                    contextType: 'fdc3.contact',
                },
                type: 'getCurrentContextRequest',
            };

            instance.getCurrentContext('fdc3.contact');

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should request most recent context of any type broadcast on channel', async () => {
            const instance = await createInstance(details);

            const expectedMessage: BrowserTypes.GetCurrentContextRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'getCurrentContextRequest',
            };

            instance.getCurrentContext();

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should return Context object passed in response message if there is one', async () => {
            const instance = await createInstance(details);

            setupGetCurrentContextResponse(contact);
            const context = await instance.getCurrentContext('fdc3.contact');

            expect(context).toEqual(contact);
        });

        it('should return null if null is passed in response message', async () => {
            const instance = await createInstance(details);

            setupGetCurrentContextResponse(null);

            const context = await instance.getCurrentContext('fdc3.contact');

            expect(context).toBeNull();
        });

        it('should not return Context object or null when non-matching requestUuid is passed', async () => {
            const instance = await createInstance(details);

            let error: Error | undefined;
            let context: Context | null | undefined;

            setupGetCurrentContextResponse(null);

            instance
                .getCurrentContext('fdc3.contact')
                .then(value => (context = value))
                .catch(err => (error = err));

            await wait();

            expect(context).toBeNull();
            expect(error).toBeUndefined();
        });

        it('should reject promise with same error message returned in response if one is provided', async () => {
            const instance = await createInstance(details);

            let error: Error | undefined;
            let context: Context | null | undefined;

            const responseMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.MalformedContext,
                },
                type: 'getCurrentContextResponse',
            };

            const contextPromise = instance
                .getCurrentContext('fdc3.contact')
                .then(value => (context = value))
                .catch(err => (error = err));

            postMessage(responseMessage);

            await contextPromise;

            expect(context).toBeUndefined();
            expect(error).toStrictEqual(ChannelError.MalformedContext);
        });
    });

    describe('getCurrentChannel', () => {
        it('should request Channel object for the current user channel', async () => {
            const instance = await createInstance();

            instance.getCurrentChannel();

            const expectedMessage: BrowserTypes.GetCurrentChannelRequest = {
                meta: createExpectedRequestMeta(),
                payload: {},
                type: 'getCurrentChannelRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should return Channel object for the current user channel', async () => {
            const instance = await createInstance();

            mockChannelSelection(mockedChannelId);

            const channel = await instance.getCurrentChannel();

            expect(channel).toBeDefined();

            if (channel != null) {
                compareChannels(channel, createMockChannel(createBrowserTypeChannel(mockedChannelId, 'user')).mock);
            }
        });

        it('should not return Channel object when non-matching requestUuid is passed', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let channel: Channel | null | undefined;

            instance
                .getCurrentChannel()
                .then(value => (channel = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.GetCurrentChannelResponse = {
                meta: {
                    requestUuid: 'nonMatchingResponseUuid',
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: {
                        id: mockedChannelId,
                        type: 'user',
                    },
                },
                type: 'getCurrentChannelResponse',
            };
            postMessage(responseMessage);

            await wait();
            expect(channel).toBeUndefined();
            expect(error).toBeUndefined();
        });

        it('should return null if app is not joined to channel', async () => {
            const instance = await createInstance();

            const channelPromise = instance.getCurrentChannel();

            const responseMessage: BrowserTypes.GetCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: null,
                },
                type: 'getCurrentChannelResponse',
            };
            postMessage(responseMessage);

            const channel = await channelPromise;

            expect(channel).toBeNull();
        });

        it(`should return rejected promise when error returned in payload`, async () => {
            const instance = await createInstance();

            mockChannelSelection(mockedChannelId);

            const channelPromise = instance.getCurrentChannel();

            const responseMessage: BrowserTypes.GetCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: 'AppNotFound',
                },
                type: 'getCurrentChannelResponse',
            };
            postMessage(responseMessage);

            await expect(channelPromise).rejects.toEqual('AppNotFound');
        });
    });

    async function postBroadcastMessage(channelId: string, context: Context): Promise<void> {
        const broadcastEvent: BrowserTypes.BroadcastEvent = {
            meta: { eventUuid: 'broadcast-event-event-uuid', timestamp: currentDate },
            payload: {
                context,
                channelId,
                originatingApp: appIdentifier,
            },
            type: 'broadcastEvent',
        };
        postMessage(broadcastEvent);

        await wait();
    }

    async function postChannelChangedEvent(channelId: string): Promise<void> {
        const eventListenerEvent: BrowserTypes.ChannelChangedEvent = {
            meta: { eventUuid: 'add-event-listener-event-uuid', timestamp: currentDate },
            payload: {
                newChannelId: channelId,
            },
            type: 'channelChangedEvent',
        };

        postMessage(eventListenerEvent);

        await wait();
    }

    /**
     * pushes a message to any subscribers of the Mock messaging provider
     */
    function postMessage(message: ResponseMessage | EventMessage): void {
        mockMessagingProvider.functionCallLookup.addResponseHandler?.forEach(params => params[0]({ payload: message }));
    }

    function createExpectedRequestMeta(): BrowserTypes.AddContextListenerRequestMeta {
        return {
            requestUuid: mockedRequestUuid,
            timestamp: currentDate,
            source: appIdentifier,
        };
    }

    function setupAddEventListenerResponse() {
        awaitMessage(isAddEventListenerRequest).then(() => {
            const responseMessage: BrowserTypes.AddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: addEventListenerUuid,
                },
                type: 'addEventListenerResponse',
            };

            postMessage(responseMessage);
        });
    }

    function setupContextListenerResponse() {
        awaitMessage(isAddContextListenerRequest).then(() => {
            const responseMessage: BrowserTypes.AddContextListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: contextListenerUuid,
                },
                type: 'addContextListenerResponse',
            };

            postMessage(responseMessage);
        });
    }

    function setupGetCurrentContextResponse(context: Context | null) {
        awaitMessage(isGetCurrentContextRequest).then(() => {
            const responseMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    context,
                },
                type: 'getCurrentContextResponse',
            };

            postMessage(responseMessage);
        });
    }

    function mockChannelSelection(channelId?: string) {
        awaitMessage(isGetCurrentChannelRequest).then(() => {
            const responseMessage: BrowserTypes.GetCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: channelId != null ? { id: channelId, type: 'user' } : undefined,
                },
                type: 'getCurrentChannelResponse',
            };

            postMessage(responseMessage);
        });
    }

    function compareChannels(one: Channel, two: Channel): void {
        const { broadcast: broadcastOne, addContextListener: listenerOne, ...partialChannelOne } = one;
        const { broadcast: broadcastTwo, addContextListener: listenerTwo, ...partialChannelTwo } = two;

        expect(partialChannelOne).toEqual(partialChannelTwo);
    }

    function createBrowserTypeChannel(
        id: string,
        type: 'user' | 'app' | 'private',
        displayMetadata?: DisplayMetadata,
    ): BrowserTypes.Channel {
        return {
            id: id,
            type: type,
            displayMetadata: displayMetadata,
        };
    }

    function createMockChannel(channel: BrowserTypes.Channel): IMocked<Channel> {
        return createChannel<Channel>(channel).setup(setupProperty('displayMetadata', { name: 'publicChannel' }));
    }

    function createChannel<T extends PrivateChannel | Channel>(channel: BrowserTypes.Channel): IMocked<T> {
        return Mock.create<Channel>().setup(
            setupProperty('id', channel.id),
            setupProperty('type', channel.type),
            setupFunction('broadcast', () => Promise.resolve()),
            setupFunction('addContextListener', () => Promise.resolve(Mock.create<Listener>().mock)),
        ) as IMocked<T>;
    }

    function awaitMessage<T extends Message>(predicate: (message: Message) => message is T): Promise<T> {
        return new Promise(resolve => {
            publishCallbacks.push(envelope => {
                const message = envelope.payload;
                if (predicate(message)) {
                    resolve(message);
                }
            });
        });
    }
});

async function wait(delay: number = 50): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
}
