/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { DesktopAgent } from '@finos/fdc3';
import { getAgent } from '@morgan-stanley/fdc3-web';
import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

const methods = [
    'getAgent',
    'getInfo',
    'getAppMetadata',
    'findInstances',
    'open',
    'close',
    'findIntent',
    'findIntentsByContext',
    'raiseIntent',
    'raiseIntentForContext',
    'addIntentListener',
    'addIntentListenerWithContext',
    'addContextListener',
    'addEventListener',
    'broadcast',
    'getUserChannels',
    'getCurrentChannel',
    'joinUserChannel',
    'leaveCurrentChannel',
    'getOrCreateChannel',
    'createPrivateChannel',
    'getCurrentContext',
    'getCurrentContextWithMetadata',
    'clearContext',
    'disconnect',
    'unsubscribe',
    'getResult',
    'getResultMetadata',
];

/** Manual API explorer. References retain real Channels, Listeners and IntentResolutions in this app. */
@customElement('api-explorer')
export class ApiExplorer extends LitElement {
    @property({ attribute: false }) public agent?: DesktopAgent;
    @state() private result = '';
    @state() private events: { listener: string; args: unknown[] }[] = [];
    @state() private busy = false;
    private objects = new Map<string, object>();

    protected override createRenderRoot(): HTMLElement {
        return this;
    }

    protected override render(): TemplateResult {
        return html`<details class="border p-2" automation-id="fth-api-explorer" ?data-ready=${!!this.agent}>
            <summary automation-id="fth-api-toggle">FDC3 API explorer</summary>
            <p>
                Arguments are a JSON array. Use {"$ref":"name"} for a saved object, {"$undefined":true} for undefined,
                or {"$handler":"name","returns":value} to record callbacks.
            </p>
            <label>Target <input automation-id="fth-api-target" value="agent" /></label>
            <label
                >Method
                <select automation-id="fth-api-method">
                    ${methods.map(method => html`<option>${method}</option>`)}
                </select></label
            >
            <label>Save result as <input automation-id="fth-api-save" value="result" /></label>
            <label class="d-block">Arguments <textarea class="w-100" automation-id="fth-api-args">[]</textarea></label>
            <button automation-id="fth-api-run" ?disabled=${this.busy} @click=${this.run}>Run</button>
            <pre automation-id="fth-api-result" aria-live="polite">${this.result}</pre>
            <pre automation-id="fth-api-events" aria-live="polite">${JSON.stringify(this.events)}</pre>
        </details>`;
    }

    private input(id: string): string {
        return this.querySelector<HTMLInputElement>(`[automation-id="fth-api-${id}"]`)!.value;
    }

    private decode(value: any): any {
        if (value == null || typeof value !== 'object') return value;
        if ('$undefined' in value) return undefined;
        if ('$ref' in value) {
            const object = this.objects.get(value.$ref);
            if (!object) throw new Error(`Unknown saved object: ${value.$ref}`);
            return object;
        }
        if ('$handler' in value)
            return (...args: unknown[]) => {
                this.events = [...this.events, { listener: value.$handler, args }];
                if ('rejects' in value) return Promise.reject(new Error(value.rejects));
                if ('returns' in value) return Promise.resolve(this.decode(value.returns));
                return undefined;
            };
        if (Array.isArray(value)) return value.map(item => this.decode(item));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.decode(item)]));
    }

    // Do not JSON.stringify implementation internals (channels contain cyclic messaging state).
    private encode(value: any, name: string): any {
        if (value === undefined) return { $undefined: true };
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map((item, index) => this.encode(item, `${name}.${index}`));
        if (
            typeof value.broadcast === 'function' ||
            typeof value.unsubscribe === 'function' ||
            typeof value.getResult === 'function'
        ) {
            this.objects.set(name, value);
            const fields = ['id', 'type', 'displayMetadata', 'intent', 'source', 'version'];
            return {
                $ref: name,
                ...Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]])),
            };
        }
        return value;
    }

    private async run(): Promise<void> {
        this.busy = true;
        this.result = '';
        try {
            const method = this.input('method');
            const name = this.input('save');
            const args = this.decode(JSON.parse(this.input('args')));
            if (!Array.isArray(args)) throw new Error('Arguments must be a JSON array');
            const target = this.input('target') === 'agent' ? this.agent : this.objects.get(this.input('target'));
            let value: unknown;
            if (method === 'getAgent') {
                const connected = await getAgent(...(args as Parameters<typeof getAgent>));
                value = { sameAgent: connected === this.agent, windowFdc3Set: window.fdc3 === connected };
                this.agent = connected;
            } else {
                value = await (target as any)[method](...args);
            }
            this.result = JSON.stringify({ ok: true, value: this.encode(value, name) });
        } catch (error) {
            this.result = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
        } finally {
            this.busy = false;
        }
    }
}
