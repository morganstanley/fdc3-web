/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, ChannelError, Context, PrivateChannelEventTypes } from '@finos/fdc3';
import { IRootPublisher } from '../contracts.internal.js';
import { EventListenerLookup, FullyQualifiedAppIdentifier } from '../contracts.js';
import { convertToPrivateChannelEventTypes } from '../helpers/event-type.helper.js';
import {
    appInstanceEquals,
    createEvent,
    createRequestMessage,
    createResponseMessage,
    generateUUID,
    isContext,
    isNonEmptyArray,
} from '../helpers/index.js';
import { recommendedChannels } from './default-channels.js';

//uses 'allEvents' constant instead of null to signify app is listening to all events as null cannot be used as an index
type PrivateChannelEventListenerKey = PrivateChannelEventTypes | 'allEvents';
type PrivateChannelEventListener = {
    channelId: string;
    listenerUUID: string;
    source: FullyQualifiedAppIdentifier;
};
//uses 'currentChannel' constant instead of null to signify context listener is listening to contexts on current channel as null cannot be used as an index
type ContextListenerKey = string | 'currentChannel';
type ChannelContextListener = {
    contextType: string | null; //null for contextType indicates listener is for all contexts
    listenerUUID: string;
    source: FullyQualifiedAppIdentifier;
};
type ContextHistory = {
    mostRecent?: Context;
    byContext: Partial<Record<string, Context>>;
};
//allowedList is used to keep track of apps that have requested or provided the Private Channel to prevent external apps from listening to or publishing on it
type ChannelContextHistory = {
    channel: BrowserTypes.Channel;
    contextHistory: ContextHistory;
};
type PrivateChannelInfo = ChannelContextHistory & { allowedList: FullyQualifiedAppIdentifier[] };

/**
 * responds to all channel related Request messages
 * stores all state for channels across all agents and proxies
 */
export class ChannelMessageHandler {
    private currentUserChannels: Partial<Record<string, BrowserTypes.Channel>> = {}; //indexed by instanceId
    private userChannels: Partial<Record<string, ChannelContextHistory>> = {}; //indexed by channelId
    //we have decided to never dispose of appChannels and privateChannels due to inability of knowing when apps have removed all references to channels
    private appChannels: Partial<Record<string, ChannelContextHistory>> = {}; //indexed by channelId
    private privateChannels: Partial<Record<string, PrivateChannelInfo>> = {}; //indexed by channelId

    private readonly privateChannelEventListeners: Partial<
        Record<PrivateChannelEventListenerKey, PrivateChannelEventListener[]>
    > = {};

    private readonly contextListeners: Partial<Record<ContextListenerKey, ChannelContextListener[]>> = {}; //indexed by channelId
    protected readonly contextListenerCallbacks: Map<
        string,
        (source: FullyQualifiedAppIdentifier, contextType: string | null) => void
    >;

    constructor(private messagingProvider: IRootPublisher) {
        this.contextListenerCallbacks = new Map<
            string,
            (source: FullyQualifiedAppIdentifier, contextType: string | null) => void
        >();
    }

    public async addListenerCallback(
        callbackUuid: string,
        listenerCallback: (source: FullyQualifiedAppIdentifier, contextType: string | null) => void,
    ): Promise<void> {
        this.contextListenerCallbacks.set(callbackUuid, listenerCallback);
    }

    public async removeListenerCallback(callbackUuid: string): Promise<void> {
        this.contextListenerCallbacks.delete(callbackUuid);
    }

    private onContextListenerCreation(source: FullyQualifiedAppIdentifier, contextType: string | null): void {
        this.contextListenerCallbacks.forEach(callback => callback(source, contextType));
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagentl
    public onGetUserChannelsRequest(
        requestMessage: BrowserTypes.GetUserChannelsRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //user channels available are those defined by the FDC3 spec and stored in recommendedChannels
        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.GetUserChannelsResponse>(
                'getUserChannelsResponse',
                { userChannels: recommendedChannels },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onGetCurrentChannelRequest(
        requestMessage: BrowserTypes.GetCurrentChannelRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.GetCurrentChannelResponse>(
                'getCurrentChannelResponse',
                { channel: this.currentUserChannels[source.instanceId] ?? null },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onJoinUserChannelRequest(
        requestMessage: BrowserTypes.JoinUserChannelRequest,
        source: FullyQualifiedAppIdentifier,
        eventListeners: EventListenerLookup,
    ): void {
        const channel = recommendedChannels.find(channel => channel.id === requestMessage.payload.channelId);

        if (channel == null) {
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.JoinUserChannelResponse>(
                    'joinUserChannelResponse',
                    { error: ChannelError.NoChannelFound },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
        }

        this.currentUserChannels[source.instanceId] = channel;

        //only send ChannelChangedEvent when origin app is listening for them
        if (this.isListeningForChannelChangedEvent(eventListeners, source)) {
            this.publishChannelChangedEvent(requestMessage.payload.channelId, source);
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.JoinUserChannelResponse>(
                'joinUserChannelResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onLeaveCurrentChannelRequest(
        requestMessage: BrowserTypes.LeaveCurrentChannelRequest,
        source: FullyQualifiedAppIdentifier,
        eventListeners: EventListenerLookup,
    ): void {
        this.currentUserChannels = { ...this.currentUserChannels, [source.instanceId]: undefined };

        //only send ChannelChangedEvent when origin app is listening for them
        if (this.isListeningForChannelChangedEvent(eventListeners, source)) {
            this.publishChannelChangedEvent(null, source);
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.LeaveCurrentChannelResponse>(
                'leaveCurrentChannelResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    /**
     * Checks whether source app is listening for ChannelChangedEvents on given channel
     */
    private isListeningForChannelChangedEvent(
        eventListeners: EventListenerLookup,
        source: FullyQualifiedAppIdentifier,
    ): boolean {
        return (
            (eventListeners['userChannelChanged']?.some(listenerPair =>
                appInstanceEquals(listenerPair.appIdentifier, source),
            ) ||
                eventListeners['allEvents']?.some(listenerPair =>
                    appInstanceEquals(listenerPair.appIdentifier, source),
                )) ??
            false
        );
    }

    /**
     * Publishes a ChannelChangedEvent to the origin app
     * @param newChannelId is the channelId of the user channel the user has joined or null if the user is now not joined to a user channel;
     * @param messagingProvider is used to publish the event
     * @param source is the appIdentifier of the origin app
     */
    private publishChannelChangedEvent(newChannelId: string | null, source: FullyQualifiedAppIdentifier): void {
        this.messagingProvider.publishEvent(
            createEvent<BrowserTypes.ChannelChangedEvent>('channelChangedEvent', {
                newChannelId,
            }),
            [source],
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#privatechannel
    public onPrivateChannelAddEventListenerRequest(
        requestMessage: BrowserTypes.PrivateChannelAddEventListenerRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        if (!this.isAppAllowedOnChannel(source, requestMessage.payload.privateChannelId)) {
            //origin app is not allowed to listen on given private channel
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.PrivateChannelAddEventListenerResponse>(
                    'privateChannelAddEventListenerResponse',
                    { error: ChannelError.AccessDenied },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        const eventType =
            requestMessage.payload.listenerType === null
                ? 'allEvents'
                : convertToPrivateChannelEventTypes(requestMessage.payload.listenerType);
        const listeners =
            this.privateChannelEventListeners[eventType] ?? (this.privateChannelEventListeners[eventType] = []);

        const listenerUUID = generateUUID();

        //add new eventListener to array of eventListeners for that PrivateChannelEventType
        listeners.push({ channelId: requestMessage.payload.privateChannelId, listenerUUID, source });

        if (eventType === 'addContextListener') {
            //publish PrivateChannelOnAddContextListenerEvents for all contextListeners already added to the channel
            this.contextListeners[requestMessage.payload.privateChannelId]?.forEach(listener =>
                this.publishPrivateChannelOnAddContextListenerEvent(
                    requestMessage.payload.privateChannelId,
                    listener.contextType,
                    [source],
                ),
            );
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.PrivateChannelAddEventListenerResponse>(
                'privateChannelAddEventListenerResponse',
                { listenerUUID },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#privatechannel
    public onPrivateChannelUnsubscribeEventListenerRequest(
        requestMessage: BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //get eventType of listener being removed
        const eventType = Object.entries(this.privateChannelEventListeners).find(([_, listeners]) =>
            listeners.some(listener => listener.listenerUUID === requestMessage.payload.listenerUUID),
        )?.[0] as PrivateChannelEventListenerKey | undefined;

        if (eventType != null) {
            //remove listener from array of eventListeners for that PrivateChannelEventType
            const listeners = this.privateChannelEventListeners[eventType];
            const newListeners = listeners?.filter(
                listener => listener.listenerUUID != requestMessage.payload.listenerUUID,
            );
            this.privateChannelEventListeners[eventType] = newListeners;
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.PrivateChannelUnsubscribeEventListenerResponse>(
                'privateChannelUnsubscribeEventListenerResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onCreatePrivateChannelRequest(
        requestMessage: BrowserTypes.CreatePrivateChannelRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        const privateChannel: BrowserTypes.Channel = { id: generateUUID(), type: 'private' };

        this.privateChannels[privateChannel.id] = {
            channel: privateChannel,
            contextHistory: { byContext: {} },
            //add creator of private channel to private channel's allowedList
            allowedList: [source],
        };

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.CreatePrivateChannelResponse>(
                'createPrivateChannelResponse',
                { privateChannel },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    /**
     * Used by root desktop agent to add app receiving private channel in RaiseIntentResultResponse to private channel's allowedList
     * @param channelId is id of private channel
     * @param app is appIdentifier of app being added to allowedList
     */
    public addToPrivateChannelAllowedList(channelId: string, app: FullyQualifiedAppIdentifier): void {
        this.privateChannels[channelId]?.allowedList.push(app);
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onGetOrCreateChannelRequest(
        requestMessage: BrowserTypes.GetOrCreateChannelRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        let newChannel: BrowserTypes.Channel | undefined;

        //if channelId already belongs to a private channel, respond with error message
        if (this.privateChannels[requestMessage.payload.channelId] != null) {
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.GetOrCreateChannelResponse>(
                    'getOrCreateChannelResponse',
                    { error: ChannelError.AccessDenied },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        //check if channel is a current app channel
        const appChannel = this.appChannels[requestMessage.payload.channelId]?.channel;
        if (appChannel == null) {
            //create new app channel with given channelId
            newChannel = {
                id: requestMessage.payload.channelId,
                type: 'app',
            };
            this.appChannels[requestMessage.payload.channelId] = {
                channel: newChannel,
                contextHistory: { byContext: {} },
            };
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.GetOrCreateChannelResponse>(
                'getOrCreateChannelResponse',
                { channel: appChannel ?? newChannel },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onAddContextListenerRequest(
        requestMessage: BrowserTypes.AddContextListenerRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        const channelIdIndex = this.convertToContextListenerIndex(requestMessage.payload.channelId);

        //if channelId is null, then channel is user channel and so origin app is allowed to listen on it
        if (
            requestMessage.payload.channelId != null &&
            !this.isAppAllowedOnChannel(source, requestMessage.payload.channelId)
        ) {
            //origin app is not allowed to listen on given private channel
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.AddContextListenerResponse>(
                    'addContextListenerResponse',
                    { error: ChannelError.AccessDenied },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        const listeners = this.contextListeners[channelIdIndex] ?? (this.contextListeners[channelIdIndex] = []);

        const listenerUUID = generateUUID();

        //add new contextListener to array of contextListeners for that channelId
        listeners.push({ contextType: requestMessage.payload.contextType, listenerUUID, source });

        //if channel is private channel, publish privateChannelOnAddContextListenerEvent to all apps listening for them on channel
        //if message.payload.channelId == null, it is referring to the current user channel
        if (
            requestMessage.payload.channelId != null &&
            this.privateChannels[requestMessage.payload.channelId] != null
        ) {
            //get all appIdentifiers for apps which are listening for onPrivateChannelOnAddContextListenerEvents on given channel
            const appIdentifiers = [
                ...this.getAppsListeningForPrivateChannelEvent(
                    'addContextListener',
                    this.getListenersByChannelId(requestMessage.payload.channelId),
                ),
                ...this.getAppsListeningForPrivateChannelEvent(
                    'allEvents',
                    this.getListenersByChannelId(requestMessage.payload.channelId),
                ),
            ];

            this.publishPrivateChannelOnAddContextListenerEvent(
                requestMessage.payload.channelId,
                requestMessage.payload.contextType,
                appIdentifiers,
            );
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.AddContextListenerResponse>(
                'addContextListenerResponse',
                { listenerUUID },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );

        this.onContextListenerCreation(source, requestMessage.payload.contextType);
    }

    /**
     * Returns given channelId or 'currentChannel' if channelId is null
     */
    private convertToContextListenerIndex(channelId: string | null): ContextListenerKey {
        return channelId ?? 'currentChannel';
    }

    /**
     * Returns true if given channel is a user or app channel, or if given app is allowed to listen and publish on given private channel. Returns false otherwise
     */
    private isAppAllowedOnChannel(app: FullyQualifiedAppIdentifier, channelId: string): boolean {
        if (this.privateChannels[channelId] == null) {
            //any app can listen to or publish on user and app channels
            return true;
        }
        return (
            this.privateChannels[channelId]?.allowedList.some(allowedApp => appInstanceEquals(allowedApp, app)) ?? false
        );
    }

    /**
     * Publish privateChannelOnAddContextListenerEvent to all apps who are listening for them on given private channel
     */
    private publishPrivateChannelOnAddContextListenerEvent(
        channelId: string,
        contextType: string | null,
        appIdentifiers: FullyQualifiedAppIdentifier[],
    ): void {
        //only publish privateChannelOnUnsubscribeEvent if there are any apps listening for them on given channel
        if (isNonEmptyArray(appIdentifiers)) {
            this.messagingProvider.publishEvent(
                createEvent<BrowserTypes.PrivateChannelOnAddContextListenerEvent>(
                    'privateChannelOnAddContextListenerEvent',
                    {
                        contextType,
                        privateChannelId: channelId,
                    },
                ),
                appIdentifiers,
            );
        }
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onContextListenerUnsubscribeRequest(
        requestMessage: BrowserTypes.ContextListenerUnsubscribeRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //get channelId of contextListener being removed
        const channelId = Object.entries(this.contextListeners).find(([_, listeners]) =>
            listeners?.some(listener => listener.listenerUUID === requestMessage.payload.listenerUUID),
        )?.[0];

        if (channelId != null) {
            //remove contextListener from array of contextListeners for that channelId
            const listeners = this.contextListeners[channelId];
            let removedContextListener: ChannelContextListener | null = null;
            const newListeners = listeners?.filter(listener => {
                if (listener.listenerUUID != requestMessage.payload.listenerUUID) {
                    return true;
                }
                //this should only be assigned once since listenerUUIDs are unique
                removedContextListener = listener;
                return false;
            });
            this.contextListeners[channelId] = newListeners;

            //if channel is private channel, publish privateChannelOnUnsubscribeEvent to all apps listening for them on channel
            if (this.privateChannels[channelId] != null && removedContextListener != null) {
                this.publishPrivateChannelOnUnsubscribeEvent(channelId, removedContextListener);
            }
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.ContextListenerUnsubscribeResponse>(
                'contextListenerUnsubscribeResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    /**
     * Publish privateChannelOnUnsubscribeEvent for given contextListener to all apps who are listening for them on given private channel
     */
    private publishPrivateChannelOnUnsubscribeEvent(channelId: string, contextListener: ChannelContextListener): void {
        //get all appIdentifiers for apps which are listening for onPrivateChannelOnUnsubscribeEvents on given channel
        const appIdentifiers = [
            ...this.getAppsListeningForPrivateChannelEvent('unsubscribe', this.getListenersByChannelId(channelId)),
            ...this.getAppsListeningForPrivateChannelEvent('allEvents', this.getListenersByChannelId(channelId)),
        ];

        //only publish privateChannelOnUnsubscribeEvent if there are any apps listening for them on given channel
        if (isNonEmptyArray(appIdentifiers)) {
            this.messagingProvider.publishEvent(
                createEvent<BrowserTypes.PrivateChannelOnUnsubscribeEvent>('privateChannelOnUnsubscribeEvent', {
                    contextType: contextListener.contextType,
                    privateChannelId: channelId,
                }),
                appIdentifiers,
            );
        }
    }

    /**
     * Returns predicate function that selects listeners based on their channelId
     */
    private getListenersByChannelId(channelId: string): (listener: PrivateChannelEventListener) => boolean {
        return listener => listener.channelId === channelId;
    }

    /**
     * Returns appIdentifiers of all apps which are listening for given PrivateChannelEvent and whose eventListener fulfills given predicate
     * @param eventType is type of event being listened for
     * @param predicate is predicate that needs to be fulfilled by eventListener
     */
    private getAppsListeningForPrivateChannelEvent(
        eventType: PrivateChannelEventListenerKey,
        predicate: (listener: PrivateChannelEventListener) => boolean,
    ): FullyQualifiedAppIdentifier[] {
        return this.privateChannelEventListeners[eventType]?.filter(predicate).map(listener => listener.source) ?? [];
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    public onBroadcastRequest(
        requestMessage: BrowserTypes.BroadcastRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //check if context argument is invalid
        if (!isContext(requestMessage.payload.context)) {
            //if it's not send error message within BroadcastResponsePayload
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.BroadcastResponse>(
                    'broadcastResponse',
                    { error: ChannelError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't broadcast invalid context
            return;
        }

        if (!this.isAppAllowedOnChannel(source, requestMessage.payload.channelId)) {
            //origin app is not allowed to publish on given private channel
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.BroadcastResponse>(
                    'broadcastResponse',
                    { error: ChannelError.AccessDenied },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        this.publishBroadcastEvent(requestMessage, source);

        //add context to channel context history
        this.addContextToChannelHistory(requestMessage.payload.channelId, requestMessage.payload.context);

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.BroadcastResponse>(
                'broadcastResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    /**
     * Publishes a broadcastEvent to all apps which are listening for broadcastEvents of the correct contextType on the given channel
     */
    private publishBroadcastEvent(
        requestMessage: BrowserTypes.BroadcastRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //get all appIdentifiers for apps which are listening for broadcastEvents on given channel
        const appIdentifiers = this.getBroadcastAppIdentifiers(requestMessage, source);

        //if there are no listening apps, do nothing
        if (isNonEmptyArray(appIdentifiers)) {
            //publish broadcastEvent to all apps listening for broadcastEvents on given channel
            this.messagingProvider.publishEvent(
                createEvent<BrowserTypes.BroadcastEvent>('broadcastEvent', {
                    channelId: requestMessage.payload.channelId,
                    context: requestMessage.payload.context,
                    originatingApp: source,
                }),
                appIdentifiers,
            );
        }
    }

    /**
     * Returns all appIdentifiers for apps which are listening for broadcastEvents of the correct contextType on given channel, excluding origin app
     * @param requestMessage is broadcastRequest message containing context to be broadcast and channelId of channel to broadcast it on
     * @param source is appIdentifier of origin app
     */
    private getBroadcastAppIdentifiers(
        requestMessage: BrowserTypes.BroadcastRequest,
        source: FullyQualifiedAppIdentifier,
    ): FullyQualifiedAppIdentifier[] {
        const contextListeners = [
            //get all contextListeners for the given channel
            ...(this.contextListeners[requestMessage.payload.channelId] ?? []),
            //get all contextListeners listening to the current channel of their app when that app is joined to the given channel
            ...(this.contextListeners['currentChannel']?.filter(
                contextListener =>
                    this.currentUserChannels[contextListener.source.instanceId]?.id ===
                    requestMessage.payload.channelId,
            ) ?? []),
        ];

        //get all appIdentifiers for contextListeners of correct context type, excluding any for origin app
        return contextListeners
            .filter(contextListener =>
                this.isListenerValidBroadcastTarget(contextListener, requestMessage.payload.context.type, source),
            )
            .map(contextListener => contextListener.source);
    }

    /**
     * Returns all appIdentifiers associated with contextListeners that listen for given contextType, excluding those for origin app
     * @param contextListener is contextListener being checked
     * @param contextType is type of context listener should be listening for
     * @param source is appIdentifier of origin app
     */
    private isListenerValidBroadcastTarget(
        contextListener: ChannelContextListener,
        contextType: string,
        source: FullyQualifiedAppIdentifier,
    ): boolean {
        return (
            (contextListener.contextType === contextType || contextListener.contextType == null) &&
            !appInstanceEquals(contextListener.source, source)
        );
    }

    /**
     * Adds the given context to the context history of the given channel
     */
    private addContextToChannelHistory(channelId: string, context: Context): void {
        const privateChannelInfo = this.privateChannels[channelId];
        const appChannelHistoryPair = this.appChannels[channelId];
        //user channels available are those defined by the FDC3 spec and stored in recommendedChannels
        const userChannel = recommendedChannels.find(channel => channel.id === channelId);
        if (privateChannelInfo != null) {
            this.privateChannels[channelId] = this.updateChannelHistory(privateChannelInfo, context);
        } else if (appChannelHistoryPair != null) {
            this.appChannels[channelId] = this.updateChannelHistory(appChannelHistoryPair, context);
        } else if (userChannel != null) {
            //only creates context history for user channels as they are used
            const userChannelHistoryPair = this.userChannels[channelId] ?? {
                channel: userChannel,
                contextHistory: { byContext: {} },
            };
            this.userChannels[channelId] = this.updateChannelHistory(userChannelHistoryPair, context);
        }
    }

    /**
     * Updates context history of a channel
     * @param channelHistoryPair is the channel and context history combination of the channel whose history is being updated
     * @param context is the context being added to the history
     * @returns updated channel context history combination
     */
    private updateChannelHistory(channelInfo: PrivateChannelInfo, context: Context): PrivateChannelInfo;
    private updateChannelHistory(channelInfo: ChannelContextHistory, context: Context): ChannelContextHistory;
    private updateChannelHistory(
        channelInfo: PrivateChannelInfo | ChannelContextHistory,
        context: Context,
    ): ChannelContextHistory {
        channelInfo.contextHistory.byContext[context.type] = context;
        channelInfo.contextHistory.mostRecent = context;
        return channelInfo;
    }

    public onGetCurrentContextRequest(
        requestMessage: BrowserTypes.GetCurrentContextRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        let context: Context | null;

        if (!this.isAppAllowedOnChannel(source, requestMessage.payload.channelId)) {
            //origin app is not allowed to listen on given private channel
            this.messagingProvider.publishResponseMessage(
                createResponseMessage<BrowserTypes.GetCurrentContextResponse>(
                    'getCurrentContextResponse',
                    { error: ChannelError.AccessDenied },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        if (requestMessage.payload.contextType == null) {
            context =
                this.userChannels[requestMessage.payload.channelId]?.contextHistory.mostRecent ??
                this.appChannels[requestMessage.payload.channelId]?.contextHistory.mostRecent ??
                this.privateChannels[requestMessage.payload.channelId]?.contextHistory.mostRecent ??
                null;
        } else {
            context =
                this.userChannels[requestMessage.payload.channelId]?.contextHistory.byContext[
                    requestMessage.payload.contextType
                ] ??
                this.appChannels[requestMessage.payload.channelId]?.contextHistory.byContext[
                    requestMessage.payload.contextType
                ] ??
                this.privateChannels[requestMessage.payload.channelId]?.contextHistory.byContext[
                    requestMessage.payload.contextType
                ] ??
                null;
        }

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.GetCurrentContextResponse>(
                'getCurrentContextResponse',
                { context },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#privatechannel
    public onPrivateChannelDisconnectRequest(
        requestMessage: BrowserTypes.PrivateChannelDisconnectRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //unsubscribe all of app's contextListeners to given private channel
        const channelId = requestMessage.payload.channelId;
        this.contextListeners[channelId]?.forEach(contextListener =>
            this.unsubscribePrivateChannelContextListener(contextListener, source),
        );

        //publish privateChannelOnDisconnectEvent to all apps listening for them on given private channel
        this.publishPrivateChannelOnDisconnectEvent(requestMessage, source);

        this.messagingProvider.publishResponseMessage(
            createResponseMessage<BrowserTypes.PrivateChannelDisconnectResponse>(
                'privateChannelDisconnectResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    /**
     * Unsubscribes given contextListener if it belongs to given origin app
     */
    private unsubscribePrivateChannelContextListener(
        contextListener: ChannelContextListener,
        source: FullyQualifiedAppIdentifier,
    ): void {
        if (appInstanceEquals(contextListener.source, source)) {
            const contextListenerUnsubscribeRequest =
                createRequestMessage<BrowserTypes.ContextListenerUnsubscribeRequest>(
                    'contextListenerUnsubscribeRequest',
                    source,
                    { listenerUUID: contextListener.listenerUUID },
                );
            this.onContextListenerUnsubscribeRequest(contextListenerUnsubscribeRequest, source);
        }
    }

    /**
     * Publish privateChannelOnDisconnectEvent to all apps who are listening for them on given private channel, excluding app which is disconnecting from channel
     */
    private publishPrivateChannelOnDisconnectEvent(
        requestMessage: BrowserTypes.PrivateChannelDisconnectRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        //get all appIdentifiers for apps which are listening for PrivateChannelDisconnectEvents on this private channel
        //does not publish privateChannelOnDisconnectEvent to source app
        const listenerCriteria: (listener: PrivateChannelEventListener) => boolean = listener =>
            listener.channelId === requestMessage.payload.channelId || appInstanceEquals(listener.source, source);
        const appIdentifiers = [
            ...this.getAppsListeningForPrivateChannelEvent('disconnect', listenerCriteria),
            ...this.getAppsListeningForPrivateChannelEvent('allEvents', listenerCriteria),
        ];

        //only publish privateChannelOnDisconnectEvent if there are any apps listening for them on given channel
        if (isNonEmptyArray(appIdentifiers)) {
            this.messagingProvider.publishEvent(
                createEvent<BrowserTypes.PrivateChannelOnDisconnectEvent>('privateChannelOnDisconnectEvent', {
                    privateChannelId: requestMessage.payload.channelId,
                }),
                appIdentifiers,
            );
        }
    }

    /**
     * Clean up all channel subscriptions for a disconnected proxy
     * @param appId The app ID of the disconnected proxy
     */
    public cleanupDisconnectedProxy(appId: FullyQualifiedAppIdentifier): void {
        // Remove the app from the currentUserChannels mapping if it exists.
        this.removeFromCurrentUserChannels(appId);

        // Clean up all context listeners associated with the disconnected app and publish unsubscribe events for private channels.
        this.cleanupContextListeners(appId);

        // Remove all private channel event listeners associated with the disconnected app.
        this.cleanupEventListeners(appId);

        // Clean up private channel context history and allowed list for the disconnected app.
        this.cleanupPrivateChannels(appId);

        // Clean up user channel context history for the disconnected app.
        this.cleanupUserChannelContexts(appId);
    }

    /**
     * Removes the app from the currentUserChannels mapping if present.
     * @param appId The app ID of the disconnected proxy
     */
    private removeFromCurrentUserChannels(appId: FullyQualifiedAppIdentifier): void {
        if (appId.instanceId) {
            delete this.currentUserChannels[appId.instanceId];
        }
    }

    /**
     * Cleans up all context listeners associated with the disconnected app, and publishes unsubscribe events for private channels.
     * @param appId The app ID of the disconnected proxy
     */
    private cleanupContextListeners(appId: FullyQualifiedAppIdentifier): void {
        for (const [channelId, listeners] of Object.entries(this.contextListeners)) {
            if (listeners) {
                const removedListeners = listeners.filter(listener => appInstanceEquals(listener.source, appId));
                const remainingListeners = listeners.filter(listener => !appInstanceEquals(listener.source, appId));

                if (remainingListeners.length > 0) {
                    this.contextListeners[channelId] = remainingListeners;
                } else {
                    delete this.contextListeners[channelId];
                }

                // Publish unsubscribe events for removed listeners on private channels
                if (this.privateChannels[channelId]) {
                    for (const listener of removedListeners) {
                        this.publishPrivateChannelOnUnsubscribeEvent(channelId, listener);
                    }
                }
            }
        }
    }

    /**
     * Cleans up all private channel event listeners associated with the disconnected app.
     * @param appId The app ID of the disconnected proxy
     */
    private cleanupEventListeners(appId: FullyQualifiedAppIdentifier): void {
        for (const [eventType, listeners] of Object.entries(this.privateChannelEventListeners)) {
            if (listeners) {
                const remainingListeners = listeners.filter(listener => !appInstanceEquals(listener.source, appId));
                if (remainingListeners.length > 0) {
                    this.privateChannelEventListeners[eventType as keyof typeof this.privateChannelEventListeners] =
                        remainingListeners;
                } else {
                    delete this.privateChannelEventListeners[
                        eventType as keyof typeof this.privateChannelEventListeners
                    ];
                }
            }
        }
    }

    /**
     * Cleans up private channel context history and allowed list for the disconnected app.
     * @param appId The app ID of the disconnected proxy
     */
    private cleanupPrivateChannels(appId: FullyQualifiedAppIdentifier): void {
        for (const [_, channel] of Object.entries(this.privateChannels)) {
            if (channel) {
                channel.contextHistory.byContext = Object.fromEntries(
                    Object.entries(channel.contextHistory.byContext).filter(
                        ([_, context]) => !context?.source || !appInstanceEquals(context.source, appId),
                    ),
                );

                if (
                    channel.contextHistory.mostRecent?.source &&
                    appInstanceEquals(channel.contextHistory.mostRecent.source, appId)
                ) {
                    const remainingContexts = Object.values(channel.contextHistory.byContext);
                    channel.contextHistory.mostRecent = remainingContexts[remainingContexts.length - 1] || undefined;
                }

                channel.allowedList = channel.allowedList.filter(app => !appInstanceEquals(app, appId));
            }
        }
    }

    /**
     * Cleans up user channel context history for the disconnected app.
     * @param appId The app ID of the disconnected proxy
     */
    private cleanupUserChannelContexts(appId: FullyQualifiedAppIdentifier): void {
        for (const [_, channel] of Object.entries(this.userChannels)) {
            if (channel) {
                channel.contextHistory.byContext = Object.fromEntries(
                    Object.entries(channel.contextHistory.byContext).filter(
                        ([_, context]) => !context?.source || !appInstanceEquals(context.source, appId),
                    ),
                );

                if (
                    channel.contextHistory.mostRecent?.source &&
                    appInstanceEquals(channel.contextHistory.mostRecent.source, appId)
                ) {
                    const remainingContexts = Object.values(channel.contextHistory.byContext);
                    channel.contextHistory.mostRecent = remainingContexts[remainingContexts.length - 1] || undefined;
                }
            }
        }
    }
}
