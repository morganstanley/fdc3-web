/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, DesktopAgent, OpenError } from '@finos/fdc3';
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
import { OpenApplicationStrategyParams } from '../contracts.js';
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
    let mockDesktopAgent: IMocked<DesktopAgent>;
    let mockWindow: IMocked<Window>;
    let mockChildWindow: IMocked<Window>;

    // create once as import will only be evaluated and destructured once
    const mockedHelpers = Mock.create<typeof helpersImport>();

    beforeEach(() => {
        mockDesktopAgent = Mock.create<DesktopAgent>();
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

    describe('open', () => {
        it(`should reject Promise with OpenError.ErrorOnLaunch message if app is not a web app with a valid url`, async () => {
            const instance = createInstance(mockWindow.mock);

            const params: OpenApplicationStrategyParams = {
                appDirectoryRecord: mockedIncorrectOtherApplication,
                agent: mockDesktopAgent.mock,
            };

            await expect(instance.open(params)).rejects.toBe(OpenError.ErrorOnLaunch);
        });

        it(`should reject Promise with OpenError.ErrorOnLaunch message if web app could not be opened in new window`, async () => {
            const instance = createInstance(mockWindow.mock);

            const params: OpenApplicationStrategyParams = {
                appDirectoryRecord: mockedIncorrectWebApplication,
                agent: mockDesktopAgent.mock,
            };

            await expect(instance.open(params)).rejects.toBe(OpenError.ErrorOnLaunch);
        });

        it(`should return fullyQualifiedAppIdentifier if web app was successfully opened in a new window`, async () => {
            const instance = createInstance(mockWindow.mock);

            const params: OpenApplicationStrategyParams = {
                appDirectoryRecord: mockedApplication,
                agent: mockDesktopAgent.mock,
            };

            const identityPromise = instance.open(params);

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
});
