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
    Context,
    Intent,
    PrivateChannelEventTypes,
} from '@finos/fdc3';
import { AppDirectoryApplication } from './app-directory.contracts.js';
import { EventMessage, FullyQualifiedAppIdentifier, IProxyMessagingProvider, ResponseMessage } from './contracts.js';

/**
 * An interface used by the root agent for publishing messages to one or many proxy agents
 */
export interface IRootPublisher extends IProxyMessagingProvider {
    publishResponseMessage(message: ResponseMessage, source: FullyQualifiedAppIdentifier): void;

    publishEvent(
        message: EventMessage,
        appIdentifiers: [FullyQualifiedAppIdentifier, ...FullyQualifiedAppIdentifier[]],
    ): void;

    /**
     * waits for the identity assigned to the assigned to the provided connection attempt uuid
     */
    awaitAppIdentity(connectionAttemptUuid: string, app: AppDirectoryApplication): Promise<FullyQualifiedAppIdentifier>;
}

/**
 * A temporary interface used to extend the AddIntentListenerRequest
 * This will be removed when this feature is added to the FDC3 API and the BrowserTypes.AddIntentListenerRequestPayload is updated to include contextTypes
 */
export interface AddIntentListenerWithContextRequest extends BrowserTypes.AddIntentListenerRequest {
    payload: AddIntentListenerWithContextRequestPayload;
}

export interface AddIntentListenerWithContextRequestPayload extends BrowserTypes.AddIntentListenerRequestPayload {
    contextTypes?: string[];
}

/**
 * A request message to update the instance metadata for the calling app instance
 * This is not yet part of the FDC3 standard messaging protocol
 */
export interface UpdateInstanceMetadataRequest {
    type: 'updateInstanceMetadataRequest';
    payload: UpdateInstanceMetadataRequestPayload;
    meta: BrowserTypes.AppRequestMessageMeta;
}

export interface UpdateInstanceMetadataRequestPayload {
    instanceMetadata: { [key: string]: any };
}

export interface UpdateInstanceMetadataResponse {
    type: 'updateInstanceMetadataResponse';
    payload: UpdateInstanceMetadataResponsePayload;
    meta: BrowserTypes.AgentResponseMessageMeta;
}

export interface UpdateInstanceMetadataResponsePayload {
    error?: BrowserTypes.ResponsePayloadError;
}

/**
 * An AppIdentifier that names the Desktop Agent hosting the app - i.e. an app discovered or
 * targeted via Desktop Agent Bridging rather than this agent's own AppDirectory.
 */
export type RemoteAppIdentifier = AppIdentifier & { desktopAgent: string };

/**
 * The bridge as seen by the AppDirectory: a live, read-only source of apps hosted by other Desktop
 * Agents. Every method resolves - it must never reject and must never hang past the configured
 * request timeout, so that a slow or absent bridge degrades findIntent / findInstances /
 * getAppMetadata to local-only results rather than failing them.
 */
export interface IRemoteAppSource {
    /**
     * The name assigned to this agent by the bridge, or undefined until the handshake completes.
     */
    readonly agentName: string | undefined;
    findIntent(intent: Intent, context?: Context, resultType?: string): Promise<AppMetadata[]>;
    findIntentsByContext(context: Context, resultType?: string): Promise<AppIntent[]>;
    findInstances(app: AppIdentifier): Promise<AppMetadata[]>;
    getAppMetadata(app: AppIdentifier): Promise<AppMetadata | undefined>;
}

/**
 * The bridge as seen by the ChannelMessageHandler. All methods are fire-and-forget: they must not
 * throw and must not reject, as channel fan-out to local apps must not depend on the bridge.
 */
export interface IChannelBridge {
    readonly agentName: string | undefined;
    broadcast(channelId: string, context: Context, source: FullyQualifiedAppIdentifier): void;
    privateChannelBroadcast(
        channelId: string,
        context: Context,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void;
    privateChannelOnAddContextListener(
        channelId: string,
        contextType: string | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void;
    privateChannelOnUnsubscribe(
        channelId: string,
        contextType: string | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void;
    privateChannelOnDisconnect(channelId: string, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelEventListenerAdded(
        channelId: string,
        listenerType: PrivateChannelEventTypes | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void;
    privateChannelEventListenerRemoved(
        channelId: string,
        listenerType: PrivateChannelEventTypes | null,
        source: FullyQualifiedAppIdentifier,
        desktopAgents: string[],
    ): void;
}

/**
 * The full bridge seam used by DesktopAgentImpl for outbound delegation to a Desktop Agent Bridge.
 */
export interface IDesktopAgentBridge extends IRemoteAppSource, IChannelBridge {
    /**
     * Raises an intent on an app hosted by another agent. Resolves once the remote agent has
     * accepted the intent; `result` resolves later, when the remote app returns a result.
     * Rejects with a BrowserTypes.FindInstancesErrors value.
     */
    raiseIntent(params: {
        intent: Intent;
        context: Context;
        app: RemoteAppIdentifier;
        source: FullyQualifiedAppIdentifier;
    }): Promise<{ intentResolution: BrowserTypes.IntentResolution; result: Promise<BrowserTypes.IntentResult> }>;

    /**
     * Opens an app hosted by another agent. Rejects with a BrowserTypes.OpenErrorResponsePayload value.
     */
    open(params: {
        app: RemoteAppIdentifier;
        context?: Context;
        source: FullyQualifiedAppIdentifier;
    }): Promise<AppIdentifier>;

    /**
     * Delivers the result a local app produced for a raiseIntent that was raised by another agent,
     * correlated by the bridging requestUuid that accompanied the original request.
     */
    publishIntentResult(
        requestUuid: string,
        originatingApp: RemoteAppIdentifier,
        intentResult: BrowserTypes.IntentResult,
    ): void;
}
