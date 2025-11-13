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
import {
    AppDirectoryApplication,
    AppDirectoryApplicationType,
    LocalAppDirectory,
    WebAppDetails,
} from '../app-directory.contracts.js';
import {
    BackoffRetryParams,
    FullyQualifiedAppIdentifier,
    IAppResolver,
    ResolveForContextPayload,
    ResolveForIntentPayload,
} from '../contracts.js';
import * as helpersImport from '../helpers/index.js';
import { createWebAppDirectoryEntry } from '../helpers/index.js';
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
    let uuidCount: number;

    const mockedHelpers = Mock.create<typeof helpersImport>();

    beforeEach(() => {
        const mockedInstanceIds = [
            'instanceZero', // this should get assigned to the root app
            'instanceOne',
            'instanceTwo',
            'instanceThree',
            'instanceFour',
            'instanceFive',
        ];
        uuidCount = 0;
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
            setupFunction('generateUUID', () => mockedInstanceIds.shift() ?? `no-more-instance-ids_${uuidCount++}`),
        );
        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(
        appDirectoryUrls?: (string | LocalAppDirectory)[],
        backoffRetry?: BackoffRetryParams,
        appId = 'mock-root-app-id',
    ): AppDirectory {
        return new AppDirectory(appId, Promise.resolve(mockResolver.mock), appDirectoryUrls, backoffRetry);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();

        expect(instance.rootAppIdentifier.appId).toEqual('mock-root-app-id@localhost');
        expect(typeof instance.rootAppIdentifier.instanceId).toBe('string');
    });

    it(`should create with fully qualified app id`, () => {
        const instance = createInstance(undefined, undefined, 'fully-qualified-app-id@some-domain');

        expect(instance.rootAppIdentifier.appId).toEqual('fully-qualified-app-id@some-domain');
        expect(typeof instance.rootAppIdentifier.instanceId).toBe('string');
    });

    describe(`resolveAppInstanceForIntent`, () => {
        it(`should return passed app identifier if instance id is populated`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', []);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

            const identifier = {
                appId: `non-fully-qualified-app-id`,
            };

            const result = instance.resolveAppInstanceForContext(contact, identifier);

            await expect(result).rejects.toEqual(ResolveError.TargetAppUnavailable);
            expect(mockResolver.withFunction('resolveAppForContext')).wasNotCalled();
        });

        it(`should reject Promise with TargetInstanceUnavailable error if appId is known to the directory but instanceId is not`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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
        it.skip(`should add new instance to directory if instance registering intent has not already been added`, async () => {
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

            await instance.registerIntentListener(
                { appId: mockedAppIdOne, instanceId: 'instanceOne' },
                'notAKnownIntent',
                [{ type: contact.type }],
            );

            expect(await instance.getAppIntent('notAKnownIntent')).toEqual({
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
                intent: { name: 'notAKnownIntent', displayName: 'notAKnownIntent' },
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

            await registerApp(instance, mockedApplicationOne, 'StartChat', []);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);
            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

            const result = await instance.getAppInstances(mockedAppIdOne);

            expect(result).toEqual([
                { appId: mockedAppIdOne, instanceId: 'instanceOne' },
                { appId: mockedAppIdOne, instanceId: 'instanceFive' },
            ]);
        });

        it(`should return empty array when app is known to desktop agent but specified app has no registered instances`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationTwo, 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

            const result = await instance.getAppInstances(mockedAppIdOne);

            expect(result).toEqual([]);
        });

        it(`should return undefined if app is not known to desktop agent`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationTwo, 'StartEmail', []);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

            const result = await instance.getAppInstances(mockedAppIdFour);

            expect(result).toBeUndefined();
        });
    });

    describe(`getAppMetadata`, () => {
        it(`should return AppMetadata for app associated with appId passed to it`, async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [{ type: contact.type }]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

            const result = await instance.getContextForAppIntent(
                { appId: mockedAppIdTwo, instanceId: 'instanceThree' },
                'StartEmail',
            );

            expect(result).toStrictEqual([{ type: contact.type, name: undefined, id: undefined }]);
        });

        it('should return empty array if given intent cannot be resolved by given app', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

            await registerApp(instance, mockedApplicationOne, 'StartChat', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartEmail', [contact]);
            await registerApp(instance, mockedApplicationTwo, 'StartChat', []);
            await registerApp(instance, mockedApplicationThree, 'ViewHoldings', []);

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

        it(`should do nothing if no app directory is passed`, async () => {
            createInstance();

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

        it(`should add locally defined app directories`, async () => {
            const instance = createInstance([
                {
                    host: 'my-app.com',
                    apps: [
                        createWebAppDirectoryEntry('localAppIdOne', 'http://my-app.com/path', 'My First App'),
                        createWebAppDirectoryEntry('localAppIdTwo', 'http://my-app.com/otherPath', 'My Other App'),
                    ],
                },
                mockedAppDirectoryUrl,
            ]);

            await wait();

            expect(
                mockedHelpers
                    .withFunction('getAppDirectoryApplications')
                    .withParametersEqualTo(mockedAppDirectoryUrl, undefined)
                    .strict(),
            ).wasCalledOnce();

            expect(await instance.getAppMetadata({ appId: mockedAppIdOne })).toEqual({
                appId: mockedAppIdOne,
                title: mockedApplicationOne.title,
            });

            expect(await instance.getAppMetadata({ appId: 'localAppIdOne@my-app.com' })).toEqual({
                appId: 'localAppIdOne@my-app.com',
                title: 'My First App',
            });

            expect(await instance.getAppMetadata({ appId: 'localAppIdTwo@my-app.com' })).toEqual({
                appId: 'localAppIdTwo@my-app.com',
                title: 'My Other App',
            });
        });

        it('should add app when iterator emits app after initial load', async () => {
            let emitFunction:
                | ((value: AppDirectoryApplication) => Promise<IteratorResult<AppDirectoryApplication>>)
                | undefined;

            const updates: AsyncIterator<AppDirectoryApplication> = {
                next: async () => {
                    const nextPromise = new Promise<IteratorResult<AppDirectoryApplication>>(resolve => {
                        emitFunction = value => {
                            resolve({ done: false, value });

                            return nextPromise;
                        };
                    });

                    return nextPromise;
                },
            };

            const instance = createInstance([
                {
                    host: 'my-app.com',
                    apps: [],
                    updates,
                },
                mockedAppDirectoryUrl,
            ]);

            expect(await instance.getAppMetadata({ appId: 'localAppIdOne@my-app.com' })).toBeUndefined();

            await emitFunction?.(createWebAppDirectoryEntry('localAppIdOne', 'http://my-app.com/path', 'My First App'));

            expect(await instance.getAppMetadata({ appId: 'localAppIdOne@my-app.com' })).toEqual({
                appId: 'localAppIdOne@my-app.com',
                title: 'My First App',
            });

            expect(await instance.getAppMetadata({ appId: 'localAppIdTwo@my-app.com' })).toBeUndefined();

            await emitFunction?.(
                createWebAppDirectoryEntry('localAppIdTwo', 'http://my-app.com/otherPath', 'My Other App'),
            );

            expect(await instance.getAppMetadata({ appId: 'localAppIdTwo@my-app.com' })).toEqual({
                appId: 'localAppIdTwo@my-app.com',
                title: 'My Other App',
            });
        });

        it('should add multiple apps when iterator emits apps after initial load', async () => {
            let emitFunction:
                | ((value: AppDirectoryApplication[]) => Promise<IteratorResult<AppDirectoryApplication[]>>)
                | undefined;

            const updates: AsyncIterator<AppDirectoryApplication[]> = {
                next: async () => {
                    const nextPromise = new Promise<IteratorResult<AppDirectoryApplication[]>>(resolve => {
                        emitFunction = value => {
                            resolve({ done: false, value });

                            return nextPromise;
                        };
                    });

                    return nextPromise;
                },
            };

            const instance = createInstance([
                {
                    host: 'my-app.com',
                    apps: [],
                    updates,
                },
                mockedAppDirectoryUrl,
            ]);

            expect(await instance.getAppMetadata({ appId: 'localAppIdOne@my-app.com' })).toBeUndefined();
            expect(await instance.getAppMetadata({ appId: 'localAppIdTwo@my-app.com' })).toBeUndefined();

            await emitFunction?.([
                createWebAppDirectoryEntry('localAppIdOne', 'http://my-app.com/path', 'My First App'),
                createWebAppDirectoryEntry('localAppIdTwo', 'http://my-app.com/otherPath', 'My Other App'),
            ]);

            expect(await instance.getAppMetadata({ appId: 'localAppIdOne@my-app.com' })).toEqual({
                appId: 'localAppIdOne@my-app.com',
                title: 'My First App',
            });

            expect(await instance.getAppMetadata({ appId: 'localAppIdTwo@my-app.com' })).toEqual({
                appId: 'localAppIdTwo@my-app.com',
                title: 'My Other App',
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

            const app = await instance.getAppDirectoryApplication('unknown-app-id');

            expect(app).toBeUndefined();
        });
    });

    describe('removeDisconnectedApp', () => {
        it('should remove a specific disconnected app instance from the directory', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);
            await registerApp(instance, mockedApplicationOne, 'StartChat', []);
            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

            // Remove instanceOne
            instance.removeDisconnectedApp({ appId: mockedAppIdOne, instanceId: 'instanceOne' });

            const appInstances = await instance.getAppInstances(mockedAppIdOne);
            expect(appInstances).toEqual([{ appId: mockedAppIdOne, instanceId: 'instanceTwo' }]);
        });

        it('should do nothing if app is not known to the directory', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);
            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

            // Try to remove an unknown app
            instance.removeDisconnectedApp({ appId: 'unknown-app-id', instanceId: 'instanceX' });

            const appInstances = await instance.getAppInstances(mockedAppIdOne);
            expect(appInstances).toEqual([{ appId: mockedAppIdOne, instanceId: 'instanceOne' }]);
        });

        it('should do nothing if instanceId is not known for the app', async () => {
            const instance = createInstance([mockedAppDirectoryUrl]);
            await registerApp(instance, mockedApplicationOne, 'StartChat', []);

            // Try to remove an unknown instanceId
            instance.removeDisconnectedApp({ appId: mockedAppIdOne, instanceId: 'unknown-instance-id' });

            const appInstances = await instance.getAppInstances(mockedAppIdOne);
            expect(appInstances).toEqual([{ appId: mockedAppIdOne, instanceId: 'instanceOne' }]);
        });
    });

    async function registerApp(
        instance: AppDirectory,
        app: AppDirectoryApplication,
        intent?: Intent,
        context?: Context[],
    ): Promise<void> {
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
