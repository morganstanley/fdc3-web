/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './agent-registry.js';
import { createAgentSession } from './agent-session.js';
import { FakeAgentConnection } from './server-transport.fake.js';

const metadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };

function newSession(id: string) {
    return createAgentSession(new FakeAgentConnection(id));
}

describe(`${AgentRegistry.name}`, () => {
    it(`should track a session by connection id before it is named`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');

        registry.add(session);

        expect(registry.getById('c1')).toBe(session);
    });

    it(`should assign the requested name when it is free`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);

        const name = registry.register(session, 'AgentA', metadata);

        expect(name).toBe('AgentA');
        expect(session.name).toBe('AgentA');
        expect(session.state).toBe('connected');
        expect(session.metadata).toEqual({ ...metadata, desktopAgent: 'AgentA' });
        expect(registry.getByName('AgentA')).toBe(session);
    });

    it(`should deterministically suffix a duplicate requested name with the first free integer`, () => {
        const registry = new AgentRegistry();
        const first = newSession('c1');
        const second = newSession('c2');
        const third = newSession('c3');
        registry.add(first);
        registry.add(second);
        registry.add(third);

        registry.register(first, 'AgentA', metadata);
        const secondName = registry.register(second, 'AgentA', metadata);
        const thirdName = registry.register(third, 'AgentA', metadata);

        expect(secondName).toBe('AgentA-1');
        expect(thirdName).toBe('AgentA-2');
    });

    it(`should fall back to the default agent name for an empty or whitespace-only requestedName`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);

        const name = registry.register(session, '   ', metadata);

        expect(name).toBe('DesktopAgent');
    });

    it(`should trim whitespace from a requested name`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);

        const name = registry.register(session, '  AgentA  ', metadata);

        expect(name).toBe('AgentA');
    });

    it(`should cap an excessively long requested name`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);
        const longName = 'x'.repeat(500);

        const name = registry.register(session, longName, metadata);

        expect(name.length).toBe(100);
    });

    it(`should remove a session from both maps on remove()`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);
        registry.register(session, 'AgentA', metadata);

        registry.remove(session);

        expect(registry.getById('c1')).toBeUndefined();
        expect(registry.getByName('AgentA')).toBeUndefined();
    });

    it(`should remove a not-yet-named session cleanly (no name to remove)`, () => {
        const registry = new AgentRegistry();
        const session = newSession('c1');
        registry.add(session);

        expect(() => registry.remove(session)).not.toThrow();
        expect(registry.getById('c1')).toBeUndefined();
    });

    it(`should list all connected sessions except the named one, in registration order`, () => {
        const registry = new AgentRegistry();
        const a = newSession('c1');
        const b = newSession('c2');
        const c = newSession('c3');
        [a, b, c].forEach(s => registry.add(s));
        registry.register(a, 'AgentA', metadata);
        registry.register(b, 'AgentB', metadata);
        registry.register(c, 'AgentC', metadata);

        const others = registry.allExcept('AgentB');

        expect(others.map(s => s.name)).toEqual(['AgentA', 'AgentC']);
    });

    it(`should include every connected session when allExcept is given an undefined name`, () => {
        const registry = new AgentRegistry();
        const a = newSession('c1');
        registry.add(a);
        registry.register(a, 'AgentA', metadata);

        expect(registry.allExcept(undefined).map(s => s.name)).toEqual(['AgentA']);
    });

    it(`should build the roster from connected agents' stamped metadata`, () => {
        const registry = new AgentRegistry();
        const a = newSession('c1');
        const b = newSession('c2');
        registry.add(a);
        registry.add(b);
        registry.register(a, 'AgentA', metadata);
        registry.register(b, 'AgentB', metadata);

        expect(registry.roster()).toEqual([
            { ...metadata, desktopAgent: 'AgentA' },
            { ...metadata, desktopAgent: 'AgentB' },
        ]);
    });

    it(`should expose connectedNames in registration order`, () => {
        const registry = new AgentRegistry();
        const a = newSession('c1');
        const b = newSession('c2');
        registry.add(a);
        registry.add(b);
        registry.register(a, 'AgentA', metadata);
        registry.register(b, 'AgentB', metadata);

        expect(registry.connectedNames).toEqual(['AgentA', 'AgentB']);
    });
});
