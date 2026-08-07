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
 * Every timeout here must stay under the fdc3-web client's own await timeouts (15000ms per request
 * family, 300000ms for the late raiseIntentResultResponse) - see BRIDGING_SERVER_DESIGN.md#Timeouts.
 */
export const BRIDGING_SERVER = {
    DEFAULT_HOST: '127.0.0.1',
    DEFAULT_PORT_RANGE: [4475, 4575] as [number, number],
    DESKTOP_AGENT_BRIDGE_VERSION: '1.2',
    SUPPORTED_FDC3_VERSIONS: ['2.0', '2.1', '2.2'] as string[],
    DEFAULT_AGENT_NAME: 'DesktopAgent',

    /** hello -> handshake budget. */
    HANDSHAKE_TIMEOUT_MS: 10000,
    /** findIntent / findIntentsByContext / findInstances / getAppMetadata - in-memory local lookups. */
    DISCOVERY_TIMEOUT_MS: 5000,
    /** open / raiseIntent phase 1 - the target may launch an app and await a listener. */
    TARGETED_TIMEOUT_MS: 12000,
    /** raiseIntentResultResponse relay: just under the client's 300000ms late-listener timeout, so the
     *  bridge (not the client) produces the error, with a meaningful code. */
    INTENT_RESULT_RELAY_TTL_MS: 290000,

    /** The client's own per-family await timeout - used only to validate configured timeouts leave headroom. */
    CLIENT_RESPONSE_TIMEOUT_MS: 15000,
    RESPONSE_HEADROOM_MS: 3000,

    /** consecutive unparseable messages tolerated on one socket before it is closed. */
    MAX_PARSE_FAILURES: 10,
} as const;
