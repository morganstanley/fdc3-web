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
    AppIdentifier,
    AppIntent,
    AppMetadata,
    BrowserTypes,
    Channel,
    Context,
    ContextHandler,
    ContextType,
    DesktopAgent,
    DesktopAgentDetails,
    EventHandler,
    FDC3EventTypes,
    ImplementationMetadata,
    Intent,
    IntentHandler,
    IntentResolution,
    IntentResult,
    Listener,
    PrivateChannel,
} from '@finos/fdc3';
import { ChannelFactory, Channels } from '../channel';
import { FullyQualifiedAppIdentifier, IProxyMessagingProvider } from '../contracts';
import {
    createRequestMessage,
    isAddEventListenerResponse,
    isAddIntentListenerResponse,
    isAppEventMessage,
    isChannel,
    isContext,
    isEventListenerUnsubscribeResponse,
    isFindInstancesResponse,
    isFindIntentResponse,
    isFindIntentsByContextResponse,
    isGetAppMetadataResponse,
    isGetInfoResponse,
    isHeartbeatEvent,
    isIntentEvent,
    isIntentListenerUnsubscribeResponse,
    isIntentResultResponse,
    isOpenResponse,
    isRaiseIntentForContextResponse,
    isRaiseIntentResponse,
    isRaiseIntentResultResponse,
    resolveAppIdentifier,
    resolveContextType,
} from '../helpers';
import { convertToFDC3EventTypes } from '../helpers/event-type.helper';
import { MessagingBase } from '../messaging';

type ProxyDesktopAgentParams = {
    appIdentifier: FullyQualifiedAppIdentifier;
    messagingProvider: IProxyMessagingProvider;
    channelFactory: ChannelFactory;
};

export class DesktopAgentProxy extends MessagingBase implements DesktopAgent {
    private channels: Channels;
    private channelFactory: ChannelFactory;

    constructor(params: ProxyDesktopAgentParams) {
        super(params.appIdentifier, params.messagingProvider);

        this.channelFactory = params.channelFactory;
        this.channels = this.channelFactory.createChannels(params.appIdentifier, this.messagingProvider);

        // Set up heartbeat acknowledgment
        this.addMessageCallback('heartbeat', message => {
            if (isHeartbeatEvent(message)) {
                this.acknowledgeHeartbeat(message);
            }
        });
    }

    public async addEventListener(type: FDC3EventTypes | null, handler: EventHandler): Promise<Listener> {
        const message = createRequestMessage<BrowserTypes.AddEventListenerRequest>(
            'addEventListenerRequest',
            this.appIdentifier,
            { type: type === 'userChannelChanged' ? 'USER_CHANNEL_CHANGED' : type },
        );

        const response = await this.getResponse(message, isAddEventListenerResponse);

        const listenerUUID = response.payload.listenerUUID;
        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (listenerUUID == null) {
            //this should not happen - there should be no situation where both listenerUUID and error are undefined in response payload
            return Promise.reject('listenerUUID is null');
        }

        this.addMessageCallback(listenerUUID, message => {
            //convert between EventMessageType and FDC3EventTypes
            if (isAppEventMessage(message)) {
                const eventType = convertToFDC3EventTypes(message.type);
                if (eventType != null && (eventType === type || type == null)) {
                    handler({ type: eventType, details: message.payload });
                }
            }
        });

        const unsubscribe: () => Promise<void> = async () => {
            const eventListenerUnsubscribeRequest = createRequestMessage<BrowserTypes.EventListenerUnsubscribeRequest>(
                'eventListenerUnsubscribeRequest',
                this.appIdentifier,
                { listenerUUID },
            );

            await this.getResponse(eventListenerUnsubscribeRequest, isEventListenerUnsubscribeResponse);

            this.removeMessageCallback(listenerUUID);
        };
        return { unsubscribe };
    }

    public async validateAppIdentity?({
        appId: _appId,
        appDUrl: _appDUrl,
        instanceUuid: _instanceUuid,
    }: {
        appId?: string | undefined;
        appDUrl?: string | undefined;
        instanceUuid?: string | undefined;
    }): Promise<DesktopAgentDetails> {
        throw new Error('Method not implemented.');
    }

    public open(app: AppIdentifier, context?: Context): Promise<AppIdentifier>;
    public open(name: string, context?: Context): Promise<AppIdentifier>;
    public async open(app: AppIdentifier | string, context?: Context): Promise<AppIdentifier> {
        const appIdentifier = resolveAppIdentifier(app);
        const message = createRequestMessage<BrowserTypes.OpenRequest>('openRequest', this.appIdentifier, {
            app: appIdentifier,
            context,
        });

        const response = await this.getResponse(message, isOpenResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.appIdentifier == null) {
            //this should not happen - there should be no situation where both appIdentifier and error are undefined in response payload
            return Promise.reject('appIdentifier is null');
        }
        return response.payload.appIdentifier;
    }

    public async findIntent(
        intent: Intent,
        context?: Context | undefined,
        resultType?: string | undefined,
    ): Promise<AppIntent> {
        const message = createRequestMessage<BrowserTypes.FindIntentRequest>('findIntentRequest', this.appIdentifier, {
            intent: intent,
            context: context,
            resultType: resultType,
        });

        const response = await this.getResponse(message, isFindIntentResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.appIntent == null) {
            //this should not happen - there should be no situation where both appIntent and error are undefined in response payload
            return Promise.reject('appIntent is null');
        }

        return mapMessageIntent(response.payload.appIntent);
    }

    public async findIntentsByContext(context: Context, resultType?: string | undefined): Promise<AppIntent[]> {
        const message = createRequestMessage<BrowserTypes.FindIntentsByContextRequest>(
            'findIntentsByContextRequest',
            this.appIdentifier,
            { context: context, resultType: resultType },
        );

        const response = await this.getResponse(message, isFindIntentsByContextResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.appIntents == null) {
            //this should not happen - there should be no situation where both appIntents and error are undefined in response payload
            return Promise.reject('appIntents is null');
        }
        return response.payload.appIntents.map(appIntent => mapMessageIntent(appIntent));
    }

    public async findInstances(app: AppIdentifier): Promise<AppIdentifier[]> {
        const message = createRequestMessage<BrowserTypes.FindInstancesRequest>(
            'findInstancesRequest',
            this.appIdentifier,
            { app },
        );

        const response = await this.getResponse(message, isFindInstancesResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.appIdentifiers == null) {
            //this should not happen - there should be no situation where both appIdentifiers and error are undefined in response payload
            return Promise.reject('appIdentifiers is null');
        }
        return response.payload.appIdentifiers;
    }

    public raiseIntent(intent: Intent, context: Context, appIdentifier?: AppIdentifier): Promise<IntentResolution>;
    public raiseIntent(intent: Intent, context: Context, name: string): Promise<IntentResolution>;
    public async raiseIntent(
        intent: Intent,
        context: Context,
        app?: AppIdentifier | string,
    ): Promise<IntentResolution> {
        const appIdentifier = typeof app === 'undefined' ? app : resolveAppIdentifier(app);
        const message = createRequestMessage<BrowserTypes.RaiseIntentRequest>(
            'raiseIntentRequest',
            this.appIdentifier,
            { app: appIdentifier, context: context, intent: intent },
        );

        const response = await this.getResponse(message, isRaiseIntentResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.intentResolution == null) {
            return Promise.reject('intentResolution is null');
        }

        return this.createIntentResolution(response.meta.requestUuid, response.payload.intentResolution);
    }

    public raiseIntentForContext(context: Context, app?: AppIdentifier): Promise<IntentResolution>;
    public raiseIntentForContext(context: Context, name: string): Promise<IntentResolution>;
    public async raiseIntentForContext(context: Context, app?: AppIdentifier | string): Promise<IntentResolution> {
        const appIdentifier = resolveAppIdentifier(app);
        const message = createRequestMessage<BrowserTypes.RaiseIntentForContextRequest>(
            'raiseIntentForContextRequest',
            this.appIdentifier,
            { app: appIdentifier, context: context },
        );

        const response = await this.getResponse(message, isRaiseIntentForContextResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.intentResolution == null) {
            //this should not happen - there should be no situation where both intentResolution and error are undefined in response payload
            return Promise.reject('intentResolution is null');
        }

        return this.createIntentResolution(response.meta.requestUuid, response.payload.intentResolution);
    }

    public async addIntentListener(intent: Intent, handler: IntentHandler): Promise<Listener> {
        const requestMessage = createRequestMessage<BrowserTypes.AddIntentListenerRequest>(
            'addIntentListenerRequest',
            this.appIdentifier,
            { intent },
        );

        const response = await this.getResponse(requestMessage, isAddIntentListenerResponse);

        const listenerUUID = response.payload.listenerUUID;
        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (listenerUUID == null) {
            //this should not happen - there should be no situation where both listenerUUID and error are undefined in response payload
            return Promise.reject('listenerUUID is null');
        }

        this.addMessageCallback(listenerUUID, async message => {
            if (isIntentEvent(message) && message.payload.intent === intent) {
                const intentResultPromise = handler(
                    message.payload.context,
                    message.payload.originatingApp != null ? { source: message.payload.originatingApp } : undefined,
                );

                const handlerResult = await intentResultPromise;

                await this.publishIntentResultRequest(handlerResult, message);
            }
        });

        const unsubscribe: () => Promise<void> = async () => {
            const intentListenerUnsubscribeRequest =
                createRequestMessage<BrowserTypes.IntentListenerUnsubscribeRequest>(
                    'intentListenerUnsubscribeRequest',
                    this.appIdentifier,
                    { listenerUUID },
                );

            await this.getResponse(intentListenerUnsubscribeRequest, isIntentListenerUnsubscribeResponse);

            this.removeMessageCallback(listenerUUID);
        };
        return { unsubscribe };
    }

    private async publishIntentResultRequest(
        handlerResult: IntentResult,
        intentEvent: BrowserTypes.IntentEvent,
    ): Promise<void> {
        const intentResult: BrowserTypes.IntentResult = {};

        if (isContext(handlerResult)) {
            intentResult.context = handlerResult;
        } else if (isChannel(handlerResult)) {
            //need to explicitly convert channel fields to avoid DataCloneError
            intentResult.channel = {
                id: handlerResult.id,
                type: handlerResult.type,
                displayMetadata: handlerResult.displayMetadata,
            };
        }

        const requestMessage = createRequestMessage<BrowserTypes.IntentResultRequest>(
            'intentResultRequest',
            this.appIdentifier,
            {
                intentResult,
                intentEventUuid: intentEvent.meta.eventUuid,
                raiseIntentRequestUuid: intentEvent.payload.raiseIntentRequestUuid,
            },
        );

        const response = await this.getResponse(requestMessage, isIntentResultResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        }
    }

    public broadcast(context: Context): Promise<void> {
        return this.channels.broadcast(context);
    }

    public addContextListener(contextType: ContextType | null, handler: ContextHandler): Promise<Listener>;
    public addContextListener(handler: ContextHandler): Promise<Listener>;
    public addContextListener(
        handlerOrContextType: ContextHandler | null | ContextType,
        optionalContextHandler?: ContextHandler,
    ): Promise<Listener> {
        const { contextType, contextHandler } = resolveContextType(handlerOrContextType, optionalContextHandler);

        return this.channels.addContextListener(contextType, contextHandler);
    }

    public getUserChannels(): Promise<Channel[]> {
        return this.channels.getUserChannels();
    }

    //OPTIONAL
    public joinUserChannel(channelId: string): Promise<void> {
        return this.channels.joinUserChannel(channelId);
    }

    public getOrCreateChannel(channelId: string): Promise<Channel> {
        return this.channels.getOrCreateChannel(channelId);
    }

    public createPrivateChannel(): Promise<PrivateChannel> {
        return this.channels.createPrivateChannel();
    }

    //OPTIONAL
    public getCurrentChannel(): Promise<Channel | null> {
        return this.channels.getCurrentChannel();
    }

    //OPTIONAL
    public leaveCurrentChannel(): Promise<void> {
        return this.channels.leaveCurrentChannel();
    }

    public async getInfo(): Promise<ImplementationMetadata> {
        const message = createRequestMessage<BrowserTypes.GetInfoRequest>('getInfoRequest', this.appIdentifier, {});

        const response = await this.getResponse(message, isGetInfoResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.implementationMetadata == null) {
            //this should not happen - there should be no situation where both implementationMetadata and error are undefined in response payload
            return Promise.reject('implementationMetadata is null');
        }
        return response.payload.implementationMetadata;
    }

    public async getAppMetadata(app: AppIdentifier): Promise<AppMetadata> {
        const message = createRequestMessage<BrowserTypes.GetAppMetadataRequest>(
            'getAppMetadataRequest',
            this.appIdentifier,
            { app },
        );

        const response = await this.getResponse(message, isGetAppMetadataResponse);

        if (response.payload.error != null) {
            return Promise.reject(response.payload.error);
        } else if (response.payload.appMetadata == null) {
            //this should not happen - there should be no situation where both appMetadata and error are undefined in response payload
            return Promise.reject('appMetadata is null');
        }
        return response.payload.appMetadata;
    }

    //DEPRECATED
    public getSystemChannels(): Promise<Channel[]> {
        return this.getUserChannels();
    }

    //DEPRECATED
    public joinChannel(channelId: string): Promise<void> {
        return this.joinUserChannel(channelId);
    }

    private createIntentResolution(
        requestUuid: string,
        intentResolution: BrowserTypes.IntentResolution,
    ): IntentResolution {
        const raiseIntentResultResponsePromise = this.awaitRequestUuid(isRaiseIntentResultResponse, requestUuid);

        return {
            ...intentResolution,
            getResult: async (): Promise<any> => {
                const raiseIntentResultResponse = await raiseIntentResultResponsePromise;

                switch (raiseIntentResultResponse.payload.intentResult?.channel?.type) {
                    case 'user':
                    case 'app':
                        return this.channelFactory.createPublicChannel(
                            raiseIntentResultResponse.payload.intentResult.channel,
                            this.appIdentifier,
                            this.messagingProvider,
                        );
                    case 'private':
                        return this.channelFactory.createPrivateChannel(
                            raiseIntentResultResponse.payload.intentResult.channel,
                            this.appIdentifier,
                            this.messagingProvider,
                        );
                    default:
                        return raiseIntentResultResponse.payload.intentResult?.context;
                }
            },
        };
    }

    private async acknowledgeHeartbeat(heartbeat: BrowserTypes.HeartbeatEvent): Promise<void> {
        const ackMessage = createRequestMessage<BrowserTypes.HeartbeatAcknowledgementRequest>(
            'heartbeatAcknowledgementRequest',
            this.appIdentifier,
            { heartbeatEventUuid: heartbeat.meta.eventUuid },
        );

        await this.publishRequestMessage(ackMessage);
    }
}

/**
 * Converts displayName property from string | undefined to string
 * @param appIntent is AppIntent returned in response message, defined in BrowserTypes
 * @returns AppIntent object of type defined in FDC3 spec
 */
function mapMessageIntent(appIntent: BrowserTypes.AppIntent): AppIntent {
    return {
        ...appIntent,
        intent: { ...appIntent.intent, displayName: appIntent.intent.displayName ?? appIntent.intent.name },
    };
}
