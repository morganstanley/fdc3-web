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
import type { ListComponentChange } from '../contracts.js';

/**
 * `ListComponent` creates a list display, optionally with checkboxes.
 * @property items: It takes an array of strings as `items` to display as list items.
 * @property selectedItems: Selected items can be tracked in `selectedItems`.
 * @property checkbox: The `checkbox` flag controls the display of checkboxes alongside list items.
 */
@customElement('list-component')
export class ListComponent extends LitElement {
    @property()
    public items!: string[];

    @property()
    public selectedItems: string[] = [];

    @property()
    public checkbox!: boolean;

    protected override render(): TemplateResult {
        return html`
            <ul class="list-group w-100">
                ${this.items?.map(
                    item => html`
                        <li class="list-group-item">
                            ${this.checkbox
                                ? html`<input
                                      type="checkbox"
                                      class="form-check-input me-3"
                                      ?checked=${this.selectedItems.includes(item)}
                                      @change=${(e: Event) => this.change(e, item)}
                                  />`
                                : ''}
                            ${item}
                        </li>
                    `,
                )}
            </ul>
        `;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }

    private change(event: Event, item: string): void {
        const checkbox = event.target as HTMLInputElement;
        const changeEvent = new CustomEvent<ListComponentChange>('change', {
            detail: { item, selected: checkbox.checked },
        });
        this.dispatchEvent(changeEvent);
    }
}
