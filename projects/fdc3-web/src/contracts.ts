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
    AppMetadata,
    BrowserTypes,
    Context,
    DesktopAgent,
    DesktopAgent as FinosDesktopAgent,
    FDC3Event,
    FDC3EventTypes,
    GetAgentLogLevels,
    Intent,
    IntentHandler,
    Listener,
    PrivateChannelEvent,
} from '@finos/fdc3';
import { AppDirectoryApplication, IMSHostManifest, LocalAppDirectory } from './app-directory.contracts.js';
import { UpdateInstanceMetadataRequest, UpdateInstanceMetadataResponse } from './contracts.internal.js';
// TEMPORARY (FDC3 3.0): remove this import and use BrowserTypes.CloseRequest / BrowserTypes.CloseResponse once @finos/fdc3 3.0 is installed. See ./fdc3-next/close.ts
import type { CloseRequest, CloseResponse } from './fdc3-next/index.js';

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
    | BrowserTypes.PrivateChannelAddEventListenerRequest
    | UpdateInstanceMetadataRequest
    // TEMPORARY (FDC3 3.0): replace with BrowserTypes.CloseRequest once @finos/fdc3 3.0 is installed
    | CloseRequest;

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
    | BrowserTypes.PrivateChannelDisconnectResponse
    | UpdateInstanceMetadataResponse
    // TEMPORARY (FDC3 3.0): replace with BrowserTypes.CloseResponse once @finos/fdc3 3.0 is installed
    | CloseResponse;

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

export type UIProviderFactory = (agent: Promise<FinosDesktopAgent>) => Promise<IUIProvider>;
export type AppResolverFactory = (agent: Promise<FinosDesktopAgent>) => Promise<IAppResolver>;
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
    T extends
        | RequestMessage
        | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
        | BrowserTypes.WebConnectionProtocol6Goodbye = RequestMessage,
> {
    payload: T;
    /**
     * Indicates which channel (which maps to a given proxy agent) the message was received from
     */
    channelId: string;
    /**
     * The window of the app instance the message was received from, if known (e.g. captured from the
     * WCP1Hello handshake). Used to notify INewInstanceStrategy once an instanceId has been assigned.
     */
    window?: Window;
}

/**
 * A Request message sent from a proxy agent. No target information is required as all request messages go to the root
 */
export type IProxyOutgoingMessageEnvelope = {
    payload:
        | RequestMessage
        | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
        | BrowserTypes.WebConnectionProtocol6Goodbye;
};

/**
 * A Request message sent from a proxy agent. No target information is required as all request messages go to the root
 */
export type IProxyIncomingMessageEnvelope = {
    payload: ResponseMessage | EventMessage | BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse;
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
    T extends
        | RequestMessage
        | BrowserTypes.WebConnectionProtocol4ValidateAppIdentity
        | BrowserTypes.WebConnectionProtocol6Goodbye = RequestMessage,
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

export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected';

export type Subscription = { unsubscribe: () => void };

/**
 * Moves JSON payloads between this Desktop Agent and a Desktop Agent Bridge only - it never
 * interprets them. Mirrors the role IRootMessagingProvider plays for proxy agents.
 */
export interface IBridgeTransport {
    readonly state: BridgeConnectionState;
    connect(): void;
    send(message: unknown): void;
    subscribe(callback: (message: unknown) => void): Subscription;
    onStateChange(callback: (state: BridgeConnectionState) => void): Subscription;
    /**
     * The bridge rejected us (e.g. authentication failure). Drops this connection but keeps
     * scanning for a bridge to connect to.
     */
    reset(): void;
    /**
     * Permanent teardown: closes the connection, clears all timers, and stops retrying.
     */
    close(): void;
}

export type BridgeTransportFactory = () => Promise<IBridgeTransport>;

/**
 * Configures Desktop Agent Bridging (https://fdc3.finos.org/docs/agent-bridging/spec). When omitted
 * from RootDesktopAgentFactoryParams, no bridge is constructed and no bridging behaviour is active.
 */
export type BridgeParams = {
    /**
     * Desktop Agent name requested from the bridge. Defaults to rootAppId.
     */
    requestedName?: string;
    /**
     * Ports scanned to discover the bridge websocket. Defaults to BRIDGE.DEFAULT_PORT_RANGE.
     */
    portRange?: [number, number];
    /**
     * Overrides the default websocket transport. Used in unit tests to inject a fake transport so
     * no real network connection is attempted.
     */
    transportFactory?: BridgeTransportFactory;
    /**
     * JWT presented to the bridge if ConnectionStep2Hello reports authRequired.
     */
    authToken?: string;
    /**
     * Verifies the bridge's own JWT from the hello message. If omitted, any bridge that identifies
     * itself is trusted.
     */
    validateBridgeAuthToken?: (authToken: string | undefined) => boolean | Promise<boolean>;
    /**
     * Milliseconds to wait for another agent (via the bridge) to respond to a request. Defaults to
     * BRIDGE.RESPONSE_TIMEOUT_MS.
     */
    responseTimeoutMs?: number;
    /**
     * Milliseconds to wait for the result of an intent raised on a remote agent. Defaults to
     * BRIDGE.INTENT_RESULT_TIMEOUT_MS.
     */
    intentResultTimeoutMs?: number;
    /**
     * Milliseconds to pause after exhausting the port range before scanning again. Defaults to
     * BRIDGE.RETRY_PAUSE_MS.
     */
    reconnectDelayMs?: number;
};

/**
 * Extends the FDC3 DesktopAgent interface with features planned for the next version of FDC3.
 */
export interface DesktopAgentNext extends FinosDesktopAgent {
    /**
     * Allows the registration of an intent handler that only triggers when a specific context type or set of context types is passed with the intent
     * This matches the behavior of intent handlers registered through the app directory
     * @param intent
     * @param contextType
     * @param handler
     */
    addIntentListenerWithContext(
        intent: Intent,
        contextType: string | string[],
        handler: IntentHandler,
    ): Promise<Listener>;

    /**
     * Updates the instance metadata for the calling app instance.
     * Instance metadata can be used to disambiguate instances of the same app,
     * such as displaying a window title or other identifying information in resolver UIs.
     * @param instanceMetadata key-value pairs of metadata to set for this instance
     */
    updateInstanceMetadata(instanceMetadata: { [key: string]: any }): Promise<void>;

    /**
     * Returns AppMetadata for all available instances of the given app, including instanceMetadata when available.
     * Overrides the base DesktopAgent.findInstances to return enriched metadata.
     */
    findInstances(app: AppIdentifier): Promise<AppMetadata[]>;

    /**
     * TEMPORARY (FDC3 3.0): remove this declaration once @finos/fdc3 3.0 is installed — `close()`
     * will then be part of the base `DesktopAgent` interface. See ./fdc3-next/close.ts
     *
     * Requests that the Desktop Agent close the calling application's own window or frame.
     *
     * This API is limited to self-close only — it cannot be used to close another application.
     *
     * On a successful close the app is destroyed. The promise rejects with a value from
     * `CloseError` if the Desktop Agent cannot close the app.
     *
     * Feature issue: https://github.com/finos/FDC3/issues/1809
     */
    close(): Promise<void>;
}

export type AppIdentifierListenerPair = {
    appIdentifier: FullyQualifiedAppIdentifier;
    listenerUUID: string;
};

//uses 'allEvents' constant instead of null to signify app is listening to all events as null cannot be used as an index
export type EventListenerKey = FDC3EventTypes | 'allEvents';
export type EventListenerLookup = Partial<Record<EventListenerKey, AppIdentifierListenerPair[]>>;

export type UnqualifiedAppIdentifier = Omit<AppIdentifier, 'instanceId'>;
export type FullyQualifiedAppIdentifier = Required<Pick<AppIdentifier, 'appId' | 'instanceId'>>;

//fullyQualifiedAppId is globally unique: appId@hostname
export type FullyQualifiedAppId = `${string}@${string}`;

export type AppHostManifestLookup = Partial<Record<string, IMSHostManifest>>;

export type ResolveForIntentPayload = {
    context: Context;
    /**
     * Optional app identifier used to filter the resolved apps. The appId may be either fully
     * qualified (appId@hostname) or unqualified (appId only); the resolver normalizes both forms
     * before matching against the app directory entries.
     */
    appIdentifier?: UnqualifiedAppIdentifier;
    intent: Intent;
    // used to indicate if an app is a singleton app
    appManifests: AppHostManifestLookup;
    /**
     * Optional app intent data which contains a list of apps and app instances. If this is not passed the resolver should lookup the list of apps and app instances using desktopAgent.findIntent()
     */
    appIntent?: AppIntent;
};

export type ResolveForContextPayload = {
    context: Context;
    /**
     * Optional app identifier used to filter the resolved apps. The appId may be either fully
     * qualified (appId@hostname) or unqualified (appId only); the resolver normalizes both forms
     * before matching against the app directory entries.
     */
    appIdentifier?: UnqualifiedAppIdentifier;
    // used to indicate if an app is a singleton app
    appManifests: AppHostManifestLookup;
    /**
     * Optional list of app intents for this context that each contain a list of apps and app instances. If this is not passed the resolver should lookup the list of apps and app instances using desktopAgent.findIntentsByContext()
     */
    appIntents?: AppIntent[];
};

export type ResolveForIntentResponse = {
    app: AppIdentifier;
};

export type ResolveForContextResponse = {
    intent: Intent;
    app: AppIdentifier;
};

/**
 * Provides a mechanism for resolving an app from an unqualified identifier, an intent, a context or a combination.
 *
 * Resolvers are responsible for selecting an app or an existing instance of an app
 * They may return:
 * - A FullyQualifiedAppIdentifier (with instanceId) if an existing instance was selected
 * - An AppIdentifier (without instanceId) if a new instance of an app should be opened
 *
 */
export interface IAppResolver {
    /**
     * Resolves an app in response to a raiseIntent() function call
     */
    resolveAppForIntent(payload: ResolveForIntentPayload): Promise<AppIdentifier>;
    /**
     * resolves an app in response to a raiseIntentForContext() function call
     */
    resolveAppForContext(payload: ResolveForContextPayload): Promise<ResolveForContextResponse>;
}

/**
 * Allows a desktop agent to launch an app resolution UI that allows the user to pick which app instance should be used to handle whatever intent has been raised
 */
export interface IUIProvider extends IAppResolver {}

export type BackoffRetryParams = {
    /**
     * The maximum number of attempts to retry the connection. This includes the first attempt.
     */
    maxAttempts?: number;
    /**
     * The initial delay in milliseconds before the first retry attempt. This will increase exponentially with each attempt
     */
    baseDelay?: number;
};

export type RootDesktopAgentFactoryParams = {
    /**
     * Either a fully qualified appId (appId@hostname) or an unqualified appId (appId only). If an unqualified appId is provided the hostname of the current window will be used to create a fully qualified appId
     */
    rootAppId: string;
    messagingProviderFactory?: MessagingProviderFactory<IRootMessagingProvider>;
    uiProvider?: UIProviderFactory;
    appDirectoryEntries?: (string | LocalAppDirectory)[];
    applicationStrategies?: DesktopAgentStrategies[];
    identityUrl?: string;
    /**
     * retry parameters for the root agent to retry loading the app directory urls
     */
    backoffRetry?: BackoffRetryParams;
    logLevels?: GetAgentLogLevels;
    /**
     * Optional app directory entry for the root application. When provided this will be used when the root app is added to the application directory, allowing consumers to specify intents the root agent listens for via the interop property.
     * The appId field is omitted as it is derived from rootAppId.
     */
    appDirectoryEntry?: Omit<AppDirectoryApplication, 'appId'>;
    /**
     * Opts this agent in to Desktop Agent Bridging (https://fdc3.finos.org/docs/agent-bridging/spec).
     * When omitted no bridge is constructed and no bridging behaviour is active.
     */
    bridge?: BridgeParams;
};

export type ProxyDesktopAgentFactoryParams = {
    appIdentifier: FullyQualifiedAppIdentifier;
    messagingProviderFactory: MessagingProviderFactory<IProxyMessagingProvider>;
    logLevels?: GetAgentLogLevels;
};

export type ApplicationStrategyParams = {
    appDirectoryRecord: Omit<AppDirectoryApplication, 'hostManifests'>;
    agent: DesktopAgent;
    /**
     * manifest from the app directory record identified by the strategy's manifestKey
     */
    manifest?: unknown;
    context?: Context;
};

export type OpenApplicationStrategyResolverParams = ApplicationStrategyParams & {
    appReadyPromise: Promise<FullyQualifiedAppIdentifier>;
};

export type DesktopAgentStrategies =
    | IOpenApplicationStrategy
    | ISelectApplicationStrategy
    | INewInstanceStrategy
    | ICloseApplicationStrategy;

export type NewInstanceStrategyParams = {
    /**
     * The window of the newly registered application instance, if known. This is populated from the window
     * that completed the WCP1Hello/WCP4ValidateAppIdentity handshake, so it is available regardless of how the
     * window was created (e.g. via an IOpenApplicationStrategy, `window.open()`, or an iframe that registers itself).
     * It will be undefined if the app instance is not window-based (e.g. connects via a non-window transport).
     */
    window?: Window;
    fullyQualifiedAppIdentifier: FullyQualifiedAppIdentifier;
};

/**
 * Notified by the desktop agent whenever a new instanceId has been assigned to an application instance that has
 * completed its connection handshake. Unlike IOpenApplicationStrategy/ISelectApplicationStrategy, this is invoked
 * for every new instance regardless of how it was opened, so it can be used to track or manage windows that were
 * not opened via an IOpenApplicationStrategy.
 */
export interface INewInstanceStrategy {
    onNewInstance(params: NewInstanceStrategyParams): void;
}

/**
 * Replaces the default mechanism used to open new applications
 * This is triggered by agent.open(), agent.raiseIntent() and agent.raiseIntentForContext()
 */
export interface IOpenApplicationStrategy {
    /**
     * Used to identify the manifest key that is used to lookup the specific manifest from the appDirectory record's hostManifests
     * The manifest identified through this key will then be passed to the open() and canOpen() functions
     */
    manifestKey?: string;

    /**
     * if the strategy is able to open a given application returns true
     * If false is returned the strategy will not be used by the desktop agent and the next one will be tried
     */

    canOpen(params: ApplicationStrategyParams): Promise<boolean>;

    /**
     * Opens a new window and returns a promise that resolves to the connectionAttemptUUid of the new window
     * TODO: support multiple connection attempts for each window - use a callback to notify the caller of the connection attempt rather than returning a promise
     * @param params
     */
    open(params: OpenApplicationStrategyResolverParams): Promise<string>;
}

export type SelectApplicationStrategyParams = {
    appDirectoryRecord?: Omit<AppDirectoryApplication, 'hostManifests'>;
    agent: DesktopAgent;
    /**
     * manifest from the app directory record identified by the strategy's manifestKey
     */
    manifest?: unknown;
    context?: Context;
    appIdentifier: FullyQualifiedAppIdentifier;
};

/**
 * allows an application that has already been opened to be selected or focussed
 * This might involve restoring a minimised window or bringing a window to the front so that it is visible to the user
 */
export interface ISelectApplicationStrategy {
    /**
     * Used to identify the manifest key that is used to lookup the specific manifest from the appDirectory record's hostManifests
     * The manifest identified through this key will then be passed to the open() and canOpen() functions
     */
    manifestKey?: string;

    /**
     * if the strategy is able to open a given application returns true
     * If false is returned the strategy will not be used by the desktop agent and the next one will be tried
     */

    canSelectApp(params: SelectApplicationStrategyParams): Promise<boolean>;

    /**
     * Opens a new window and returns a promise that resolves to the connectionAttemptUUid of the new window
     * TODO: support multiple connection attempts for each window - use a callback to notify the caller of the connection attempt rather than returning a promise
     * @param params
     */
    selectApp(params: SelectApplicationStrategyParams): Promise<void>;
}

export type CloseApplicationStrategyParams = {
    agent: DesktopAgent;
    /**
     * The fully qualified identifier of the application instance that has requested to be closed.
     */
    appIdentifier: FullyQualifiedAppIdentifier;
    /**
     * The app directory record for the application, if one could be resolved. May be undefined for
     * apps that are not backed by an app directory entry.
     */
    appDirectoryRecord?: Omit<AppDirectoryApplication, 'hostManifests'>;
    /**
     * manifest from the app directory record identified by the strategy's manifestKey
     */
    manifest?: unknown;
};

/**
 * Allows a consumer to provide an implementation for closing applications that were opened by the
 * desktop agent, following the same pattern as {@link IOpenApplicationStrategy} and
 * {@link ISelectApplicationStrategy}.
 *
 * This is triggered by an app calling `agent.close()` to request that its own window or frame be
 * closed. A default implementation ({@link FallbackOpenStrategy}) is always provided that tracks
 * and closes windows opened by the agent itself; consumers that open apps in their own windows or
 * iframes (e.g. via a custom {@link IOpenApplicationStrategy}) should provide a matching
 * `ICloseApplicationStrategy`.
 */
export interface ICloseApplicationStrategy {
    /**
     * Used to identify the manifest key that is used to lookup the specific manifest from the
     * appDirectory record's hostManifests. The manifest identified through this key will then be
     * passed to the closeApp() and canCloseApp() functions
     */
    manifestKey?: string;

    /**
     * If the strategy is able to close the given application instance returns true.
     * If false is returned the strategy will not be used by the desktop agent and the next one will be tried.
     */
    canCloseApp(params: CloseApplicationStrategyParams): Promise<boolean>;

    /**
     * Closes the window or frame that hosts the given application instance.
     */
    closeApp(params: CloseApplicationStrategyParams): Promise<void>;
}

/**
 * Used as an instanceId when calling `raiseIntent` or `raiseIntentForContext` to force the desktop agent to create a new instance of the app.
 * There is currently no way to tell the agent to create a new instance of a given app using the current spec.
 * If only an appId is sent as the appIdentifier (e.g. `{ appId: "my-app-id" }`), then the agent will typically show a resolver UI with multiple existing instances and a "create new instance" option.
 * This is a temporary solution until the issue in the FDC3 spec is resolved.
 *
 * Issue raised: https://github.com/finos/FDC3/issues/1940
 *
 * raiseIntent("my-intent", {id: "my-context"}, {appId: "my-app", instanceId: FORCE_NEW_INSTANCE});
 *
 */
export const FORCE_NEW_INSTANCE = 'ms.fdc3-web.desktop-agent.force-new-app-instance';
