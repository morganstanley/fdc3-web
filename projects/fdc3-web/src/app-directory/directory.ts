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
    type AppIdentifier,
    type AppIntent,
    type AppMetadata,
    type Context,
    type Intent,
    LogLevel,
    OpenError,
    ResolveError,
} from '@finos/fdc3';
import { AppDirectoryApplication, LocalAppDirectory, MS_HOST_MANIFEST_KEY } from '../app-directory.contracts.js';
import {
    AppHostManifestLookup,
    BackoffRetryParams,
    FullyQualifiedAppId,
    FullyQualifiedAppIdentifier,
    IAppResolver,
    ResolveForContextResponse,
} from '../contracts.js';
import {
    createLogger,
    generateUUID,
    getAppDirectoryApplications,
    isDefined,
    isFullyQualifiedAppId,
    isFullyQualifiedAppIdentifier,
    isIMSHostManifest,
    isWebAppDetails,
    mapApplicationToMetadata,
    mapLocalAppDirectory,
    mapUrlToFullyQualifiedAppId,
    resolveAppIdentifier,
    toUnqualifiedAppId,
    urlContainsAllElements,
} from '../helpers/index.js';

type IntentContextLookup = { intent: Intent; context: Context[] };
type DirectoryEntry = { application?: AppDirectoryApplication; instances: string[] };

export class AppDirectory {
    private log = createLogger(AppDirectory, 'proxy');

    private readonly directory: Partial<Record<FullyQualifiedAppId, DirectoryEntry>> = {}; //indexed by appId
    private readonly instanceLookup: Partial<Record<string, Set<IntentContextLookup>>> = {}; //indexed by instanceId

    private readonly appDirectoryEntries: (string | LocalAppDirectory)[];
    public readonly loadDirectoryPromise: Promise<void>;

    constructor(
        rootAppId: string,
        private readonly appResolverPromise: Promise<IAppResolver>,
        appDirectoryEntries?: (string | LocalAppDirectory)[],
        backoffRetry?: BackoffRetryParams,
    ) {
        this._rootAppIdentifier = this.registerRootApp(rootAppId);

        //assumes app directory is not modified while root desktop agent is active
        this.appDirectoryEntries = appDirectoryEntries ?? [];
        this.loadDirectoryPromise = this.loadAllAppDirectories(this.appDirectoryEntries, backoffRetry);
    }

    private _rootAppIdentifier: FullyQualifiedAppIdentifier;

    public get applications(): AppDirectoryApplication[] {
        return Object.values(this.directory)
            .map(entry => entry?.application)
            .filter(isDefined);
    }

    public get rootAppIdentifier(): FullyQualifiedAppIdentifier {
        return this._rootAppIdentifier;
    }

    private registerRootApp(rootAppId: string): FullyQualifiedAppIdentifier {
        const appId: FullyQualifiedAppId = isFullyQualifiedAppId(rootAppId)
            ? rootAppId
            : `${rootAppId}@${window.location.hostname}`;

        const rootAppIdentifier = { appId, instanceId: generateUUID() };

        this.directory[appId] = { instances: [rootAppIdentifier.instanceId] };
        this.instanceLookup[rootAppIdentifier.instanceId] = new Set();

        return rootAppIdentifier;
    }

    /**
     * Returns an AppIdentifier for the app to handle the intent.
     * If the passed in app is fully qualified that is returned.
     * Otherwise the resolver determines which app to use (usually by launching a UI element).
     * The returned AppIdentifier may or may not have an instanceId - the caller is responsible
     * for opening a new instance if needed.
     */
    public async resolveAppForIntent(
        intent: Intent,
        context: Context,
        app?: AppIdentifier | string,
    ): Promise<AppIdentifier | undefined> {
        const appIdentifier = this.getValidatedAppIdentifier(app);

        if (isFullyQualifiedAppIdentifier(appIdentifier)) {
            return appIdentifier;
        }

        if (typeof appIdentifier === 'string') {
            return Promise.reject(appIdentifier);
        }

        const appIntent = await this.getAppIntent(intent, context);

        return (await this.appResolverPromise).resolveAppForIntent({
            intent,
            appIdentifier: appIdentifier == null ? undefined : { appId: appIdentifier.appId },
            context,
            appIntent,
            appManifests: this.buildAppHostManifestLookup(),
        });
    }

    /**
     * Returns chosen intent and an AppIdentifier for the app to handle the context.
     * The resolver determines which intent and app to use (usually by launching a UI element).
     * The returned AppIdentifier may or may not have an instanceId - the caller is responsible
     * for opening a new instance if needed.
     */
    public async resolveAppForContext(
        context: Context,
        app?: AppIdentifier | string,
    ): Promise<ResolveForContextResponse | undefined> {
        const appIdentifier = this.getValidatedAppIdentifier(app);

        if (typeof appIdentifier === 'string') {
            return Promise.reject(appIdentifier);
        }

        const appIntents = await this.getAppIntentsForContext(context);

        return (await this.appResolverPromise).resolveAppForContext({
            context,
            appIdentifier: appIdentifier == null ? undefined : { appId: appIdentifier.appId },
            appIntents,
            appManifests: this.buildAppHostManifestLookup(),
        });
    }

    /**
     * When agent.registerIntentListener is called this function is called to add the app to the app directory
     */
    public async registerIntentListener(
        app: FullyQualifiedAppIdentifier,
        intent: Intent,
        context: Context[],
    ): Promise<void> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        const validatedAppIdentifier = this.getValidatedAppIdentifier(app);

        if (typeof validatedAppIdentifier === 'string') {
            return Promise.reject(validatedAppIdentifier);
        }

        if (!this.directory[validatedAppIdentifier.appId]?.instances.includes(app.instanceId)) {
            return Promise.reject(ResolveError.TargetAppUnavailable);
        }

        this.addNewIntentContextLookup(app.instanceId, { intent, context });
    }

    /**
     * Adds app instance to root desktop agent's app directory
     * @param app is FullyQualifiedAppIdentifier of app instance being added
     * @throws error if app is not known to desktop agent but at least one app directory is currently loaded
     */
    public async registerNewInstance(
        identityUrl: string,
    ): Promise<{ identifier: FullyQualifiedAppIdentifier; application: AppDirectoryApplication }> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        this.log('Registering new instance', LogLevel.DEBUG, identityUrl);
        const application = await this.resolveAppIdentity(identityUrl);

        const identifier = application != null ? { appId: application.appId, instanceId: generateUUID() } : undefined;
        const appId = identifier?.appId;

        if (identifier == null || !isFullyQualifiedAppId(appId) || application == null) {
            //app is not known to desktop agent and at least one app directory is currently loaded
            return Promise.reject(OpenError.AppNotFound);
        }

        const appEntry = this.directory[appId] ?? (this.directory[appId] = { instances: [] });

        appEntry.instances.push(identifier.instanceId);

        //copy across intents app listens for
        this.instanceLookup[identifier.instanceId] = new Set(
            Object.entries(appEntry.application?.interop?.intents?.listensFor ?? {})?.map(
                ([intent, contextResultTypePair]) => ({
                    intent,
                    context: contextResultTypePair.contexts.map(contextType => ({ type: contextType })),
                }),
            ),
        );

        return { identifier, application };
    }

    /**
     * @param appId of app whose instances are being returned
     * @returns array of AppIdentifiers with appIds that match given appId, or undefined if app is not known to desktop agent
     */
    public async getAppInstances(appId: string): Promise<FullyQualifiedAppIdentifier[] | undefined> {
        await this.loadDirectoryPromise;

        const matchingAppIds = this.getAllMatchingFullyQualifiedAppIds(appId);
        if (matchingAppIds.length === 0) {
            return;
        }

        return matchingAppIds.flatMap(matchedAppId =>
            (this.directory[matchedAppId]?.instances ?? []).map(instanceId => ({
                appId: matchedAppId,
                instanceId,
            })),
        );
    }

    /**
     * Determines an app identity by looking up the identity url in the app directory. If the identity could not be determined an error message is returned
     * @param appDetails
     * @returns
     */
    private async resolveAppIdentity(identityUrl: string): Promise<AppDirectoryApplication | undefined> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        this.log('Resolving App Identity', LogLevel.DEBUG, identityUrl);

        /**
         * This is a very simple check for now that just looks for a matching url.
         * We will need to do more complex checks in here to handle urls that do not exactly match the identity url (for example due to url parameters)
         */
        const matchingApp = Object.values(this.directory)
            .map(record => record?.application)
            .filter(application => application != null)
            .find(
                application =>
                    isWebAppDetails(application.details) &&
                    urlContainsAllElements(application.details.url, identityUrl),
            );

        if (matchingApp != null) {
            return matchingApp;
        }

        this.log('No App Identity found', LogLevel.ERROR, identityUrl, this.directory);

        return undefined;
    }

    /**
     * Returns a fully qualified app identifier with a fully qualified appId IF the directory knows the appId and instance
     * If the directory does not know the instance or app an error message is returned
     */
    private getValidatedAppIdentifier(
        identifier: AppIdentifier | string,
    ): (AppIdentifier & { appId: FullyQualifiedAppId }) | string; // TODO: sort out this return type in next PR

    private getValidatedAppIdentifier(
        identifier?: AppIdentifier | string,
    ): (AppIdentifier & { appId: FullyQualifiedAppId }) | undefined | string;

    private getValidatedAppIdentifier(
        identifier?: AppIdentifier | string,
    ): (AppIdentifier & { appId: FullyQualifiedAppId }) | undefined | string {
        const appIdentifier = resolveAppIdentifier(identifier);

        if (appIdentifier == null) {
            return undefined;
        }

        const fullyQualifiedAppId = this.getKnownFullyQualifiedAppId(appIdentifier.appId);

        if (fullyQualifiedAppId == null || this.directory[fullyQualifiedAppId] == null) {
            return ResolveError.TargetAppUnavailable;
        }

        if (
            appIdentifier.instanceId != null &&
            !this.directory[fullyQualifiedAppId]?.instances.includes(appIdentifier.instanceId)
        ) {
            return ResolveError.TargetInstanceUnavailable;
        }

        return { ...appIdentifier, appId: fullyQualifiedAppId };
    }

    /**
     * Returns all FullyQualifiedAppIds that match the given appId using FDC3 cross-matching rules.
     * Used by findInstances where multiple matches should all be returned.
     */
    private getAllMatchingFullyQualifiedAppIds(appId: string): FullyQualifiedAppId[] {
        if (isFullyQualifiedAppId(appId) && this.directory[appId] != null) {
            return [appId];
        }

        const unqualifiedAppId = isFullyQualifiedAppId(appId) ? toUnqualifiedAppId(appId) : appId;

        return Object.keys(this.directory)
            .filter(isFullyQualifiedAppId)
            .filter(knownId => toUnqualifiedAppId(knownId) === unqualifiedAppId);
    }

    /**
     * Resolves an appId (qualified or unqualified) to a known FullyQualifiedAppId that exists in the directory using the
     * FDC3 Fully-Qualified AppId resolution algorithm:
     *
     * 1. Exact match: try the appId as-is against known directory keys.
     * 2. Cross-match: if a fully-qualified appId was given, split on '@' and match the
     *    unqualified portion against the unqualified part of known fully-qualified appIds.
     *    If an unqualified appId was given, match it against the unqualified part of known
     *    fully-qualified appIds.
     *
     * //TODO: update url when current version docs include this resolution algorithm
     * https://fdc3.finos.org/docs/next/api/spec#fully-qualified-appids
     *
     * When the cross-match yields multiple results the first match is returned.
     */
    private getKnownFullyQualifiedAppId(appId?: string): FullyQualifiedAppId | undefined {
        if (appId == null) {
            return;
        }

        if (isFullyQualifiedAppId(appId) && this.directory[appId] != null) {
            return appId;
        }

        // return first match if multiple found
        return this.getAllMatchingFullyQualifiedAppIds(appId)[0];
    }

    /**
     * @param appId of app whose metadata is being returned
     * @returns metadata of given app or undefined if app is not registered in app directory
     */
    public async getAppMetadata(app: AppIdentifier): Promise<AppMetadata | undefined> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        const fullyQualifiedAppId = this.getKnownFullyQualifiedAppId(app.appId);
        if (fullyQualifiedAppId == null) {
            //app is not known to desktop agent and cannot be looked up as no hostname is provided in appId
            return;
        }
        const directoryEntry = this.directory[fullyQualifiedAppId];
        if (directoryEntry == null) {
            //TODO: support fullyQualifiedAppId namespace syntax host resolution so directory can attempt to lookup unknown app
            return;
        }
        return mapApplicationToMetadata(app, directoryEntry.application);
    }

    /**
     * @returns array of contexts which are handled by given intent and given app
     */
    public async getContextForAppIntent(app: AppIdentifier, intent: Intent): Promise<Context[] | undefined> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        //if AppIdentifier is fully qualified, return contexts for specific instance intent pair
        if (app.instanceId != null) {
            return (
                [...(this.instanceLookup[app.instanceId] ?? [])].find(
                    intentContextLookup => intentContextLookup.intent === intent,
                )?.context ?? []
            );
        }

        // if we are given an unqualified appId we need to find all matching fully qualified appIds as there may be multiple matches and we want to return contexts for all matches
        const fullyQualifiedAppId = this.getKnownFullyQualifiedAppId(app.appId);

        if (fullyQualifiedAppId == null) {
            return;
        }

        //otherwise, return contexts based on app intent pair from application data
        return (
            this.directory[fullyQualifiedAppId]?.application?.interop?.intents?.listensFor?.[intent]?.contexts?.map(
                contextType => ({
                    type: contextType,
                }),
            ) ?? []
        );
    }

    /**
     * @param context for which apps and intents are being found to handle it
     * @param resultType used to optionally filter apps based on type of context or channel they return
     * @returns appIntents containing intents which handle the given context and the apps that resolve them
     */
    public async getAppIntentsForContext(context: Context, resultType?: string): Promise<AppIntent[]> {
        await this.loadDirectoryPromise;

        //find all intents which handle given context
        const intents = await this.getIntentsForContext(context);

        //for each intent which handles given context, find all apps which resolve that intent and context, and optionally return result of given resultType
        const appIntentsForContext = await Promise.all(
            intents.map(async intent => await this.getAppIntent(intent, context, resultType)),
        );

        //remove duplicate appIntents
        const appIntentsForContextRecord = appIntentsForContext.reduce<Record<string, AppIntent>>(
            (record, appIntent) => ({
                ...record,
                [appIntent.intent.name]: appIntent,
            }),
            {},
        );
        return Object.values(appIntentsForContextRecord);
    }

    /**
     * Returns all intents that can handle given context
     */
    private async getIntentsForContext(context: Context): Promise<string[]> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        return [
            ...new Set([
                ...Object.values(this.directory)
                    .filter(entry => entry != null)
                    .flatMap(entry =>
                        Object.entries(entry.application?.interop?.intents?.listensFor ?? {})
                            .filter(([_, contextResultTypePair]) =>
                                contextResultTypePair.contexts.includes(context.type),
                            )
                            .map(([intent]) => intent),
                    ),
                //need to check intents defined for instances as well since intentListeners can be added dynamically during runtime
                ...Object.values(this.instanceLookup)
                    .filter(intentContextLookups => intentContextLookups != null)
                    .flatMap(intentContextLookups => [...intentContextLookups])
                    .filter(intentContextLookup =>
                        intentContextLookup.context.some(possibleContext => possibleContext.type === context.type),
                    )
                    .map(intentContextLookup => intentContextLookup.intent),
            ]),
        ];
    }

    /**
     * @param intent for which apps are being found to resolve it
     * @param context used to optionally filter apps based on whether they handle it
     * @param resultType used to optionally filter apps based on type of context or channel they return
     * @returns AppIntent containing info about given intent, as well as appMetadata for apps and app instances which resolve it
     */
    public async getAppIntent(intent: Intent, context?: Context, resultType?: string): Promise<AppIntent> {
        await this.loadDirectoryPromise;

        const appsForIntent = await this.getAppsForIntent(intent, context, resultType);

        return {
            apps: appsForIntent.map(result => result.metadata),
            intent: { name: intent, displayName: this.getIntentDisplayName(intent, appsForIntent.map(result => result.application).filter(isDefined)) },
        };
    }

    private getIntentDisplayName(intent: Intent, apps: AppDirectoryApplication[]): string {
        for (const app of apps) {
            const displayName = app.interop?.intents?.listensFor?.[intent]?.displayName;
            if (displayName != null) {
                return displayName;
            }
        }

        return intent;
    }

    /**
     * Returns appMetadata for all apps and app instances that resolve given intent, handle given context, and return result of given resultType
     */
    private async getAppsForIntent(intent: Intent, context?: Context, resultType?: string): Promise<{ metadata: AppMetadata, application?: AppDirectoryApplication }[]> {
        const apps: { metadata: AppMetadata, application?: AppDirectoryApplication }[] = [];

        await Promise.all(
            Object.entries(this.directory).map(async ([appId, entry]) => {
                //find all entries for apps that resolve given intent and handle given context if provided
                if (
                    entry?.application?.interop?.intents?.listensFor?.[intent] != null &&
                    (context == null ||
                        entry.application.interop.intents.listensFor[intent].contexts.includes(context.type)) &&
                    (resultType == null || this.doesAppReturnResultType(entry.application, intent, resultType))
                ) {
                    const appMetadata = await this.getAppMetadata({ appId });
                    if (appMetadata != null) {
                        //this should always be the case as the app is definitely defined in the directory
                        apps.push({ metadata: appMetadata, application: entry.application });
                    }
                }
                //this should always be true
                if (isFullyQualifiedAppId(appId)) {
                    //find all entries for app instances that resolve given intent and handle given context if provided
                    apps.push(...(await this.getInstancesForIntent(appId, intent, context)));
                }
            }),
        );

        return apps;
    }

    /**
     * Returns true if given application returns result of given resultType when resolving given intent, and false otherwise
     */
    private doesAppReturnResultType(application: AppDirectoryApplication, intent: Intent, resultType: string): boolean {
        if (resultType.includes('channel')) {
            //return true if application returns channel of specific type if one is given, or any channel otherwise, when resolving given intent
            if (application.interop?.intents?.listensFor?.[intent].resultType?.includes(resultType)) {
                return true;
            }
        } else if (application.interop?.intents?.listensFor?.[intent].resultType === resultType) {
            return true;
        }
        return false;
    }

    /**
     * Returns appMetadata for all instances of a given app that resolve given intent and handle given context
     * @param appId of app whose instances are being checked
     * @param intent to be resolved by instance
     * @param context to be handled by instance
     */
    private async getInstancesForIntent(
        appId: FullyQualifiedAppId,
        intent: Intent,
        context?: Context,
    ): Promise<{ metadata: AppMetadata, application?: AppDirectoryApplication }[]> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        return Promise.all(
            this.directory[appId]?.instances
                .filter(instanceId => this.checkInstanceResolvesIntent(instanceId, intent, context))
                //should always return result of this.getAppMetadata() as app is definitely defined in directory
                .map(instanceId => {
                    const application = this.directory[appId]?.application;
                    return this.getAppMetadata({ appId, instanceId })?.then(metadata => metadata != null ? { metadata, application } : { metadata: { appId, instanceId }, application });
                },
                ) ?? [],
        );
    }

    /**
     * Returns true if app instance resolves given intent and handles given context. Returns false otherwise
     */
    private checkInstanceResolvesIntent(instanceId: string, intent: Intent, context?: Context): boolean {
        if (
            [...(this.instanceLookup[instanceId] ?? [])].some(
                intentContextLookup =>
                    intentContextLookup.intent === intent &&
                    this.isContextInArray(intentContextLookup.context, context),
            )
        ) {
            return true;
        }
        return false;
    }

    /**
     * Returns true if context of same type is contained within given array of Context objects
     * @param contextArray is array of Context objects
     * @param context is context object whose type is being checked for in array
     */
    private isContextInArray(contextArray: Context[], context?: Context): boolean {
        if (
            context == null ||
            contextArray.length === 0 ||
            contextArray.some(currentContext => currentContext.type === context.type)
        ) {
            return true;
        }
        return false;
    }

    /**
     * Fetches app data from given app directory urls and stores it in directory
     */
    private async loadAllAppDirectories(
        appDirectoryUrls: (string | LocalAppDirectory)[],
        backoffRetry?: BackoffRetryParams,
    ): Promise<void> {
        this.log('Loading all app directories', LogLevel.DEBUG, appDirectoryUrls);

        await Promise.all(
            appDirectoryUrls.map(async directoryEntry => {
                if (typeof directoryEntry === 'string') {
                    return this.loadAppDirectory(directoryEntry, backoffRetry);
                } else {
                    this.addLocalApps(directoryEntry);
                }
            }),
        );

        this.log('All App directories loaded', LogLevel.INFO, this.directory);
    }

    private addLocalApps(directoryEntry: LocalAppDirectory): void {
        const localDirectory = directoryEntry;

        async function handleUpdate(
            this: AppDirectory,
            updateResult: IteratorResult<AppDirectoryApplication | AppDirectoryApplication[]>,
        ): Promise<void> {
            const apps = Array.isArray(updateResult.value) ? updateResult.value : [updateResult.value];

            this.addLocalAppToDirectory({ ...directoryEntry, apps });

            if (updateResult.done !== true) {
                await localDirectory.updates?.next().then(result => handleUpdate.call(this, result));
            }
        }

        localDirectory.updates?.next().then(result => handleUpdate.call(this, result));

        this.addLocalAppToDirectory(directoryEntry);
    }

    private addLocalAppToDirectory(localDirectory: LocalAppDirectory): void {
        mapLocalAppDirectory(localDirectory).forEach(application => {
            this.directory[application.appId] = {
                application,
                instances: this.directory[application.appId]?.instances ?? [],
            };
        });
    }

    private async loadAppDirectory(url: string, backoffRetry?: BackoffRetryParams): Promise<void> {
        try {
            const apps: AppDirectoryApplication[] | void = await getAppDirectoryApplications(url, backoffRetry);

            this.log(`Loaded app directory (${url})`, LogLevel.DEBUG, apps);
            //add all returned apps to app directory using appId as key
            //TODO: fix possible collisions between apps in different app directories with same appId
            apps.forEach(app => {
                const fullyQualifiedAppId: FullyQualifiedAppId = mapUrlToFullyQualifiedAppId(url, app.appId);
                this.directory[fullyQualifiedAppId] = {
                    //need to update appId in record as record is used to open apps
                    application: { ...app, appId: fullyQualifiedAppId },
                    instances: [],
                };
            });
        } catch (err) {
            this.log(`Error loading app directory (${url})`, LogLevel.ERROR, err);
        }
    }

    /**
     * Add new intentContextLookup without introducing duplicates
     * @param instanceId which is having new intentContextLookup added
     * @param newIntentContextLookup being added
     * @returns true if intentContextLookup was added, and false otherwise
     */
    private addNewIntentContextLookup(instanceId: string, newIntentContextLookup: IntentContextLookup): boolean {
        const intentContextLookups = this.instanceLookup[instanceId];
        if (intentContextLookups == null) {
            return false;
        }
        const intentContextLookup = [...intentContextLookups].find(
            intentContextLookup => intentContextLookup.intent === newIntentContextLookup.intent,
        );

        if (intentContextLookup != null) {
            //intent is already registered so add contexts without duplicating
            intentContextLookup.context = [
                ...new Set([...intentContextLookup.context, ...newIntentContextLookup.context]),
            ];
        } else {
            //add completely new intentContextLookup
            intentContextLookups.add(newIntentContextLookup);
        }
        return true;
    }

    public async getAppDirectoryApplication(appId: string): Promise<AppDirectoryApplication | undefined> {
        //ensures app directory has finished loading before intentListeners can be added dynamically
        await this.loadDirectoryPromise;

        const fullyQualifiedAppId = this.getKnownFullyQualifiedAppId(appId);
        if (fullyQualifiedAppId == null) {
            //app is not known to desktop agent and cannot be looked up as no hostname is provided in appId
            return;
        }
        const directoryEntry = this.directory[fullyQualifiedAppId];
        if (directoryEntry == null) {
            //TODO: support fullyQualifiedAppId namespace syntax host resolution so directory can attempt to lookup unknown app
            return;
        }

        return directoryEntry.application;
    }

    public removeDisconnectedApp(app: FullyQualifiedAppIdentifier): void {
        delete this.instanceLookup[app.instanceId];

        // if an unqualified appId is passed we might end up with multiple matching apps
        const matchingAppIds = this.getAllMatchingFullyQualifiedAppIds(app.appId);

        matchingAppIds.forEach(fullyQualifiedId => {
            const appInstances = this.directory[fullyQualifiedId];
            const instanceIndex = appInstances?.instances?.indexOf(app.instanceId);

            if (instanceIndex != null && instanceIndex >= 0) {
                appInstances?.instances.splice(instanceIndex, 1);
            }
        });
    }

    private buildAppHostManifestLookup(): AppHostManifestLookup {
        return Object.entries(this.directory)
            .map(([appId, appRecord]) => {
                const manifest = appRecord?.application?.hostManifests?.[MS_HOST_MANIFEST_KEY];

                return {
                    appId,
                    appManifest: isIMSHostManifest(manifest) ? manifest : undefined,
                };
            })
            .filter(({ appId, appManifest }) => appId != null && appManifest != null)
            .reduce<AppHostManifestLookup>(
                (lookup, { appId, appManifest }) => ({ ...lookup, [appId]: appManifest }),
                {},
            );
    }
}
