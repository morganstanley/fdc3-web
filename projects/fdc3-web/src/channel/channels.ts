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
    BrowserTypes,
    Channel,
    Context,
    ContextHandler,
    ContextType,
    DesktopAgent,
    Listener,
    PrivateChannel as FDC3PrivateChannel,
} from '@finos/fdc3';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts.js';
import {
    createRequestMessage,
    isCreatePrivateChannelResponse,
    isGetOrCreateChannelResponse,
    isGetUserChannelsResponse,
    isJoinUserChannelResponse,
    isLeaveCurrentChannelResponse,
} from '../helpers/index.js';
import { MessagingBase } from '../messaging/index.js';
import { ContextListener, IChannelFactory } from './channel.contracts.js';

/**
 * addContextListener is omitted from this list so that we don't have to implement the deprecated function overload
 */
type AgentChannels = Pick<
    DesktopAgent,
    | 'getCurrentChannel'
    | 'createPrivateChannel'
    | 'broadcast'
    | 'getOrCreateChannel'
    | 'getUserChannels'
    | 'joinUserChannel'
    | 'leaveCurrentChannel'
>;

export class Channels extends MessagingBase implements AgentChannels {
    constructor(
        private channelFactory: IChannelFactory,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
        private _contextListener: ContextListener,
    ) {
        super(appIdentifier, messagingProvider);
    }

    public getCurrentChannel(): Promise<Channel | null> {
        return this._contextListener.getCurrentChannel();
    }

    public async createPrivateChannel(): Promise<FDC3PrivateChannel> {
        const message = createRequestMessage<BrowserTypes.CreatePrivateChannelRequest>(
            'createPrivateChannelRequest',
            this.appIdentifier,
            {},
        );

        const response = await this.getResponse(message, isCreatePrivateChannelResponse);

        if (response.payload.error != null || response.payload.privateChannel == null) {
            return Promise.reject(response.payload.error);
        }

        return this.channelFactory.createPrivateChannel(
            response.payload.privateChannel,
            this.appIdentifier,
            this.messagingProvider,
        );
    }

    public async getOrCreateChannel(channelId: string): Promise<Channel> {
        const message = createRequestMessage<BrowserTypes.GetOrCreateChannelRequest>(
            'getOrCreateChannelRequest',
            this.appIdentifier,
            { channelId },
        );

        const response = await this.getResponse(message, isGetOrCreateChannelResponse);

        if (response.payload.error != null || response.payload.channel == null) {
            return Promise.reject(response.payload.error);
        }

        return this.channelFactory.createPublicChannel(
            response.payload.channel,
            this.appIdentifier,
            this.messagingProvider,
        );
    }

    public async getUserChannels(): Promise<Channel[]> {
        const message = createRequestMessage<BrowserTypes.GetUserChannelsRequest>(
            'getUserChannelsRequest',
            this.appIdentifier,
            {},
        );

        const response = await this.getResponse(message, isGetUserChannelsResponse);

        if (response.payload.error != null || response.payload.userChannels == null) {
            return Promise.reject(response.payload.error);
        }
        return response.payload.userChannels.map(channel =>
            this.channelFactory.createPublicChannel(channel, this.appIdentifier, this.messagingProvider),
        );
    }

    public async leaveCurrentChannel(): Promise<void> {
        const message = createRequestMessage<BrowserTypes.LeaveCurrentChannelRequest>(
            'leaveCurrentChannelRequest',
            this.appIdentifier,
            {},
        );

        const response = await this.getResponse(message, isLeaveCurrentChannelResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }

        return Promise.resolve();
    }

    public async joinUserChannel(channelId: string): Promise<void> {
        const message = createRequestMessage<BrowserTypes.JoinUserChannelRequest>(
            'joinUserChannelRequest',
            this.appIdentifier,
            { channelId },
        );

        const response = await this.getResponse(message, isJoinUserChannelResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }

        return Promise.resolve();
    }

    public async broadcast(context: Context): Promise<void> {
        const currentChannel = await this.getCurrentChannel();

        currentChannel?.broadcast(context);
    }

    public async addContextListener(
        contextType: ContextType | null,
        contextHandler: ContextHandler,
    ): Promise<Listener> {
        return this._contextListener.addContextListener(contextType, contextHandler);
    }
}
