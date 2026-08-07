/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes } from '@finos/fdc3';
import { isFindInstancesErrors, isOpenError, isRaiseIntentResultError } from '../helpers/index.js';

/**
 * Maps a value thrown by a local handler onto a valid BridgingTypes.FindInstancesErrors, falling
 * back to `fallback` when the thrown value isn't already a member of that enum. BrowserTypes and
 * BridgingTypes both define FindInstancesErrors as the same set of string literals, so the
 * existing (BrowserTypes-typed) predicate is reused rather than duplicated.
 */
export function toFindInstancesError(
    error: unknown,
    fallback: BridgingTypes.FindInstancesErrors,
): BridgingTypes.FindInstancesErrors {
    return isFindInstancesErrors(error) ? (error as BridgingTypes.FindInstancesErrors) : fallback;
}

/**
 * Maps a value thrown by a local handler onto a valid BridgingTypes.OpenErrorResponsePayload,
 * falling back to `fallback` otherwise. See toFindInstancesError for why the BrowserTypes predicate
 * is reused.
 */
export function toOpenError(
    error: unknown,
    fallback: BridgingTypes.OpenErrorResponsePayload,
): BridgingTypes.OpenErrorResponsePayload {
    return isOpenError(error) ? (error as BridgingTypes.OpenErrorResponsePayload) : fallback;
}

/**
 * Maps a value thrown/rejected by a local intent handler onto a valid
 * BridgingTypes.RaiseIntentResultErrorMessage, falling back to `fallback` otherwise.
 */
export function toRaiseIntentResultError(
    error: unknown,
    fallback: BridgingTypes.RaiseIntentResultErrorMessage,
): BridgingTypes.RaiseIntentResultErrorMessage {
    return isRaiseIntentResultError(error) ? error : fallback;
}
