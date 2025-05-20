/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeRelay } from './iframe-messaging-provider-relay.js';

const mockedChannelId = 'mocked-channel-id';

describe('IframeRelay', () => {
    let iframeRelay: IframeRelay;
    let mockedWindow: Window;
    let mockParentWindowCallback: (event: MessageEvent) => void;
    let stubAddEventListener: ReturnType<typeof vi.fn>;
    let mockedConsole: Console;
    let mockedBroadcastChannel: BroadcastChannel;
    let mockedMessagePort: MessagePort;

    beforeAll(() => {
        function channelMock() {}
        channelMock.prototype = {
            name: null,
            onmessage: null,
        };
        channelMock.prototype.postMessage = function (data: any) {
            this.onmessage({ data });
        };
        (window as any).BroadcastChannel = channelMock;
    });

    beforeEach(() => {
        stubAddEventListener = vi.fn((_: string, callback: (event: MessageEvent) => void) => {
            mockParentWindowCallback = callback;
        });
        const queryParams = new URLSearchParams();
        queryParams.set('channelId', mockedChannelId);

        mockedWindow = {
            addEventListener: stubAddEventListener,
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            location: {
                search: `?${queryParams.toString()}`,
                host: 'localhost',
                pathname: '/',
                href: 'http://localhost/',
            } as any as Location,
            parent: {
                postMessage: vi.fn(),
            },
        } as any as Window;
        mockedConsole = console;

        mockedBroadcastChannel = {
            postMessage: vi.fn(),
        } as any as BroadcastChannel;
        vi.spyOn(window, 'BroadcastChannel').mockReturnValue(mockedBroadcastChannel);

        mockedMessagePort = {
            onmessage: null,
            postMessage: vi.fn(),
        } as any as MessagePort;
        iframeRelay = new IframeRelay(mockedWindow, mockedConsole);
    });

    it('should initialize the relay and create a new relay channel', async () => {
        // Act
        await iframeRelay.initializeRelay();
        mockParentWindowCallback({
            ports: [mockedMessagePort],
        } as any as MessageEvent);
        mockedMessagePort.onmessage?.({
            data: {
                type: 'WCP1Hello',
                meta: {
                    connectionAttemptUuid: 'mocked-uuid',
                },
                payload: {
                    fdc3Version: '2.2.0',
                },
            },
        } as any as MessageEvent);

        // Assert
        expect(mockedMessagePort.postMessage).toHaveBeenCalledWith({
            type: 'WCP3Handshake',
            meta: {
                connectionAttemptUuid: 'mocked-uuid',
                timestamp: expect.any(Date),
            },
            payload: {
                channelSelectorUrl: false,
                intentResolverUrl: false,
                fdc3Version: '2.2.0',
            },
        });
        expect(mockedMessagePort.onmessage).toBeDefined();
    });

    it('should initialize the relay and emit an error when the channel id is not found in the query parameters and undefined as constructor parameter', async () => {
        // Arrange
        mockedConsole.error = vi.fn();
        mockedWindow.location.search = '';

        // Act
        try {
            iframeRelay = new IframeRelay(mockedWindow, mockedConsole);
            throw new Error('Expected an error to be thrown');
        } catch (e) {
            // Assert
            expect(e).toBeInstanceOf(Error);
            expect((e as Error).message).toBe('iFrameRelay: channelId not found in the query parameters.');
        }
    });

    it('should initialize the relay and emit an error when a message without port2 is posted', async () => {
        // Arrange
        mockedConsole.error = vi.fn();

        // Act
        await iframeRelay.initializeRelay();
        mockParentWindowCallback({
            data: {
                adifferentmessage: 'hello',
            },
        } as any as MessageEvent);

        // Assert
        expect(mockedConsole.error).toHaveBeenCalledWith('Relay message port not found in the event data.');
    });

    describe('when the relay message port is initialized', () => {
        beforeEach(async () => {
            await iframeRelay.initializeRelay();
            mockParentWindowCallback({
                ports: [mockedMessagePort],
            } as any as MessageEvent);
            mockedBroadcastChannel.onmessage?.({
                data: {
                    type: 'broadcastChannelReady',
                },
            } as any as MessageEvent);
        });

        it('should shutdown the relay channel when receiving a shutdown message', async () => {
            // Arrange
            const mockEvent = {
                data: { type: 'fdc3-shutdown-channel' },
            };
            mockedConsole.log = vi.fn();

            // Act
            mockedMessagePort.onmessage?.(mockEvent as any as MessageEvent);

            // Assert
            expect(mockedConsole.log).toHaveBeenCalledWith(`Shutting down relay channel: ${mockedChannelId}`);
        });

        it('should relay outbound messages to the channel', async () => {
            // Arrange
            const mockEvent = {
                data: { type: 'mocked-message-type' },
            };

            // Act
            mockedMessagePort.onmessage?.(mockEvent as any as MessageEvent);

            // Assert
            expect(mockedBroadcastChannel.postMessage).toHaveBeenCalledWith(mockedChannelId);
        });

        it('should relay inbound messages to the parent window', async () => {
            // Arrange
            const mockEvent = {
                data: { type: 'mocked-message-type' },
            };

            // Act
            mockedBroadcastChannel.onmessage?.(mockEvent as any as MessageEvent);

            // Assert
            expect(mockedMessagePort.postMessage).toHaveBeenCalledWith(mockEvent.data);
        });
    });

    describe('when traceMessagingComms is enabled', () => {
        beforeEach(async () => {
            iframeRelay = new IframeRelay(mockedWindow, mockedConsole, true);
            await iframeRelay.initializeRelay();
            mockParentWindowCallback({
                ports: [mockedMessagePort],
            } as any as MessageEvent);
            mockedBroadcastChannel.onmessage?.({
                data: {
                    type: 'broadcastChannelReady',
                },
            } as any as MessageEvent);
        });

        it('should log messages in the console', async () => {
            // Arrange
            const mockEvent = {
                data: { type: 'mocked-message-type' },
            };
            mockedConsole.log = vi.fn();

            // Act
            mockedBroadcastChannel.onmessage?.(mockEvent as any as MessageEvent);

            // Assert
            expect(mockedConsole.log).toHaveBeenCalledWith(
                `[MESSAGE] root > iframe: ${JSON.stringify(mockEvent.data, null, 2)}`,
            );
        });
    });
});
