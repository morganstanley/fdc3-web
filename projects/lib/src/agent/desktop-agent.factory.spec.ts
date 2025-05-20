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
    defineProperty,
    IMocked,
    Mock,
    proxyModule,
    registerMock,
    reset,
    setupFunction,
} from '@morgan-stanley/ts-mocking-bird';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDirectory } from '../app-directory/index.js';
import {
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    IRootMessagingProvider,
    MessagingProviderFactory,
    UIProviderFactory,
} from '../contracts.js';
import * as helpersImport from '../helpers/index.js';
import { RootMessagePublisher } from '../messaging/index.js';
import { DesktopAgentFactory } from './desktop-agent.factory.js';
import { DesktopAgentImpl } from './desktop-agent.js';
import { DesktopAgentProxy } from './desktop-agent-proxy.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedAppId = `mocked-app-id`;
const mockedInstanceId = 'mocked-instance-id';
const appIdentifier: FullyQualifiedAppIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };

describe(`${DesktopAgentFactory.name} (desktop-agent.factory)`, () => {
    let mockedWindow: IMocked<Window>;
    let mockedHelpers: IMocked<typeof helpersImport>;

    beforeEach(() => {
        mockedWindow = Mock.create<Window>().setup(setupFunction('dispatchEvent'), defineProperty('fdc3'));
        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => mockedInstanceId),
            setupFunction('getWindow', () => mockedWindow.mock),
        );

        registerMock(helpersImport, mockedHelpers.mock);
    });

    afterEach(() => {
        reset(helpersImport);
    });

    let defaultRootMessagingProviderFactory: MessagingProviderFactory<IRootMessagingProvider> | undefined;
    let rootMessagePublisherFactory:
        | ((
              messagingProvider: IRootMessagingProvider,
              directory: AppDirectory,
              window: WindowProxy,
          ) => RootMessagePublisher)
        | undefined;

    function createInstance(): DesktopAgentFactory {
        return new DesktopAgentFactory(defaultRootMessagingProviderFactory, rootMessagePublisherFactory);
    }

    it(`should create factory`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    describe(`createProxy`, () => {
        let mockedMessagingProvider: IMocked<IProxyMessagingProvider>;
        let mockedFactory: IMocked<{ factory: MessagingProviderFactory<IProxyMessagingProvider> }>;

        beforeEach(() => {
            mockedMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(setupFunction('addResponseHandler'));

            mockedFactory = Mock.create<{ factory: MessagingProviderFactory<IProxyMessagingProvider> }>().setup(
                setupFunction('factory', () => Promise.resolve(mockedMessagingProvider.mock)),
            );
        });

        it(`should create agent`, async () => {
            const instance = createInstance();

            const agent = await instance.createProxy({
                messagingProviderFactory: mockedFactory.mock.factory,
                appIdentifier,
            });

            expect(agent).toBeDefined();
            expect(agent).toBeInstanceOf(DesktopAgentProxy);
        });

        it(`should dispatch a ready event if window.fdc3 agent is not already set`, async () => {
            const instance = createInstance();

            await instance.createProxy({
                messagingProviderFactory: mockedFactory.mock.factory,
                appIdentifier,
            });

            expect(mockedWindow.withFunction('dispatchEvent')).wasCalledOnce();
        });

        it(`should not dispatch an event if window.fdc3 is already set`, async () => {
            mockedWindow.setupProperty('fdc3', {} as any);
            const instance = createInstance();

            await instance.createProxy({
                messagingProviderFactory: mockedFactory.mock.factory,
                appIdentifier,
            });

            expect(mockedWindow.withFunction('dispatchEvent')).wasNotCalled();
        });

        it(`should set window.fdc3 if it is not already set`, async () => {
            const instance = createInstance();

            await instance.createProxy({
                messagingProviderFactory: mockedFactory.mock.factory,
                appIdentifier,
            });

            expect(mockedWindow.withSetter('fdc3')).wasCalledOnce();
        });

        it(`should not set window.fdc3 if it is already set`, async () => {
            mockedWindow.setupProperty('fdc3', {} as any);
            const instance = createInstance();

            await instance.createProxy({
                messagingProviderFactory: mockedFactory.mock.factory,
                appIdentifier,
            });

            expect(mockedWindow.withSetter('fdc3')).wasNotCalled();
        });
    });

    describe(`createRoot`, () => {
        let mockedMessagingProvider: IMocked<IRootMessagingProvider>;
        let mockedFactory: IMocked<{ factory: MessagingProviderFactory<IRootMessagingProvider> }>;
        let mockPublisher: IMocked<RootMessagePublisher>;

        beforeEach(() => {
            mockPublisher = Mock.create<RootMessagePublisher>().setup(
                setupFunction('initialize', () => Promise.resolve(appIdentifier)),
                setupFunction('addResponseHandler'),
            );

            mockedMessagingProvider = Mock.create<IRootMessagingProvider>();

            mockedFactory = Mock.create<{ factory: MessagingProviderFactory<IRootMessagingProvider> }>().setup(
                setupFunction('factory', () => Promise.resolve(mockedMessagingProvider.mock)),
            );

            defaultRootMessagingProviderFactory = () => Promise.resolve(mockedMessagingProvider.mock);
            rootMessagePublisherFactory = () => mockPublisher.mock;
        });

        it(`should create agent`, async () => {
            const instance = createInstance();

            const agent = await instance.createRoot({
                messagingProviderFactory: mockedFactory.mock.factory,
                backoffRetry: { maxAttempts: 1, baseDelay: 100 },
            });

            expect(agent).toBeDefined();

            expect(agent).toBeInstanceOf(DesktopAgentImpl);
        });

        it(`should create agent with ui provider`, async () => {
            const instance = createInstance();

            const mockUiProviderFactory = Mock.create<{ factory: UIProviderFactory }>().setup(setupFunction('factory'));

            const agent = await instance.createRoot({
                messagingProviderFactory: mockedFactory.mock.factory,
                uiProvider: mockUiProviderFactory.mock.factory,
            });

            expect(agent).toBeDefined();

            expect(agent).toBeInstanceOf(DesktopAgentImpl);
            expect(mockUiProviderFactory.withFunction('factory')).wasCalledOnce();
        });

        it(`should dispatch a ready event if window.fdc3 agent is not already set`, async () => {
            const instance = createInstance();

            await instance.createRoot({ messagingProviderFactory: mockedFactory.mock.factory });

            expect(mockedWindow.withFunction('dispatchEvent')).wasCalledOnce();
        });

        it(`should not dispatch an event if window.fdc3 is already set`, async () => {
            mockedWindow.setupProperty('fdc3', {} as any);
            const instance = createInstance();

            await instance.createRoot({ messagingProviderFactory: mockedFactory.mock.factory });

            expect(mockedWindow.withFunction('dispatchEvent')).wasNotCalled();
        });

        it(`should set window.fdc3 if it is not already set`, async () => {
            const instance = createInstance();

            await instance.createRoot({ messagingProviderFactory: mockedFactory.mock.factory });

            expect(mockedWindow.withSetter('fdc3')).wasCalledOnce();
        });

        it(`should not set window.fdc3 if it is already set`, async () => {
            mockedWindow.setupProperty('fdc3', {} as any);
            const instance = createInstance();

            await instance.createRoot({ messagingProviderFactory: mockedFactory.mock.factory });

            expect(mockedWindow.withSetter('fdc3')).wasNotCalled();
        });
    });
});
