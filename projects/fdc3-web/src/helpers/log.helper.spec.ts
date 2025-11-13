/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { GetAgentLogLevels, LogLevel } from '@finos/fdc3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './log.helper.js';

describe('log.helper', () => {
    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;
    const originalConsoleDebug = console.debug;
    let mockConsole: { log: any; info: any; warn: any; error: any; debug: any };

    // Test class to simulate real class instances
    class TestClass {
        constructor() {}
    }

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        console.log = mockConsole.log;
        console.info = mockConsole.info;
        console.warn = mockConsole.warn;
        console.error = mockConsole.error;
        console.debug = mockConsole.debug;
    });

    afterEach(() => {
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
        console.warn = originalConsoleWarn;
        console.error = originalConsoleError;
        console.debug = originalConsoleDebug;
    });

    describe('createLogger', () => {
        it('should create a logger that logs messages based on level', () => {
            // Create a logger with high enough log levels to ensure our messages get through
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };
            const logger = createLogger(TestClass, 'proxy', logLevels);

            // INFO level message should be logged
            logger('INFO message', LogLevel.INFO);
            expect(mockConsole.info).toHaveBeenCalled();

            // WARN level message should be logged
            logger('WARN message', LogLevel.WARN);
            expect(mockConsole.warn).toHaveBeenCalled();

            // ERROR level message should be logged
            logger('ERROR message', LogLevel.ERROR);
            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('should respect log level settings for connection messages', () => {
            // Set connection messages to WARN level only and disable proxy messages
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.WARN,
                proxy: LogLevel.NONE,
            };
            const logger = createLogger(TestClass, 'connection', logLevels);

            // DEBUG connection message should not be logged (below WARN level)
            logger('DEBUG message', LogLevel.DEBUG);
            expect(mockConsole.debug).not.toHaveBeenCalled();

            // INFO connection message should not be logged (below WARN level)
            logger('INFO message', LogLevel.INFO);
            expect(mockConsole.info).not.toHaveBeenCalled();

            // WARN connection message should be logged (at WARN level)
            logger('WARN message', LogLevel.WARN);
            expect(mockConsole.warn).toHaveBeenCalled();

            // ERROR connection message should be logged (above WARN level)
            logger('ERROR message', LogLevel.ERROR);
            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('should respect log level settings for proxy messages', () => {
            // Set proxy messages to ERROR level only and turn off connection messages
            const logLevels: GetAgentLogLevels = {
                proxy: LogLevel.ERROR,
                connection: LogLevel.NONE,
            };
            const logger = createLogger(TestClass, 'proxy', logLevels);

            // INFO proxy message should not be logged
            logger('INFO message', LogLevel.INFO);
            expect(mockConsole.info).not.toHaveBeenCalled();

            // WARN proxy message should not be logged
            logger('WARN message', LogLevel.WARN);
            expect(mockConsole.warn).not.toHaveBeenCalled();

            // ERROR proxy message should be logged
            logger('ERROR message', LogLevel.ERROR);
            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('should apply NONE log level properly', () => {
            // Set all messages to not be logged
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.NONE,
                proxy: LogLevel.NONE,
            };
            // Test both connection and proxy loggers
            const connectionLogger = createLogger(TestClass, 'connection', logLevels);
            const proxyLogger = createLogger(TestClass, 'proxy', logLevels);

            // Reset mock calls before each test assertion
            mockConsole.error.mockReset();

            // Connection message should not be logged
            connectionLogger('ERROR message', LogLevel.ERROR);
            expect(mockConsole.error).not.toHaveBeenCalled();

            // Reset again before next test
            mockConsole.error.mockReset();

            // Proxy message should not be logged
            proxyLogger('ERROR message', LogLevel.ERROR);
            expect(mockConsole.error).not.toHaveBeenCalled();
        });

        it('should handle logLevels with undefined properties', () => {
            // Create a logLevels object with undefined properties
            const logLevels: GetAgentLogLevels = {
                connection: undefined as any,
                proxy: undefined as any,
            };
            // Test both types of loggers
            const proxyLogger = createLogger(TestClass, 'proxy', logLevels);
            const connectionLogger = createLogger(TestClass, 'connection', logLevels);

            // Connection should fall back to default INFO level
            connectionLogger('test message', LogLevel.INFO);
            expect(mockConsole.info).toHaveBeenCalled();

            // Reset mock
            mockConsole.info.mockReset();

            // Proxy should fall back to default WARN level, so INFO shouldn't be logged
            proxyLogger('test message', LogLevel.INFO);
            expect(mockConsole.info).not.toHaveBeenCalled();

            // But WARN should be logged for proxy
            proxyLogger('test message', LogLevel.WARN);
            expect(mockConsole.warn).toHaveBeenCalled();
        });

        it('should handle DEBUG level messages correctly', () => {
            // Set log levels to allow DEBUG messages (which by default would be filtered out)
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };

            // Create loggers for both connection and proxy types
            const connectionLogger = createLogger(TestClass, 'connection', logLevels);
            const proxyLogger = createLogger(TestClass, 'proxy', logLevels);

            // Test DEBUG level messages
            connectionLogger('DEBUG message', LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalled();

            // Reset before testing proxy logger
            mockConsole.debug.mockReset();

            // Test proxy DEBUG messages
            proxyLogger('DEBUG message', LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalled();
        });

        it('should use console.log for unrecognized log levels', () => {
            // The LogLevel enum in @finos/fdc3 typically has these values:
            // DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3, NONE = 4

            // Instead of trying to be clever, let's just mock the functions directly
            // to verify the behavior
            const originalSwitch = console.log;

            try {
                // Create a logger with permissive settings
                const logLevels: GetAgentLogLevels = {
                    connection: LogLevel.ERROR,
                    proxy: LogLevel.ERROR,
                };

                // Override the console.log function directly to ensure it's called
                console.log = mockConsole.log;

                // Create a logger
                const logger = createLogger(TestClass, 'connection', logLevels);

                // Using a value that would normally be within the level range
                // but doesn't match any standard LogLevel enum values
                // We'll mock it to a value that ensures it passes the level check
                const mockValue = -99; // Something that will hit default case

                // Call the logger with our special value
                logger('Default message', mockValue as any);

                // Verify our mocked console.log was called
                expect(mockConsole.log).toHaveBeenCalled();
            } finally {
                // Restore the console.log function
                console.log = originalSwitch;
            }
        });

        it('should handle class names correctly', () => {
            // Create a logger with permissive settings
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };

            // Create a logger for the TestClass
            const logger = createLogger(TestClass, 'proxy', logLevels);
            const testMessage = 'Test message';
            logger(testMessage, LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalledWith(
                expect.stringContaining(`[TestClass] ${testMessage}`),
                window.location.href,
            );
        });

        it('should handle function names correctly', () => {
            // Create a logger with permissive settings
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };

            function TestFunction() {}

            // Create a logger for the TestFunction
            const logger = createLogger(TestFunction, 'proxy', logLevels);
            const testMessage = 'Test message';
            logger(testMessage, LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalledWith(
                expect.stringContaining(`[TestFunction] ${testMessage}`),
                window.location.href,
            );
        });

        it('should handle non-class/function names correctly', () => {
            // Create a logger with permissive settings
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };

            // Create a logger for a string
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            const logger = createLogger({ constructor: {} } as unknown as Function, 'proxy', logLevels);
            const testMessage = 'Test message';
            logger(testMessage, LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalledWith(
                expect.stringContaining(`[Unknown] ${testMessage}`),
                window.location.href,
            );
        });

        it('should handle null class names correctly', () => {
            // Create a logger with permissive settings
            const logLevels: GetAgentLogLevels = {
                connection: LogLevel.DEBUG,
                proxy: LogLevel.DEBUG,
            };

            // Create a logger for a null class name
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            const logger = createLogger(null as unknown as Function, 'proxy', logLevels);
            const testMessage = 'Test message';
            logger(testMessage, LogLevel.DEBUG);
            expect(mockConsole.debug).toHaveBeenCalledWith(
                expect.stringContaining(`[Unknown] ${testMessage}`),
                window.location.href,
            );
        });
    });
});
