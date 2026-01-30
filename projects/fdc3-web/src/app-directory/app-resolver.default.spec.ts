/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier, AppIntent, DesktopAgent } from '@finos/fdc3';
import { ResolveError } from '@finos/fdc3';
import { IMocked, Mock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    AppHostManifestLookup,
    ResolveForContextPayload,
    ResolveForContextResponse,
    ResolveForIntentPayload,
} from '../contracts.js';
import { isDefined } from '../helpers/type-predicate.helper.js';
import { DefaultResolver } from './app-resolver.default.js';

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

    function create(id: number, instanceId?: number): AppIdentifier {
        const identifier: AppIdentifier = { appId: String(id) };

        if (instanceId != null) {
            return { ...identifier, instanceId: String(instanceId) };
        }

        return identifier;
    }

    interface ResolveIntentTest {
        message: string;
        apps: AppIdentifier[];
        /**
         * index of the expected app. If undefined then we expect an error
         */
        expected?: number;
        /**
         * optional app Id to filter the available apps
         */
        filter?: number;
        /**
         * optional app id of singleton apps
         */
        singleton?: number | number[];
    }

    const scenarios: ResolveIntentTest[] = [
        { message: `return an error when no apps available`, apps: [] },
        { message: `return single app when only 1 available`, apps: [create(1)], expected: 0 },
        { message: `throw an error when multiple apps available`, apps: [create(1), create(1, 1), create(2)] },
        {
            message: `throw an error when multiple apps match the appId`,
            apps: [create(1), create(2), create(3), create(2, 1)],
            filter: 2,
        },
        {
            message: `throw an error when no apps match the appId`,
            apps: [create(1), create(2), create(3), create(2, 1)],
            filter: 6,
        },
        {
            message: `return only matching app when appId only matches one app`,
            apps: [create(1), create(2), create(3)],
            filter: 2,
            expected: 1,
        },
        {
            message: `return inactive app when app is singleton and no active apps passed`,
            apps: [create(1)],
            singleton: 1,
            expected: 0,
        },
        {
            message: `return only active app when app is singleton and active and inactive passed`,
            apps: [create(1), create(1, 1)],
            singleton: 1,
            expected: 1,
        },
        {
            message: `throw error for singleton app when multiple active instances passed`,
            apps: [create(1), create(1, 1), create(1, 2), create(1, 3)],
            singleton: 1,
        },
        {
            message: `throw an error when multiple singleton apps passed`,
            apps: [create(1), create(1, 1), create(2), create(2, 2), create(3), create(3, 3)],
            singleton: [1, 2, 3],
        },
        {
            message: `throw an error when multiple singleton apps present`,
            apps: [create(1), create(2), create(2, 2), create(3), create(4), create(4, 4)],
            singleton: [1, 2, 3],
        },
    ];

    withOrWithoutPayload.forEach(({ message, appsInPayload }) => {
        describe(`resolveAppForIntent ${message}`, () => {
            scenarios.forEach(({ message, apps, expected, filter, singleton }) => {
                it(`should ${message}`, async () => {
                    const instance = createInstance();

                    const filterApp = filter != null ? { appId: String(filter) } : undefined;
                    const singletonLookup = (Array.isArray(singleton) ? singleton : [singleton])
                        .filter(isDefined)
                        .map(String)
                        .reduce<AppHostManifestLookup>(
                            (lookup, appId) => ({ ...lookup, [appId]: { singleton: true } }),
                            {},
                        );
                    const payload = createIntentPayload(appsInPayload, apps, filterApp, singletonLookup);
                    const expectedApp = expected != null ? apps[expected] : undefined;

                    if (expectedApp != null) {
                        await expect(instance.resolveAppForIntent(payload)).resolves.toBe(expectedApp);
                    } else {
                        await expect(instance.resolveAppForIntent(payload)).rejects.toBe(ResolveError.NoAppsFound);
                    }

                    if (appsInPayload) {
                        expect(mockAgent.withFunction('findIntent')).wasNotCalled();
                    } else {
                        expect(
                            mockAgent.withFunction('findIntent').withParameters(payload.intent, payload.context),
                        ).wasCalledOnce();
                    }
                });
            });

            function createIntentPayload(
                appsInPayload: boolean,
                apps: AppIdentifier[],
                appIdentifier?: AppIdentifier,
                appManifests: AppHostManifestLookup = {},
            ): ResolveForIntentPayload {
                const payload: ResolveForIntentPayload = {
                    context: { type: 'contact' },
                    appIdentifier,
                    intent: 'StartEmail',
                    appManifests,
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

        type IntentApps = { intent: string; apps: AppIdentifier[] };

        interface ResolveContextTest extends Omit<ResolveIntentTest, 'apps' | 'expected'> {
            intents: IntentApps[];
            // the index of the intent and the app within the intent that is expected to be returned
            expected?: { app: number; intent: number };
        }

        const contextScenarios: ResolveContextTest[] = [
            ...scenarios.map(scenario => ({
                ...scenario,
                intents: [{ intent: 'SendEmail', apps: scenario.apps }],
                expected: scenario.expected != null ? { intent: 0, app: scenario.expected } : undefined,
            })),
            { message: `return an error when no intents available`, intents: [] },
            {
                message: 'return error if multiple apps across multiple intents',
                intents: [
                    { intent: 'SendEmail', apps: [create(1)] },
                    { intent: 'StartChat', apps: [create(2)] },
                ],
            },
            {
                message: 'return error when multiple apps across intents match appId',
                intents: [
                    { intent: 'SendEmail', apps: [create(1)] },
                    { intent: 'StartChat', apps: [create(1)] },
                    { intent: 'StartCall', apps: [create(2), create(1, 1)] },
                ],
                filter: 1,
            },
            {
                message: 'return matching app when only 1 matches appId',
                intents: [
                    { intent: 'SendEmail', apps: [create(1)] },
                    { intent: 'StartChat', apps: [create(1)] },
                    { intent: 'StartCall', apps: [create(2), create(1, 1)] },
                ],
                filter: 2,
                expected: { intent: 2, app: 0 },
            },
            {
                message: 'return only active app across intents when app is singleton',
                intents: [
                    { intent: 'SendEmail', apps: [create(1)] },
                    { intent: 'StartChat', apps: [create(1)] },
                    { intent: 'StartCall', apps: [create(1), create(1, 1)] },
                ],
                singleton: 1,
                expected: { intent: 2, app: 1 },
            },
        ];

        describe(`resolveAppForContext ${message}`, () => {
            contextScenarios.forEach(({ message, intents, expected, filter, singleton }) => {
                it(`should ${message}`, async () => {
                    const instance = createInstance();

                    const filterApp = filter != null ? { appId: String(filter) } : undefined;
                    const singletonLookup = (Array.isArray(singleton) ? singleton : [singleton])
                        .filter(isDefined)
                        .map(String)
                        .reduce<AppHostManifestLookup>(
                            (lookup, appId) => ({ ...lookup, [appId]: { singleton: true } }),
                            {},
                        );
                    const payload = createContextPayload(appsInPayload, intents, filterApp, singletonLookup);

                    let expectedResult: ResolveForContextResponse | undefined;

                    if (expected != null) {
                        const intent = intents[expected.intent];
                        expectedResult = { intent: intent.intent, app: intent.apps[expected.app] };
                    }

                    if (expectedResult != null) {
                        await expect(instance.resolveAppForContext(payload)).resolves.toEqual(expectedResult);
                    } else {
                        await expect(instance.resolveAppForContext(payload)).rejects.toBe(ResolveError.NoAppsFound);
                    }

                    if (appsInPayload) {
                        expect(mockAgent.withFunction('findIntentsByContext')).wasNotCalled();
                    } else {
                        expect(
                            mockAgent.withFunction('findIntentsByContext').withParameters(payload.context),
                        ).wasCalledOnce();
                    }
                });
            });

            function createContextPayload(
                appsInPayload: boolean,
                intents: IntentApps[],
                appIdentifier?: AppIdentifier,
                appManifests: AppHostManifestLookup = {},
            ): ResolveForContextPayload {
                const payload: ResolveForContextPayload = {
                    context: { type: 'contact' },
                    appIdentifier,
                    appManifests,
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
