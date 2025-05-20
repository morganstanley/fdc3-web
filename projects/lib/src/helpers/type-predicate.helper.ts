/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BrowserTypes, Context } from '@finos/fdc3';
import { WebAppDetails } from '../app-directory.contracts.js';
import { FullyQualifiedAppId, FullyQualifiedAppIdentifier, IRootOutgoingMessageEnvelope } from '../contracts.js';

export function isFullyQualifiedAppIdentifier(value: any): value is FullyQualifiedAppIdentifier {
    const appIdentifier = value as FullyQualifiedAppIdentifier;
    return (
        appIdentifier != null && typeof appIdentifier.appId === 'string' && typeof appIdentifier.instanceId === 'string'
    );
}

export function isNonEmptyArray<T>(value?: T[]): value is [T, ...T[]] {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.length > 0;
}

export function isChannel(value?: BrowserTypes.Channel | Context | void): value is BrowserTypes.Channel {
    const channel = value as BrowserTypes.Channel;
    return channel != null && typeof channel.type === 'string' && typeof channel.id === 'string';
}

export function isContext(value?: BrowserTypes.Channel | Context | void): value is Context {
    const context = value as Context;
    return (
        context != null &&
        typeof context.type === 'string' &&
        (typeof context.id === 'object' || typeof context.id === 'undefined')
    );
}

export function isFullyQualifiedAppId(value: any): value is FullyQualifiedAppId {
    //https://regex101.com/r/tjkkcM/1
    return typeof value === 'string' && /\S+@\S+/.test(value);
}

export function isWebAppDetails(value: any): value is WebAppDetails {
    const details = value as WebAppDetails;
    return details != null && typeof details.url === 'string' && details.url != '';
}

export function isRootOutgoingMessageEnvelope(value: any): value is IRootOutgoingMessageEnvelope {
    const message = value as IRootOutgoingMessageEnvelope;

    return message != null && typeof message.payload === 'object' && Array.isArray(message.channelIds);
}
