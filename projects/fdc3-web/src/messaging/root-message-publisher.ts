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
    appIdentityOriginsMatch,
    createLogger,
    generateUUID,
    getImplementationMetadata,
    getTimestamp,
    isNonEmptyArray,
    isWCPGoodbye,
    isWCPValidateAppIdentity,
} from '../helpers/index.js';

const PUBLISHER_NOT_INITIALIZED = 'RootMessagePublisher not initialized before messages received.';

type RequestMessageHandler = (
    message: RequestMessage | BrowserTypes.WebConnectionProtocol6Goodbye,
    source: FullyQualifiedAppIdentifier,
) => void;

/**
 * Responsible for publishing all messages from the root agent to proxy agents
 * Maintains a lookup mapping app instances to channelIds
 */
export class RootMessagePublisher implements IRootPublisher {
    private instanceIdToChannelId: Partial<Record<string, string>> = {};
    private channelIdToAppIdentifier: Partial<Record<string, FullyQualifiedAppIdentifier>> = {};
    /**
     * Maps the (secret) instanceUuid issued to an app instance to its identity, so that a reconnecting
     * app (after a navigation or refresh) that presents a matching instanceUuid can be reissued the
     * same instanceId. The instanceUuid is never shared via the FDC3 API so acts as a shared secret.
     */
    private instanceUuidToIdentity: Partial<Record<string, FullyQualifiedAppIdentifier>> = {};
    private log = createLogger(RootMessagePublisher, 'connection');

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
            | RequestMessage
            | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
            | BrowserTypes.WebConnectionProtocol6Goodbye
        >,
        private directory: AppDirectory,
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
        if (!isWCPGoodbye(message.payload)) {
            this.handleRequestMessage(message.payload, this.directory.rootAppIdentifier);
        }
    }

    /**
     * Publishes a response message to the appropriate channel or handler based on the source identifier.
     * If the source is the root agent, the message is passed back to the proxy response handlers.
     * @param responseMessage - The response message to be published.
     * @param source - The identifier of the source app instance.
     */
    public publishResponseMessage(responseMessage: ResponseMessage, source: FullyQualifiedAppIdentifier): void {
        if (source.instanceId === this.directory.rootAppIdentifier.instanceId) {
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
        if (appIdentifiers.some(identifier => identifier.instanceId === this.directory.rootAppIdentifier.instanceId)) {
            // the target of this event is the root agent so pass it back as an incoming message and return
            for (const callback of this.proxyResponseHandlers) {
                callback({ payload: message });
            }
        }

        return appIdentifiers
            .filter(identifier => identifier.instanceId != this.directory.rootAppIdentifier.instanceId)
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
        message: IRootIncomingMessageEnvelope<
            | RequestMessage
            | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
            | BrowserTypes.WebConnectionProtocol6Goodbye
        >,
    ): void {
        if (isWCPValidateAppIdentity(message.payload)) {
            this.registerNewInstance(message.payload, message.channelId, message.origin);
            return;
        }

        const source = this.lookupSource(message.channelId);

        if (isWCPGoodbye(message.payload)) {
            if (source != null) {
                this.log(`Goodbye message received from ${source.appId} (${source.instanceId})`, LogLevel.INFO);
            }
            // Forward the goodbye so the agent can clean up, then forget the channel mappings.
            if (source != null) {
                this.handleRequestMessage(message.payload, source);
                this.forgetInstance(source, message.channelId);
            }
            return;
        }

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
        message:
            | RequestMessage
            | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
            | BrowserTypes.WebConnectionProtocol6Goodbye,
        source: FullyQualifiedAppIdentifier,
    ): void {
        if (isWCPValidateAppIdentity(message)) {
            // This should never happen but log a warning if it does
            console.warn(`Unexpected message of type ${message.type} received by RootMessagePublisher`);
            return;
        } else if (this.requestMessageHandler == null) {
            console.log(PUBLISHER_NOT_INITIALIZED, message);
            throw new Error(PUBLISHER_NOT_INITIALIZED);
        }
        this.requestMessageHandler(message, source);
    }

    /**
     * Validates the identity of a proxy agent performing a handshake (WCP step 2) and, on success,
     * issues (or reissues, for a reconnecting app) an instanceId and instanceUuid. On failure a
     * WCP5ValidateAppIdentityFailedResponse is returned and no instance is registered.
     */
    private async registerNewInstance(
        validateMessage: BrowserTypes.WebConnectionProtocol4ValidateAppIdentity,
        channelId: string,
        origin?: string,
    ): Promise<FullyQualifiedAppIdentifier | undefined> {
        this.log('Registering new instance', LogLevel.DEBUG, { validateMessage, channelId, origin });

        const { identityUrl, actualUrl } = validateMessage.payload;

        // WCP step 2.1: the identityUrl, actualUrl and the WCP1Hello message origin MUST share an origin.
        if (!appIdentityOriginsMatch(identityUrl, actualUrl, origin)) {
            this.log('App identity rejected: origin mismatch', LogLevel.WARN, { identityUrl, actualUrl, origin });
            this.publishFailedResponse(
                validateMessage,
                channelId,
                'Origin of identityUrl, actualUrl and connection did not match',
            );
            return undefined;
        }

        // WCP step 2.1: match the identityUrl to a known AppD record to determine the appId.
        const appId = await this.directory.resolveAppId(identityUrl).catch(() => undefined);

        if (appId == null) {
            this.log('App identity rejected: unknown identityUrl', LogLevel.WARN, identityUrl);
            this.publishFailedResponse(validateMessage, channelId, 'App identity could not be determined');
            return undefined;
        }

        // WCP step 2.2: if the app presents a known instanceUuid for the same appId it is reconnecting,
        // so reissue the same instanceId. Otherwise assign fresh identity.
        const { instanceId: priorInstanceId, instanceUuid: priorInstanceUuid } = validateMessage.payload;
        const priorIdentity = priorInstanceUuid != null ? this.instanceUuidToIdentity[priorInstanceUuid] : undefined;
        const reconnecting =
            priorIdentity != null && priorIdentity.appId === appId && priorIdentity.instanceId === priorInstanceId;

        const { identifier, application } = await this.directory.registerNewInstance(
            identityUrl,
            reconnecting ? priorInstanceId : undefined,
        );

        const instanceUuid = reconnecting && priorInstanceUuid != null ? priorInstanceUuid : generateUUID();

        this.channelIdToAppIdentifier[channelId] = identifier;
        this.instanceIdToChannelId[identifier.instanceId] = channelId;
        this.instanceUuidToIdentity[instanceUuid] = identifier;

        const response: BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse = {
            type: 'WCP5ValidateAppIdentityResponse',
            meta: {
                connectionAttemptUuid: validateMessage.meta.connectionAttemptUuid,
                timestamp: getTimestamp(),
            },
            payload: {
                ...identifier,
                instanceUuid,
                implementationMetadata: await getImplementationMetadata(identifier, application),
            },
        };

        this.connectionAttemptUuidCallbacks[validateMessage.meta.connectionAttemptUuid]?.(identifier);

        this.rootMessagingProvider.publish({ payload: response, channelIds: [channelId] });

        return identifier;
    }

    /**
     * Publishes a WCP5ValidateAppIdentityFailedResponse to the connecting app, causing its getAgent()
     * call to reject with AgentError.AccessDenied.
     */
    private publishFailedResponse(
        validateMessage: BrowserTypes.WebConnectionProtocol4ValidateAppIdentity,
        channelId: string,
        message: string,
    ): void {
        const response: BrowserTypes.WebConnectionProtocol5ValidateAppIdentityFailedResponse = {
            type: 'WCP5ValidateAppIdentityFailedResponse',
            meta: {
                connectionAttemptUuid: validateMessage.meta.connectionAttemptUuid,
                timestamp: getTimestamp(),
            },
            payload: { message },
        };

        this.rootMessagingProvider.publish({ payload: response, channelIds: [channelId] });
    }

    /**
     * Removes channel and identity mappings for a disconnected instance (e.g. after a WCP6Goodbye).
     * The instanceUuid mapping is retained so the app can reconnect and reclaim its instanceId.
     */
    private forgetInstance(source: FullyQualifiedAppIdentifier, channelId: string): void {
        delete this.channelIdToAppIdentifier[channelId];
        delete this.instanceIdToChannelId[source.instanceId];
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
