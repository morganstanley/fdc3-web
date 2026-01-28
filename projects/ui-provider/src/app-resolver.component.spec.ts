/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AppIdentifier, AppIntent, Context, DesktopAgent, IntentMetadata, ResolveError } from '@finos/fdc3';
import { IMocked, Mock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppResolverComponent } from './app-resolver.component.js';

const mockedTargetAppId = `mocked-target-app-id`;
const mockedTargetInstanceId = `mocked-target-instance-id`;

describe(`${AppResolverComponent.name} (app-resolver.component)`, () => {
    let mockDesktopAgent: IMocked<DesktopAgent>;
    let mockDocument: Document;

    let intent: IntentMetadata;
    let intentTwo: IntentMetadata;
    let appIdentifier: AppIdentifier;
    let context: Context;
    let appIntent: AppIntent;
    let appIntentTwo: AppIntent;

    beforeEach(() => {
        mockDocument = document;

        intent = { name: 'StartChat', displayName: 'StartChat' };
        intentTwo = { name: 'StartCall', displayName: 'StartCall' };
        appIdentifier = { appId: mockedTargetAppId, instanceId: mockedTargetInstanceId };
        appIntent = {
            intent: intent,
            apps: [
                {
                    appId: 'app-one',
                },
                {
                    appId: 'app-one',
                    instanceId: 'app-one-instance-one',
                },
                {
                    appId: 'app-one',
                    instanceId: 'app-one-instance-two',
                },
                {
                    appId: 'app-two',
                    instanceId: 'app-two-instance-one',
                },
                { appId: 'app-six' },
            ],
        };
        appIntentTwo = {
            intent: intentTwo,
            apps: [
                {
                    appId: 'app-one',
                },
                {
                    appId: 'app-one',
                    instanceId: 'app-one-instance-one',
                },
                {
                    appId: 'app-two',
                    instanceId: 'app-two-instance-two',
                },
                {
                    appId: 'app-three',
                    instanceId: 'app-three-instance-one',
                },
                {
                    appId: 'app-three',
                    instanceId: 'app-three-instance-two',
                },
            ],
        };

        mockDesktopAgent = Mock.create<DesktopAgent>().setup(
            setupFunction('findIntent', (_intent, _context) => Promise.resolve(appIntent)),
            setupFunction('findIntentsByContext', _context => Promise.resolve([appIntent, appIntentTwo])),
            setupFunction('open', (_name, _context) => Promise.resolve(appIdentifier)),
        );
        context = {
            type: 'fdc3.contact',
            name: 'Joe Bloggs',
            id: {
                username: 'jo_bloggs',
                phone: '079712345678',
            },
        };
        mockDocument.querySelector('ms-app-resolver')?.remove();
    });

    function createInstance(): AppResolverComponent {
        return new AppResolverComponent(Promise.resolve(mockDesktopAgent.mock), mockDocument);
    }

    describe('resolveAppForIntent', () => {
        it('should immediately return a fully qualified app if it is the only one with the correct id', async () => {
            const instance = createInstance();

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                appIdentifier: { appId: 'app-two' },
                context,
                appManifests: {},
            });

            await expect(appIdentifierPromise).resolves.toEqual({
                appId: 'app-two',
                instanceId: 'app-two-instance-one',
            });
        });

        it('should return AppIdentifier without instanceId if there is only 1 matching app without instance (caller is responsible for opening)', async () => {
            const instance = createInstance();

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                appIdentifier: { appId: 'app-six' },
                context,
                appManifests: {},
            });

            await expect(appIdentifierPromise).resolves.toEqual({
                appId: 'app-six',
            });
            expect(mockDesktopAgent.withFunction('open')).wasNotCalled();
        });

        it('should throw an error if there are no matching apps', async () => {
            const instance = createInstance();

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                appIdentifier: { appId: 'unknown-app-id' },
                context,
                appManifests: {},
            });

            await expect(appIdentifierPromise).rejects.toEqual(ResolveError.NoAppsFound);
        });

        it('should add popup html to body with active instances and inactive apps that can handle given intent', () => {
            const instance = createInstance();

            instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

            expect(mockDocument.querySelector('body')?.querySelector('ms-app-resolver')).toBeDefined();
        });

        it('should filter out apps which do not have an appId that matches that of the appIdentifier passed in the ResolveForIntentPayload', async () => {
            const instance = createInstance();

            instance.resolveAppForIntent({
                intent: intent.name,
                appIdentifier: { appId: 'app-one' },
                context,
                appManifests: {},
            });

            await wait();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-app-resolver')
                    ?.shadowRoot?.querySelectorAll('.ms-app-resolver-app-display-btn').length,
            ).toEqual(3);
        });

        it('should filter out singleton apps from inactiveApps when they have an active instance', async () => {
            const instance = createInstance();

            instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {
                    'app-one': { singleton: true },
                },
            });

            await wait();

            expect(instance.forIntentPopupState?.activeInstances.map(app => app.appId)).toEqual([
                'app-one',
                'app-one',
                'app-two',
            ]);
            expect(instance.forIntentPopupState?.inactiveApps.map(app => app.appId)).toEqual(['app-six']);
        });

        it('should include singleton apps in inactiveApps when they do not have an active instance', async () => {
            const instance = createInstance();

            instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {
                    'app-six': { singleton: true },
                },
            });

            await wait();

            expect(instance.forIntentPopupState?.activeInstances.map(app => app.appId)).toEqual([
                'app-one',
                'app-one',
                'app-two',
            ]);
            expect(instance.forIntentPopupState?.inactiveApps.map(app => app.appId)).toEqual(['app-one', 'app-six']);
        });

        it('should not filter out non-singleton apps from inactiveApps', async () => {
            const instance = createInstance();

            instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

            await wait();

            expect(instance.forIntentPopupState?.activeInstances.map(app => app.appId)).toEqual([
                'app-one',
                'app-one',
                'app-two',
            ]);
            expect(instance.forIntentPopupState?.inactiveApps.map(app => app.appId)).toEqual(['app-one', 'app-six']);
        });

        it('should return AppIdentifier without instanceId when user selects an inactive app (caller is responsible for opening)', async () => {
            const instance = createInstance();

            const promise = instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

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

            await expect(promise).resolves.toEqual({ appId: 'app-one' });
            expect(mockDesktopAgent.withFunction('open')).wasNotCalled();
        });

        it('should return promise which resolves to FullyQualifiedAppIdentifier chosen by user', async () => {
            const instance = createInstance();

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

            await wait();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-app-resolver')
                    ?.shadowRoot?.querySelectorAll(
                        '.ms-app-resolver-popup-active-instances .ms-app-resolver-app-display-btn',
                    )[1],
            ).toBeDefined();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-app-resolver')
                    ?.shadowRoot?.querySelectorAll(
                        '.ms-app-resolver-popup-active-instances .ms-app-resolver-app-display-btn',
                    )[1] as HTMLElement
            ).click();

            await expect(appIdentifierPromise).resolves.toEqual({
                appId: 'app-one',
                instanceId: 'app-one-instance-two',
            });
        });

        it('should return promise which rejects with ResolveError.UserCancelled if user clicks close button', async () => {
            const instance = createInstance();

            const appIntentPromise = instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

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
    });

    describe('resolveAppForContext', () => {
        it('should add popup html to body with active instances and inactive apps that can handle given intent for all intents which can resolve given context', () => {
            const instance = createInstance();

            instance.resolveAppForContext({ context, appManifests: {} });

            expect(mockDocument.querySelector('body')?.querySelector('ms-app-resolver')).toBeDefined();
        });

        it('should filter out apps which do not have an appId that matches that of the appIdentifier passed in the ResolveForContextPayload', async () => {
            const instance = createInstance();

            instance.resolveAppForContext({
                appIdentifier: { appId: 'app-one' },
                context,
                appManifests: {},
            });

            await wait();

            expect(instance.forContextPopupState?.[intent.name].activeInstances.length).toEqual(2);
            expect(instance.forContextPopupState?.[intent.name].inactiveApps.length).toEqual(1);

            expect(instance.forContextPopupState?.[intentTwo.name].activeInstances.length).toEqual(1);
            expect(instance.forContextPopupState?.[intentTwo.name].inactiveApps.length).toEqual(1);
        });

        it('should not filter out apps when no app identifier passed in the ResolveForContextPayload', async () => {
            const instance = createInstance();

            instance.resolveAppForContext({
                context,
                appManifests: {},
            });

            await wait();

            expect(instance.forContextPopupState?.[intent.name].activeInstances.length).toEqual(3);
            expect(instance.forContextPopupState?.[intent.name].inactiveApps.length).toEqual(2);

            expect(instance.forContextPopupState?.[intentTwo.name].activeInstances.length).toEqual(4);
            expect(instance.forContextPopupState?.[intentTwo.name].inactiveApps.length).toEqual(1);
        });

        it(`should filter out intents with no apps`, async () => {
            const instance = createInstance();

            instance.resolveAppForContext({
                appIdentifier: { appId: 'app-three' },
                context,
                appManifests: {},
            });

            await wait();

            expect(instance.forContextPopupState?.[intent.name]).toBeUndefined();

            expect(instance.forContextPopupState?.[intentTwo.name].activeInstances.length).toEqual(2);
            expect(instance.forContextPopupState?.[intentTwo.name].inactiveApps.length).toEqual(0);
        });

        it(`should return an error if no apps found when filtered by app identifier`, async () => {
            const instance = createInstance();

            await expect(
                instance.resolveAppForContext({
                    appIdentifier: { appId: 'app-five' },
                    context,
                    appManifests: {},
                }),
            ).rejects.toBe(ResolveError.NoAppsFound);

            expect(instance.forContextPopupState?.[intent.name]).toBeUndefined();
            expect(instance.forContextPopupState?.[intentTwo.name]).toBeUndefined();
        });

        it(`should return error when no apps found for given intent`, async () => {
            mockDesktopAgent.setupFunction('findIntentsByContext', () => Promise.resolve([]));
            const instance = createInstance();

            await expect(
                instance.resolveAppForContext({ context: { type: 'unknown.context' }, appManifests: {} }),
            ).rejects.toBe(ResolveError.NoAppsFound);

            expect(instance.forContextPopupState?.[intent.name]).toBeUndefined();
            expect(instance.forContextPopupState?.[intentTwo.name]).toBeUndefined();
        });

        it('should filter out singleton apps from inactiveApps when they have an active instance', async () => {
            const instance = createInstance();

            instance.resolveAppForContext({
                context,
                appManifests: {
                    'app-one': { singleton: true },
                },
            });

            await wait();

            expect(instance.forContextPopupState?.[intent.name].activeInstances.map(app => app.appId)).toEqual([
                'app-one',
                'app-one',
                'app-two',
            ]);
            expect(instance.forContextPopupState?.[intent.name].inactiveApps.map(app => app.appId)).toEqual([
                'app-six',
            ]);
        });

        it('should include singleton apps in inactiveApps when they do not have an active instance', async () => {
            const instance = createInstance();

            instance.resolveAppForContext({
                context,
                appManifests: {
                    'app-six': { singleton: true },
                },
            });

            await wait();

            expect(instance.forContextPopupState?.[intent.name].activeInstances.map(app => app.appId)).toEqual([
                'app-one',
                'app-one',
                'app-two',
            ]);
            expect(instance.forContextPopupState?.[intent.name].inactiveApps.map(app => app.appId)).toEqual([
                'app-one',
                'app-six',
            ]);
        });

        it('should return AppIdentifier without instanceId when user selects an inactive app (caller is responsible for opening)', async () => {
            const instance = createInstance();

            const promise = instance.resolveAppForContext({ context, appManifests: {} });

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

            await expect(promise).resolves.toEqual({ intent: intent.name, app: { appId: 'app-one' } });
            expect(mockDesktopAgent.withFunction('open')).wasNotCalled();
        });

        it('should return promise which resolves to ResolveForContextResponse containing AppIdentifier and intent chosen by user', async () => {
            const instance = createInstance();

            const appIntentPromise = instance.resolveAppForContext({ context, appManifests: {} });

            await wait();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-app-resolver')
                    ?.shadowRoot?.querySelectorAll(
                        '.ms-app-resolver-popup-active-instances .ms-app-resolver-app-display-btn',
                    )[1],
            ).toBeDefined();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-app-resolver')
                    ?.shadowRoot?.querySelectorAll(
                        '.ms-app-resolver-popup-active-instances .ms-app-resolver-app-display-btn',
                    )[1] as HTMLElement
            ).click();

            await expect(appIntentPromise).resolves.toEqual({
                intent: intent.name,
                app: { appId: 'app-one', instanceId: 'app-one-instance-two' },
            });
        });

        it('should return promise which rejects with ResolveError.UserCancelled if user clicks close button', async () => {
            const instance = createInstance();

            const appIntentPromise = instance.resolveAppForContext({
                context,
                appManifests: {},
            });

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
    });

    describe('selectApp', () => {
        it('should pass given app and intent to selectedAppCallback', async () => {
            const instance = createInstance();

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

            await wait();

            await instance.selectApp(appIdentifier, intent.name);

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

            const appIdentifierPromise = instance.resolveAppForIntent({
                intent: intent.name,
                context,
                appManifests: {},
            });

            await wait();

            instance.closePopup();

            await expect(appIdentifierPromise).rejects.toEqual(ResolveError.UserCancelled);
        });
    });

    async function wait(delay: number = 50): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
});
