/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AppIdentifier, AppIntent, DesktopAgent, ResolveError } from '@finos/fdc3';
import {
    AppHostManifestLookup,
    isDefined,
    ResolveForContextPayload,
    ResolveForIntentPayload,
} from '@morgan-stanley/fdc3-web';
import { IMocked, Mock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppResolverComponent } from './app-resolver.component.js';

const mockedTargetAppId = `mocked-target-app-id`;
const mockedTargetInstanceId = `mocked-target-instance-id`;

describe(`${AppResolverComponent.name} (app-resolver.component)`, () => {
    let mockAgent: IMocked<DesktopAgent>;
    let mockDocument: Document;

    let appIdentifier: AppIdentifier;

    beforeEach(() => {
        mockDocument = document;

        appIdentifier = { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId };

        mockAgent = Mock.create<DesktopAgent>().setup(
            setupFunction('open', (_name, _context) => Promise.resolve(appIdentifier)),
        );
        mockDocument.querySelector('ms-app-resolver')?.remove();
    });

    function createInstance(): AppResolverComponent {
        return new AppResolverComponent(Promise.resolve(mockAgent.mock), mockDocument);
    }

    const withOrWithoutPayload = [
        { appsInPayload: true, message: '(apps in payload)' },
        { appsInPayload: false, message: '(apps not in payload)' },
    ];

    /**
     * Creates an app identifier with our without an instanceId
     */
    function create(id: number, instanceId?: number): AppIdentifier {
        const identifier: AppIdentifier = { appId: String(id) };

        if (instanceId != null) {
            return { ...identifier, instanceId: String(instanceId) };
        }

        return identifier;
    }

    type ExpectedIndexes = { active: number[]; inactive: number[] };
    type ExpectedApps = { activeInstances: AppIdentifier[]; inactiveApps: AppIdentifier[] };

    interface ResolveIntentTest {
        message: string;
        apps: AppIdentifier[];
        /**
         * index of the expected app. If undefined then we expect an error
         * if an array is defined we expect multiple apps to be displayed in popup
         * if single number that app should be returned immediately
         */
        expected?: number | ExpectedIndexes;
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
        {
            message: `display multiple apps available`,
            apps: [create(1), create(1, 1), create(2)],
            expected: { active: [1], inactive: [0, 2] },
        },
        {
            message: `display filtered apps when multiple apps match the appId`,
            apps: [create(1), create(2), create(3), create(2, 1)],
            filter: 2,
            expected: { active: [3], inactive: [1] },
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
            message: `display only active instances for singleton app when multiple active instances passed`,
            apps: [create(1), create(1, 1), create(1, 2), create(1, 3)],
            singleton: 1,
            expected: { active: [1, 2, 3], inactive: [] },
        },
        {
            message: `throw an error when multiple singleton apps passed`,
            apps: [create(1), create(1, 1), create(2), create(2, 2), create(3), create(3, 3)],
            singleton: [1, 2, 3],
            expected: { active: [1, 3, 5], inactive: [] },
        },
        {
            message: `display active and inactive singleton apps`,
            apps: [create(1), create(2), create(2, 2), create(3), create(4), create(4, 4)],
            singleton: [1, 2, 3],
            expected: { active: [2, 5], inactive: [0, 3, 4] },
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

                    let expectedApps: number | ExpectedApps | undefined;

                    if (expected != null) {
                        expectedApps =
                            typeof expected === 'number'
                                ? expected
                                : {
                                      activeInstances: expected.active.map(appIndex => apps[appIndex]),
                                      inactiveApps: expected.inactive.map(appIndex => apps[appIndex]),
                                  };
                    }

                    if (expectedApps != null) {
                        if (typeof expectedApps === 'object') {
                            // expecting multiple apps to be displayed in popup
                            instance.resolveAppForIntent(payload);

                            await wait();

                            expect(instance.forIntentPopupState).toEqual({ name: 'StartEmail', ...expectedApps });
                            expect(mockDocument.querySelector('body')?.querySelector('ms-app-resolver')).toBeDefined();
                        } else {
                            // expecting a single app to be returned immediately
                            await expect(instance.resolveAppForIntent(payload)).resolves.toBe(apps[expectedApps]);
                        }
                    } else {
                        // expecting error to be thrown as no suitable apps found
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

            it('should return AppIdentifier without instanceId when user selects an inactive app (caller is responsible for opening)', async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [create(1), create(2)]);
                const promise = instance.resolveAppForIntent(payload);

                await wait();

                expect(
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector(
                            '.ms-app-resolver-popup-open-new-instances .ms-app-resolver-app-display-btn',
                        ),
                ).toBeDefined();

                (
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector(
                            '.ms-app-resolver-popup-open-new-instances .ms-app-resolver-app-display-btn',
                        ) as HTMLElement
                ).click();

                await expect(promise).resolves.toEqual({ appId: '1' });
            });

            it('should return promise which rejects with ResolveError.UserCancelled if user clicks close button', async () => {
                const instance = createInstance();

                const payload = createIntentPayload(appsInPayload, [create(1), create(2)]);
                const promise = instance.resolveAppForIntent(payload);

                await wait();

                expect(
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector('.ms-app-resolver-popup-dismiss-btn'),
                ).toBeDefined();

                (
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector('.ms-app-resolver-popup-dismiss-btn') as HTMLElement
                ).click();

                await expect(promise).rejects.toEqual(ResolveError.UserCancelled);
            });
        });

        type IntentApps = { intent: string; apps: AppIdentifier[] };

        type ContextTestExpected =
            | undefined
            | { app: number; intent: number }
            | { intent: number; apps: ExpectedIndexes }[];

        interface ResolveContextTest extends Omit<ResolveIntentTest, 'apps' | 'expected'> {
            intents: IntentApps[];
            // the index of the intent and the app within the intent that is expected to be returned
            expected?: ContextTestExpected;
        }

        const contextScenarios: ResolveContextTest[] = [
            ...scenarios.map(scenario => {
                let expected: ContextTestExpected;

                if (scenario.expected != null) {
                    switch (typeof scenario.expected) {
                        case 'number':
                            expected = { intent: 0, app: scenario.expected };
                            break;

                        case 'object':
                            expected = [{ intent: 0, apps: scenario.expected }];
                    }
                }

                return {
                    ...scenario,
                    intents: [{ intent: 'SendEmail', apps: scenario.apps }],
                    expected,
                };
            }),
            { message: `return an error when no intents available`, intents: [] },
            {
                message: 'display multiple apps across multiple intents',
                intents: [
                    { intent: 'SendEmail', apps: [create(1), create(1, 1)] },
                    { intent: 'StartChat', apps: [create(2)] },
                ],
                expected: [
                    { intent: 0, apps: { active: [1], inactive: [0] } },
                    { intent: 1, apps: { active: [], inactive: [0] } },
                ],
            },
            {
                message: 'display multiple apps across intents that match appId',
                intents: [
                    { intent: 'SendEmail', apps: [create(1)] },
                    { intent: 'StartChat', apps: [create(1)] },
                    { intent: 'StartCall', apps: [create(2), create(1, 1)] },
                    { intent: 'ViewChart', apps: [create(3), create(3, 3)] },
                ],
                filter: 1,
                expected: [
                    { intent: 0, apps: { active: [], inactive: [0] } },
                    { intent: 1, apps: { active: [], inactive: [0] } },
                    { intent: 2, apps: { active: [1], inactive: [] } },
                ],
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
            contextScenarios.forEach(({ message, intents, expected, filter, singleton }, index) => {
                it(`SCENARIO ${index} should ${message}`, async () => {
                    const instance = createInstance();

                    // pick the actual app to pass as a filter based on the index passed in the test config
                    const filterApp = filter != null ? { appId: String(filter) } : undefined;
                    // construct hostManifestLookup from indexes passed in the test config
                    const singletonLookup = (Array.isArray(singleton) ? singleton : [singleton])
                        .filter(isDefined)
                        .map(String)
                        .reduce<AppHostManifestLookup>(
                            (lookup, appId) => ({ ...lookup, [appId]: { singleton: true } }),
                            {},
                        );
                    const payload = createContextPayload(appsInPayload, intents, filterApp, singletonLookup);

                    let expectedApps:
                        | { app: number; intent: number }
                        | { intent: string; apps: ExpectedApps }[]
                        | undefined;

                    if (expected != null) {
                        // map intent and app indexed to actual intents / appIdentifiers from app list
                        expectedApps = Array.isArray(expected)
                            ? expected.map(expectedIntent => ({
                                  intent: intents[expectedIntent.intent].intent,
                                  apps: {
                                      activeInstances: expectedIntent.apps.active.map(
                                          appIndex => intents[expectedIntent.intent].apps[appIndex],
                                      ),
                                      inactiveApps: expectedIntent.apps.inactive.map(
                                          appIndex => intents[expectedIntent.intent].apps[appIndex],
                                      ),
                                  },
                              }))
                            : expected;
                    }

                    if (expectedApps != null) {
                        if (Array.isArray(expectedApps)) {
                            // expecting multiple apps to be displayed in popup
                            instance.resolveAppForContext(payload);

                            await wait();

                            const intentLookup = expectedApps.reduce<Record<string, ExpectedApps>>(
                                (lookup, { intent, apps }) => ({ ...lookup, [intent]: apps }),
                                {},
                            );

                            expect(instance.forContextPopupState).toEqual(intentLookup);
                            expect(mockDocument.querySelector('body')?.querySelector('ms-app-resolver')).toBeDefined();
                        } else {
                            // expecting a single app to be returned immediately
                            await expect(instance.resolveAppForContext(payload)).resolves.toEqual({
                                intent: intents[expectedApps.intent].intent,
                                app: intents[expectedApps.intent].apps[expectedApps.app],
                            });
                        }
                    } else {
                        // expecting error to be thrown as no suitable apps found
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

            it('should return promise which rejects with ResolveError.UserCancelled if user clicks close button', async () => {
                const instance = createInstance();

                const payload = createContextPayload(true, [{ intent: 'StartCall', apps: [create(1), create(2)] }]);
                const appIntentPromise = instance.resolveAppForContext(payload);

                await wait();

                expect(
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector('.ms-app-resolver-popup-dismiss-btn'),
                ).toBeDefined();

                (
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-app-resolver')
                        ?.shadowRoot?.querySelector('.ms-app-resolver-popup-dismiss-btn') as HTMLElement
                ).click();

                await expect(appIntentPromise).rejects.toEqual(ResolveError.UserCancelled);
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

    describe('selectApp', () => {
        it('should pass given app and intent to selectedAppCallback', async () => {
            const instance = createInstance();

            const payload = createIntentPayload(true, [appIdentifier]);
            const appIdentifierPromise = instance.resolveAppForIntent(payload);

            await wait();

            await instance.selectApp(appIdentifier, 'StartCall');

            await expect(appIdentifierPromise).resolves.toEqual(appIdentifier);
        });
    });

    describe('closePopup', () => {
        it('should remove popup html from body', () => {
            const instance = createInstance();

            instance.closePopup();

            expect(mockDocument.querySelector('body')?.querySelector('ms-app-resolver')).toBeNull();
        });

        it('should pass empty appIdentifier and intent to selectedAppCallback', async () => {
            const instance = createInstance();

            const payload = createIntentPayload(true, [create(1), create(2)]);
            const appIdentifierPromise = instance.resolveAppForIntent(payload);

            await wait();

            instance.closePopup();

            await expect(appIdentifierPromise).rejects.toEqual(ResolveError.UserCancelled);
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

    async function wait(delay: number = 50): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
});
