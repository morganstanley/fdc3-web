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
import { FDC3_VERSION } from '../constants.js';
import { FullyQualifiedAppIdentifier, RequestMessage } from '../contracts.js';
import { isWCPHelloMessage } from './finos-type-predicate.helper.js';
import { getTimestamp } from './timestamp.helper.js';
import { generateUUID } from './uuid.helper.js';

type PartialRequestMessage<T extends BrowserTypes.AppRequestMessage> = {
    type: T['type'];
    payload: T['payload'];
    meta: Required<BrowserTypes.AppRequestMessage['meta']>;
};

/**
 * Attempts to construct a request message of the given type.
 * Currently all types that extend AppRequestMessage can be constructed by this function
 * If this changes in the future and some types require extra props this function will have a return type of unknown and will need to be modified
 */
export function createRequestMessage<T extends RequestMessage>(
    type: T['type'],
    source: FullyQualifiedAppIdentifier,
    payload: T['payload'],
): PartialRequestMessage<T> extends T ? T : unknown {
    const requestMessage: PartialRequestMessage<T> = {
        meta: { requestUuid: generateUUID(), timestamp: getTimestamp(), source },
        payload,
        type,
    };

    return requestMessage as T;
}

type PartialResponseMessage<T extends BrowserTypes.AgentResponseMessage> = {
    type: T['type'];
    payload: T['payload'];
    meta: Required<BrowserTypes.AgentResponseMessage['meta']>;
};

export function createResponseMessage<T extends BrowserTypes.AgentResponseMessage>(
    type: T['type'],
    payload: T['payload'],
    requestUuid: string,
    source: FullyQualifiedAppIdentifier,
): PartialResponseMessage<T> extends T ? T : unknown {
    const responseMessage: PartialResponseMessage<T> = {
        meta: {
            responseUuid: generateUUID(),
            timestamp: getTimestamp(),
            requestUuid,
            source,
        },
        payload,
        type,
    };

    return responseMessage as T;
}

type PartialEvent<T extends BrowserTypes.AgentEventMessage> = {
    type: T['type'];
    payload: T['payload'];
    meta: Required<BrowserTypes.AgentEventMessage['meta']>;
};

export function createEvent<T extends BrowserTypes.AgentEventMessage>(
    type: T['type'],
    payload: T['payload'],
): PartialEvent<T> extends T ? T : unknown {
    const event: PartialEvent<T> = {
        meta: {
            timestamp: getTimestamp(),
            eventUuid: generateUUID(),
        },
        payload,
        type,
    };

    return event as T;
}

export function generateHelloMessage(identityUrl?: string): BrowserTypes.WebConnectionProtocol1Hello {
    const helloMessage: BrowserTypes.WebConnectionProtocol1Hello = {
        meta: { timestamp: getTimestamp(), connectionAttemptUuid: generateUUID() },
        payload: {
            actualUrl: window.location.href,
            fdc3Version: FDC3_VERSION,
            identityUrl: identityUrl ?? window.location.href,
        },
        type: 'WCP1Hello',
    };

    return helloMessage;
}

export function generateHandshakeResponseMessage(
    message: BrowserTypes.WebConnectionProtocol1Hello,
): BrowserTypes.WebConnectionProtocol3Handshake {
    return {
        type: 'WCP3Handshake',
        meta: {
            connectionAttemptUuid: message.meta.connectionAttemptUuid,
            timestamp: getTimestamp(),
        },
        payload: {
            channelSelectorUrl: false,
            fdc3Version: FDC3_VERSION,
            intentResolverUrl: false,
        },
    };
}

export function generateValidateIdentityMessage(
    connectionAttemptUuid: string,
    identityUrl?: string,
    instanceId?: string,
    instanceUuid?: string,
): BrowserTypes.WebConnectionProtocol4ValidateAppIdentity {
    return {
        meta: { timestamp: getTimestamp(), connectionAttemptUuid },
        payload: {
            actualUrl: window.location.href,
            identityUrl: identityUrl ?? window.location.href,
            instanceId,
            instanceUuid,
        },
        type: 'WCP4ValidateAppIdentity',
    };
}

/**
 * Listens to hello messages on the provided window and calls the provided callback with the connectionAttemptUuid
 * If the connection fails and is re-attempted a second connection attempt will be passed to the callback
 * call the returned unsubscribe function to stop listening
 */
export function subscribeToConnectionAttemptUuids(
    /**
     * The window to listen for hello messages on
     */
    windowRef: WindowProxy,
    /**
     * The new window that has just been created that will be sending hello messages
     */
    childWindow: WindowProxy,
    callback: (connectionAttemptUuid: string) => void,
): { unsubscribe: () => void } {
    function handleMessage(event: MessageEvent): void {
        if (isWCPHelloMessage(event.data) && event.source === childWindow) {
            windowRef.removeEventListener('message', handleMessage);
            callback(event.data.meta.connectionAttemptUuid);
        }
    }

    windowRef.addEventListener('message', handleMessage);

    return {
        unsubscribe: () => {
            windowRef.removeEventListener('message', handleMessage);
        },
    };
}
