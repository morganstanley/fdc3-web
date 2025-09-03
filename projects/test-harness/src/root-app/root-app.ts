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
    AppDirectoryApplication,
    BackoffRetryParams,
    createLogger,
    DesktopAgentFactory,
    FullyQualifiedAppIdentifier,
    generateUUID,
    getAgent,
    getAppDirectoryApplications,
    IOpenApplicationStrategy,
    isFullyQualifiedAppId,
    isWebAppDetails,
    OpenApplicationStrategyParams,
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
    SelectableAppsIntent,
    SelectableAppsRequestContextType,
    SelectableAppsResponseContextType,
    SelectAppContextType,
} from '../contracts.js';

const appDirectoryUrls = ['http://localhost:4299/v2/apps'];

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
export class RootApp extends LitElement implements IOpenApplicationStrategy {
    private log = createLogger(RootApp, 'proxy');

    @state()
    private appDetails: WebAppDetails[] = [];

    @state()
    private selectedApp?: FullyQualifiedAppIdentifier;

    private selectedAppChannel?: Channel;

    private openedWindowChannel?: Channel;

    @state()
    private applications: AppDirectoryApplication[] = [];

    constructor() {
        super();

        getAgent({
            failover: () =>
                new DesktopAgentFactory().createRoot({
                    uiProvider: agent => Promise.resolve(new AppResolverComponent(agent, document)),
                    appDirectoryUrls: appDirectoryUrls, //passes in app directory web service base url
                    openStrategies: [this],
                    backoffRetry: retryParams,
                }),
        });

        this.loadApplications();
    }

    private async loadApplications(): Promise<void> {
        const directoryResults = await Promise.allSettled(appDirectoryUrls.map(url => this.loadAppDirectory(url)));

        this.applications = directoryResults
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);

        this.initApp();
    }

    private async loadAppDirectory(url: string): Promise<AppDirectoryApplication[]> {
        const hostname = new URL(url).hostname;

        const applications = await getAppDirectoryApplications(url, retryParams).catch(() => []);

        return applications
            .filter(app => app.appId !== 'test-harness-root-app') //test-harness-root-app is the container and so is always open
            .map(app => ({ ...app, appId: `${app.appId}@${hostname}` })); //make appIds fully qualified
    }

    public async canOpen(params: OpenApplicationStrategyParams): Promise<boolean> {
        return params.appDirectoryRecord.type === 'web' && isWebAppDetails(params.appDirectoryRecord.details);
    }

    public async open(params: OpenApplicationStrategyParams): Promise<string> {
        if (isWebAppDetails(params.appDirectoryRecord.details)) {
            this.log('Opening WebAppDetails', LogLevel.DEBUG, params);
            const newWindow = (document.getElementById('openInWindow') as HTMLInputElement).checked;

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
                    //open app in new window
                    const windowProxy = window.open(details.url, '_blank', 'popup');

                    if (windowProxy == null) {
                        this.log('null window returned from window.open', LogLevel.ERROR, params.appDirectoryRecord);

                        return Promise.reject(`Window was null`); // TODO: use an approved error type
                    }

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

    private async initApp(): Promise<void> {
        //open all apps in root domain by default
        this.applications
            .filter(application => application.appId.includes('root'))
            .forEach(application => this.openAppInfo(application));

        await this.subscribeToSelectedApp();

        await this.subscribeToSelectableApps();
    }

    private async subscribeToSelectedApp(): Promise<void> {
        const agent = await getAgent();

        this.openedWindowChannel = await agent.getOrCreateChannel(NEW_WINDOW_PUBLIC_CHANNEL);

        this.selectedAppChannel = await agent.getOrCreateChannel(SELECT_APP_PUBLIC_CHANNEL);
        this.selectedAppChannel.addContextListener(SelectAppContextType, context => this.onAppSelected(context));
    }

    private onAppSelected(context: Context): void {
        this.selectedApp = (context as Partial<ISelectAppContext>).appIdentifier;
    }

    private async subscribeToSelectableApps(): Promise<void> {
        const agent = await getAgent();

        await agent.addIntentListener(SelectableAppsIntent, async context => {
            if (context.type === SelectableAppsRequestContextType) {
                const selectableAppsContext: ISelectableAppsResponseContext = {
                    type: SelectableAppsResponseContextType,
                    applications: await this.applications,
                };

                return selectableAppsContext;
            }

            return;
        });
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

    private async openAppInfo(application: AppDirectoryApplication): Promise<AppIdentifier> {
        const agent = await getAgent();

        if (isFullyQualifiedAppId(application.appId)) {
            const identifier = await agent.open({ appId: application.appId });

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
