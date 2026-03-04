/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier, AppMetadata, DesktopAgent } from '@finos/fdc3';
import { ResolveError } from '@finos/fdc3';
import {
    IAppResolver,
    ResolveForContextPayload,
    ResolveForContextResponse,
    ResolveForIntentPayload,
} from '../contracts.js';
import { filterActiveApps, filterInactiveApps } from '../helpers/index.js';

/**
 * If no IUIProvider is present then this class is used to resolve apps.
 * It will return the only app that matches the intent or context if only 1 match is found
 * If more than one match or no apps are found then an error is returned
 * If resolving app for context, it will also return an intent which handles given context and is resolved by selected app
 *
 * Note: This resolver only selects apps - it does not open new instances.
 * The caller (AppDirectory) is responsible for opening new instances when
 * an AppIdentifier without instanceId is returned.
 */
export class DefaultResolver implements IAppResolver {
    constructor(private readonly desktopAgentPromise: Promise<DesktopAgent>) {}

    public async resolveAppForIntent(payload: ResolveForIntentPayload): Promise<AppIdentifier> {
        const agent = await this.desktopAgentPromise;

        const appIntent = payload.appIntent ?? (await agent.findIntent(payload.intent, payload.context));

        const activeApps = appIntent.apps.filter(filterActiveApps);
        const inactiveApps = appIntent.apps.filter(app => filterInactiveApps(app, activeApps, payload.appManifests));

        return this.findSingleMatchingApp(payload.appIdentifier, [...activeApps, ...inactiveApps]);
    }

    public async resolveAppForContext(payload: ResolveForContextPayload): Promise<ResolveForContextResponse> {
        const agent = await this.desktopAgentPromise;

        const appIntents = payload.appIntents ?? (await agent.findIntentsByContext(payload.context));

        // keep a track of all active apps so we can determine if we are able to open a new instance of an app marked as a singleton
        const globalActiveInstances = appIntents.flatMap(intent => intent.apps).filter(filterActiveApps);

        const intentLookup =
            //collects all apps and app instances that can handle each intent
            appIntents
                //filters out intents which cannot be handled by given AppIdentifier if one is provided
                .map(appIntent => {
                    const apps =
                        payload.appIdentifier != null
                            ? appIntent.apps.filter(app => app.appId === payload.appIdentifier?.appId)
                            : appIntent.apps;

                    return { ...appIntent, apps };
                })
                .filter(appIntent => appIntent.apps.length > 0)
                .reduce<Record<string, { activeInstances: AppMetadata[]; inactiveApps: AppMetadata[] }>>(
                    (lookup, appIntent) => {
                        //active app instances that can handle given intent
                        const activeInstances = appIntent.apps.filter(filterActiveApps);
                        //apps that can handle given intent (excluding singletons which already have an active instance)
                        const inactiveApps = appIntent.apps.filter(app =>
                            filterInactiveApps(app, globalActiveInstances, payload.appManifests),
                        );

                        return { ...lookup, [appIntent.intent.name]: { activeInstances, inactiveApps } };
                    },
                    {},
                );

        const appCandidates = Object.entries(intentLookup).flatMap(([intent, apps]) =>
            [...apps.activeInstances, ...apps.inactiveApps].map(app => ({ intent, app })),
        );

        if (appCandidates.length === 1) {
            return {
                intent: appCandidates[0].intent,
                app: { appId: appCandidates[0].app.appId, instanceId: appCandidates[0].app.instanceId },
            };
        }

        return Promise.reject(ResolveError.NoAppsFound);
    }

    private async findSingleMatchingApp(
        identifier: AppIdentifier | undefined,
        apps: AppIdentifier[],
    ): Promise<AppIdentifier> {
        const matchingApps = apps.filter(knownApp => identifier?.appId == null || knownApp.appId === identifier.appId);

        if (matchingApps.length === 1 && matchingApps[0] != null) {
            return matchingApps[0];
        }

        return Promise.reject(ResolveError.NoAppsFound);
    }
}
