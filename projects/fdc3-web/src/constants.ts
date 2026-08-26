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

export const FDC3_VERSION = '3.0.0';
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

/**
 * How long to wait, after opening an application via `fdc3.open()` with a context, for that
 * application to add a context listener capable of receiving the context before giving up and
 * responding with `OpenError.AppTimeout`.
 * https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#timeouts-for-message-exchanges
 * The FDC3 spec requires Desktop Agents to allow at least 15 seconds for this.
 */
export const APP_OPEN_CONTEXT_LISTENER_TIMEOUT_MS = 15000;

export const defaultBackoffRetry: Required<BackoffRetryParams> = {
    maxAttempts: 3,
    baseDelay: 250,
};
