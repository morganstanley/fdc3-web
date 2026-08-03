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
import { BridgeInboundRouter } from './bridge-inbound.js';
import { FakeBridgeTransport } from './bridge-transport.fake.js';

const requestSource = { appId: 'remote-app', instanceId: 'remote-instance', desktopAgent: 'agent-b' };
const contact = { type: 'fdc3.contact', name: 'Joe Bloggs' };

describe(`BridgeInboundRouter`, () => {
    let transport: FakeBridgeTransport;
    let mockDirectory: IMocked<AppDirectory>;
    let mockChannelHandler: IMocked<ChannelMessageHandler>;
    let mockAgent: IMocked<DesktopAgentImpl>;

    beforeEach(() => {
        transport = new FakeBridgeTransport();

        mockDirectory = Mock.create<AppDirectory>().setup(
            setupFunction('getLocalAppIntent', () =>
                Promise.resolve({ intent: { name: 'ViewChart' }, apps: [{ appId: 'local-app' }] }),
            ),
            setupFunction('getLocalAppIntentsForContext', () =>
                Promise.resolve([{ intent: { name: 'ViewChart' }, apps: [{ appId: 'local-app' }] }]),
            ),
            setupFunction('getLocalAppInstances', () => Promise.resolve([{ appId: 'local-app', instanceId: 'i1' }])),
            setupFunction('getLocalAppMetadata', () => Promise.resolve({ appId: 'local-app' })),
        );

        mockChannelHandler = Mock.create<ChannelMessageHandler>().setup(
            setupFunction('applyRemoteBroadcast'),
            setupFunction('applyRemotePrivateChannelOnAddContextListener'),
            setupFunction('applyRemotePrivateChannelOnUnsubscribe'),
            setupFunction('applyRemotePrivateChannelOnDisconnect'),
            setupFunction('applyRemotePrivateChannelEventListenerAdded'),
            setupFunction('applyRemotePrivateChannelEventListenerRemoved'),
        );

        mockAgent = Mock.create<DesktopAgentImpl>().setup(
            setupProperty('directory', mockDirectory.mock),
            setupProperty('channelMessageHandler', mockChannelHandler.mock),
            setupFunction('open', () => Promise.resolve({ appId: 'local-app', instanceId: 'i1' })),
            setupFunction('raiseIntentFromRemote', () =>
                Promise.resolve({ intent: 'ViewChart', source: { appId: 'local-app', instanceId: 'i1' } }),
            ),
        );

        new BridgeInboundRouter({ transport, agent: mockAgent.mock });
    });

    function receive(type: string, payload: Record<string, any>, meta: Record<string, any> = {}): void {
        transport.receive({
            type,
            payload,
            meta: { requestUuid: 'request-uuid', timestamp: new Date(), source: requestSource, ...meta },
        });
    }

    describe(`findIntentRequest`, () => {
        it(`should call getLocalAppIntent and respond with findIntentResponse`, async () => {
            receive('findIntentRequest', { intent: 'ViewChart', context: contact });
            await flush();

            expect(mockDirectory.withFunction('getLocalAppIntent')).wasCalledOnce();
            expect(transport.sent[0]).toEqual({
                type: 'findIntentResponse',
                payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'local-app' }] } },
                meta: { requestUuid: 'request-uuid', responseUuid: expect.any(String), timestamp: expect.any(Date) },
            });
        });

        it(`should send MalformedContext without calling the directory for an invalid context`, async () => {
            receive('findIntentRequest', { intent: 'ViewChart', context: 'not-a-context' });
            await flush();

            expect(mockDirectory.withFunction('getLocalAppIntent')).wasNotCalled();
            expect((transport.sent[0] as any).payload).toEqual({ error: 'MalformedContext' });
        });

        it(`should map a thrown error to a valid FindInstancesErrors, defaulting to NoAppsFound`, async () => {
            mockDirectory.setupFunction('getLocalAppIntent', () => Promise.reject(new Error('boom')));

            receive('findIntentRequest', { intent: 'ViewChart' });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'NoAppsFound' });
        });

        it(`should pass through a valid thrown FindInstancesErrors value`, async () => {
            mockDirectory.setupFunction('getLocalAppIntent', () => Promise.reject('TargetAppUnavailable'));

            receive('findIntentRequest', { intent: 'ViewChart' });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'TargetAppUnavailable' });
        });
    });

    describe(`findIntentsByContextRequest`, () => {
        it(`should call getLocalAppIntentsForContext and respond`, async () => {
            receive('findIntentsByContextRequest', { context: contact });
            await flush();

            expect(mockDirectory.withFunction('getLocalAppIntentsForContext')).wasCalledOnce();
            expect((transport.sent[0] as any).type).toBe('findIntentsByContextResponse');
        });

        it(`should send MalformedContext for a missing context`, async () => {
            receive('findIntentsByContextRequest', {});
            await flush();

            expect(mockDirectory.withFunction('getLocalAppIntentsForContext')).wasNotCalled();
            expect((transport.sent[0] as any).payload).toEqual({ error: 'MalformedContext' });
        });
    });

    describe(`findInstancesRequest`, () => {
        it(`should respond with the local instances`, async () => {
            receive('findInstancesRequest', { app: { appId: 'local-app' } });
            await flush();

            expect(mockDirectory.withFunction('getLocalAppInstances')).wasCalledOnce();
            expect((transport.sent[0] as any).payload).toEqual({
                appIdentifiers: [{ appId: 'local-app', instanceId: 'i1' }],
            });
        });

        it(`should send NoAppsFound when the app is unknown locally`, async () => {
            mockDirectory.setupFunction('getLocalAppInstances', () => Promise.resolve(undefined));

            receive('findInstancesRequest', { app: { appId: 'unknown-app' } });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'NoAppsFound' });
        });
    });

    describe(`getAppMetadataRequest`, () => {
        it(`should strip desktopAgent before calling getLocalAppMetadata and respond`, async () => {
            receive('getAppMetadataRequest', { app: { appId: 'local-app', desktopAgent: 'agent-a' } });
            await flush();

            expect(mockDirectory.functionCallLookup.getLocalAppMetadata?.[0][0]).toEqual({
                appId: 'local-app',
                instanceId: undefined,
            });
            expect((transport.sent[0] as any).payload).toEqual({ appMetadata: { appId: 'local-app' } });
        });

        it(`should send TargetAppUnavailable when the app is unknown locally`, async () => {
            mockDirectory.setupFunction('getLocalAppMetadata', () => Promise.resolve(undefined));

            receive('getAppMetadataRequest', { app: { appId: 'unknown-app', desktopAgent: 'agent-a' } });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'TargetAppUnavailable' });
        });
    });

    describe(`openRequest`, () => {
        it(`should call agent.open and respond with the appIdentifier`, async () => {
            receive('openRequest', { app: { appId: 'local-app', desktopAgent: 'agent-a' }, context: contact });
            await flush();

            expect(mockAgent.functionCallLookup.open?.[0]).toEqual([
                { appId: 'local-app', instanceId: undefined },
                contact,
            ]);
            expect((transport.sent[0] as any).payload).toEqual({
                appIdentifier: { appId: 'local-app', instanceId: 'i1' },
            });
        });

        it(`should send MalformedContext for an invalid context without calling open`, async () => {
            receive('openRequest', { app: { appId: 'local-app' }, context: 'nope' });
            await flush();

            expect(mockAgent.withFunction('open')).wasNotCalled();
            expect((transport.sent[0] as any).payload).toEqual({ error: 'MalformedContext' });
        });

        it(`should map a rejection to a valid OpenErrorResponsePayload, defaulting to AppNotFound`, async () => {
            mockAgent.setupFunction('open', () => Promise.reject(new Error('boom')));

            receive('openRequest', { app: { appId: 'local-app' } });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'AppNotFound' });
        });
    });

    describe(`raiseIntentRequest`, () => {
        it(`should call agent.raiseIntentFromRemote with the source and respond with the resolution`, async () => {
            receive('raiseIntentRequest', {
                intent: 'ViewChart',
                context: contact,
                app: { appId: 'local-app', desktopAgent: 'agent-a' },
            });
            await flush();

            expect(mockAgent.functionCallLookup.raiseIntentFromRemote?.[0][0]).toEqual({
                requestUuid: 'request-uuid',
                intent: 'ViewChart',
                context: contact,
                app: { appId: 'local-app', instanceId: undefined },
                originatingApp: requestSource,
            });
            expect(transport.sent[0]).toEqual({
                type: 'raiseIntentResponse',
                payload: {
                    intentResolution: { intent: 'ViewChart', source: { appId: 'local-app', instanceId: 'i1' } },
                },
                meta: { requestUuid: 'request-uuid', responseUuid: expect.any(String), timestamp: expect.any(Date) },
            });
        });

        it(`should send MalformedContext without calling raiseIntentFromRemote for an invalid context`, async () => {
            receive('raiseIntentRequest', { intent: 'ViewChart', context: 'nope', app: { appId: 'local-app' } });
            await flush();

            expect(mockAgent.withFunction('raiseIntentFromRemote')).wasNotCalled();
            expect((transport.sent[0] as any).payload).toEqual({ error: 'MalformedContext' });
        });

        it(`should map a rejection to IntentDeliveryFailed by default`, async () => {
            mockAgent.setupFunction('raiseIntentFromRemote', () => Promise.reject(new Error('boom')));

            receive('raiseIntentRequest', { intent: 'ViewChart', context: contact, app: { appId: 'local-app' } });
            await flush();

            expect((transport.sent[0] as any).payload).toEqual({ error: 'IntentDeliveryFailed' });
        });
    });

    describe(`fire-and-forget families`, () => {
        it(`broadcastRequest should apply locally and send nothing back`, async () => {
            receive('broadcastRequest', { channelId: 'channel-1', context: contact });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemoteBroadcast')
                    .withParametersEqualTo('channel-1', contact, requestSource),
            ).wasCalledOnce();
            expect(transport.sent).toHaveLength(0);
        });

        it(`broadcastRequest with an invalid context should not apply and should send nothing`, async () => {
            receive('broadcastRequest', { channelId: 'channel-1', context: 'nope' });
            await flush();

            expect(mockChannelHandler.withFunction('applyRemoteBroadcast')).wasNotCalled();
            expect(transport.sent).toHaveLength(0);
        });

        it(`PrivateChannel.broadcast should apply locally via the same handler`, async () => {
            receive('PrivateChannel.broadcast', { channelId: 'private-1', context: contact });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemoteBroadcast')
                    .withParametersEqualTo('private-1', contact, requestSource),
            ).wasCalledOnce();
        });

        it(`PrivateChannel.onAddContextListener should apply locally`, async () => {
            receive('PrivateChannel.onAddContextListener', { channelId: 'private-1', contextType: 'fdc3.contact' });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemotePrivateChannelOnAddContextListener')
                    .withParametersEqualTo('private-1', 'fdc3.contact'),
            ).wasCalledOnce();
        });

        it(`PrivateChannel.onUnsubscribe should apply locally`, async () => {
            receive('PrivateChannel.onUnsubscribe', { channelId: 'private-1', contextType: null });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemotePrivateChannelOnUnsubscribe')
                    .withParametersEqualTo('private-1', null),
            ).wasCalledOnce();
        });

        it(`PrivateChannel.onDisconnect should apply locally`, async () => {
            receive('PrivateChannel.onDisconnect', { channelId: 'private-1' });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemotePrivateChannelOnDisconnect')
                    .withParametersEqualTo('private-1'),
            ).wasCalledOnce();
        });

        it(`PrivateChannel.eventListenerAdded should apply locally with the source's desktopAgent`, async () => {
            receive('PrivateChannel.eventListenerAdded', { channelId: 'private-1', listenerType: 'disconnect' });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemotePrivateChannelEventListenerAdded')
                    .withParametersEqualTo('private-1', 'agent-b'),
            ).wasCalledOnce();
        });

        it(`PrivateChannel.eventListenerRemoved should apply locally with the source's desktopAgent`, async () => {
            receive('PrivateChannel.eventListenerRemoved', { channelId: 'private-1', listenerType: 'disconnect' });
            await flush();

            expect(
                mockChannelHandler
                    .withFunction('applyRemotePrivateChannelEventListenerRemoved')
                    .withParametersEqualTo('private-1', 'agent-b'),
            ).wasCalledOnce();
        });
    });

    it(`should ignore a request whose meta.source lacks desktopAgent`, async () => {
        transport.receive({
            type: 'findIntentRequest',
            payload: { intent: 'ViewChart' },
            meta: { requestUuid: 'request-uuid', timestamp: new Date(), source: { appId: 'remote-app' } },
        });
        await flush();

        expect(mockDirectory.withFunction('getLocalAppIntent')).wasNotCalled();
        expect(transport.sent).toHaveLength(0);
    });

    it(`should ignore an unknown type, a response message, and a hello message`, async () => {
        transport.receive({
            type: 'findIntentResponse',
            payload: {},
            meta: { requestUuid: 'r', responseUuid: 'r2', timestamp: new Date() },
        });
        transport.receive({
            type: 'hello',
            payload: { desktopAgentBridgeVersion: '1.0' },
            meta: { timestamp: new Date() },
        });
        transport.receive({
            type: 'somethingUnknown',
            payload: {},
            meta: { requestUuid: 'r', timestamp: new Date(), source: requestSource },
        });
        await flush();

        expect(transport.sent).toHaveLength(0);
    });

    it(`close() should stop routing`, async () => {
        const router = new BridgeInboundRouter({ transport, agent: mockAgent.mock });
        router.close();

        receive('findIntentRequest', { intent: 'ViewChart' });
        await flush();

        // two routers are subscribed (the one from beforeEach, plus this one) - only the still-open
        // one from beforeEach should have responded once
        expect(transport.sent).toHaveLength(1);
    });
});

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
