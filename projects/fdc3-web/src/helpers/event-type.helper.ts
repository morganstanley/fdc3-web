/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes, FDC3EventTypes, PrivateChannelEventTypes } from '@finos/fdc3';
import { EventListenerKey } from '../contracts.js';

type PrivateChannelEventMessageTypes = Extract<
    BrowserTypes.EventMessageType,
    | 'privateChannelOnAddContextListenerEvent'
    | 'privateChannelOnDisconnectEvent'
    | 'privateChannelOnUnsubscribeEvent'
    | 'contextClearedEvent'
>;

export function convertToFDC3EventTypes(type: BrowserTypes.EventMessageType): FDC3EventTypes | null {
    switch (type) {
        case 'channelChangedEvent':
            return 'userChannelChanged';
        case 'contextClearedEvent':
            return 'contextCleared';
        default:
            return null;
    }
}

export function convertToEventListenerIndex(type: 'USER_CHANNEL_CHANGED' | null): EventListenerKey {
    return type === 'USER_CHANNEL_CHANGED' ? 'userChannelChanged' : 'allEvents';
}

export function convertToPrivateChannelEventTypes(
    type: BrowserTypes.PrivateChannelEventType | PrivateChannelEventMessageTypes,
): PrivateChannelEventTypes {
    switch (type) {
        case 'privateChannelOnAddContextListenerEvent':
        case 'addContextListener':
            return 'addContextListener';
        case 'privateChannelOnDisconnectEvent':
        case 'disconnect':
            return 'disconnect';
        case 'privateChannelOnUnsubscribeEvent':
        case 'unsubscribe':
            return 'unsubscribe';
        case 'contextClearedEvent':
        case 'contextCleared':
            return 'contextCleared';
    }
}

export function convertToPrivateChannelEventMessageTypes(
    type: PrivateChannelEventTypes,
): PrivateChannelEventMessageTypes {
    switch (type) {
        case 'addContextListener':
        case 'privateChannelOnAddContextListenerEvent':
            return 'privateChannelOnAddContextListenerEvent';
        case 'disconnect':
        case 'privateChannelOnDisconnectEvent':
            return 'privateChannelOnDisconnectEvent';
        case 'unsubscribe':
        case 'privateChannelOnUnsubscribeEvent':
            return 'privateChannelOnUnsubscribeEvent';
        case 'contextCleared':
            return 'contextClearedEvent';
    }
}
