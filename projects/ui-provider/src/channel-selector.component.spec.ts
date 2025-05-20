/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { Channel, DesktopAgent, EventHandler, FDC3ChannelChangedEvent, Listener } from '@finos/fdc3';
import { IMocked, Mock, setupFunction, setupProperty } from '@morgan-stanley/ts-mocking-bird';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSelectorComponent } from './channel-selector.component.js';

const mockedChannelId = 'channel-two';

describe(`${ChannelSelectorComponent.name} (channel-selector.component)`, () => {
    let mockDesktopAgent: IMocked<DesktopAgent>;
    let mockDocument: Document;

    let channelOne: IMocked<Channel>;
    let channelTwo: IMocked<Channel>;
    let channelThree: IMocked<Channel>;

    let mockListener: IMocked<Listener>;

    let handlerCallbacks: EventHandler[];

    beforeEach(() => {
        vi.useFakeTimers();
        mockDocument = document;

        channelOne = Mock.create<Channel>().setup(
            setupProperty('id', 'channel-one'),
            setupProperty('displayMetadata', {
                name: 'Channel 1',
                color: 'red',
                glyph: '1',
            }),
        );
        channelTwo = Mock.create<Channel>().setup(
            setupProperty('id', 'channel-two'),
            setupProperty('displayMetadata', {
                name: 'Channel 2',
                color: 'orange',
                glyph: '2',
            }),
        );
        channelThree = Mock.create<Channel>().setup(
            setupProperty('id', 'channel-three'),
            setupProperty('displayMetadata', {
                name: 'Channel 3',
                color: 'yellow',
                glyph: '3',
            }),
        );

        mockListener = Mock.create<Listener>().setup(setupFunction('unsubscribe'));

        handlerCallbacks = [];

        mockDesktopAgent = Mock.create<DesktopAgent>().setup(
            setupFunction('getUserChannels', () =>
                Promise.resolve([channelOne.mock, channelTwo.mock, channelThree.mock]),
            ),
            setupFunction('leaveCurrentChannel', () => Promise.resolve()),
            setupFunction('joinUserChannel', _channelId => Promise.resolve()),
            setupFunction('getCurrentChannel', () => Promise.resolve(channelTwo.mock)),
            setupFunction('addEventListener', (_type, handler) => {
                handlerCallbacks.push(handler);
                return Promise.resolve(mockListener.mock);
            }),
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    function createInstance(): ChannelSelectorComponent {
        const channelSelector = new ChannelSelectorComponent();
        channelSelector.desktopAgent = mockDesktopAgent.mock;
        mockDocument.querySelector('body')?.appendChild(channelSelector);
        return channelSelector;
    }

    describe('toggleChannelSelector', () => {
        it('should display buttons for all user channels when hideChannelBtns is swapped to false', async () => {
            const instance = createInstance();

            await instance.toggleChannelSelector();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelectorAll('.ms-channel-btn').length,
            ).toEqual(3);
        });

        it('should hide all buttons for user channels when hideChannelBtns is swapped to true', async () => {
            const instance = createInstance();

            await instance.toggleChannelSelector();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-indicator') as HTMLElement
            ).click();

            await wait();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelectorAll('.ms-channel-btn').length,
            ).toEqual(0);
        });
    });

    describe('joinChannel', () => {
        it('should call joinUserChannel() on desktopAgent when user is not already joined to given channel', () => {
            const instance = createInstance();

            instance.joinChannel(mockedChannelId);

            expect(
                mockDesktopAgent.withFunction('joinUserChannel').withParametersEqualTo(mockedChannelId),
            ).wasCalledOnce();
        });

        it('should call leaveCurrentChannel() on desktopAgent when user is already joined to given channel', async () => {
            const instance = createInstance();

            await instance.joinChannel(mockedChannelId);

            instance.joinChannel(mockedChannelId);

            expect(mockDesktopAgent.withFunction('leaveCurrentChannel')).wasCalledOnce();
        });

        it('should update currentChannel to given channel', async () => {
            const instance = createInstance();

            await instance.joinChannel(mockedChannelId);

            expect(
                getComputedStyle(
                    mockDocument
                        .querySelector('ms-channel-selector')
                        ?.shadowRoot?.querySelector('.ms-channel-indicator') as HTMLElement,
                ).borderColor,
            ).toEqual(channelTwo.mock.displayMetadata?.color);
        });

        it('should hide all buttons for user channels', async () => {
            createInstance();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-indicator') as HTMLElement
            ).click();

            await wait();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-btn') as HTMLElement
            ).click();

            await wait();

            expect(
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelectorAll('.ms-channel-btn').length,
            ).toEqual(0);
        });
    });

    describe('getCurrentChannel', () => {
        it('should call getCurrentChannel method on Channel Selector component when FDC3ChannelChangedEvent is received', async () => {
            const instance = createInstance();

            await instance.toggleChannelSelector();

            expect(mockDesktopAgent.withFunction('addEventListener')).wasCalledOnce();

            const channelChangedEvent: FDC3ChannelChangedEvent = {
                type: 'userChannelChanged',
                string: 'userChannelChanged',
                details: {
                    currentChannelId: channelTwo.mock.id,
                },
            };

            handlerCallbacks.forEach(handler => handler(channelChangedEvent));

            expect(mockDesktopAgent.withFunction('getCurrentChannel')).wasCalled(2);
        });
    });

    describe('mouseOver', () => {
        it('should change background color property of channel button to empty string if animation is turned on', async () => {
            createInstance();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-indicator') as HTMLElement
            ).click();

            await wait();

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-btn') as HTMLElement
            ).style.animationName = 'show-channel-name';

            (
                mockDocument
                    .querySelector('body')
                    ?.querySelector('ms-channel-selector')
                    ?.shadowRoot?.querySelector('.ms-channel-btn') as HTMLElement
            ).dispatchEvent(new Event('mouseover'));

            await wait();

            expect(
                (
                    mockDocument
                        .querySelector('body')
                        ?.querySelector('ms-channel-selector')
                        ?.shadowRoot?.querySelector('.ms-channel-btn') as HTMLElement
                ).style.backgroundColor,
            ).toEqual('');
        });
    });

    async function wait(delay: number = 50): Promise<void> {
        vi.advanceTimersByTime(delay);
        // Force a flush of pending promises
        await Promise.resolve();
    }
});
