/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, LogLevel } from '@finos/fdc3';
import { AppDirectoryApplication } from '../app-directory.contracts.js';
import { AppDirectory } from '../app-directory/index.js';
import { IRootPublisher } from '../contracts.internal.js';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IncomingMessageCallback,
    IProxyIncomingMessageEnvelope,
    IProxyOutgoingMessageEnvelope,
    IRootIncomingMessageEnvelope,
    IRootMessagingProvider,
    RequestMessage,
    ResponseMessage,
} from '../contracts.js';
import {
    createLogger,
    generateUUID,
    getImplementationMetadata,
    getTimestamp,
    isNonEmptyArray,
    isWCPValidateAppIdentity,
} from '../helpers/index.js';

const PUBLISHER_NOT_INITIALIZED = 'RootMessagePublisher not initialized before messages received.';
const SEND_MESSAGE_INITIALIZATION_ERROR = `sendMessage called before RootMessagePublisher has been initialized`;

type RequestMessageHandler = (message: RequestMessage, source: FullyQualifiedAppIdentifier) => void;

/**
 * Responsible for publishing all messages from the root agent to proxy agents
 * Maintains a lookup mapping app instances to channelIds
 */
export class RootMessagePublisher implements IRootPublisher {
    private instanceIdToChannelId: Partial<Record<string, string>> = {};
    private channelIdToAppIdentifier: Partial<Record<string, FullyQualifiedAppIdentifier>> = {};
    private log = createLogger(RootMessagePublisher, 'connection');

    private rootAppIdentifier: FullyQualifiedAppIdentifier | undefined;

    /**
     * Used for passing requests from incoming messages received from proxy agents (or from the root agent itself) to the request handler function in desktop-agent
     */
    public requestMessageHandler: RequestMessageHandler | undefined;

    /**
     * Used for loopback response messages that the desktop-agent has published but that need to be returned to the proxy-agent code (which desktop-agent extends)
     */
    private proxyResponseHandlers: IncomingMessageCallback<IProxyIncomingMessageEnvelope>[] = [];

    constructor(
        private rootMessagingProvider: IRootMessagingProvider<
            RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
        >,
        private directory: AppDirectory,
        private windowRef: WindowProxy,
    ) {
        rootMessagingProvider.subscribe(message => this.onMessage(message));
    }

    /**
     * We need to handle this being called AFTER registerNewInstance
     * @param window
     * @param app
     * @returns
     */
    public awaitAppIdentity(
        connectionAttemptUuid: string,
        _app: AppDirectoryApplication,
    ): Promise<FullyQualifiedAppIdentifier> {
        return this.awaitConnectionAttemptUuidValidateMessage(connectionAttemptUuid);
    }

    /**
     * IProxyMessagingProvider
     * Provides loopback functionality
     * The root agent is also a proxy agent as DesktopAgentImpl extends DesktopAgentProxy
     * Request messages that the DesktopAgentProxy send do not need to be sent to the messaging provider but need to be sent back to the root agent via the handleRequestMessage function
     */

    public addResponseHandler(callback: IncomingMessageCallback<IProxyIncomingMessageEnvelope>): void {
        this.proxyResponseHandlers.push(callback);
    }

    public sendMessage(message: IProxyOutgoingMessageEnvelope): void {
        if (this.rootAppIdentifier == null) {
            throw new Error(SEND_MESSAGE_INITIALIZATION_ERROR);
        }

        this.handleRequestMessage(message.payload, this.rootAppIdentifier);
    }

    /**
     * Initializes the root agent's identity using the provided identity URL or the current window location.
     * @param identityUrl - The URL to determine the root agent's identity.
     * @returns A promise that resolves to the fully qualified app identifier of the root agent.
     */
    public async initialize(identityUrl?: string): Promise<FullyQualifiedAppIdentifier> {
        this.log('Initializing', LogLevel.DEBUG, { identityUrl });

        const { identifier } = await this.directory
            .registerNewInstance(identityUrl ?? this.windowRef.location.href)
            .catch(err => {
                throw new Error(err);
            });

        this.log('Identity resolved', LogLevel.DEBUG, { identifier });

        this.rootAppIdentifier = identifier;

        return identifier;
    }

    /**
     * Publishes a response message to the appropriate channel or handler based on the source identifier.
     * If the source is the root agent, the message is passed back to the proxy response handlers.
     * @param responseMessage - The response message to be published.
     * @param source - The identifier of the source app instance.
     */
    public publishResponseMessage(responseMessage: ResponseMessage, source: FullyQualifiedAppIdentifier): void {
        if (source.instanceId === this.rootAppIdentifier?.instanceId) {
            // the target of this response message is the root agent so pass it back as an incoming message and return
            for (const callback of this.proxyResponseHandlers) {
                callback({ payload: responseMessage });
            }
            return;
        }

        const channelId = this.lookupChannelId(source);

        if (channelId != null) {
            this.rootMessagingProvider.publish({ payload: responseMessage, channelIds: [channelId] });
        } else {
            console.error(`Could not resolve channelId for unknown source app: ${source.appId} (${source.instanceId})`);
        }
    }

    public publishEvent(
        event: EventMessage,
        appIdentifiers: [FullyQualifiedAppIdentifier, ...FullyQualifiedAppIdentifier[]],
    ): void {
        const channelIds = this.mapAppIdentifiersToChannels(appIdentifiers, event);

        if (isNonEmptyArray(channelIds)) {
            this.rootMessagingProvider.publish({ payload: event, channelIds });
        }
    }

    /**
     * Maps app identifiers to channelIds
     * Filters out the root app identifier from the array and if it exists forwards the message back to the root agent
     * @param appIdentifiers
     * @param message
     */
    private mapAppIdentifiersToChannels(
        appIdentifiers: [FullyQualifiedAppIdentifier, ...FullyQualifiedAppIdentifier[]],
        message: EventMessage | ResponseMessage,
    ): string[] {
        if (appIdentifiers.some(identifier => identifier.instanceId === this.rootAppIdentifier?.instanceId)) {
            // the target of this event is the root agent so pass it back as an incoming message and return
            for (const callback of this.proxyResponseHandlers) {
                callback({ payload: message });
            }
        }

        return appIdentifiers
            .filter(identifier => identifier.instanceId != this.rootAppIdentifier?.instanceId)
            .map(source => {
                const channelId = this.lookupChannelId(source);

                if (channelId == null) {
                    console.error(
                        `Could not resolve channelId for unknown source app: ${source.appId} (${source.instanceId})`,
                    );
                }

                return channelId;
            })
            .filter(channelId => channelId != null);
    }

    /**
     * Listens to incoming messages from the messaging provider that have been sent from proxy agents
     */
    private onMessage(
        message: IRootIncomingMessageEnvelope<RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity>,
        optionalSource?: FullyQualifiedAppIdentifier,
    ): void {
        if (isWCPValidateAppIdentity(message.payload)) {
            this.registerNewInstance(message.payload, message.channelId);
            return;
        }

        const source = optionalSource ?? this.lookupSource(message.channelId);

        if (source == null) {
            console.error(`Could not resolve source for unknown channelId: ${message.channelId}`);
            return;
        }

        this.handleRequestMessage(message.payload, source);
    }

    /**
     * passes a request message to the root agent after verifying that the class has been properly initialized
     */
    private handleRequestMessage(
        message: RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity,
        source: FullyQualifiedAppIdentifier,
    ): void {
        if (isWCPValidateAppIdentity(message)) {
            // This should never happen but log a warning if it does
            console.warn(`Unexpected message of type ${message.type} received by RootMessagePublisher`);
            return;
        }

        if (this.requestMessageHandler == null) {
            console.log(PUBLISHER_NOT_INITIALIZED, message);
            throw new Error(PUBLISHER_NOT_INITIALIZED);
        }
        this.requestMessageHandler(message, source);
    }

    /**
     * generates a new instance id and new app identifier for a new proxy agent that is performing a handshake
     */
    private async registerNewInstance(
        validateMessage: BrowserTypes.WebConnectionProtocol4ValidateAppIdentity,
        channelId: string,
    ): Promise<FullyQualifiedAppIdentifier | undefined> {
        this.log('Registering new instance', LogLevel.DEBUG, { validateMessage, channelId });

        const { identifier, application } = await this.directory.registerNewInstance(
            validateMessage.payload.identityUrl,
        );

        if (identifier == null) {
            return undefined;
        }

        this.channelIdToAppIdentifier[channelId] = identifier;
        this.instanceIdToChannelId[identifier.instanceId] = channelId;

        const response: BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse = {
            type: 'WCP5ValidateAppIdentityResponse',
            meta: {
                connectionAttemptUuid: validateMessage.meta.connectionAttemptUuid,
                timestamp: getTimestamp(),
            },
            payload: {
                ...identifier,
                instanceUuid: generateUUID(),
                implementationMetadata: await getImplementationMetadata(identifier, application),
            },
        };

        this.connectionAttemptUuidCallbacks[validateMessage.meta.connectionAttemptUuid]?.(identifier);

        this.rootMessagingProvider.publish({ payload: response, channelIds: [channelId] });

        return identifier;
    }

    private connectionAttemptUuidCallbacks: Partial<Record<string, (identity: FullyQualifiedAppIdentifier) => void>> =
        {};

    private awaitConnectionAttemptUuidValidateMessage(
        connectionAttemptUuid: string,
    ): Promise<FullyQualifiedAppIdentifier> {
        return new Promise(resolve => {
            this.connectionAttemptUuidCallbacks[connectionAttemptUuid] = identity => {
                delete this.connectionAttemptUuidCallbacks[connectionAttemptUuid];

                console.log(
                    `[DesktopAgent] Matched connectionAttemptUuid (${connectionAttemptUuid}) to app identity: ${identity.appId} (${identity.instanceId})`,
                );

                resolve(identity);
            };
        });
    }

    private lookupSource(channelId: string): FullyQualifiedAppIdentifier | undefined {
        return this.channelIdToAppIdentifier[channelId];
    }

    private lookupChannelId(source: FullyQualifiedAppIdentifier): string | undefined {
        return this.instanceIdToChannelId[source.instanceId];
    }
}
