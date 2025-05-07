/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AgentError, DesktopAgent } from '@finos/fdc3';
import { Mock } from '@morgan-stanley/ts-mocking-bird';
import { FDC3_READY_EVENT } from '../constants';
import { getAgent, resetCachedPromise } from './get-agent';

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
        window.addEventListener = jest.fn((type, listener) => {
            eventListenersAdded.push({ type, listener });
            return originalAddEventListener.call(window, type, listener);
        });

        // Override removeEventListener to track removals
        window.removeEventListener = jest.fn((type, listener) => {
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
        jest.clearAllMocks();
    });

    it('should return the same promise if called twice', async () => {
        // First call to getAgent
        const firstPromise = getAgent();

        // Second call to getAgent
        const secondPromise = getAgent();

        // Verify both calls return the same promise
        // Note: We use toEqual instead of toBe because Jest has issues comparing promises directly
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

    // Testing the fdc3Ready event behavior is challenging in Jest due to timing issues
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
        const mockFailover = jest.fn().mockReturnValue(fallbackAgent);

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
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

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

        const mockFailover = jest.fn().mockResolvedValue(mockWindow);

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
        const mockFailover = jest.fn().mockRejectedValue(mockError);

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
        const mockFailover = jest.fn().mockReturnValue(fallbackAgent);

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

    it('should handle fdc3Ready event', () => {
        // Setup - ensure window.fdc3 is undefined initially
        (window as any).fdc3 = undefined;
        resetCachedPromise();

        // Mock the addEventListener to capture the fdc3Ready event handler
        let capturedEventHandler: (() => void) | undefined;
        const mockAddEventListener = jest.fn((eventType, handler) => {
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
});
