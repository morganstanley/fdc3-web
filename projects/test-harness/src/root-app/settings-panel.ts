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
import '../utils/select-component.js';
import { AppDirectoryApplication } from '@morgan-stanley/fdc3-web';
import { html, LitElement, TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { AddApp } from '../contracts.js';
import type { SelectComponent } from '../utils/select-component.js';

/**
 * `SettingsPanel` is a LitElement component responsible for rendering and managing the settings interface of the application. It allows users to select applications,
 * configure intents to support, and intents to raise.
 * The component utilizes the Lit framework for creating web components and manages its state using the `@state` decorator to reactively update the UI based on changes.
 *
 * @property applications: AppDirectoryApplication[] - Applications and intents available for selection and configuration.
 */

@customElement('settings-panel')
export class SettingsPanel extends LitElement {
    @property()
    private applications: AppDirectoryApplication[] = [];

    @query('select-component')
    private appSelector!: SelectComponent;

    protected override render(): TemplateResult {
        return html`
            <div id="fth-settings-cnt" class="border-start border-secondary-subtle border-3 overflow-auto h-100">
                <app-header .heading=${'Settings'} class="bg-body-secondary d-flex h6"></app-header>
                <div class="vstack gap-5 flex-grow-1 p-4">
                    ${this.renderAppSelector()} ${this.renderOpenInWindowSwitch()} ${this.renderAddAppButton()}
                </div>
            </div>
        `;
    }

    /**
     * Renders the application selector dropdown. It uses the `select-component` web component, passing the list of application names as items.
     * @returns {TemplateResult} The rendered application selector component.
     */
    private renderAppSelector(): TemplateResult {
        return html`
            <div>
                <label class="form-label">Select App:</label>
                <select-component .items=${this.applications.map(app => app.appId)}></select-component>
            </div>
        `;
    }

    private renderOpenInWindowSwitch(): TemplateResult {
        return html`
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="openInWindow" />
                <label class="form-check-label" for="openInWindow">Open In New Window</label>
            </div>
        `;
    }

    private renderAddAppButton(): TemplateResult {
        return html` <button class="btn btn-secondary bg-primary-subtle" @click=${this.onAddApp}>Add App</button> `;
    }

    /**
     * Handles the "Add App" button click event. It finds the selected application from the configuration based on the value of the app selector and prepares
     * the application information for further processing.
     */
    private async onAddApp(): Promise<void> {
        const selectedApp = this.applications?.find(app => app.appId === this.appSelector.value);
        if (!selectedApp) return;
        this.dispatchEvent(
            new CustomEvent<AddApp>('addApp', {
                detail: {
                    application: selectedApp,
                },
            }),
        );
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }
}
