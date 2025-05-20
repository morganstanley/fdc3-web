/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { type AppIdentifier, type AppIntent, type Contact, type Context, type Intent, ResolveError } from '@finos/fdc3';
import { IMocked, Mock, proxyModule, registerMock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDirectoryApplication, AppDirectoryApplicationType, WebAppDetails } from '../app-directory.contracts.js';
import {
    BackoffRetryParams,
    FullyQualifiedAppIdentifier,
    IAppResolver,
    ResolveForContextPayload,
    ResolveForIntentPayload,
} from '../contracts.js';
import * as helpersImport from '../helpers/index.js';
import { AppDirectory } from './directory.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedAppIdOne = `app-id-one@mock-app-directory`;
const mockedAppIdTwo = `app-id-two@mock-app-directory`;
const mockedAppIdThree = `app-id-three@mock-app-directory`;
const mockedAppIdFour = `app-id-four@mock-app-directory`;

const mockedAppDirectoryUrl = `https://mock-app-directory`;

const mockedApplicationType: AppDirectoryApplicationType = 'web';
const mockedApplicationOne: AppDirectoryApplication = {
    appId: 'app-id-one',
    title: 'app-title-one',
    type: mockedApplicationType,
    details: {
        url: 'https://mock-url-one',
    },
};
const mockedApplicationTwo: AppDirectoryApplication = {
    appId: 'app-id-two',
    title: 'app-title-two',
    type: mockedApplicationType,
    details: {
        url: 'https://mock-url-two',
    },
    interop: {
        intents: {
            listensFor: {
                ViewChart: { contexts: ['fdc3.chart'], resultType: 'fdc3.currency' },
            },
        },
    },
};
const mockedApplicationThree: AppDirectoryApplication = {
    appId: 'app-id-three',
    title: 'app-title-three',
    type: mockedApplicationType,
    details: {
        url: 'https://mock-url-three',
    },
};

describe(`${AppDirectory.name} (directory)`, () => {
    let mockResolver: IMocked<IAppResolver>;

    let contact: Contact;

    const mockedHelpers = Mock.create<typeof helpersImport>();

    beforeEach(() => {
        mockResolver = Mock.create<IAppResolver>().setup(
            setupFunction('resolveAppForContext'),
            setupFunction('resolveAppForIntent'),
        );

        contact = {
            type: 'fdc3.contact',
            name: 'Joe Bloggs',
            id: {
                username: 'jo_bloggs',
                phone: '079712345678',
            },
        };

        mockedHelpers.setup(
            setupFunction('getAppDirectoryApplications', url => {
                if (url === mockedAppDirectoryUrl) {
                    return Promise.resolve([mockedApplicationOne, mockedApplicationTwo, mockedApplicationThree]);
                } else {
                    return Promise.reject('Error occurred when reading apps from app directory');
                }
            }),
        );
        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(appDirectoryUrls?: string[], backoffRetry?: BackoffRetryParams): AppDirectory {
        return new AppDirectory(Promise.resolve(mockResolver.mock), appDirectoryUrls, backoffRetry);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    describe(`resolveAppInstanceForIntent`, () => {
        it(`should return passed app identifier if instance id is populated`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', []);

            const identifier: FullyQualifiedAppIdentifier = {
                appId: mockedAppIdOne,
                instanceId: 'instanceOne',
            };

            const result = await instance.resolveAppInstanceForIntent('StartChat', { type: 'contact' }, identifier);

            expect(result).toStrictEqual(identifier);
            expect(mockResolver.withFunction('resolveAppForIntent')).wasNotCalled();
        });

        it(`should return app from resolver when instanceId is not present on app identifier`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const identifier: AppIdentifier = {
                appId: mockedAppIdOne,
            };

            const qualifiedIdentifier: FullyQualifiedAppIdentifier = {
                ...identifier,
                instanceId: 'fully-qualified-instanceid',
            };

            mockResolver.setupFunction('resolveAppForIntent', () => Promise.resolve(qualifiedIdentifier));

            const result = await instance.resolveAppInstanceForIntent('StartChat', contact, identifier);

            const expectedPayload: ResolveForIntentPayload = {
                context: contact,
                intent: 'StartChat',
                appIdentifier: identifier,
                appIntent: {
                    apps: [
                        {
                            appId: mockedAppIdOne,
                            instanceId: 'instanceOne',
                            version: undefined,
                            title: 'app-title-one',
                            tooltip: undefined,
                            description: undefined,
                            icons: undefined,
                            screenshots: undefined,
                        },
                        {
                            appId: mockedAppIdTwo,
                            instanceId: 'instanceThree',
                            version: undefined,
                            title: 'app-title-two',
                            tooltip: undefined,
                            description: undefined,
                            icons: undefined,
                            screenshots: undefined,
                        },
                    ],
                    intent: { name: 'StartChat', displayName: 'StartChat' },
                },
            };

            expect(result).toStrictEqual(qualifiedIdentifier);
            expect(
                mockResolver.withFunction('resolveAppForIntent').withParametersEqualTo(expectedPayload),
            ).wasCalledOnce();
        });

        it(`should reject Promise with error message from ResolveError if appIdentifier passed is not known to desktop agent`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const identifier = {
                appId: 'non-fully-qualified-appid',
            };

            const result = instance.resolveAppInstanceForIntent('StartChat', { type: 'contact' }, identifier);

            await expect(result).rejects.toEqual(ResolveError.TargetAppUnavailable);
            expect(mockResolver.withFunction('resolveAppForIntent')).wasNotCalled();
        });

        it(`should reject Promise with TargetInstanceUnavailable error if appId is known to the directory but instanceId is not`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);

            const identifier = {
                appId: mockedAppIdOne,
                instanceId: 'unknown-instance-id',
            };

            const result = instance.resolveAppInstanceForIntent('StartChat', { type: 'contact' }, identifier);

            await expect(result).rejects.toEqual(ResolveError.TargetInstanceUnavailable);
            expect(mockResolver.withFunction('resolveAppForContext')).wasNotCalled();
        });
    });

    describe(`resolveAppInstanceForContext`, () => {
        it(`should return ResolveForContextResponse containing app and intent from resolver`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const qualifiedIdentifier: FullyQualifiedAppIdentifier = {
                appId: mockedAppIdOne,
                instanceId: 'fully-qualified-instanceid',
            };

            mockResolver.setupFunction('resolveAppForContext', () =>
                Promise.resolve({
                    intent: 'StartChat',
                    app: qualifiedIdentifier,
                }),
            );

            const result = await instance.resolveAppInstanceForContext(contact);

            const expectedPayload: ResolveForContextPayload = {
                context: contact,
                appIdentifier: undefined,
                appIntents: [
                    {
                        apps: [
                            {
                                appId: mockedAppIdOne,
                                instanceId: 'instanceOne',
                                version: undefined,
                                title: 'app-title-one',
                                tooltip: undefined,
                                description: undefined,
                                icons: undefined,
                                screenshots: undefined,
                            },
                            {
                                appId: mockedAppIdTwo,
                                instanceId: 'instanceThree',
                                version: undefined,
                                title: 'app-title-two',
                                tooltip: undefined,
                                description: undefined,
                                icons: undefined,
                                screenshots: undefined,
                            },
                        ],
                        intent: { name: 'StartChat', displayName: 'StartChat' },
                    },
                    {
                        apps: [
                            {
                                appId: mockedAppIdTwo,
                                instanceId: 'instanceTwo',
                                version: undefined,
                                title: 'app-title-two',
                                tooltip: undefined,
                                description: undefined,
                                icons: undefined,
                                screenshots: undefined,
                            },
                        ],
                        intent: { name: 'StartEmail', displayName: 'StartEmail' },
                    },
                ],
            };

            expect(result).toStrictEqual({
                intent: 'StartChat',
                app: qualifiedIdentifier,
            });
            expect(
                mockResolver.withFunction('resolveAppForContext').withParametersEqualTo(expectedPayload),
            ).wasCalledOnce();
        });

        it(`should reject Promise with TargetAppUnavailable error if appId passed is not known to the directory`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const identifier = {
                appId: `non-fully-qualified-app-id`,
            };

            const result = instance.resolveAppInstanceForContext(contact, identifier);

            await expect(result).rejects.toEqual(ResolveError.TargetAppUnavailable);
            expect(mockResolver.withFunction('resolveAppForContext')).wasNotCalled();
        });

        it(`should reject Promise with TargetInstanceUnavailable error if appId is known to the directory but instanceId is not`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const identifier = {
                appId: mockedAppIdOne,
                instanceId: 'unknown-instance-id',
            };

            const result = instance.resolveAppInstanceForContext(contact, identifier);

            await expect(result).rejects.toEqual(ResolveError.TargetInstanceUnavailable);
            expect(mockResolver.withFunction('resolveAppForContext')).wasNotCalled();
        });
    });

    describe(`registerIntentListener`, () => {
        it(`should add new instance to directory if instance registering intent has not already been added`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne');

            await instance.registerIntentListener({ appId: mockedAppIdOne, instanceId: 'instanceOne' }, 'StartChat', [
                { type: contact.type },
            ]);

            await expect(instance.getAppInstances(mockedAppIdOne)).resolves.toEqual([
                { appId: mockedAppIdOne, instanceId: 'instanceOne' },
            ]);
        });

        it(`should add new intent to list of intents instance can handle`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne');

            await instance.registerIntentListener({ appId: mockedAppIdOne, instanceId: 'instanceOne' }, 'StartChat', [
                { type: contact.type },
            ]);

            expect(await instance.getAppIntent('StartChat')).toEqual({
                apps: [
                    {
                        appId: mockedAppIdOne,
                        description: undefined,
                        icons: undefined,
                        instanceId: 'instanceOne',
                        screenshots: undefined,
                        title: 'app-title-one',
                        tooltip: undefined,
                        version: undefined,
                    },
                ],
                intent: { name: 'StartChat', displayName: 'StartChat' },
            });
        });

        it(`should not duplicate intents when adding to list of intents instance can handle`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne');

            await instance.registerIntentListener({ appId: mockedAppIdOne, instanceId: 'instanceOne' }, 'StartChat', [
                { type: contact.type },
            ]);
            await instance.registerIntentListener({ appId: mockedAppIdOne, instanceId: 'instanceOne' }, 'StartChat', [
                { type: 'fdc3.contactList' },
            ]);

            await expect(
                instance.getContextForAppIntent({ appId: mockedAppIdOne, instanceId: 'instanceOne' }, 'StartChat'),
            ).resolves.toEqual([{ type: contact.type }, { type: 'fdc3.contactList' }]);
        });

        it(`should reject Promise with ResolveError.TargetAppUnavailable message if app is unknown`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await expect(
                instance.registerIntentListener(
                    { appId: `unqualified-app-id`, instanceId: 'instanceOne' },
                    'StartChat',
                    [{ type: contact.type }],
                ),
            ).rejects.toEqual(ResolveError.TargetAppUnavailable);
        });
    });

    describe(`getAppInstances`, () => {
        it(`should return array of all appIdentifiers in directory with appId that matches passed appId`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);
            await registerApp(instance, mockedApplicationOne, 'instanceFive', 'StartChat', []);

            const result = await instance.getAppInstances(mockedAppIdOne);

            expect(result).toEqual([
                { appId: mockedAppIdOne, instanceId: 'instanceOne' },
                { appId: mockedAppIdOne, instanceId: 'instanceFive' },
            ]);
        });

        it(`should return empty array when app is known to desktop agent but specified app has no registered instances`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getAppInstances(mockedAppIdOne);

            expect(result).toEqual([]);
        });

        it(`should return undefined if app is not known to desktop agent`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getAppInstances(mockedAppIdFour);

            expect(result).toBeUndefined();
        });
    });

    describe(`getAppMetadata`, () => {
        it(`should return AppMetadata for app associated with appId passed to it`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', []);

            const result = await instance.getAppMetadata({ appId: mockedAppIdOne, instanceId: 'instanceOne' });

            expect(result).toEqual({
                appId: mockedAppIdOne,
                instanceId: 'instanceOne',
                description: undefined,
                icons: undefined,
                screenshots: undefined,
                title: 'app-title-one',
                tooltip: undefined,
                version: undefined,
            });
        });

        it(`should return undefined if app is not known to desktop agent`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const result = await instance.getAppMetadata({
                appId: `non-fully-qualified-app-id`,
                instanceId: 'instanceOne',
            });

            expect(result).toBeUndefined();
        });
    });

    describe(`getContextForAppIntent`, () => {
        it('should return an array of all contexts which are handled by given intent and given app', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartChat', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getContextForAppIntent(
                { appId: mockedAppIdTwo, instanceId: 'instanceTwo' },
                'StartEmail',
            );

            expect(result).toStrictEqual([{ type: contact.type, name: undefined, id: undefined }]);
        });

        it('should return empty array if given intent cannot be resolved by given app', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getContextForAppIntent({ appId: mockedAppIdThree }, 'StartChat');

            expect(result).toStrictEqual([]);
        });

        it(`should return undefined if app is not known to desktop agent`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const result = await instance.getContextForAppIntent({ appId: `non-fully-qualified-app-id` }, 'StartChat');

            expect(result).toBeUndefined();
        });
    });

    describe(`getAppIntentsForContext`, () => {
        it('should return appIntents containing intents which handle the given context and the apps that resolve them', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getAppIntentsForContext(contact);

            const expectedResult: AppIntent[] = [
                {
                    apps: [
                        {
                            appId: mockedAppIdOne,
                            description: undefined,
                            icons: undefined,
                            instanceId: 'instanceOne',
                            screenshots: undefined,
                            title: 'app-title-one',
                            tooltip: undefined,
                            version: undefined,
                        },
                        {
                            appId: mockedAppIdTwo,
                            description: undefined,
                            icons: undefined,
                            instanceId: 'instanceThree',
                            screenshots: undefined,
                            title: 'app-title-two',
                            tooltip: undefined,
                            version: undefined,
                        },
                    ],
                    intent: { name: 'StartChat', displayName: 'StartChat' },
                },
                {
                    apps: [
                        {
                            appId: mockedAppIdTwo,
                            description: undefined,
                            icons: undefined,
                            instanceId: 'instanceTwo',
                            screenshots: undefined,
                            title: 'app-title-two',
                            tooltip: undefined,
                            version: undefined,
                        },
                    ],
                    intent: { name: 'StartEmail', displayName: 'StartEmail' },
                },
            ];

            expect(result).toEqual(expectedResult);
        });

        it('should return appIntents containing intents, and the apps that resolve them and return result of resultType when resolving the intent, if resultType is passed', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const result = await instance.getAppIntentsForContext({ type: 'fdc3.chart' }, 'fdc3.currency');

            expect(result).toStrictEqual([
                {
                    apps: [
                        {
                            appId: 'app-id-two@mock-app-directory',
                            description: undefined,
                            icons: undefined,
                            instanceId: undefined,
                            screenshots: undefined,
                            title: 'app-title-two',
                            tooltip: undefined,
                            version: undefined,
                        },
                    ],
                    intent: { displayName: 'ViewChart', name: 'ViewChart' },
                },
            ]);
        });
    });

    describe(`getAppIntent`, () => {
        it('should return appIntent containing all apps that handle given intent', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getAppIntent('StartChat');

            expect(result).toEqual({
                apps: [
                    {
                        appId: mockedAppIdOne,
                        description: undefined,
                        icons: undefined,
                        instanceId: 'instanceOne',
                        screenshots: undefined,
                        title: 'app-title-one',
                        tooltip: undefined,
                        version: undefined,
                    },
                    {
                        appId: mockedAppIdTwo,
                        description: undefined,
                        icons: undefined,
                        instanceId: 'instanceThree',
                        screenshots: undefined,
                        title: 'app-title-two',
                        tooltip: undefined,
                        version: undefined,
                    },
                ],
                intent: { displayName: 'StartChat', name: 'StartChat' },
            });
        });

        it('should return appIntent containing all apps that handle given intent and context, if one is passed', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'instanceOne', 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceTwo', 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'instanceThree', 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'instanceFour', 'ViewHoldings', []);

            const result = await instance.getAppIntent('StartChat', contact);

            expect(result).toStrictEqual({
                apps: [
                    {
                        appId: mockedAppIdOne,
                        description: undefined,
                        icons: undefined,
                        instanceId: 'instanceOne',
                        screenshots: undefined,
                        title: 'app-title-one',
                        tooltip: undefined,
                        version: undefined,
                    },
                ],
                intent: { displayName: 'StartChat', name: 'StartChat' },
            });
        });

        it('should return appIntent containing all apps that return result of resultType when handling given intent, if resultType is passed', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const result = await instance.getAppIntent('ViewChart', undefined, 'fdc3.currency');

            expect(result).toStrictEqual({
                apps: [
                    {
                        appId: 'app-id-two@mock-app-directory',
                        description: undefined,
                        icons: undefined,
                        instanceId: undefined,
                        screenshots: undefined,
                        title: 'app-title-two',
                        tooltip: undefined,
                        version: undefined,
                    },
                ],
                intent: { displayName: 'ViewChart', name: 'ViewChart' },
            });
        });
    });

    describe(`loadAppDirectory`, () => {
        it(`should add all apps in single app directory`, async () => {
            const backoffRetry: BackoffRetryParams = {
                baseDelay: 123,
                maxAttempts: 5,
            };
            const instance = createInstance([mockedAppDirectoryUrl], backoffRetry);

            await wait();

            expect(
                mockedHelpers
                    .withFunction('getAppDirectoryApplications')
                    .withParametersEqualTo(mockedAppDirectoryUrl, backoffRetry),
            ).wasCalledOnce();

            expect(await instance.getAppMetadata({ appId: mockedAppIdOne })).toEqual({
                appId: mockedAppIdOne,
                title: mockedApplicationOne.title,
            });
        });

        it(`should do nothing if no app directory urls are passed`, async () => {
            createInstance([]);

            expect(mockedHelpers.withFunction('getAppDirectoryApplications')).wasNotCalled();
        });

        it(`should add all apps in multiple app directories`, async () => {
            const instance = createInstance(['https://incorrect-mock-app-directory', mockedAppDirectoryUrl]);

            await wait();

            expect(
                mockedHelpers
                    .withFunction('getAppDirectoryApplications')
                    .withParametersEqualTo(mockedAppDirectoryUrl, undefined),
            ).wasCalledOnce();

            expect(await instance.getAppMetadata({ appId: mockedAppIdOne })).toEqual({
                appId: mockedAppIdOne,
                title: mockedApplicationOne.title,
            });
        });
    });

    describe(`getAppDirectoryApplication`, () => {
        it(`should return object of AppDirectoryApplication type for passed appId`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            const app = await instance.getAppDirectoryApplication(mockedAppIdOne);

            expect(app).toEqual({
                appId: mockedAppIdOne,
                details: {
                    url: 'https://mock-url-one',
                },
                title: 'app-title-one',
                type: 'web',
            });
        });

        it(`should return undefined if app is not known to desktop agent`, async () => {
            const instance = createInstance();

            const app = await instance.getAppDirectoryApplication(mockedAppIdOne);

            expect(app).toBeUndefined();
        });
    });

    async function registerApp(
        instance: AppDirectory,
        app: AppDirectoryApplication,
        instanceId: string,
        intent?: Intent,
        context?: Context[],
    ): Promise<void> {
        mockedHelpers.setupFunction('generateUUID', () => instanceId);

        const newInstance = await instance.registerNewInstance((app.details as WebAppDetails).url);

        if (intent != null && context != null) {
            //want to store context in same format, no matter what type of context is passed
            context = context.map(item => ({
                type: item.type,
                name: item.name,
                id: item.id,
            }));

            await instance.registerIntentListener(newInstance.identifier, intent, context);
        }
    }

    async function wait(delay: number = 50): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
});
