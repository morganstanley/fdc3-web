/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

/* ============================================================================
 * TEMPORARY FDC3 3.0 CODE — REMOVE WHEN @finos/fdc3 3.0 IS RELEASED
 * ----------------------------------------------------------------------------
 * The `fdc3.close()` API and its supporting DACP message types (`closeRequest`
 * / `closeResponse`) and the `CloseError` enumeration are part of FDC3 3.0 but
 * are not yet available from the `@finos/fdc3` (and `@finos/fdc3-schema`)
 * packages that this project depends on. Until we can upgrade to FDC3 3.0 the
 * types below are hand-maintained duplicates of the generated FDC3 3.0 types.
 *
 * Feature issue: https://github.com/finos/FDC3/issues/1809
 * Implementing PR: https://github.com/finos/FDC3/pull/1929
 *
 * TO REMOVE ONCE @finos/fdc3 3.0 IS INSTALLED:
 *  1. Delete this `fdc3-next` folder.
 *  2. Import `CloseRequest`, `CloseResponse`, `CloseError`,
 *     `isCloseRequest`, `isCloseResponse` from `@finos/fdc3` /
 *     `@finos/fdc3/schema` (via `BrowserTypes`) instead of from here.
 *  3. Replace `createCloseResponseMessage` usages with the standard
 *     `createResponseMessage` helper (the generated `CloseResponse` type will
 *     then be assignable to `BrowserTypes.AgentResponseMessage`).
 *  4. Remove the `close()` declaration from the `DesktopAgentNext` interface —
 *     it will be part of the base `DesktopAgent` interface.
 * ========================================================================== */

import type { BrowserTypes } from '@finos/fdc3';
import type { FullyQualifiedAppIdentifier } from '../contracts.js';
// Imported from the helpers barrel (not the submodules) so that unit tests which mock
// '../helpers/index.js' continue to produce deterministic uuids / timestamps here too.
import { generateUUID, getTimestamp } from '../helpers/index.js';

/**
 * Constants representing the errors that can be encountered when calling the `close` method on
 * the DesktopAgent object (`fdc3`).
 *
 * Mirrors the FDC3 3.0 `CloseError` enumeration.
 */
export enum CloseError {
    /** Returned if the Desktop Agent cannot close the app's window or frame. */
    ErrorOnClose = 'ErrorOnClose',

    /** Returned if a timeout occurs before a call to close is resolved for any reason other than the app being closed. */
    ApiTimeout = 'ApiTimeout',
}

/**
 * A request from an FDC3-enabled app to close its own window or frame.
 *
 * Mirrors the FDC3 3.0 generated `BrowserTypes.CloseRequest`.
 */
export interface CloseRequest {
    /**
     * Metadata for a request message sent by an FDC3-enabled app to a Desktop Agent.
     */
    meta: BrowserTypes.AddContextListenerRequestMeta;
    /**
     * The message payload typically contains the arguments to FDC3 API functions.
     */
    payload: CloseRequestPayload;
    /**
     * Identifies the type of the message.
     */
    type: 'closeRequest';
}

/**
 * The message payload for a close request. Close takes no arguments.
 */
export interface CloseRequestPayload {}

/**
 * A response to a close request. On a successful close the app is destroyed before a success
 * response can be delivered; only error responses are received by the app in that case.
 *
 * Mirrors the FDC3 3.0 generated `BrowserTypes.CloseResponse`.
 */
export interface CloseResponse {
    /**
     * Metadata for messages sent by a Desktop Agent to an app in response to an API call.
     */
    meta: BrowserTypes.AddContextListenerResponseMeta;
    /**
     * A payload for a response to an API call that will contain any return values or an `error`
     * property containing a standardized error message indicating that the request was unsuccessful.
     */
    payload: CloseResponsePayload;
    /**
     * Identifies the type of the message.
     */
    type: 'closeResponse';
}

/**
 * A payload for a response to a close request. Contains an `error` property if the request was
 * unsuccessful.
 */
export interface CloseResponsePayload {
    error?: CloseError;
}

/**
 * Returns true if the value has a type property with value 'closeRequest'.
 */
export function isCloseRequest(value: any): value is CloseRequest {
    return value != null && typeof value === 'object' && value.type === 'closeRequest';
}

/**
 * Returns true if the value has a type property with value 'closeResponse'.
 */
export function isCloseResponse(value: any): value is CloseResponse {
    return value != null && typeof value === 'object' && value.type === 'closeResponse';
}

/**
 * Builds a `closeResponse` message.
 *
 * This mirrors `createResponseMessage` but is required as a separate helper because the temporary
 * `CloseResponse` type is not (yet) part of the `BrowserTypes.AgentResponseMessage` union that
 * `createResponseMessage` is generically constrained to. Remove in favour of
 * `createResponseMessage` once FDC3 3.0 is installed.
 */
export function createCloseResponseMessage(
    payload: CloseResponsePayload,
    requestUuid: string,
    source: FullyQualifiedAppIdentifier,
): CloseResponse {
    return {
        meta: {
            responseUuid: generateUUID(),
            timestamp: getTimestamp(),
            requestUuid,
            source,
        },
        payload,
        type: 'closeResponse',
    };
}
