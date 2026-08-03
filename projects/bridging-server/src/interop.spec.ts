/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

// @vitest-environment jsdom

import { AppIntent, Context, DesktopAgent } from '@finos/fdc3';
import { DesktopAgentFactory, WebSocketBridgeTransport } from '@morgan-stanley/fdc3-web';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as NodeWebSocket } from 'ws';
import { BridgingServer } from './bridging-server.js';

/**
 * Proves the real fdc3-web bridging client (built in projects/fdc3-web/src/bridge) and this real
 * server agree on the wire format, end to end over real localhost sockets - unit specs elsewhere in
 * this project exercise both sides in isolation against the documented wire contract, but only this
 * spec proves they actually interoperate.
 *
 * `bridge.connect()` is deliberately not awaited by the client (a slow/missing bridge must never
 * delay agent creation), so every assertion below polls rather than assuming the handshake has
 * completed the instant createRoot() resolves.
 */
async function waitUntil<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        let value: T;

        try {
            value = await fn();
        } catch (error) {
            // e.g. findIntent rejects with 'NoAppsFound' before the bridge handshake has completed -
            // that is a transient state to retry through, not a real failure.
            if (Date.now() > deadline) {
                throw error;
            }

            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
        }

        if (predicate(value)) {
            return value;
        }

        if (Date.now() > deadline) {
            throw new Error('waitUntil timed out');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

describe(`bridging interop (real client <-> real server)`, () => {
    let server: BridgingServer | undefined;
    const agents: DesktopAgent[] = [];

    afterEach(async () => {
        await server?.close();
        server = undefined;
        agents.length = 0;
    });

    /** Uses a real WebSocketBridgeTransport pointed at our real server's port, with a real `ws`
     *  socket as the client's own WebSocketFactory - this is the client's actual production
     *  transport, not a test double. portConnectTimeoutMs is raised well above the 750ms
     *  production default: under test-runner load a slow handshake round trip must not be mistaken
     *  for a dead port and trigger a reconnect, which would otherwise race a duplicate registration
     *  of the same agent against the bridge. */
    async function createAgent(
        rootAppId: string,
        port: number,
        listensFor?: Record<string, { contexts: string[] }>,
    ): Promise<DesktopAgent> {
        const agent = await new DesktopAgentFactory().createRoot({
            rootAppId,
            appDirectoryEntry: {
                title: rootAppId,
                type: 'web',
                details: { url: `https://${rootAppId.toLowerCase()}.example.com` },
                ...(listensFor != null ? { interop: { intents: { listensFor } } } : {}),
            },
            bridge: {
                transportFactory: () =>
                    Promise.resolve(
                        new WebSocketBridgeTransport({
                            portRange: [port, port],
                            portConnectTimeoutMs: 5000,
                            webSocketFactory: url => new NodeWebSocket(url) as unknown as WebSocket,
                        }),
                    ),
            },
        });

        agents.push(agent);
        return agent;
    }

    it(`should let one agent discover the other's app via findIntent, stamped with the remote desktopAgent name`, async () => {
        server = new BridgingServer({ portRange: [19200, 19210] });
        const { port } = await server.start();

        const agentA = await createAgent('AgentA', port);
        await createAgent('AgentB', port, { ViewChart: { contexts: ['fdc3.instrument'] } });

        const resolved = await waitUntil(
            () => agentA.findIntent('ViewChart'),
            (result: AppIntent) => result.apps.length > 0,
        );

        // AgentB's own local getAppIntent legitimately returns both a catalog-level match (from its
        // appDirectoryEntry) and an instance-level match (the already-running root itself) - that's
        // pre-existing, already-tested fdc3-web behaviour unrelated to the bridge. What this spec
        // proves is that the bridge relays and stamps every one of them correctly.
        expect(resolved.apps.length).toBeGreaterThan(0);
        resolved.apps.forEach(app => {
            expect(app).toMatchObject({ appId: 'AgentB@localhost', desktopAgent: 'AgentB' });
        });
    });

    it(`should propagate a user channel broadcast from one agent to the other`, async () => {
        server = new BridgingServer({ portRange: [19211, 19220] });
        const { port } = await server.start();

        const agentA = await createAgent('AgentA', port);
        const agentB = await createAgent('AgentB', port);

        await agentA.joinUserChannel('fdc3.channel.1');
        await agentB.joinUserChannel('fdc3.channel.1');

        const received: Context[] = [];
        agentB.addContextListener(null, (context: Context) => received.push(context));

        // retries the broadcast itself rather than waiting on a separate readiness signal - the
        // bridge silently no-ops a broadcast issued before its handshake completes, so this loop
        // is what actually waits out the handshake.
        const context: Context = { type: 'fdc3.instrument', id: { ticker: 'AAPL' } };
        await waitUntil(
            async () => {
                await agentA.broadcast(context);
                return received;
            },
            list => list.length > 0,
        );

        expect(received[0]).toEqual(context);
    });

    it(`should relay a raiseIntent round trip: resolution, delivery to the remote app's listener, and the intent result`, async () => {
        server = new BridgingServer({ portRange: [19221, 19230] });
        const { port } = await server.start();

        const agentA = await createAgent('AgentA', port);
        const agentB = await createAgent('AgentB', port, { ViewChart: { contexts: ['fdc3.instrument'] } });

        const resolved = await waitUntil(
            () => agentA.findIntent('ViewChart'),
            (result: AppIntent) => result.apps.some(app => app.instanceId != null),
        );

        let receivedContext: Context | undefined;
        agentB.addIntentListener('ViewChart', async (context: Context) => {
            receivedContext = context;
            return { type: 'fdc3.instrument', id: { ticker: 'RESULT' } };
        });

        // Targets the instance-level match (appId + instanceId) rather than the bare catalog-level
        // one: with an instanceId present, returnOrLaunchAppInstance on AgentB's side recognizes it
        // as already running and delivers directly to it, instead of trying to launch a brand new
        // instance (which would need a real window/iframe to open).
        const target = resolved.apps.find(app => app.instanceId != null);

        if (target == null) {
            throw new Error('expected findIntent to resolve an instance-level match for AgentB');
        }

        const context: Context = { type: 'fdc3.instrument', id: { ticker: 'AAPL' } };
        const resolution = await agentA.raiseIntent('ViewChart', context, target);

        expect(resolution.source.desktopAgent).toBe('AgentB');

        const result = await resolution.getResult();
        expect(receivedContext).toEqual(context);
        expect(result).toEqual({ type: 'fdc3.instrument', id: { ticker: 'RESULT' } });
    });
});
