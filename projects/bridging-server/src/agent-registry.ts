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
import { AgentSession } from './agent-session.js';
import { BRIDGING_SERVER } from './constants.js';

/**
 * Tracks every connected socket (by connection id, from the moment it opens - including before it
 * has a name) and every named agent (by assigned name, once handshaken). Iteration order of the
 * name-keyed map is insertion order, which is what makes collated responses deterministic given a
 * fixed roster (see BRIDGING_SERVER_DESIGN.md#Collation - "recipient-enumeration order").
 */
export class AgentRegistry {
    private readonly byId = new Map<string, AgentSession>();
    private readonly byName = new Map<string, AgentSession>();

    public add(session: AgentSession): void {
        this.byId.set(session.connection.id, session);
    }

    public remove(session: AgentSession): void {
        this.byId.delete(session.connection.id);

        if (session.name != null) {
            this.byName.delete(session.name);
        }
    }

    /**
     * Assigns a deterministic name (requestedName, then requestedName-1, requestedName-2, ... the
     * first free integer suffix) and marks the session connected. Deterministic so specs can assert
     * the exact allocated name.
     */
    public register(
        session: AgentSession,
        requestedName: string,
        implementationMetadata: Omit<BridgingTypes.DesktopAgentImplementationMetadata, 'desktopAgent'>,
    ): string {
        const name = this.allocateName(requestedName);

        session.name = name;
        session.state = 'connected';
        session.metadata = { ...implementationMetadata, desktopAgent: name };
        this.byName.set(name, session);

        return name;
    }

    public getByName(name: string): AgentSession | undefined {
        return this.byName.get(name);
    }

    public getById(id: string): AgentSession | undefined {
        return this.byId.get(id);
    }

    /** All connected sessions except the named one, in registration order. */
    public allExcept(name: string | undefined): AgentSession[] {
        return [...this.byName.values()].filter(session => session.name !== name);
    }

    public roster(): BridgingTypes.DesktopAgentImplementationMetadata[] {
        return [...this.byName.values()].map(
            session => session.metadata as BridgingTypes.DesktopAgentImplementationMetadata,
        );
    }

    public get connectedNames(): string[] {
        return [...this.byName.keys()];
    }

    private allocateName(requested: string): string {
        const trimmed = requested?.trim();
        const base = trimmed != null && trimmed.length > 0 ? trimmed.slice(0, 100) : BRIDGING_SERVER.DEFAULT_AGENT_NAME;

        if (!this.byName.has(base)) {
            return base;
        }

        let suffix = 1;

        while (this.byName.has(`${base}-${suffix}`)) {
            suffix++;
        }

        return `${base}-${suffix}`;
    }
}
