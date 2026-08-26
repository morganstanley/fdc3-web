/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, OpenError } from '@finos/fdc3';
import {
    any,
    IMocked,
    Mock,
    proxyModule,
    registerMock,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDirectoryApplicationType } from '../app-directory.contracts.js';
import {
    CloseApplicationStrategyParams,
    DesktopAgentNext,
    FullyQualifiedAppIdentifier,
    OpenApplicationStrategyResolverParams,
} from '../contracts.js';
import * as helpersImport from '../helpers/index.js';
import { FallbackOpenStrategy } from './fallback-open-strategy.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockAppUrl = 'mock-app-url';
const incorrectMockAppUrl = 'incorrect-mock-app-url';
const mockedGeneratedUuid = `mocked-generated-Uuid`;

const mockedWebApplicationType: AppDirectoryApplicationType = 'web';
const mockedApplication = {
    appId: 'app-id-one',
    title: 'app-title-one',
    type: mockedWebApplicationType,
    details: {
        url: mockAppUrl,
    },
};
const mockedIncorrectWebApplication = {
    appId: 'app-id-one',
    title: 'app-title-one',
    type: mockedWebApplicationType,
    details: {
        url: incorrectMockAppUrl,
    },
};

const mockedOtherApplicationType: AppDirectoryApplicationType = 'other';
const mockedIncorrectOtherApplication = {
    appId: 'app-id-one',
    title: 'app-title-one',
    type: mockedOtherApplicationType,
    details: undefined,
};

describe(`${FallbackOpenStrategy.name} (fallback-open-strategy)`, () => {
    let mockDesktopAgent: IMocked<DesktopAgentNext>;
    let mockWindow: IMocked<Window>;
    let mockChildWindow: IMocked<Window>;

    // create once as import will only be evaluated and destructured once
    const mockedHelpers = Mock.create<typeof helpersImport>();

    beforeEach(() => {
        mockDesktopAgent = Mock.create<DesktopAgentNext>();
        mockChildWindow = Mock.create<Window>();
        mockWindow = Mock.create<Window>().setup(
            setupFunction('addEventListener'),
            setupFunction('removeEventListener'),
            setupFunction('open', (url, _target, _features) => {
                if (url === incorrectMockAppUrl) {
                    return null;
                }
                return mockChildWindow.mock;
            }),
        );

        // setup before each to clear function call counts
        mockedHelpers.setup(setupFunction('generateUUID', () => mockedGeneratedUuid));
        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(window?: Window): FallbackOpenStrategy {
        return new FallbackOpenStrategy(window);
    }

    it(`should create`, async () => {
        const instance = createInstance();

        expect(instance).toBeDefined();
        expect(instance.canOpen).toBeDefined();
        expect(instance.open).toBeDefined();
    });

    describe(`canOpen`, () => {
        it(`should return true if type === 'web' and details contains a string url which is not the empty string`, async () => {
            const instance = createInstance();

            expect(
                await instance.canOpen({
                    appDirectoryRecord: { type: 'web', details: { url: mockAppUrl }, appId: '', title: '' },
                    agent: mockDesktopAgent.mock,
                }),
            ).toBe(true);
        });

        it(`should return false if type === 'web' but details contains a url which is the empty string`, async () => {
            const instance = createInstance();

            expect(
                await instance.canOpen({
                    appDirectoryRecord: { type: 'web', details: { url: '' }, appId: '', title: '' },
                    agent: mockDesktopAgent.mock,
                }),
            ).toBe(false);
        });

        it(`should return false if type === 'web' but details does not contain a url string`, async () => {
            const instance = createInstance();

            expect(
                await instance.canOpen({
                    appDirectoryRecord: { type: 'web', details: {} as any, appId: '', title: '' },
                    agent: mockDesktopAgent.mock,
                }),
            ).toBe(false);
        });

        it(`should return false if type != web`, async () => {
            const instance = createInstance();

            expect(
                await instance.canOpen({
                    appDirectoryRecord: { type: 'native', details: { url: mockAppUrl }, appId: '', title: '' },
                    agent: mockDesktopAgent.mock,
                }),
            ).toBe(false);
        });
    });

    const closedAppIdentifier: FullyQualifiedAppIdentifier = {
        appId: 'app-id-one',
        instanceId: 'mocked-instance-id',
    };

    function createOpenParams(
        appReadyPromise: Promise<FullyQualifiedAppIdentifier> = Promise.resolve(closedAppIdentifier),
        appDirectoryRecord: OpenApplicationStrategyResolverParams['appDirectoryRecord'] = mockedApplication,
    ): OpenApplicationStrategyResolverParams {
        return {
            appDirectoryRecord,
            agent: mockDesktopAgent.mock,
            appReadyPromise,
        };
    }

    /**
     * Drives the connection handshake so that instance.open() resolves and the opened window is
     * tracked against the identity that appReadyPromise resolves to.
     */
    async function openAndTrack(
        instance: FallbackOpenStrategy,
        appReadyPromise: Promise<FullyQualifiedAppIdentifier> = Promise.resolve(closedAppIdentifier),
    ): Promise<void> {
        const identityPromise = instance.open(createOpenParams(appReadyPromise));

        const helloMessage: BrowserTypes.WebConnectionProtocol1Hello = {
            meta: { connectionAttemptUuid: 'mock-connection-attempt-uuid', timestamp: new Date() },
            payload: { actualUrl: '', fdc3Version: '1.0', identityUrl: '' },
            type: 'WCP1Hello',
        };

        const mockMessageEvent = Mock.create<MessageEvent>().setup(
            setupProperty('data', helloMessage),
            setupProperty('source', mockChildWindow.mock),
        ).mock;

        (mockWindow.functionCallLookup.addEventListener?.[0][1] as EventListener)?.(mockMessageEvent);

        await identityPromise;
        // allow the appReadyPromise.then() that records the opened window to run
        await appReadyPromise;
        await Promise.resolve();
    }

    describe('open', () => {
        it(`should reject Promise with OpenError.ErrorOnLaunch message if app is not a web app with a valid url`, async () => {
            const instance = createInstance(mockWindow.mock);

            await expect(instance.open(createOpenParams(undefined, mockedIncorrectOtherApplication))).rejects.toBe(
                OpenError.ErrorOnLaunch,
            );
        });

        it(`should reject Promise with OpenError.ErrorOnLaunch message if web app could not be opened in new window`, async () => {
            const instance = createInstance(mockWindow.mock);

            await expect(instance.open(createOpenParams(undefined, mockedIncorrectWebApplication))).rejects.toBe(
                OpenError.ErrorOnLaunch,
            );
        });

        it(`should return fullyQualifiedAppIdentifier if web app was successfully opened in a new window`, async () => {
            const instance = createInstance(mockWindow.mock);

            const identityPromise = instance.open(createOpenParams());

            expect(mockWindow.withFunction('addEventListener').withParameters('message', any())).wasCalledOnce();

            const helloMessage: BrowserTypes.WebConnectionProtocol1Hello = {
                meta: {
                    connectionAttemptUuid: 'mock-connection-attempt-uuid',
                    timestamp: new Date(),
                },
                payload: {
                    actualUrl: '',
                    fdc3Version: '1.0',
                    identityUrl: '',
                },
                type: 'WCP1Hello',
            };

            const mockMessageEvent = Mock.create<MessageEvent>().setup(
                setupProperty('data', helloMessage),
                setupProperty('source', mockChildWindow.mock),
            ).mock;

            (mockWindow.functionCallLookup.addEventListener?.[0][1] as EventListener)?.(mockMessageEvent);

            await expect(identityPromise).resolves.toStrictEqual('mock-connection-attempt-uuid');
        });
    });

    describe('canCloseApp', () => {
        it(`should return false for an app instance that this strategy did not open`, async () => {
            const instance = createInstance(mockWindow.mock);

            const params: CloseApplicationStrategyParams = {
                agent: mockDesktopAgent.mock,
                appIdentifier: closedAppIdentifier,
            };

            expect(await instance.canCloseApp(params)).toBe(false);
        });

        it(`should return true for an app instance opened by this strategy`, async () => {
            const instance = createInstance(mockWindow.mock);

            await openAndTrack(instance);

            const params: CloseApplicationStrategyParams = {
                agent: mockDesktopAgent.mock,
                appIdentifier: closedAppIdentifier,
            };

            expect(await instance.canCloseApp(params)).toBe(true);
        });
    });

    describe('closeApp', () => {
        beforeEach(() => {
            mockChildWindow.setup(setupFunction('close'));
        });

        it(`should close the window that this strategy opened for the given app instance`, async () => {
            const instance = createInstance(mockWindow.mock);

            await openAndTrack(instance);

            await instance.closeApp({ agent: mockDesktopAgent.mock, appIdentifier: closedAppIdentifier });

            expect(mockChildWindow.withFunction('close')).wasCalledOnce();
        });

        it(`should stop tracking a window once it has been closed`, async () => {
            const instance = createInstance(mockWindow.mock);

            await openAndTrack(instance);

            await instance.closeApp({ agent: mockDesktopAgent.mock, appIdentifier: closedAppIdentifier });

            expect(
                await instance.canCloseApp({ agent: mockDesktopAgent.mock, appIdentifier: closedAppIdentifier }),
            ).toBe(false);
        });

        it(`should reject if there is no tracked window for the given app instance`, async () => {
            const instance = createInstance(mockWindow.mock);

            await expect(
                instance.closeApp({ agent: mockDesktopAgent.mock, appIdentifier: closedAppIdentifier }),
            ).rejects.toContain(closedAppIdentifier.instanceId);
        });
    });
});
