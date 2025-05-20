/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type {
    AppIdentifier,
    BrowserTypes,
    Channel,
    ContextHandler,
    ContextMetadata,
    ContextType,
    Listener,
} from '@finos/fdc3';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts.js';
import {
    createRequestMessage,
    isAddContextListenerResponse,
    isAddEventListenerResponse,
    isBroadcastEvent,
    isChannelChangedEvent,
    isContextListenerUnsubscribeResponse,
    isGetCurrentChannelResponse,
    isGetCurrentContextResponse,
    resolveContextType,
} from '../helpers/index.js';
import { MessagingBase } from '../messaging/index.js';
import { IChannelFactory } from './channel.contracts.js';

/**
Listens to broadcast events.
This can be for a specific channel or can be for a DesktopAgent where the channel can change
*/
export class ContextListener extends MessagingBase implements ContextListener {
    constructor(
        /**
         * channel details must be passed when this is being created for use in a channel
         * If this is being used to listen for agent context updates this should be omitted
         * listenOnCurrentChannel flag indicates whether contextListener should always listen to current user channel
         */
        private channelDetails: BrowserTypes.Channel | undefined,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
        private channelFactory: IChannelFactory,
        private listenOnCurrentChannel: boolean = false,
    ) {
        super(appIdentifier, messagingProvider);

        this._id = channelDetails?.id ?? null;
    }

    private _id: string | null;

    public addContextListener(
        contextType: string | null | string | ContextHandler,
        handler: ContextHandler,
    ): Promise<Listener>;

    public addContextListener(handler: ContextHandler): Promise<Listener>;
    public async addContextListener(
        handlerOrContextType: string | null | ContextHandler,
        optionalContextHandler?: ContextHandler,
    ): Promise<Listener> {
        const { contextType, contextHandler } = resolveContextType(handlerOrContextType, optionalContextHandler);

        const response = await this.getAddContextListenerResponse(contextType);

        const listenerUUID = response.payload.listenerUUID;
        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (listenerUUID == null) {
            //this should not happen - there should be no situation where both listenerUUID and error are undefined in response payload
            return Promise.reject('listenerUUID is null');
        }

        this.addBroadcastEventListener(listenerUUID, contextType, contextHandler);

        //if contextListener is for current user channel and fdc3.open() calls
        if (this.channelDetails == null) {
            //adds listener for userChannelChanged events
            await this.getAddEventListenerResponse(contextType, contextHandler);

            const currentChannel = await this.getCurrentChannel();

            this._id = currentChannel?.id ?? null;

            //gets current context for channel
            const context = await this.getCurrentContext(contextType);

            if (context != null) {
                contextHandler(context);
            }
        }

        const unsubscribe: () => Promise<void> = async () => {
            const contextListenerUnsubscribeRequest =
                createRequestMessage<BrowserTypes.ContextListenerUnsubscribeRequest>(
                    'contextListenerUnsubscribeRequest',
                    this.appIdentifier,
                    { listenerUUID },
                );

            await this.getResponse(contextListenerUnsubscribeRequest, isContextListenerUnsubscribeResponse);

            this.removeMessageCallback(listenerUUID);
        };

        return { unsubscribe };
    }

    public async getCurrentChannel(): Promise<Channel | null> {
        const message = createRequestMessage<BrowserTypes.GetCurrentChannelRequest>(
            'getCurrentChannelRequest',
            this.appIdentifier,
            {},
        );

        const response = await this.getResponse(message, isGetCurrentChannelResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }
        if (response.payload.channel == null) {
            return Promise.resolve(null);
        }

        this._id = response.payload.channel.id;

        return this.channelFactory.createPublicChannel(
            response.payload.channel,
            this.appIdentifier,
            this.messagingProvider,
        );
    }

    public async getCurrentContext(contextType?: string | null): Promise<BrowserTypes.Context | null> {
        const channelId = this._id;

        if (channelId == null) {
            return Promise.resolve(null);
        }

        const message = createRequestMessage<BrowserTypes.GetCurrentContextRequest>(
            'getCurrentContextRequest',
            this.appIdentifier,
            { channelId, contextType: contextType ?? null },
        );

        const response = await this.getResponse(message, isGetCurrentContextResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }

        return response.payload.context ?? null;
    }

    private getAddContextListenerResponse(
        contextType: ContextType | null,
    ): Promise<BrowserTypes.AddContextListenerResponse> {
        //if channel is user channel, contextListener should change as app's user channel changes
        const channelId = this.listenOnCurrentChannel ? null : this._id;
        const message = createRequestMessage<BrowserTypes.AddContextListenerRequest>(
            'addContextListenerRequest',
            this.appIdentifier,
            { channelId, contextType },
        );

        return this.getResponse(message, isAddContextListenerResponse);
    }

    private async getAddEventListenerResponse(
        contextType: ContextType | null,
        contextHandler: ContextHandler,
    ): Promise<BrowserTypes.AddEventListenerResponse> {
        const message = createRequestMessage<BrowserTypes.AddEventListenerRequest>(
            'addEventListenerRequest',
            this.appIdentifier,
            { type: 'USER_CHANNEL_CHANGED' },
        );

        const response = await this.getResponse(message, isAddEventListenerResponse);

        if (response.payload.listenerUUID != null) {
            this.addChannelChangedEventListener(response.payload.listenerUUID, contextType, contextHandler);
        }

        return response;
    }

    private addBroadcastEventListener(
        listenerUUID: string,
        contextType: ContextType | null,
        contextHandler: ContextHandler,
    ): void {
        this.addMessageCallback(listenerUUID, message => {
            if (
                isBroadcastEvent(message) &&
                (contextType === null || message.payload.context.type === contextType) &&
                message.payload.channelId === this._id
            ) {
                contextHandler(message.payload.context, createContextMetadata(message.payload.originatingApp));
            }
        });
    }

    // Todo: unsubscribe. This doesn't currently seem possible. Issue raised: https://github.com/finos/FDC3/issues/1315
    private addChannelChangedEventListener(
        listenerUUID: string,
        contextType: ContextType | null,
        contextHandler: ContextHandler,
    ): void {
        this.addMessageCallback(listenerUUID, async message => {
            //TODO: filter by appIdentifier?? https://github.com/finos/FDC3/issues/1313
            if (isChannelChangedEvent(message)) {
                this._id = message.payload.newChannelId;
                //gets current context for channel whenever app joins new user channel
                const context = await this.getCurrentContext(contextType);
                if (context != null) {
                    contextHandler(context);
                }
            }
        });
    }
}

function createContextMetadata(identifier?: AppIdentifier): ContextMetadata | undefined {
    return identifier != null ? { source: identifier } : undefined;
}
