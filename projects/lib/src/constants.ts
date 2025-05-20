/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BackoffRetryParams } from './contracts.js';

export const FDC3_VERSION = '2.2.0';
export const FDC3_PROVIDER = 'Morgan Stanley';

/**
 * timeout for waiting for window.fdc3 to be set.
 * https://fdc3.finos.org/docs/next/api/specs/webConnectionProtocol#12-desktop-agent-discovery
 */
export const DEFAULT_AGENT_DISCOVERY_TIMEOUT = 750;

export const FDC3_READY_EVENT = 'fdc3Ready';

/**
 * Constants for Desktop Agent Keep Alive functionality
 */
export const HEARTBEAT = {
    /**
     * Interval between heartbeat checks in milliseconds
     * 1500 milliseconds is a reasonable default for web applications
     */
    INTERVAL_MS: 1500,

    /**
     * Maximum number of failed heartbeat attempts before considering a proxy disconnected
     */
    MAX_TRIES: 3,

    /**
     * How long to wait for a heartbeat acknowledgment before considering it failed
     * 500 milliseconds gives enough time for the proxy browser Window or Frame to process the heartbeat
     */
    TIMEOUT_MS: 500,
} as const;

export const defaultBackoffRetry: Required<BackoffRetryParams> = {
    maxAttempts: 3,
    baseDelay: 250,
};
