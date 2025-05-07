/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, DesktopAgent, ImplementationMetadata, Intent, OpenError, ResolveError } from '@finos/fdc3';
import { AppDirectory } from '../app-directory';
import { AppDirectoryApplication } from '../app-directory.contracts';
import { ChannelFactory } from '../channel';
import { ChannelMessageHandler } from '../channel/channel-message-handler';
import { HEARTBEAT } from '../constants';
import {
    AppIdentifierListenerPair,
    EventListenerKey,
    EventListenerLookup,
    FullyQualifiedAppIdentifier,
    IOpenApplicationStrategy,
    RequestMessage,
} from '../contracts';
import { IRootPublisher } from '../contracts.internal';
import {
    appInstanceEquals,
    convertToEventListenerIndex,
    createEvent,
    createLogger,
    createResponseMessage,
    decodeUUUrl,
    generateUUID,
    generateUUUrl,
    getHostManifest,
    getImplementationMetadata,
    isContext,
    isFindInstancesErrors,
    isFullyQualifiedAppIdentifier,
    isOpenError,
    isResponsePayloadError,
} from '../helpers';
import { RootMessagePublisher } from '../messaging';
import { DesktopAgentProxy } from './desktop-agent-proxy';
import { FallbackOpenStrategy } from './fallback-open-strategy';

const log = createLogger('DesktopAgent');

type RootDesktopAgentParams = {
    appIdentifier: FullyQualifiedAppIdentifier;
    rootMessagePublisher: RootMessagePublisher;
    directory: AppDirectory;
    channelFactory: ChannelFactory;
    openStrategies?: IOpenApplicationStrategy[];
    window?: Window; //used for testing FallbackOpenStrategy
};

/**
 * DesktopAgentImpl is the root agent that all Proxy agents talk to
 * DesktopAgentImpl extends DesktopAgentProxy so that all function calls are handled in the same way - with request and response messages
 * request messages are handled by the onMessage function
 */
export class DesktopAgentImpl extends DesktopAgentProxy implements DesktopAgent {
    private readonly intentListeners: Partial<Record<Intent, AppIdentifierListenerPair[]>> = {};
    //used when raising intents so desktop agent knows when chosen app has added required intentListener
    private readonly intentListenerCallbacks: Map<
        string,
        (source: FullyQualifiedAppIdentifier, intent: string) => void
    >;

    private readonly eventListeners: EventListenerLookup = {};

    private directory: AppDirectory;
    private channelMessageHandler: ChannelMessageHandler;
    private openStrategies: IOpenApplicationStrategy[];
    private rootMessagePublisher: IRootPublisher;

    // Heartbeat tracking
    private readonly heartbeatTimers: Map<FullyQualifiedAppIdentifier, ReturnType<typeof setInterval>> = new Map();
    private readonly heartbeatRetries: Map<FullyQualifiedAppIdentifier, number> = new Map();
    private readonly heartbeatTimeouts: Map<FullyQualifiedAppIdentifier, ReturnType<typeof setTimeout>> = new Map();
    private readonly connectedProxies: Set<FullyQualifiedAppIdentifier> = new Set();

    constructor(params: RootDesktopAgentParams) {
        super({
            appIdentifier: params.appIdentifier,
            messagingProvider: params.rootMessagePublisher,
            channelFactory: params.channelFactory,
        });
        this.rootMessagePublisher = params.rootMessagePublisher;
        params.rootMessagePublisher.requestMessageHandler = this.onRequestMessage.bind(this);
        this.directory = params.directory;
        this.channelMessageHandler = params.channelFactory.createMessageHandler(this.rootMessagePublisher);

        this.intentListenerCallbacks = new Map<string, (source: FullyQualifiedAppIdentifier, intent: string) => void>();

        //if no other strategy works, desktop agent will try the fallback strategy
        this.openStrategies = [...(params.openStrategies ?? []), new FallbackOpenStrategy(params.window)];
    }

    private async onRequestMessage(
        requestMessage: RequestMessage,
        sourceApp: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        // Start heartbeat monitoring when we receive any message from a proxy
        this.startHeartbeat(sourceApp);

        switch (requestMessage.type) {
            case 'addIntentListenerRequest':
                return this.onAddIntentListenerRequest(requestMessage, sourceApp);
            case 'raiseIntentRequest':
                return this.onRaiseIntentRequest(requestMessage, sourceApp);
            case 'raiseIntentForContextRequest':
                return this.onRaiseIntentForContext(requestMessage, sourceApp);
            case 'intentResultRequest':
                return this.onIntentResultRequest(requestMessage, sourceApp);
            case 'findInstancesRequest':
                return this.onFindInstancesRequest(requestMessage, sourceApp);
            case 'getInfoRequest':
                return this.onGetInfoRequest(requestMessage, sourceApp);
            case 'getAppMetadataRequest':
                return this.onGetAppMetadataRequest(requestMessage, sourceApp);
            case 'findIntentRequest':
                return this.onFindIntentRequest(requestMessage, sourceApp);
            case 'addEventListenerRequest':
                return this.onAddEventListenerRequest(requestMessage, sourceApp);
            case 'findIntentsByContextRequest':
                return this.onFindIntentsByContextRequest(requestMessage, sourceApp);
            case 'eventListenerUnsubscribeRequest':
                return this.onEventListenerUnsubscribeRequest(requestMessage, sourceApp);
            case 'intentListenerUnsubscribeRequest':
                return this.onIntentListenerUnsubscribeRequest(requestMessage, sourceApp);
            case 'openRequest':
                return this.onOpenRequest(requestMessage, sourceApp);
            case 'getUserChannelsRequest':
                return this.channelMessageHandler.onGetUserChannelsRequest(requestMessage, sourceApp);
            case 'getCurrentChannelRequest':
                return this.channelMessageHandler.onGetCurrentChannelRequest(requestMessage, sourceApp);
            case 'joinUserChannelRequest':
                return this.channelMessageHandler.onJoinUserChannelRequest(
                    requestMessage,
                    sourceApp,
                    this.eventListeners,
                );
            case 'leaveCurrentChannelRequest':
                return this.channelMessageHandler.onLeaveCurrentChannelRequest(
                    requestMessage,
                    sourceApp,
                    this.eventListeners,
                );
            case 'createPrivateChannelRequest':
                return this.channelMessageHandler.onCreatePrivateChannelRequest(requestMessage, sourceApp);
            case 'getOrCreateChannelRequest':
                return this.channelMessageHandler.onGetOrCreateChannelRequest(requestMessage, sourceApp);
            case 'addContextListenerRequest':
                return this.channelMessageHandler.onAddContextListenerRequest(requestMessage, sourceApp);
            case 'contextListenerUnsubscribeRequest':
                return this.channelMessageHandler.onContextListenerUnsubscribeRequest(requestMessage, sourceApp);
            case 'broadcastRequest':
                return this.channelMessageHandler.onBroadcastRequest(requestMessage, sourceApp);
            case 'getCurrentContextRequest':
                return this.channelMessageHandler.onGetCurrentContextRequest(requestMessage, sourceApp);
            case 'privateChannelAddEventListenerRequest':
                return this.channelMessageHandler.onPrivateChannelAddEventListenerRequest(requestMessage, sourceApp);
            case 'privateChannelUnsubscribeEventListenerRequest':
                return this.channelMessageHandler.onPrivateChannelUnsubscribeEventListenerRequest(
                    requestMessage,
                    sourceApp,
                );
            case 'privateChannelDisconnectRequest':
                return this.channelMessageHandler.onPrivateChannelDisconnectRequest(requestMessage, sourceApp);
            case 'heartbeatAcknowledgementRequest':
                return this.onHeartbeatAcknowledgementRequest(requestMessage, sourceApp);
        }
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onRaiseIntentRequest(
        requestMessage: BrowserTypes.RaiseIntentRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        //check if context argument is invalid
        if (requestMessage.payload.context != null && !isContext(requestMessage.payload.context)) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.RaiseIntentResponse>(
                    'raiseIntentResponse',
                    { error: ResolveError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't use invalid context
            return;
        }

        let resolveError: any;

        //selects app instance to resolve intent
        const appIdentifier = await this.directory
            .resolveAppInstanceForIntent(
                requestMessage.payload.intent,
                requestMessage.payload.context,
                requestMessage.payload.app,
            )
            .catch(err => {
                resolveError = err;
                return undefined;
            });

        const payload: BrowserTypes.RaiseIntentResponsePayload = {};

        if (appIdentifier != null) {
            //wait for intentListener of correct intent type on chosen app to be added
            await this.awaitIntentListener(appIdentifier, requestMessage.payload.intent);

            //publishes IntentEvent to chosen app to let it know it has been selected to resolve given intent
            this.publishIntentEvent(
                requestMessage,
                requestMessage.payload.intent,
                { appId: appIdentifier.appId, instanceId: appIdentifier.instanceId },
                source,
            );
            //any results from chosen app resolving intent are sent in a RaiseIntentResultResponse message once intent has been resolved
            payload.intentResolution = {
                source: appIdentifier,
                intent: requestMessage.payload.intent,
            };
        } else {
            const error = isFindInstancesErrors(resolveError) ? resolveError : ResolveError.NoAppsFound;

            //no app found to resolve intent
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.RaiseIntentResponse>(
                    'raiseIntentResponse',
                    { error },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.RaiseIntentResponse>(
                'raiseIntentResponse',
                payload,
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    private async awaitIntentListener(chosenApp: FullyQualifiedAppIdentifier, intent: string): Promise<void> {
        //check if intentListener of correct intent type on chosen app has already been added
        if (
            this.intentListeners[intent] == null ||
            !this.intentListeners[intent]?.some(pair => appInstanceEquals(pair.appIdentifier, chosenApp))
        ) {
            //wait for intentListener of correct intent type on chosen app to be added
            return new Promise<void>(resolve => {
                const callbackUUID = generateUUID();
                this.intentListenerCallbacks.set(callbackUUID, (app, listenerType) => {
                    if (appInstanceEquals(app, chosenApp) && (listenerType == null || listenerType === intent)) {
                        this.intentListenerCallbacks.delete(callbackUUID);
                        resolve();
                    }
                });
            });
        }
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onRaiseIntentForContext(
        requestMessage: BrowserTypes.RaiseIntentForContextRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        //check if context argument is invalid
        if (requestMessage.payload.context != null && !isContext(requestMessage.payload.context)) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.RaiseIntentForContextResponse>(
                    'raiseIntentForContextResponse',
                    { error: ResolveError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't use invalid context
            return;
        }

        try {
            //selects intent to handle context and app instance to resolve it
            const resolutionResponse = await this.directory.resolveAppInstanceForContext(
                requestMessage.payload.context,
                requestMessage.payload.app,
            );

            if (resolutionResponse == null) {
                //no apps were found to resolve intent
                this.rootMessagePublisher.publishResponseMessage(
                    createResponseMessage<BrowserTypes.RaiseIntentForContextResponse>(
                        'raiseIntentForContextResponse',
                        { error: ResolveError.NoAppsFound },
                        requestMessage.meta.requestUuid,
                        source,
                    ),
                    source,
                );

                return;
            }

            const appIdentifier = resolutionResponse.app;

            //wait for intentListener of correct intent type on chosen app to be added
            await this.awaitIntentListener(appIdentifier, resolutionResponse.intent);

            //publishes IntentEvent to chosen app to let it know it has been selected to resolve chosen intent
            this.publishIntentEvent(
                requestMessage,
                resolutionResponse.intent,
                { appId: appIdentifier.appId, instanceId: appIdentifier.instanceId },
                source,
            );

            //responds with chosen intent and appIdentifier of the app chosen to resolve it
            const payload = {
                intentResolution: {
                    intent: resolutionResponse.intent,
                    source: appIdentifier,
                },
            };

            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.RaiseIntentForContextResponse>(
                    'raiseIntentForContextResponse',
                    payload,
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //any results from chosen app resolving intent are sent in a RaiseIntentResultResponse message once intent has been resolved
        } catch (err) {
            const error: BrowserTypes.FindInstancesErrors = isFindInstancesErrors(err) ? err : 'IntentDeliveryFailed';

            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.RaiseIntentForContextResponse>(
                    'raiseIntentForContextResponse',
                    { error },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
        }
    }

    // https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#addintentlistener
    private async onIntentResultRequest(
        requestMessage: BrowserTypes.IntentResultRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.IntentResultResponse>(
                'intentResultResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );

        // We do not want to store the original app that raised the intent so we encode it in the raiseIntentRequestUuid
        // here we decode the string to to obtain the source app and the original raiseIntentRequestUuid to send back to the source app.
        const raiseIntentSource = decodeUUUrl<FullyQualifiedAppIdentifier>(
            requestMessage.payload.raiseIntentRequestUuid,
        );

        if (raiseIntentSource?.payload != null && isFullyQualifiedAppIdentifier(raiseIntentSource.payload)) {
            if (requestMessage.payload.intentResult.channel != null) {
                //if intentResult is PrivateChannel, add receiving app to channel's allowedList
                this.channelMessageHandler.addToPrivateChannelAllowedList(
                    requestMessage.payload.intentResult.channel.id,
                    raiseIntentSource.payload,
                );
            }

            const raiseIntentResultResponse = createResponseMessage<BrowserTypes.RaiseIntentResultResponse>(
                'raiseIntentResultResponse',
                { intentResult: requestMessage.payload.intentResult },
                raiseIntentSource.uuid,
                raiseIntentSource.payload,
            );

            this.rootMessagePublisher.publishResponseMessage(raiseIntentResultResponse, raiseIntentSource.payload);
        }
    }

    /**
     * Sends IntentEvent to app chosen to resolve intent with intent to be resolved and context to be handled
     * Intent is then resolved by chosen app and any result is sent to originating app in RaiseIntentResultResponse message
     */
    private publishIntentEvent(
        requestMessage: BrowserTypes.RaiseIntentRequest | BrowserTypes.RaiseIntentForContextRequest,
        intent: Intent,
        fullyQualifiedApp: FullyQualifiedAppIdentifier,
        originatingApp: FullyQualifiedAppIdentifier,
    ): void {
        // we encode the source app and the original request id in this field to extract them later
        // TODO: we should encrypt this information
        const raiseIntentRequestUuid = generateUUUrl<FullyQualifiedAppIdentifier>(
            originatingApp,
            requestMessage.meta.requestUuid,
        );

        this.rootMessagePublisher.publishEvent(
            createEvent<BrowserTypes.IntentEvent>('intentEvent', {
                intent,
                context: requestMessage.payload.context,
                raiseIntentRequestUuid,
                originatingApp,
            }),
            [fullyQualifiedApp],
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Registers an app as an intent listener and publishes an AddIntentListenerResponse message
     */
    private async onAddIntentListenerRequest(
        requestMessage: BrowserTypes.AddIntentListenerRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        const listeners =
            this.intentListeners[requestMessage.payload.intent] ??
            (this.intentListeners[requestMessage.payload.intent] = []);

        //fetch context info for app and intent from app directory
        const contexts = await this.directory.getContextForAppIntent(source, requestMessage.payload.intent);

        if (contexts == null) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.AddIntentListenerResponse>(
                    'addIntentListenerResponse',
                    { error: ResolveError.TargetInstanceUnavailable },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
            return;
        }

        try {
            //this should not occur as error should have been caught by directory.getContextForAppIntent
            await this.directory.registerIntentListener(source, requestMessage.payload.intent, contexts);
        } catch (error) {
            if (error === ResolveError.TargetInstanceUnavailable) {
                this.rootMessagePublisher.publishResponseMessage(
                    createResponseMessage<BrowserTypes.AddIntentListenerResponse>(
                        'addIntentListenerResponse',
                        { error },
                        requestMessage.meta.requestUuid,
                        source,
                    ),
                    source,
                );
            }
            return;
        }

        const listenerUUID = generateUUID();

        listeners.push({ appIdentifier: source, listenerUUID });

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.AddIntentListenerResponse>(
                'addIntentListenerResponse',
                { listenerUUID },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );

        for (const callback of this.intentListenerCallbacks.values()) {
            callback(source, requestMessage.payload.intent);
        }
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Returns array of AppIdentifiers for all available instances of the given app
     */
    private async onFindInstancesRequest(
        requestMessage: BrowserTypes.FindInstancesRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        const instances = await this.directory.getAppInstances(requestMessage.payload.app.appId);

        if (instances == null) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.FindInstancesResponse>(
                    'findInstancesResponse',
                    { error: ResolveError.NoAppsFound },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.FindInstancesResponse>(
                'findInstancesResponse',
                { appIdentifiers: instances },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onGetInfoRequest(
        requestMessage: BrowserTypes.GetInfoRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        try {
            const applicationMetadata = await this.directory.getAppMetadata(source);

            const implementationMetadata: ImplementationMetadata = getImplementationMetadata(
                source,
                applicationMetadata,
            );

            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.GetInfoResponse>(
                    'getInfoResponse',
                    { implementationMetadata },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
        } catch (error) {
            if (isResponsePayloadError(error)) {
                this.rootMessagePublisher.publishResponseMessage(
                    createResponseMessage<BrowserTypes.GetInfoResponse>(
                        'getInfoResponse',
                        { error },
                        requestMessage.meta.requestUuid,
                        source,
                    ),
                    source,
                );
            } else {
                //error is unexpected
                console.error(error);
            }
        }
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onGetAppMetadataRequest(
        requestMessage: BrowserTypes.GetAppMetadataRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        const appMetadata = await this.directory.getAppMetadata(requestMessage.payload.app);

        if (appMetadata == null) {
            //target app is not registered in App Directory
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.GetAppMetadataResponse>(
                    'getAppMetadataResponse',
                    { error: ResolveError.TargetAppUnavailable },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.GetAppMetadataResponse>(
                'getAppMetadataResponse',
                { appMetadata },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Return AppIntent containing details of apps which handle given intent
     */
    private async onFindIntentRequest(
        requestMessage: BrowserTypes.FindIntentRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        //check if context argument is invalid
        if (requestMessage.payload.context != null && !isContext(requestMessage.payload.context)) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.FindIntentResponse>(
                    'findIntentResponse',
                    { error: ResolveError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't use invalid context
            return;
        }

        const appIntent = await this.directory.getAppIntent(
            requestMessage.payload.intent,
            requestMessage.payload.context,
            requestMessage.payload.resultType,
        );

        if (appIntent.apps.length === 0) {
            //respond with NoAppsFound error message if no registered apps or app instances can resolve given intent
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.FindIntentResponse>(
                    'findIntentResponse',
                    { error: ResolveError.NoAppsFound },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.FindIntentResponse>(
                'findIntentResponse',
                { appIntent },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Add an event listener for a given event and app, and respond with the listenerUUID
     */
    private onAddEventListenerRequest(
        requestMessage: BrowserTypes.AddEventListenerRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        const eventType = convertToEventListenerIndex(requestMessage.payload.type);
        const listeners = this.eventListeners[eventType] ?? (this.eventListeners[eventType] = []);

        const listenerUUID = generateUUID();

        listeners.push({ appIdentifier: source, listenerUUID });

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.AddEventListenerResponse>(
                'addEventListenerResponse',
                { listenerUUID },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Remove event listener which source app has unsubscribed from
     */
    private onEventListenerUnsubscribeRequest(
        requestMessage: BrowserTypes.EventListenerUnsubscribeRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        const eventType = Object.entries(this.eventListeners).find(([_, listenerPairs]) =>
            listenerPairs.some(pair => pair.listenerUUID === requestMessage.payload.listenerUUID),
        )?.[0] as EventListenerKey | undefined;

        if (eventType != null) {
            const listeners = this.eventListeners[eventType];
            const newListeners = listeners?.filter(pair => pair.listenerUUID != requestMessage.payload.listenerUUID);
            this.eventListeners[eventType] = newListeners;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.EventListenerUnsubscribeResponse>(
                'eventListenerUnsubscribeResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    /**
     * Remove intent listener which source app has unsubscribed from
     */
    private onIntentListenerUnsubscribeRequest(
        requestMessage: BrowserTypes.IntentListenerUnsubscribeRequest,
        source: FullyQualifiedAppIdentifier,
    ): void {
        const intent = Object.entries(this.intentListeners).find(([_, listenerPairs]) =>
            listenerPairs?.some(pair => pair.listenerUUID === requestMessage.payload.listenerUUID),
        )?.[0];

        if (intent != null) {
            const listeners = this.intentListeners[intent];
            const newListeners = listeners?.filter(pair => pair.listenerUUID != requestMessage.payload.listenerUUID);
            this.intentListeners[intent] = newListeners;
        }

        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.IntentListenerUnsubscribeResponse>(
                'intentListenerUnsubscribeResponse',
                {},
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onFindIntentsByContextRequest(
        requestMessage: BrowserTypes.FindIntentsByContextRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        //check if context argument is invalid
        if (requestMessage.payload.context != null && !isContext(requestMessage.payload.context)) {
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.FindIntentsByContextResponse>(
                    'findIntentsByContextResponse',
                    { error: ResolveError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't use invalid context
            return;
        }

        const appIntents = await this.directory.getAppIntentsForContext(requestMessage.payload.context);

        if (appIntents.length === 0 || appIntents.find(appIntent => appIntent.apps.length != 0) == null) {
            //responds with error if no intents to handle given context were found, or if no apps which resolve those intents and handle given context were found
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.FindIntentsByContextResponse>(
                    'findIntentsByContextResponse',
                    { error: ResolveError.NoAppsFound },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            return;
        }

        //respond with appIntents found for intents that can handle given context
        this.rootMessagePublisher.publishResponseMessage(
            createResponseMessage<BrowserTypes.FindIntentsByContextResponse>(
                'findIntentsByContextResponse',
                { appIntents },
                requestMessage.meta.requestUuid,
                source,
            ),
            source,
        );
    }

    //https://fdc3.finos.org/docs/api/specs/desktopAgentCommunicationProtocol#desktopagent
    private async onOpenRequest(
        requestMessage: BrowserTypes.OpenRequest,
        source: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        log('OpenRequest', 'debug', { requestMessage, source });
        //check if context argument is invalid
        if (requestMessage.payload.context != null && !isContext(requestMessage.payload.context)) {
            log('OpenRequest', 'error', 'MalformedContext', source);
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.OpenResponse>(
                    'openResponse',
                    { error: ResolveError.MalformedContext },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );

            //don't use invalid context
            return;
        }

        const application = await this.directory.getAppDirectoryApplication(requestMessage.payload.app.appId);

        if (application == null) {
            log('OpenRequest', 'error', 'AppNotFound', source);
            //app cannot be found in app directory
            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.OpenResponse>(
                    'openResponse',
                    { error: OpenError.AppNotFound },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
            return;
        }
        log('OpenRequest application resolved', 'debug', { application, source });

        const validStrategies: IOpenApplicationStrategy[] = await Promise.all(
            this.openStrategies.filter(async strategy => await this.canStrategyOpenApp(application, strategy)),
        );

        if (validStrategies.length > 0) {
            const strategy = validStrategies[0];

            const { hostManifests, ...noManifests } = application;

            //TODO: allow 15 seconds by default for application to open
            try {
                log('OpenRequest opening application', 'debug', { application, source, strategy });

                const newAppConnectionAttemptUuid = await strategy.open({
                    appDirectoryRecord: noManifests,
                    agent: this,
                    manifest: await getHostManifest(application.hostManifests, strategy.manifestKey).catch(err =>
                        console.error(err),
                    ),
                });

                log('OpenRequest application opened', 'debug', { application, source, newAppConnectionAttemptUuid });

                const appIdentifier = await this.rootMessagePublisher.awaitAppIdentity(
                    newAppConnectionAttemptUuid,
                    application,
                );

                log('OpenRequest appIdentifier resolved', 'debug', { appIdentifier, source });

                this.rootMessagePublisher.publishResponseMessage(
                    createResponseMessage<BrowserTypes.OpenResponse>(
                        'openResponse',
                        { appIdentifier },
                        requestMessage.meta.requestUuid,
                        source,
                    ),
                    source,
                );

                //pass given context object to opened application via contextListener
                await this.passContextToOpenedApp(requestMessage, source, appIdentifier);
            } catch (err) {
                log('OpenRequest error opening application', 'error', { application, source, err });
                this.rootMessagePublisher.publishResponseMessage(
                    createResponseMessage<BrowserTypes.OpenResponse>(
                        'openResponse',
                        { error: isOpenError(err) ? err : OpenError.ErrorOnLaunch },
                        requestMessage.meta.requestUuid,
                        source,
                    ),
                    source,
                );
            }
        } else {
            log('OpenRequest no opening strategies found', 'error', { source });

            this.rootMessagePublisher.publishResponseMessage(
                createResponseMessage<BrowserTypes.OpenResponse>(
                    'openResponse',
                    { error: OpenError.ErrorOnLaunch },
                    requestMessage.meta.requestUuid,
                    source,
                ),
                source,
            );
        }
    }

    /**
     * Returns strategy if given strategy can open given application. Rejects Promise otherwise
     */
    private async canStrategyOpenApp(
        application: AppDirectoryApplication,
        strategy: IOpenApplicationStrategy,
    ): Promise<boolean> {
        const manifest = await getHostManifest(application.hostManifests, strategy.manifestKey).catch(err =>
            console.error(err),
        );

        const { hostManifests, ...appDirectoryRecord } = application;

        const canOpen = await strategy.canOpen({ agent: this, appDirectoryRecord, manifest });

        if (canOpen) {
            return true;
        }
        return false;
    }

    private async passContextToOpenedApp(
        requestMessage: BrowserTypes.OpenRequest,
        source: FullyQualifiedAppIdentifier,
        openedApp: FullyQualifiedAppIdentifier,
    ): Promise<void> {
        //TODO: allow 15 seconds by default for application to add necessary contextListeners
        if (requestMessage.payload.context != null) {
            const context = requestMessage.payload.context;
            //await callback listening for creation of contextListener to know when app has added contextListener of correct context type
            await new Promise<void>(resolve => {
                const callbackUUID = generateUUID();
                this.channelMessageHandler.addListenerCallback(callbackUUID, (app, listenerType) => {
                    if (appInstanceEquals(app, openedApp) && (listenerType == null || listenerType === context.type)) {
                        this.channelMessageHandler.removeListenerCallback(callbackUUID);
                        resolve();
                    }
                });
            });
            //publish broadcastEvent with provided context to opened app
            this.publishOpenAppContextBroadcast(context, source, openedApp);
        }
    }

    private publishOpenAppContextBroadcast(
        context: BrowserTypes.Context,
        source: FullyQualifiedAppIdentifier,
        fullyQualifiedAppIdentifier: FullyQualifiedAppIdentifier,
    ): void {
        this.rootMessagePublisher.publishEvent(
            createEvent<BrowserTypes.BroadcastEvent>('broadcastEvent', {
                channelId: null,
                context,
                originatingApp: source,
            }),
            [fullyQualifiedAppIdentifier],
        );
    }

    /**
     * Handle heartbeat acknowledgment from a proxy agent
     * @param requestMessage The heartbeat acknowledgment request
     * @param sourceApp The proxy agent that sent the acknowledgment
     */
    private onHeartbeatAcknowledgementRequest(
        _requestMessage: BrowserTypes.HeartbeatAcknowledgementRequest,
        sourceApp: FullyQualifiedAppIdentifier,
    ): void {
        // Reset retry count when we receive an acknowledgment
        this.heartbeatRetries.set(sourceApp, 0);

        // Clear the timeout timer
        const timeoutTimer = this.heartbeatTimeouts.get(sourceApp);
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            this.heartbeatTimeouts.delete(sourceApp);
        }
    }

    /**
     * Start heartbeat monitoring for a proxy
     * @param appId The app ID of the proxy to monitor
     */
    private startHeartbeat(appId: FullyQualifiedAppIdentifier): void {
        // Ignore if the app ID is the same as the current app instance
        // This prevents the heartbeat from being sent to itself
        if (appInstanceEquals(appId, this.appIdentifier)) {
            return;
        }

        if (this.heartbeatTimers.has(appId)) {
            return; // Already monitoring this proxy
        }

        this.connectedProxies.add(appId);
        this.heartbeatRetries.set(appId, 0);

        const timer = setInterval(() => {
            void this.sendHeartbeat(appId);
        }, HEARTBEAT.INTERVAL_MS);

        this.heartbeatTimers.set(appId, timer);

        log('Starting keep-alive for proxy', 'info', appId);

        // Send initial appId
        void this.sendHeartbeat(appId);
    }

    /**
     * Send a heartbeat to a proxy and wait for acknowledgment
     * @param appId The app ID of the proxy to send heartbeat to
     */
    private async sendHeartbeat(appId: FullyQualifiedAppIdentifier): Promise<void> {
        const retries = this.heartbeatRetries.get(appId) ?? 0;

        if (retries >= HEARTBEAT.MAX_TRIES) {
            this.handleProxyDisconnect(appId);
            return;
        }

        try {
            // Create a heartbeat event with proper structure
            const heartbeatEvent = createEvent<BrowserTypes.HeartbeatEvent>('heartbeatEvent', {});

            await this.rootMessagePublisher.publishEvent(heartbeatEvent, [appId]);

            // Clear any existing timeout
            const existingTimeout = this.heartbeatTimeouts.get(appId);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
            }

            // Set new timeout for acknowledgment
            const timeout = setTimeout(() => {
                const currentRetries = this.heartbeatRetries.get(appId) ?? 0;
                this.heartbeatRetries.set(appId, currentRetries + 1);
                log(
                    `Heartbeat acknowledgment timeout for proxy. Attempt ${currentRetries + 1}/${HEARTBEAT.MAX_TRIES}`,
                    'warn',
                    appId,
                );
            }, HEARTBEAT.TIMEOUT_MS);

            this.heartbeatTimeouts.set(appId, timeout);
        } catch (error) {
            log(`Failed to send heartbeat to proxy ${JSON.stringify(appId)}`);
            this.handleProxyDisconnect(appId);
        }
    }

    /**
     * Handles cleanup when a proxy disconnects, including timers, listeners, and channel subscriptions.
     * @param appId The app ID of the disconnected proxy
     */
    private handleProxyDisconnect(appId: FullyQualifiedAppIdentifier): void {
        log(`Proxy ${JSON.stringify(appId)} disconnected`);

        // Clear timers
        this.clearHeartbeatTimers(appId);

        // Clean up intent listeners
        this.cleanupIntentListeners(appId);

        // Clean up event listeners
        this.cleanupEventListeners(appId);

        // Clean up intent listener callbacks
        this.cleanupIntentListenerCallbacks(appId);

        // Clean up channel subscriptions
        this.channelMessageHandler.cleanupDisconnectedProxy(appId);
    }

    /**
     * Clears heartbeat and timeout timers for a given proxy app.
     * @param appId The app ID of the proxy
     */
    private clearHeartbeatTimers(appId: FullyQualifiedAppIdentifier): void {
        const heartbeatTimer = this.heartbeatTimers.get(appId);
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }

        const timeoutTimer = this.heartbeatTimeouts.get(appId);
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
        }

        this.heartbeatTimers.delete(appId);
        this.heartbeatRetries.delete(appId);
        this.heartbeatTimeouts.delete(appId);
        this.connectedProxies.delete(appId);
    }

    /**
     * Removes all intent listeners associated with a given proxy app.
     * @param appId The app ID of the proxy
     */
    private cleanupIntentListeners(appId: FullyQualifiedAppIdentifier): void {
        for (const [intent, listeners] of Object.entries(this.intentListeners)) {
            const remainingListeners = listeners?.filter(listener => !appInstanceEquals(listener.appIdentifier, appId));
            if (remainingListeners?.length) {
                this.intentListeners[intent as Intent] = remainingListeners;
            } else {
                delete this.intentListeners[intent as Intent];
            }
        }
    }

    /**
     * Removes all event listeners associated with a given proxy app.
     * @param appId The app ID of the proxy
     */
    private cleanupEventListeners(appId: FullyQualifiedAppIdentifier): void {
        for (const [eventType, listeners] of Object.entries(this.eventListeners)) {
            const remainingListeners = listeners.filter(listener => !appInstanceEquals(listener.appIdentifier, appId));
            if (remainingListeners.length) {
                this.eventListeners[eventType as EventListenerKey] = remainingListeners;
            } else {
                delete this.eventListeners[eventType as EventListenerKey];
            }
        }
    }

    /**
     * Removes all intent listener callbacks associated with a given proxy app.
     * @param appId The app ID of the proxy
     */
    private cleanupIntentListenerCallbacks(appId: FullyQualifiedAppIdentifier): void {
        const callbacksToRemove: string[] = [];
        for (const [key, _] of this.intentListenerCallbacks) {
            const decoded = decodeUUUrl(key);
            if (decoded && decoded.uuid && appInstanceEquals(decoded.payload as FullyQualifiedAppIdentifier, appId)) {
                callbacksToRemove.push(key);
            }
        }
        for (const key of callbacksToRemove) {
            this.intentListenerCallbacks.delete(key);
        }
    }
}
