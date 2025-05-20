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

/**
 * Enum defining the type of messages being logged
 * This provides explicit control over which log level setting to apply
 */
export type MessageType = 'connection' | 'proxy';

/**
 * Extracts a meaningful name from a class or function
 * @param classOrFunction - The class or function to get the name from
 * @returns The class name or a string representation of the function
 * @throws Will return 'Unknown' if the class or function cannot be identified
 */
function getClassName(classOrFunction: ClassOrFunction): string {
    if (!classOrFunction) {
        return 'Unknown';
    }

    // If it's a class constructor/function with a name property
    if (typeof classOrFunction === 'function' && classOrFunction.name) {
        return classOrFunction.name;
    }

    return 'Unknown';
}

/**
 * Creates a logger with specified options
 * @param classType - The class, or function to identify the logger source
 *                          This can be a class constructor or function
 * @param messageTypeOrLogLevels - Either MessageType indicating whether logs are connection or proxy related,
 *                                 or log level settings (for backward compatibility)
 * @param logLevels - Optional settings to control logging behavior
 * @returns A logger function
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type ClassOrFunction = { new (...args: any[]): any } | Function;

export function createLogger(
    classType: ClassOrFunction,
    messageType: MessageType,
    logLevels?: GetAgentLogLevels,
): (message: string, level?: LogLevel, ...optionalParams: any[]) => void {
    // Extract the class name to use as a preface
    const preface = getClassName(classType);

    return (message: string, level?: LogLevel, ...optionalParams: any[]) => {
        // Default log level is INFO for connection messages, WARN for everything else
        let effectiveLogLevel = messageType === 'connection' ? LogLevel.INFO : LogLevel.WARN;

        // Apply user configuration if available
        if (logLevels) {
            if (messageType === 'connection' && logLevels.connection !== undefined) {
                effectiveLogLevel = logLevels.connection;
            } else if (messageType === 'proxy' && logLevels.proxy !== undefined) {
                effectiveLogLevel = logLevels.proxy;
            }
        }

        // Determine numeric level of current message
        let messageLevel = LogLevel.INFO; // Default if not provided
        if (level !== undefined) {
            messageLevel = level;
        }

        // Skip if message level is higher than effective level or if level is NONE
        if (messageLevel > effectiveLogLevel || effectiveLogLevel === LogLevel.NONE) {
            return;
        }

        message = `[${preface}] ${message}`;
        optionalParams = [...optionalParams, window.location.href];

        // Output based on message level
        switch (messageLevel) {
            case LogLevel.DEBUG:
                console.debug(message, ...optionalParams);
                break;
            case LogLevel.INFO:
                console.info(message, ...optionalParams);
                break;
            case LogLevel.WARN:
                console.warn(message, ...optionalParams);
                break;
            case LogLevel.ERROR:
                console.error(message, ...optionalParams);
                break;
            default:
                console.log(message, ...optionalParams);
                break;
        }
    };
}
