/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import './root-app.css';
import './settings-panel.js';
import './app-container.js';
import { AppIdentifier, Channel, Context, LogLevel, OpenError } from '@finos/fdc3';
import {
    AppDirectory,
    AppDirectoryApplication,
    ApplicationStrategyParams,
    BackoffRetryParams,
    createLogger,
    createWebAppDirectoryEntry,
    DesktopAgentFactory,
    FullyQualifiedAppIdentifier,
    generateUUID,
    getAgent,
    IOpenApplicationStrategy,
    ISelectApplicationStrategy,
    isFullyQualifiedAppId,
    isWebAppDetails,
    LocalAppDirectory,
    OpenApplicationStrategyResolverParams,
    SelectApplicationStrategyParams,
    subscribeToConnectionAttemptUuids,
    WebAppDetails,
} from '@morgan-stanley/fdc3-web';
import { AppResolverComponent } from '@morgan-stanley/fdc3-web-ui-provider';
import { html, LitElement, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { NEW_WINDOW_PUBLIC_CHANNEL, SELECT_APP_PUBLIC_CHANNEL } from '../constants.js';
import {
    type AddApp,
    AppOpenedContextType,
    type IOpenAppContext,
    ISelectableAppsResponseContext,
    type ISelectAppContext,
    OpenAppContextType,
    OpenAppIntent,
    OpenAppOptionsContext,
    SelectableAppsIntent,
    SelectableAppsRequestContextType,
    SelectableAppsResponseContextType,
    SelectAppContextType,
} from '../contracts.js';

const defaultAppDirectoryUrls: (string | LocalAppDirectory)[] = [
    'http://localhost:4299/v2/apps',
    {
        host: 'fdc3.finos.org',
        apps: [
            createWebAppDirectoryEntry(
                'fdc3-workbench',
                'https://fdc3.finos.org/toolbox/fdc3-workbench/',
                'FDC3 Workbench',
            ),
        ],
    },
];

function getAppDirectoryUrls(): (string | LocalAppDirectory)[] {
    const params = new URLSearchParams(window.location.search);
    const appDirectoryUrl = params.get('appDirectoryUrl');

    if (appDirectoryUrl != null) {
        return [appDirectoryUrl];
    }

    return defaultAppDirectoryUrls;
}

const retryParams: BackoffRetryParams = {
    maxAttempts: 5,
    baseDelay: 500,
};

/**
 * `RootApp` is the entry point for the FDC3 Test Harness application.
 * This component is responsible for initializing the desktop agent, loading the default apps from the configuration,
 * and rendering the main UI components including the header, app containers, and settings panel.
 */
@customElement('root-app')
export class RootApp extends LitElement implements IOpenApplicationStrategy, ISelectApplicationStrategy {
    private log = createLogger(RootApp, 'proxy');

    private windowLookup: Record<string, WindowProxy> = {};

    @state()
    private appDetails: WebAppDetails[] = [];

    @state()
    private selectedApp?: FullyQualifiedAppIdentifier;

    private selectedAppChannel?: Channel;

    private openedWindowChannel?: Channel;

    private directory: AppDirectory | undefined;

    private get applications(): AppDirectoryApplication[] {
        return this.directory?.applications ?? [];
    }

    constructor() {
        super();

        getAgent({
            failover: async () => {
                const agent = await new DesktopAgentFactory().createRoot({
                    rootAppId: 'test-harness-root-app',
                    uiProvider: agent => Promise.resolve(new AppResolverComponent(agent, document)),
                    appDirectoryEntries: getAppDirectoryUrls(), //passes in app directory web service base url
                    applicationStrategies: [this],
                    backoffRetry: retryParams,
                });

                this.directory = agent.directory;

                this.directory.loadDirectoryPromise.then(() => this.onAppDirectoryLoaded());

                return agent;
            },
        });

        this.initApp();
    }

    /**
     * IOpenApplicationStrategy implementation
     */

    public async canOpen(params: ApplicationStrategyParams): Promise<boolean> {
        return params.appDirectoryRecord.type === 'web' && isWebAppDetails(params.appDirectoryRecord.details);
    }

    private _appCount = 0;

    public async open(params: OpenApplicationStrategyResolverParams): Promise<string> {
        if (isWebAppDetails(params.appDirectoryRecord.details)) {
            params.appReadyPromise.then(identity =>
                console.log(
                    `[appReadyPromise] App opening complete: appId: '${identity.appId}'(${identity.instanceId})`,
                ),
            );

            const forceIframe =
                params.context?.type === OpenAppOptionsContext && (params.context as any).forceIframe === true;

            this.log('Opening WebAppDetails', LogLevel.DEBUG, params);
            const newWindow = !forceIframe && (document.getElementById('openInWindow') as HTMLInputElement).checked;

            if (this.selectedApp != null) {
                const openAppContext: IOpenAppContext = {
                    type: OpenAppContextType,
                    webDetails: params.appDirectoryRecord.details,
                    appIdentifier: { appId: params.appDirectoryRecord.appId },
                    newWindow,
                    openRequestUuid: generateUUID(),
                };

                this.log('Raising OpenAppIntent', LogLevel.DEBUG, openAppContext);

                params.agent.raiseIntent(OpenAppIntent, openAppContext, this.selectedApp);

                return new Promise<string>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        this.log(
                            'Timeout waiting for WindowProxy to be returned from proxy app',
                            LogLevel.ERROR,
                            params.appDirectoryRecord,
                        );
                        reject(`Timeout waiting for WindowProxy to be returned from proxy app`);
                    }, 2000);

                    this.openedWindowChannel?.addContextListener(AppOpenedContextType, (appOpenedContext: Context) => {
                        if (appOpenedContext.type === AppOpenedContextType) {
                            if (openAppContext.openRequestUuid === appOpenedContext.openRequestUuid) {
                                clearTimeout(timeout);
                                this.log(
                                    'Received connectionAttemptUuid from proxy app',
                                    LogLevel.DEBUG,
                                    appOpenedContext,
                                );

                                resolve(appOpenedContext.connectionAttemptUuid);
                            }
                        }
                    });
                });
            } else {
                const details = params.appDirectoryRecord.details as WebAppDetails;

                if (newWindow) {
                    this.log('Opening app in new window', LogLevel.DEBUG, details);

                    const url = new URL(details.url);
                    url.searchParams.append('appIndex', (this._appCount++).toString()); // add a url param to test app directory url matching

                    //open app in new window
                    const windowProxy = window.open(url, '_blank', 'popup');

                    if (windowProxy == null) {
                        this.log('null window returned from window.open', LogLevel.ERROR, params.appDirectoryRecord);

                        return Promise.reject(`Window was null`); // TODO: use an approved error type
                    }

                    params.appReadyPromise.then(identity => (this.windowLookup[identity.instanceId] = windowProxy));

                    return new Promise(resolve => {
                        const subscriber = subscribeToConnectionAttemptUuids(
                            window,
                            windowProxy,
                            connectionAttemptUuid => {
                                subscriber.unsubscribe();

                                resolve(connectionAttemptUuid);
                            },
                        );
                    });
                } else {
                    //open app in iframe
                    this.appDetails = [...this.appDetails, details];

                    this.log('Opening app in iframe', LogLevel.DEBUG, details);

                    return new Promise(resolve => {
                        // wait for iframe window to be created
                        this.iframeCreationCallbacks.set(details, (iframeWindow, app) => {
                            if (app === details && iframeWindow != null) {
                                this.log('iframe window created', LogLevel.DEBUG);
                                const subscriber = subscribeToConnectionAttemptUuids(
                                    window,
                                    iframeWindow,
                                    connectionAttemptUuid => {
                                        subscriber.unsubscribe();

                                        resolve(connectionAttemptUuid);
                                    },
                                );
                            }
                        });
                    });
                }
            }
        }

        return Promise.reject(OpenError.ResolverUnavailable);
    }

    /**
     * IOpenApplicationStrategy implementation END
     */

    /**
     * ISelectApplicationStrategy implementation
     */

    public async canSelectApp(params: SelectApplicationStrategyParams): Promise<boolean> {
        return this.windowLookup[params.appIdentifier.instanceId] != null;
    }

    public async selectApp(params: SelectApplicationStrategyParams): Promise<void> {
        const window = this.windowLookup[params.appIdentifier.instanceId];
        if (window != null) {
            console.log(`Focussing window for app ${params.appIdentifier.appId}(${params.appIdentifier.instanceId})`);
            window.focus();
        }
    }

    /**
     * ISelectApplicationStrategy implementation END
     */

    private onAppDirectoryLoaded(): void {
        //open all apps in root domain by default
        this.applications
            .filter(application => application.appId.includes('root'))
            .forEach(application => this.openAppInfo(application, true));

        this.requestUpdate();
    }

    private async initApp(): Promise<void> {
        await this.subscribeToSelectedApp();

        await this.listenForSelectableAppsRequests();
    }

    private async subscribeToSelectedApp(): Promise<void> {
        const agent = await getAgent();

        this.openedWindowChannel = await agent.getOrCreateChannel(NEW_WINDOW_PUBLIC_CHANNEL).catch(err => {
            this.log(`Error creating channel for '${NEW_WINDOW_PUBLIC_CHANNEL}'`, LogLevel.ERROR, err);
            return undefined;
        });

        this.selectedAppChannel = await agent.getOrCreateChannel(SELECT_APP_PUBLIC_CHANNEL).catch(err => {
            this.log(`Error creating channel for '${SELECT_APP_PUBLIC_CHANNEL}'`, LogLevel.ERROR, err);
            return undefined;
        });

        this.selectedAppChannel
            ?.addContextListener(SelectAppContextType, context => this.onAppSelected(context))
            .catch(err => this.log(`Error adding context listener for '${SelectAppContextType}'`, LogLevel.ERROR, err));
    }

    private onAppSelected(context: Context): void {
        this.selectedApp = (context as Partial<ISelectAppContext>).appIdentifier;
    }

    private async listenForSelectableAppsRequests(): Promise<void> {
        const agent = await getAgent();

        await agent
            .addIntentListener(SelectableAppsIntent, async context => {
                if (context.type === SelectableAppsRequestContextType) {
                    const selectableAppsContext: ISelectableAppsResponseContext = {
                        type: SelectableAppsResponseContextType,
                        applications: await this.applications,
                    };

                    return selectableAppsContext;
                }

                return;
            })
            .catch(err => this.log(`Error adding intent listener for '${SelectableAppsIntent}'`, LogLevel.ERROR, err));
    }

    /**
     * Renders the main content of the root app, including the header, main container for apps, and the settings panel.
     * Utilizes LitElement's `html` template literal tag for defining the structure of the component's HTML.
     * @returns {TemplateResult} The template result for the root app's main content.
     */
    protected override render(): TemplateResult {
        return html`
            <div class="vstack vh-100 overflow-hidden bg-dark-subtle" @click=${this.handleOutsideClick}>
                ${this.renderHeader()}
                <main class="container-fluid d-flex p-0 h-100">${this.renderApps()} ${this.renderSettingsPanel()}</main>
            </div>
        `;
    }

    /**
     * Renders the header of the root app, including the application title and logo.
     * @returns {TemplateResult} The template result for the header.
     */
    private renderHeader(): TemplateResult {
        return html`<app-header
            .heading=${'FDC3 Test Harness - Root Window'}
            .logoSrc=${'assets/fdc3-icon.svg'}
            class="bg-primary-subtle d-flex h5 shadow-lg p-1"
        ></app-header>`;
    }

    /**
     * Renders the container for app elements, dynamically creating an `app-element` for each app in the `apps` array.
     * @returns {TemplateResult} The template result for the apps container.
     */
    private renderApps(): TemplateResult {
        return html`<div class="root-apps-container hstack flex-grow-1 gap-5 p-4 overflow-auto">
            ${this.appDetails.map(
                details => html`
                    <app-container
                        @onIframeCreated="${(event: CustomEvent<{ window: WindowProxy; app: WebAppDetails }>) =>
                            this.handleNewIframe(event)}"
                        class="fth-app h-100"
                        .details=${details}
                    ></app-container>
                `,
            )}
        </div>`;
    }

    private iframeCreationCallbacks = new Map<WebAppDetails, (window: WindowProxy, app: WebAppDetails) => void>();

    private handleNewIframe(event: CustomEvent<{ window: WindowProxy; app?: WebAppDetails }>): void {
        this.log('iframe created', LogLevel.DEBUG, {
            app: event.detail.app,
            callback: event.detail.app != null ? this.iframeCreationCallbacks.get(event.detail.app) : undefined,
        });

        if (event.detail.app != null) {
            this.iframeCreationCallbacks.get(event.detail.app)?.(event.detail.window, event.detail.app);
        }
    }

    /**
     * Renders the settings panel which allows for the addition of new apps.
     * @returns {TemplateResult} The template result for the settings panel.
     */
    private renderSettingsPanel(): TemplateResult {
        return html`<settings-panel .applications=${this.applications} @addApp=${this.handleAddApp}></settings-panel>`;
    }

    /**
     * Handles the addition of a new app through the settings panel, updating the `apps` array and triggering a re-render.
     * @param {CustomEvent<AddApp>} event - The custom event containing the app information to add.
     */
    private async handleAddApp(event: CustomEvent<AddApp>): Promise<void> {
        const application = event.detail.application;

        await this.openAppInfo(application);
    }

    private async openAppInfo(application: AppDirectoryApplication, forceIframe = false): Promise<AppIdentifier> {
        const agent = await getAgent();

        if (isFullyQualifiedAppId(application.appId)) {
            const identifier = await agent.open(
                { appId: application.appId },
                { type: OpenAppOptionsContext, forceIframe },
            );

            console.log(`[root-app] opened new app:`, { identifier });

            return identifier;
        }

        return Promise.reject(`app id is not fully qualified: ${application.appId}`);
    }

    private handleOutsideClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (this.selectedApp != null && !target.closest('settings-panel')) {
            this.selectedApp = undefined;

            const context: ISelectAppContext = {
                type: 'ms.fdc3.test-harness.select-app',
            };

            this.selectedAppChannel?.broadcast(context);
        }
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }
}
