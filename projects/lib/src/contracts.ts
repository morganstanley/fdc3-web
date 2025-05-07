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
    AppIntent,
    BrowserTypes,
    Context,
    DesktopAgent,
    FDC3Event,
    FDC3EventTypes,
    Intent,
    PrivateChannelEvent,
} from '@finos/fdc3';
import { AppDirectoryApplication } from './app-directory.contracts';

export type RequestMessage =
    | BrowserTypes.AddContextListenerRequest
    | BrowserTypes.AddIntentListenerRequest
    | BrowserTypes.BroadcastRequest
    | BrowserTypes.CreatePrivateChannelRequest
    | BrowserTypes.FindInstancesRequest
    | BrowserTypes.FindIntentRequest
    | BrowserTypes.FindIntentsByContextRequest
    | BrowserTypes.GetAppMetadataRequest
    | BrowserTypes.GetCurrentChannelRequest
    | BrowserTypes.GetInfoRequest
    | BrowserTypes.GetOrCreateChannelRequest
    | BrowserTypes.GetUserChannelsRequest
    | BrowserTypes.JoinUserChannelRequest
    | BrowserTypes.LeaveCurrentChannelRequest
    | BrowserTypes.OpenRequest
    | BrowserTypes.RaiseIntentRequest
    | BrowserTypes.RaiseIntentForContextRequest
    | BrowserTypes.GetCurrentContextRequest
    | BrowserTypes.ContextListenerUnsubscribeRequest
    | BrowserTypes.IntentListenerUnsubscribeRequest
    | BrowserTypes.PrivateChannelDisconnectRequest
    | BrowserTypes.AddEventListenerRequest
    | BrowserTypes.EventListenerUnsubscribeRequest
    | BrowserTypes.HeartbeatAcknowledgementRequest
    | BrowserTypes.IntentResultRequest
    | BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest
    | BrowserTypes.PrivateChannelAddEventListenerRequest;

export type ResponseMessage =
    | BrowserTypes.AddContextListenerResponse
    | BrowserTypes.AddIntentListenerResponse
    | BrowserTypes.BroadcastResponse
    | BrowserTypes.CreatePrivateChannelResponse
    | BrowserTypes.FindInstancesResponse
    | BrowserTypes.FindIntentResponse
    | BrowserTypes.GetAppMetadataResponse
    | BrowserTypes.GetCurrentChannelResponse
    | BrowserTypes.GetInfoResponse
    | BrowserTypes.GetOrCreateChannelResponse
    | BrowserTypes.GetUserChannelsResponse
    | BrowserTypes.JoinUserChannelResponse
    | BrowserTypes.LeaveCurrentChannelResponse
    | BrowserTypes.OpenResponse
    | BrowserTypes.RaiseIntentResponse
    | BrowserTypes.RaiseIntentForContextResponse
    | BrowserTypes.RaiseIntentResultResponse
    | BrowserTypes.ContextListenerUnsubscribeResponse
    | BrowserTypes.IntentListenerUnsubscribeResponse
    | BrowserTypes.ContextListenerUnsubscribeResponse
    | BrowserTypes.IntentListenerUnsubscribeResponse
    | BrowserTypes.GetCurrentContextResponse
    | BrowserTypes.FindIntentsByContextResponse
    | BrowserTypes.EventListenerUnsubscribeResponse
    | BrowserTypes.IntentResultResponse
    | BrowserTypes.AddEventListenerResponse
    | BrowserTypes.PrivateChannelUnsubscribeEventListenerResponse
    | BrowserTypes.PrivateChannelAddEventListenerResponse
    | BrowserTypes.PrivateChannelDisconnectResponse;

export type EventMessage =
    | BrowserTypes.PrivateChannelOnAddContextListenerEvent
    | BrowserTypes.PrivateChannelOnUnsubscribeEvent
    | BrowserTypes.PrivateChannelOnDisconnectEvent
    | BrowserTypes.BroadcastEvent
    | BrowserTypes.IntentEvent
    | BrowserTypes.ChannelChangedEvent
    | BrowserTypes.HeartbeatEvent
    | FDC3Event
    | PrivateChannelEvent;

export type HandshakeMessage =
    | BrowserTypes.WebConnectionProtocol1Hello
    | BrowserTypes.WebConnectionProtocol3Handshake
    | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
    | BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse;

export type UIProviderFactory = (agent: Promise<DesktopAgent>) => Promise<IUIProvider>;
export type AppResolverFactory = (agent: Promise<DesktopAgent>) => Promise<IAppResolver>;
export type MessagingProviderFactory<T extends IProxyMessagingProvider | IRootMessagingProvider> = () => Promise<T>;

export type Message = RequestMessage | ResponseMessage | EventMessage | HandshakeMessage;

/**
 * A Response or Event message sent from the root app usually in response to a request message received from a proxy agent
 */
export type IRootOutgoingMessageEnvelope = {
    channelIds: [string, ...string[]];
    payload: ResponseMessage | EventMessage | BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse;
};

/**
 * An incoming message to the root agent from a proxy
 */
export interface IRootIncomingMessageEnvelope<
    T extends RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity = RequestMessage,
> {
    payload: T;
    /**
     * Indicates which channel (which maps to a given proxy agent) the message was received from
     */
    channelId: string;
}

/**
 * A Request message sent from a proxy agent. No target information is required as all request messages go to the root
 */
export type IProxyOutgoingMessageEnvelope = {
    payload: RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity;
};

/**
 * A Request message sent from a proxy agent. No target information is required as all request messages go to the root
 */
export type IProxyIncomingMessageEnvelope = {
    payload: ResponseMessage | EventMessage;
};

/**
 * A callback function for passing incoming messages to a registered subscriber
 */
export type IncomingMessageCallback<T extends IProxyIncomingMessageEnvelope | IRootIncomingMessageEnvelope<any>> = (
    message: T,
) => void;

/**
 * Allows root agent to publish messages to and receive messages from proxy agents
 */
export interface IRootMessagingProvider<
    T extends RequestMessage | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity = RequestMessage,
> {
    /**
     * Publishes a message to one of more target proxy agents
     * @param message
     */
    publish(message: IRootOutgoingMessageEnvelope): void;
    subscribe(callback: IncomingMessageCallback<IRootIncomingMessageEnvelope<T>>): void;
}

/**
 * Allows proxy agents to receive messages from the root
 */
export interface IProxyMessagingProvider {
    /**
     * sends a request message to the root agent
     */
    sendMessage(message: IProxyOutgoingMessageEnvelope): void;
    addResponseHandler(callback: IncomingMessageCallback<IProxyIncomingMessageEnvelope>): void;
}

export type AppIdentifierListenerPair = { appIdentifier: FullyQualifiedAppIdentifier; listenerUUID: string };

//uses 'allEvents' constant instead of null to signify app is listening to all events as null cannot be used as an index
export type EventListenerKey = FDC3EventTypes | 'allEvents';
export type EventListenerLookup = Partial<Record<EventListenerKey, AppIdentifierListenerPair[]>>;

export type UnqualifiedAppIdentifier = Omit<AppIdentifier, 'instanceId'>;
export type FullyQualifiedAppIdentifier = Required<Pick<AppIdentifier, 'appId' | 'instanceId'>>;
//fullyQualifiedAppId is globally unique: appId@hostname
export type FullyQualifiedAppId = `${string}@${string}`;

export type ResolveForIntentPayload = {
    context: Context;
    appIdentifier?: UnqualifiedAppIdentifier;
    intent: Intent;
    /**
     * Optional app intent data which contains a list of apps and app instances. If this is not passed the resolver should lookup the list of apps and app instances using desktopAgent.findIntent()
     */
    appIntent?: AppIntent;
};

export type ResolveForContextPayload = {
    context: Context;
    appIdentifier?: UnqualifiedAppIdentifier;
    /**
     * Optional list of app intents for this context that each contain a list of apps and app instances. If this is not passed the resolver should lookup the list of apps and app instances using desktopAgent.findIntentsByContext()
     */
    appIntents?: AppIntent[];
};

export type ResolveForContextResponse = {
    intent: Intent;
    app: FullyQualifiedAppIdentifier;
};

/**
 * Provides a mechanism for resolving an app from an unqualified identifier, an intent, a context or a combination
 */
export interface IAppResolver {
    /**
     * Resolves an app in response to a raiseIntent() function call
     */
    resolveAppForIntent(payload: ResolveForIntentPayload): Promise<FullyQualifiedAppIdentifier>;
    /**
     * resolves an app in response to a raiseIntentForContext() function call
     */
    resolveAppForContext(payload: ResolveForContextPayload): Promise<ResolveForContextResponse>;
}

/**
 * Allows a desktop agent to launch an app resolution UI that allows the user to pick which app instance should be used to handle whatever intent has been raised
 */
export interface IUIProvider extends IAppResolver {}

export type RootDesktopAgentFactoryParams = {
    messagingProviderFactory?: MessagingProviderFactory<IRootMessagingProvider>;
    uiProvider?: UIProviderFactory;
    appDirectoryUrls?: string[];
    openStrategies?: IOpenApplicationStrategy[];
    identityUrl?: string;
};

export type ProxyDesktopAgentFactoryParams = {
    appIdentifier: FullyQualifiedAppIdentifier;
    messagingProviderFactory: MessagingProviderFactory<IProxyMessagingProvider>;
};

export type OpenApplicationStrategyParams = {
    appDirectoryRecord: Omit<AppDirectoryApplication, 'hostManifests'>;
    agent: DesktopAgent;
    manifest?: unknown;
};

export interface IOpenApplicationStrategy {
    manifestKey?: string;
    canOpen(params: OpenApplicationStrategyParams): Promise<boolean>;
    /**
     * Opens a new window and returns a promise that resolves to the connectionAttemptUUid of the new window
     * TODO: support multiple connection attempts for each window - use a callback to notify the caller of the connection attempt rather than returning a promise
     * @param params
     */
    open(params: OpenApplicationStrategyParams): Promise<string>;
}
