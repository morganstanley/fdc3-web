/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { type BrowserTypes, ChannelError } from '@finos/fdc3';
import { describe, expect, it, vi } from 'vitest';
import { DesktopAgentProxy } from '../agent/desktop-agent-proxy.js';
import type { IRootPublisher } from '../contracts.internal.js';
import type { EventListenerLookup, IProxyIncomingMessageEnvelope, IProxyMessagingProvider } from '../contracts.js';
import { createResponseMessage } from '../helpers/messages.helper.js';
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
                    case 'addContextListenerRequest':
                        return server.onAddContextListenerRequest(request, app);
                    case 'broadcastRequest':
                        return server.onBroadcastRequest(request, app);
                    case 'getCurrentContextRequest':
                        return server.onGetCurrentContextRequest(request, app);
                    case 'clearContextRequest':
                        return server.onClearContextRequest(request, app);
                    case 'privateChannelAddEventListenerRequest':
                        return server.onPrivateChannelAddEventListenerRequest(request, app);
                    case 'privateChannelUnsubscribeEventListenerRequest':
                        return server.onPrivateChannelUnsubscribeEventListenerRequest(request, app);
                    case 'addEventListenerRequest': {
                        const key =
                            request.payload.type === 'USER_CHANNEL_CHANGED' ? 'userChannelChanged' : 'allEvents';
                        const listenerUUID = crypto.randomUUID();
                        (eventListeners[key] ??= []).push({ appIdentifier: app, listenerUUID });
                        publisher.publishResponseMessage(
                            createResponseMessage<BrowserTypes.AddEventListenerResponse>(
                                'addEventListenerResponse',
                                { listenerUUID },
                                request.meta.requestUuid,
                                app,
                            ),
                            app,
                        );
                        return;
                    }
                    case 'eventListenerUnsubscribeRequest':
                        for (const key of ['allEvents', 'userChannelChanged'] as const)
                            eventListeners[key] = eventListeners[key]?.filter(
                                listener => listener.listenerUUID !== request.payload.listenerUUID,
                            );
                        publisher.publishResponseMessage(
                            createResponseMessage<BrowserTypes.EventListenerUnsubscribeResponse>(
                                'eventListenerUnsubscribeResponse',
                                {},
                                request.meta.requestUuid,
                                app,
                            ),
                            app,
                        );
                        return;
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
    return { client, server, factory };
}

describe('context-cleared event delivery', () => {
    it('notifies both channel holders, clears only the requested type and supports unsubscribe', async () => {
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
        expect(localHandler).toHaveBeenCalledTimes(1);
        expect(otherHandler).not.toHaveBeenCalled();
        expect(await remote.getCurrentContext('fdc3.contact')).toBeNull();
        expect(await remote.getCurrentContext('fdc3.instrument')).toEqual({ type: 'fdc3.instrument' });
        await listener.unsubscribe();
        await channel.clearContext();
        expect(remoteHandler).toHaveBeenCalledTimes(1);
        expect(localHandler).toHaveBeenLastCalledWith({
            type: 'contextCleared',
            details: { channelId: 'shared', contextType: null },
        });
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
        await forbidden.addEventListener('contextCleared', forbiddenHandler);
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
