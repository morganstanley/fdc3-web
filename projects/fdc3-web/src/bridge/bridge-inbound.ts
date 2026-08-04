/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AppIdentifier, AppIntent, BridgingTypes, GetAgentLogLevels, LogLevel } from '@finos/fdc3';
import { DesktopAgentImpl } from '../agent/desktop-agent.js';
import { RemoteAppIdentifier } from '../contracts.internal.js';
import { IBridgeTransport, Subscription } from '../contracts.js';
import { createLogger, isBridgeRequestMessage, isContext, LoggerFunction } from '../helpers/index.js';
import { toFindInstancesError, toOpenError } from './bridge-error.helper.js';
import { createBridgeAgentErrorResponse, createBridgeAgentResponse } from './bridge-message.factory.js';

export type BridgeInboundRouterParams = {
    transport: IBridgeTransport;
    /**
     * The concrete root agent, not a facade - bridge/ is the one module allowed to depend on it
     * directly, which avoids inventing a duplicate interface for members that already exist as
     * public API (directory.getLocal*, agent.open, agent.raiseIntentFromRemote,
     * channelMessageHandler.applyRemote*).
     */
    agent: DesktopAgentImpl;
    logLevels?: GetAgentLogLevels;
};

function toLocalAppIdentifier(app: { appId: string; instanceId?: string }): AppIdentifier {
    return { appId: app.appId, instanceId: app.instanceId };
}

/**
 * Routes the 13 inbound BridgeRequest message types (forwarded from other Desktop Agents via the
 * Bridge) to the local agent, and sends back a response/error-response for the 6 request/response
 * families. The 7 fire-and-forget families (broadcast + 6 PrivateChannel.*) have no response type
 * at all and are simply applied locally.
 */
export class BridgeInboundRouter {
    private readonly log: LoggerFunction;
    private readonly subscription: Subscription;

    constructor(private readonly params: BridgeInboundRouterParams) {
        this.log = createLogger(BridgeInboundRouter, 'proxy', params.logLevels);
        this.subscription = params.transport.subscribe(message => void this.onMessage(message));
    }

    public close(): void {
        this.subscription.unsubscribe();
    }

    /**
     * Every AppMetadata/AppIdentifier this agent hands back over the bridge must be stamped with its
     * own agent name - a purely local lookup (directory.getLocal*) has no reason to set it, but
     * without it the requesting agent has no way to tell these apps apart from its own local ones
     * (see AppDirectory.remoteAppSource / isRemoteAppIdentifier), and would resolve intents and
     * instances against them as if they were local.
     */
    private get ownAgentName(): string | undefined {
        return this.params.agent.directory.remoteAppSource?.agentName;
    }

    private stampAppMetadata<T extends AppIdentifier>(metadata: T): T {
        return { ...metadata, desktopAgent: this.ownAgentName };
    }

    private stampAppIntent(appIntent: AppIntent): AppIntent {
        return { ...appIntent, apps: appIntent.apps.map(app => this.stampAppMetadata(app)) };
    }

    private async onMessage(message: unknown): Promise<void> {
        if (!isBridgeRequestMessage(message)) {
            return;
        }

        // required by the schema on every inbound request - the app or agent hosted by another agent
        const source = message.meta.source as RemoteAppIdentifier;

        switch (message.type) {
            case 'findIntentRequest':
                return this.handleFindIntent(message as BridgingTypes.FindIntentBridgeRequest);
            case 'findIntentsByContextRequest':
                return this.handleFindIntentsByContext(message as BridgingTypes.FindIntentsByContextBridgeRequest);
            case 'findInstancesRequest':
                return this.handleFindInstances(message as BridgingTypes.FindInstancesBridgeRequest);
            case 'getAppMetadataRequest':
                return this.handleGetAppMetadata(message as BridgingTypes.GetAppMetadataBridgeRequest);
            case 'openRequest':
                return this.handleOpen(message as BridgingTypes.OpenBridgeRequest);
            case 'raiseIntentRequest':
                return this.handleRaiseIntent(message as BridgingTypes.RaiseIntentBridgeRequest, source);
            case 'broadcastRequest': {
                const payload = (message as BridgingTypes.BroadcastBridgeRequest).payload;
                if (isContext(payload.context)) {
                    this.params.agent.channelMessageHandler.applyRemoteBroadcast(
                        payload.channelId,
                        payload.context,
                        source,
                    );
                }
                return;
            }
            case 'PrivateChannel.broadcast': {
                const payload = (message as BridgingTypes.PrivateChannelBroadcastBridgeRequest).payload;
                if (isContext(payload.context)) {
                    this.params.agent.channelMessageHandler.applyRemoteBroadcast(
                        payload.channelId,
                        payload.context,
                        source,
                    );
                }
                return;
            }
            case 'PrivateChannel.onAddContextListener': {
                const payload = (message as BridgingTypes.PrivateChannelOnAddContextListenerBridgeRequest).payload;
                this.params.agent.channelMessageHandler.applyRemotePrivateChannelOnAddContextListener(
                    payload.channelId,
                    payload.contextType,
                );
                return;
            }
            case 'PrivateChannel.onUnsubscribe': {
                const payload = (message as BridgingTypes.PrivateChannelOnUnsubscribeBridgeRequest).payload;
                this.params.agent.channelMessageHandler.applyRemotePrivateChannelOnUnsubscribe(
                    payload.channelId,
                    payload.contextType,
                );
                return;
            }
            case 'PrivateChannel.onDisconnect': {
                const payload = (message as BridgingTypes.PrivateChannelOnDisconnectBridgeRequest).payload;
                this.params.agent.channelMessageHandler.applyRemotePrivateChannelOnDisconnect(payload.channelId);
                return;
            }
            case 'PrivateChannel.eventListenerAdded': {
                const payload = (message as BridgingTypes.PrivateChannelEventListenerAddedBridgeRequest).payload;
                this.params.agent.channelMessageHandler.applyRemotePrivateChannelEventListenerAdded(
                    payload.channelId,
                    source.desktopAgent,
                );
                return;
            }
            case 'PrivateChannel.eventListenerRemoved': {
                const payload = (message as BridgingTypes.PrivateChannelEventListenerRemovedBridgeRequest).payload;
                this.params.agent.channelMessageHandler.applyRemotePrivateChannelEventListenerRemoved(
                    payload.channelId,
                    source.desktopAgent,
                );
                return;
            }
            default:
                this.log(`Unhandled bridge request type: ${(message as { type: string }).type}`, LogLevel.WARN);
        }
    }

    private sendResponse(
        type: BridgingTypes.ResponseMessageType,
        requestUuid: string,
        payload: Record<string, any>,
    ): void {
        this.params.transport.send(createBridgeAgentResponse(type, payload, requestUuid));
    }

    private sendError(
        type: BridgingTypes.ResponseMessageType,
        requestUuid: string,
        error: BridgingTypes.ResponseErrorDetail,
    ): void {
        this.params.transport.send(createBridgeAgentErrorResponse(type, error, requestUuid));
    }

    private async handleFindIntent(message: BridgingTypes.FindIntentBridgeRequest): Promise<void> {
        const { intent, context, resultType } = message.payload;

        if (context != null && !isContext(context)) {
            this.sendError('findIntentResponse', message.meta.requestUuid, 'MalformedContext');
            return;
        }

        try {
            const appIntent = await this.params.agent.directory.getLocalAppIntent(intent, context, resultType);
            this.sendResponse('findIntentResponse', message.meta.requestUuid, {
                appIntent: this.stampAppIntent(appIntent),
            });
        } catch (error) {
            this.sendError('findIntentResponse', message.meta.requestUuid, toFindInstancesError(error, 'NoAppsFound'));
        }
    }

    private async handleFindIntentsByContext(message: BridgingTypes.FindIntentsByContextBridgeRequest): Promise<void> {
        const { context, resultType } = message.payload;

        if (!isContext(context)) {
            this.sendError('findIntentsByContextResponse', message.meta.requestUuid, 'MalformedContext');
            return;
        }

        try {
            const appIntents = await this.params.agent.directory.getLocalAppIntentsForContext(context, resultType);
            this.sendResponse('findIntentsByContextResponse', message.meta.requestUuid, {
                appIntents: appIntents.map(appIntent => this.stampAppIntent(appIntent)),
            });
        } catch (error) {
            this.sendError(
                'findIntentsByContextResponse',
                message.meta.requestUuid,
                toFindInstancesError(error, 'NoAppsFound'),
            );
        }
    }

    private async handleFindInstances(message: BridgingTypes.FindInstancesBridgeRequest): Promise<void> {
        try {
            const appIdentifiers = await this.params.agent.directory.getLocalAppInstances(message.payload.app.appId);

            if (appIdentifiers == null) {
                this.sendError('findInstancesResponse', message.meta.requestUuid, 'NoAppsFound');
                return;
            }

            this.sendResponse('findInstancesResponse', message.meta.requestUuid, {
                appIdentifiers: appIdentifiers.map(appIdentifier => this.stampAppMetadata(appIdentifier)),
            });
        } catch (error) {
            this.sendError(
                'findInstancesResponse',
                message.meta.requestUuid,
                toFindInstancesError(error, 'NoAppsFound'),
            );
        }
    }

    private async handleGetAppMetadata(message: BridgingTypes.GetAppMetadataBridgeRequest): Promise<void> {
        try {
            const appMetadata = await this.params.agent.directory.getLocalAppMetadata(
                toLocalAppIdentifier(message.payload.app),
            );

            if (appMetadata == null) {
                this.sendError('getAppMetadataResponse', message.meta.requestUuid, 'TargetAppUnavailable');
                return;
            }

            this.sendResponse('getAppMetadataResponse', message.meta.requestUuid, {
                appMetadata: this.stampAppMetadata(appMetadata),
            });
        } catch (error) {
            this.sendError(
                'getAppMetadataResponse',
                message.meta.requestUuid,
                toFindInstancesError(error, 'TargetAppUnavailable'),
            );
        }
    }

    private async handleOpen(message: BridgingTypes.OpenBridgeRequest): Promise<void> {
        const context = message.payload.context;

        if (context != null && !isContext(context)) {
            this.sendError('openResponse', message.meta.requestUuid, 'MalformedContext');
            return;
        }

        try {
            const appIdentifier = await this.params.agent.open(toLocalAppIdentifier(message.payload.app), context);
            this.sendResponse('openResponse', message.meta.requestUuid, { appIdentifier });
        } catch (error) {
            this.sendError('openResponse', message.meta.requestUuid, toOpenError(error, 'AppNotFound'));
        }
    }

    /**
     * Two-phase: the immediate raiseIntentResponse is sent here once the local app has accepted the
     * intent (an intentListener has been registered and the intentEvent published). The later
     * raiseIntentResultResponse - once the local app actually produces a result - is sent
     * separately, from DesktopAgentBridge.publishIntentResult, when DesktopAgentImpl relays it via
     * onIntentResultRequest. That message is not a response to this request/response pair: it has
     * no request of its own and is correlated purely by requestUuid.
     */
    private async handleRaiseIntent(
        message: BridgingTypes.RaiseIntentBridgeRequest,
        originatingApp: RemoteAppIdentifier,
    ): Promise<void> {
        const { intent, context, app } = message.payload;

        if (!isContext(context)) {
            this.sendError('raiseIntentResponse', message.meta.requestUuid, 'MalformedContext');
            return;
        }

        try {
            const intentResolution = await this.params.agent.raiseIntentFromRemote({
                requestUuid: message.meta.requestUuid,
                intent,
                context,
                app: toLocalAppIdentifier(app),
                originatingApp,
            });

            this.sendResponse('raiseIntentResponse', message.meta.requestUuid, { intentResolution });
        } catch (error) {
            this.sendError(
                'raiseIntentResponse',
                message.meta.requestUuid,
                toFindInstancesError(error, 'IntentDeliveryFailed'),
            );
        }
    }
}
