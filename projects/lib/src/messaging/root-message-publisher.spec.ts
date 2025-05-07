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
import {
    IMocked,
    Mock,
    proxyJestModule,
    registerMock,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { AppDirectory } from '../app-directory';
import { AppDirectoryApplication } from '../app-directory.contracts';
import { FDC3_PROVIDER, FDC3_VERSION } from '../constants';
import {
    FullyQualifiedAppIdentifier,
    IncomingMessageCallback,
    IProxyIncomingMessageEnvelope,
    IRootMessagingProvider,
    RequestMessage,
} from '../contracts';
import * as helpersImport from '../helpers';
import { RootMessagePublisher } from './root-message-publisher';

jest.mock('../helpers', () => proxyJestModule(require.resolve('../helpers')));

const mockedDate = new Date(2024, 1, 0, 0, 0, 0);
const mockedRootGeneratedUuid = `mocked-root-generated-Uuid`;
const rootAppIdentity: FullyQualifiedAppIdentifier = { appId: 'root-app-id', instanceId: mockedRootGeneratedUuid };
const sourceAppId = `source-app-id`;

describe('RootMessagePublisher', () => {
    let mockRootMessagingProvider: IMocked<
        IRootMessagingProvider<RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity>
    >;
    let mockDirectory: IMocked<AppDirectory>;
    let mockWindowRef: IMocked<WindowProxy>;
    let mockedHelpers: IMocked<typeof helpersImport>;
    let mockRequestHandler: IMocked<{
        handler: (message: RequestMessage, source: FullyQualifiedAppIdentifier) => void;
    }>;
    let generateUuidResult: string;

    beforeEach(() => {
        generateUuidResult = mockedRootGeneratedUuid;
        mockRootMessagingProvider = Mock.create<
            IRootMessagingProvider<RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity>
        >().setup(setupFunction('subscribe'), setupFunction('publish'));
        mockRequestHandler = Mock.create();
        mockRequestHandler.setupFunction('handler');

        const mockAppDirectoryApplication = Mock.create<AppDirectoryApplication>().setup(
            setupProperty('appId', rootAppIdentity.appId),
        ).mock;

        mockDirectory = Mock.create<AppDirectory>().setup(
            setupFunction('registerNewInstance', () =>
                Promise.resolve({ application: mockAppDirectoryApplication, identifier: rootAppIdentity }),
            ),
        );
        mockWindowRef = Mock.create<WindowProxy>().setup(
            setupProperty('location', Mock.create<Location>().setup(setupProperty('href', 'mock-location')).mock),
        );

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => generateUuidResult),
            setupFunction('getTimestamp', () => mockedDate),
        );

        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(): RootMessagePublisher {
        return new RootMessagePublisher(mockRootMessagingProvider.mock, mockDirectory.mock, mockWindowRef.mock);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
        expect(mockRootMessagingProvider.withFunction('subscribe')).wasCalledOnce();
    });

    describe('initialise', () => {
        it('should call determineIdentity with the provided identityUrl', async () => {
            const instance = createInstance();
            await instance.initialise('mock-identity-url');

            expect(
                mockDirectory.withFunction('registerNewInstance').withParameters('mock-identity-url'),
            ).wasCalledOnce();
        });

        it('should call determineIdentity with the current window location if identityUrl is not provided', async () => {
            const instance = createInstance();
            await instance.initialise();

            expect(mockDirectory.withFunction('registerNewInstance').withParameters('mock-location')).wasCalledOnce();
        });

        it('should set the rootAppIdentifier and return it', async () => {
            const instance = createInstance();
            const result = await instance.initialise();

            expect(result).toEqual(rootAppIdentity);
        });

        it('should throw an error if rootAppIdentifier is not set', async () => {
            mockDirectory.setupFunction('registerNewInstance', () => Promise.reject('some error from directory'));
            const instance = createInstance();

            await expect(instance.initialise()).rejects.toThrow('some error from directory');
        });
    });

    describe('sendMessage', () => {
        const requestMessage: BrowserTypes.GetInfoRequest = {
            meta: {
                requestUuid: 'requestUuid',
                timestamp: mockedDate,
            },
            payload: {},
            type: 'getInfoRequest',
        };

        it('should throw an error if initialise has not completed', async () => {
            const instance = createInstance();

            expect(() => instance.sendMessage({ payload: requestMessage })).toThrow(
                'sendMessage called before RootMessagePublisher has been initialised',
            );
        });

        it('should call handleRequestMessage with the message payload and rootAppIdentifier', async () => {
            const instance = createInstance();
            await instance.initialise();
            instance.requestMessageHandler = mockRequestHandler.mock.handler;

            instance.sendMessage({ payload: requestMessage });

            expect(
                mockRequestHandler.withFunction('handler').withParametersEqualTo(requestMessage, rootAppIdentity),
            ).wasCalledOnce();
        });
    });

    describe('publishResponseMessage', () => {
        const responseMessage: BrowserTypes.RaiseIntentResponse = {
            meta: {
                requestUuid: 'requestUuid',
                responseUuid: 'responseUuid',
                timestamp: mockedDate,
            },
            payload: {},
            type: 'raiseIntentResponse',
        };

        it('should call proxyResponseHandlers with the response message if the source is the root agent', async () => {
            const callbackOne = Mock.create<ProxyCallback>().setup(setupFunction('callback'));
            const callbackTwo = Mock.create<ProxyCallback>().setup(setupFunction('callback'));
            const instance = createInstance();
            await instance.initialise();

            instance.addResponseHandler(callbackOne.mock.callback);
            instance.addResponseHandler(callbackTwo.mock.callback);

            instance.publishResponseMessage(responseMessage, rootAppIdentity);

            expect(
                callbackOne.withFunction('callback').withParametersEqualTo({ payload: responseMessage }),
            ).wasCalledOnce();
            expect(
                callbackTwo.withFunction('callback').withParametersEqualTo({ payload: responseMessage }),
            ).wasCalledOnce();
        });

        it('should publish the response message to the root messaging provider if the source is not the root agent', async () => {
            const instance = createInstance();
            await instance.initialise();

            const sourceAppOne: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceOne',
            };
            await registerNewProxy(sourceAppOne, 'channelOne');
            instance.publishResponseMessage(responseMessage, sourceAppOne);

            expect(
                mockRootMessagingProvider
                    .withFunction('publish')
                    .withParametersEqualTo({ payload: responseMessage, channelIds: ['channelOne'] }),
            ).wasCalledOnce();

            const sourceAppTwo: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceTwo',
            };
            await registerNewProxy(sourceAppTwo, 'channelTwo');

            mockRootMessagingProvider.setupFunction('publish'); // reset counts

            instance.publishResponseMessage(responseMessage, sourceAppTwo);

            expect(
                mockRootMessagingProvider
                    .withFunction('publish')
                    .withParametersEqualTo({ payload: responseMessage, channelIds: ['channelTwo'] }),
            ).wasCalledOnce();
            expect(
                mockRootMessagingProvider
                    .withFunction('publish')
                    .withParametersEqualTo({ payload: responseMessage, channelIds: ['channelOne'] }),
            ).wasNotCalled();
        });

        it('should log an error if channelId cannot be resolved for unknown source app', async () => {
            const instance = createInstance();
            await instance.initialise();
            const consoleError = jest.spyOn(console, 'error').mockImplementation();

            const sourceAppOne: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'unknown-instance-id',
            };
            instance.publishResponseMessage(responseMessage, sourceAppOne);

            expect(consoleError).toHaveBeenCalledWith(
                `Could not resolve channelId for unknown source app: ${sourceAppId} (unknown-instance-id)`,
            );
        });
    });

    describe('onMessage', () => {
        it('should log an error when source cannot be resolved for an unknown channelId', async () => {
            const instance = createInstance();
            await instance.initialise();

            // Mock console.error
            const consoleError = jest.spyOn(console, 'error').mockImplementation();

            // Create a request message
            const requestMessage: BrowserTypes.GetInfoRequest = {
                meta: {
                    requestUuid: 'requestUuid',
                    timestamp: mockedDate,
                },
                payload: {},
                type: 'getInfoRequest',
            };

            // Simulate receiving a message with an unknown channelId
            mockRootMessagingProvider.functionCallLookup.subscribe?.[0][0]({
                payload: requestMessage,
                channelId: 'unknown-channel-id',
            });

            // The test passes if the error was logged
            expect(consoleError).toHaveBeenCalledWith(
                `Could not resolve source for unknown channelId: unknown-channel-id`,
            );

            // Clean up
            consoleError.mockRestore();
        });
    });

    describe('publishEvent', () => {
        const eventMessage: BrowserTypes.IntentEvent = {
            meta: {
                timestamp: mockedDate,
                eventUuid: 'event-uuid',
            },
            payload: {
                context: { type: 'sample.context' },
                intent: 'startCall',
                raiseIntentRequestUuid: 'raise-intent-request-uuid',
            },
            type: 'intentEvent',
        };

        it('should call proxyResponseHandlers with the event message if the target is the root agent', async () => {
            const callbackOne = Mock.create<ProxyCallback>().setup(setupFunction('callback'));
            const callbackTwo = Mock.create<ProxyCallback>().setup(setupFunction('callback'));
            const instance = createInstance();
            await instance.initialise();

            instance.addResponseHandler(callbackOne.mock.callback);
            instance.addResponseHandler(callbackTwo.mock.callback);

            instance.publishEvent(eventMessage, [rootAppIdentity]);

            expect(
                callbackOne.withFunction('callback').withParametersEqualTo({ payload: eventMessage }),
            ).wasCalledOnce();
            expect(
                callbackTwo.withFunction('callback').withParametersEqualTo({ payload: eventMessage }),
            ).wasCalledOnce();
        });

        it('should publish the event message to the root messaging provider', async () => {
            const instance = createInstance();
            await instance.initialise();

            const sourceAppOne: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceOne',
            };
            await registerNewProxy(sourceAppOne, 'channelOne');

            instance.publishEvent(eventMessage, [sourceAppOne]);

            expect(
                mockRootMessagingProvider
                    .withFunction('publish')
                    .withParametersEqualTo({ payload: eventMessage, channelIds: ['channelOne'] }),
            ).wasCalledOnce();
        });

        it(`should send event to multiple sources`, async () => {
            const instance = createInstance();
            await instance.initialise();

            const sourceAppOne: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceOne',
            };
            await registerNewProxy(sourceAppOne, 'channelOne');

            const sourceAppTwo: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceTwo',
            };
            await registerNewProxy(sourceAppTwo, 'channelTwo');

            const sourceAppThree: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'instanceThree',
            };
            await registerNewProxy(sourceAppThree, 'channelThree');

            const unknownSourceApp: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'unknown-instance',
            };

            mockRootMessagingProvider.setupFunction('publish'); // reset counts

            instance.publishEvent(eventMessage, [sourceAppOne, sourceAppTwo, sourceAppThree, unknownSourceApp]);

            expect(
                mockRootMessagingProvider.withFunction('publish').withParametersEqualTo({
                    payload: eventMessage,
                    channelIds: ['channelOne', 'channelTwo', 'channelThree'],
                }),
            ).wasCalledOnce();
        });

        it('should log an error if channelId cannot be resolved for unknown source app', async () => {
            const instance = createInstance();
            await instance.initialise();
            const consoleError = jest.spyOn(console, 'error').mockImplementation();

            const sourceAppOne: FullyQualifiedAppIdentifier = {
                appId: sourceAppId,
                instanceId: 'unknown-instance-id',
            };
            instance.publishEvent(eventMessage, [sourceAppOne]);

            expect(consoleError).toHaveBeenCalledWith(
                `Could not resolve channelId for unknown source app: ${sourceAppId} (unknown-instance-id)`,
            );
        });
    });

    async function registerNewProxy(sourceApp: FullyQualifiedAppIdentifier, channelId: string): Promise<void> {
        generateUuidResult = sourceApp.instanceId;
        mockDirectory.setupFunction('registerNewInstance', () => {
            return Promise.resolve({
                application: Mock.create<AppDirectoryApplication>().setup(setupProperty('appId', sourceApp.appId)).mock,
                identifier: sourceApp,
            });
        });

        const validationMessage = createValidationRequestMessage();

        mockRootMessagingProvider.functionCallLookup.subscribe?.[0][0]({
            payload: validationMessage,
            channelId: channelId,
        });

        await waitForMessage(message => message.payload.type === 'WCP5ValidateAppIdentityResponse');

        const expectedMessage: BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse = {
            type: 'WCP5ValidateAppIdentityResponse',
            meta: {
                connectionAttemptUuid: validationMessage.meta.connectionAttemptUuid,
                timestamp: mockedDate,
            },
            payload: {
                appId: sourceApp.appId,
                instanceId: sourceApp.instanceId,
                instanceUuid: sourceApp.instanceId,
                implementationMetadata: {
                    fdc3Version: FDC3_VERSION,
                    provider: FDC3_PROVIDER,
                    optionalFeatures: {
                        OriginatingAppMetadata: true,
                        UserChannelMembershipAPIs: true,
                        DesktopAgentBridging: false,
                    },
                    appMetadata: {
                        appId: sourceApp.appId,
                        instanceId: sourceApp.instanceId,
                        version: undefined,
                        title: undefined,
                        tooltip: undefined,
                        description: undefined,
                        icons: undefined,
                        screenshots: undefined,
                    },
                },
            },
        };

        expect(
            mockRootMessagingProvider
                .withFunction('publish')
                .withParametersEqualTo({ payload: expectedMessage as any, channelIds: [channelId] }),
        ).wasCalledOnce();
    }

    function waitForMessage(predicate: (value: any) => boolean): Promise<void> {
        return new Promise(resolve => {
            mockRootMessagingProvider.setupFunction('publish', message => {
                if (predicate(message)) {
                    resolve();
                }
            });
        });
    }

    function createValidationRequestMessage(): BrowserTypes.WebConnectionProtocol4ValidateAppIdentity {
        return {
            meta: {
                timestamp: mockedDate,
                connectionAttemptUuid: 'mock-connection-attempt-uuid',
            },
            payload: {
                actualUrl: '',
                identityUrl: '',
            },
            type: 'WCP4ValidateAppIdentity',
        };
    }
});

type ProxyCallback = {
    callback: IncomingMessageCallback<IProxyIncomingMessageEnvelope>;
};
