/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes } from '@finos/fdc3';
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
