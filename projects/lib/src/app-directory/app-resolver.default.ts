/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier, Context, DesktopAgent } from '@finos/fdc3';
import { OpenError, ResolveError } from '@finos/fdc3';
import {
    FullyQualifiedAppIdentifier,
    IAppResolver,
    ResolveForContextPayload,
    ResolveForContextResponse,
    ResolveForIntentPayload,
} from '../contracts.js';
import { isFullyQualifiedAppIdentifier } from '../helpers/index.js';

/**
 * If no IUIProvider is present then this class is used to resolve apps.
 * It will return the only app that matches the intent or context if only 1 match is found
 * If more than one match or no apps are found then an error is returned
 * If resolving app for context, it will also return an intent which handles given context and is resolved by selected app
 */
export class DefaultResolver implements IAppResolver {
    constructor(private readonly desktopAgentPromise: Promise<DesktopAgent>) {}

    public async resolveAppForIntent(payload: ResolveForIntentPayload): Promise<FullyQualifiedAppIdentifier> {
        const agent = await this.desktopAgentPromise;

        const appIntent = payload.appIntent ?? (await agent.findIntent(payload.intent, payload.context));

        const singleInstance = await this.findSingleMatchingApp(payload.appIdentifier, appIntent.apps);

        return this.openNewInstance(singleInstance, agent, payload.context);
    }

    public async resolveAppForContext(payload: ResolveForContextPayload): Promise<ResolveForContextResponse> {
        const agent = await this.desktopAgentPromise;

        const intents = payload.appIntents ?? (await agent.findIntentsByContext(payload.context));

        const appsLookup = intents
            .flatMap(intent => intent.apps)
            .filter(isFullyQualifiedAppIdentifier)
            // remove duplicate apps that might be registered for multiple intents
            .reduce<Record<string, FullyQualifiedAppIdentifier>>(
                (lookup, app) => ({ ...lookup, [app.instanceId]: app }),
                {},
            );

        const appIdentifier = await this.findSingleMatchingApp(payload.appIdentifier, Object.values(appsLookup));
        const appIntent = intents.find(appIntent => appIntent.apps.includes(appIdentifier));
        if (appIntent != null) {
            return this.openNewInstance(appIdentifier, agent, payload.context).then(appInstance => ({
                intent: appIntent.intent.name,
                app: appInstance,
            }));
        }
        return Promise.reject(ResolveError.NoAppsFound);
    }

    /**
     * If the app is not an app instance a new instance will be opened and returned.
     * If it is a fully qualified app it will be returned as is.
     */
    private async openNewInstance(
        app: AppIdentifier,
        agent: DesktopAgent,
        context?: Context,
    ): Promise<FullyQualifiedAppIdentifier> {
        if (isFullyQualifiedAppIdentifier(app)) {
            return app;
        } else {
            const newInstance = await agent.open(app, context);

            if (isFullyQualifiedAppIdentifier(newInstance)) {
                return newInstance;
            } else {
                //if instanceId is still null, error has occured, but this should be caught within open()
                return Promise.reject(OpenError.AppNotFound);
            }
        }
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
