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
    AppProvidableContextMetadata,
    BrowserTypes,
    Channel,
    Context,
    ContextHandler,
    ContextWithMetadata,
    DisplayMetadata,
    EventHandler,
    Listener,
} from '@finos/fdc3';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts.js';
import {
    createRequestMessage,
    isBroadcastResponse,
    isClearContextResponse,
    resolveContextType,
} from '../helpers/index.js';
import { MessagingBase } from '../messaging/index.js';
import { ContextListener } from './channel.contracts.js';

/**
 * Represents a context channel that applications can use to send and receive
 * context data.
 */
export class PublicChannel extends MessagingBase implements Channel {
    constructor(
        channelDetails: BrowserTypes.Channel,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
        private contextListener: ContextListener,
    ) {
        super(appIdentifier, messagingProvider);

        this._id = channelDetails.id;
        this._type = channelDetails.type;
        this._displayMetadata = channelDetails.displayMetadata;
    }

    private readonly _id: string;

    public get id(): string {
        return this._id;
    }

    private readonly _type: Channel['type'];

    public get type(): Channel['type'] {
        return this._type;
    }

    private readonly _displayMetadata?: DisplayMetadata | undefined;

    public get displayMetadata(): DisplayMetadata | undefined {
        return this._displayMetadata;
    }

    public async broadcast(context: Context, metadata?: AppProvidableContextMetadata): Promise<void> {
        const message = createRequestMessage<BrowserTypes.BroadcastRequest>('broadcastRequest', this.appIdentifier, {
            channelId: this.id,
            context: context,
            metadata: metadata ?? {},
        });

        const response = await this.getResponse(message, isBroadcastResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else {
            return Promise.resolve();
        }
    }

    public getCurrentContext(contextType?: string | undefined): Promise<Context | null> {
        return this.contextListener.getCurrentContext(contextType);
    }

    public getCurrentContextWithMetadata(contextType?: string | undefined): Promise<ContextWithMetadata | null> {
        return this.contextListener.getCurrentContextWithMetadata(contextType);
    }

    public async clearContext(contextType?: string | undefined): Promise<void> {
        const message = createRequestMessage<BrowserTypes.ClearContextRequest>(
            'clearContextRequest',
            this.appIdentifier,
            { channelId: this.id, contextType: contextType ?? null },
        );

        const response = await this.getResponse(message, isClearContextResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else {
            return Promise.resolve();
        }
    }

    public addContextListener(contextType: string | null, handler: ContextHandler): Promise<Listener>;
    public addContextListener(handler: ContextHandler): Promise<Listener>;
    public async addContextListener(
        handlerOrContextType: string | null | ContextHandler,
        optionalContextHandler?: ContextHandler,
    ): Promise<Listener> {
        const { contextType, contextHandler } = resolveContextType(handlerOrContextType, optionalContextHandler);

        return this.contextListener.addContextListener(contextType, contextHandler);
    }

    public addEventListener(_type: string | null, _handler: EventHandler): Promise<Listener> {
        // TODO(fdc3-3.0): channel-level event listeners (e.g. 'contextCleared') have no
        // corresponding request message in the @finos/fdc3-schema alpha, so there is no
        // transport to register them with the Desktop Agent yet.
        return Promise.reject('Channel.addEventListener is not yet implemented');
    }
}
