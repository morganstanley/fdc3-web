/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { IProxyOutgoingMessageEnvelope } from '@morgan-stanley/fdc3-web';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { IframeMessagingProvider } from './iframe-messaging-provider.js';

// Mock the key imports
vi.mock('@morgan-stanley/fdc3-web', () => ({
    generateUUID: () => 'mocked-uuid',
    discoverProxyCandidates: vi.fn(() => [{ postMessage: vi.fn() }]),
    generateHelloMessage: () => ({
        type: 'WCP1Hello',
        meta: {
            connectionAttemptUuid: 'mocked-uuid',
            timestamp: new Date(),
        },
        payload: {
            actualUrl: 'http://localhost/',
            fdc3Version: '2.2.0',
            identityUrl: 'http://localhost/',
        },
    }),
}));

describe('IframeMessagingProvider', () => {
    let mockIframe: HTMLIFrameElement;
    let mockMessageChannel: MessageChannel;
    let mockDocument: Document;
    let mockConsole: Console;
    let mockWindow: Window;
    let provider: IframeMessagingProvider;

    beforeEach(() => {
        // Setup mocks
        mockIframe = {
            src: '',
            style: { display: 'none' },
            sandbox: { add: vi.fn() },
            addEventListener: vi.fn(),
            contentWindow: { postMessage: vi.fn() as unknown as Mock }, // Explicitly type as mock for test
        } as unknown as HTMLIFrameElement;

        mockMessageChannel = {
            port1: {
                start: vi.fn(),
                close: vi.fn(),
                postMessage: vi.fn(),
                onmessage: null,
            },
            port2: {},
        } as unknown as MessageChannel;

        mockDocument = {
            createElement: vi.fn(() => mockIframe),
            body: { appendChild: vi.fn() },
        } as unknown as Document;

        mockWindow = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { href: 'http://test.com' },
            console: { log: vi.fn(), error: vi.fn() },
        } as unknown as Window;

        mockConsole = {
            log: vi.fn(),
            error: vi.fn(),
        } as unknown as Console;

        provider = new IframeMessagingProvider(5000, mockMessageChannel, mockDocument, mockConsole, mockWindow);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should initialize the provider correctly', () => {
        expect(mockDocument.createElement).toHaveBeenCalledWith('iframe');
        expect(mockIframe.sandbox?.add).toHaveBeenCalledWith('allow-same-origin');
        expect(mockIframe.sandbox?.add).toHaveBeenCalledWith('allow-scripts');
        expect(mockIframe.style.display).toBe('none');
        expect(mockDocument.body.appendChild).toHaveBeenCalledWith(mockIframe);
        expect(mockConsole.log).toHaveBeenCalledWith(
            expect.stringContaining('IFrameMessagingProvider created with channelId: mocked-uuid'),
        );
    });

    it('should shut down the relay by clearing the source', () => {
        // Call method under test
        provider.shutdownRelay();

        // Verify behavior
        expect(mockIframe.src).toBe('');
        expect(mockMessageChannel.port1.close).toHaveBeenCalled();
    });

    it('should log an error if the relay is not connected', () => {
        // Create test message
        const message: IProxyOutgoingMessageEnvelope = {
            payload: {
                meta: { requestUuid: '1234', timestamp: new Date() },
                payload: { intent: 'intent' },
                type: 'addIntentListenerRequest',
            },
        };

        // Call method under test
        provider.sendMessage(message);

        // Verify error was logged
        expect(mockConsole.error).toHaveBeenCalledWith('Relay not connected. Cannot publish message.');
    });

    it('should send message when relay is connected', () => {
        // Set relayConnected to true
        Object.defineProperty(provider, 'relayConnected', { value: true, writable: true });

        // Create test message
        const message: IProxyOutgoingMessageEnvelope = {
            payload: {
                meta: { requestUuid: '1234', timestamp: new Date() },
                payload: { intent: 'intent' },
                type: 'addIntentListenerRequest',
            },
        };

        // Call method under test
        provider.sendMessage(message);

        // Verify message was sent
        expect(mockMessageChannel.port1.postMessage).toHaveBeenCalledWith(message.payload);
    });

    it('should add and remove response handlers', async () => {
        // Setup
        const mockCallback = vi.fn();
        const mockCallback2 = vi.fn();

        // Add handlers
        provider.addResponseHandler(mockCallback);
        provider.addResponseHandler(mockCallback2);

        // Create a mock message event
        const mockData = { type: 'someOtherType', payload: { test: 'data' } };
        const mockEvent = { data: mockData };

        // Set relayConnected to true to allow sending messages
        Object.defineProperty(provider, 'relayConnected', { value: true });

        // We need to call the onMessage method which is private
        // So we'll capture the onmessage handler from the frameLoaded method
        let messageHandler: ((event: MessageEvent) => void) | undefined;

        // Create a custom spy on port1.start that captures the onmessage assignment
        const originalStart = mockMessageChannel.port1.start;
        mockMessageChannel.port1.start = vi.fn().mockImplementation(() => {
            // After start is called, we know onmessage will be set
            // Capture the handler being set
            Object.defineProperty(mockMessageChannel.port1, 'onmessage', {
                set(handler) {
                    messageHandler = handler;
                },
                get() {
                    return messageHandler;
                },
                configurable: true,
            });
            if (originalStart) originalStart();
        });

        // Simulate iframe load event to initialize the message handlers
        provider['frameLoaded'](vi.fn());

        // Verify start and postMessage were called
        expect(mockMessageChannel.port1.start).toHaveBeenCalled();
        expect(mockMessageChannel.port1.postMessage).toHaveBeenCalled();

        // Now we can manually trigger the message handler with our test event
        if (messageHandler) {
            messageHandler(mockEvent as unknown as MessageEvent);
        }

        // Verify both callbacks were called
        expect(mockCallback).toHaveBeenCalledWith({ payload: mockData });
        expect(mockCallback2).toHaveBeenCalledWith({ payload: mockData });

        // Reset the mock callbacks
        mockCallback.mockClear();
        mockCallback2.mockClear();

        // Unsubscribe one handler
        provider.unsubscribe(mockCallback);

        // Trigger the handler again
        if (messageHandler) {
            messageHandler(mockEvent as unknown as MessageEvent);
        }

        // Verify only the remaining callback was called
        expect(mockCallback).not.toHaveBeenCalled();
        expect(mockCallback2).toHaveBeenCalledTimes(1);
    });

    it('should fail to initialize the relay if the handshake is not received', async () => {
        // Setup fake timers
        vi.useFakeTimers();

        // Start initialization and expect rejection
        const initPromise = provider.initializeRelay().catch(error => {
            expect(error).toEqual('Relay handshake failed. Shutting down relay.');
            return error; // Return the error to mark it as handled
        });

        // Advance timers to trigger timeout
        await vi.advanceTimersByTimeAsync(5000);

        // Wait for the promise to settle
        await initPromise;

        // Verify that shutdownRelay was called
        expect(mockIframe.src).toBe('');
        expect(mockMessageChannel.port1.close).toHaveBeenCalled();

        // Cleanup
        vi.useRealTimers();
    });

    it('should handle initialization sequence correctly', async () => {
        // We're going to test the initialization sequence through public methods
        // Setup - simulate successful handshake
        const initPromise = provider.initializeRelay();

        // Get the message listener that was added to the window
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        expect(messageListener).toBeTruthy();

        // Simulate the ack message from parent
        messageListener!({
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
                traceMessagingComms: true,
            },
            origin: 'https://example.com',
        } as unknown as MessageEvent);

        // Get the load event listener that was added to the iframe
        const loadListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'load',
        );
        const loadListener = loadListenerCall ? loadListenerCall[1] : null;
        expect(loadListener).toBeTruthy();

        // Trigger the iframe load event
        loadListener!();

        // Verify iframe communication setup was done correctly
        expect(mockIframe.contentWindow?.postMessage).toHaveBeenCalledWith('message-port', '*', [
            mockMessageChannel.port2,
        ]);
        expect(mockMessageChannel.port1.start).toHaveBeenCalled();
        expect(mockMessageChannel.port1.postMessage).toHaveBeenCalled();

        // Simulate handshake response to complete initialization
        const onMessageHandler = mockMessageChannel.port1.onmessage;
        (onMessageHandler as any)({
            data: {
                type: 'WCP3Handshake',
                payload: { fdc3Version: '2.2.0' },
            },
        });

        // Now the promise should be resolved
        await expect(initPromise).resolves.toBeUndefined();
    });

    it('should not process multiple iframe loads', async () => {
        // Start initialization
        const initPromise = provider.initializeRelay();

        // Simulate the ack message
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        messageListener!({
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
            },
            origin: 'https://example.com',
        } as unknown as MessageEvent);

        // Get and trigger the load event
        const loadListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'load',
        );
        const loadListener = loadListenerCall ? loadListenerCall[1] : null;
        loadListener!();

        // Reset the mock to track subsequent calls
        (mockIframe.contentWindow!.postMessage as Mock).mockClear();

        // Trigger load event again - should do nothing (it's no longer the first load)
        loadListener!();

        // Verify that postMessage was not called again
        expect(mockIframe.contentWindow?.postMessage).not.toHaveBeenCalled();

        // Complete initialization to clean up
        const onMessageHandler = mockMessageChannel.port1.onmessage;
        (onMessageHandler as any)({
            data: {
                type: 'WCP3Handshake',
                payload: { fdc3Version: '2.2.0' },
            },
        });

        await initPromise;
    });

    it('should handle successful handshake message during initialization', async () => {
        // We'll test the handshake through the public initializeRelay method
        const initPromise = provider.initializeRelay();

        // Simulate the ack message
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        messageListener!({
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
            },
        } as unknown as MessageEvent);

        // Trigger the iframe load
        const loadListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'load',
        );
        const loadListener = loadListenerCall ? loadListenerCall[1] : null;
        loadListener!();

        // Simulate the handshake message
        const onMessageHandler = mockMessageChannel.port1.onmessage;
        (onMessageHandler as any)({
            data: {
                type: 'WCP3Handshake',
                payload: { fdc3Version: '2.2.0' },
            },
        });

        // Wait for initialization to complete
        await initPromise;

        // Verify the log message
        expect(mockConsole.log).toHaveBeenCalledWith(
            expect.stringContaining('Relay connected to iframe with implementation details: 2.2.0'),
        );

        // Verify relay is connected by checking that sendMessage works without error
        const message = {
            payload: {
                meta: { requestUuid: '1234', timestamp: new Date() },
                payload: { intent: 'intent' },
                type: 'addIntentListenerRequest',
            },
        };
        provider.sendMessage(message as unknown as IProxyOutgoingMessageEnvelope);
        expect(mockConsole.error).not.toHaveBeenCalled();
        expect(mockMessageChannel.port1.postMessage).toHaveBeenCalledWith(message.payload);
    });

    it('should handle non-handshake message types and route to listeners', async () => {
        // Setup mock callback
        const mockCallback = vi.fn();
        provider.addResponseHandler(mockCallback);

        // Start initialization
        const initPromise = provider.initializeRelay();

        // Simulate the ack message and iframe load
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        messageListener!({
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
            },
        } as unknown as MessageEvent);

        const loadListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'load',
        );
        const loadListener = loadListenerCall ? loadListenerCall[1] : null;
        loadListener!();

        // Complete initialization
        const onMessageHandler = mockMessageChannel.port1.onmessage;
        (onMessageHandler as any)({
            data: {
                type: 'WCP3Handshake',
                payload: { fdc3Version: '2.2.0' },
            },
        });

        await initPromise;

        // Now simulate a non-handshake message
        const testEvent = {
            data: {
                type: 'someOtherType',
                payload: { test: 'data' },
            },
        };

        (onMessageHandler as any)(testEvent);

        // Verify callback was called with the message
        expect(mockCallback).toHaveBeenCalledWith({ payload: testEvent.data });
    });

    it('should handle initialization with valid URL', async () => {
        // Start initialization
        const initPromise = provider.initializeRelay();

        // Get the message listener
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        expect(messageListener).toBeTruthy();

        // Create a valid ack message
        const validAckEvent = {
            data: {
                type: 'ack',
                nonce: 'mocked-uuid', // This matches what's returned by our mocked generateUUID
                url: 'https://example.com',
                traceMessagingComms: true,
            },
            origin: 'https://example.com',
        };

        // Trigger the message handler with the ack event
        messageListener!(validAckEvent as unknown as MessageEvent);

        // Verify iframe src was set correctly
        expect(mockIframe.src).toBe('https://example.com?channelId=mocked-uuid');
        expect(mockWindow.removeEventListener).toHaveBeenCalledWith('message', messageListener);

        // Complete the initialization process
        const loadListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'load',
        );
        const loadListener = loadListenerCall ? loadListenerCall[1] : null;
        loadListener!();

        // Simulate handshake response
        const onMessageHandler = mockMessageChannel.port1.onmessage;
        (onMessageHandler as any)({
            data: {
                type: 'WCP3Handshake',
                payload: { fdc3Version: '2.2.0' },
            },
        });

        // Initialization should complete successfully
        await expect(initPromise).resolves.toBeUndefined();
    });

    it('should reject initialization with invalid URL', () => {
        // Start initialization
        const initPromise = provider.initializeRelay().catch(error => {
            expect(error).toBe('Invalid URL [invalid-url] received from parent window');
            return error; // Return to prevent unhandled rejection
        });

        // Get the message listener
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;

        // Create an invalid ack message with malformed URL
        const invalidAckEvent = {
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'invalid-url', // Invalid URL
            },
        };

        // Trigger the message handler with the invalid ack event
        messageListener!(invalidAckEvent as unknown as MessageEvent);

        // Verify error was logged
        expect(mockConsole.error).toHaveBeenCalledWith('Invalid URL received from parent window');

        return initPromise; // Return the promise to allow test to verify rejection
    });

    it('should handle iframe error events during initialization', () => {
        // Start initialization
        const initPromise = provider.initializeRelay().catch(error => {
            expect(error).toBe('Error loading iframe');
            return error; // Return to prevent unhandled rejection
        });

        // Get the message listener
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;

        // Create a valid ack message
        const validAckEvent = {
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
            },
        };

        // Trigger the message handler with the ack event
        messageListener!(validAckEvent as unknown as MessageEvent);

        // Find the error listener
        const errorListenerCall = (mockIframe.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'error',
        );
        const errorListener = errorListenerCall ? errorListenerCall[1] : null;
        expect(errorListener).toBeTruthy();

        // Simulate error event
        errorListener!();

        // Verify error was logged
        expect(mockConsole.error).toHaveBeenCalledWith(
            expect.stringContaining('Error loading FDC3 iframe relay at URL: https://example.com'),
        );

        return initPromise; // Return the promise to allow test to verify rejection
    });

    it('should handle ack message with mismatched nonce', () => {
        // Start initialization
        provider.initializeRelay();

        // Get the message listener
        const messageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const messageListener = messageListenerCall ? messageListenerCall[1] : null;
        expect(messageListener).toBeTruthy();

        // Create an ack message with wrong nonce
        const invalidNonceEvent = {
            data: {
                type: 'ack',
                nonce: 'wrong-nonce', // Different than the mocked-uuid
                url: 'https://example.com',
            },
        };

        // Reset error log mock to clearly track this specific error
        (mockConsole.error as Mock).mockClear();

        // Trigger the message handler with the invalid nonce event
        messageListener!(invalidNonceEvent as unknown as MessageEvent);

        // Verify error was logged
        expect(mockConsole.error).toHaveBeenCalledWith('Invalid nonce received from parent window');
    });

    it('should initialize desktop agent proxy child window listener', () => {
        // Start initialization to trigger the initial setup
        provider.initializeRelay();

        // Get the first message listener (for parent handshake)
        const firstMessageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const firstMessageListener = firstMessageListenerCall ? firstMessageListenerCall[1] : null;

        // Reset the addEventListener mock to track the second listener
        (mockWindow.addEventListener as Mock).mockClear();

        // Trigger the parent handshake to initialize the second listener
        firstMessageListener!({
            data: {
                type: 'ack',
                nonce: 'mocked-uuid',
                url: 'https://example.com',
            },
            origin: 'https://example.com',
        } as unknown as MessageEvent);

        // Verify a second message listener was added
        expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

        // Get the second message listener (for child window)
        const secondMessageListenerCall = (mockWindow.addEventListener as Mock).mock.calls.find(
            (call: string[]) => call[0] === 'message',
        );
        const secondMessageListener = secondMessageListenerCall ? secondMessageListenerCall[1] : null;
        expect(secondMessageListener).toBeTruthy();

        // Mock event source with postMessage method
        const mockSource = { postMessage: vi.fn() };

        // Create a hello message a child window might send
        const helloEvent = {
            data: {
                type: 'hello',
                nonce: 'child-nonce',
            },
            source: mockSource,
            origin: 'https://child-app.com',
        };

        // Trigger the second message listener with the hello event
        secondMessageListener!(helloEvent as unknown as MessageEvent);

        // Verify the response was sent to the source
        expect(mockSource.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ack',
                nonce: 'child-nonce',
                url: 'https://example.com',
            }),
            { targetOrigin: 'https://child-app.com' },
        );
    });
});
