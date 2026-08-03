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
import { IAgentConnection } from './contracts.js';

export type AgentSessionState = 'awaiting-handshake' | 'connected';

/**
 * Per-socket state. A session exists (and is tracked by AgentRegistry) from the moment a connection
 * opens, before it has a name - this is what lets a pre-handshake socket be found and torn down by
 * connection id.
 */
export interface AgentSession {
    readonly connection: IAgentConnection;
    state: AgentSessionState;
    name?: string;
    metadata?: BridgingTypes.DesktopAgentImplementationMetadata;
    handshakeTimer?: ReturnType<typeof setTimeout>;
    /** Consecutive unparseable messages on this socket - see BRIDGING_SERVER.MAX_PARSE_FAILURES. */
    parseFailureCount: number;
}

export function createAgentSession(connection: IAgentConnection): AgentSession {
    return { connection, state: 'awaiting-handshake', parseFailureCount: 0 };
}
