/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { html, LitElement, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `HeaderComponent` creates a header web component, optionally with logo.
 * @property heading: A string property to set the text title in the header. This is the main text displayed in the header.
 * @property logoSrc: A string property for the source URL of the logo image. If provided, the logo will be displayed
 */

@customElement('app-header')
export class HeaderComponent extends LitElement {
    @property()
    public heading!: string;

    @property()
    public logoSrc!: string;

    protected override render(): TemplateResult {
        return html`
            <header class="navbar shadow-sm">
                ${this.logoSrc ? html`<img src="${this.logoSrc}" height="40" width="40" />` : ''}
                <span class="p-2">${this.heading}</span>
            </header>
        `;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }
}
