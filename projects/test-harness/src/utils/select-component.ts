/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { html, LitElement, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

/**
 * Creates a select web component element populated with options based on the provided items.
 *
 * @property {string[]} items - An array of strings where each string represents an option in the select.
 * The value of the selected option can be accessed through the `value` getter.
 */

@customElement('select-component')
export class SelectComponent extends LitElement {
    @property()
    public items: string[] | undefined;

    @state()
    private itemsToDisplay: string[] = [];

    @query('select')
    private selectElement!: HTMLSelectElement;

    public get value(): string {
        return this.selectElement.value;
    }

    public override updated(changedProperties: PropertyValues | Map<PropertyKey, unknown>): void {
        super.updated(changedProperties);

        if (changedProperties.has('items')) {
            if (Array.isArray(this.items)) {
                this.itemsToDisplay = [...this.items];
            }
        }
    }

    protected override render(): TemplateResult {
        return html`
            <select class="form-select">
                ${this.itemsToDisplay.map(item => html`<option>${item}</option>`)}
            </select>
        `;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }
}
