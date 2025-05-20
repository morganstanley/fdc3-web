/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppMetadata, Context, DesktopAgent, Icon, Intent } from '@finos/fdc3';
import { OpenError, ResolveError } from '@finos/fdc3';
import {
    FullyQualifiedAppIdentifier,
    IAppResolver,
    ResolveForContextPayload,
    ResolveForContextResponse,
    ResolveForIntentPayload,
} from '@morgan-stanley/fdc3-web';
import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { ContextPopupState, IntentPopupState } from './contracts.js';

@customElement('ms-app-resolver')
export class AppResolverComponent extends LitElement implements IAppResolver {
    public static override styles = css`
        .ms-app-resolver-container {
            width: var(--ms-app-resolver-container-width, 100%);
            height: var(--ms-app-resolver-container-height, 100%);
            position: var(--ms-app-resolver-container-position, fixed);
            bottom: var(--ms-app-resolver-container-bottom, 0px);
            right: var(--ms-app-resolver-container-right, 0px);
            display: var(--ms-app-resolver-container-display-type, flex);
        }

        .ms-app-resolver-popup {
            box-shadow: var(
                --ms-app-resolver-popup-box-shadow,
                0 0px 8px 0 rgba(0, 0, 0, 0.2),
                0 6px 20px 0 rgba(0, 0, 0, 0.19)
            );
            border-radius: var(--ms-app-resolver-popup-border-radius, 20px 20px 20px 20px);
            margin: var(--ms-app-resolver-popup-margin, auto);
            max-width: var(--ms-app-resolver-popup-max-width, 500px);
            max-height: var(--ms-app-resolver-popup-max-height, 470px);
            min-width: var(--ms-app-resolver-popup-min-width, 500px);
        }

        .ms-app-resolver-popup-header {
            background-color: var(--ms-app-resolver-popup-header-bg-color, #c1c1c1);
            border-radius: var(--ms-app-resolver-popup-header-border-radius, 20px 20px 0px 0px);
            display: var(--ms-app-resolver-popup-header-display-type, flex);
            justify-content: var(--ms-app-resolver-popup-header-justify-content, space-between);
            max-height: var(--ms-app-resolver-popup-header-max-height, 40px);
            padding-left: var(--ms-app-resolver-popup-header-padding-left, 12px);
            align-items: var(--ms-app-resolver-popup-header-align-items, center);
        }

        .ms-app-resolver-popup-title {
            font-weight: var(--ms-app-resolver-popup-title-font-weight, 500);
            font-size: var(--ms-app-resolver-popup-title-font-size, large);
        }

        .ms-app-resolver-popup-dismiss-btn {
            border-style: var(--ms-app-resolver-popup-dismiss-btn-border-style, none);
            margin-right: var(--ms-app-resolver-popup-dismiss-btn-margin-right, 12px);
        }
        .ms-app-resolver-popup-dismiss-btn:hover {
            cursor: var(--ms-app-resolver-popup-dismiss-btn-hover-cursor, pointer);
        }

        .ms-app-resolver-popup-body {
            overflow: var(--ms-app-resolver-popup-body-overflow-type, auto);
            background-color: var(--ms-app-resolver-popup-body-bg-color, white);
            max-height: var(--ms-app-resolver-popup-body-max-height, 400px);
            border-radius: var(--ms-app-resolver-popup-body-border-radius, 0px 0px 20px 20px);
        }

        .ms-app-resolver-popup-apps-container-title {
            border-style: var(--ms-app-resolver-popup-apps-container-title-border-style, solid);
            border-width: var(--ms-app-resolver-popup-apps-container-title-border-width, 0px 0px 1px 0px);
            border-color: var(--ms-app-resolver-popup-apps-container-title-border-color, #c1c1c1);
            font-weight: var(--ms-app-resolver-popup-apps-container-title-font-weight, normal);
            padding-left: var(--ms-app-resolver-popup-apps-container-title-padding-left, 12px);
            margin: var(--ms-app-resolver-popup-apps-container-title-margin, 8px 0px 8px);
        }

        .ms-app-resolver-app-display-btn {
            border-style: var(--ms-app-resolver-app-display-btn-border-style, none);
            background-color: var(--ms-app-resolver-app-display-btn-bg-color, white);
            border-radius: var(--ms-app-resolver-app-display-btn-border-radius, 10px);
            display: var(--ms-app-resolver-app-display-btn-display-type, flex);
            align-items: var(--ms-app-resolver-app-display-btn-align-items, center);
            width: var(--ms-app-resolver-app-display-btn-width, 100%);
        }
        .ms-app-resolver-app-display-btn:hover {
            background-color: var(--ms-app-resolver-app-display-btn-hover-bg-color, rgb(240, 240, 240));
            cursor: var(--ms-app-resolver-app-display-btn-cursor, pointer);
        }

        .ms-app-resolver-app-display-app-title {
            font-weight: var(--ms-app-resolver-app-display-app-title-font-weight, 100);
        }

        .ms-app-resolver-app-display-instance-metadata {
            padding-left: var(--ms-app-resolver-app-display-instance-metadata-padding-left, 20px);
        }

        .ms-app-resolver-app-icon {
            width: var(--ms-app-resolver-app-icon-width, 20px);
            height: var(--ms-app-resolver-app-icon-height, 20px);
            padding-right: var(--ms-app-resolver-app-icon-padding-right, 4px);
        }

        .ms-app-resolver-popup-intent-title-btn {
            border-style: var(--ms-app-resolver-popup-intent-title-btn-border-style, none);
            width: var(--ms-app-resolver-popup-intent-title-btn-width, 100%);
            cursor: var(--ms-app-resolver-popup-intent-title-btn-cursor, pointer);
            display: var(--ms-app-resolver-popup-intent-title-btn-display-type, flex);
            justify-content: var(--ms-app-resolver-popup-intent-title-btn-justify-content, space-between);
            align-items: var(--ms-app-resolver-popup-intent-title-btn-align-items, flex-end);
        }

        .ms-app-resolver-popup-intent-title {
            margin: var(--ms-app-resolver-popup-intent-title-margin, 0px);
            padding: var(--ms-app-resolver-popup-intent-title-padding, 8px 12px);
            font-weight: var(--ms-app-resolver-popup-intent-title-font-weight, 500);
            font-size: var(--ms-app-resolver-popup-title-font-size, medium);
        }

        .ms-app-resolver-popup-intent-title-chevron {
            padding: var(--ms-app-resolver-popup-intent-title-chevron-padding, 0px 4px 4px);
        }

        .ms-app-resolver-popup-empty-message {
            padding: var(--ms-app-resolver-popup-empty-message-padding, 16px 0px);
            text-align: var(--ms-app-resolver-popup-empty-message-text-align, center);
        }
    `;

    @state()
    private _forIntentPopupState: IntentPopupState | null;

    public get forIntentPopupState(): IntentPopupState | null {
        return this._forIntentPopupState;
    }

    @state()
    private _forContextPopupState: ContextPopupState | null;

    public get forContextPopupState(): ContextPopupState | null {
        return this._forContextPopupState;
    }

    @state()
    private _passedContext: Context | undefined;

    public get passedContext(): Context | undefined {
        return this._passedContext;
    }

    @state()
    private selectedAppCallback: ((app: AppMetadata, intent: Intent) => void) | undefined;

    constructor(
        private readonly desktopAgentPromise: Promise<DesktopAgent>,
        private readonly document: Document,
    ) {
        super();
        this._forIntentPopupState = null;
        this._forContextPopupState = null;
    }

    public async resolveAppForIntent(payload: ResolveForIntentPayload): Promise<FullyQualifiedAppIdentifier> {
        const agent = await this.desktopAgentPromise;

        const appIntent = payload.appIntent ?? (await agent.findIntent(payload.intent, payload.context));
        //filter to only apps with same appId as that of appIdentifier passed in payload, if one is given
        let apps: AppMetadata[] = appIntent.apps;
        if (payload.appIdentifier != null) {
            apps = apps.filter(app => app.appId === payload.appIdentifier?.appId);
        }
        //returns appIdentifier immediately if there is only one possible app instance
        if (apps.length === 1 && apps[0].instanceId != null) {
            return { appId: apps[0].appId, instanceId: apps[0].instanceId };
        }
        if (apps.length === 0) {
            return Promise.reject(OpenError.AppNotFound);
        }
        //active app instances that can handle given intent
        const activeInstances = apps.filter(app => app.instanceId != null);
        //apps that can handle given intent
        const inactiveApps = apps.filter(app => app.instanceId == null);
        this._forIntentPopupState = { name: appIntent.intent.name, activeInstances, inactiveApps };
        this.togglePopup();
        //return Promise which will either resolve to appIntent containing FullyQualifiedAppIdentifier, or reject with error message
        return (await this.getSelectedApp(payload.context)).app;
    }

    public async resolveAppForContext(payload: ResolveForContextPayload): Promise<ResolveForContextResponse> {
        const agent = await this.desktopAgentPromise;

        const appIntents = payload.appIntents ?? (await agent.findIntentsByContext(payload.context));
        const tempState: Record<string, { activeInstances: AppMetadata[]; inactiveApps: AppMetadata[] }> = {};
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
            //collects all apps and app instances that can handle each intent
            .forEach(appIntent => {
                //active app instances that can handle given intent
                const activeInstances = appIntent.apps.filter(app => app.instanceId != null);
                //apps that can handle given intent
                const inactiveApps = appIntent.apps.filter(app => app.instanceId == null);
                tempState[appIntent.intent.name] = { activeInstances, inactiveApps };
            });

        if (Object.keys(tempState).length === 0) {
            return Promise.reject(ResolveError.NoAppsFound);
        }

        this._passedContext = payload.context;
        this._forContextPopupState = tempState;
        this.togglePopup();
        return this.getSelectedApp(payload.context);
    }

    /**
     * @returns Promise containing FullyQualifiedAppIdentifier for app or app instance selected by user from popup
     */
    private async getSelectedApp(context: Context): Promise<ResolveForContextResponse> {
        const agent = await this.desktopAgentPromise;

        return new Promise((resolve, reject) => {
            this.selectedAppCallback = async (app, intent) => {
                if (app.appId == '') {
                    this.resetPopup();
                    reject(ResolveError.UserCancelled);
                }
                if (app.instanceId == null) {
                    try {
                        const appIdentifier = await agent.open({ appId: app.appId }, context);
                        this.resetPopup();
                        if (appIdentifier.instanceId != null) {
                            resolve({
                                intent,
                                app: { appId: appIdentifier.appId, instanceId: appIdentifier.instanceId },
                            });
                        } else {
                            //if instanceId is still null, error has occured, but this should be caught within open()
                            reject(OpenError.AppNotFound);
                        }
                    } catch (err) {
                        this.resetPopup();
                        reject(err);
                    }
                } else {
                    this.resetPopup();
                    resolve({
                        intent,
                        app: { appId: app.appId, instanceId: app.instanceId },
                    });
                }
            };
        });
    }

    private resetPopup(): void {
        this._forIntentPopupState = null;
        this._forContextPopupState = null;
        this.togglePopup();
    }

    /**
     * Passes app or app instance selected by user from popup to callback which sets up Promise
     */
    public async selectApp(app: AppMetadata, intent: Intent): Promise<void> {
        if (this.selectedAppCallback != null) {
            this.selectedAppCallback(app, intent);
        }
    }

    /**
     * Closes app resolver popup when user clicks dismiss button
     */
    public closePopup(): void {
        this._forIntentPopupState = null;
        if (this.selectedAppCallback != null) {
            this.selectedAppCallback({ appId: '' }, '');
        }
    }

    /**
     * Adds and removes app resolver popup from document body as required
     */
    private togglePopup(): void {
        if (this.forIntentPopupState == null && this.forContextPopupState == null) {
            this.document.querySelector('ms-app-resolver')?.remove();
        } else {
            this.document.querySelector('body')?.appendChild(this);
        }
    }

    /**
     * Swap between showing and hiding the apps which can resolve a given intent
     */
    public toggleIntentContainer(intent: string): void {
        const intentContainer = this.document
            .querySelector('ms-app-resolver')
            ?.shadowRoot?.getElementById(`${intent}-container`);
        const chevronContainer = this.document
            .querySelector('ms-app-resolver')
            ?.shadowRoot?.getElementById(`${intent}-chevron`);
        if (intentContainer?.style.display === 'none') {
            intentContainer.style.display = 'block';
            if (chevronContainer != null) {
                chevronContainer.innerHTML = `<svg height="15" width="15">
                <path d="M0 8.5 L7.5 0.75 L15 8.5" style="fill:none;stroke:black;stroke-width:1.5"/>
                v
              </svg>`;
            }
        } else if (intentContainer != null) {
            intentContainer.style.display = 'none';
            if (chevronContainer != null) {
                chevronContainer.innerHTML = `<svg height="15" width="15">
                <path d="M0 0.75 L7.5 8.5 L15 0.75" style="fill:none;stroke:black;stroke-width:1.5"/>
                v
            </svg>`;
            }
        }
    }

    private renderPopup(): TemplateResult {
        return html`<div class="ms-app-resolver-popup">
            <div class="ms-app-resolver-popup-header">
                <h1 class="ms-app-resolver-popup-title">
                    ${when(this.forIntentPopupState != null || this.forContextPopupState != null, () => {
                        if (this.forIntentPopupState != null) {
                            return this.forIntentPopupState?.name;
                        }
                        return this.passedContext?.name ?? 'Resolve For Context';
                    })}
                </h1>
                <div class="ms-app-resolver-popup-dismiss-btn" @click=${() => this.closePopup()}>
                    <svg height="15" width="15">
                        <path
                            d="M0 0 L15 15 M0 15 L15 0"
                            style="fill:none;stroke:${document.documentElement.getAttribute('data-bs-theme') === 'dark'
                                ? 'white'
                                : 'black'};stroke-width:1.5"
                        />
                        Close
                    </svg>
                </div>
            </div>
            <div class="ms-app-resolver-popup-body">
                ${when(this.forIntentPopupState != null || this.forContextPopupState != null, () => {
                    if (this.forIntentPopupState != null) {
                        return renderForIntentPopup(
                            this,
                            this.forIntentPopupState.activeInstances,
                            this.forIntentPopupState.inactiveApps,
                            this.forIntentPopupState.name,
                        );
                    }
                    return renderForContextPopup(this);
                })}
            </div>
        </div>`;
    }

    protected override render(): TemplateResult {
        return html`<div class="ms-app-resolver-container">
            ${when(this.forIntentPopupState != null || this.forContextPopupState != null, () => this.renderPopup())}
        </div>`;
    }
}

function renderForIntentPopup(
    component: AppResolverComponent,
    activeInstances: AppMetadata[],
    inactiveApps: AppMetadata[],
    intent: Intent,
): TemplateResult {
    return html`${when(
        activeInstances != null && activeInstances.length > 0,
        () =>
            html`<div class="ms-app-resolver-popup-apps-container">
                <h3 class="ms-app-resolver-popup-apps-container-title">Active Instances</h3>
                <div class="ms-app-resolver-popup-active-instances">
                    ${activeInstances.map(app => renderApp(app, intent, component))}
                </div>
            </div>`,
    )}
    ${when(
        inactiveApps != null && inactiveApps.length > 0,
        () =>
            html`<div class="ms-app-resolver-popup-apps-container">
                <h3 class="ms-app-resolver-popup-apps-container-title">Open New Instances</h3>
                <div class="ms-app-resolver-popup-open-new-instances">
                    ${inactiveApps.map(app => renderApp(app, intent, component))}
                </div>
            </div>`,
    )}`;
}

function renderForContextPopup(component: AppResolverComponent): TemplateResult {
    if (component.forContextPopupState != null) {
        return html`${Object.entries(component.forContextPopupState).map(
            intent =>
                html`<div class="ms-app-resolver-popup-intent-container">
                    <button
                        class="ms-app-resolver-popup-intent-title-btn"
                        type="button"
                        @click=${() => component.toggleIntentContainer(intent[0])}
                    >
                        <h2 class="ms-app-resolver-popup-intent-title">${intent[0]}</h2>
                        <div class="ms-app-resolver-popup-intent-title-chevron" id="${intent[0]}-chevron">
                            <svg height="15" width="15">
                                <path d="M0 8.5 L7.5 0.75 L15 8.5" style="fill:none;stroke:black;stroke-width:1.5" />
                                v
                            </svg>
                        </div>
                    </button>
                    <div class="ms-app-resolver-popup-intent-apps-container" id="${intent[0]}-container">
                        ${renderForIntentPopup(component, intent[1].activeInstances, intent[1].inactiveApps, intent[0])}
                    </div>
                </div>`,
        )}`;
    }
    return html``;
}

function renderApp(app: AppMetadata, intent: Intent, component: AppResolverComponent): TemplateResult {
    return html`<div class="ms-app-display-container">
        <button class="ms-app-resolver-app-display-btn" type="button" @click=${() => component.selectApp(app, intent)}>
            <span class="ms-app-resolver-app-icon-container"
                >${renderAppIcon(app.icons?.find(icon => icon != null))}</span
            >
            <span class="ms-app-resolver-app-display-app-title">${app.title ?? app.name ?? app.appId}</span>
            ${when(app.instanceId != null, () =>
                Object.values(app.instanceMetadata ?? {}).map((metadata: unknown) => renderInstanceMetadata(metadata)),
            )}
        </button>
    </div>`;
}

function renderInstanceMetadata(metadata: any): TemplateResult {
    return html`<span class="ms-app-resolver-app-display-instance-metadata">${metadata}</span> `;
}

function renderAppIcon(icon?: Icon): TemplateResult {
    if (icon != null) {
        return html`<img src="${icon.src}" class="ms-app-resolver-app-icon" />`;
    }
    return html`<svg class="ms-app-resolver-app-icon">
        <circle cx="10" cy="10" r="5" stroke="black" stroke-width="0.1" fill="black" />
        o
    </svg>`;
}
