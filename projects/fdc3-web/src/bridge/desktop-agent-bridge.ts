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
    BridgingTypes,
    Context,
    GetAgentLogLevels,
    Intent,
    PrivateChannelEventTypes,
} from '@finos/fdc3';
import { DesktopAgentImpl } from '../agent/desktop-agent.js';
import { BRIDGE } from '../constants.js';
import { IDesktopAgentBridge, RemoteAppIdentifier } from '../contracts.internal.js';
import { BridgeParams, FullyQualifiedAppIdentifier, IBridgeTransport } from '../contracts.js';
import {
    createLogger,
    isFindInstancesBridgeResponse,
    isFindIntentBridgeResponse,
    isFindIntentsByContextBridgeResponse,
    isGetAppMetadataBridgeResponse,
    isOpenBridgeResponse,
    isRaiseIntentBridgeResponse,
    isRaiseIntentResultBridgeResponse,
    LoggerFunction,
} from '../helpers/index.js';
import { BridgeConnection } from './bridge-connection.js';
import { BridgeInboundRouter } from './bridge-inbound.js';
import { createBridgeAgentRequest, createBridgeAgentResponse } from './bridge-message.factory.js';
import { BridgeMessageCorrelator } from './bridge-message-correlator.js';
import { WebSocketBridgeTransport } from './websocket-bridge-transport.js';

export type DesktopAgentBridgeParams = {
    agent: DesktopAgentImpl;
    params: BridgeParams;
    /** Fallback requestedName when BridgeParams.requestedName is not supplied - the root appId. */
    defaultRequestedName: string;
    logLevels?: GetAgentLogLevels;
};

type PrivateChannelMessageType =
    | 'PrivateChannel.broadcast'
    | 'PrivateChannel.onAddContextListener'
    | 'PrivateChannel.onUnsubscribe'
    | 'PrivateChannel.onDisconnect'
    | 'PrivateChannel.eventListenerAdded'
    | 'PrivateChannel.eventListenerRemoved';

/**
 * Connects the root Desktop Agent to a Desktop Agent Bridge (https://fdc3.finos.org/docs/agent-bridging/spec).
 * Composition root for the bridge/ module: owns the transport, connection handshake, message
 * correlator and inbound router, and is itself the IDesktopAgentBridge implementation that
 * AppDirectory/ChannelMessageHandler/DesktopAgentImpl are wired up against.
 */
export class DesktopAgentBridge implements IDesktopAgentBridge {
    private readonly log: LoggerFunction;
    private readonly transport: IBridgeTransport;
    private readonly connection: BridgeConnection;
    private readonly correlator: BridgeMessageCorrelator;
    private readonly inboundRouter: BridgeInboundRouter;
    private readonly responseTimeoutMs: number;
    private readonly intentResultTimeoutMs: number;

    public static async create(params: DesktopAgentBridgeParams): Promise<DesktopAgentBridge> {
        const transport =
            params.params.transportFactory != null
                ? await params.params.transportFactory()
                : new WebSocketBridgeTransport({
                      portRange: params.params.portRange,
                      retryPauseMs: params.params.reconnectDelayMs,
                      logLevels: params.logLevels,
                  });

        return new DesktopAgentBridge(params, transport);
    }

    private constructor(
        private readonly params: DesktopAgentBridgeParams,
        transport: IBridgeTransport,
    ) {
        this.log = createLogger(DesktopAgentBridge, 'connection', params.logLevels);
        this.transport = transport;
        this.responseTimeoutMs = params.params.responseTimeoutMs ?? BRIDGE.RESPONSE_TIMEOUT_MS;
        this.intentResultTimeoutMs = params.params.intentResultTimeoutMs ?? BRIDGE.INTENT_RESULT_TIMEOUT_MS;

        this.correlator = new BridgeMessageCorrelator({
            transport,
            responseTimeoutMs: this.responseTimeoutMs,
            logLevels: params.logLevels,
        });
        this.inboundRouter = new BridgeInboundRouter({ transport, agent: params.agent, logLevels: params.logLevels });
        this.connection = new BridgeConnection({
            transport,
            requestedName: params.params.requestedName ?? params.defaultRequestedName,
            authToken: params.params.authToken,
            validateBridgeAuthToken: params.params.validateBridgeAuthToken,
            getImplementationMetadata: async () => {
                const info = await params.agent.getInfo();
                return {
                    fdc3Version: info.fdc3Version,
                    provider: info.provider,
                    providerVersion: info.providerVersion,
                    optionalFeatures: info.optionalFeatures,
                };
            },
            getChannelsState: () => params.agent.channelMessageHandler.getChannelsState(),
            adoptChannelsState: state => params.agent.channelMessageHandler.applyChannelsState(state),
            onRemoteAgentDisconnected: desktopAgent =>
                params.agent.channelMessageHandler.cleanupDisconnectedAgent(desktopAgent),
            logLevels: params.logLevels,
        });
    }

    public connect(): void {
        this.log('Connecting to Desktop Agent Bridge');
        this.connection.connect();
    }

    public close(): void {
        this.inboundRouter.close();
        this.correlator.close();
        this.connection.close();
        this.transport.close();
    }

    public get agentName(): string | undefined {
        return this.connection.agentName;
    }

    private localSource(): BridgingTypes.SourceIdentifier {
        const root = this.params.agent.directory.rootAppIdentifier;
        return { appId: root.appId, instanceId: root.instanceId, desktopAgent: this.agentName };
    }

    private requireAgentName(): string {
        const name = this.agentName;
        if (name == null) {
            throw 'NotConnectedToBridge';
        }
        return name;
    }

    // IRemoteAppSource - every method resolves, never rejects, so callers degrade to local-only results

    public async findIntent(intent: Intent, context?: Context, resultType?: string): Promise<AppMetadata[]> {
        if (this.agentName == null) {
            return [];
        }

        const message = createBridgeAgentRequest(
            'findIntentRequest',
            { intent, context, resultType },
            this.localSource(),
        );
        const promise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isFindIntentBridgeResponse,
            this.responseTimeoutMs,
        );
        this.transport.send(message);

        return promise.then(response => response.payload.appIntent.apps).catch(() => []);
    }

    public async findIntentsByContext(context: Context, resultType?: string): Promise<AppIntent[]> {
        if (this.agentName == null) {
            return [];
        }

        const message = createBridgeAgentRequest(
            'findIntentsByContextRequest',
            { context, resultType },
            this.localSource(),
        );
        const promise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isFindIntentsByContextBridgeResponse,
            this.responseTimeoutMs,
        );
        this.transport.send(message);

        return promise.then(response => response.payload.appIntents).catch(() => []);
    }

    public async findInstances(app: AppIdentifier): Promise<AppMetadata[]> {
        if (this.agentName == null) {
            return [];
        }

        const destination = app.desktopAgent != null ? { appId: app.appId, desktopAgent: app.desktopAgent } : undefined;
        const message = createBridgeAgentRequest('findInstancesRequest', { app }, this.localSource(), destination);
        const promise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isFindInstancesBridgeResponse,
            this.responseTimeoutMs,
        );
        this.transport.send(message);

        return promise.then(response => response.payload.appIdentifiers).catch(() => []);
    }

    public async getAppMetadata(app: AppIdentifier): Promise<AppMetadata | undefined> {
        if (this.agentName == null || app.desktopAgent == null) {
            return undefined;
        }

        const destination = { appId: app.appId, instanceId: app.instanceId, desktopAgent: app.desktopAgent };
        const message = createBridgeAgentRequest(
            'getAppMetadataRequest',
            { app: destination },
            this.localSource(),
            destination,
        );
        const promise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isGetAppMetadataBridgeResponse,
            this.responseTimeoutMs,
        );
        this.transport.send(message);

        return promise.then(response => response.payload.appMetadata).catch(() => undefined);
    }

    // IDesktopAgentBridge

    public async raiseIntent(params: {
        intent: Intent;
        context: Context;
        app: RemoteAppIdentifier;
        source: FullyQualifiedAppIdentifier;
    }): Promise<{ intentResolution: BridgingTypes.IntentResolution; result: Promise<BridgingTypes.IntentResult> }> {
        const agentName = this.requireAgentName();
        const source = { appId: params.source.appId, instanceId: params.source.instanceId, desktopAgent: agentName };
        const destination = {
            appId: params.app.appId,
            instanceId: params.app.instanceId,
            desktopAgent: params.app.desktopAgent,
        };

        const message = createBridgeAgentRequest(
            'raiseIntentRequest',
            { intent: params.intent, context: params.context, app: destination },
            source,
            destination,
        );

        const resolutionPromise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isRaiseIntentBridgeResponse,
            this.responseTimeoutMs,
        );
        const late = this.correlator.awaitLateResponse(
            message.meta.requestUuid,
            isRaiseIntentResultBridgeResponse,
            this.intentResultTimeoutMs,
        );
        // pre-handle so an unconsumed getResult() cannot raise an unhandled rejection
        void late.promise.catch(() => undefined);

        this.transport.send(message);

        const resolution = await resolutionPromise.catch(error => {
            late.cancel();
            throw error;
        });

        return {
            intentResolution: resolution.payload.intentResolution,
            result: late.promise.then(response => response.payload.intentResult),
        };
    }

    public async open(params: {
        app: RemoteAppIdentifier;
        context?: Context;
        source: FullyQualifiedAppIdentifier;
    }): Promise<AppIdentifier> {
        const agentName = this.requireAgentName();
        const source = { appId: params.source.appId, instanceId: params.source.instanceId, desktopAgent: agentName };
        const destination = {
            appId: params.app.appId,
            instanceId: params.app.instanceId,
            desktopAgent: params.app.desktopAgent,
        };

        const message = createBridgeAgentRequest(
            'openRequest',
            { app: destination, context: params.context },
            source,
            destination,
        );
        const promise = this.correlator.awaitResponse(
            message.meta.requestUuid,
            isOpenBridgeResponse,
            this.responseTimeoutMs,
        );
        this.transport.send(message);

        const response = await promise;
        return response.payload.appIdentifier;
    }

    public publishIntentResult(
        requestUuid: string,
        _originatingApp: RemoteAppIdentifier,
        intentResult: BridgingTypes.IntentResult,
    ): void {
        this.transport.send(createBridgeAgentResponse('raiseIntentResultResponse', { intentResult }, requestUuid));
    }

    // IChannelBridge - fire-and-forget, must never throw

    public broadcast(channelId: string, context: Context, source: FullyQualifiedAppIdentifier): void {
        const agentName = this.agentName;
        if (agentName == null) {
            return;
        }

        this.transport.send(
            createBridgeAgentRequest(
                'broadcastRequest',
                { channelId, context },
                { ...source, desktopAgent: agentName },
            ),
        );
    }

    public privateChannelBroadcast(
        channelId: string,
        context: Context,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage('PrivateChannel.broadcast', { channelId, context }, source, desktopAgents);
    }

    public privateChannelOnAddContextListener(
        channelId: string,
        contextType: string | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage(
            'PrivateChannel.onAddContextListener',
            { channelId, contextType },
            source,
            desktopAgents,
        );
    }

    public privateChannelOnUnsubscribe(
        channelId: string,
        contextType: string | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage(
            'PrivateChannel.onUnsubscribe',
            { channelId, contextType },
            source,
            desktopAgents,
        );
    }

    public privateChannelOnDisconnect(
        channelId: string,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage('PrivateChannel.onDisconnect', { channelId }, source, desktopAgents);
    }

    public privateChannelEventListenerAdded(
        channelId: string,
        listenerType: PrivateChannelEventTypes | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage(
            'PrivateChannel.eventListenerAdded',
            { channelId, listenerType },
            source,
            desktopAgents,
        );
    }

    public privateChannelEventListenerRemoved(
        channelId: string,
        listenerType: PrivateChannelEventTypes | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        this.sendPrivateChannelMessage(
            'PrivateChannel.eventListenerRemoved',
            { channelId, listenerType },
            source,
            desktopAgents,
        );
    }

    /**
     * Sends a PrivateChannel.* message. The wire protocol only supports a single `destination` (one
     * app), not a list of agents, so - per the six-message family this always broadcasts to every
     * connected agent rather than attempting to target only `desktopAgents` individually; wasteful
     * but correct, and narrowable later once remote channel participants are tracked more precisely.
     * Sends nothing when the channel is not shared with any agent (`desktopAgents` empty) or the
     * bridge is not connected.
     */
    private sendPrivateChannelMessage(
        type: PrivateChannelMessageType,
        payload: Record<string, any>,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void {
        const agentName = this.agentName;
        if (agentName == null || desktopAgents.length === 0) {
            return;
        }

        this.transport.send(createBridgeAgentRequest(type, payload, { ...source, desktopAgent: agentName }));
    }
}
