/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { type BrowserTypes, type Channel, ChannelError } from '@finos/fdc3';
import { describe, expect, it, vi } from 'vitest';
import { DesktopAgentProxy } from '../agent/desktop-agent-proxy.js';
import type { IRootPublisher } from '../contracts.internal.js';
import type { EventListenerLookup, IProxyIncomingMessageEnvelope, IProxyMessagingProvider } from '../contracts.js';
import { createRequestMessage } from '../helpers/messages.helper.js';
import { ChannelMessageHandler } from './channel-message-handler.js';
import { ChannelFactory } from './channels.factory.js';

function setup() {
    const receivers = new Map<string, ((message: IProxyIncomingMessageEnvelope) => void)[]>();
    const eventListeners: EventListenerLookup = {};
    const publisher: IRootPublisher = {
        sendMessage: () => {},
        addResponseHandler: () => {},
        awaitAppIdentity: async () => {
            throw new Error('unused');
        },
        publishResponseMessage: (payload, source) =>
            receivers.get(source.instanceId)?.forEach(callback => callback({ payload })),
        publishEvent: (payload, apps) =>
            apps.forEach(app => receivers.get(app.instanceId)?.forEach(callback => callback({ payload }))),
    };
    const server = new ChannelMessageHandler(publisher);
    const factory = new ChannelFactory();
    const client = (id: string) => {
        const app = { appId: `${id}@test`, instanceId: id };
        const callbacks: ((message: IProxyIncomingMessageEnvelope) => void)[] = [];
        receivers.set(id, callbacks);
        const provider: IProxyMessagingProvider = {
            addResponseHandler: callback => {
                callbacks.push(callback);
            },
            sendMessage: ({ payload: request }) => {
                switch (request.type) {
                    case 'getOrCreateChannelRequest':
                        return server.onGetOrCreateChannelRequest(request, app);
                    case 'createPrivateChannelRequest':
                        return server.onCreatePrivateChannelRequest(request, app);
                    case 'getUserChannelsRequest':
                        return server.onGetUserChannelsRequest(request, app);
                    case 'joinUserChannelRequest':
                        return server.onJoinUserChannelRequest(request, app, eventListeners);
                    case 'leaveCurrentChannelRequest':
                        return server.onLeaveCurrentChannelRequest(request, app, eventListeners);
                    case 'getCurrentChannelRequest':
                        return server.onGetCurrentChannelRequest(request, app);
                    case 'broadcastRequest':
                        return server.onBroadcastRequest(request, app);
                    case 'addContextListenerRequest':
                        return server.onAddContextListenerRequest(request, app);
                    case 'contextListenerUnsubscribeRequest':
                        return server.onContextListenerUnsubscribeRequest(request, app);
                    case 'privateChannelDisconnectRequest':
                        return server.onPrivateChannelDisconnectRequest(request, app);
                    case 'getCurrentContextRequest':
                        return server.onGetCurrentContextRequest(request, app);
                    case 'clearContextRequest':
                        return server.onClearContextRequest(request, app, eventListeners);
                    case 'privateChannelAddEventListenerRequest':
                        return server.onPrivateChannelAddEventListenerRequest(request, app);
                    case 'privateChannelUnsubscribeEventListenerRequest':
                        return server.onPrivateChannelUnsubscribeEventListenerRequest(request, app);
                    case 'addEventListenerRequest':
                        return server.onAddEventListenerRequest(request, app, eventListeners);
                    case 'eventListenerUnsubscribeRequest':
                        return server.onEventListenerUnsubscribeRequest(request, app, eventListeners);
                    default:
                        throw new Error(`Unexpected request: ${request.type}`);
                }
            },
        };
        return {
            app,
            provider,
            agent: new DesktopAgentProxy({ appIdentifier: app, messagingProvider: provider, channelFactory: factory }),
        };
    };
    return { client, server, factory, publisher, eventListeners };
}

describe('context-cleared event delivery', () => {
    it('notifies remote subscribers, excludes the caller and supports unsubscribe', async () => {
        const { client } = setup();
        const a = client('a'),
            b = client('b');
        const channel = await a.agent.getOrCreateChannel('shared');
        const remote = await b.agent.getOrCreateChannel('shared');
        const other = await b.agent.getOrCreateChannel('other');
        const localHandler = vi.fn(),
            remoteHandler = vi.fn(),
            otherHandler = vi.fn();
        await channel.addEventListener('contextCleared', localHandler);
        const listener = await remote.addEventListener(null, remoteHandler);
        await other.addEventListener(null, otherHandler);
        await channel.broadcast({ type: 'fdc3.contact' });
        await channel.broadcast({ type: 'fdc3.instrument' });
        await channel.clearContext('fdc3.contact');
        expect(remoteHandler).toHaveBeenCalledExactlyOnceWith({
            type: 'contextCleared',
            details: { channelId: 'shared', contextType: 'fdc3.contact' },
        });
        expect(localHandler).not.toHaveBeenCalled();
        expect(otherHandler).not.toHaveBeenCalled();
        expect(await remote.getCurrentContext('fdc3.contact')).toBeNull();
        expect(await remote.getCurrentContext('fdc3.instrument')).toEqual({ type: 'fdc3.instrument' });
        await listener.unsubscribe();
        await channel.clearContext();
        expect(remoteHandler).toHaveBeenCalledTimes(1);
        expect(localHandler).not.toHaveBeenCalled();
        expect(await remote.getCurrentContext()).toBeNull();
    });

    it('restricts private-channel events to authorized apps, including all-event listeners', async () => {
        const { client, server, factory } = setup();
        const a = client('a'),
            b = client('b'),
            outsider = client('outsider');
        const channel = await a.agent.createPrivateChannel();
        server.addToPrivateChannelAllowedList(channel.id, b.app);
        const remote = factory.createPrivateChannel({ id: channel.id, type: 'private' }, b.app, b.provider);
        const forbidden = factory.createPrivateChannel(
            { id: channel.id, type: 'private' },
            outsider.app,
            outsider.provider,
        );
        const authorizedHandler = vi.fn(),
            forbiddenHandler = vi.fn();
        const listener = await remote.addEventListener(null, authorizedHandler);
        await expect(forbidden.addEventListener('contextCleared', forbiddenHandler)).rejects.toThrow(
            ChannelError.AccessDenied,
        );
        await channel.clearContext();
        expect(authorizedHandler).toHaveBeenCalledExactlyOnceWith({
            type: 'contextCleared',
            details: { channelId: channel.id, contextType: null },
        });
        expect(forbiddenHandler).not.toHaveBeenCalled();
        await expect(forbidden.clearContext()).rejects.toBe(ChannelError.AccessDenied);
        await listener.unsubscribe();
        await channel.clearContext();
        expect(authorizedHandler).toHaveBeenCalledTimes(1);
    });

    it('replays existing private-channel listeners to an all-event subscription', async () => {
        const { client, server, factory } = setup();
        const a = client('a'),
            b = client('b');
        const channel = await a.agent.createPrivateChannel();
        server.addToPrivateChannelAllowedList(channel.id, b.app);
        const remote = factory.createPrivateChannel({ id: channel.id, type: 'private' }, b.app, b.provider);
        await channel.addContextListener('fdc3.contact', vi.fn());
        const handler = vi.fn();
        await remote.addEventListener(null, handler);
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'addContextListener',
                details: expect.objectContaining({ contextType: 'fdc3.contact' }),
            }),
        );
    });

    it.each([
        { type: 'contextCleared', leave: false },
        { type: 'contextCleared', leave: true },
        { type: null, leave: false },
        { type: null, leave: true },
    ] as const)('preserves membership changes during lookup: %j', async ({ type, leave }) => {
        const { client } = setup();
        const a = client('a'),
            b = client('b');
        const [first, second] = await a.agent.getUserChannels();
        await b.agent.joinUserChannel(first.id);
        // Keep an explicit handle subscribed so stale-channel events still reach this app.
        const oldChannel = await b.agent.getOrCreateChannel(first.id);
        await oldChannel.addEventListener('contextCleared', vi.fn());
        let resolveLookup!: (channel: Channel | null) => void;
        const lookup = vi.spyOn(b.agent, 'getCurrentChannel').mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveLookup = resolve;
                }),
        );
        const handler = vi.fn();
        const subscribing = b.agent.addEventListener(type, handler);
        await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
        if (leave) await b.agent.leaveCurrentChannel();
        else await b.agent.joinUserChannel(second.id);
        resolveLookup(first);
        const listener = await subscribing;
        handler.mockClear();
        await first.clearContext();
        expect(handler).not.toHaveBeenCalled();
        await second.clearContext();
        expect(handler).toHaveBeenCalledTimes(leave ? 0 : 1);
        if (!leave)
            expect(handler).toHaveBeenLastCalledWith({
                type: 'contextCleared',
                details: { channelId: second.id, contextType: null },
            });
        await listener.unsubscribe();
    });

    it.each(['subscription', 'lookup'] as const)('cleans up when membership %s fails', async failure => {
        const { client, publisher, server, eventListeners } = setup();
        const a = client('a');
        const error = ChannelError.AccessDenied;
        if (failure === 'subscription') {
            const register = server.onAddEventListenerRequest.bind(server);
            vi.spyOn(server, 'onAddEventListenerRequest').mockImplementation((request, app, listeners) => {
                if (request.payload.type === 'USER_CHANNEL_CHANGED') {
                    publisher.publishResponseMessage(
                        {
                            type: 'addEventListenerResponse',
                            meta: {
                                requestUuid: request.meta.requestUuid,
                                responseUuid: 'failed',
                                timestamp: new Date(),
                            },
                            payload: { error },
                        },
                        app,
                    );
                } else register(request, app, listeners);
            });
        } else vi.spyOn(a.agent, 'getCurrentChannel').mockRejectedValueOnce(error);
        const handler = vi.fn();
        const send = vi.spyOn(a.provider, 'sendMessage');
        await expect(a.agent.addEventListener('contextCleared', handler)).rejects.toBe(error);
        expect(Object.values(eventListeners).flat()).toHaveLength(0);
        expect(
            send.mock.calls.filter(([message]) => message.payload.type === 'eventListenerUnsubscribeRequest'),
        ).toHaveLength(failure === 'subscription' ? 1 : 2);
        publisher.publishEvent(
            {
                type: 'channelChangedEvent',
                meta: { eventUuid: 'change', timestamp: new Date() },
                payload: { currentChannelId: 'old' },
            },
            [a.app],
        );
        publisher.publishEvent(
            {
                type: 'contextClearedEvent',
                meta: { eventUuid: 'clear', timestamp: new Date() },
                payload: { channelId: 'old', contextType: null },
            },
            [a.app],
        );
        expect(handler).not.toHaveBeenCalled();
    });

    it('follows current-user-channel changes for DesktopAgent subscriptions', async () => {
        const { client } = setup();
        const a = client('a'),
            b = client('b');
        const [first, second] = await a.agent.getUserChannels();
        await b.agent.joinUserChannel(first.id);
        const handler = vi.fn();
        const listener = await b.agent.addEventListener('contextCleared', handler);
        await first.clearContext();
        expect(handler).toHaveBeenCalledTimes(1);
        await b.agent.joinUserChannel(second.id);
        await first.clearContext();
        expect(handler).toHaveBeenCalledTimes(1);
        await second.clearContext();
        expect(handler).toHaveBeenCalledTimes(2);
        await listener.unsubscribe();
        await second.clearContext();
        expect(handler).toHaveBeenCalledTimes(2);
    });
});

describe('array context listeners', () => {
    it('filters app-channel broadcasts, snapshots the filter and removes the whole registration', async () => {
        const { client, publisher } = setup();
        const published = vi.spyOn(publisher, 'publishEvent');
        const a = client('a'),
            b = client('b');
        const channel = await a.agent.getOrCreateChannel('shared');
        const remote = await b.agent.getOrCreateChannel('shared');
        await remote.broadcast({ type: 'fdc3.contact' });
        const handler = vi.fn();
        const types = ['fdc3.contact', 'fdc3.instrument', 'fdc3.contact'];
        const send = vi.spyOn(a.provider, 'sendMessage');
        const listener = await channel.addContextListener(types, handler);
        expect(handler).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: 'addContextListenerRequest',
                    payload: { channelId: 'shared', contextTypes: ['fdc3.contact', 'fdc3.instrument'] },
                }),
            }),
        );
        types.push('fdc3.portfolio');
        for (const type of ['fdc3.contact', 'fdc3.instrument', 'fdc3.portfolio']) await remote.broadcast({ type });
        expect(handler.mock.calls.map(([context]) => context.type)).toEqual(['fdc3.contact', 'fdc3.instrument']);
        expect(published.mock.calls.filter(([event]) => event.type === 'broadcastEvent')).toHaveLength(2);
        await listener.unsubscribe();
        published.mockClear();
        await remote.broadcast({ type: 'fdc3.contact' });
        expect(handler).toHaveBeenCalledTimes(2);
        expect(published).not.toHaveBeenCalled();
    });

    it('replays each matching type on user-channel registration and changes, then fully unsubscribes', async () => {
        const { client } = setup();
        const a = client('a'),
            b = client('b');
        const channels = await a.agent.getUserChannels();
        const first = await b.agent.getOrCreateChannel(channels[0].id);
        const second = await b.agent.getOrCreateChannel(channels[1].id);
        for (const channel of [first, second]) {
            await channel.broadcast({ type: 'fdc3.contact' });
            await channel.broadcast({ type: 'fdc3.instrument' });
            await channel.broadcast({ type: 'fdc3.portfolio' });
        }
        await a.agent.joinUserChannel(first.id);
        const handler = vi.fn();
        const listener = await a.agent.addContextListener(['fdc3.contact', 'fdc3.instrument'], handler);
        expect(handler.mock.calls.map(([context]) => context.type)).toEqual(['fdc3.contact', 'fdc3.instrument']);
        await a.agent.joinUserChannel(second.id);
        await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(4));
        await first.broadcast({ type: 'fdc3.contact' });
        await second.broadcast({ type: 'fdc3.portfolio' });
        expect(handler).toHaveBeenCalledTimes(4);
        await second.broadcast({ type: 'fdc3.instrument' });
        expect(handler).toHaveBeenCalledTimes(5);
        await listener.unsubscribe();
        await a.agent.joinUserChannel(first.id);
        await first.broadcast({ type: 'fdc3.contact' });
        expect(handler).toHaveBeenCalledTimes(5);
    });

    it('reports each private-channel filter on registration, late event subscription and unsubscribe', async () => {
        const { client } = setup();
        const a = client('a');
        const channel = await a.agent.createPrivateChannel();
        const events = vi.fn();
        await channel.addEventListener(null, events);
        const listener = await channel.addContextListener(['fdc3.contact', 'fdc3.instrument'], vi.fn());
        expect(events.mock.calls.map(([event]) => event.details.contextType)).toEqual([
            'fdc3.contact',
            'fdc3.instrument',
        ]);
        const lateEvents = vi.fn();
        await channel.addEventListener('addContextListener', lateEvents);
        expect(lateEvents.mock.calls.map(([event]) => event.details.contextType)).toEqual([
            'fdc3.contact',
            'fdc3.instrument',
        ]);
        events.mockClear();
        await listener.unsubscribe();
        expect(events.mock.calls.map(([event]) => [event.type, event.details.contextType])).toEqual([
            ['unsubscribe', 'fdc3.contact'],
            ['unsubscribe', 'fdc3.instrument'],
        ]);
    });

    it('rejects empty arrays for the agent and channels without registering a listener', async () => {
        const { client } = setup();
        const a = client('a');
        const channel = await a.agent.getOrCreateChannel('shared');
        const send = vi.spyOn(a.provider, 'sendMessage');
        await expect(a.agent.addContextListener([], vi.fn())).rejects.toThrow('InvalidArguments');
        await expect(channel.addContextListener([], vi.fn())).rejects.toThrow('InvalidArguments');
        expect(send).not.toHaveBeenCalled();
    });

    it('rejects invalid wire filters and notifies open-context waiters of each accepted type', async () => {
        const { server, publisher, client } = setup();
        const a = client('a');
        const response = vi.spyOn(publisher, 'publishResponseMessage');
        const callback = vi.fn();
        await server.addListenerCallback('open-waiter', callback);
        for (const filter of [{}, { contextTypes: [] }, { contextType: null, contextTypes: ['fdc3.contact'] }]) {
            server.onAddContextListenerRequest(
                createRequestMessage<BrowserTypes.AddContextListenerRequest>('addContextListenerRequest', a.app, {
                    channelId: null,
                    ...filter,
                }),
                a.app,
            );
            expect(response).toHaveBeenLastCalledWith(
                expect.objectContaining({ payload: { error: 'InvalidArguments' } }),
                a.app,
            );
        }
        expect(callback).not.toHaveBeenCalled();
        server.onAddContextListenerRequest(
            createRequestMessage<BrowserTypes.AddContextListenerRequest>('addContextListenerRequest', a.app, {
                channelId: null,
                contextTypes: ['fdc3.contact', 'fdc3.instrument'],
            }),
            a.app,
        );
        expect(callback.mock.calls).toEqual([
            [a.app, 'fdc3.contact'],
            [a.app, 'fdc3.instrument'],
        ]);
    });
});

describe('scoped event registration', () => {
    it('registers channel handles over DACP and delivers once per app with multiple subscribers', async () => {
        const { client, factory, publisher } = setup();
        const a = client('a'),
            b = client('b'),
            idle = client('idle');
        const channel = await b.agent.getOrCreateChannel('shared');
        await idle.agent.getOrCreateChannel('shared');
        // A has no tracked getOrCreateChannel call: the subscription itself determines delivery.
        const remote = factory.createPublicChannel({ id: channel.id, type: 'app' }, a.app, a.provider);
        const one = vi.fn(),
            two = vi.fn();
        const send = vi.spyOn(a.provider, 'sendMessage');
        const first = await remote.addEventListener('contextCleared', one);
        const second = await remote.addEventListener(null, two);
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: 'addEventListenerRequest',
                    payload: { type: 'CONTEXT_CLEARED', channelId: 'shared' },
                }),
            }),
        );
        const publish = vi.spyOn(publisher, 'publishEvent');
        await channel.clearContext();
        expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'contextClearedEvent' }), [
            a.app,
        ]);
        expect(one).toHaveBeenCalledTimes(1);
        expect(two).toHaveBeenCalledTimes(1);
        await first.unsubscribe();
        await channel.clearContext();
        expect(one).toHaveBeenCalledTimes(1);
        expect(two).toHaveBeenCalledTimes(2);
        await second.unsubscribe();
        publish.mockClear();
        await channel.clearContext();
        expect(publish).not.toHaveBeenCalled();
    });

    it('keeps agent scope separate from fixed channel handles after switching and leaving user channels', async () => {
        const { client } = setup();
        const a = client('a'),
            b = client('b');
        const [first, second] = await b.agent.getUserChannels();
        await a.agent.joinUserChannel(first.id);
        const agentHandler = vi.fn(),
            channelHandler = vi.fn();
        await a.agent.addEventListener('contextCleared', agentHandler);
        const handle = await a.agent.getOrCreateChannel(first.id);
        await handle.addEventListener('contextCleared', channelHandler);
        await first.clearContext();
        expect(agentHandler).toHaveBeenCalledTimes(1);
        expect(channelHandler).toHaveBeenCalledTimes(1);
        await a.agent.joinUserChannel(second.id);
        await first.clearContext();
        expect(agentHandler).toHaveBeenCalledTimes(1);
        expect(channelHandler).toHaveBeenCalledTimes(2);
        await second.clearContext();
        expect(agentHandler).toHaveBeenCalledTimes(2);
        await a.agent.leaveCurrentChannel();
        await second.clearContext();
        expect(agentHandler).toHaveBeenCalledTimes(2);
    });

    it('does not leak membership events into channel-scoped all-event subscriptions', async () => {
        const { client, publisher } = setup();
        const a = client('a');
        const [channel] = await a.agent.getUserChannels();
        const handler = vi.fn();
        await channel.addEventListener(null, handler);
        const publish = vi.spyOn(publisher, 'publishEvent');
        await a.agent.joinUserChannel(channel.id);
        expect(publish).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects unknown channels and removes the local callback after failed registration', async () => {
        const { client, factory, publisher } = setup();
        const a = client('a');
        const channel = factory.createPublicChannel({ id: 'missing', type: 'app' }, a.app, a.provider);
        const handler = vi.fn();
        await expect(channel.addEventListener('contextCleared', handler)).rejects.toThrow(ChannelError.NoChannelFound);
        publisher.publishEvent(
            {
                type: 'contextClearedEvent',
                meta: { eventUuid: 'event', timestamp: new Date() },
                payload: { channelId: 'missing', contextType: null },
            },
            [a.app],
        );
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not allow another app to remove a scoped subscription', async () => {
        const { client, server, eventListeners } = setup();
        const a = client('a'),
            b = client('b');
        const channel = await a.agent.getOrCreateChannel('shared');
        const remote = await b.agent.getOrCreateChannel('shared');
        const handler = vi.fn();
        await channel.addEventListener('contextCleared', handler);
        const listenerUUID = eventListeners.contextCleared![0].listenerUUID;
        server.onEventListenerUnsubscribeRequest(
            createRequestMessage<BrowserTypes.EventListenerUnsubscribeRequest>(
                'eventListenerUnsubscribeRequest',
                b.app,
                { listenerUUID },
            ),
            b.app,
            eventListeners,
        );
        await remote.clearContext();
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('user-channel event details', () => {
    it.each(['userChannelChanged', null] as const)(
        'exposes currentChannelId before join resolves for %s listeners',
        async type => {
            const { client } = setup();
            const a = client('a');
            const [first, second] = await a.agent.getUserChannels();
            const handler = vi.fn();
            const listener = await a.agent.addEventListener(type, handler);
            const joining = a.agent.joinUserChannel(first.id);
            await joining.then(() =>
                expect(handler).toHaveBeenLastCalledWith({
                    type: 'userChannelChanged',
                    details: { currentChannelId: first.id },
                }),
            );
            await a.agent.joinUserChannel(second.id);
            expect(handler).toHaveBeenLastCalledWith({
                type: 'userChannelChanged',
                details: { currentChannelId: second.id },
            });
            await a.agent.leaveCurrentChannel();
            expect(handler).toHaveBeenLastCalledWith({
                type: 'userChannelChanged',
                details: { currentChannelId: null },
            });
            await listener.unsubscribe();
            await a.agent.joinUserChannel(first.id);
            expect(handler).toHaveBeenCalledTimes(3);
        },
    );
});
