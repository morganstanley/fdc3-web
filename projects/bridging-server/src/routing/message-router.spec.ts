/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../agent-registry.js';
import { AgentSession, createAgentSession } from '../agent-session.js';
import { ChannelsState } from '../channels-state.js';
import { BRIDGING_SERVER } from '../constants.js';
import { Logger } from '../logger.js';
import { FakeAgentConnection } from '../server-transport.fake.js';
import { IntentResultRelay } from './intent-result-relay.js';
import { MessageRouter } from './message-router.js';
import { PendingRequests } from './pending-requests.js';
import { REQUEST_ROUTES } from './request-routes.js';

const metadata = { fdc3Version: '2.2', provider: 'test', optionalFeatures: {} as any };

function registerAgent(
    registry: AgentRegistry,
    name: string,
): { connection: FakeAgentConnection; session: AgentSession } {
    const connection = new FakeAgentConnection(name);
    const session = createAgentSession(connection);
    registry.add(session);
    registry.register(session, name, metadata);
    return { connection, session };
}

describe(`${MessageRouter.name}`, () => {
    function createInstance() {
        const registry = new AgentRegistry();
        const channelsState = new ChannelsState();
        const logger = new Logger('error');
        const pendingRequests = new PendingRequests(registry, logger);
        const intentResultRelay = new IntentResultRelay(registry, BRIDGING_SERVER.INTENT_RESULT_RELAY_TTL_MS, logger);
        const router = new MessageRouter(
            REQUEST_ROUTES,
            registry,
            channelsState,
            pendingRequests,
            intentResultRelay,
            logger,
        );

        return { registry, channelsState, pendingRequests, intentResultRelay, router };
    }

    describe(`responses`, () => {
        it(`should route a non-raiseIntentResultResponse response to pendingRequests.recordResponse`, () => {
            const { registry, pendingRequests, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentB');
            const spy = vi.spyOn(pendingRequests, 'recordResponse');

            router.handle(session, {
                type: 'findIntentResponse',
                payload: { appIntent: { apps: [] } },
                meta: { requestUuid: 'req-1', responseUuid: 'r1', timestamp: new Date() },
            });

            expect(spy).toHaveBeenCalledWith('req-1', 'AgentB', { ok: { appIntent: { apps: [] } } });
        });

        it(`should record an error-shaped response as {err}`, () => {
            const { registry, pendingRequests, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentB');
            const spy = vi.spyOn(pendingRequests, 'recordResponse');

            router.handle(session, {
                type: 'openResponse',
                payload: { error: 'AppNotFound' },
                meta: { requestUuid: 'req-1', responseUuid: 'r1', timestamp: new Date() },
            });

            expect(spy).toHaveBeenCalledWith('req-1', 'AgentB', { err: 'AppNotFound' });
        });

        it(`should route raiseIntentResultResponse to intentResultRelay.relay, never to pendingRequests`, () => {
            const { registry, pendingRequests, intentResultRelay, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentB');
            const relaySpy = vi.spyOn(intentResultRelay, 'relay');
            const pendingSpy = vi.spyOn(pendingRequests, 'recordResponse');

            router.handle(session, {
                type: 'raiseIntentResultResponse',
                payload: { intentResult: { context: { type: 'fdc3.contact' } } },
                meta: { requestUuid: 'req-1', responseUuid: 'r1', timestamp: new Date() },
            });

            expect(relaySpy).toHaveBeenCalledWith('req-1', {
                ok: { intentResult: { context: { type: 'fdc3.contact' } } },
            });
            expect(pendingSpy).not.toHaveBeenCalled();
        });

        it(`should not confuse a raiseIntentResultResponse for a duplicate raiseIntentResponse under the same requestUuid`, () => {
            const { registry, pendingRequests, intentResultRelay, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentB');
            const relaySpy = vi.spyOn(intentResultRelay, 'relay');
            const pendingSpy = vi.spyOn(pendingRequests, 'recordResponse');

            router.handle(session, {
                type: 'raiseIntentResponse',
                payload: { intentResolution: { intent: 'ViewChart', source: { appId: 'app1' } } },
                meta: { requestUuid: 'req-1', responseUuid: 'r1', timestamp: new Date() },
            });
            router.handle(session, {
                type: 'raiseIntentResultResponse',
                payload: { intentResult: {} },
                meta: { requestUuid: 'req-1', responseUuid: 'r2', timestamp: new Date() },
            });

            expect(pendingSpy).toHaveBeenCalledTimes(1);
            expect(pendingSpy).toHaveBeenCalledWith('req-1', 'AgentB', expect.anything());
            expect(relaySpy).toHaveBeenCalledTimes(1);
            expect(relaySpy).toHaveBeenCalledWith('req-1', expect.anything());
        });
    });

    describe(`fanout requests`, () => {
        it(`should forward broadcastRequest to every other connected agent, never the originator, and update channelsState`, () => {
            const { registry, channelsState, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            const { connection: connectionB } = registerAgent(registry, 'AgentB');
            const { connection: connectionC } = registerAgent(registry, 'AgentC');

            router.handle(sessionA, {
                type: 'broadcastRequest',
                payload: { channelId: 'channel1', context: { type: 'fdc3.instrument' } },
                meta: { requestUuid: 'req-1', timestamp: new Date(), source: { appId: 'app1', instanceId: 'i1' } },
            });

            expect(connectionB.sent).toHaveLength(1);
            expect(connectionC.sent).toHaveLength(1);
            const forwarded = connectionB.sent[0] as any;
            expect(forwarded.type).toBe('broadcastRequest');
            expect(forwarded.meta.source).toEqual({ appId: 'app1', instanceId: 'i1', desktopAgent: 'AgentA' });
            expect(channelsState.toWireFormat()).toEqual({ channel1: [{ type: 'fdc3.instrument' }] });
        });

        it(`should not update channelsState for PrivateChannel.broadcast`, () => {
            const { registry, channelsState, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            registerAgent(registry, 'AgentB');

            router.handle(sessionA, {
                type: 'PrivateChannel.broadcast',
                payload: { channelId: 'private1', context: { type: 'fdc3.instrument' } },
                meta: { requestUuid: 'req-1', timestamp: new Date(), source: { appId: 'app1', instanceId: 'i1' } },
            });

            expect(channelsState.toWireFormat()).toEqual({});
        });

        it(`should forward only to the destination when meta.destination is present`, () => {
            const { registry, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            const { connection: connectionB } = registerAgent(registry, 'AgentB');
            const { connection: connectionC } = registerAgent(registry, 'AgentC');

            router.handle(sessionA, {
                type: 'PrivateChannel.onDisconnect',
                payload: { channelId: 'private1' },
                meta: {
                    requestUuid: 'req-1',
                    timestamp: new Date(),
                    source: { appId: 'app1' },
                    destination: { desktopAgent: 'AgentB' },
                },
            });

            expect(connectionB.sent).toHaveLength(1);
            expect(connectionC.sent).toHaveLength(0);
        });

        it(`should silently send nothing when a targeted fanout names an unconnected agent`, () => {
            const { registry, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');

            expect(() =>
                router.handle(sessionA, {
                    type: 'PrivateChannel.onDisconnect',
                    payload: { channelId: 'private1' },
                    meta: {
                        requestUuid: 'req-1',
                        timestamp: new Date(),
                        destination: { desktopAgent: 'NoSuchAgent' },
                    },
                }),
            ).not.toThrow();
        });

        it(`should never trust an agent-supplied source.desktopAgent - it is always overwritten from the session`, () => {
            const { registry, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            const { connection: connectionB } = registerAgent(registry, 'AgentB');

            router.handle(sessionA, {
                type: 'broadcastRequest',
                payload: { channelId: 'channel1', context: { type: 'fdc3.instrument' } },
                meta: {
                    requestUuid: 'req-1',
                    timestamp: new Date(),
                    source: { appId: 'app1', desktopAgent: 'NotAgentA' },
                },
            });

            expect((connectionB.sent[0] as any).meta.source.desktopAgent).toBe('AgentA');
        });
    });

    describe(`request/response requests`, () => {
        it(`should forward to every other agent and open a pending collation when meta.destination is absent`, () => {
            const { registry, pendingRequests, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            const { connection: connectionB } = registerAgent(registry, 'AgentB');
            const spy = vi.spyOn(pendingRequests, 'open');

            router.handle(sessionA, {
                type: 'findIntentRequest',
                payload: { intent: 'ViewChart' },
                meta: { requestUuid: 'req-1', timestamp: new Date(), source: { appId: 'app1' } },
            });

            expect(connectionB.sent).toHaveLength(1);
            expect(spy).toHaveBeenCalledWith(
                expect.objectContaining({ requestUuid: 'req-1', originator: 'AgentA', recipients: ['AgentB'] }),
            );
        });

        it(`should forward only to the destination and open a single-recipient pending collation`, () => {
            const { registry, pendingRequests, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            const { connection: connectionB } = registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            const spy = vi.spyOn(pendingRequests, 'open');

            router.handle(sessionA, {
                type: 'getAppMetadataRequest',
                payload: { app: { appId: 'app1', desktopAgent: 'AgentB' } },
                meta: {
                    requestUuid: 'req-1',
                    timestamp: new Date(),
                    destination: { appId: 'app1', desktopAgent: 'AgentB' },
                },
            });

            expect(connectionB.sent).toHaveLength(1);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['AgentB'] }));
        });

        it(`should respond immediately with DesktopAgentNotFound when the destination is not connected, opening no pending collation`, () => {
            const { registry, pendingRequests, router } = createInstance();
            const { session: sessionA, connection: connectionA } = registerAgent(registry, 'AgentA');
            const spy = vi.spyOn(pendingRequests, 'open');

            router.handle(sessionA, {
                type: 'openRequest',
                payload: { app: { appId: 'app1', desktopAgent: 'Ghost' } },
                meta: {
                    requestUuid: 'req-1',
                    timestamp: new Date(),
                    destination: { appId: 'app1', desktopAgent: 'Ghost' },
                },
            });

            expect(spy).not.toHaveBeenCalled();
            expect(connectionA.sent).toEqual([
                {
                    type: 'openResponse',
                    payload: { error: 'DesktopAgentNotFound' },
                    meta: {
                        requestUuid: 'req-1',
                        responseUuid: expect.any(String),
                        timestamp: expect.any(Date),
                        errorSources: [{ desktopAgent: 'Ghost' }],
                        errorDetails: ['DesktopAgentNotFound'],
                    },
                },
            ]);
        });

        it(`should open an intent result relay for a single-target raiseIntentRequest`, () => {
            const { registry, intentResultRelay, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            registerAgent(registry, 'AgentB');
            const spy = vi.spyOn(intentResultRelay, 'open');

            router.handle(sessionA, {
                type: 'raiseIntentRequest',
                payload: {
                    intent: 'ViewChart',
                    context: { type: 'fdc3.instrument' },
                    app: { appId: 'app1', desktopAgent: 'AgentB' },
                },
                meta: {
                    requestUuid: 'req-1',
                    timestamp: new Date(),
                    source: { appId: 'callerApp' },
                    destination: { appId: 'app1', desktopAgent: 'AgentB' },
                },
            });

            expect(spy).toHaveBeenCalledWith('req-1', 'AgentA', 'AgentB');
        });

        it(`should not open an intent result relay for a non-compliant raiseIntentRequest with no destination (multi-recipient)`, () => {
            const { registry, intentResultRelay, router } = createInstance();
            const { session: sessionA } = registerAgent(registry, 'AgentA');
            registerAgent(registry, 'AgentB');
            registerAgent(registry, 'AgentC');
            const spy = vi.spyOn(intentResultRelay, 'open');

            router.handle(sessionA, {
                type: 'raiseIntentRequest',
                payload: { intent: 'ViewChart', context: { type: 'fdc3.instrument' }, app: { appId: 'app1' } },
                meta: { requestUuid: 'req-1', timestamp: new Date(), source: { appId: 'callerApp' } },
            });

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe(`malformed messages`, () => {
        it(`should drop an unroutable message and increment parseFailureCount`, () => {
            const { registry, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentA');

            router.handle(session, { type: 'somethingWeird', payload: {} });

            expect(session.parseFailureCount).toBe(1);
        });

        it(`should drop undefined (an unparseable-JSON delivery) without throwing`, () => {
            const { registry, router } = createInstance();
            const { session } = registerAgent(registry, 'AgentA');

            expect(() => router.handle(session, undefined)).not.toThrow();
            expect(session.parseFailureCount).toBe(1);
        });

        it(`should close the connection once MAX_PARSE_FAILURES consecutive malformed messages accumulate`, () => {
            const { registry, router } = createInstance();
            const { session, connection } = registerAgent(registry, 'AgentA');
            const closeSpy = vi.spyOn(connection, 'close');

            for (let i = 0; i < BRIDGING_SERVER.MAX_PARSE_FAILURES; i++) {
                router.handle(session, { type: 'somethingWeird' });
            }

            expect(closeSpy).toHaveBeenCalled();
        });
    });
});
