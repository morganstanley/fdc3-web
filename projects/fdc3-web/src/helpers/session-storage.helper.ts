/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX, DesktopAgentDetails, SessionStorageFormat } from '@finos/fdc3';

/**
 * Helpers for persisting and retrieving `DesktopAgentDetails` records in SessionStorage as
 * described by steps 1.1 and 3 of the FDC3 Web Connection Protocol. Records are keyed by the
 * `identityUrl` of the app so that multiple apps (or identities) sharing a window do not collide.
 *
 * @see https://fdc3.finos.org/docs/api/specs/webConnectionProtocol
 */

function readStore(): SessionStorageFormat {
    try {
        const raw = window.sessionStorage.getItem(DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX);
        if (raw == null) {
            return {};
        }
        return JSON.parse(raw) as SessionStorageFormat;
    } catch {
        // SessionStorage may be unavailable (e.g. sandboxed iframe) or contain corrupt data.
        return {};
    }
}

/**
 * Returns any previously persisted connection details for the supplied identity URL, or undefined
 * if none exist (i.e. this is the first connection attempt within this window's lifetime).
 */
export function getDesktopAgentDetails(identityUrl: string): DesktopAgentDetails | undefined {
    return readStore()[identityUrl];
}

/**
 * Persists connection details for the supplied identity URL so that a subsequent navigation or
 * refresh event can reconnect to the same Desktop Agent and reclaim the same instanceId.
 */
export function setDesktopAgentDetails(details: DesktopAgentDetails): void {
    try {
        const store = readStore();
        store[details.identityUrl] = details;
        window.sessionStorage.setItem(DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX, JSON.stringify(store));
    } catch {
        // SessionStorage may be unavailable; persistence is best-effort and its absence only means
        // that a future reconnection will be treated as a brand new connection.
    }
}
