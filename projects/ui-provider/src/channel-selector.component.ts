/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { type Channel, type DesktopAgent } from '@finos/fdc3';
import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ClassInfo, classMap } from 'lit/directives/class-map.js';
import { when } from 'lit/directives/when.js';

@customElement('ms-channel-selector')
export class ChannelSelectorComponent extends LitElement {
    public static override styles = css`
        @keyframes show-channel-name {
            from {
                max-height: var(--ms-channel-btn-diameter, 20px);
                max-width: var(--ms-channel-btn-diameter, 20px);
                font-size: var(--ms-channel-btn-font-size, 0px);
                box-shadow: var(
                    --ms-channel-btn-box-shadow,
                    0 0px 8px 0 rgba(0, 0, 0, 0.2),
                    0 6px 20px 0 rgba(0, 0, 0, 0.19)
                );
            }
            to {
                font-size: var(--ms-channel-btn-hover-font-size, small);
                max-height: var(--ms-channel-btn-hover-max-diameter);
                max-width: var(--ms-channel-btn-hover-max-diameter);
                margin-top: var(--ms-channel-btn-hover-margin-top, 2px);
            }
        }

        .ms-channel-selector-container {
            display: var(--ms-channel-selector-display-type, flex);
            flex-direction: var(--ms-channel-selector-flex-direction, column);
            flex-wrap: var(--ms-channel-selector-flex-wrap, nowrap);
            position: var(--ms-channel-selector-position-type, fixed);
            right: var(--ms-channel-selector-right-gap, 33px);
            bottom: var(--ms-channel-selector-bottom-gap, 15px);
            align-items: var(--ms-channel-selector-align-items, center);
            min-width: var(--ms-channel-selector-min-width, 75px);
        }

        .ms-channel-indicator-container {
            height: var(--ms-channel-indicator-container-height, 50px);
            width: var(--ms-channel-indicator-container-width, 80px);
            display: var(--ms-channel-indicator-container-display-type, flex);
            justify-content: var(--ms-channel-indicator-container-justify-content, center);
        }

        .ms-channel-indicator {
            background-color: var(--ms-channel-indicator-bg-color, white);
            border-radius: var(--ms-channel-indicator-border-radius, 50%);
            box-shadow: var(
                --ms-channel-indicator-box-shadow,
                0 0px 8px 0 rgba(0, 0, 0, 0.2),
                0 6px 20px 0 rgba(0, 0, 0, 0.19)
            );
            border-style: var(--ms-channel-indicator-border-style, solid);
            border-width: var(--ms-channel-indicator-border-width, 10px);
            border-color: var(--ms-default-channel-indicator-border-color, white);
            height: var(--ms-channel-indicator-diameter, 40px);
            width: var(--ms-channel-indicator-diameter, 40px);
            margin: var(--ms-channel-indicator-margin, 4px);
            transition: var(--ms-channel-indicator-transition-speed, 0.3s);
            opacity: var(--ms-channel-indicator-opacity, 0.5);
        }
        .ms-channel-indicator:hover {
            box-shadow: var(
                --ms-channel-indicator-hover-box-shadow,
                0px 6px 16px 6px rgba(0, 0, 0, 0.24),
                0 17px 50px 0 rgba(0, 0, 0, 0.19)
            );
            transition: var(--ms-channel-indicator-transition-speed, 0.3s);
            cursor: var(--ms-channel-indicator-hover-cursor, pointer);
        }
        .ms-channel-indicator:active {
            box-shadow: var(--ms-channel-indicator-active-box-shadow, none);
        }

        .ms-channel-indicator-selected {
            opacity: var(--ms-channel-indicator-selected-opacity, 1) !important;
        }

        .ms-all-channel-btns-container {
            display: var(--ms-all-channel-btns-container-display-type, flex);
            flex-direction: var(--ms-all-channel-btns-container-flex-direction, column-reverse);
            flex-wrap: var(--ms-all-channel-btns-container-flex-wrap, nowrap);
            align-items: var(--ms-all-channel-btns-container-align-items, center);
        }

        .ms-channel-btn-container {
            height: var(--ms-channel-btn-container-height, 36px);
            width: var(--ms-channel-btn-container-width, 80px);
            display: var(--ms-channel-btn-container-display-type, flex);
            justify-content: var(--ms-channel-btn-container-justify-content, center);
        }

        .ms-channel-btn {
            border-radius: var(--ms-channel-btn-border-radius, 50%);
            box-shadow: var(
                --ms-channel-btn-box-shadow,
                0 0px 8px 0 rgba(0, 0, 0, 0.2),
                0 6px 20px 0 rgba(0, 0, 0, 0.19)
            );
            border-style: var(--ms-channel-btn-border-style, solid);
            border-radius: var(--ms-channel-btn-border-width, 10px);
            min-height: var(--ms-channel-btn-diameter, 20px);
            min-width: var(--ms-channel-btn-diameter, 20px);
            max-height: var(--ms-channel-btn-diameter, 20px);
            max-width: var(--ms-channel-btn-diameter, 20px);
            transition: var(--ms-channel-btn-transition-speed, 0.3s);
            font-size: var(--ms-channel-btn-font-size, 0px);
            padding: var(--ms-channel-btn-padding, 4px);
            margin-bottom: var(--ms-channel-btn-margin-bottom, 8px);
            margin-top: var(--ms-channel-btn-margin-top, 8px);
            color: var(--ms-channel-btn-text-color, black);
        }
        .ms-channel-btn:hover {
            animation-name: var(--ms-channel-btn-animation-name, show-channel-name);
            animation-duration: var(--ms-channel-btn-animation-duration, 0.3s);
            animation-fill-mode: var(--ms-channel-btn-animation-fill-mode, forwards);
            box-shadow: var(
                --ms-channel-btn-hover-box-shadow,
                0px 6px 12px 4px rgba(0, 0, 0, 0.24),
                0 17px 50px 0 rgba(0, 0, 0, 0.19)
            );
            cursor: var(--ms-channel-btn-hover-cursor, pointer);
            background-color: var(--ms-channel-btn-hover-bg-color, white);
        }
        .ms-channel-btn:active {
            box-shadow: var(--ms-channel-btn-active-box-shadow, none);
            font-size: var(--ms-channel-btn-active-font-size, small);
        }
    `;

    @state()
    private currentChannel: Channel | null;

    @state()
    private _hideChannelBtns: boolean;

    public get hideChannelBtns(): boolean {
        return this._hideChannelBtns;
    }

    @state()
    private _channelBorderColor: string;

    public get channelBorderColor(): string {
        return this._channelBorderColor;
    }

    @state()
    private _userChannels: Channel[];

    public get userChannels(): Channel[] {
        return this._userChannels;
    }

    private _desktopAgent: DesktopAgent | undefined;

    public get desktopAgent(): DesktopAgent | undefined {
        return this._desktopAgent;
    }

    public set desktopAgent(value: DesktopAgent) {
        if (this._desktopAgent == null) {
            this._desktopAgent = value;

            this.init(value);
        } else if (value !== this._desktopAgent) {
            throw new Error(
                `Desktop agent has already been set on channel selector and cannot be set again with a different value`,
            );
        }
    }

    constructor() {
        super();
        this.currentChannel = null;
        this._hideChannelBtns = true;
        this._channelBorderColor = '';
        this._userChannels = [];
    }

    private async init(agent: DesktopAgent): Promise<void> {
        this.getCurrentChannel(agent);

        agent.addEventListener('userChannelChanged', () => {
            this.getCurrentChannel(agent);
        });

        const channels = await agent.getUserChannels();

        this._userChannels = channels;
    }

    public async toggleChannelSelector(): Promise<void> {
        this._hideChannelBtns = !this.hideChannelBtns;
        if (!this.hideChannelBtns) {
            this._userChannels = await this.agent.getUserChannels();
        }
    }

    public async joinChannel(channelId: string): Promise<void> {
        if (this.currentChannel?.id === channelId) {
            await this.agent.leaveCurrentChannel();
            this._channelBorderColor = '';
        } else {
            await this.agent.joinUserChannel(channelId);
        }
        this._hideChannelBtns = true;
    }

    /**
     * A getter to return a non null desktop agent
     * If desktop agent has not been set yet an error is thrown
     */
    private get agent(): DesktopAgent {
        const agent = this._desktopAgent;

        if (agent == null) {
            throw new Error(`Desktop agent has not been set`);
        }

        return agent;
    }

    private async getCurrentChannel(agent: DesktopAgent): Promise<void> {
        this.currentChannel = await agent.getCurrentChannel();
        this._channelBorderColor = this.currentChannel?.displayMetadata?.color ?? '';
    }

    private getChannelIndicatorClasses(): ClassInfo {
        return {
            'ms-channel-indicator-selected': !this.hideChannelBtns,
        };
    }

    public mouseOver(eventTarget: HTMLElement): void {
        if (getComputedStyle(eventTarget).animationName === 'show-channel-name') {
            eventTarget.style.backgroundColor = '';
        }
    }

    public mouseLeave(eventTarget: HTMLElement, channel: Channel): void {
        eventTarget.style.backgroundColor = channel.displayMetadata?.color ?? '';
    }

    protected override render(): TemplateResult {
        return html`
            <div class="ms-channel-selector-container">
                <div class="ms-all-channel-btns-container">
                    ${when(!this.hideChannelBtns, () =>
                        this.userChannels.map(channel => renderChannelBtn(channel, this)),
                    )}
                </div>
                <div class="ms-channel-indicator-container">
                    <button
                        automation-id="fth-channel-selector-toggle-btn"
                        type="button"
                        @click=${this.toggleChannelSelector}
                        class="ms-channel-indicator ${classMap(this.getChannelIndicatorClasses())}"
                        style="border-color: ${this.channelBorderColor};"
                    ></button>
                </div>
            </div>
        `;
    }
}

function renderChannelBtn(channel: Channel, component: ChannelSelectorComponent): TemplateResult {
    return html`<div class="ms-channel-btn-container">
        <button
            automation-id="fth-channel-selector-btn"
            data-channel-id="${channel.id}"
            class="ms-channel-btn"
            type="button"
            style="background-color: ${channel.displayMetadata?.color}; border-color: ${
                channel.displayMetadata?.color
            };"
            @click=${() => component.joinChannel(channel.id)}
            @mouseover=${(event: MouseEvent) => {
                if (event.target instanceof HTMLElement) {
                    component.mouseOver(event.target);
                }
            }}
            @mouseleave=${(event: MouseEvent) => {
                if (event.target instanceof HTMLElement) {
                    component.mouseLeave(event.target, channel);
                }
            }}
        >
            ${channel.displayMetadata?.name}
        </button>
    </div>`;
}
