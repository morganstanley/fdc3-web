/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

/**
 * Serializes a bridging message for transmission over the wire.
 */
export function serializeBridgeMessage(message: unknown): string {
    return JSON.stringify(message);
}

/**
 * Parses a message received over the wire, reviving `meta.timestamp` (sent as an ISO string) back
 * into a Date - every bridging type predicate asserts `meta.timestamp instanceof Date`, so without
 * this revival step every predicate would silently fail. Returns undefined for a non-JSON string;
 * passes non-string input through unchanged (some transports, e.g. mocked ones in tests, may
 * already deliver a parsed object).
 *
 * Deliberately duplicated from the fdc3-web client's identically named helper rather than imported:
 * this package must not depend on @morgan-stanley/fdc3-web (see BRIDGING_SERVER_DESIGN.md#Architecture).
 */
export function parseBridgeMessage(data: unknown): unknown {
    if (typeof data !== 'string') {
        return data;
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(data);
    } catch {
        return undefined;
    }

    if (parsed != null && typeof parsed === 'object' && 'meta' in parsed) {
        const meta = (parsed as { meta?: unknown }).meta;

        if (
            meta != null &&
            typeof meta === 'object' &&
            typeof (meta as { timestamp?: unknown }).timestamp === 'string'
        ) {
            (meta as { timestamp: Date }).timestamp = new Date((meta as { timestamp: string }).timestamp);
        }
    }

    return parsed;
}
