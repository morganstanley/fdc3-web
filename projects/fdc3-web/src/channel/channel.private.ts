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
    EventHandler,
    Listener,
    PrivateChannel as FDC3PrivateChannel,
    PrivateChannelEventTypes,
} from '@finos/fdc3';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts.js';
import {
    convertToPrivateChannelEventListenerTypes,
    convertToPrivateChannelEventMessageTypes,
    convertToPrivateChannelEventTypes,
} from '../helpers/event-type.helper.js';
import {
    createRequestMessage,
    generateUUID,
    isPrivateChannelAddEventListenerResponse,
    isPrivateChannelDisconnectResponse,
    isPrivateChannelEvent,
    isPrivateChannelOnAddContextListenerEvent,
    isPrivateChannelOnDisconnectEvent,
    isPrivateChannelOnUnsubscribeEvent,
    isPrivateChannelUnsubscribeEventListenerResponse,
} from '../helpers/index.js';
import { ContextListener } from './channel.contracts.js';
import { PublicChannel } from './channel.public.js';

/**
 * Object representing a private context channel, which is intended to support
 * secure communication between applications, and extends the Channel interface
 * with event handlers which provide information on the connection state of both
 * parties, ensuring that desktop agents do not need to queue or retain messages
 * that are broadcast before a context listener is added and that applications
 * are able to stop broadcasting messages when the other party has disconnected.
 */
export class PrivateChannel extends PublicChannel implements FDC3PrivateChannel {
    constructor(
        channelDetails: BrowserTypes.Channel,
        appIdentifier: FullyQualifiedAppIdentifier,
        messagingProvider: IProxyMessagingProvider,
        contextListener: ContextListener,
    ) {
        super(channelDetails, appIdentifier, messagingProvider, contextListener);
    }

    //DEPRECATED
    public onAddContextListener(handler: (contextType?: string) => void): Listener {
        const listenerUUID = generateUUID();

        this.addMessageCallback(listenerUUID, message => {
            if (isPrivateChannelOnAddContextListenerEvent(message) && message.payload.privateChannelId === this.id) {
                handler(message.payload.contextType ?? undefined);
            }
        });

        return { unsubscribe: () => this.removeMessageCallback(listenerUUID) };
    }

    //DEPRECATED
    public onUnsubscribe(handler: (contextType?: string) => void): Listener {
        const listenerUUID = generateUUID();

        this.addMessageCallback(listenerUUID, message => {
            if (isPrivateChannelOnUnsubscribeEvent(message) && message.payload.privateChannelId === this.id) {
                handler(message.payload.contextType ?? undefined);
            }
        });

        return { unsubscribe: () => this.removeMessageCallback(listenerUUID) };
    }

    //DEPRECATED
    public onDisconnect(handler: () => void): Listener {
        const listenerUUID = generateUUID();

        this.addMessageCallback(listenerUUID, message => {
            if (isPrivateChannelOnDisconnectEvent(message) && message.payload.privateChannelId === this.id) {
                handler();
            }
        });

        return { unsubscribe: () => this.removeMessageCallback(listenerUUID) };
    }

    /**
     * Called to indicate an app will no longer interact with this Private Channel
     */
    public async disconnect(): Promise<void> {
        const message = createRequestMessage<BrowserTypes.PrivateChannelDisconnectRequest>(
            'privateChannelDisconnectRequest',
            this.appIdentifier,
            { channelId: this.id },
        );

        const response = await this.getResponse(message, isPrivateChannelDisconnectResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }
        return;
    }

    /**
     * Registers a handler for PrivateChannelEvents on this Private Channel
     * @param type is the type of PrivateChannelEvent the listener is listening for
     * @param handler is the handler the events received will be passed to
     * @returns a listener for the specified PrivateChannelEventTypes
     */
    public async addEventListener(type: PrivateChannelEventTypes | null, handler: EventHandler): Promise<Listener> {
        //TODO: Fix PrivateChannelEvents typing conflict between FDC3 spec and Browser Types
        //currently does not accept null in PrivateChannelAddEventListenerRequestPayload
        if (type == null) {
            return Promise.reject('Currently cannot listen for all events');
        }

        const requestMessage = createRequestMessage<BrowserTypes.PrivateChannelAddEventListenerRequest>(
            'privateChannelAddEventListenerRequest',
            this.appIdentifier,
            { listenerType: convertToPrivateChannelEventListenerTypes(type), privateChannelId: this.id },
        );

        const response = await this.getResponse(requestMessage, isPrivateChannelAddEventListenerResponse);

        const listenerUUID = response.payload.listenerUUID;
        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (listenerUUID == null) {
            //this should not happen - there should be no situation where both listenerUUID and error are undefined in response payload
            return Promise.reject('listenerUUID is null');
        }

        this.addMessageCallback(listenerUUID, message => {
            //convert between EventMessageType and PrivateChannelEventTypes
            if (isPrivateChannelEvent(message)) {
                const eventType = convertToPrivateChannelEventMessageTypes(type);
                if (message.type === eventType) {
                    //only passes PrivateChannelEvents to handler if they are on correct Private Channel
                    if (message.payload.privateChannelId === this.id) {
                        this.convertEventPayload(message, handler);
                    }
                }
            }
        });

        const unsubscribe: () => Promise<void> = async () => {
            const eventListenerUnsubscribeRequest =
                createRequestMessage<BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest>(
                    'privateChannelUnsubscribeEventListenerRequest',
                    this.appIdentifier,
                    { listenerUUID },
                );

            await this.getResponse(eventListenerUnsubscribeRequest, isPrivateChannelUnsubscribeEventListenerResponse);

            this.removeMessageCallback(listenerUUID);
        };
        return { unsubscribe };
    }

    private convertEventPayload(
        message:
            | BrowserTypes.PrivateChannelOnAddContextListenerEvent
            | BrowserTypes.PrivateChannelOnUnsubscribeEvent
            | BrowserTypes.PrivateChannelOnDisconnectEvent,
        handler: EventHandler,
    ): void {
        switch (message.type) {
            case 'privateChannelOnAddContextListenerEvent':
            case 'privateChannelOnUnsubscribeEvent':
                handler({
                    type: convertToPrivateChannelEventTypes(message.type),
                    details: { contextType: message.payload.contextType },
                });
                break;
            case 'privateChannelOnDisconnectEvent':
                handler({ type: convertToPrivateChannelEventTypes(message.type), details: null });
                break;
        }
    }
}
