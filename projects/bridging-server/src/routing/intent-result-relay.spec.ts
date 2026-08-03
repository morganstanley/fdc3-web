/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../agent-registry.js';
import { createAgentSession } from '../agent-session.js';
import { Logger } from '../logger.js';
import { FakeAgentConnection } from '../server-transport.fake.js';
import { IntentResultRelay } from './intent-result-relay.js';

const metadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };

function registerAgent(registry: AgentRegistry, name: string): FakeAgentConnection {
    const connection = new FakeAgentConnection(name);
    const session = createAgentSession(connection);
    registry.add(session);
    registry.register(session, name, metadata);
    return connection;
}

describe(`${IntentResultRelay.name}`, () => {
    let registry: AgentRegistry;
    let relay: IntentResultRelay;
    let originatorConnection: FakeAgentConnection;

    beforeEach(() => {
        registry = new AgentRegistry();
        originatorConnection = registerAgent(registry, 'AgentA');
        registerAgent(registry, 'AgentB');
        relay = new IntentResultRelay(registry, 290000, new Logger('error'));
    });

    it(`should relay a successful result to the originator as raiseIntentResultResponse`, () => {
        relay.open('req-1', 'AgentA', 'AgentB');

        relay.relay('req-1', { ok: { intentResult: { context: { type: 'fdc3.contact' } } } });

        expect(originatorConnection.sent).toEqual([
            {
                type: 'raiseIntentResultResponse',
                payload: { intentResult: { context: { type: 'fdc3.contact' } } },
                meta: { requestUuid: 'req-1', responseUuid: expect.any(String), timestamp: expect.any(Date) },
            },
        ]);
    });

    it(`should relay an error result, attributing it to the target agent`, () => {
        relay.open('req-1', 'AgentA', 'AgentB');

        relay.relay('req-1', { err: 'IntentHandlerRejected' });

        const response = originatorConnection.sent[0] as any;
        expect(response.type).toBe('raiseIntentResultResponse');
        expect(response.payload).toEqual({ error: 'IntentHandlerRejected' });
        expect(response.meta.errorSources).toEqual([{ desktopAgent: 'AgentB' }]);
        expect(response.meta.errorDetails).toEqual(['IntentHandlerRejected']);
    });

    it(`should drop a relay for an unknown or already-settled requestUuid, without throwing`, () => {
        expect(() => relay.relay('unknown-uuid', { ok: {} })).not.toThrow();
        expect(originatorConnection.sent.length).toBe(0);
    });

    it(`should only relay once - a second relay for the same requestUuid is a no-op`, () => {
        relay.open('req-1', 'AgentA', 'AgentB');

        relay.relay('req-1', { ok: { intentResult: {} } });
        relay.relay('req-1', { ok: { intentResult: { context: { type: 'should-not-appear' } } } });

        expect(originatorConnection.sent.length).toBe(1);
    });

    describe(`dropOnPhase1Error`, () => {
        it(`should tear down the entry silently - a later relay for it is dropped`, () => {
            relay.open('req-1', 'AgentA', 'AgentB');

            relay.dropOnPhase1Error('req-1');
            relay.relay('req-1', { ok: { intentResult: {} } });

            expect(originatorConnection.sent.length).toBe(0);
        });

        it(`should be a no-op for an unknown requestUuid`, () => {
            expect(() => relay.dropOnPhase1Error('unknown-uuid')).not.toThrow();
        });
    });

    describe(`handleAgentDisconnected`, () => {
        it(`should relay AgentDisconnected immediately when the target disconnects`, () => {
            relay.open('req-1', 'AgentA', 'AgentB');

            relay.handleAgentDisconnected('AgentB');

            const response = originatorConnection.sent[0] as any;
            expect(response.payload).toEqual({ error: 'AgentDisconnected' });
            expect(response.meta.errorSources).toEqual([{ desktopAgent: 'AgentB' }]);
        });

        it(`should silently discard the entry when the originator disconnects`, () => {
            relay.open('req-1', 'AgentA', 'AgentB');

            relay.handleAgentDisconnected('AgentA');
            relay.relay('req-1', { ok: { intentResult: {} } });

            expect(originatorConnection.sent.length).toBe(0);
        });

        it(`should not affect an unrelated entry`, () => {
            registerAgent(registry, 'AgentC');
            relay.open('req-1', 'AgentA', 'AgentB');

            relay.handleAgentDisconnected('AgentC');

            expect(originatorConnection.sent.length).toBe(0);
            // still live - a real relay for req-1 still works after the unrelated disconnect.
            relay.relay('req-1', { ok: { intentResult: {} } });
            expect(originatorConnection.sent.length).toBe(1);
        });
    });

    describe(`timeout`, () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it(`should relay ResponseToBridgeTimedOut once the TTL elapses`, () => {
            const shortRelay = new IntentResultRelay(registry, 1000, new Logger('error'));

            shortRelay.open('req-1', 'AgentA', 'AgentB');
            vi.advanceTimersByTime(1000);

            const response = originatorConnection.sent[0] as any;
            expect(response.payload).toEqual({ error: 'ResponseToBridgeTimedOut' });
        });

        it(`should not fire the timeout for an entry that already relayed`, () => {
            const shortRelay = new IntentResultRelay(registry, 1000, new Logger('error'));

            shortRelay.open('req-1', 'AgentA', 'AgentB');
            shortRelay.relay('req-1', { ok: { intentResult: {} } });

            expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
            expect(originatorConnection.sent.length).toBe(1);
        });
    });

    it(`should send nothing if the originator is no longer registered when relaying`, () => {
        relay.open('req-1', 'AgentA', 'AgentB');
        registry.remove(registry.getByName('AgentA')!);

        expect(() => relay.relay('req-1', { ok: { intentResult: {} } })).not.toThrow();
        expect(originatorConnection.sent.length).toBe(0);
    });
});
