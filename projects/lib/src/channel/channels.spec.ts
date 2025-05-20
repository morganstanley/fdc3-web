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
import * as helpersImport from '../helpers/index.js';
import { isGetCurrentChannelRequest } from '../helpers/index.js';
import { ContextListener } from './channel.contracts.js';
import { ChannelFactory } from './channels.factory.js';
import { Channels } from './channels.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedAppId = `mocked-app-id`;
const mockedInstanceId = `mocked-instance-id`;
const mockedRequestUuid = `mocked-request-uuid`;
const mockedResponseUuid = `mocked-response-uuid`;
const mockedChannelId = `mocked-channel-id`;

describe(`${Channels.name} (channels)`, () => {
    let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
    let mockChannelsFactory: IMocked<ChannelFactory>;
    let mockedHelpers: IMocked<typeof helpersImport>;
    let mockedContextListener: IMocked<ContextListener>;

    //  An array of functions to call when publish is called on messaging provider
    let publishCallbacks: ((message: IProxyOutgoingMessageEnvelope) => void)[];

    let appIdentifier: FullyQualifiedAppIdentifier;

    let currentDate: Date;
    let contact: Contact;

    beforeEach(() => {
        publishCallbacks = [];
        currentDate = new Date(2024, 1, 0, 0, 0, 0);

        appIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };

        mockChannelsFactory = Mock.create<ChannelFactory>().setup(
            setupFunction('createPublicChannel', channel => createMockChannel(channel).mock),
            setupFunction('createPrivateChannel', channel => createMockPrivateChannel(channel).mock),
        );

        mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(
            setupFunction('sendMessage', message =>
                publishCallbacks.forEach(callback => callback(message as IProxyOutgoingMessageEnvelope)),
            ),
            setupFunction('addResponseHandler'),
        );

        mockedContextListener = Mock.create<ContextListener>().setup(
            setupFunction('getCurrentChannel', () =>
                Promise.resolve(createMockChannel(createBrowserTypeChannel(mockedChannelId, 'user')).mock),
            ),
            setupFunction('addContextListener'),
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
    });

    async function createInstance(): Promise<Channels> {
        const instance = new Channels(
            mockChannelsFactory.mock,
            appIdentifier,
            mockMessagingProvider.mock,
            mockedContextListener.mock,
        );

        await wait();

        return instance;
    }

    /**
     * Test factory creation
     */
    it(`Factory should create`, () => {
        const instance = new ChannelFactory().createChannels(appIdentifier, mockMessagingProvider.mock);

        expect(instance).toBeInstanceOf(Channels);
    });

    it(`should create`, async () => {
        const instance = await createInstance();
        expect(instance).toBeInstanceOf(Channels);
    });

    describe('getUserChannels', () => {
        it('should request list of User Channels app can join', async () => {
            const instance = await createInstance();

            instance.getUserChannels();

            const expectedMessage: BrowserTypes.GetUserChannelsRequest = {
                meta: createExpectedRequestMeta(),
                payload: {},
                type: 'getUserChannelsRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should return list of User Channels app can join', async () => {
            const instance = await createInstance();

            const userChannelsPromise = instance.getUserChannels();

            const responseChannel = createBrowserTypeChannel(mockedChannelId, 'user');

            const responseMessage: BrowserTypes.GetUserChannelsResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    userChannels: [responseChannel],
                },
                type: 'getUserChannelsResponse',
            };

            postMessage(responseMessage);
            const userChannels = await userChannelsPromise;

            compareChannels(userChannels[0], createMockChannel(responseChannel).mock);
        });

        it('should not return list of User Channels when non-matching requestUuid is passed', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let userChannels: Channel[] | undefined;

            const expectedChannel = createBrowserTypeChannel(mockedChannelId, 'user');

            instance
                .getUserChannels()
                .then(value => (userChannels = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.GetUserChannelsResponse = {
                meta: {
                    requestUuid: 'nonMatchingResponseUuid',
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    userChannels: [expectedChannel],
                },
                type: 'getUserChannelsResponse',
            };
            postMessage(responseMessage);

            await wait();
            expect(userChannels).toBeUndefined();
            expect(error).toBeUndefined();
        });

        it('should reject promise with same error message returned in response if one is provided', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let userChannels: Channel[] | undefined;

            const channelPromise = instance
                .getUserChannels()
                .then(value => (userChannels = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.GetUserChannelsResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.NoChannelFound,
                },
                type: 'getUserChannelsResponse',
            };
            postMessage(responseMessage);
            await channelPromise;

            expect(userChannels).toBeUndefined();
            expect(error).toEqual(ChannelError.NoChannelFound);
        });
    });

    describe('joinUserChannel', () => {
        it('should request to join app to specified user channel', async () => {
            const instance = await createInstance();

            instance.joinUserChannel(mockedChannelId);

            const expectedMessage: BrowserTypes.JoinUserChannelRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    channelId: mockedChannelId,
                },
                type: 'joinUserChannelRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should resolve the returned promise when the corresponding response message is received from the root agent', async () => {
            const instance = await createInstance();

            let error: Error | undefined;

            const responsePromise = instance.joinUserChannel(mockedChannelId).catch(err => (error = err));

            const responseMessage: BrowserTypes.JoinUserChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {},
                type: 'joinUserChannelResponse',
            };

            postMessage(responseMessage);
            await responsePromise;

            expect(error).toBeUndefined();
        });

        it('should reject promise with Error object with message chosen from ChannelError if an error occurs', async () => {
            const instance = await createInstance();

            let error: Error | undefined;

            const channelPromise = instance.joinUserChannel(mockedChannelId).catch(err => (error = err));
            const responseMessage: BrowserTypes.JoinUserChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.NoChannelFound,
                },
                type: 'joinUserChannelResponse',
            };
            postMessage(responseMessage);
            await channelPromise;

            expect(error).toEqual(ChannelError.NoChannelFound);
        });
    });

    describe('leaveCurrentChannel', () => {
        it('should request to remove app from any user channel', async () => {
            const instance = await createInstance();

            instance.leaveCurrentChannel();

            const expectedMessage: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: createExpectedRequestMeta(),
                payload: {},
                type: 'leaveCurrentChannelRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should resolve the returned promise when the corresponding response message is received from the root agent', async () => {
            const instance = await createInstance();

            let error: Error | undefined;

            const responsePromise = instance.leaveCurrentChannel().catch(err => (error = err));

            const responseMessage: BrowserTypes.LeaveCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {},
                type: 'leaveCurrentChannelResponse',
            };

            postMessage(responseMessage);
            await responsePromise;

            expect(error).toBeUndefined();
        });

        it('should reject promise with same error message returned in response if one is provided', async () => {
            const instance = await createInstance();

            let error: Error | undefined;

            const channelPromise = instance.leaveCurrentChannel().catch(err => (error = err));
            const responseMessage: BrowserTypes.LeaveCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.NoChannelFound,
                },
                type: 'leaveCurrentChannelResponse',
            };
            postMessage(responseMessage);
            await channelPromise;

            expect(error).toEqual(ChannelError.NoChannelFound);
        });
    });

    describe('getOrCreateChannel', () => {
        it('should request Channel object for specified channel', async () => {
            const instance = await createInstance();

            instance.getOrCreateChannel(mockedChannelId);

            const expectedMessage: BrowserTypes.GetOrCreateChannelRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    channelId: mockedChannelId,
                },
                type: 'getOrCreateChannelRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should return Channel object returned in response message', async () => {
            const instance = await createInstance();

            const channelPromise = instance.getOrCreateChannel(mockedChannelId);

            const responseChannel = createBrowserTypeChannel(mockedChannelId, 'app');
            const responseMessage: BrowserTypes.GetOrCreateChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: responseChannel,
                },
                type: 'getOrCreateChannelResponse',
            };
            postMessage(responseMessage);
            const channel = await channelPromise;

            compareChannels(channel, createMockChannel(responseChannel).mock);
        });

        it('should not return Channel object when non-matching requestUuid is passed', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let channel: Channel | undefined;

            instance
                .getOrCreateChannel(mockedChannelId)
                .then(value => (channel = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.GetOrCreateChannelResponse = {
                meta: {
                    requestUuid: 'nonMatchingResponseUuid',
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: Mock.create<Channel>().mock,
                },
                type: 'getOrCreateChannelResponse',
            };
            postMessage(responseMessage);

            await wait();
            expect(channel).toBeUndefined();
            expect(error).toBeUndefined();
        });

        it('should reject returned promise with Error object with message from ChannelError if channel cannot be created or access was denied', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let channel: Channel | undefined;

            const channelPromise = instance
                .getOrCreateChannel(mockedChannelId)
                .then(value => (channel = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.GetOrCreateChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.CreationFailed,
                },
                type: 'getOrCreateChannelResponse',
            };
            postMessage(responseMessage);
            await channelPromise;

            expect(channel).toBeUndefined();
            expect(error).toEqual(ChannelError.CreationFailed);
        });
    });

    // https://fdc3.finos.org/docs/api/ref/DesktopAgent#getcurrentchannel
    describe('getCurrentChannel', () => {
        it('should request Channel object for the current user channel', async () => {
            const expectedChannel = createMockChannel(createBrowserTypeChannel(mockedChannelId, 'user')).mock;
            mockedContextListener.setupFunction('getCurrentChannel', () => Promise.resolve(expectedChannel));

            const instance = await createInstance();

            await expect(instance.getCurrentChannel()).resolves.toBe(expectedChannel);
        });
    });

    describe('createPrivateChannel', () => {
        it('should request creation of private channel with auto-generated identity', async () => {
            const instance = await createInstance();

            instance.createPrivateChannel();

            const expectedMessage: BrowserTypes.CreatePrivateChannelRequest = {
                meta: createExpectedRequestMeta(),
                payload: {},
                type: 'createPrivateChannelRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should return channel returned in response', async () => {
            const instance = await createInstance();

            const channelPromise = instance.createPrivateChannel();

            const privateChannel: BrowserTypes.Channel = { id: mockedChannelId, type: 'private' };
            const responseMessage: BrowserTypes.CreatePrivateChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    privateChannel,
                },
                type: 'createPrivateChannelResponse',
            };
            postMessage(responseMessage);
            const channel = await channelPromise;

            compareChannels(channel, createMockPrivateChannel(privateChannel).mock);
        });

        it('should not return Private Channel object when non-matching requestUuid is passed', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let channel: Channel | undefined;

            instance
                .createPrivateChannel()
                .then(value => (channel = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.CreatePrivateChannelResponse = {
                meta: {
                    requestUuid: 'nonMatchingResponseUuid',
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    privateChannel: { id: mockedChannelId, type: 'private' },
                },
                type: 'createPrivateChannelResponse',
            };
            postMessage(responseMessage);

            await wait();
            expect(channel).toBeUndefined();
            expect(error).toBeUndefined();
        });

        it('should reject returned promise with Error object with message from ChannelError if PrivateChannel cannot be created', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let channel: Channel | undefined;

            const channelPromise = instance
                .createPrivateChannel()
                .then(value => (channel = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.CreatePrivateChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    error: ChannelError.CreationFailed,
                },
                type: 'createPrivateChannelResponse',
            };
            postMessage(responseMessage);
            await channelPromise;

            expect(channel).toBeUndefined();
            expect(error).toEqual(ChannelError.CreationFailed);
        });
    });

    //https://fdc3.finos.org/docs/api/ref/DesktopAgent#broadcast
    describe(`broadcast`, () => {
        it(`should call broadcast on current user channel if one is selected`, async () => {
            const instance = await createInstance();

            mockChannelSelection();

            const mockedChannel = createMockChannel(createBrowserTypeChannel('mockedBroadcastChannel', 'user'));
            mockedContextListener.setupFunction('getCurrentChannel', () => Promise.resolve(mockedChannel.mock));

            await instance.broadcast(contact);

            expect(mockedChannel.withFunction('broadcast').withParameters(contact)).wasCalledOnce();
        });

        it(`should not do anything if no user channel is currently selected`, async () => {
            const instance = await createInstance();

            await expect(instance.broadcast(contact)).resolves.toBeUndefined();
        });
    });

    //https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener
    describe('addContextListener', () => {
        let mockHandler: IMocked<{ handler: ContextHandler }>;

        beforeEach(() => {
            mockHandler = Mock.create<{ handler: ContextHandler }>().setup(setupFunction('handler'));
        });

        it(`should call addContextListener on contextListener`, async () => {
            const instance = await createInstance();
            const listener = Mock.create<Listener>().mock;
            mockedContextListener.setupFunction('addContextListener', () => Promise.resolve(listener));

            await expect(instance.addContextListener('fdc3.action', mockHandler.mock.handler)).resolves.toBe(listener);

            expect(mockedContextListener.withFunction('addContextListener')).wasCalledOnce();
        });
    });

    function mockChannelSelection() {
        awaitMessage(isGetCurrentChannelRequest).then(() => {
            const responseMessage: BrowserTypes.GetCurrentChannelResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    channel: { id: mockedChannelId, type: 'user' },
                },
                type: 'getCurrentChannelResponse',
            };

            postMessage(responseMessage);
        });
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

    function createExpectedRequestMeta(): BrowserTypes.AddContextListenerRequestMeta {
        return {
            requestUuid: mockedRequestUuid,
            timestamp: currentDate,
            source: appIdentifier,
        };
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

    function createMockPrivateChannel(channel: BrowserTypes.Channel): IMocked<PrivateChannel> {
        return createChannel<PrivateChannel>(channel).setup(
            setupProperty('displayMetadata', { name: 'privateChannel' }),
        );
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

    function compareChannels(one: Channel, two: Channel): void {
        const { broadcast: broadcastOne, addContextListener: listenerOne, ...partialChannelOne } = one;
        const { broadcast: broadcastTwo, addContextListener: listenerTwo, ...partialChannelTwo } = two;

        expect(partialChannelOne).toEqual(partialChannelTwo);
    }

    /**
     * pushes a message to any subscribers of the Mock messaging provider
     */
    function postMessage(message: ResponseMessage | EventMessage): void {
        mockMessagingProvider.functionCallLookup.addResponseHandler?.forEach(params => params[0]({ payload: message }));
    }
});

async function wait(delay: number = 50): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
}
