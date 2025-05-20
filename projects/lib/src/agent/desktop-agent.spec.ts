/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import {
    AppMetadata,
    BrowserTypes,
    type Channel,
    type Contact,
    DesktopAgent,
    EventHandler,
    type Listener,
    OpenError,
    ResolveError,
} from '@finos/fdc3';
import {
    IMocked,
    Mock,
    proxyModule,
    registerMock,
    reset,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { AppDirectoryApplication } from '../app-directory.contracts.js';
import { AppDirectory } from '../app-directory/index.js';
import { ChannelMessageHandler } from '../channel/channel-message-handler.js';
import { ChannelFactory, Channels } from '../channel/index.js';
import { HEARTBEAT } from '../constants.js';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IOpenApplicationStrategy,
    RequestMessage,
    ResponseMessage,
} from '../contracts.js';
import { isFullyQualifiedAppId } from '../helpers/index.js';
import * as helpersImport from '../helpers/index.js';
import { RootMessagePublisher } from '../messaging/index.js';
import { DesktopAgentImpl } from './desktop-agent.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedRootAppId = `mocked-root-app-id@mock-app-directory`;
const mockedRootInstanceId = `mocked-root-instance-id`;
const mockedTargetAppId = `mocked-target-app-id@mock-app-directory`;
const mockedTargetInstanceId = `mocked-target-instance-id`;
const mockedUnqualifiedAppId = `unqualified-app-id`;
const mockedRequestUuid = `mocked-request-Uuid`;
const mockedResponseUuid = `mocked-response-Uuid`;
const mockedEventUuid = `mocked-event-Uuid`;
const mockedGeneratedUuid = `mocked-generated-Uuid`;
const mockedGeneratedUurl = `mocked-generated-Uurl`;
const mockedChannelId = `mocked-channel-id`;
const mockedDate = new Date(2024, 1, 0, 0, 0, 0);

const mockedUnknownAppId = `mocked-unknown-app-id@mock-app-directory`;
const mockedUnresolvableIntent = `mocked-unresolvable-intent`;
const mockedContextWithNoIntents = { type: `mocked-context-with-no-intents` };
const mockedContextWithNoApps = { type: `mocked-context-with-no-apps` };

/**
 * We only test message handling here. Testing of methods is done in desktop-agent-proxy.spec
 */
describe(`${DesktopAgentImpl.name} (desktop-agent)`, () => {
    let mockAppDirectory: IMocked<AppDirectory>;
    let mockChannelHandler: IMocked<ChannelMessageHandler>;
    let mockRootPublisher: IMocked<RootMessagePublisher>;
    // create once as import will only be evaluated and destructured once
    const mockedHelpers = Mock.create<typeof helpersImport>();

    let appIdentifier: FullyQualifiedAppIdentifier;
    let source: FullyQualifiedAppIdentifier;
    let unknownSource: FullyQualifiedAppIdentifier;

    let currentDate: Date;
    let contact: Contact;

    let mockedApplication: AppDirectoryApplication;

    let mockWindow: IMocked<Window>;

    beforeEach(() => {
        mockWindow = Mock.create<Window>().setup(setupFunction('open', () => mockWindow.mock));

        contact = {
            type: 'fdc3.contact',
            name: 'Joe Bloggs',
            id: {
                username: 'jo_bloggs',
                phone: '079712345678',
            },
        };

        mockedApplication = {
            appId: 'placeholder-app-id',
            details: { url: 'mock-url' },
            title: 'mock-application',
            type: 'web',
            hostManifests: {
                'mock-application': { something: 'mock-host-manifest' },
            },
        };

        mockRootPublisher = Mock.create<RootMessagePublisher>().setup(
            setupFunction('publishEvent'),
            setupFunction('publishResponseMessage'),
            setupFunction('addResponseHandler'),
            setupProperty('requestMessageHandler'),
            setupFunction('sendMessage'),
        );

        mockAppDirectory = Mock.create<AppDirectory>().setup(
            setupFunction('registerIntentListener', async app => {
                if (app.appId === 'unqualified-app-id') {
                    return Promise.reject(ResolveError.TargetInstanceUnavailable);
                }
                return;
            }),
            setupFunction('resolveAppInstanceForIntent', (_intent, _context) =>
                Promise.resolve({ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }),
            ),
            setupFunction('resolveAppInstanceForContext', _context =>
                Promise.resolve({
                    intent: 'StartChat',
                    app: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                }),
            ),
            setupFunction('getAppIntent', intent => {
                if (intent === mockedUnresolvableIntent) {
                    return Promise.resolve({ intent: { name: intent, displayName: intent }, apps: [] });
                }
                return Promise.resolve({
                    intent: { name: intent, displayName: intent },
                    apps: [{ appId: 'mocked-app-Id@mock-app-directory' }],
                });
            }),
            setupFunction('getAppIntentsForContext', async context => {
                if (context === mockedContextWithNoIntents) {
                    return [];
                } else if (context === mockedContextWithNoApps) {
                    return [
                        {
                            intent: { name: mockedUnresolvableIntent, displayName: mockedUnresolvableIntent },
                            apps: [],
                        },
                    ];
                }
                return [
                    {
                        intent: { name: 'StartChat', displayName: 'StartChat' },
                        apps: [{ appId: 'mocked-app-Id@mock-app-directory' }],
                    },
                ];
            }),
            setupFunction('getAppInstances', async appId => {
                if (appId === mockedUnknownAppId) {
                    return;
                }
                if (!isFullyQualifiedAppId(appId)) {
                    return;
                }
                return [{ appId, instanceId: mockedTargetInstanceId }];
            }),
            setupFunction('getAppMetadata', async app => {
                if (app.appId === mockedUnknownAppId) {
                    return;
                }
                return { appId: app.appId, instanceId: app.instanceId };
            }),
            setupFunction('getContextForAppIntent', async (_app, _intent) => [
                {
                    type: contact.type,
                    name: contact.name,
                    id: contact.id,
                },
            ]),
            setupFunction('getAppDirectoryApplication', async appId => {
                if (appId === `app-not-in-directory`) {
                    return;
                } else if (appId === `unopenable-app`) {
                    mockedApplication.type = 'other';
                    mockedApplication.details = undefined;
                }
                mockedApplication.appId = appId;

                return mockedApplication;
            }),
        );
        mockChannelHandler = Mock.create<ChannelMessageHandler>().setup(
            setupFunction('onGetUserChannelsRequest'),
            setupFunction('onGetCurrentChannelRequest'),
            setupFunction('onJoinUserChannelRequest'),
            setupFunction('onLeaveCurrentChannelRequest'),
            setupFunction('onCreatePrivateChannelRequest'),
            setupFunction('onGetOrCreateChannelRequest'),
            setupFunction('onAddContextListenerRequest'),
            setupFunction('onContextListenerUnsubscribeRequest'),
            setupFunction('onBroadcastRequest'),
            setupFunction('onGetCurrentContextRequest'),
            setupFunction('onPrivateChannelAddEventListenerRequest'),
            setupFunction('onPrivateChannelUnsubscribeEventListenerRequest'),
            setupFunction('onPrivateChannelDisconnectRequest'),
            setupFunction('addToPrivateChannelAllowedList'),
            setupFunction('addListenerCallback'),
            setupFunction('removeListenerCallback'),
            setupFunction('cleanupDisconnectedProxy'),
        );
        // setup before each to clear function call counts
        mockedHelpers.setup(
            setupFunction('generateUUID', () => mockedGeneratedUuid),
            setupFunction('generateUUUrl', () => mockedGeneratedUurl),
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

        appIdentifier = { appId: mockedRootAppId, instanceId: mockedRootInstanceId };
        source = { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId };
        unknownSource = { appId: mockedUnqualifiedAppId, instanceId: mockedTargetInstanceId };
        currentDate = mockedDate;
    });

    function createInstance(openStrategies?: IOpenApplicationStrategy[]): DesktopAgent {
        return new DesktopAgentImpl({
            appIdentifier,
            rootMessagePublisher: mockRootPublisher.mock,
            directory: mockAppDirectory.mock,
            channelFactory: Mock.create<ChannelFactory>().setup(
                setupFunction('createPublicChannel', channel => createMockChannel(channel).mock),
                setupFunction('createChannels', () => Mock.create<Channels>().mock),
                setupFunction('createMessageHandler', () => mockChannelHandler.mock),
            ).mock,
            openStrategies,
            window: mockWindow.mock,
        });
    }

    it(`should create`, async () => {
        const instance = createInstance();

        expect(instance).toBeDefined();

        expect(mockRootPublisher.withSetter('requestMessageHandler')).wasCalledOnce();
    });

    describe(`onMessage`, () => {
        describe(`raiseIntentRequest`, () => {
            it(`should publish IntentEvent to chosen app instance`, async () => {
                createInstance();

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: contact,
                    },
                    type: 'raiseIntentRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedEvent: BrowserTypes.IntentEvent = {
                    meta: { timestamp: currentDate, eventUuid: mockedEventUuid },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        originatingApp: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                        raiseIntentRequestUuid: mockedGeneratedUurl,
                    },
                    type: 'intentEvent',
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedEvent, [source]),
                ).wasCalledOnce();

                await wait();

                expect(
                    mockedHelpers.withFunction('generateUUUrl').withParametersEqualTo(source, mockedRequestUuid),
                ).wasCalledOnce();
            });

            it(`should publish RaiseIntentResponse`, async () => {
                createInstance();

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: contact,
                    },
                    type: 'raiseIntentRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        intentResolution: {
                            source,
                            intent: 'StartChat',
                        },
                    },
                    type: 'raiseIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });

            it(`should wait for chosen app to add required intentListener before publishing IntentEvent`, async () => {
                createInstance();

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: contact,
                    },
                    type: 'raiseIntentRequest',
                };

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const expectedEvent: BrowserTypes.IntentEvent = {
                    meta: { timestamp: currentDate, eventUuid: mockedEventUuid },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        originatingApp: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                        raiseIntentRequestUuid: 'mocked-generated-Uurl',
                    },
                    type: 'intentEvent',
                };

                expect(
                    mockAppDirectory
                        .withFunction('resolveAppInstanceForIntent')
                        .withParameters('StartChat', contact, undefined),
                ).wasCalledOnce();

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedEvent, [source]),
                ).wasCalledOnce();
            });

            it(`should return error from directory if one is returned`, async () => {
                mockAppDirectory.setupFunction('resolveAppInstanceForIntent', () =>
                    Promise.reject('UserCancelledResolution'),
                );

                createInstance();

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: contact,
                    },
                    type: 'raiseIntentRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: { error: 'UserCancelledResolution' },
                    type: 'raiseIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });

            it(`should publish RaiseIntentResponse containing ResolverError.MalformedContext error message if given context is invalid`, async () => {
                createInstance();

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: `not-a-context` as any,
                    },
                    type: 'raiseIntentRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.MalformedContext },
                    type: 'raiseIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });
        });

        describe(`raiseIntentForContextRequest`, () => {
            it(`should publish IntentEvent to chosen app instance`, async () => {
                createInstance();

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const raiseIntentForContextRequest: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await postRequestMessage(raiseIntentForContextRequest, source);

                const expectedEvent: BrowserTypes.IntentEvent = {
                    meta: { timestamp: currentDate, eventUuid: mockedEventUuid },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        originatingApp: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                        raiseIntentRequestUuid: 'mocked-generated-Uurl',
                    },
                    type: 'intentEvent',
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedEvent, [source]),
                ).wasCalledOnce();

                await wait();

                expect(
                    mockedHelpers.withFunction('generateUUUrl').withParametersEqualTo(source, mockedRequestUuid),
                ).wasCalledOnce();
            });

            it(`should publish RaiseIntentForContextResponse`, async () => {
                createInstance();

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const raiseIntentRequest: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        intentResolution: {
                            intent: 'StartChat',
                            source,
                        },
                    },
                    type: 'raiseIntentForContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });

            it(`should wait for chosen app to add required intentListener before publishing IntentEvent`, async () => {
                createInstance();

                const raiseIntentRequest: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                const addIntentListenerRequest: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                await postRequestMessage(addIntentListenerRequest, {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                const expectedEvent: BrowserTypes.IntentEvent = {
                    meta: { timestamp: currentDate, eventUuid: mockedEventUuid },
                    payload: {
                        context: contact,
                        intent: 'StartChat',
                        originatingApp: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                        raiseIntentRequestUuid: 'mocked-generated-Uurl',
                    },
                    type: 'intentEvent',
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedEvent, [source]),
                ).wasCalledOnce();
            });

            it(`should return error from directory if one is returned`, async () => {
                mockAppDirectory.setupFunction('resolveAppInstanceForContext', () =>
                    Promise.reject('UserCancelledResolution'),
                );

                createInstance();
                const raiseIntentRequest: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: contact,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.UserCancelled },
                    type: 'raiseIntentForContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });

            it(`should publish RaiseIntentForContextResponse containing ResolveError.MalformedContext error message if given context is invalid`, async () => {
                createInstance();

                const raiseIntentRequest: BrowserTypes.RaiseIntentForContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: `not-a-context` as any,
                    },
                    type: 'raiseIntentForContextRequest',
                };

                await postRequestMessage(raiseIntentRequest, source);

                const expectedResponse: BrowserTypes.RaiseIntentForContextResponse = {
                    meta: { ...raiseIntentRequest.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.MalformedContext },
                    type: 'raiseIntentForContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });
        });

        describe(`onIntentResultRequest`, () => {
            let originalSource: FullyQualifiedAppIdentifier;
            const raiseIntentRequestUuid = 'raiseIntentRequestUuid';

            beforeEach(() => {
                originalSource = {
                    appId: 'originalAppId@mock-app-directory',
                    instanceId: 'originalInstanceId',
                };

                mockedHelpers.setupFunction('decodeUUUrl', value => {
                    const parsed = JSON.parse(value);
                    const { uuid, ...payload } = parsed;

                    return { uuid, payload };
                });
            });

            afterEach(() => {
                reset(mockedHelpers);
            });

            it(`should publish raiseIntentResultResponse to original source`, async () => {
                createInstance();

                const intentResultRequest: BrowserTypes.IntentResultRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intentResult: {
                            context: { type: 'expected.context' },
                        },
                        intentEventUuid: 'intentEventUUid',
                        raiseIntentRequestUuid: JSON.stringify({ ...originalSource, uuid: raiseIntentRequestUuid }),
                    },
                    type: 'intentResultRequest',
                };

                await postRequestMessage(intentResultRequest, source);

                const expectedResultResponse: BrowserTypes.RaiseIntentResultResponse = {
                    meta: {
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                        requestUuid: raiseIntentRequestUuid,
                        source: originalSource,
                    },
                    payload: {
                        intentResult: {
                            context: { type: 'expected.context' },
                        },
                    },
                    type: 'raiseIntentResultResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResultResponse, originalSource),
                ).wasCalledOnce();
            });

            it(`should publish RaiseIntentResponse`, async () => {
                createInstance();

                const intentResultRequest: BrowserTypes.IntentResultRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intentResult: {
                            context: { type: 'expected.context' },
                        },
                        intentEventUuid: 'intentEventUUid',
                        raiseIntentRequestUuid: JSON.stringify(originalSource),
                    },
                    type: 'intentResultRequest',
                };

                await postRequestMessage(intentResultRequest, source);

                const expectedResponse: BrowserTypes.IntentResultResponse = {
                    meta: { ...intentResultRequest.meta, responseUuid: mockedResponseUuid },
                    payload: {},
                    type: 'intentResultResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedResponse, source),
                ).wasCalledOnce();
            });

            it(`should add app receiving intentResult to private channel's allowedList if intentResult is private channel`, async () => {
                createInstance();

                const intentResultRequest: BrowserTypes.IntentResultRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intentResult: {
                            channel: {
                                id: mockedChannelId,
                                type: 'private',
                            },
                        },
                        intentEventUuid: 'intentEventUUid',
                        raiseIntentRequestUuid: JSON.stringify(originalSource),
                    },
                    type: 'intentResultRequest',
                };

                await postRequestMessage(intentResultRequest, source);

                expect(
                    mockChannelHandler
                        .withFunction('addToPrivateChannelAllowedList')
                        .withParametersEqualTo(mockedChannelId, originalSource),
                ).wasCalledOnce();
            });
        });

        describe(`addIntentListenerRequest`, () => {
            it(`should publish addIntentListenerResponse`, async () => {
                createInstance();

                const addIntentListenerMessage: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerMessage, source);

                const expectedMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: { ...addIntentListenerMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'addIntentListenerResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish addIntentListenerResponse with ResolveError.TargetInstanceUnavailable error message if app uses an unqualifiedAppId, and is not registered with a loaded app directory`, async () => {
                createInstance();

                const addIntentListenerMessage: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: unknownSource,
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerMessage, unknownSource);

                const expectedMessage: BrowserTypes.AddIntentListenerResponse = {
                    meta: { ...addIntentListenerMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.TargetInstanceUnavailable },
                    type: 'addIntentListenerResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, unknownSource),
                ).wasCalledOnce();
            });

            it(`should pass requests for raiseIntent to registered handler`, async () => {
                createInstance();

                const qualifiedIdentifier: FullyQualifiedAppIdentifier = {
                    appId: 'listenerAppId@mock-app-directory',
                    instanceId: 'listenerAppInstanceId',
                };

                const addIntentListenerMessage: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: qualifiedIdentifier,
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerMessage, qualifiedIdentifier);

                mockAppDirectory.setupFunction('resolveAppInstanceForIntent', () =>
                    Promise.resolve(qualifiedIdentifier),
                );

                const identifier = { appId: 'listenerAppId@mock-app-directory' };

                const raiseIntentRequest: BrowserTypes.RaiseIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: appIdentifier,
                    },
                    payload: { context: contact, intent: 'StartChat', app: identifier },
                    type: 'raiseIntentRequest',
                };

                await postRequestMessage(raiseIntentRequest, appIdentifier);

                const expectedMessage: BrowserTypes.IntentEvent = {
                    meta: {
                        eventUuid: mockedEventUuid,
                        timestamp: currentDate,
                    },
                    payload: {
                        intent: 'StartChat',
                        context: contact,
                        originatingApp: appIdentifier,
                        raiseIntentRequestUuid: mockedGeneratedUurl,
                    },
                    type: 'intentEvent',
                };

                expect(
                    mockAppDirectory
                        .withFunction('resolveAppInstanceForIntent')
                        .withParameters('StartChat', contact, identifier),
                ).wasCalledOnce();
                expect(
                    mockAppDirectory
                        .withFunction('registerIntentListener')
                        .withParametersEqualTo(qualifiedIdentifier, 'StartChat', [
                            {
                                type: contact.type,
                                name: contact.name,
                                id: contact.id,
                            },
                        ]),
                ).wasCalledOnce();
                expect(
                    mockRootPublisher
                        .withFunction('publishEvent')
                        .withParametersEqualTo(expectedMessage, [qualifiedIdentifier]),
                ).wasCalledOnce();
            });
        });

        describe(`findInstancesRequest`, () => {
            it(`should publish findInstancesResponse containing available instances for given app`, async () => {
                createInstance();

                const findInstancesMessage: BrowserTypes.FindInstancesRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                    },
                    type: 'findInstancesRequest',
                };

                await postRequestMessage(findInstancesMessage, source);

                const expectedMessage: BrowserTypes.FindInstancesResponse = {
                    meta: { ...findInstancesMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { appIdentifiers: [{ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }] },
                    type: 'findInstancesResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findInstancesResponse containing error message if requested app is unknown to application`, async () => {
                createInstance();

                const findInstancesMessage: BrowserTypes.FindInstancesRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedUnknownAppId },
                    },
                    type: 'findInstancesRequest',
                };

                await postRequestMessage(findInstancesMessage, source);

                const expectedMessage: BrowserTypes.FindInstancesResponse = {
                    meta: { ...findInstancesMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findInstancesResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`getInfoRequest`, () => {
            it(`should publish getInfoResponse`, async () => {
                const expectedAppMetaData: AppMetadata = {
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                    version: '1.2.3',
                };

                mockAppDirectory.setupFunction('getAppMetadata', () => Promise.resolve(expectedAppMetaData));

                createInstance();

                const getInfoMessage: BrowserTypes.GetInfoRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {},
                    type: 'getInfoRequest',
                };

                await postRequestMessage(getInfoMessage, source);

                const version = packageJson.peerDependencies['@finos/fdc3'];
                const expectedVersion = (
                    version.indexOf('^') !== -1
                        ? version.slice(version.indexOf('^') + 1)
                        : version.slice(version.indexOf('~') + 1)
                ).split('-')[0];

                const expectedMessage: BrowserTypes.GetInfoResponse = {
                    meta: { ...getInfoMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        implementationMetadata: {
                            fdc3Version: expectedVersion,
                            provider: 'Morgan Stanley',
                            optionalFeatures: {
                                OriginatingAppMetadata: true,
                                UserChannelMembershipAPIs: true,
                                DesktopAgentBridging: false,
                            },
                            appMetadata: {
                                appId: mockedTargetAppId,
                                instanceId: mockedTargetInstanceId,
                                version: expectedAppMetaData.version,
                                title: undefined,
                                tooltip: undefined,
                                description: undefined,
                                icons: undefined,
                                screenshots: undefined,
                            },
                        },
                    },
                    type: 'getInfoResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`getAppMetadataRequest`, () => {
            it(`should publish getAppMetadataResponse containing metadata of given app`, async () => {
                createInstance();

                const getAppMetadataMessage: BrowserTypes.GetAppMetadataRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: { app: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId } },
                    type: 'getAppMetadataRequest',
                };

                await postRequestMessage(getAppMetadataMessage, source);

                const expectedMessage: BrowserTypes.GetAppMetadataResponse = {
                    meta: { ...getAppMetadataMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        appMetadata: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    type: 'getAppMetadataResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish getAppMetadataResponse containing error message if given app is not found`, async () => {
                createInstance();

                const getAppMetadataMessage: BrowserTypes.GetAppMetadataRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: { app: { appId: mockedUnknownAppId } },
                    type: 'getAppMetadataRequest',
                };

                await postRequestMessage(getAppMetadataMessage, source);

                const expectedMessage: BrowserTypes.GetAppMetadataResponse = {
                    meta: { ...getAppMetadataMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        error: ResolveError.TargetAppUnavailable,
                    },
                    type: 'getAppMetadataResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`findIntentRequest`, () => {
            it(`should publish findIntentResponse containing AppIntent for given intent`, async () => {
                createInstance();

                const findIntentMessage: BrowserTypes.FindIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'findIntentRequest',
                };

                await postRequestMessage(findIntentMessage, source);

                const expectedMessage: BrowserTypes.FindIntentResponse = {
                    meta: { ...findIntentMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        appIntent: {
                            intent: { name: 'StartChat', displayName: 'StartChat' },
                            apps: [{ appId: 'mocked-app-Id@mock-app-directory' }],
                        },
                    },
                    type: 'findIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentResponse containing error message if no apps are found to resolve given intent`, async () => {
                createInstance();

                const findIntentMessage: BrowserTypes.FindIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: mockedUnresolvableIntent,
                    },
                    type: 'findIntentRequest',
                };

                await postRequestMessage(findIntentMessage, source);

                const expectedMessage: BrowserTypes.FindIntentResponse = {
                    meta: { ...findIntentMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentResponse containing ResolverError.MalformedContext error message if given context is invalid`, async () => {
                createInstance();

                const findIntentMessage: BrowserTypes.FindIntentRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        intent: 'StartChat',
                        context: `not-a-context` as any,
                    },
                    type: 'findIntentRequest',
                };

                await postRequestMessage(findIntentMessage, source);

                const expectedMessage: BrowserTypes.FindIntentResponse = {
                    meta: { ...findIntentMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.MalformedContext },
                    type: 'findIntentResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`addEventListenerRequest`, () => {
            let mockEventHandler: IMocked<{ handler: EventHandler }>;

            beforeEach(() => {
                mockEventHandler = Mock.create<{ handler: EventHandler }>().setup(setupFunction('handler'));
            });

            it(`should publish addEventListenerResponse`, async () => {
                createInstance();

                const addEventListenerMessage: BrowserTypes.AddEventListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        type: 'USER_CHANNEL_CHANGED',
                    },
                    type: 'addEventListenerRequest',
                };

                await postRequestMessage(addEventListenerMessage, source);

                const expectedMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: { ...addEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'addEventListenerResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should pass FDC3Events to registered handler`, async () => {
                const instance = createInstance();

                const listenerPromise = instance.addEventListener('userChannelChanged', mockEventHandler.mock.handler);

                const addEventListenerMessage: BrowserTypes.AddEventListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        type: 'USER_CHANNEL_CHANGED',
                    },
                    type: 'addEventListenerRequest',
                };

                await postRequestMessage(addEventListenerMessage, source);

                const expectedMessage: BrowserTypes.AddEventListenerResponse = {
                    meta: { ...addEventListenerMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'addEventListenerResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();

                await postIncomingMessage(expectedMessage);

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

                await postIncomingMessage(channelChangedEvent);

                expect(
                    mockEventHandler.withFunction('handler').withParametersEqualTo({
                        type: 'userChannelChanged',
                        details: { newChannelId: mockedChannelId },
                    }),
                ).wasCalledOnce();
            });
        });

        describe(`eventListenerUnsubscribeRequest`, () => {
            it(`should publish eventListenerUnsubscribeResponse`, async () => {
                createInstance();

                const addEventListenerMessage: BrowserTypes.AddEventListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        type: 'USER_CHANNEL_CHANGED',
                    },
                    type: 'addEventListenerRequest',
                };

                await postRequestMessage(addEventListenerMessage, source);

                const eventListenerUnsubscribeRequest: BrowserTypes.EventListenerUnsubscribeRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'eventListenerUnsubscribeRequest',
                };

                await postRequestMessage(eventListenerUnsubscribeRequest, source);

                const expectedMessage: BrowserTypes.EventListenerUnsubscribeResponse = {
                    meta: { ...eventListenerUnsubscribeRequest.meta, responseUuid: mockedResponseUuid },
                    payload: {},
                    type: 'eventListenerUnsubscribeResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`intentListenerUnsubscribeRequest`, () => {
            it(`should publish intentListenerUnsubscribeResponse`, async () => {
                createInstance();

                createInstance();

                const addIntentListenerMessage: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        intent: 'StartChat',
                    },
                    type: 'addIntentListenerRequest',
                };

                await postRequestMessage(addIntentListenerMessage, source);

                const intentListenerUnsubscribeRequest: BrowserTypes.IntentListenerUnsubscribeRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: { listenerUUID: 'mocked-generated-Uuid' },
                    type: 'intentListenerUnsubscribeRequest',
                };

                await postRequestMessage(intentListenerUnsubscribeRequest, source);

                const expectedMessage: BrowserTypes.IntentListenerUnsubscribeResponse = {
                    meta: { ...intentListenerUnsubscribeRequest.meta, responseUuid: mockedResponseUuid },
                    payload: {},
                    type: 'intentListenerUnsubscribeResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`findIntentsByContextRequest`, () => {
            it(`should publish findIntentsByContextResponse containing appIntents for possible intents that can handle given context`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: contact,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        appIntents: [
                            {
                                intent: { name: 'StartChat', displayName: 'StartChat' },
                                apps: [{ appId: 'mocked-app-Id@mock-app-directory' }],
                            },
                        ],
                    },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentsByContextResponse containing error message if no intents that can handle given context are found`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: mockedContextWithNoIntents,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentsByContextResponse containing error message if no apps are found for any of the intents that can handle given context`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: mockedContextWithNoApps,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentsByContextResponse containing error message if no intents that can handle given context are found`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: mockedContextWithNoIntents,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentsByContextResponse containing error message if no apps are found for any of the intents that can handle given context`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: mockedContextWithNoApps,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.NoAppsFound },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish findIntentsByContextResponse containing ResolveError.MalformedContext error message if given context is invalid`, async () => {
                createInstance();

                const findIntentsByContextMessage: BrowserTypes.FindIntentsByContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        context: `not-a-context` as any,
                    },
                    type: 'findIntentsByContextRequest',
                };

                await postRequestMessage(findIntentsByContextMessage, source);

                const expectedMessage: BrowserTypes.FindIntentsByContextResponse = {
                    meta: { ...findIntentsByContextMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: ResolveError.MalformedContext },
                    type: 'findIntentsByContextResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`openRequest`, () => {
            let mockOpenStrategy: IMocked<IOpenApplicationStrategy>;
            let mockIncorrectOpenStrategy: IMocked<IOpenApplicationStrategy>;

            beforeEach(() => {
                mockOpenStrategy = Mock.create<IOpenApplicationStrategy>().setup(
                    setupProperty('manifestKey', 'mock-application'),
                    setupFunction('canOpen', () => Promise.resolve(true)),
                    setupFunction('open', () => Promise.resolve(`mock-connection-attempt-uuid`)),
                );
                mockIncorrectOpenStrategy = Mock.create<IOpenApplicationStrategy>().setup(
                    setupProperty('manifestKey', 'mock-application'),
                    setupFunction('canOpen', () => Promise.resolve(true)),
                    setupFunction('open', () => Promise.reject(OpenError.ErrorOnLaunch)),
                );
                mockRootPublisher.setupFunction('awaitAppIdentity', () =>
                    Promise.resolve({ appId: mockedTargetAppId, instanceId: mockedGeneratedUuid }),
                );
            });

            it(`should open app using IOpenApplicationStrategy if applicable one is provided`, async () => {
                const instance = createInstance([mockOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const recordWithNoManifests = { ...mockedApplication };
                delete recordWithNoManifests.hostManifests;

                expect(
                    mockOpenStrategy.withFunction('open').withParametersEqualTo({
                        appDirectoryRecord: recordWithNoManifests,
                        agent: instance,
                        manifest: mockedApplication.hostManifests?.['mock-application'],
                    }),
                ).wasCalledOnce();
            });

            it(`should attempt to open app by opening app url in new browser window if no applicable strategy is passed to constructor`, async () => {
                createInstance([]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                expect(mockWindow.withFunction('open')).wasCalledOnce();
            });

            it(`should publish openResponse containing fullyQualifiedAppIdentifier of opened app`, async () => {
                createInstance([mockOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const expectedMessage: BrowserTypes.OpenResponse = {
                    meta: { ...openMessage.meta, responseUuid: mockedResponseUuid },
                    payload: {
                        appIdentifier: { appId: mockedTargetAppId, instanceId: mockedGeneratedUuid },
                    },
                    type: 'openResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('awaitAppIdentity')
                        .withParametersEqualTo(`mock-connection-attempt-uuid`, mockedApplication),
                ).wasCalledOnce();
                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should pass context object, if provided, to opened app via contextListener`, async () => {
                createInstance([mockOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                        context: contact,
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const target: FullyQualifiedAppIdentifier = {
                    appId: mockedTargetAppId,
                    instanceId: mockedGeneratedUuid,
                };

                expect(mockChannelHandler.withFunction('addListenerCallback')).wasCalledOnce();
                mockChannelHandler.functionCallLookup['addListenerCallback']?.[0][1](target, null);

                await wait();

                const expectedMessage: BrowserTypes.BroadcastEvent = {
                    meta: { eventUuid: mockedEventUuid, timestamp: mockedDate },
                    payload: {
                        channelId: null,
                        context: contact,
                        originatingApp: source,
                    },
                    type: 'broadcastEvent',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishEvent')
                        .withParametersEqualTo(expectedMessage, [
                            { appId: mockedTargetAppId, instanceId: mockedGeneratedUuid },
                        ]),
                ).wasCalledOnce();
            });

            it(`should publish openResponse with OpenError.AppNotFound error message if specified application could not be found`, async () => {
                createInstance([mockOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: `app-not-in-directory` },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const expectedMessage: BrowserTypes.OpenResponse = {
                    meta: { ...openMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: OpenError.AppNotFound },
                    type: 'openResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish openResponse OpenError.MalformedContext error message if provided context is invalid`, async () => {
                createInstance([mockOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                        context: `not-context` as any,
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const expectedMessage: BrowserTypes.OpenResponse = {
                    meta: { ...openMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: OpenError.MalformedContext },
                    type: 'openResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish openResponse with OpenError.ErrorOnLaunch error message if specified application fails to launch correctly`, async () => {
                createInstance([mockIncorrectOpenStrategy.mock]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: mockedTargetAppId },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const expectedMessage: BrowserTypes.OpenResponse = {
                    meta: { ...openMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: OpenError.ErrorOnLaunch },
                    type: 'openResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });

            it(`should publish openResponse with OpenError.ErrorOnLaunch error message if no strategy can open specified application`, async () => {
                createInstance([]);

                const openMessage: BrowserTypes.OpenRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    },
                    payload: {
                        app: { appId: `unopenable-app` },
                    },
                    type: 'openRequest',
                };

                await postRequestMessage(openMessage, source);

                const expectedMessage: BrowserTypes.OpenResponse = {
                    meta: { ...openMessage.meta, responseUuid: mockedResponseUuid },
                    payload: { error: OpenError.ErrorOnLaunch },
                    type: 'openResponse',
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishResponseMessage')
                        .withParametersEqualTo(expectedMessage, source),
                ).wasCalledOnce();
            });
        });

        describe(`getUserChannelsRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const getUserChannelsRequest: BrowserTypes.GetUserChannelsRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {},
                    type: 'getUserChannelsRequest',
                };

                await postRequestMessage(getUserChannelsRequest, source);

                expect(mockChannelHandler.withFunction('onGetUserChannelsRequest')).wasCalledOnce();
            });
        });

        describe(`getCurrentChannelRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const getCurrentChannelRequest: BrowserTypes.GetCurrentChannelRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {},
                    type: 'getCurrentChannelRequest',
                };

                await postRequestMessage(getCurrentChannelRequest, source);

                expect(mockChannelHandler.withFunction('onGetCurrentChannelRequest')).wasCalledOnce();
            });
        });

        describe(`joinUserChannelRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const joinUserChannelRequest: BrowserTypes.JoinUserChannelRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: mockedChannelId,
                    },
                    type: 'joinUserChannelRequest',
                };

                await postRequestMessage(joinUserChannelRequest, source);

                expect(mockChannelHandler.withFunction('onJoinUserChannelRequest')).wasCalledOnce();
            });
        });

        describe(`leaveCurrentChannelRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const leaveCurrentChannelRequest: BrowserTypes.LeaveCurrentChannelRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: mockedChannelId,
                    },
                    type: 'leaveCurrentChannelRequest',
                };

                await postRequestMessage(leaveCurrentChannelRequest, source);

                expect(mockChannelHandler.withFunction('onLeaveCurrentChannelRequest')).wasCalledOnce();
            });
        });

        describe(`createPrivateChannelRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const createPrivateChannelRequest: BrowserTypes.CreatePrivateChannelRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {},
                    type: 'createPrivateChannelRequest',
                };

                await postRequestMessage(createPrivateChannelRequest, source);

                expect(mockChannelHandler.withFunction('onCreatePrivateChannelRequest')).wasCalledOnce();
            });
        });

        describe(`getOrCreateChannelRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const getOrCreateChannelRequest: BrowserTypes.GetOrCreateChannelRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: mockedChannelId,
                    },
                    type: 'getOrCreateChannelRequest',
                };

                await postRequestMessage(getOrCreateChannelRequest, source);

                expect(mockChannelHandler.withFunction('onGetOrCreateChannelRequest')).wasCalledOnce();
            });
        });

        describe(`addContextListenerRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const addContextListenerRequest: BrowserTypes.AddContextListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: null,
                        contextType: null,
                    },
                    type: 'addContextListenerRequest',
                };

                await postRequestMessage(addContextListenerRequest, source);

                expect(mockChannelHandler.withFunction('onAddContextListenerRequest')).wasCalledOnce();
            });
        });

        describe(`contextListenerUnsubscribeRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const contextListenerUnsubscribeRequest: BrowserTypes.ContextListenerUnsubscribeRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        listenerUUID: `mocked-listener-uuid`,
                    },
                    type: 'contextListenerUnsubscribeRequest',
                };

                await postRequestMessage(contextListenerUnsubscribeRequest, source);

                expect(mockChannelHandler.withFunction('onContextListenerUnsubscribeRequest')).wasCalledOnce();
            });
        });

        describe(`broadcastRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const broadcastRequest: BrowserTypes.BroadcastRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        context: contact,
                        channelId: mockedChannelId,
                    },
                    type: 'broadcastRequest',
                };

                await postRequestMessage(broadcastRequest, source);

                expect(mockChannelHandler.withFunction('onBroadcastRequest')).wasCalledOnce();
            });
        });

        describe(`getCurrentContextRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const getCurrentContextRequest: BrowserTypes.GetCurrentContextRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: mockedChannelId,
                        contextType: null,
                    },
                    type: 'getCurrentContextRequest',
                };

                await postRequestMessage(getCurrentContextRequest, source);

                expect(mockChannelHandler.withFunction('onGetCurrentContextRequest')).wasCalledOnce();
            });
        });

        describe(`privateChannelAddEventListenerRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const privateChannelAddEventListenerRequest: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        privateChannelId: mockedChannelId,
                        listenerType: 'disconnect',
                    },
                    type: 'privateChannelAddEventListenerRequest',
                };

                await postRequestMessage(privateChannelAddEventListenerRequest, source);

                expect(mockChannelHandler.withFunction('onPrivateChannelAddEventListenerRequest')).wasCalledOnce();
            });
        });

        describe(`privateChannelUnsubscribeEventListenerRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const privateChannelUnsubscribeEventListenerRequest: BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest =
                    {
                        meta: {
                            requestUuid: mockedRequestUuid,
                            timestamp: currentDate,
                            source,
                        },
                        payload: {
                            listenerUUID: 'mocked-listener-uuid',
                        },
                        type: 'privateChannelUnsubscribeEventListenerRequest',
                    };

                await postRequestMessage(privateChannelUnsubscribeEventListenerRequest, source);

                expect(
                    mockChannelHandler.withFunction('onPrivateChannelUnsubscribeEventListenerRequest'),
                ).wasCalledOnce();
            });
        });

        describe(`privateChannelDisconnectRequest`, () => {
            it(`should pass request to channel message handler`, async () => {
                createInstance();

                const privateChannelDisconnectRequest: BrowserTypes.PrivateChannelDisconnectRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source,
                    },
                    payload: {
                        channelId: mockedChannelId,
                    },
                    type: 'privateChannelDisconnectRequest',
                };

                await postRequestMessage(privateChannelDisconnectRequest, source);

                expect(mockChannelHandler.withFunction('onPrivateChannelDisconnectRequest')).wasCalledOnce();
            });
        });

        describe('heartbeat functionality', () => {
            const disconnectProxyTestTimeout = HEARTBEAT.INTERVAL_MS * (HEARTBEAT.MAX_TRIES + 2);

            it('should start heartbeat monitoring when receiving any message', async () => {
                createInstance();

                const message: BrowserTypes.GetInfoRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: mockedDate,
                        source,
                    },
                    type: 'getInfoRequest',
                    payload: {},
                };

                await postRequestMessage(message, source);

                // Should have sent initial heartbeat
                const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                    type: 'heartbeatEvent',
                    meta: {
                        timestamp: currentDate,
                        eventUuid: mockedEventUuid,
                    },
                    payload: {},
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalledOnce();

                // Should have started heartbeat timer
                await wait(HEARTBEAT.INTERVAL_MS);

                // Should have sent second heartbeat
                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalled(2);
            });

            it('should not start duplicate heartbeat monitoring for existing proxy', async () => {
                createInstance();

                // Start heartbeat monitoring
                const message: BrowserTypes.GetInfoRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: mockedDate,
                        source,
                    },
                    type: 'getInfoRequest',
                    payload: {},
                };

                await postRequestMessage(message, source);

                // Advance timer to trigger first heartbeat timeout
                await wait(HEARTBEAT.INTERVAL_MS);

                const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                    type: 'heartbeatEvent',
                    meta: {
                        timestamp: currentDate,
                        eventUuid: mockedEventUuid,
                    },
                    payload: {},
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalled(2);

                await postRequestMessage(message, source);

                await wait(HEARTBEAT.INTERVAL_MS);

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalled(3);
            });

            it(
                'should disconnect proxy after max retries',
                async () => {
                    createInstance();

                    // Start heartbeat monitoring
                    const message: BrowserTypes.GetInfoRequest = {
                        meta: {
                            requestUuid: mockedRequestUuid,
                            timestamp: mockedDate,
                            source,
                        },
                        type: 'getInfoRequest',
                        payload: {},
                    };

                    await postRequestMessage(message, source);

                    // Advance timer multiple times to exceed max retries
                    await wait(HEARTBEAT.INTERVAL_MS * (HEARTBEAT.MAX_TRIES + 1));

                    // Should have stopped sending heartbeats
                    const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                        type: 'heartbeatEvent',
                        meta: {
                            timestamp: currentDate,
                            eventUuid: mockedEventUuid,
                        },
                        payload: {},
                    };

                    // Heartbeat should only have been sent 3 times not 4 because the disconnect occurred
                    expect(
                        mockRootPublisher
                            .withFunction('publishEvent')
                            .withParametersEqualTo(expectedHeartbeat, [source]),
                    ).wasCalled(3);

                    // Verify the message received a response (proxy is connected)
                    expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasCalledOnce();
                },
                disconnectProxyTestTimeout,
            );

            it('should handle heartbeat acknowledgments', async () => {
                await createInstance();

                const message: BrowserTypes.GetInfoRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: mockedDate,
                        source,
                    },
                    type: 'getInfoRequest',
                    payload: {},
                };

                await postRequestMessage(message, source);

                await wait(HEARTBEAT.INTERVAL_MS);

                const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                    type: 'heartbeatEvent',
                    meta: {
                        timestamp: currentDate,
                        eventUuid: mockedEventUuid,
                    },
                    payload: {},
                };

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalled(2);

                const eventUuid = (
                    mockRootPublisher
                        .withFunction('publishEvent')
                        .withParametersEqualTo(expectedHeartbeat, [source])
                        .getMock().functionCallLookup.publishEvent?.[0][0] as BrowserTypes.HeartbeatEvent
                ).meta.eventUuid;

                const ackMessage: BrowserTypes.HeartbeatAcknowledgementRequest = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: mockedDate,
                        source,
                    },
                    type: 'heartbeatAcknowledgementRequest' as const,
                    payload: {
                        heartbeatEventUuid: eventUuid,
                    },
                };

                await postRequestMessage(ackMessage, source);

                await wait(HEARTBEAT.INTERVAL_MS);

                expect(
                    mockRootPublisher.withFunction('publishEvent').withParametersEqualTo(expectedHeartbeat, [source]),
                ).wasCalled(3);
            });

            it(
                'should handle heartbeat timeouts',
                async () => {
                    createInstance();

                    const message: BrowserTypes.GetInfoRequest = {
                        meta: {
                            requestUuid: mockedRequestUuid,
                            timestamp: mockedDate,
                            source,
                        },
                        type: 'getInfoRequest',
                        payload: {},
                    };

                    await postRequestMessage(message, source);

                    await wait(HEARTBEAT.INTERVAL_MS * (HEARTBEAT.MAX_TRIES + 1));

                    const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                        type: 'heartbeatEvent',
                        meta: {
                            timestamp: currentDate,
                            eventUuid: mockedEventUuid,
                        },
                        payload: {},
                    };

                    expect(
                        mockRootPublisher
                            .withFunction('publishEvent')
                            .withParametersEqualTo(expectedHeartbeat, [source]),
                    ).wasCalled(HEARTBEAT.MAX_TRIES);

                    // Verify the proxy was disconnected and the resources were cleaned up
                    expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasCalledOnce();
                },
                disconnectProxyTestTimeout,
            );

            it(
                'should verify that multiple proxies are managed independently for heartbeat',
                async () => {
                    // Create an instance of the desktop agent
                    createInstance();

                    // Define a second source
                    const secondSource: FullyQualifiedAppIdentifier = {
                        appId: 'second-app@mock-app-directory',
                        instanceId: 'second-instance-id',
                    };

                    // Start heartbeat for first source
                    const firstMessage: BrowserTypes.AddIntentListenerRequest = {
                        meta: {
                            requestUuid: 'first-request-uuid',
                            timestamp: mockedDate,
                            source,
                        },
                        type: 'addIntentListenerRequest',
                        payload: {
                            intent: 'intent',
                        },
                    };

                    await postRequestMessage(firstMessage, source);

                    // Start heartbeat for second source
                    const secondMessage: BrowserTypes.AddIntentListenerRequest = {
                        meta: {
                            requestUuid: 'second-request-uuid',
                            timestamp: mockedDate,
                            source: secondSource,
                        },
                        type: 'addIntentListenerRequest',
                        payload: {
                            intent: 'intent',
                        },
                    };

                    await postRequestMessage(secondMessage, secondSource);

                    // Reset publisher to track heartbeat events separately
                    mockRootPublisher.functionCallLookup.publishEvent = [];

                    // Reset the cleanup disconnected proxy function
                    mockChannelHandler.functionCallLookup.cleanupDisconnectedProxy = [];

                    // Wait for one heartbeat interval
                    await wait(HEARTBEAT.INTERVAL_MS);

                    expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasNotCalled();

                    expect(
                        mockRootPublisher.withFunction('publishEvent').withParameters(
                            {
                                isExpectedValue: event => event.type === 'heartbeatEvent',
                                expectedDisplayValue: 'Is a heartbeat event',
                            },
                            {
                                isExpectedValue: targets =>
                                    targets.some(target => helpersImport.appInstanceEquals(target, source)),
                                expectedDisplayValue: 'for the first proxy',
                            },
                        ),
                    ).wasCalledOnce();
                    expect(
                        mockRootPublisher.withFunction('publishEvent').withParameters(
                            {
                                isExpectedValue: event => event.type === 'heartbeatEvent',
                                expectedDisplayValue: 'Is a heartbeat event',
                            },
                            {
                                isExpectedValue: targets =>
                                    targets.some(target => helpersImport.appInstanceEquals(target, secondSource)),
                                expectedDisplayValue: 'for the second proxy',
                            },
                        ),
                    ).wasCalledOnce();

                    // Wait until one heartbeat before disconnecting
                    await wait(HEARTBEAT.INTERVAL_MS);

                    // Verify the proxy was disconnected and the resources were cleaned up
                    expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasNotCalled();

                    // Find heartbeat events for second proxy so we can send an acknowledgement
                    // We will _not_ send an acknowledgement to the first proxy
                    const secondProxyHeartbeatsAfterWait =
                        mockRootPublisher.functionCallLookup.publishEvent?.filter(call => {
                            const event = call[0] as EventMessage;
                            const targets = call[1] as FullyQualifiedAppIdentifier[];
                            return (
                                event.type === 'heartbeatEvent' &&
                                targets.some(target => helpersImport.appInstanceEquals(target, secondSource))
                            );
                        }) || [];

                    const eventUuid = (secondProxyHeartbeatsAfterWait[0][0] as BrowserTypes.HeartbeatEvent).meta
                        .eventUuid;

                    const ackMessage: BrowserTypes.HeartbeatAcknowledgementRequest = {
                        meta: {
                            requestUuid: mockedRequestUuid,
                            timestamp: mockedDate,
                            source: secondSource,
                        },
                        type: 'heartbeatAcknowledgementRequest' as const,
                        payload: {
                            heartbeatEventUuid: eventUuid,
                        },
                    };

                    await postRequestMessage(ackMessage, secondSource);

                    // Now wait once more so the first proxy can disconnect
                    await wait(HEARTBEAT.INTERVAL_MS * 2);

                    // Verify the proxy was disconnected and the resources were cleaned up
                    expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasCalledOnce();

                    // Reset publisher to track new messages
                    mockRootPublisher.functionCallLookup.publishResponseMessage = [];

                    mockAppDirectory.setupFunction('resolveAppInstanceForIntent', () => Promise.resolve(source));

                    // Try to send messages to both proxies
                    const firstProxyCheckMessage: BrowserTypes.RaiseIntentRequest = {
                        meta: {
                            requestUuid: 'first-check',
                            timestamp: currentDate,
                            source: secondSource,
                        },
                        type: 'raiseIntentRequest',
                        payload: {
                            intent: 'intent',
                            context: {
                                type: 'context',
                            },
                            app: source,
                        },
                    };

                    await postRequestMessage(firstProxyCheckMessage, source);

                    mockAppDirectory.setupFunction('resolveAppInstanceForIntent', () => Promise.resolve(secondSource));

                    const secondProxyCheckMessage: BrowserTypes.RaiseIntentRequest = {
                        meta: {
                            requestUuid: 'second-check',
                            timestamp: currentDate,
                            source: source,
                        },
                        type: 'raiseIntentRequest',
                        payload: {
                            intent: 'intent',
                            context: {
                                type: 'context',
                            },
                            app: secondSource,
                        },
                    };

                    await postRequestMessage(secondProxyCheckMessage, secondSource);

                    // First proxy should be disconnected (no responses), second should be connected
                    expect(
                        mockRootPublisher.withFunction('publishResponseMessage').withParameters(
                            {
                                isExpectedValue: responseMessage => responseMessage.type === 'raiseIntentResponse',
                                expectedDisplayValue: 'Is an raiseIntent response',
                            },
                            {
                                isExpectedValue: target => helpersImport.appInstanceEquals(target, source),
                                expectedDisplayValue: 'for the first proxy',
                            },
                        ),
                    ).wasNotCalled();
                    expect(
                        mockRootPublisher.withFunction('publishResponseMessage').withParameters(
                            {
                                isExpectedValue: responseMessage => responseMessage.type === 'raiseIntentResponse',
                                expectedDisplayValue: 'Is an raiseIntent response',
                            },
                            {
                                isExpectedValue: target => helpersImport.appInstanceEquals(target, secondSource),
                                expectedDisplayValue: 'for the second proxy',
                            },
                        ),
                    ).wasCalledOnce();
                },
                disconnectProxyTestTimeout + HEARTBEAT.INTERVAL_MS,
            );

            it('should handle when an exception is thrown when sending a heartbeat', async () => {
                // Create an instance of the desktop agent
                createInstance();

                // Define a source
                const source: FullyQualifiedAppIdentifier = {
                    appId: 'app@mock-app-directory',
                    instanceId: 'instance-id',
                };

                // Start heartbeat for source
                const message: BrowserTypes.AddIntentListenerRequest = {
                    meta: {
                        requestUuid: 'request-uuid',
                        timestamp: mockedDate,
                        source,
                    },
                    type: 'addIntentListenerRequest',
                    payload: {
                        intent: 'intent',
                    },
                };

                mockRootPublisher.setupFunction('publishEvent', () => {
                    throw new Error();
                });

                // Post the message
                await postRequestMessage(message, source);

                // Verify the proxy was disconnected and the resources were cleaned up
                expect(mockChannelHandler.withFunction('cleanupDisconnectedProxy')).wasCalledOnce();
            });

            it('should not send heartbeats to itself when source is root agent', async () => {
                createInstance();

                const message: RequestMessage = {
                    type: 'getInfoRequest',
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        source: appIdentifier, // Using root agent's identifier as source
                    },
                    payload: {},
                };

                await postRequestMessage(message, appIdentifier);

                // Wait for enough time that a heartbeat would have been sent if it was going to be
                await wait(HEARTBEAT.INTERVAL_MS + 100);

                // Verify no heartbeat was sent
                const expectedHeartbeat: BrowserTypes.HeartbeatEvent = {
                    type: 'heartbeatEvent',
                    payload: {},
                    meta: {
                        eventUuid: mockedGeneratedUuid,
                        timestamp: mockedDate,
                    },
                };

                expect(
                    mockRootPublisher
                        .withFunction('publishEvent')
                        .withParametersEqualTo(expectedHeartbeat, [appIdentifier]),
                ).wasNotCalled();
            });
        });
    });

    async function postRequestMessage(message: RequestMessage, source: FullyQualifiedAppIdentifier): Promise<void> {
        await wait();

        const handler = mockRootPublisher.setterCallLookup.requestMessageHandler?.[0][0];

        if (handler == null) {
            throw new Error(`unable to postRequestMessage as requestMessageHandler is null`);
        }

        mockRootPublisher.setterCallLookup.requestMessageHandler?.[0][0]?.(message, source);

        await wait();
    }

    async function postIncomingMessage(message: ResponseMessage | EventMessage): Promise<void> {
        await wait();

        mockRootPublisher.functionCallLookup.addResponseHandler?.[0][0]?.({ payload: message });

        await wait();
    }

    async function wait(delay: number = 50): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }

    function createMockChannel(channel: BrowserTypes.Channel): IMocked<Channel> {
        return Mock.create<Channel>().setup(
            setupProperty('id', channel.id),
            setupProperty('type', channel.type),
            setupFunction('broadcast', () => Promise.resolve()),
            setupFunction('addContextListener', () => Promise.resolve(Mock.create<Listener>().mock)),
        ) as IMocked<Channel>;
    }
});
