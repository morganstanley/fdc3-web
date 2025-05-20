/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier, AppIntent, DesktopAgent, Intent } from '@finos/fdc3';
import { ResolveError } from '@finos/fdc3';
import { IMocked, Mock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResolveForContextPayload, ResolveForIntentPayload } from '../contracts.js';
import { DefaultResolver } from './app-resolver.default.js';

const mockedTargetAppId = 'target-app-id';
const mockedTargetInstanceId = 'target-instanceid';

describe(`${DefaultResolver.name} (app-resolver.default)`, () => {
    let mockAgent: IMocked<DesktopAgent>;

    beforeEach(() => {
        mockAgent = Mock.create<DesktopAgent>().setup(
            setupFunction('findIntent', () => Promise.reject('not implemented')),
            setupFunction('findIntentsByContext', () => Promise.reject('not implemented')),
        );
    });

    function createInstance(): DefaultResolver {
        return new DefaultResolver(Promise.resolve(mockAgent.mock));
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    const withOrWithoutPayload = [
        { appsInPayload: true, message: '(apps in payload)' },
        { appsInPayload: false, message: '(apps not in payload)' },
    ];

    withOrWithoutPayload.forEach(({ message, appsInPayload }) => {
        describe(`resolveAppForIntent ${message}`, () => {
            it(`should return app in payload if only 1 app present`, async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [
                    { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                ]);

                await expect(instance.resolveAppForIntent(payload)).resolves.toEqual({
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntent')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntent').withParameters(payload.intent, payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return app if only 1 app present with correct id`, async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [
                    { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    { appId: 'another-app-id', instanceId: 'another-instance-id' },
                ]);

                await expect(instance.resolveAppForIntent(payload)).resolves.toEqual({
                    appId: mockedTargetAppId,
                    instanceId: mockedTargetInstanceId,
                });

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntent')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntent').withParameters(payload.intent, payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return an error if more than one app matches`, async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [
                    { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                    { appId: mockedTargetAppId, instanceId: 'anotherInstanceId' },
                ]);

                await expect(instance.resolveAppForIntent(payload)).rejects.toBe(ResolveError.NoAppsFound);

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntent')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntent').withParameters(payload.intent, payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should not select only app if appId is defined and does not match`, async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [
                    { appId: 'otherAppId', instanceId: 'otherInstanceId' },
                ]);
                await expect(instance.resolveAppForIntent(payload)).rejects.toBe(ResolveError.NoAppsFound);

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntent')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntent').withParameters(payload.intent, payload.context),
                    ).wasCalledOnce();
                }
            });

            function createIntentPayload(appsInPayload: boolean, apps: AppIdentifier[]): ResolveForIntentPayload {
                const payload: ResolveForIntentPayload = {
                    context: { type: 'contact' },
                    appIdentifier: {
                        appId: mockedTargetAppId,
                    },
                    intent: 'StartEmail',
                };

                if (appsInPayload) {
                    payload.appIntent = {
                        intent: { name: 'StartEmail', displayName: 'StartEmail' },
                        apps,
                    };
                }

                const appIntent: AppIntent = {
                    apps,
                    intent: { name: 'StartEmail', displayName: 'StartEmail' },
                };

                mockAgent.setupFunction('findIntent', () => Promise.resolve(appIntent));

                return payload;
            }
        });

        describe(`resolveAppForContext ${message}`, () => {
            it(`should return ResolveForContextResponse containing only app in payload if only 1 app present`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    { intent: 'SendEmail', apps: [{ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }] },
                ]);

                await expect(instance.resolveAppForContext(payload)).resolves.toEqual({
                    intent: 'SendEmail',
                    app: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                });

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return ResolveForContextResponse containing only app in payload if only 1 app present and returned for multiple intents`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    { intent: 'SendEmail', apps: [{ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }] },
                    { intent: 'StartChat', apps: [{ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }] },
                ]);

                await expect(instance.resolveAppForContext(payload)).resolves.toEqual({
                    intent: 'StartChat',
                    app: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                });

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return ResolveForContextResponse containing app if only 1 app present with correct id`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    {
                        intent: 'SendEmail',
                        apps: [
                            { appId: 'another-one-id', instanceId: 'another-one-instance-id' },
                            { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                        ],
                    },
                    { intent: 'SendEmail', apps: [{ appId: 'another-two-id', instanceId: 'another-two-instance-id' }] },
                ]);

                await expect(instance.resolveAppForContext(payload)).resolves.toEqual({
                    intent: 'SendEmail',
                    app: { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                });

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return an error if more than one app across intents matches`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    { intent: 'SendEmail', apps: [{ appId: mockedTargetAppId, instanceId: mockedTargetInstanceId }] },
                    { intent: 'StartChat', apps: [{ appId: mockedTargetAppId, instanceId: 'another-instance-id' }] },
                ]);

                await expect(instance.resolveAppForContext(payload)).rejects.toBe(ResolveError.NoAppsFound);

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should return an error if more than one app within an intent matches`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    {
                        intent: 'SendEmail',
                        apps: [
                            { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId },
                            { appId: mockedTargetAppId, instanceId: 'another-instance-id' },
                        ],
                    },
                ]);

                await expect(instance.resolveAppForContext(payload)).rejects.toBe(ResolveError.NoAppsFound);

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            it(`should not select only app if appId is defined and does not match`, async () => {
                const instance = createInstance();

                const payload = createContextPayload(appsInPayload, [
                    { intent: 'SendEmail', apps: [{ appId: 'otherAppId', instanceId: 'otherInstanceId' }] },
                ]);

                await expect(instance.resolveAppForContext(payload)).rejects.toBe(ResolveError.NoAppsFound);

                if (appsInPayload) {
                    expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                } else {
                    expect(
                        mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                    ).wasCalledOnce();
                }
            });

            function createContextPayload(
                appsInPayload: boolean,
                intents: { intent: Intent; apps: AppIdentifier[] }[],
            ): ResolveForContextPayload {
                const payload: ResolveForContextPayload = {
                    context: { type: 'contact' },
                    appIdentifier: {
                        appId: mockedTargetAppId,
                    },
                };

                const appIntents: AppIntent[] = intents.map(intentAndApps => ({
                    apps: intentAndApps.apps,
                    intent: { name: intentAndApps.intent, displayName: intentAndApps.intent },
                }));

                if (appsInPayload) {
                    payload.appIntents = appIntents;
                }

                mockAgent.setupFunction('findIntentsByContext', () => Promise.resolve(appIntents));

                return payload;
            }
        });
    });
});
