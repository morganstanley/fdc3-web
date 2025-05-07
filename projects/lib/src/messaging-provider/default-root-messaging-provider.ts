/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import {
    IncomingMessageCallback,
    IRootIncomingMessageEnvelope,
    IRootMessagingProvider,
    IRootOutgoingMessageEnvelope,
} from '../contracts';
import { generateHandshakeResponseMessage, generateUUID, isWCPHelloMessage } from '../helpers';

/**
 * A getAgent standard compliant root messaging publisher
 * Listens for new app connections established with WCP Hello message
 * Generates a connection ID for each app that connects
 * Creates a MessageChannel for each app and maps it to the connection id
 */
export class DefaultRootMessagingProvider implements IRootMessagingProvider {
    private callbacks: IncomingMessageCallback<IRootIncomingMessageEnvelope>[] = [];
    private messageChannels: Record<string, MessagePort> = {};

    constructor(
        windowRef: Window,
        private messageChannelFactory?: () => MessageChannel, // used for testing
    ) {
        windowRef.addEventListener('message', this.onWindowMessage.bind(this));
    }

    /**
     * posts the provided message on the corresponding message channel for each channel id passed in the message envelope
     * @param message
     */
    public publish(message: IRootOutgoingMessageEnvelope): void {
        for (const channelId of message.channelIds) {
            const messageChannel = this.messageChannels[channelId];

            if (messageChannel == null) {
                console.error(`Could not locate MessageChannel for channelId '${channelId}'`);
                continue;
            }

            messageChannel.postMessage(message.payload);
        }
    }

    public subscribe(callback: (message: IRootIncomingMessageEnvelope) => void): void {
        this.callbacks.push(callback);
    }

    /**
     * responds to hello messages from proxy agents that are trying to establish communication
     * for each hello message received a new channelId is generated and a corresponding Message channel
     * one port is returned to the source app. The other is added to the lookup with the channel id as the key
     * @param message
     */
    private onWindowMessage(message: MessageEvent): void {
        if (isWCPHelloMessage(message.data)) {
            const channelId = generateUUID();

            const messageChannel =
                this.messageChannelFactory != null ? this.messageChannelFactory() : new MessageChannel();
            this.messageChannels[channelId] = messageChannel.port1;

            messageChannel.port1.start();

            // listen to incoming messages on the new channel
            messageChannel.port1.addEventListener('message', message => {
                for (const callback of this.callbacks) {
                    callback({ payload: message.data, channelId });
                }
            });

            const sourceWindow = message.source;

            const response = generateHandshakeResponseMessage(message.data);

            if (sourceWindow != null) {
                // return response to the source app with the message  port to allow further communication over the message channel
                sourceWindow.postMessage(response, { targetOrigin: '*', transfer: [messageChannel.port2] });
            } else {
                console.error(`[ROOT] unable to respond to Hello as message.source is null`);
            }
        }
    }
}
