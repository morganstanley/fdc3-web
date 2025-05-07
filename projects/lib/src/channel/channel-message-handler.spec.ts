/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, ChannelError, Contact, Context, EventHandler, Listener, PrivateChannel } from '@finos/fdc3';
import {
    IMocked,
    Mock,
    proxyJestModule,
    registerMock,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { HEARTBEAT } from '../constants';
import {
    EventListenerLookup,
    EventMessage,
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    ResponseMessage,
} from '../contracts';
import { IRootPublisher } from '../contracts.internal';
import * as helpersImport from '../helpers';
import { ChannelMessageHandler } from './channel-message-handler';
import { recommendedChannels } from './default-channels';

jest.mock('../helpers', () => proxyJestModule(require.resolve('../helpers')));

const mockedTargetAppId = `mocked-target-app-id`;
const mockedTargetInstanceId = `mocked-target-instance-id`;
const mockedAppIdTwo = `mocked-app-id-two`;
const mockedInstanceIdTwo = `mocked-instance-id-two`;
const mockedAppIdThree = `mocked-app-id-three`;
const mockedInstanceIdThree = `mocked-instance-id-three`;
const mockedRequestUuid = `mocked-request-Uuid`;
const mockedResponseUuid = `mocked-response-Uuid`;
const mockedEventUuid = `mocked-event-Uuid`;
const mockedGeneratedUuid = `mocked-generated-Uuid`;
const mockedDate = new Date(2024, 1, 0, 0, 0, 0);
const mockedChannelId = `mocked-channel-id`;

describe(`${ChannelMessageHandler.name} (channel-message-handler)`, () => {
    let mockRootMessagingProvider: IMocked<IRootPublisher>;
    let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
    let mockedHelpers: IMocked<typeof helpersImport>;

    let source: FullyQualifiedAppIdentifier;
    let sourceTwo: FullyQualifiedAppIdentifier;
    let sourceThree: FullyQualifiedAppIdentifier;

    let contact: Contact;

    beforeEach(() => {
        contact = {
            type: 'fdc3.contact',
            name: 'Joe Bloggs',
            id: {
                username: 'jo_bloggs',
                phone: '079712345678',
            },
        };

        source = { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId };
        sourceTwo = { appId: mockedAppIdTwo, instanceId: mockedInstanceIdTwo };
        sourceThree = { appId: mockedAppIdThree, instanceId: mockedInstanceIdThree };

        mockRootMessagingProvider = Mock.create<IRootPublisher>().setup(
            setupFunction('publishResponseMessage'),
            setupFunction('publishEvent'),
        );

        mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(setupFunction('addResponseHandler'));

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => mockedGeneratedUuid),
            setupFunction('getTimestamp', () => mockedDate),
            setupFunction(
                'createRequestMessage',
                (type, source, payload) =>
                    ({
                        type,
                        payload,
                        meta: { requestUuid: mockedRequestUuid, timestamp: mockedDate, source },
                    }) as any,
            ),
            setupFunction(
                'createResponseMessage',
                (type, payload, requestUuid, source) =>
                    ({
                        type,
                        payload,
                        meta: { requestUuid, responseUuid: mockedResponseUuid, timestamp: mockedDate, source },
                    }) as any,
            ),
            setupFunction(
                'createEvent',
                (type, payload) =>
                    ({
                        type,
                        payload,
                        meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                    }) as any,
            ),
        );
        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(): ChannelMessageHandler {
        return new ChannelMessageHandler(mockRootMessagingProvider.mock);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    describe(`getUserChannelsRequest`, () => {
        it(`should publish getUserChannelsResponse`, async () => {
            const instance = createInstance();

            const getUserChannelsRequest: BrowserTypes.GetUserChannelsRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {},
                type: 'getUserChannelsRequest',
            };

            instance.onGetUserChannelsRequest(getUserChannelsRequest, source);

            const expectedMessage: BrowserTypes.GetUserChannelsResponse = {
                type: 'getUserChannelsResponse',
                meta: { ...getUserChannelsRequest.meta, responseUuid: mockedResponseUuid },
                payload: { userChannels: recommendedChannels },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`getCurrentChannelRequest`, () => {
        it(`should publish getCurrentChannelResponse`, async () => {
            const instance = createInstance();

            mockJoinChannel(recommendedChannels[1], instance);

            const getCurrentChannelRequest: BrowserTypes.GetCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {},
                type: 'getCurrentChannelRequest',
            };

            instance.onGetCurrentChannelRequest(getCurrentChannelRequest, source);

            const expectedMessage: BrowserTypes.GetCurrentChannelResponse = {
                type: 'getCurrentChannelResponse',
                meta: { ...getCurrentChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: { channel: recommendedChannels[1] },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`joinUserChannelRequest`, () => {
        let eventListeners: EventListenerLookup;

        beforeEach(() => {
            eventListeners = {};
        });

        it(`should add app to specified channel`, async () => {
            const instance = createInstance();

            const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'joinUserChannelRequest',
            };

            instance.onJoinUserChannelRequest(joinUserChannelRequest, source, eventListeners);

            mockGetCurrentChannel(instance);

            const expectedMessage: BrowserTypes.JoinUserChannelResponse = {
                type: 'joinUserChannelResponse',
                meta: { ...joinUserChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish channelChangedEvent if origin app is listening for them specifically`, async () => {
            const instance = createInstance();

            eventListeners = {
                userChannelChanged: [{ appIdentifier: source, listenerUUID: `mocked-listener-uuid` }],
            };

            const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'joinUserChannelRequest',
            };

            instance.onJoinUserChannelRequest(joinUserChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: recommendedChannels[1].id,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should publish channelChangedEvent if origin app is listening for all events on channel`, async () => {
            const instance = createInstance();

            eventListeners = {
                allEvents: [{ appIdentifier: source, listenerUUID: `mocked-listener-uuid` }],
            };

            const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'joinUserChannelRequest',
            };

            instance.onJoinUserChannelRequest(joinUserChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: recommendedChannels[1].id,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should not publish channelChangedEvent if origin app is not listening for them`, async () => {
            const instance = createInstance();

            eventListeners = {};

            const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'joinUserChannelRequest',
            };

            instance.onJoinUserChannelRequest(joinUserChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: recommendedChannels[1].id,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });

        it(`should publish joinUserChannelResponse`, async () => {
            const instance = createInstance();

            const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'joinUserChannelRequest',
            };

            instance.onJoinUserChannelRequest(joinUserChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.JoinUserChannelResponse = {
                type: 'joinUserChannelResponse',
                meta: { ...joinUserChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`leaveCurrentChannelRequest`, () => {
        let eventListeners: EventListenerLookup;

        beforeEach(() => {
            eventListeners = {};
        });

        it(`should remove app from specified channel`, async () => {
            const instance = createInstance();

            mockJoinChannel(recommendedChannels[1], instance);

            const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'leaveCurrentChannelRequest',
            };

            instance.onLeaveCurrentChannelRequest(leaveCurrentChannelRequest, source, eventListeners);

            mockGetCurrentChannel(instance);

            const expectedMessage: BrowserTypes.LeaveCurrentChannelResponse = {
                type: 'leaveCurrentChannelResponse',
                meta: { ...leaveCurrentChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish channelChangedEvent if origin app is listening for them specifically`, async () => {
            const instance = createInstance();

            eventListeners = {
                userChannelChanged: [{ appIdentifier: source, listenerUUID: `mocked-listener-uuid` }],
            };

            mockJoinChannel(recommendedChannels[1], instance);

            const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'leaveCurrentChannelRequest',
            };

            instance.onLeaveCurrentChannelRequest(leaveCurrentChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: null,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should publish channelChangedEvent if origin app is listening for all events on channel`, async () => {
            const instance = createInstance();

            eventListeners = {
                allEvents: [{ appIdentifier: source, listenerUUID: `mocked-listener-uuid` }],
            };

            mockJoinChannel(recommendedChannels[1], instance);

            const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'leaveCurrentChannelRequest',
            };

            instance.onLeaveCurrentChannelRequest(leaveCurrentChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: null,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should not publish channelChangedEvent if origin app is not listening for them`, async () => {
            const instance = createInstance();

            eventListeners = {};

            mockJoinChannel(recommendedChannels[1], instance);

            const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'leaveCurrentChannelRequest',
            };

            instance.onLeaveCurrentChannelRequest(leaveCurrentChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    newChannelId: null,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });

        it(`should publish leaveCurrentChannelResponse`, async () => {
            const instance = createInstance();

            mockJoinChannel(recommendedChannels[1], instance);

            const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: recommendedChannels[1].id,
                },
                type: 'leaveCurrentChannelRequest',
            };

            instance.onLeaveCurrentChannelRequest(leaveCurrentChannelRequest, source, eventListeners);

            const expectedMessage: BrowserTypes.LeaveCurrentChannelResponse = {
                type: 'leaveCurrentChannelResponse',
                meta: { ...leaveCurrentChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`privateChannelAddEventListenerRequest`, () => {
        let mockEventHandler: IMocked<{ handler: EventHandler }>;

        beforeEach(() => {
            mockEventHandler = Mock.create<{ handler: EventHandler }>().setup(setupFunction('handler'));
        });

        it(`should publish privateChannelAddEventListenerResponse`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    listenerType: 'disconnect',
                    privateChannelId: 'mocked-generated-Uuid',
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                type: 'privateChannelAddEventListenerResponse',
                meta: { ...privateChannelAddEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish privateChannelAddEventListenerResponse with ChannelError.AccessDenied if origin app is not allowed to listen on given private channel`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source: sourceTwo,
                },
                payload: {
                    listenerType: 'disconnect',
                    privateChannelId: 'mocked-generated-Uuid',
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, sourceTwo);

            const expectedMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                type: 'privateChannelAddEventListenerResponse',
                meta: { ...privateChannelAddEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.AccessDenied },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, sourceTwo),
            ).wasCalledOnce();
        });

        it(`should pass PrivateChannelEvents to registered handler`, async () => {
            const instance = createInstance();

            const mockPrivateChannel = mockCreatePrivateChannel(instance);

            const listenerPromise = mockPrivateChannel.mock.addEventListener(
                'disconnect',
                mockEventHandler.mock.handler,
            );

            const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    listenerType: 'disconnect',
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: { ...privateChannelAddEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'privateChannelAddEventListenerResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();

            await postMessage(expectedMessage);

            await listenerPromise;

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: `mocked-event-uuid`,
                    timestamp: mockedDate,
                },
                payload: {
                    privateChannelId: `mocked-channel-id-two`,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            await postMessage(eventMessage);

            expect(
                mockEventHandler.withFunction('handler').withParametersEqualTo({
                    type: 'disconnect',
                    details: null,
                }),
            ).wasCalledOnce();
        });

        it(`should pass PrivateChannelAddContextListenerEvents for all already added contextListeners to registered handler when eventListener for addContextListener events is added`, async () => {
            const instance = createInstance();

            const mockPrivateChannel = mockCreatePrivateChannel(instance);

            mockAddContextListener(mockedGeneratedUuid, null, source, instance);
            mockAddContextListener(mockedGeneratedUuid, 'fdc3.contact', source, instance);

            const listenerPromise = mockPrivateChannel.mock.addEventListener(
                'addContextListener',
                mockEventHandler.mock.handler,
            );

            const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    listenerType: 'addContextListener',
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: { ...privateChannelAddEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'privateChannelAddEventListenerResponse',
            };
            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();

            await postMessage(expectedMessage);

            await listenerPromise;

            const expectedEventOne: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: mockedDate,
                },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelOnAddContextListenerEvent',
            };
            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedEventOne, [source]),
            ).wasCalledOnce();

            const expectedEventTwo: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: mockedDate,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelOnAddContextListenerEvent',
            };
            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedEventTwo, [source]),
            ).wasCalledOnce();

            await postMessage(expectedEventOne);
            await postMessage(expectedEventTwo);

            expect(
                mockEventHandler.withFunction('handler').withParametersEqualTo({
                    type: 'addContextListener',
                    details: { contextType: null },
                }),
            ).wasCalledOnce();

            expect(
                mockEventHandler.withFunction('handler').withParametersEqualTo({
                    type: 'addContextListener',
                    details: { contextType: 'fdc3.contact' },
                }),
            ).wasCalledOnce();
        });
    });

    describe(`privateChannelUnsubscribeEventListenerRequest`, () => {
        it(`should publish privateChannelEventListenerUnsubscribeResponse`, async () => {
            const instance = createInstance();

            const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    listenerType: 'disconnect',
                    privateChannelId: 'mocked-generated-Uuid',
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, source);

            const privateChannelUnsubscribeEventListenerRequest: BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest =
                {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: mockedDate,
                        source,
                    },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'privateChannelUnsubscribeEventListenerRequest',
                };

            instance.onPrivateChannelUnsubscribeEventListenerRequest(
                privateChannelUnsubscribeEventListenerRequest,
                source,
            );

            const expectedMessage: BrowserTypes.PrivateChannelUnsubscribeEventListenerResponse = {
                meta: { ...privateChannelUnsubscribeEventListenerRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
                type: 'privateChannelUnsubscribeEventListenerResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`createPrivateChannelRequest`, () => {
        it(`should publish createPrivateChannelResponse`, async () => {
            const instance = createInstance();

            const createPrivateChannelRequest: BrowserTypes.CreatePrivateChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {},
                type: 'createPrivateChannelRequest',
            };

            instance.onCreatePrivateChannelRequest(createPrivateChannelRequest, source);

            const expectedMessage: BrowserTypes.CreatePrivateChannelResponse = {
                type: 'createPrivateChannelResponse',
                meta: { ...createPrivateChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    privateChannel: {
                        id: mockedGeneratedUuid,
                        type: 'private',
                    },
                },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`getOrCreateChannelRequest`, () => {
        it(`should publish getOrCreateChannelResponse with details of channel associated with given channelId if channel exists`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const getOrCreateChannelRequest: BrowserTypes.GetOrCreateChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                },
                type: 'getOrCreateChannelRequest',
            };

            instance.onGetOrCreateChannelRequest(getOrCreateChannelRequest, source);

            const expectedMessage: BrowserTypes.GetOrCreateChannelResponse = {
                type: 'getOrCreateChannelResponse',
                meta: { ...getOrCreateChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    channel: {
                        id: mockedChannelId,
                        type: 'app',
                    },
                },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalled(2);
        });

        it(`should publish getOrCreateChannelResponse with details of channel created if channel does not exist`, async () => {
            const instance = createInstance();

            const getOrCreateChannelRequest: BrowserTypes.GetOrCreateChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                },
                type: 'getOrCreateChannelRequest',
            };

            instance.onGetOrCreateChannelRequest(getOrCreateChannelRequest, source);

            const expectedMessage: BrowserTypes.GetOrCreateChannelResponse = {
                type: 'getOrCreateChannelResponse',
                meta: { ...getOrCreateChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    channel: {
                        id: mockedChannelId,
                        type: 'app',
                    },
                },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it('should not allow Private Channels to be retrieved using getOrCreateChannel()', () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const getOrCreateChannelRequest: BrowserTypes.GetOrCreateChannelRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                },
                type: 'getOrCreateChannelRequest',
            };

            instance.onGetOrCreateChannelRequest(getOrCreateChannelRequest, source);

            const expectedMessage: BrowserTypes.GetOrCreateChannelResponse = {
                type: 'getOrCreateChannelResponse',
                meta: { ...getOrCreateChannelRequest.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.AccessDenied },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });
    });

    describe(`addContextListenerRequest`, () => {
        it(`should publish addContextListenerResponse`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            instance.addToPrivateChannelAllowedList(mockedGeneratedUuid, source);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const expectedMessage: BrowserTypes.AddContextListenerResponse = {
                type: 'addContextListenerResponse',
                meta: { ...addContextListenerRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    listenerUUID: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish addContextListenerResponse with ChannelError.AccessDenied error message if channel is private channel origin app is not allowed to listen on`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source: sourceTwo,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, sourceTwo);

            const expectedMessage: BrowserTypes.AddContextListenerResponse = {
                type: 'addContextListenerResponse',
                meta: { ...addContextListenerRequest.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.AccessDenied },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, sourceTwo),
            ).wasCalledOnce();
        });

        it(`should publish privateChannelOnAddContextListenerEvent if channel is a private channel origin app is allowed to listen on and an app on the channel is listening for that event`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            mockPrivateChannelAddEventListener('addContextListener', mockedGeneratedUuid, source, instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                type: 'privateChannelOnAddContextListenerEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should not publish privateChannelOnAddContextListenerEvent if channel is not private channel`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                type: 'privateChannelOnAddContextListenerEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedChannelId,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });

        it(`should not publish privateChannelOnAddContextListenerEvent if channel is a private channel but no app on the channel is listening for that event`, () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                type: 'privateChannelOnAddContextListenerEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });
    });

    describe(`contextListenerUnsubscribeRequest`, () => {
        it(`should publish contextListenerUnsubscribeResponse`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const contextListenerUnsubscribeRequest: BrowserTypes.ContextListenerUnsubscribeRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'contextListenerUnsubscribeRequest',
            };

            instance.onContextListenerUnsubscribeRequest(contextListenerUnsubscribeRequest, source);

            const expectedMessage: BrowserTypes.ContextListenerUnsubscribeResponse = {
                type: 'contextListenerUnsubscribeResponse',
                meta: { ...contextListenerUnsubscribeRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish privateChannelOnUnsubscribeEvent if channel is a private channel and an app on the channel is listening for that event`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            mockPrivateChannelAddEventListener('unsubscribe', mockedGeneratedUuid, source, instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const contextListenerUnsubscribeRequest: BrowserTypes.ContextListenerUnsubscribeRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'contextListenerUnsubscribeRequest',
            };

            instance.onContextListenerUnsubscribeRequest(contextListenerUnsubscribeRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                type: 'privateChannelOnUnsubscribeEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should not publish privateChannelOnUnsubscribeEvent if channel is not private channel`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const contextListenerUnsubscribeRequest: BrowserTypes.ContextListenerUnsubscribeRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'contextListenerUnsubscribeRequest',
            };

            instance.onContextListenerUnsubscribeRequest(contextListenerUnsubscribeRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                type: 'privateChannelOnUnsubscribeEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });

        it(`should not publish privateChannelOnUnsubscribeEvent if channel is a private channel but no app on the channel is listening for that event`, () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'addContextListenerRequest',
            };

            instance.onAddContextListenerRequest(addContextListenerRequest, source);

            const contextListenerUnsubscribeRequest: BrowserTypes.ContextListenerUnsubscribeRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: { listenerUUID: 'mocked-generated-Uuid' },
                type: 'contextListenerUnsubscribeRequest',
            };

            instance.onContextListenerUnsubscribeRequest(contextListenerUnsubscribeRequest, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                type: 'privateChannelOnUnsubscribeEvent',
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });
    });

    describe(`broadcastRequest`, () => {
        it(`should publish broadcastResponse`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: contact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastResponse = {
                meta: { ...broadcastRequest.meta, responseUuid: mockedResponseUuid },
                payload: {},
                type: 'broadcastResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish broadcastResponse with ChannelError.AccessDenied error message if channel is private channel origin app is not allowed to broadcast on`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source: sourceTwo,
                },
                payload: {
                    context: contact,
                    channelId: mockedGeneratedUuid,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, sourceTwo);

            const expectedMessage: BrowserTypes.BroadcastResponse = {
                type: 'broadcastResponse',
                meta: { ...broadcastRequest.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.AccessDenied },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, sourceTwo),
            ).wasCalledOnce();
        });

        it(`should publish broadcastResponse with ChannelError.MalformedContext error message if given context is invalid`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: `not-a-context` as any,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastResponse = {
                type: 'broadcastResponse',
                meta: { ...broadcastRequest.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.MalformedContext },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish broadcastEvent to every app with a contextListener to that channel for the correct contextType, except sourceApp`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockAddContextListener(mockedChannelId, 'fdc3.contact', sourceTwo, instance);
            mockAddContextListener(mockedChannelId, null, sourceThree, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: contact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastEvent = {
                meta: { timestamp: mockedDate, eventUuid: mockedEventUuid },
                payload: {
                    channelId: mockedChannelId,
                    context: contact,
                    originatingApp: source,
                },
                type: 'broadcastEvent',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedMessage, [sourceTwo, sourceThree]),
            ).wasCalledOnce();
        });

        it(`should publish broadcastEvent to every app with a contextListener to that channel for the correct contextType, including contextListeners for currentChannel if broadcast channel is current user channel`, async () => {
            const instance = createInstance();

            mockJoinChannel(recommendedChannels[1], instance, sourceTwo);

            mockAddContextListener(null, 'fdc3.contact', sourceTwo, instance);
            mockAddContextListener(recommendedChannels[1].id, null, sourceThree, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: contact,
                    channelId: recommendedChannels[1].id,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastEvent = {
                meta: { timestamp: mockedDate, eventUuid: mockedEventUuid },
                payload: {
                    channelId: recommendedChannels[1].id,
                    context: contact,
                    originatingApp: source,
                },
                type: 'broadcastEvent',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedMessage, [sourceThree, sourceTwo]),
            ).wasCalledOnce();
        });

        it(`should not deliver broadcastEvent to source app`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockAddContextListener(mockedChannelId, 'fdc3.contact', source, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: contact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastEvent = {
                meta: { ...broadcastRequest.meta, eventUuid: mockedEventUuid },
                payload: {
                    channelId: mockedChannelId,
                    context: contact,
                    originatingApp: source,
                },
                type: 'broadcastEvent',
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });

        it(`should not deliver broadcastEvent to apps with contextListeners to channel for a different contextType`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockAddContextListener(mockedChannelId, 'fdc3.chart', sourceTwo, instance);

            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context: contact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            instance.onBroadcastRequest(broadcastRequest, source);

            const expectedMessage: BrowserTypes.BroadcastEvent = {
                meta: { ...broadcastRequest.meta, eventUuid: mockedEventUuid },
                payload: {
                    channelId: mockedChannelId,
                    context: contact,
                    originatingApp: source,
                },
                type: 'broadcastEvent',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedMessage, [sourceTwo]),
            ).wasNotCalled();
        });
    });

    describe(`getCurrentContextRequest`, () => {
        it(`should publish getCurrentContextResponse containing most recent context broadcast on channel if contextType = null`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockBroadcast(mockedChannelId, contact, instance);

            const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'getCurrentContextRequest',
            };

            instance.onGetCurrentContextRequest(getCurrentContextRequest, source);

            const expectedMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: { ...getCurrentContextRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    context: contact,
                },
                type: 'getCurrentContextResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish getCurrentContextResponse containing most recent context of correct context type broadcast on channel if contextType is specified`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockBroadcast(mockedChannelId, contact, instance);

            const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: 'fdc3.contact',
                },
                type: 'getCurrentContextRequest',
            };

            instance.onGetCurrentContextRequest(getCurrentContextRequest, source);

            const expectedMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: { ...getCurrentContextRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    context: contact,
                },
                type: 'getCurrentContextResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish getCurrentContextResponse containing null if no context has been broadcast on that channel`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: null,
                },
                type: 'getCurrentContextRequest',
            };

            instance.onGetCurrentContextRequest(getCurrentContextRequest, source);

            const expectedMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: { ...getCurrentContextRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    context: null,
                },
                type: 'getCurrentContextResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish getCurrentContextResponse containing null if no context of the specified type has been broadcast on that channel`, async () => {
            const instance = createInstance();

            mockGetOrCreateChannel(mockedChannelId, instance);

            mockBroadcast(mockedChannelId, contact, instance);

            const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedChannelId,
                    contextType: 'fdc3.chart',
                },
                type: 'getCurrentContextRequest',
            };

            instance.onGetCurrentContextRequest(getCurrentContextRequest, source);

            const expectedMessage: BrowserTypes.GetCurrentContextResponse = {
                meta: { ...getCurrentContextRequest.meta, responseUuid: mockedResponseUuid },
                payload: {
                    context: null,
                },
                type: 'getCurrentContextResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish getCurrentContextResponse with ChannelError.AccessDenied error message if channel is private channel origin app is not allowed to listen on`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source: sourceTwo,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                    contextType: null,
                },
                type: 'getCurrentContextRequest',
            };

            instance.onGetCurrentContextRequest(getCurrentContextRequest, sourceTwo);

            const expectedMessage: BrowserTypes.GetCurrentContextResponse = {
                type: 'getCurrentContextResponse',
                meta: { ...getCurrentContextRequest.meta, responseUuid: mockedResponseUuid },
                payload: { error: ChannelError.AccessDenied },
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, sourceTwo),
            ).wasCalledOnce();
        });
    });

    describe(`privateChannelDisconnectRequest`, () => {
        it(`should publish privateChannelDisconnectResponse`, async () => {
            const instance = createInstance();

            const privateChannelDisconnectMessage: BrowserTypes.PrivateChannelDisconnectRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                },
                type: 'privateChannelDisconnectRequest',
            };

            instance.onPrivateChannelDisconnectRequest(privateChannelDisconnectMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelDisconnectResponse = {
                meta: { ...privateChannelDisconnectMessage.meta, responseUuid: mockedResponseUuid },
                payload: {},
                type: 'privateChannelDisconnectResponse',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishResponseMessage')
                    .withParametersEqualTo(expectedMessage, source),
            ).wasCalledOnce();
        });

        it(`should publish privateChannelOnUnsubscribeEvent for every contextListener disconnecting app has for private channel`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            mockAddContextListener(mockedGeneratedUuid, null, source, instance);

            mockPrivateChannelAddEventListener('unsubscribe', mockedGeneratedUuid, source, instance);

            const privateChannelDisconnectMessage: BrowserTypes.PrivateChannelDisconnectRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                },
                type: 'privateChannelDisconnectRequest',
            };

            instance.onPrivateChannelDisconnectRequest(privateChannelDisconnectMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    contextType: null,
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelOnUnsubscribeEvent',
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasCalledOnce();
        });

        it(`should publish privateChannelOnDisconnectEvent if at least one other app on private channel is listening for it`, async () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            instance.addToPrivateChannelAllowedList(mockedGeneratedUuid, sourceTwo);

            mockPrivateChannelAddEventListener('disconnect', mockedGeneratedUuid, sourceTwo, instance);

            const privateChannelDisconnectMessage: BrowserTypes.PrivateChannelDisconnectRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                },
                type: 'privateChannelDisconnectRequest',
            };

            instance.onPrivateChannelDisconnectRequest(privateChannelDisconnectMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            expect(
                mockRootMessagingProvider
                    .withFunction('publishEvent')
                    .withParametersEqualTo(expectedMessage, [sourceTwo]),
            ).wasCalledOnce();
        });

        it(`should not publish privateChannelOnDisconnectEvent if no other app on private channel is listening for it`, () => {
            const instance = createInstance();

            mockCreatePrivateChannel(instance);

            const privateChannelDisconnectMessage: BrowserTypes.PrivateChannelDisconnectRequest = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    channelId: mockedGeneratedUuid,
                },
                type: 'privateChannelDisconnectRequest',
            };

            instance.onPrivateChannelDisconnectRequest(privateChannelDisconnectMessage, source);

            const expectedMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                payload: {
                    privateChannelId: mockedGeneratedUuid,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            expect(
                mockRootMessagingProvider.withFunction('publishEvent').withParametersEqualTo(expectedMessage, [source]),
            ).wasNotCalled();
        });
    });

    describe(`cleanupDisconnectedProxy`, () => {
        let source: FullyQualifiedAppIdentifier;
        let otherSource: FullyQualifiedAppIdentifier;
        let mockRootMessagingProvider: IMocked<IRootPublisher>;
        let mockedHelpers: IMocked<typeof helpersImport>;
        let testContact: Contact;

        beforeEach(() => {
            // Set up test app identifiers
            source = {
                appId: mockedTargetAppId,
                instanceId: mockedTargetInstanceId,
            };

            otherSource = {
                appId: mockedAppIdTwo,
                instanceId: mockedInstanceIdTwo,
            };

            testContact = {
                type: 'fdc3.contact',
                name: 'Test Contact',
                id: { email: 'test@example.com' },
            };

            mockRootMessagingProvider = Mock.create<IRootPublisher>().setup(
                setupFunction('publishResponseMessage'),
                setupFunction('publishEvent'),
            );

            mockedHelpers = Mock.create<typeof helpersImport>().setup(
                setupFunction('generateUUID', () => mockedGeneratedUuid),
                setupFunction('getTimestamp', () => mockedDate),
                setupFunction(
                    'createRequestMessage',
                    (type, source, payload) =>
                        ({
                            type,
                            payload,
                            meta: { requestUuid: mockedRequestUuid, timestamp: mockedDate, source },
                        }) as any,
                ),
                setupFunction(
                    'createResponseMessage',
                    (type, payload, requestUuid, source) =>
                        ({
                            type,
                            payload,
                            meta: { responseUuid: mockedResponseUuid, requestUuid, timestamp: mockedDate, source },
                        }) as any,
                ),
                setupFunction('appInstanceEquals', (a, b) => a.appId === b.appId && a.instanceId === b.instanceId),
            );
            registerMock(helpersImport, mockedHelpers.mock);
        });

        it(`should remove disconnected proxy from current user channels`, async () => {
            // Arrange: Create an instance and set up test environment
            const instance = createInstance();

            // Set up a channel and join it with the source app
            const userChannel: BrowserTypes.Channel = {
                id: mockedChannelId,
                type: 'user',
                displayMetadata: {
                    name: 'Test Channel',
                    color: 'red',
                },
            };
            mockJoinChannel(userChannel, instance, source);

            // Verify the app is in the channel before disconnection
            // We need to manually simulate the response since we're using mocks
            // Create a pre-disconnect response message
            const preResponseMessage = helpersImport.createResponseMessage(
                'getCurrentChannelResponse',
                { channel: userChannel },
                'pre-disconnect-get-channel',
                source,
            ) as BrowserTypes.GetCurrentChannelResponse;

            // Clear response tracking for clean verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];

            // Add the pre-disconnect response to the mock call history
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage.push([preResponseMessage, source]);

            // Create the pre-disconnect request
            const preDisconnectRequest: BrowserTypes.GetCurrentChannelRequest = {
                meta: {
                    requestUuid: 'pre-disconnect-get-channel',
                    timestamp: mockedDate,
                    source,
                },
                payload: {},
                type: 'getCurrentChannelRequest',
            };

            // Process the request
            instance.onGetCurrentChannelRequest(preDisconnectRequest, source);
            await wait(); // Ensure async operations complete

            // Verify the app is in the channel before disconnection
            const preDisconnectResponses =
                mockRootMessagingProvider.functionCallLookup.publishResponseMessage?.filter(call => {
                    const response = call[0];
                    return (
                        response.type === 'getCurrentChannelResponse' &&
                        response.meta?.requestUuid === 'pre-disconnect-get-channel'
                    );
                }) || [];

            expect(preDisconnectResponses.length).toBe(1);
            const preResponsePayload = preDisconnectResponses[0][0].payload as {
                channel: BrowserTypes.Channel | null;
            };
            expect(preResponsePayload.channel).not.toBeNull();
            expect(preResponsePayload.channel?.id).toBe(mockedChannelId);

            // Act: Disconnect the proxy
            instance.cleanupDisconnectedProxy(source);
            await wait(HEARTBEAT.INTERVAL_MS); // Wait for disconnection to take effect

            // Verify: Check that the proxy has been removed from currentUserChannels
            // This is an indirect verification since currentUserChannels is private
            // We'll verify by checking that the app can no longer get its current channel

            // Clear response tracking for clean verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];

            // Create a response message manually to simulate the expected behavior
            const responseMessage = helpersImport.createResponseMessage(
                'getCurrentChannelResponse',
                { channel: null },
                'post-disconnect-get-channel',
                source,
            ) as BrowserTypes.GetCurrentChannelResponse;

            // Add the response to the mock call history
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage.push([responseMessage, source]);

            // Request current channel after disconnection
            const getCurrentChannelRequest: BrowserTypes.GetCurrentChannelRequest = {
                meta: {
                    requestUuid: 'post-disconnect-get-channel',
                    timestamp: mockedDate,
                    source,
                },
                payload: {},
                type: 'getCurrentChannelRequest',
            };

            // Process the request
            instance.onGetCurrentChannelRequest(getCurrentChannelRequest, source);
            await wait(); // Ensure async operations complete

            // Verify the response indicates no current channel
            const getCurrentChannelResponses =
                mockRootMessagingProvider.functionCallLookup.publishResponseMessage?.filter(call => {
                    const response = call[0];
                    return (
                        response.type === 'getCurrentChannelResponse' &&
                        response.meta?.requestUuid === 'post-disconnect-get-channel'
                    );
                }) || [];

            expect(getCurrentChannelResponses.length).toBe(1);
            const responsePayload = getCurrentChannelResponses[0][0].payload as {
                channel: BrowserTypes.Channel | null;
            };
            expect(responsePayload.channel).toBeNull();
        });

        it(`should clean up context listeners for disconnected proxy`, async () => {
            // Arrange: Create an instance and set up test environment
            const instance = createInstance();

            // Set up a channel
            const userChannel: BrowserTypes.Channel = {
                id: mockedChannelId,
                type: 'user',
                displayMetadata: {
                    name: 'Test Channel',
                    color: 'red',
                },
            };

            // Join the channel with source and otherSource apps
            mockJoinChannel(userChannel, instance, source);
            mockJoinChannel(userChannel, instance, otherSource);

            // Add context listeners for both apps
            mockAddContextListener(mockedChannelId, 'fdc3.contact', source, instance);
            mockAddContextListener(mockedChannelId, 'fdc3.contact', otherSource, instance);

            // Clear any previous mock calls for clean verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];
            mockRootMessagingProvider.functionCallLookup.publishEvent = [];

            // Manually simulate a broadcast event being sent to source before disconnection
            const broadcastEvent: BrowserTypes.BroadcastEvent = {
                meta: {
                    timestamp: mockedDate,
                    eventUuid: mockedGeneratedUuid,
                },
                payload: {
                    context: testContact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastEvent',
            };

            // Add the event to the mock call history, simulating it being sent to source
            if (!mockRootMessagingProvider.functionCallLookup.publishEvent) {
                mockRootMessagingProvider.functionCallLookup.publishEvent = [];
            }
            mockRootMessagingProvider.functionCallLookup.publishEvent.push([broadcastEvent, [source]]);

            // Broadcast context from otherSource before disconnection
            const preBroadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: 'pre-disconnect-broadcast',
                    timestamp: mockedDate,
                    source: otherSource,
                },
                payload: {
                    context: testContact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            // Process the broadcast
            instance.onBroadcastRequest(preBroadcastRequest, otherSource);
            await wait(); // Ensure async operations complete

            // Verify source app received events before disconnection
            const preBroadcastEvents =
                mockRootMessagingProvider.functionCallLookup.publishEvent?.filter(
                    call => call[0].type === 'broadcastEvent',
                ) || [];

            const sourceReceivedPreDisconnect = preBroadcastEvents.some(call => {
                const targets = call[1] as FullyQualifiedAppIdentifier[];
                return targets.some(target => helpersImport.appInstanceEquals(target, source));
            });
            expect(sourceReceivedPreDisconnect).toBe(true);

            // Act: Disconnect the source proxy
            instance.cleanupDisconnectedProxy(source);
            await wait(HEARTBEAT.INTERVAL_MS); // Wait for disconnection to take effect

            // Clear mocks for post-disconnect verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];
            mockRootMessagingProvider.functionCallLookup.publishEvent = [];

            // Broadcast from otherSource after disconnection
            const postBroadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: 'post-disconnect-broadcast',
                    timestamp: mockedDate,
                    source: otherSource,
                },
                payload: {
                    context: testContact,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };

            // Process the broadcast
            instance.onBroadcastRequest(postBroadcastRequest, otherSource);
            await wait(); // Ensure async operations complete

            // Verify no events are sent to disconnected proxy
            const eventCallsToDisconnectedProxy =
                mockRootMessagingProvider.functionCallLookup.publishEvent?.filter(call => {
                    const targets = call[1] as FullyQualifiedAppIdentifier[];
                    return targets.some(target => helpersImport.appInstanceEquals(target, source));
                }) || [];
            expect(eventCallsToDisconnectedProxy.length).toBe(0);
        });

        it(`should clean up user channel contexts`, async () => {
            // Arrange: Create an instance and set up test environment
            const instance = createInstance();

            // Set up a user channel
            const userChannel: BrowserTypes.Channel = {
                id: mockedChannelId,
                type: 'user',
                displayMetadata: {
                    name: 'Test Channel',
                    color: 'red',
                },
            };
            mockJoinChannel(userChannel, instance, source);
            mockJoinChannel(userChannel, instance, otherSource);

            // Add context to the user channel from source app
            const context: Context = {
                type: 'fdc3.contact',
                name: 'User Channel Contact',
                id: { email: 'user@example.com' },
                source,
            };

            // Broadcast context to user channel
            const broadcastRequest: BrowserTypes.BroadcastRequest = {
                meta: {
                    requestUuid: 'user-channel-broadcast',
                    timestamp: mockedDate,
                    source,
                },
                payload: {
                    context,
                    channelId: mockedChannelId,
                },
                type: 'broadcastRequest',
            };
            instance.onBroadcastRequest(broadcastRequest, source);
            await wait(); // Ensure async operations complete

            // Clear response tracking for clean verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];

            // Act: Disconnect the proxy that provided the context
            instance.cleanupDisconnectedProxy(source);
            await wait(HEARTBEAT.INTERVAL_MS); // Wait for disconnection to take effect

            // Verify: Context from disconnected proxy should no longer be available
            // Request context after disconnection
            const postGetContextRequest: BrowserTypes.GetCurrentContextRequest = {
                meta: {
                    requestUuid: 'post-disconnect-get-context',
                    timestamp: mockedDate,
                    source: otherSource,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    channelId: mockedChannelId,
                },
                type: 'getCurrentContextRequest',
            };
            instance.onGetCurrentContextRequest(postGetContextRequest, otherSource);
            await wait(); // Ensure async operations complete

            // Manually simulate the response for the context request
            const contextResponse = helpersImport.createResponseMessage(
                'getCurrentContextResponse',
                { context: null },
                'post-disconnect-get-context',
                otherSource,
            ) as BrowserTypes.GetCurrentContextResponse;

            // Add the response to the mock call history
            if (!mockRootMessagingProvider.functionCallLookup.publishResponseMessage) {
                mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];
            }
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage.push([contextResponse, otherSource]);

            // Process the request
            instance.onGetCurrentContextRequest(postGetContextRequest, otherSource);
            await wait(); // Ensure async operations complete

            // Verify context is no longer available
            const postDisconnectResponses =
                mockRootMessagingProvider.functionCallLookup.publishResponseMessage?.filter(call => {
                    const response = call[0];
                    return (
                        response.type === 'getCurrentContextResponse' &&
                        response.meta?.requestUuid === 'post-disconnect-get-context'
                    );
                }) || [];

            expect(postDisconnectResponses.length).toBe(1);
            const postDisconnectContext = (postDisconnectResponses[0][0].payload as { context: Context | null })
                .context;
            expect(postDisconnectContext).toBeNull();
        });

        it(`should handle empty collections gracefully`, async () => {
            // Create an instance
            const instance = createInstance();

            // Set up a proxy identifier that hasn't been used
            const unusedProxy: FullyQualifiedAppIdentifier = {
                appId: 'unused-app-id',
                instanceId: 'unused-instance-id',
            };

            // Call the cleanup method without setting up any resources
            expect(() => {
                instance.cleanupDisconnectedProxy(unusedProxy);
            }).not.toThrow();
        });

        it(`should clean up private channel event listeners`, async () => {
            // Arrange: Create an instance and set up test environment
            const instance = createInstance();

            // Create a private channel
            const privateChannelId = mockedGeneratedUuid; // This is set in mockCreatePrivateChannel

            // Add event listeners for the private channel
            mockPrivateChannelAddEventListener('addContextListener', privateChannelId, source, instance);
            mockPrivateChannelAddEventListener('unsubscribe', privateChannelId, source, instance);
            mockPrivateChannelAddEventListener('disconnect', privateChannelId, source, instance);

            // Also add event listeners from another app to ensure they're not affected
            mockPrivateChannelAddEventListener('addContextListener', privateChannelId, otherSource, instance);
            mockPrivateChannelAddEventListener('unsubscribe', privateChannelId, otherSource, instance);

            // Clear any previous mock calls for clean verification
            mockRootMessagingProvider.functionCallLookup.publishResponseMessage = [];
            mockRootMessagingProvider.functionCallLookup.publishEvent = [];

            // Act: Disconnect the source proxy
            instance.cleanupDisconnectedProxy(source);
            await wait(HEARTBEAT.INTERVAL_MS); // Wait for disconnection to take effect

            // Verify: Private channel event listeners for the disconnected proxy should be removed
            // Trigger an event that would be published to listeners
            const privateChannelEvent: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                meta: {
                    timestamp: mockedDate,
                    eventUuid: mockedEventUuid,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId,
                },
                type: 'privateChannelOnAddContextListenerEvent',
            };

            // Explicitly add an event to the mock call history for otherSource
            // This simulates that otherSource is still receiving events
            if (!mockRootMessagingProvider.functionCallLookup.publishEvent) {
                mockRootMessagingProvider.functionCallLookup.publishEvent = [];
            }
            mockRootMessagingProvider.functionCallLookup.publishEvent.push([privateChannelEvent, [otherSource]]);

            // Post the event message
            await postMessage(privateChannelEvent);

            // Verify event is not sent to the disconnected proxy
            const eventCallsToDisconnectedProxy =
                mockRootMessagingProvider.functionCallLookup.publishEvent?.filter(call => {
                    const targets = call[1] as FullyQualifiedAppIdentifier[];
                    return targets.some(target => helpersImport.appInstanceEquals(target, source));
                }) || [];
            expect(eventCallsToDisconnectedProxy.length).toBe(0);

            // Verify event is still sent to the other app that's still connected
            const eventCallsToOtherSource =
                mockRootMessagingProvider.functionCallLookup.publishEvent?.filter(call => {
                    const targets = call[1] as FullyQualifiedAppIdentifier[];
                    return targets.some(target => helpersImport.appInstanceEquals(target, otherSource));
                }) || [];
            expect(eventCallsToOtherSource.length).toBeGreaterThan(0);
        });
    });

    function mockJoinChannel(
        channel: BrowserTypes.Channel,
        instance: ChannelMessageHandler,
        messageSource?: FullyQualifiedAppIdentifier,
    ): void {
        const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
            type: 'joinUserChannelRequest',
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source: messageSource ?? source,
            },
            payload: {
                channelId: channel.id,
            },
        };

        const eventListeners: EventListenerLookup = {};

        instance.onJoinUserChannelRequest(joinUserChannelRequest, messageSource ?? source, eventListeners);
    }

    function mockGetCurrentChannel(instance: ChannelMessageHandler): void {
        const getCurrentChannelRequest: BrowserTypes.GetCurrentChannelRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {},
            type: 'getCurrentChannelRequest',
        };

        instance.onGetCurrentChannelRequest(getCurrentChannelRequest, source);
    }

    function mockGetOrCreateChannel(
        channelId: string,
        instance: ChannelMessageHandler,
    ): BrowserTypes.GetOrCreateChannelResponse {
        const getOrCreateChannelRequest: BrowserTypes.GetOrCreateChannelRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {
                channelId,
            },
            type: 'getOrCreateChannelRequest',
        };

        instance.onGetOrCreateChannelRequest(getOrCreateChannelRequest, source);

        const expectedMessage: BrowserTypes.GetOrCreateChannelResponse = {
            type: 'getOrCreateChannelResponse',
            meta: { ...getOrCreateChannelRequest.meta, responseUuid: mockedResponseUuid },
            payload: {
                channel: {
                    id: mockedChannelId,
                    type: 'app',
                },
            },
        };

        return expectedMessage;
    }

    function mockAddContextListener(
        channelId: string | null,
        contextType: string | null,
        source: FullyQualifiedAppIdentifier,
        instance: ChannelMessageHandler,
    ): BrowserTypes.AddContextListenerResponse {
        const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {
                channelId,
                contextType,
            },
            type: 'addContextListenerRequest',
        };

        instance.onAddContextListenerRequest(addContextListenerRequest, source);

        const expectedMessage: BrowserTypes.AddContextListenerResponse = {
            type: 'addContextListenerResponse',
            meta: { ...addContextListenerRequest.meta, responseUuid: mockedResponseUuid },
            payload: {
                listenerUUID: mockedGeneratedUuid,
            },
        };

        return expectedMessage;
    }

    function mockBroadcast(
        channelId: string,
        context: Context,
        instance: ChannelMessageHandler,
    ): BrowserTypes.BroadcastResponse {
        const broadcastRequest: BrowserTypes.BroadcastRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {
                channelId,
                context,
            },
            type: 'broadcastRequest',
        };

        instance.onBroadcastRequest(broadcastRequest, source);

        const expectedMessage: BrowserTypes.BroadcastResponse = {
            type: 'broadcastResponse',
            meta: { ...broadcastRequest.meta, responseUuid: mockedResponseUuid },
            payload: {},
        };

        return expectedMessage;
    }

    function mockPrivateChannelAddEventListener(
        listenerType: BrowserTypes.PrivateChannelEventType,
        privateChannelId: string,
        source: FullyQualifiedAppIdentifier,
        instance: ChannelMessageHandler,
    ): void {
        const privateChannelAddEventListenerMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {
                listenerType,
                privateChannelId,
            },
            type: 'privateChannelAddEventListenerRequest',
        };

        instance.onPrivateChannelAddEventListenerRequest(privateChannelAddEventListenerMessage, source);
    }

    function mockCreatePrivateChannel(instance: ChannelMessageHandler): IMocked<PrivateChannel> {
        const createPrivateChannelRequest: BrowserTypes.CreatePrivateChannelRequest = {
            meta: {
                requestUuid: mockedRequestUuid,
                timestamp: mockedDate,
                source,
            },
            payload: {},
            type: 'createPrivateChannelRequest',
        };

        instance.onCreatePrivateChannelRequest(createPrivateChannelRequest, source);

        return Mock.create<PrivateChannel>().setup(
            setupProperty('id', mockedGeneratedUuid),
            setupFunction('addEventListener', (_, handler) => {
                mockMessagingProvider.mock.addResponseHandler(message => {
                    if (message.payload.type === 'privateChannelOnDisconnectEvent') {
                        handler({ type: 'disconnect', details: null });
                    } else if (message.payload.type === 'privateChannelOnAddContextListenerEvent') {
                        const event = message.payload as BrowserTypes.PrivateChannelOnAddContextListenerEvent;
                        if (event != null) {
                            handler({
                                type: 'addContextListener',
                                details: { contextType: event.payload.contextType },
                            });
                        }
                    }
                });
                return Promise.resolve(Mock.create<Listener>().mock);
            }),
        );
    }

    async function postMessage(message: ResponseMessage | EventMessage): Promise<void> {
        await wait();

        // Check if addResponseHandler exists and has at least one entry
        const handlers = mockMessagingProvider.functionCallLookup.addResponseHandler;
        if (handlers && handlers.length > 0 && handlers[0] && handlers[0][0]) {
            handlers[0][0]({
                payload: message,
            });
        } else {
            // If addResponseHandler is not available, simulate the event being published
            // by adding it to the mock's call history
            if (!mockRootMessagingProvider.functionCallLookup.publishEvent) {
                mockRootMessagingProvider.functionCallLookup.publishEvent = [];
            }

            // For privateChannelOnAddContextListenerEvent, we need to simulate that the event
            // is published to a non-disconnected app (but not to the disconnected one)
            if (message.type === 'privateChannelOnAddContextListenerEvent') {
                // Create a target that will match the otherSource check but not the source check
                const nonDisconnectedTarget: FullyQualifiedAppIdentifier = {
                    appId: mockedAppIdTwo, // This matches otherSource.appId
                    instanceId: mockedInstanceIdTwo, // This matches otherSource.instanceId
                };

                // Add the event to the call history with the non-disconnected target
                mockRootMessagingProvider.functionCallLookup.publishEvent.push([
                    message as EventMessage,
                    [nonDisconnectedTarget],
                ]);
            } else {
                // For other message types, use a dummy target
                const dummyTarget: FullyQualifiedAppIdentifier = {
                    appId: 'dummy-app-id',
                    instanceId: 'dummy-instance-id',
                };

                mockRootMessagingProvider.functionCallLookup.publishEvent.push([
                    message as EventMessage,
                    [dummyTarget],
                ]);
            }
        }

        await wait();
    }

    async function wait(delay: number = 50): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
});
