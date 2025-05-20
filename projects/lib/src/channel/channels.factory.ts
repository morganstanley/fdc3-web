/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes, Channel, PrivateChannel as FDC3PrivateChannel } from '@finos/fdc3';
import { IRootPublisher } from '../contracts.internal.js';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts.js';
import { IChannelFactory } from './channel.contracts.js';
import { PrivateChannel } from './channel.private.js';
import { PublicChannel } from './channel.public.js';
import { ChannelMessageHandler } from './channel-message-handler.js';
import { Channels } from './channels.js';
import { ContextListener } from './context-listener.js';

export class ChannelFactory implements IChannelFactory {
    public createChannels(
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
    ): Channels {
        return new Channels(
            this,
            appIdentifier,
            messagingProvider,
            new ContextListener(undefined, appIdentifier, messagingProvider, this, true),
        );
    }

    public createPublicChannel(
        details: BrowserTypes.Channel,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
    ): Channel {
        return new PublicChannel(
            details,
            appIdentifier,
            messagingProvider,
            new ContextListener(details, appIdentifier, messagingProvider, this),
        );
    }

    public createPrivateChannel(
        details: BrowserTypes.Channel,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
    ): FDC3PrivateChannel {
        return new PrivateChannel(
            details,
            appIdentifier,
            messagingProvider,
            new ContextListener(details, appIdentifier, messagingProvider, this),
        );
    }

    public createMessageHandler(messaging: IRootPublisher): ChannelMessageHandler {
        return new ChannelMessageHandler(messaging);
    }
}
