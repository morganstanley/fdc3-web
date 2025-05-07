/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { WebAppDetails } from '@morgan-stanley/fdc3-web';
import { html, LitElement, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';

/**
 * `AppContainer` is a custom web component that wraps an application inside an iframe.
 * It is responsible for rendering the application frame, handling its selection and adding nested application
 */
@customElement('app-container')
export class AppContainer extends LitElement {
    @property()
    public details: WebAppDetails | undefined;

    /**
     * Renders the container's HTML structure, including the iframe that will contain the application.
     * @returns A TemplateResult that represents the component's HTML structure.
     */
    protected render(): TemplateResult {
        return html`
            <div class="border border-3 h-100 position-relative ${this.getOriginClass()}">
                <iframe
                    ${ref(element => this.handleIframe(element as HTMLIFrameElement))}
                    src=${this.details?.url}
                    class="w-100 h-100 border-0"
                ></iframe>
            </div>
        `;
    }

    /**
     * Wait for the iframe instance and then use a MutationObserver to detect when the iframe's contentWindow is available.
     * @param element
     */
    private handleIframe(element?: HTMLIFrameElement): void {
        if (element != null) {
            const observer = new MutationObserver(() => {
                if (element.contentWindow) {
                    this.dispatchEvent(
                        new CustomEvent<{ window: WindowProxy; app?: WebAppDetails }>('onIframeCreated', {
                            detail: { window: element.contentWindow, app: this.details },
                        }),
                    );
                    observer.disconnect();
                }
            });

            observer.observe(element, { attributes: true, attributeFilter: ['src'] });
        }
    }

    /**
     * Determines the CSS class to apply to the iframe based on the application's domain.
     * This helps visually distinguish between same-origin and cross-origin applications.
     * @returns A string representing the CSS class to be applied.
     */
    private getOriginClass(): string {
        const detailsUrl = this.details != null ? new URL(this.details.url) : undefined;

        return detailsUrl?.host === window.location.host
            ? 'fth-app-same-origin border-primary-subtle'
            : 'fth-app-cross-origin border-warning-subtle';
    }

    /**
     * Constructs the URL for the iframe's `src` attribute based on the application's information.
     * This URL is used to load the embedded application within the iframe.
     * @returns A string representing the URL to load the embedded application.
     */

    protected createRenderRoot(): HTMLElement {
        return this;
    }
}
