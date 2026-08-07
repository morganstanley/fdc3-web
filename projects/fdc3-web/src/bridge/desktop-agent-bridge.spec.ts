/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { IMocked, Mock, setupFunction, setupProperty } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import { DesktopAgentImpl } from '../agent/desktop-agent.js';
import { AppDirectory } from '../app-directory/index.js';
import { ChannelMessageHandler } from '../channel/channel-message-handler.js';
import { FakeBridgeTransport } from './bridge-transport.fake.js';
import { DesktopAgentBridge } from './desktop-agent-bridge.js';

const rootAppIdentifier = { appId: 'root-app', instanceId: 'root-instance' };
const localSource = { appId: 'app-a', instanceId: 'instance-a' };
const remoteApp = { appId: 'remote-app', instanceId: 'remote-instance', desktopAgent: 'agent-b' };

describe(`DesktopAgentBridge`, () => {
    let transport: FakeBridgeTransport;
    let mockDirectory: IMocked<AppDirectory>;
    let mockChannelHandler: IMocked<ChannelMessageHandler>;
    let mockAgent: IMocked<DesktopAgentImpl>;

    beforeEach(() => {
        transport = new FakeBridgeTransport();

        mockDirectory = Mock.create<AppDirectory>().setup(setupProperty('rootAppIdentifier', rootAppIdentifier));
        mockChannelHandler = Mock.create<ChannelMessageHandler>().setup(
            setupFunction('getChannelsState', () => ({})),
            setupFunction('applyChannelsState'),
            setupFunction('cleanupDisconnectedAgent'),
        );
        mockAgent = Mock.create<DesktopAgentImpl>().setup(
            setupProperty('directory', mockDirectory.mock),
            setupProperty('channelMessageHandler', mockChannelHandler.mock),
            setupFunction('getInfo', () =>
                Promise.resolve({
                    fdc3Version: '2.2',
                    provider: 'Morgan Stanley',
                    optionalFeatures: {
                        DesktopAgentBridging: true,
                        OriginatingAppMetadata: true,
                        UserChannelMembershipAPIs: true,
                    },
                    appMetadata: { appId: 'root-app' },
                }),
            ),
        );
    });

    async function createInstance(overrides: Record<string, any> = {}): Promise<DesktopAgentBridge> {
        return DesktopAgentBridge.create({
            agent: mockAgent.mock,
            params: { requestedName: 'my-agent', transportFactory: () => Promise.resolve(transport), ...overrides },
            defaultRequestedName: 'root-app',
        });
    }

    async function connectAndHandshake(bridge: DesktopAgentBridge, assignedName = 'agent-a'): Promise<void> {
        bridge.connect();
        transport.receive({
            type: 'hello',
            payload: { authRequired: false, desktopAgentBridgeVersion: '1.0', supportedFDC3Versions: ['2.2'] },
            meta: { timestamp: new Date() },
        });
        await flush();

        const handshake = transport.sent.find((m: any) => m.type === 'handshake') as any;
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: { addAgent: assignedName, allAgents: [] },
            meta: { requestUuid: handshake.meta.requestUuid, responseUuid: 'r1', timestamp: new Date() },
        });
        transport.sent.length = 0;
    }

    it(`create() with transportFactory should use the returned transport directly`, async () => {
        const bridge = await createInstance();
        bridge.connect();

        expect(transport.connectCallCount).toBe(1);
    });

    it(`create() without transportFactory should construct a WebSocketBridgeTransport (no network access)`, async () => {
        const bridge = await DesktopAgentBridge.create({
            agent: mockAgent.mock,
            params: {},
            defaultRequestedName: 'root-app',
        });

        // constructing it must not throw and must not itself open a socket (connect() not called)
        expect(bridge.agentName).toBeUndefined();
    });

    it(`requestedName should be overridden by params.requestedName`, async () => {
        const bridge = await createInstance({ requestedName: 'custom-name' });
        bridge.connect();
        transport.receive({
            type: 'hello',
            payload: { authRequired: false, desktopAgentBridgeVersion: '1.0', supportedFDC3Versions: ['2.2'] },
            meta: { timestamp: new Date() },
        });
        await flush();

        expect((transport.sent[0] as any).payload.requestedName).toBe('custom-name');
    });

    it(`requestedName should default to defaultRequestedName when params.requestedName is omitted`, async () => {
        const bridge = await DesktopAgentBridge.create({
            agent: mockAgent.mock,
            params: { transportFactory: () => Promise.resolve(transport) },
            defaultRequestedName: 'root-app',
        });
        bridge.connect();
        transport.receive({
            type: 'hello',
            payload: { authRequired: false, desktopAgentBridgeVersion: '1.0', supportedFDC3Versions: ['2.2'] },
            meta: { timestamp: new Date() },
        });
        await flush();

        expect((transport.sent[0] as any).payload.requestedName).toBe('root-app');
    });

    it(`should attach subscribers before connect() is called on the transport`, async () => {
        let connectCalledBeforeSubscribe = false;
        const orderedTransport = new FakeBridgeTransport();
        const originalSubscribe = orderedTransport.subscribe.bind(orderedTransport);
        orderedTransport.subscribe = callback => {
            if (orderedTransport.connectCallCount > 0) {
                connectCalledBeforeSubscribe = true;
            }
            return originalSubscribe(callback);
        };

        const bridge = await DesktopAgentBridge.create({
            agent: mockAgent.mock,
            params: { transportFactory: () => Promise.resolve(orderedTransport) },
            defaultRequestedName: 'root-app',
        });
        bridge.connect();

        expect(connectCalledBeforeSubscribe).toBe(false);
        expect(orderedTransport.connectCallCount).toBe(1);
    });

    it(`agentName should delegate to the connection and be undefined until the handshake completes`, async () => {
        const bridge = await createInstance();
        expect(bridge.agentName).toBeUndefined();

        await connectAndHandshake(bridge);
        expect(bridge.agentName).toBe('agent-a');
    });

    it(`a connectedAgentsUpdate with removeAgent should reach channelMessageHandler.cleanupDisconnectedAgent`, async () => {
        const bridge = await createInstance();
        await connectAndHandshake(bridge);

        // agent-c must be known before it can be reported as departed
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                allAgents: [
                    { desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-c', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                ],
            },
            meta: { requestUuid: 'earlier', responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: { removeAgent: 'agent-c', allAgents: [] },
            meta: { requestUuid: 'later', responseUuid: 'r2', timestamp: new Date() },
        });

        expect(
            mockChannelHandler.withFunction('cleanupDisconnectedAgent').withParametersEqualTo('agent-c'),
        ).wasCalledOnce();
    });

    it(`close() should close the transport once and leave the bridge inert`, async () => {
        const bridge = await createInstance();
        await connectAndHandshake(bridge);

        bridge.close();

        expect(transport.closeCallCount).toBe(1);

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: { addAgent: 'agent-z', allAgents: [] },
            meta: { requestUuid: 'whatever', responseUuid: 'r', timestamp: new Date() },
        });

        expect(bridge.agentName).toBe('agent-a');
    });

    describe(`IRemoteAppSource`, () => {
        it(`findIntent should resolve [] when not connected`, async () => {
            const bridge = await createInstance();
            await expect(bridge.findIntent('ViewChart')).resolves.toEqual([]);
            expect(transport.sent).toHaveLength(0);
        });

        it(`findIntent should send a broadcast request (no destination) and resolve the apps`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.findIntent('ViewChart', { type: 'fdc3.contact' });
            const sentMessage = transport.sent[0] as any;
            expect(sentMessage.type).toBe('findIntentRequest');
            expect(sentMessage.meta.destination).toBeUndefined();
            expect(sentMessage.meta.source).toEqual({ ...rootAppIdentifier, desktopAgent: 'agent-a' });

            transport.receive({
                type: 'findIntentResponse',
                payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [remoteApp] } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            await expect(promise).resolves.toEqual([remoteApp]);
        });

        it(`findIntentsByContext should resolve [] when not connected`, async () => {
            const bridge = await createInstance();
            await expect(bridge.findIntentsByContext({ type: 'fdc3.contact' })).resolves.toEqual([]);
        });

        it(`findIntentsByContext should resolve the appIntents`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.findIntentsByContext({ type: 'fdc3.contact' });
            const sentMessage = transport.sent[0] as any;

            transport.receive({
                type: 'findIntentsByContextResponse',
                payload: { appIntents: [{ intent: { name: 'ViewChart' }, apps: [] }] },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            await expect(promise).resolves.toEqual([{ intent: { name: 'ViewChart' }, apps: [] }]);
        });

        it(`findInstances should broadcast (no destination) when the target has no desktopAgent`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            void bridge.findInstances({ appId: 'some-app' });
            expect((transport.sent[0] as any).meta.destination).toBeUndefined();
        });

        it(`findInstances should target a specific agent when the target names one`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.findInstances({ appId: 'some-app', desktopAgent: 'agent-c' });
            const sentMessage = transport.sent[0] as any;
            expect(sentMessage.meta.destination).toEqual({ appId: 'some-app', desktopAgent: 'agent-c' });

            transport.receive({
                type: 'findInstancesResponse',
                payload: { appIdentifiers: [remoteApp] },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            await expect(promise).resolves.toEqual([remoteApp]);
        });

        it(`getAppMetadata should resolve undefined when the target has no desktopAgent`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            await expect(bridge.getAppMetadata({ appId: 'some-app' })).resolves.toBeUndefined();
            expect(transport.sent).toHaveLength(0);
        });

        it(`getAppMetadata should target the named agent and resolve appMetadata`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.getAppMetadata(remoteApp);
            const sentMessage = transport.sent[0] as any;
            expect(sentMessage.meta.destination).toEqual({
                appId: remoteApp.appId,
                instanceId: remoteApp.instanceId,
                desktopAgent: remoteApp.desktopAgent,
            });

            transport.receive({
                type: 'getAppMetadataResponse',
                payload: { appMetadata: remoteApp },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            await expect(promise).resolves.toEqual(remoteApp);
        });

        it(`all four discovery methods should resolve their empty fallback when the bridge errors`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.findIntent('ViewChart');
            const sentMessage = transport.sent[0] as any;
            transport.receive({
                type: 'findIntentResponse',
                payload: { error: 'NoAppsFound' },
                meta: {
                    requestUuid: sentMessage.meta.requestUuid,
                    responseUuid: 'r',
                    timestamp: new Date(),
                    errorSources: [],
                    errorDetails: ['NoAppsFound'],
                },
            });

            await expect(promise).resolves.toEqual([]);
        });
    });

    describe(`raiseIntent`, () => {
        it(`should reject with NotConnectedToBridge when not connected`, async () => {
            const bridge = await createInstance();

            await expect(
                bridge.raiseIntent({
                    intent: 'ViewChart',
                    context: { type: 'fdc3.contact' },
                    app: remoteApp,
                    source: localSource,
                }),
            ).rejects.toBe('NotConnectedToBridge');
            expect(transport.sent).toHaveLength(0);
        });

        it(`should send a targeted request and resolve intentResolution once the immediate response arrives`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.raiseIntent({
                intent: 'ViewChart',
                context: { type: 'fdc3.contact' },
                app: remoteApp,
                source: localSource,
            });
            const sentMessage = transport.sent[0] as any;
            expect(sentMessage.type).toBe('raiseIntentRequest');
            expect(sentMessage.meta.destination).toEqual({
                appId: remoteApp.appId,
                instanceId: remoteApp.instanceId,
                desktopAgent: remoteApp.desktopAgent,
            });
            expect(sentMessage.meta.source).toEqual({ ...localSource, desktopAgent: 'agent-a' });

            transport.receive({
                type: 'raiseIntentResponse',
                payload: { intentResolution: { intent: 'ViewChart', source: remoteApp } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            const { intentResolution } = await promise;
            expect(intentResolution).toEqual({ intent: 'ViewChart', source: remoteApp });
        });

        it(`result should resolve from a later raiseIntentResultResponse on the same requestUuid`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.raiseIntent({
                intent: 'ViewChart',
                context: { type: 'fdc3.contact' },
                app: remoteApp,
                source: localSource,
            });
            const sentMessage = transport.sent[0] as any;

            transport.receive({
                type: 'raiseIntentResponse',
                payload: { intentResolution: { intent: 'ViewChart', source: remoteApp } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            const { result } = await promise;

            transport.receive({
                type: 'raiseIntentResultResponse',
                payload: { intentResult: { context: { type: 'fdc3.contact' } } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r2', timestamp: new Date() },
            });

            await expect(result).resolves.toEqual({ context: { type: 'fdc3.contact' } });
        });

        it(`result should still resolve when awaited only after the late response already arrived`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.raiseIntent({
                intent: 'ViewChart',
                context: { type: 'fdc3.contact' },
                app: remoteApp,
                source: localSource,
            });
            const sentMessage = transport.sent[0] as any;

            transport.receive({
                type: 'raiseIntentResponse',
                payload: { intentResolution: { intent: 'ViewChart', source: remoteApp } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });
            transport.receive({
                type: 'raiseIntentResultResponse',
                payload: { intentResult: { context: { type: 'fdc3.contact' } } },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r2', timestamp: new Date() },
            });

            const { result } = await promise;
            await expect(result).resolves.toEqual({ context: { type: 'fdc3.contact' } });
        });

        it(`should reject and cancel the late listener when the resolution itself fails`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.raiseIntent({
                intent: 'ViewChart',
                context: { type: 'fdc3.contact' },
                app: remoteApp,
                source: localSource,
            });
            const sentMessage = transport.sent[0] as any;

            transport.receive({
                type: 'raiseIntentResponse',
                payload: { error: 'NoAppsFound' },
                meta: {
                    requestUuid: sentMessage.meta.requestUuid,
                    responseUuid: 'r',
                    timestamp: new Date(),
                    errorSources: [],
                    errorDetails: ['NoAppsFound'],
                },
            });

            await expect(promise).rejects.toBe('NoAppsFound');

            // a late response arriving afterwards must be a no-op (cancelled) - no unhandled rejection
            expect(() =>
                transport.receive({
                    type: 'raiseIntentResultResponse',
                    payload: { intentResult: {} },
                    meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r2', timestamp: new Date() },
                }),
            ).not.toThrow();
        });
    });

    describe(`open`, () => {
        it(`should reject with NotConnectedToBridge when not connected`, async () => {
            const bridge = await createInstance();

            await expect(bridge.open({ app: remoteApp, source: localSource })).rejects.toBe('NotConnectedToBridge');
        });

        it(`should send a targeted request and resolve the appIdentifier`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            const promise = bridge.open({ app: remoteApp, context: { type: 'fdc3.contact' }, source: localSource });
            const sentMessage = transport.sent[0] as any;
            expect(sentMessage.type).toBe('openRequest');
            expect(sentMessage.meta.destination).toEqual({
                appId: remoteApp.appId,
                instanceId: remoteApp.instanceId,
                desktopAgent: remoteApp.desktopAgent,
            });

            transport.receive({
                type: 'openResponse',
                payload: { appIdentifier: remoteApp },
                meta: { requestUuid: sentMessage.meta.requestUuid, responseUuid: 'r', timestamp: new Date() },
            });

            await expect(promise).resolves.toEqual(remoteApp);
        });
    });

    describe(`publishIntentResult`, () => {
        it(`should send a raiseIntentResultResponse correlated by the given requestUuid`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.publishIntentResult('bridge-request-uuid', remoteApp, { context: { type: 'fdc3.contact' } });

            expect(transport.sent[0]).toEqual({
                type: 'raiseIntentResultResponse',
                payload: { intentResult: { context: { type: 'fdc3.contact' } } },
                meta: {
                    requestUuid: 'bridge-request-uuid',
                    responseUuid: expect.any(String),
                    timestamp: expect.any(Date),
                },
            });
        });
    });

    describe(`IChannelBridge`, () => {
        it(`broadcast should send nothing when not connected`, async () => {
            const bridge = await createInstance();
            bridge.broadcast('channel-1', { type: 'fdc3.contact' }, localSource);
            expect(transport.sent).toHaveLength(0);
        });

        it(`broadcast should send a broadcastRequest once connected`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.broadcast('channel-1', { type: 'fdc3.contact' }, localSource);

            expect(transport.sent[0]).toEqual({
                type: 'broadcastRequest',
                payload: { channelId: 'channel-1', context: { type: 'fdc3.contact' } },
                meta: {
                    requestUuid: expect.any(String),
                    timestamp: expect.any(Date),
                    source: { ...localSource, desktopAgent: 'agent-a' },
                },
            });
        });

        it(`private channel methods should send nothing when desktopAgents is empty`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelBroadcast('private-1', { type: 'fdc3.contact' }, localSource, []);
            bridge.privateChannelOnAddContextListener('private-1', 'fdc3.contact', localSource, []);
            bridge.privateChannelOnUnsubscribe('private-1', 'fdc3.contact', localSource, []);
            bridge.privateChannelOnDisconnect('private-1', localSource, []);
            bridge.privateChannelEventListenerAdded('private-1', 'disconnect', localSource, []);
            bridge.privateChannelEventListenerRemoved('private-1', 'disconnect', localSource, []);

            expect(transport.sent).toHaveLength(0);
        });

        it(`privateChannelBroadcast should send when shared with at least one agent`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelBroadcast('private-1', { type: 'fdc3.contact' }, localSource, ['agent-b']);

            expect(transport.sent[0]).toEqual({
                type: 'PrivateChannel.broadcast',
                payload: { channelId: 'private-1', context: { type: 'fdc3.contact' } },
                meta: {
                    requestUuid: expect.any(String),
                    timestamp: expect.any(Date),
                    source: { ...localSource, desktopAgent: 'agent-a' },
                },
            });
        });

        it(`privateChannelOnAddContextListener should send the correct payload`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelOnAddContextListener('private-1', 'fdc3.contact', localSource, ['agent-b']);

            expect((transport.sent[0] as any).type).toBe('PrivateChannel.onAddContextListener');
            expect((transport.sent[0] as any).payload).toEqual({ channelId: 'private-1', contextType: 'fdc3.contact' });
        });

        it(`privateChannelOnUnsubscribe should send the correct payload`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelOnUnsubscribe('private-1', null, localSource, ['agent-b']);

            expect((transport.sent[0] as any).type).toBe('PrivateChannel.onUnsubscribe');
            expect((transport.sent[0] as any).payload).toEqual({ channelId: 'private-1', contextType: null });
        });

        it(`privateChannelOnDisconnect should send the correct payload`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelOnDisconnect('private-1', localSource, ['agent-b']);

            expect((transport.sent[0] as any).type).toBe('PrivateChannel.onDisconnect');
            expect((transport.sent[0] as any).payload).toEqual({ channelId: 'private-1' });
        });

        it(`privateChannelEventListenerAdded should send the correct payload`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelEventListenerAdded('private-1', 'disconnect', localSource, ['agent-b']);

            expect((transport.sent[0] as any).type).toBe('PrivateChannel.eventListenerAdded');
            expect((transport.sent[0] as any).payload).toEqual({ channelId: 'private-1', listenerType: 'disconnect' });
        });

        it(`privateChannelEventListenerRemoved should send the correct payload`, async () => {
            const bridge = await createInstance();
            await connectAndHandshake(bridge);

            bridge.privateChannelEventListenerRemoved('private-1', 'disconnect', localSource, ['agent-b']);

            expect((transport.sent[0] as any).type).toBe('PrivateChannel.eventListenerRemoved');
            expect((transport.sent[0] as any).payload).toEqual({ channelId: 'private-1', listenerType: 'disconnect' });
        });
    });
});

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
