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
    IProxyIncomingMessageEnvelope,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
} from '../contracts';

/**
 * A getAgent standards compliant proxy messaging provider.
 * Publishes messages on and subscribes to messages from the MessagePort provided in the constructor
 */
export class DefaultProxyMessagingProvider implements IProxyMessagingProvider {
    private callbacks: IncomingMessageCallback<IProxyIncomingMessageEnvelope>[] = [];

    constructor(private messagePort: MessagePort) {
        messagePort.start();

        messagePort.addEventListener('message', (event: MessageEvent) => {
            for (const callback of this.callbacks) {
                callback({ payload: event.data });
            }
        });
    }

    public sendMessage(message: IProxyOutgoingMessageEnvelope): void {
        this.messagePort.postMessage(message.payload);
    }

    public addResponseHandler(callback: (message: IProxyIncomingMessageEnvelope) => void): void {
        this.callbacks.push(callback);
    }
}
