/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import '../utils/list-component.js';
import '../utils/header-component.js';
import '../root-app/app-container.js';
import '../styles.css';
import '@morgan-stanley/fdc3-web-ui-provider';
import '../utils/select-component.js';
import type {
    Channel,
    Context,
    DesktopAgent,
    FDC3EventTypes,
    Intent,
    IntentResult,
    PrivateChannel as FDC3PrivateChannel,
    PrivateChannelEventTypes,
} from '@finos/fdc3';
import { LogLevel } from '@finos/fdc3';
import {
    AppDirectoryApplication,
    createLogger,
    FullyQualifiedAppIdentifier,
    getAgent,
    isChannel,
    isFullyQualifiedAppIdentifier,
    isPrivateChannel,
    isPrivateChannelEventTypes,
    subscribeToConnectionAttemptUuids,
    WebAppDetails,
} from '@morgan-stanley/fdc3-web';
import { html, LitElement, TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { NEW_WINDOW_PUBLIC_CHANNEL, SELECT_APP_PUBLIC_CHANNEL } from '../constants.js';
import {
    AppOpenedContextType,
    IAppOpenedContext,
    type IOpenAppContext,
    ISelectableAppsRequestContext,
    ISelectableAppsResponseContext,
    type ISelectAppContext,
    OpenAppIntent,
    SelectableAppsIntent,
    SelectableAppsRequestContextType,
    SelectableAppsResponseContextType,
    SelectAppContextType,
} from '../contracts.js';
import { getStandardIntents } from '../utils/fdc3.js';
import type { SelectComponent } from '../utils/select-component.js';

/**
 * `DefaultApp` is a custom web component that serves as the default application.
 * This component is responsible for rendering the application's UI, including headers, supported intents,
 * a section for raising intents, a console for logs, and nested applications.
 * It interacts with the FDC3 Desktop Agent to manage and raise intents.
 */
@customElement('default-app')
export class DefaultApp extends LitElement {
    private proxyLog = createLogger(DefaultApp, 'proxy');

    @state()
    private nestedAppDetails: WebAppDetails[] = [];

    @state()
    private logs: string[] = [];

    @query('#intent-selector')
    private intentSelector!: SelectComponent;

    @query('#intent-listener-selector')
    private intentListenerSelector!: SelectComponent;

    @query('#app-selector')
    private appSelector!: SelectComponent;

    @query('#event-type-selector')
    private eventTypeSelector!: SelectComponent;

    @query('#broadcast-channel-selector')
    private broadcastChannel!: SelectComponent;

    @query('#private-channel-selector')
    private selectedPrivateChannel!: SelectComponent;

    @query('#private-channel-event-type-selector')
    private privateChannelEventTypeSelector!: SelectComponent;

    @query('#context-input')
    private broadcastContext!: HTMLInputElement;

    @query('#app-channel-id')
    private appChannelId!: HTMLInputElement;

    @state()
    private appIdentifier?: FullyQualifiedAppIdentifier;

    private selectedAppChannel?: Channel;

    @state()
    private selectedApp?: FullyQualifiedAppIdentifier;

    @state()
    private supportedIntents?: Intent[];

    @state()
    private supportedRaiseIntent?: Intent[];

    private appTitle: string | undefined;

    @state()
    private agent?: DesktopAgent;

    @state()
    private anyPrivateChannels: boolean = false;

    private fdc3EventTypes: (FDC3EventTypes | 'all events')[] = ['userChannelChanged', 'all events'];

    private privateChannelEventTypes: (PrivateChannelEventTypes | 'all events')[] = [
        'addContextListener',
        'unsubscribe',
        'disconnect',
        'all events',
    ];

    private currentChannels: Record<string, Channel> = {};

    private openedWindowChannel?: Channel;

    @state()
    private applications: AppDirectoryApplication[] = [];

    @state()
    private possibleIntents: Intent[] = getStandardIntents();

    constructor() {
        super();

        this.initApp();
    }

    /**
     * Renders the main application UI, including the application header, supported intents section, raise intent section, console for logs, and nested applications area.
     * Utilizes LitElement's `html` template literal for defining the structure and content of the UI.
     * @returns {TemplateResult} The complete UI template for the DefaultApp component.
     */
    protected override render(): TemplateResult<1> | undefined {
        return html`
            <div class="${this.getSelectedAppClass()}">
                <app-header
                    .heading="${this.appTitle} (${this.appIdentifier?.appId} / ${this.appIdentifier?.instanceId})"
                    class="bg-body-tertiary d-flex h6 clickable"
                    @click="${this.selectApp}"
                ></app-header>
                <main class="vstack gap-3 flex-grow-1 p-4">
                    ${this.renderSupportedIntents()} ${this.renderRaiseIntentSection()}
                    ${this.renderAddIntentListenerSection()} ${this.renderAppAndInstanceInfoSection()}
                    ${this.renderAddEventListenerSection()} ${this.renderGetInfoSection()}
                    ${this.renderChannelsSection()} ${this.renderConsole()}
                </main>
                ${this.renderChannelSelector()} ${this.renderNestedApps()}
            </div>
        `;
    }

    private renderChannelsSection(): TemplateResult {
        return html`
            <div>
                <div class="vstack gap-2 flex-grow-1">
                    <div
                        class="btn btn-secondary bg-primary-subtle"
                        style="display: flex; justify-content: space-between;"
                        @click="${this.toggleChannelCollapsibleBody}"
                    >
                        Channels
                        <div class="ms-app-resolver-popup-intent-title-chevron" id="channel-collapsible-chevron">
                            <svg height="15" width="15">
                                <path d="M0 0.75 L7.5 8.5 L15 0.75" style="fill:none;stroke:white;stroke-width:1.5" />
                                v
                            </svg>
                        </div>
                    </div>
                    <div id="channel-collapsible-body" class="vstack gap-1" style="display: none;">
                        ${this.renderAppChannelsSection()} ${this.renderPrivateChannelsSection()}
                        ${this.renderContextSection()}
                    </div>
                </div>
            </div>
        `;
    }

    private toggleChannelCollapsibleBody(): void {
        const collapsibleBody = document.getElementById('channel-collapsible-body');
        const chevron = document.getElementById('channel-collapsible-chevron');
        if (collapsibleBody != null) {
            if (collapsibleBody.style.display === 'none') {
                collapsibleBody.style.display = 'flex';
                if (chevron != null) {
                    chevron.innerHTML = `<svg height="15" width="15">
                    <path d="M0 8.5 L7.5 0.75 L15 8.5" style="fill:none;stroke:white;stroke-width:1.5" />
                    v
                </svg>`;
                }
            } else {
                collapsibleBody.style.display = 'none';
                if (chevron != null) {
                    chevron.innerHTML = `<svg height="15" width="15">
                    <path d="M0 0.75 L7.5 8.5 L15 0.75" style="fill:none;stroke:white;stroke-width:1.5"/>
                    v
                </svg>`;
                }
            }
        }
    }

    /**
     * Renders the section to show intents supported by the app.
     * @returns {TemplateResult} The template result for the raise intent section.
     */
    private renderSupportedIntents(): TemplateResult {
        if (this.supportedIntents == null) {
            return html``;
        }

        return html`
            <div>
                <label class="form-label">Supported Intents:</label>
                <list-component .items=${this.supportedIntents}></list-component>
            </div>
        `;
    }

    /**
     * Renders the section for raising intents, including a dropdown for selecting an intent and a button to trigger the intent.
     * @returns {TemplateResult} The template result for the raise intent section.
     */
    private renderRaiseIntentSection(): TemplateResult {
        if (this.supportedRaiseIntent == null) {
            return html``;
        }

        return html`
            <div class="hstack gap-2">
                <div class="flex-grow-1">
                    <select-component
                        id="intent-selector"
                        .items=${this.supportedRaiseIntent}
                        aria-label="Select Intent to Raise"
                    ></select-component>
                </div>
                <button class="btn btn-secondary bg-primary-subtle" @click="${this.raiseIntent}">Raise Intent</button>
            </div>
        `;
    }

    /**
     * Renders the section for adding intentListeners, including a dropdown for selecting an intent and a button to trigger adding the intentListener.
     * @returns {TemplateResult} The template result for the adding intentListeners section.
     */
    private renderAddIntentListenerSection(): TemplateResult {
        return html`
            <div class="hstack gap-2">
                <div class="flex-grow-1">
                    <select-component
                        id="intent-listener-selector"
                        .items=${this.possibleIntents}
                        aria-label="Select Intent to Add Intent Listener"
                    ></select-component>
                </div>
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    title="add intentListener for selected intent"
                    @click="${this.addIntentListener}"
                >
                    Add
                </button>
            </div>
        `;
    }

    /**
     * Renders the section for broadcasts, including a text input for specifying the context type
     * @returns {TemplateResult} The template result for the broadcast section.
     */
    private renderContextSection(): TemplateResult {
        return html`
            <div class="vstack gap-2">
                <label class="form-label">Context:</label>
                <div class="vstack gap-1">
                    <div class="flex-grow-1">
                        <input id="context-input" class="w-100" type="text" value="fdc3.contact" />
                    </div>
                    <select-component
                        id="broadcast-channel-selector"
                        .items=${['current user channel', ...Object.keys(this.currentChannels)]}
                        aria-label="Select channel to interact with"
                    ></select-component>
                </div>
                <div class="vstack gap-1">
                    <div class="hstack gap-2 justify-content-end">
                        <button
                            class="btn btn-secondary bg-primary-subtle"
                            @click="${() => this.setupContextListener(this.broadcastContext.value)}"
                            title="Add a context listener for this app for the context type specified. Leave input empty to add listener for all contexts"
                        >
                            Add Context Listener
                        </button>
                        <button class="btn btn-secondary bg-primary-subtle" @click="${this.broadcast}">
                            Broadcast
                        </button>
                    </div>

                    <div class="hstack gap-2 justify-content-end">
                        <button class="btn btn-secondary bg-primary-subtle" @click="${this.raiseIntentForContext}">
                            Raise Intent for Context
                        </button>
                        <button
                            class="btn btn-secondary bg-primary-subtle"
                            @click="${this.getCurrentContext}"
                            title="Get current context of inputted type on selected channel"
                        >
                            Get Context
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Renders the section for fetching desktop agent implementation information, a button to trigger fetching desktop agent implementation information.
     * @returns {TemplateResult} The template result for the get info section.
     */
    private renderGetInfoSection(): TemplateResult {
        return html`<div class="hstack gap-2">
            <button class="btn btn-secondary bg-primary-subtle" @click="${this.getInfo}">Get Info</button>
        </div>`;
    }

    /**
     * Renders the section for fetching app metadata and finding app instances, including a dropdown for selecting an app and buttons to trigger finding the instances and getting the app metadata.
     * @returns {TemplateResult} The template result for the app and instances info section.
     */
    private renderAppAndInstanceInfoSection(): TemplateResult {
        return html`<div class="vstack gap-2 flex-grow-1">
            <select-component
                id="app-selector"
                .items=${this.applications.map(app => app.appId)}
                aria-label="Select App to Get Metadata or Find Instances for"
            ></select-component>
            <div class="hstack gap-2">
                <button class="btn btn-secondary bg-primary-subtle" @click="${this.getAppMetadata}">
                    Get Metadata
                </button>
                <button class="btn btn-secondary bg-primary-subtle" @click="${this.findInstances}">
                    Find Instances
                </button>
                <button class="btn btn-secondary bg-primary-subtle" @click="${this.openInstance}">Open</button>
            </div>
        </div>`;
    }

    /**
     * Renders the section for adding eventListeners, including a dropdown for selecting an event type and a button to trigger adding the listener.
     * @returns {TemplateResult} The template result for the adding eventListeners section.
     */
    private renderAddEventListenerSection(): TemplateResult {
        return html`
            <div class="hstack gap-2">
                <div class="flex-grow-1">
                    <select-component
                        id="event-type-selector"
                        .items=${this.fdc3EventTypes}
                        aria-label="Select Event Type for Event Listener"
                    ></select-component>
                </div>
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    title="add eventListener for selected event"
                    @click="${this.addFDC3EventListener}"
                >
                    Add
                </button>
            </div>
        `;
    }

    /**
     * Renders the section for getting or creating app channels, including an input to enter the app channel id and a button to trigger getting the channel.
     * @returns {TemplateResult} The template result for the getting app channels section.
     */
    private renderAppChannelsSection(): TemplateResult {
        return html`
            <div class="hstack gap-2">
                <div class="flex-grow-1">
                    <input id="app-channel-id" class="w-100" type="text" value="default-app-channel-id" />
                </div>
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    @click="${this.getOrCreateAppChannel}"
                    title="Get an app channel by id if it exists, or create one with that id if it doesn't"
                >
                    App Channel
                </button>
            </div>
        `;
    }

    /**
     * Renders the section for private channels, including buttons to trigger creating and disconnecting from private channels, a selector to select a private channel, and a selector and button to choose private channel eventListeners to add to the selected private channel.
     * @returns {TemplateResult} The template result for the private channels section.
     */
    private renderPrivateChannelsSection(): TemplateResult {
        return html`<div class="vstack gap-2">
            <label class="form-label">Private Channels:</label>
            <div class="hstack gap-2">
                <select-component
                    id="private-channel-selector"
                    .items=${[
                        ...Object.entries(this.currentChannels)
                            .filter(([_, channel]) => channel.type === 'private')
                            .map(([id]) => id),
                    ]}
                    aria-label="Select private channel to interact with"
                    class="flex-grow-1"
                ></select-component>
            </div>
            <div class="hstack gap-2">
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    @click="${this.createPrivateChannel}"
                    title="Create private channel"
                >
                    Private Channel
                </button>
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    @click="${this.disconnect}"
                    title="Disconnect from private channel"
                    ?hidden=${!this.anyPrivateChannels}
                >
                    Disconnect
                </button>
            </div>
            <div class="hstack gap-2" ?hidden=${!this.anyPrivateChannels}>
                <div class="flex-grow-1">
                    <select-component
                        id="private-channel-event-type-selector"
                        .items=${this.privateChannelEventTypes}
                        aria-label="Select Event Type for Private Channel Event Listener"
                    ></select-component>
                </div>
                <button
                    class="btn btn-secondary bg-primary-subtle"
                    title="add private channel eventListener for selected event"
                    @click="${this.addPrivateChannelEventListener}"
                >
                    Add
                </button>
            </div>
        </div>`;
    }

    /**
     * Renders the console area where logs are displayed.
     * @returns {TemplateResult} The template result for the console section.
     */
    private renderConsole(): TemplateResult {
        return html`
            <div class="vstack gap-2">
                <div class="hstack gap-2">
                    <label class="form-label flex-grow-1">Console:</label>
                    <button class="btn btn-secondary bg-primary-subtle btn-sm" @click="${this.clearLog}">Clear</button>
                </div>
                <div class="bg-dark-subtle p-2 text-muted h-auto" style="font-size: 14px; word-wrap: break-word;">
                    ${this.logs.map(log => html`${log}<br /><br />`)}
                </div>
            </div>
        `;
    }

    /**
     * Renders the section containing nested applications.
     * @returns {TemplateResult} The template result for the nested apps section.
     */
    private renderNestedApps(): TemplateResult {
        return html`
            <div class="nested-apps-container d-flex flex-wrap gap-4">
                ${this.nestedAppDetails.map(
                    details =>
                        html`<app-container
                            @onIframeCreated="${(event: CustomEvent<{ window: WindowProxy; app: WebAppDetails }>) =>
                                this.handleNewIframe(event)}"
                            .details=${details}
                            style="height: 60vh;min-width: 400px;"
                        ></app-container>`,
                )}
            </div>
        `;
    }

    private iframeCreationCallbacks = new Map<WebAppDetails, (window: WindowProxy, app: WebAppDetails) => void>();

    private handleNewIframe(event: CustomEvent<{ window: WindowProxy; app?: WebAppDetails }>): void {
        this.proxyLog('iframe created', LogLevel.DEBUG, {
            app: event.detail.app,
            callback: event.detail.app != null ? this.iframeCreationCallbacks.get(event.detail.app) : undefined,
        });

        if (event.detail.app != null) {
            this.iframeCreationCallbacks.get(event.detail.app)?.(event.detail.window, event.detail.app);
        }
    }

    private renderChannelSelector(): TemplateResult {
        if (this.agent == null) {
            return html``;
        }

        return html`<ms-channel-selector .desktopAgent=${this.agent}></ms-channel-selector>`;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }

    /**
     * Updates the selected app across all opened apps by publishing a selected app context on a public channel
     * @returns
     */
    public async selectApp(): Promise<void> {
        if (this.selectedAppChannel == null) {
            this.log(`Unable to select app as selectedAppChannel is not defined`);
            return;
        }

        if (this.appIdentifier == null) {
            this.log(`Unable to select app as appIdentifier has not been resolved`);
            return;
        }

        this.log(`Publishing select app context`);

        this.selectedApp = this.appIdentifier;

        const context: ISelectAppContext = {
            type: 'ms.fdc3.test-harness.select-app',
            appIdentifier: this.appIdentifier,
        };

        this.selectedAppChannel.broadcast(context);
    }

    private getSelectedAppClass(): string {
        return this.selectedApp?.instanceId === this.appIdentifier?.instanceId ? 'border border-4 border-info' : '';
    }

    /**
     * Initializes the application
     */
    private async initApp(): Promise<void> {
        // instantiates our proxy agent
        const agent = await getAgent();
        this.agent = agent;

        // gets the app info for this app
        const appMetadata = (await agent.getInfo()).appMetadata;
        this.appTitle = appMetadata.title;

        if (isFullyQualifiedAppIdentifier(appMetadata)) {
            this.appIdentifier = { appId: appMetadata.appId, instanceId: appMetadata.instanceId };
        }

        await this.subscribeToSelectedApp(agent);

        await this.subscribeToOpenAppIntent(agent);

        await this.getSelectableApps(agent);
    }

    private async subscribeToOpenAppIntent(agent: DesktopAgent): Promise<void> {
        // listens for open app intents
        await agent.addIntentListener(OpenAppIntent, context => this.openChildApp(context as IOpenAppContext));

        this.log(`'${OpenAppIntent}' intent listener added`);
    }

    private async subscribeToSelectedApp(agent: DesktopAgent): Promise<void> {
        // subscribes to selected app updates
        this.selectedAppChannel = await agent.getOrCreateChannel(SELECT_APP_PUBLIC_CHANNEL);
        this.selectedAppChannel.addContextListener(SelectAppContextType, context => this.onAppSelected(context));

        this.log(`'${SelectAppContextType}' context listener added to Channel: '${SELECT_APP_PUBLIC_CHANNEL}'`);

        // gets currently selected app
        const currentApp = await this.selectedAppChannel.getCurrentContext();

        if (currentApp != null) {
            this.onAppSelected(currentApp);
        }
    }

    private async getSelectableApps(agent: DesktopAgent): Promise<void> {
        this.openedWindowChannel = await agent.getOrCreateChannel(NEW_WINDOW_PUBLIC_CHANNEL);

        const context: ISelectableAppsRequestContext = { type: SelectableAppsRequestContextType };
        const resolution = await agent.raiseIntent(SelectableAppsIntent, context);

        if (resolution != null) {
            const result = await resolution.getResult();
            if (result?.type === SelectableAppsResponseContextType) {
                this.applications = (result as ISelectableAppsResponseContext).applications;

                // cannot load intents until we have the applications from app directory
                this.loadIntentsFromDirectory();
            }
        }
    }

    private async openChildApp(openWindowContext: IOpenAppContext): Promise<void> {
        this.log(`Adding new child app: ${openWindowContext.appIdentifier.appId}`);

        let windowProxy: WindowProxy | null = null;

        if (openWindowContext.newWindow) {
            //open app in new window
            windowProxy = window.open(openWindowContext.webDetails.url, '_blank', 'popup');
        } else {
            //open app in iframe
            this.nestedAppDetails = [...this.nestedAppDetails, openWindowContext.webDetails];

            windowProxy = await new Promise(resolve => {
                // wait for iframe window to be created
                this.iframeCreationCallbacks.set(openWindowContext.webDetails, (window, app) => {
                    if (app === openWindowContext.webDetails && window != null) {
                        this.proxyLog('iframe window created', LogLevel.DEBUG);
                        resolve(window);
                    }
                });
            });
        }

        if (windowProxy != null) {
            const subscriber = subscribeToConnectionAttemptUuids(window, windowProxy, connectionAttemptUuid => {
                subscriber.unsubscribe();
                const windowOpenedContext: IAppOpenedContext = {
                    ...openWindowContext,
                    type: AppOpenedContextType,
                    connectionAttemptUuid,
                };

                this.openedWindowChannel?.broadcast(windowOpenedContext);
            });
        } else {
            this.proxyLog(`No window proxy to return to root app`, LogLevel.WARN);
        }
    }

    private onAppSelected(context: Context): void {
        this.selectedApp = (context as Partial<ISelectAppContext>).appIdentifier;

        this.log(`App selected`, (context as ISelectAppContext).appIdentifier);
    }

    /**
     * Function to populate app with some intents from app directory
     */
    private async loadIntentsFromDirectory(): Promise<void> {
        const application = this.applications.find(app => app.appId === this.appIdentifier?.appId);

        const supportedIntents: Intent[] = Object.keys(application?.interop?.intents?.listensFor ?? {}) ?? [];
        const supportedRaiseIntents: Intent[] = Object.keys(application?.interop?.intents?.raises ?? {}) ?? [];

        await this.setupIntentListeners(supportedIntents, supportedRaiseIntents);
    }

    /**
     * Sets up a context listener to log any broadcasts received from other apps
     * If null or an empty string is passed then a null context listener is created that will respond to all context types
     */
    private async setupContextListener(context?: string | null): Promise<void> {
        context = context != null && context.length > 0 ? context : null;

        if (this.broadcastChannel.value === 'current user channel') {
            const agent = await getAgent();

            await agent.addContextListener(context ?? null, (...args) => this.log('Received Context:', args));
        } else {
            const channel = this.currentChannels[this.broadcastChannel.value];
            channel.addContextListener(context ?? null, (...args) => this.log('Received Context:', args));
        }
        this.log(
            `Context listener added to ${this.broadcastChannel.value} for: ${context === null ? 'all-contexts' : context}`,
        );
    }

    /**
     * Sets up listeners for the intents supported by the application, Each intent listener logs a message when the intent is received.
     */
    private async setupIntentListeners(supportedIntents: Intent[], supportedRaiseIntents: Intent[]): Promise<void> {
        this.supportedIntents = supportedIntents;
        this.supportedRaiseIntent = supportedRaiseIntents;

        const agent = await getAgent();
        const info = await agent.getInfo();

        const allAddIntentListenerPromises = [];
        for (const intent of supportedIntents) {
            this.log(`Setting up intent listener: '${intent}'`);

            allAddIntentListenerPromises.push(
                agent.addIntentListener(intent, async (...args) => {
                    this.log('Received Intent:', args);

                    //returns private channel currently selected by receiving app as the intentResult if it exists, or context otherwise
                    if (this.selectedPrivateChannel.value != '') {
                        return Promise.resolve(
                            Object.entries(this.currentChannels).find(
                                ([id]) => id === this.selectedPrivateChannel.value,
                            )?.[1],
                        );
                    }

                    const returnedContext: IntentResult = {
                        type: 'ms.test-harness.raiseIntentResult',
                        raisedIntent: intent,
                        selectedApp: info.appMetadata.appId,
                    };
                    return Promise.resolve(returnedContext);
                }),
            );
        }
        await Promise.all(allAddIntentListenerPromises);
        this.log('Intent listeners setup complete');

        this.possibleIntents = this.possibleIntents.filter(intent => !this.supportedIntents?.includes(intent));
    }

    /**
     * Raises an intent for a given context using the FDC3 agent. This method demonstrates how to raise an intent and handle its resolution.
     * @returns {Promise<void>} A promise that resolves when the intent has been raised and handled.
     */
    private async raiseIntentForContext(): Promise<void> {
        this.log(`Intent for Context Raised: ${this.broadcastContext.value}`);
        const agent = await getAgent();

        try {
            const resolution = await agent.raiseIntentForContext({ type: this.broadcastContext.value });

            if (resolution != null) {
                this.log('Intent for Context Resolution:', {
                    intent: resolution.intent,
                    source: resolution.source,
                });

                const result = await resolution.getResult();
                if (isPrivateChannel(result)) {
                    //result is a private channel
                    this.log('Intent Result:', { id: result.id, type: result.type });
                    this.currentChannels[result.id] = result;
                    this.anyPrivateChannels = true;
                    return;
                }

                this.log('Intent Result:', result);
            }
        } catch (err) {
            this.log(String(err));
        }
    }

    /**
     * Raises an intent using the FDC3 agent. This method demonstrates how to raise an intent and handle its resolution.
     * @returns {Promise<void>} A promise that resolves when the intent has been raised and handled.
     */
    private async raiseIntent(): Promise<void> {
        this.log(`Intent Raised: ${this.intentSelector.value}`);
        const agent = await getAgent();

        try {
            const resolution = await agent.raiseIntent(this.intentSelector.value, { type: 'fdc3.instrument' });

            if (resolution != null) {
                this.log('Intent Resolution:', { intent: resolution.intent, source: resolution.source });

                const result = await resolution.getResult();
                if (isChannel(result)) {
                    //result is a channel
                    this.log('Intent Result:', { id: result.id, type: result.type });
                    this.currentChannels[result.id] = result;
                    if (result.type === 'private') {
                        this.anyPrivateChannels = true;
                    }
                    return;
                }

                this.log('Intent Result:', result);
            }
        } catch (err) {
            this.log(String(err));
        }
    }

    private async addIntentListener(): Promise<void> {
        this.log(`Adding Intent Listener for: ${this.intentListenerSelector.value}`);
        const agent = await getAgent();

        await agent.addIntentListener(this.intentListenerSelector.value, async (...args) => {
            this.log('Received Intent:', args);

            //returns private channel currently selected by receiving app as the intentResult if it exists, or context otherwise
            if (this.selectedPrivateChannel.value != '') {
                return Promise.resolve(
                    Object.entries(this.currentChannels).find(([id]) => id === this.selectedPrivateChannel.value)?.[1],
                );
            }

            const returnedContext: IntentResult = {
                type: 'ms.test-harness.raiseIntentResult',
                raisedIntent: this.intentListenerSelector.value,
                selectedApp: this.appIdentifier?.appId,
            };
            return Promise.resolve(returnedContext);
        });

        this.supportedIntents = [...(this.supportedIntents ?? []), this.intentListenerSelector.value];
        this.possibleIntents = this.possibleIntents.filter(intent => intent !== this.intentListenerSelector.value);
    }

    /**
     * Broadcasts a specified context type on the specified channel. If the app is not joined to a user channel and 'current user channel' is selected, nothing happens.
     * @returns {Promise<void>} A promise that resolves when the broadcast has completed.
     */
    private async broadcast(): Promise<void> {
        this.log(`Broadcast Publishing ${this.broadcastContext.value} on ${this.broadcastChannel.value}`);

        if (this.broadcastChannel.value === 'current user channel') {
            const agent = await getAgent();

            await agent.broadcast({ type: this.broadcastContext.value });
        } else {
            const channel = this.currentChannels[this.broadcastChannel.value];
            channel.broadcast({ type: this.broadcastContext.value });
        }
        this.log(`Broadcast Complete`);
    }

    /**
     * Fetches metadata for app from desktop agent's app directory
     */
    private async getAppMetadata(): Promise<void> {
        this.log(`Fetching metadata for app: ${this.appSelector.value}`);

        const chosenApp = this.applications.find(app => app.appId === this.appSelector.value);
        if (chosenApp != null) {
            const agent = await getAgent();

            await agent
                .getAppMetadata({ appId: chosenApp.appId })
                .then(metadata => this.log(`Metadata for ${chosenApp.appId}:`, metadata))
                .catch(err => this.log(err));
        }
    }

    /**
     * Fetches information about the implementation of the root desktop agent
     */
    private async getInfo(): Promise<void> {
        this.log(`Fetching information about the implementation of the Desktop Agent`);

        const agent = await getAgent();

        await agent
            .getInfo()
            .then(info => this.log(`Information about DesktopAgent:`, info))
            .catch(err => this.log(err));
    }

    /**
     * Opens a new instance of the app selected in the app selector
     */
    private async openInstance(): Promise<void> {
        this.log(`Opening new instance: '${this.appSelector.value}'`);
        const chosenApp = this.applications.find(app => app.appId === this.appSelector.value);

        const agent = await getAgent();

        if (chosenApp != null) {
            const identifier = await agent.open({ appId: chosenApp.appId }).catch(err => {
                this.log(`Error opening new instance:`, err);

                return undefined;
            });

            if (identifier != null) {
                this.log(`New instance opened: `, identifier);
            }
        }
    }

    /**
     * Gets all current instances registered in the root desktop agent's app directory for an app
     */
    private async findInstances(): Promise<void> {
        this.log(`Finding all instances of app: ${this.appSelector.value}`);
        const chosenApp = this.applications.find(app => app.appId === this.appSelector.value);

        const agent = await getAgent();

        if (chosenApp != null) {
            await agent
                .findInstances({ appId: chosenApp.appId })
                .then(instances => this.log(`Instances of app ${this.appSelector.value}`, instances))
                .catch(err => this.log(err));
        }
    }

    /**
     * Adds an eventListener for FDC3 events
     */
    private async addFDC3EventListener(): Promise<void> {
        const eventType = this.eventTypeSelector.value === 'userChannelChanged' ? this.eventTypeSelector.value : null;
        this.log(`Adding event listener of type: ${eventType}`);

        const agent = await getAgent();

        await agent.addEventListener(eventType, (...args) => this.log('Received Event:', args));
        this.log(`Event listener has been added`);
    }

    /**
     * Retrieves an app channel if one with the given channel id exists, or creates one with that id if it doesn't
     */
    private async getOrCreateAppChannel(): Promise<void> {
        this.log(`Getting app channel with id: ${this.appChannelId.value}`);

        const agent = await getAgent();

        const appChannel = await agent.getOrCreateChannel(this.appChannelId.value).catch(err => this.log(err));
        if (appChannel != null) {
            this.currentChannels[appChannel.id] = appChannel;
            this.log(`App channel has been received`);
        }
    }

    private async getCurrentContext(): Promise<void> {
        this.log(
            `Getting current context of type ${this.broadcastContext.value} for channel ${this.broadcastChannel.value}`,
        );

        const contextType = this.broadcastContext.value === '' ? undefined : this.broadcastContext.value;
        if (this.broadcastChannel.value === 'current user channel') {
            const agent = await getAgent();

            const channel = await agent.getCurrentChannel();
            if (channel != null) {
                const context = await channel.getCurrentContext(contextType);
                this.log(`Current context on channel ${this.broadcastChannel.value}:`, context);
            } else {
                this.log('App is not currently joined to a user channel');
                return;
            }
        } else {
            const channel = this.currentChannels[this.broadcastChannel.value];
            const context = await channel.getCurrentContext(contextType);
            this.log(`Current context on channel ${this.broadcastChannel.value}:`, context);
        }
    }

    /**
     * Creates private channel
     */
    private async createPrivateChannel(): Promise<void> {
        this.log(`Creating private channel`);

        const agent = await getAgent();

        const privateChannel = await agent.createPrivateChannel();
        this.currentChannels[privateChannel.id] = privateChannel;
        this.anyPrivateChannels = true;
        this.log(`Private channel has been received with id: ${privateChannel.id}`);
    }

    /**
     * Disconnects from selected private channel
     */
    private async disconnect(): Promise<void> {
        this.log(`Disconnecting from private channel: ${this.selectedPrivateChannel.value}`);

        const privateChannel = this.currentChannels[this.selectedPrivateChannel.value];
        if (privateChannel != null && privateChannel.type === 'private') {
            (privateChannel as FDC3PrivateChannel).disconnect();
            delete this.currentChannels[privateChannel.id];
            this.log(`Disconnected from private channel: ${this.selectedPrivateChannel.value}`);
            if (!Object.entries(this.currentChannels).some(([_, channel]) => channel.type === 'private')) {
                this.anyPrivateChannels = false;
            }
        }
    }

    /**
     * Adds a private channel eventListener to the selected private channel
     */
    private async addPrivateChannelEventListener(): Promise<void> {
        const eventType = isPrivateChannelEventTypes(this.privateChannelEventTypeSelector.value)
            ? this.privateChannelEventTypeSelector.value
            : null;
        this.log(
            `Adding private channel event listener of type ${this.privateChannelEventTypeSelector.value} to channel with id ${this.selectedPrivateChannel.value}`,
        );

        const privateChannel = this.currentChannels[this.selectedPrivateChannel.value] as FDC3PrivateChannel;
        if (privateChannel != null) {
            try {
                await privateChannel.addEventListener(eventType, (...args) => this.log('Received Event:', args));
                this.log(`Private channel event listener has been added`);
            } catch (err) {
                this.log(`${err}`);
            }
        }
    }

    /**
     * Clears the log
     */
    private clearLog(): void {
        this.logs = [];
    }

    /**
     * Logs messages to the console and stores them in the application's log state.
     * This method supports logging both simple messages and objects.
     * @param {string} message - The message to log.
     * @param {any} [object] - An optional object to log alongside the message.
     */
    private async log(message: string, object?: any): Promise<void> {
        const printMessage = object ? `${message}: ${JSON.stringify(object)}` : message;
        console.log(`${this.appIdentifier?.appId}: ${printMessage}`);
        this.logs = [...this.logs, printMessage];
    }
}
