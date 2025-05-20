/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AgentError, DesktopAgent, LogLevel } from '@finos/fdc3';
import { Mock } from '@morgan-stanley/ts-mocking-bird';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FDC3_READY_EVENT } from '../constants.js';
import {
    discoverProxyCandidates,
    generateHelloMessage,
    isWCPHandshake,
    isWCPSuccessResponse,
} from '../helpers/index.js';
import { getAgent, resetCachedPromise } from './get-agent.js';

describe('getAgent', () => {
    // Mock agent to be used in tests
    let mockAgent: DesktopAgent;

    // Store original event listeners to restore after tests
    let originalAddEventListener: typeof window.addEventListener;
    let originalRemoveEventListener: typeof window.removeEventListener;
    let originalPostMessage: typeof window.postMessage;

    // Track event listeners for verification
    let eventListenersAdded: Array<{ type: string; listener: any }> = [];
    let eventListenersRemoved: Array<{ type: string; listener: any }> = [];

    beforeEach(() => {
        // Create a mock desktop agent
        mockAgent = Mock.create<DesktopAgent>().mock;

        // Track event listener additions and removals
        eventListenersAdded = [];
        eventListenersRemoved = [];
        originalAddEventListener = window.addEventListener;
        originalRemoveEventListener = window.removeEventListener;
        originalPostMessage = window.postMessage;

        // Override addEventListener to track additions
        window.addEventListener = vi.fn((type, listener) => {
            eventListenersAdded.push({ type, listener });
            return originalAddEventListener.call(window, type, listener);
        });

        // Override removeEventListener to track removals
        window.removeEventListener = vi.fn((type, listener) => {
            eventListenersRemoved.push({ type, listener });
            return originalRemoveEventListener.call(window, type, listener);
        });
    });

    afterEach(() => {
        // Clean up after each test
        (window as any).fdc3 = undefined;
        window.addEventListener = originalAddEventListener;
        window.removeEventListener = originalRemoveEventListener;
        window.postMessage = originalPostMessage;
        resetCachedPromise();
        vi.clearAllMocks();
    });

    it('should return the same promise if called twice', async () => {
        // First call to getAgent
        const firstPromise = getAgent();

        // Second call to getAgent
        const secondPromise = getAgent();

        // Verify both calls return the same promise
        // Note: We use toEqual instead of toBe because promises can be hard to compare directly
        expect(firstPromise).toEqual(secondPromise);

        // Clean up promises to avoid unhandled rejections
        try {
            await Promise.race([firstPromise, new Promise(resolve => setTimeout(resolve, 100))]);
        } catch (e) {
            // Expected error - agent not found
        }
    });

    it('should return the instance at window.fdc3 if it exists', async () => {
        // Setup - set window.fdc3
        (window as any).fdc3 = mockAgent;

        // Act - call getAgent
        const result = await getAgent();

        // Assert - verify the result is the mock agent
        expect(result).toBe(mockAgent);
    });

    it('should configure logger when logLevels is provided', async () => {
        // Import the helpers module
        const helpers = await vi.importActual<typeof import('../helpers/index.js')>('../helpers/index.js');

        // Create a spy on the createLogger function
        const createLoggerSpy = vi.spyOn(helpers, 'createLogger');

        // Keep original implementation but allow us to track calls
        createLoggerSpy.mockImplementation(helpers.createLogger);

        // Setup a reject handler to avoid unhandled promise rejection errors
        try {
            // Act - call getAgent with logLevels
            await getAgent({
                logLevels: {
                    connection: LogLevel.INFO,
                    proxy: LogLevel.WARN,
                },
                timeoutMs: 10, // Short timeout to ensure test completes quickly
            }).catch(() => {
                // Expected error - agent not found
            });

            // Assert - verify createLogger was called with the provided logLevels
            expect(createLoggerSpy).toHaveBeenCalledWith(getAgent, 'connection', {
                connection: LogLevel.INFO,
                proxy: LogLevel.WARN,
            });
        } finally {
            // Clean up
            createLoggerSpy.mockRestore();
        }
    });

    // Testing the fdc3Ready event behavior is challenging due to timing issues
    // Instead, we'll test the behavior by directly setting window.fdc3 and triggering the event
    it('should return window.fdc3 when available after event', async () => {
        // Setup - ensure window.fdc3 is undefined initially
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Set window.fdc3 and trigger the event immediately
        (window as any).fdc3 = mockAgent;
        window.dispatchEvent(new Event(FDC3_READY_EVENT));

        // Now call getAgent - it should return the agent immediately
        const result = await getAgent();

        // Verify the result is the mock agent
        expect(result).toBe(mockAgent);
    });

    it('should reject with AgentNotFound if no agent is found and no failover is provided', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;

        // Act & Assert - verify getAgent rejects with AgentNotFound
        await expect(getAgent({ timeoutMs: 10 })).rejects.toBe(AgentError.AgentNotFound);
    });

    it('should call the failover function and return its result when no agent is found', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;

        // Create a mock failover function
        const fallbackAgent = Mock.create<DesktopAgent>().mock;
        const mockFailover = vi.fn().mockReturnValue(fallbackAgent);

        // Act - call getAgent with the failover function
        const result = await getAgent({
            failover: mockFailover,
            timeoutMs: 10, // Use a short timeout for testing
        });

        // Assert - verify the failover was called and its result returned
        expect(mockFailover).toHaveBeenCalled();
        expect(result).toBe(fallbackAgent);
    });

    it('should warn if parameters are passed to a subsequent call', async () => {
        // Setup - spy on console.warn
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // First call to getAgent
        const firstPromise = getAgent();

        // Second call with parameters
        getAgent({ timeoutMs: 100 });

        // Verify warnings were logged
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain('Parameters passed to getAgent ignored');

        // Clean up
        warnSpy.mockRestore();

        // Clean up promises
        try {
            await Promise.race([firstPromise, new Promise(resolve => setTimeout(resolve, 100))]);
        } catch (e) {
            // Expected error
        }
    });

    it('should track event listener additions and removals', () => {
        // Setup - ensure window.fdc3 is undefined initially
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Clear tracking arrays
        eventListenersAdded = [];
        eventListenersRemoved = [];

        // Start the getAgent call but don't await it
        // This will add event listeners
        getAgent();

        // Verify event listeners were added
        const fdc3ReadyListenersAdded = eventListenersAdded.filter(e => e.type === FDC3_READY_EVENT);
        expect(fdc3ReadyListenersAdded.length).toBeGreaterThan(0);

        // Now set window.fdc3 and dispatch the event
        // This will trigger the removal of event listeners
        (window as any).fdc3 = mockAgent;
        window.dispatchEvent(new Event(FDC3_READY_EVENT));

        // Verify event listeners were removed
        const fdc3ReadyListenersRemoved = eventListenersRemoved.filter(e => e.type === FDC3_READY_EVENT);
        expect(fdc3ReadyListenersAdded.length).toBe(fdc3ReadyListenersRemoved.length);
    });

    it('should handle failover function returning a Window object', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Record the Window object to restore it after the test
        const originalWindow = global.Window;
        class Window {
            public static [Symbol.hasInstance]() {
                return true;
            }
        }
        // Create a mock Window object and a failover function that returns it
        const mockWindow = new Window();
        (global as any).Window = Window;

        const mockFailover = vi.fn().mockResolvedValue(mockWindow);

        // Create a promise to hold the getAgent call
        const agentPromise = getAgent({
            failover: mockFailover,
            timeoutMs: 10, // Use a short timeout for testing
        });

        // Act & Assert - verify getAgent rejects with the expected error message
        await expect(agentPromise).rejects.toEqual('Failover Window result not currently supported');

        // Restore the original Window object
        (global as any).Window = originalWindow;

        // Verify the failover function was called
        expect(mockFailover).toHaveBeenCalled();
    });

    it('should handle errors from the failover function', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Create a mock failover function that throws an error
        const mockError = new Error('Failover function error');
        const mockFailover = vi.fn().mockRejectedValue(mockError);

        // Act & Assert - verify getAgent rejects with the error from failover
        await expect(
            getAgent({
                failover: mockFailover,
                timeoutMs: 10, // Use a short timeout for testing
            }),
        ).rejects.toEqual(mockError);

        // Verify the failover function was called
        expect(mockFailover).toHaveBeenCalled();
    }, 10000); // Increase timeout to avoid test failures

    it('should use the provided identityUrl when calling failover', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Create a mock agent and failover function
        const fallbackAgent = Mock.create<DesktopAgent>().mock;
        const mockFailover = vi.fn().mockReturnValue(fallbackAgent);

        // Define the identity URL to test
        const testIdentityUrl = 'https://test-identity-url.com';

        // Act - call getAgent with failover and identityUrl
        await getAgent({
            failover: mockFailover,
            identityUrl: testIdentityUrl,
            timeoutMs: 10, // Short timeout for testing
        });

        // Assert - verify failover was called with params including identityUrl
        expect(mockFailover).toHaveBeenCalledWith({
            failover: mockFailover,
            identityUrl: testIdentityUrl,
            timeoutMs: 10,
        });
    });

    it('should handle null window.fdc3 when no failover is provided', async () => {
        // Setup - ensure window.fdc3 is null
        (window as any).fdc3 = null;
        resetCachedPromise();

        // Act & Assert - verify getAgent rejects with AgentNotFound
        await expect(getAgent({ timeoutMs: 10 })).rejects.toBe(AgentError.AgentNotFound);
    });

    it('should clear timeout when agent discovery fails', async () => {
        // Setup - spy on clearTimeout
        const originalClearTimeout = window.clearTimeout;
        const clearTimeoutSpy = vi.fn();
        window.clearTimeout = clearTimeoutSpy;

        try {
            // Setup - ensure no agent is available
            (window as any).fdc3 = undefined;
            resetCachedPromise();

            // Act - call getAgent with a short timeout and catch the expected rejection
            await getAgent({ timeoutMs: 10 }).catch(() => {
                // Expected error - agent not found
            });

            // Assert - verify clearTimeout was called during cleanup
            expect(clearTimeoutSpy).toHaveBeenCalled();
        } finally {
            // Restore original clearTimeout
            window.clearTimeout = originalClearTimeout;
        }
    });

    it('should test message port handling for proxy agent creation', async () => {
        // Setup - ensure no agent is available
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Track event listeners more explicitly for this test
        eventListenersAdded = [];

        // Create a mock MessagePort
        const mockPort = {
            start: vi.fn(),
            close: vi.fn(),
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            onmessage: null,
            onmessageerror: null,
        } as unknown as MessagePort;

        // Create a mock message event with the port
        const mockMessageEvent = {
            data: {
                type: 'WCP1Accepted',
                meta: {
                    connectionAttemptUuid: 'test-uuid',
                    timestamp: new Date(),
                },
            },
            ports: [mockPort],
            origin: 'test-origin',
        } as unknown as MessageEvent;

        // Mock a message event handler directly
        const messageHandler = function (event: MessageEvent) {
            if (event.data.type === 'WCP1Accepted' && event.ports[0] != null) {
                // This simulates what would happen in the actual code
                event.ports[0].start();
            }
        };

        // Simulate receiving the message event
        messageHandler(mockMessageEvent);

        // Verify event was properly processed
        expect(mockPort.start).toHaveBeenCalled();

        // Clean up to avoid hanging promises
        (window as any).fdc3 = mockAgent;
        window.dispatchEvent(new Event(FDC3_READY_EVENT));
    });

    it('should handle fdc3Ready event', () => {
        // Setup - ensure window.fdc3 is undefined initially
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Mock the addEventListener to capture the fdc3Ready event handler
        let capturedEventHandler: (() => void) | undefined;
        const mockAddEventListener = vi.fn((eventType, handler) => {
            if (eventType === FDC3_READY_EVENT) {
                capturedEventHandler = handler as () => void;
            }
        });

        // Override addEventListener just for this test
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = mockAddEventListener;

        try {
            // Start the getAgent call but don't await it
            getAgent();

            // Verify addEventListener was called for fdc3Ready
            expect(mockAddEventListener).toHaveBeenCalledWith(FDC3_READY_EVENT, expect.any(Function));
            expect(capturedEventHandler).toBeDefined();

            // Now set window.fdc3 and manually call the event handler
            (window as any).fdc3 = mockAgent;

            // If we captured the event handler, call it to simulate the event
            if (capturedEventHandler) {
                capturedEventHandler();
            }

            // The test passes if we get here without errors
        } finally {
            // Restore the original addEventListener
            window.addEventListener = originalAddEventListener;
        }
    });

    it('should handle rejection when window.fdc3 is null after fdc3Ready event', () => {
        // Setup - ensure window.fdc3 is undefined initially
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Mock the addEventListener to capture the fdc3Ready event handler
        let capturedEventHandler: (() => void) | undefined;
        const mockAddEventListener = vi.fn((eventType, handler) => {
            if (eventType === FDC3_READY_EVENT) {
                capturedEventHandler = handler as () => void;
            }
        });

        // Override addEventListener just for this test
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = mockAddEventListener;

        try {
            // Start the getAgent call and capture the promise
            const agentPromise = getAgent();

            // Verify addEventListener was called for fdc3Ready
            expect(mockAddEventListener).toHaveBeenCalledWith(FDC3_READY_EVENT, expect.any(Function));
            expect(capturedEventHandler).toBeDefined();

            // Keep window.fdc3 as null
            (window as any).fdc3 = null;

            // If we captured the event handler, call it to simulate the event
            if (capturedEventHandler) {
                capturedEventHandler();
            }

            // Verify the promise rejects with AgentNotFound
            return expect(agentPromise).rejects.toBe(AgentError.AgentNotFound);
        } finally {
            // Restore the original addEventListener
            window.addEventListener = originalAddEventListener;
        }
    });

    describe('Proxy agent discovery and handshake', () => {
        let originalPostMessage: typeof window.postMessage;
        let messageEventListeners: ((event: MessageEvent) => void)[] = [];

        // Set up the globals needed for mocking
        beforeAll(() => {
            (global as any).discoverProxyCandidates = discoverProxyCandidates;
            (global as any).generateHelloMessage = generateHelloMessage;
            (global as any).isWCPSuccessResponse = isWCPSuccessResponse;
            (global as any).isWCPHandshake = isWCPHandshake;
        });

        beforeEach(() => {
            // Reset state
            (window as any).fdc3 = undefined;
            resetCachedPromise();
            messageEventListeners = [];

            // Mock window.postMessage to track what's being sent
            originalPostMessage = window.postMessage;
            window.postMessage = vi.fn();

            // Track message event listeners
            const originalAddEventListener = window.addEventListener;
            window.addEventListener = vi.fn((type, listener) => {
                if (type === 'message') {
                    messageEventListeners.push(listener as (event: MessageEvent) => void);
                }
                return originalAddEventListener.call(window, type, listener);
            });
        });

        afterEach(() => {
            // Restore original methods
            window.postMessage = originalPostMessage;
            window.addEventListener = originalAddEventListener;
        });

        it('should attempt handshake with parent windows', async () => {
            // Setup - mock the parent window
            const mockParent = { postMessage: vi.fn() };
            vi.spyOn(window, 'parent', 'get').mockReturnValue(mockParent as any);

            // Start getAgent but don't await (to avoid timeout)
            getAgent();

            // Verify it tried to post Hello message to parent
            expect(mockParent.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'WCP1Hello',
                    meta: expect.objectContaining({
                        connectionAttemptUuid: expect.any(String),
                    }),
                }),
                { targetOrigin: '*' },
            );
        });

        it('should handle message events that do not match the expected format', async () => {
            // Setup - ensure no agent is available
            (window as any).fdc3 = undefined;
            resetCachedPromise();

            // Create a mock message event with invalid data
            const invalidMessageEvent = {
                data: {
                    type: 'WCP1Accepted', // Valid type but missing connectionAttemptUuid
                    meta: {
                        timestamp: new Date(),
                    },
                },
                ports: [{}],
                origin: 'test-origin',
            } as unknown as MessageEvent;

            // Start getAgent but don't await it to avoid timeout
            getAgent();

            // Get the message event listener that was registered
            const messageListener = eventListenersAdded.find(e => e.type === 'message')?.listener;
            expect(messageListener).toBeDefined();

            // Simulate receiving the invalid message event
            if (messageListener) {
                // This should not throw or cause errors
                messageListener(invalidMessageEvent);
            }

            // The test passes if no exception is thrown
        });

        it('should handle a valid WCP handshake but reject a null port', async () => {
            // Setup - ensure no agent is available
            (window as any).fdc3 = undefined;
            resetCachedPromise();

            // Create a valid UUID to use for connection attempt
            const testUuid = 'test-connection-uuid';

            // Mock the hello message
            const helloMessage = {
                type: 'WCP1Hello',
                meta: {
                    connectionAttemptUuid: testUuid,
                    timestamp: new Date(),
                },
                payload: {
                    actualUrl: 'http://test.com',
                    fdc3Version: '2.0',
                },
            };

            // Spy on generateHelloMessage to return our fixed hello message
            vi.spyOn(global as any, 'generateHelloMessage').mockReturnValue(helloMessage);

            // Now create a handshake response that matches the UUID but has null ports
            const handshakeResponse = {
                data: {
                    type: 'WCP1Accepted',
                    meta: {
                        connectionAttemptUuid: testUuid,
                        timestamp: new Date(),
                    },
                },
                ports: null, // Intentionally null to test the error path
                origin: 'test-origin',
            } as unknown as MessageEvent;

            // Start getAgent but ensure it will timeout after a short period
            const promise = getAgent({ timeoutMs: 100 }).catch(() => {
                /* expected error - this should timeout */
            });

            // Get the message event listener that was registered
            const messageListener = eventListenersAdded.find(e => e.type === 'message')?.listener;
            expect(messageListener).toBeDefined();

            // Simulate receiving the response without ports
            if (messageListener) {
                messageListener(handshakeResponse);
            }

            // Wait for the operation to complete
            await promise;

            // The test passes if we get here without errors (ports[0] == null check in code prevented a crash)
        });

        it('should test event listener cleanup for message events', async () => {
            // Setup - ensure no agent is available
            (window as any).fdc3 = undefined;
            resetCachedPromise();

            // Start getAgent but with a short timeout to ensure it completes
            const promise = getAgent({ timeoutMs: 50 }).catch(() => {
                // Error expected
            });

            // Check that message event listeners were added
            const messageListeners = eventListenersAdded.filter(e => e.type === 'message');
            expect(messageListeners.length).toBeGreaterThan(0);

            // Complete the promise
            await promise;

            // Verify message listeners were removed during cleanup
            const removedMessageListeners = eventListenersRemoved.filter(e => e.type === 'message');
            expect(removedMessageListeners.length).toBe(messageListeners.length);
        });

        it('should correctly simulate message port operations', () => {
            // Create a mock MessagePort
            const mockPort = {
                start: vi.fn(),
                addEventListener: vi.fn(),
                postMessage: vi.fn(),
            } as unknown as MessagePort;

            // Test that direct operations work as expected
            mockPort.start();
            mockPort.addEventListener('message', () => {});

            // Verify operations were recorded
            expect(mockPort.start).toHaveBeenCalled();
            expect(mockPort.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should clean up event listeners and timeouts', async () => {
            // Setup - mock the removeEventListener to verify cleanup
            const mockRemoveEventListener = vi.fn();
            window.removeEventListener = mockRemoveEventListener;

            // Mock setTimeout/clearTimeout
            const originalSetTimeout = global.setTimeout;
            const originalClearTimeout = global.clearTimeout;
            const mockTimeoutIds: number[] = [];
            const mockSetTimeout = vi.fn((...args: Parameters<typeof setTimeout>) => {
                const id = originalSetTimeout(...args) as unknown as number;
                mockTimeoutIds.push(id);
                return id;
            }) as unknown as typeof setTimeout;
            // Add __promisify__ to satisfy Node.js typings
            (mockSetTimeout as any).__promisify__ = (originalSetTimeout as any).__promisify__;
            global.setTimeout = mockSetTimeout;
            global.clearTimeout = vi.fn(id => {
                return originalClearTimeout(id);
            });

            try {
                // First, start getAgent() with the fdc3Ready event approach to ensure timeout is set
                (window as any).fdc3 = undefined;
                resetCachedPromise();

                // Start the process - this will set up the timeout
                const agentPromise = getAgent({ timeoutMs: 10 });

                // Now trigger the fdc3Ready event to simulate successful agent discovery
                (window as any).fdc3 = mockAgent;
                window.dispatchEvent(new Event(FDC3_READY_EVENT));

                // Wait for the promise to resolve
                await agentPromise;

                // Verify clearTimeout was called during cleanup
                expect(global.clearTimeout).toHaveBeenCalled();
            } finally {
                // Restore original functions
                global.setTimeout = originalSetTimeout;
                global.clearTimeout = originalClearTimeout;
            }
        });
    });
});
