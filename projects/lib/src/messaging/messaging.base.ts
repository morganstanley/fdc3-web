/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes, GetAgentLogLevels } from '@finos/fdc3';
import { LogLevel } from '@finos/fdc3';
import {
    FullyQualifiedAppIdentifier,
    HandshakeMessage,
    IProxyIncomingMessageEnvelope,
    IProxyMessagingProvider,
    Message,
    RequestMessage,
    ResponseMessage,
} from '../contracts.js';
import { createLogger, generateUUID } from '../helpers/index.js';

/**
 * Base class for anything that needs to send and receive request and response messages
 */
export abstract class MessagingBase {
    protected readonly incomingMessageCallbacks: Map<string, (value: Message) => void>;
    protected readonly log: (message: string, level?: LogLevel, ...optionalParams: any[]) => void;

    constructor(
        protected readonly appIdentifier: FullyQualifiedAppIdentifier,
        protected readonly messagingProvider: IProxyMessagingProvider,
        protected readonly logLevels?: GetAgentLogLevels,
    ) {
        this.incomingMessageCallbacks = new Map<string, (value: Message) => void>();
        this.log = createLogger(MessagingBase, 'proxy', logLevels);
        this.log('MessagingBase constructor', LogLevel.DEBUG);

        this.subscribeToMessages();
    }

    protected async getResponse<T extends ResponseMessage>(
        requestMessage: RequestMessage,
        responseTypeCheck: (value: Message) => value is T,
    ): Promise<T> {
        const responsePromise = this.awaitRequestUuid(responseTypeCheck, requestMessage.meta.requestUuid);

        await this.publishRequestMessage(requestMessage);

        return responsePromise;
    }

    protected async publishRequestMessage(message: RequestMessage): Promise<void> {
        this.log('Publishing request message', LogLevel.DEBUG, message);
        this.messagingProvider.sendMessage({ payload: message });
    }

    protected async awaitMessage<
        T extends BrowserTypes.AppRequestMessage | BrowserTypes.AgentResponseMessage | HandshakeMessage,
    >(typeCheck: (value: any) => value is T): Promise<T> {
        return new Promise<T>(resolve => {
            const callbackUUID = generateUUID();
            this.incomingMessageCallbacks.set(callbackUUID, message => {
                if (typeCheck(message)) {
                    this.removeMessageCallback(callbackUUID);
                    resolve(message);
                }
            });
        });
    }

    protected async awaitRequestUuid<T extends BrowserTypes.AppRequestMessage | BrowserTypes.AgentResponseMessage>(
        responseTypeCheck: (value: any) => value is T,
        requestUuid: string,
    ): Promise<T> {
        function predicate(value: any): value is T {
            return responseTypeCheck(value) && requestUuid === value.meta.requestUuid;
        }
        return this.awaitMessage(predicate);
    }

    protected async addMessageCallback(callbackUuid: string, messageCallback: (value: Message) => void): Promise<void> {
        this.incomingMessageCallbacks.set(callbackUuid, messageCallback);
    }

    protected async removeMessageCallback(callbackUuid: string): Promise<void> {
        this.incomingMessageCallbacks.delete(callbackUuid);
    }

    protected onMessage(envelope: IProxyIncomingMessageEnvelope): void {
        // Log heartbeat messages based on logging options
        const isHeartbeat = envelope.payload?.type === 'heartbeatEvent';
        if (isHeartbeat) {
            this.log('Received heartbeat message', LogLevel.DEBUG, envelope.payload);
        } else {
            this.log('Received message', LogLevel.DEBUG, envelope.payload);
        }

        for (const callback of this.incomingMessageCallbacks.values()) {
            callback(envelope.payload);
        }
    }

    private async subscribeToMessages(): Promise<void> {
        this.messagingProvider.addResponseHandler(message => this.onMessage(message));
    }
}
