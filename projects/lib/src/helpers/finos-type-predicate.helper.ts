/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

/* istanbul ignore file */
// we hope these functions will get added to @finos/fdc3 so we can remove these implementations

import type { BrowserTypes, PrivateChannel, PrivateChannelEventTypes } from '@finos/fdc3';

/* istanbul ignore next */
export function isRequestMessageType(value: any): boolean {
    const requestMessage: BrowserTypes.RequestMessageType = value;

    switch (requestMessage) {
        case 'addContextListenerRequest':
        case 'addEventListenerRequest':
        case 'addIntentListenerRequest':
        case 'broadcastRequest':
        case 'contextListenerUnsubscribeRequest':
        case 'createPrivateChannelRequest':
        case 'eventListenerUnsubscribeRequest':
        case 'findInstancesRequest':
        case 'findIntentRequest':
        case 'findIntentsByContextRequest':
        case 'getAppMetadataRequest':
        case 'getCurrentChannelRequest':
        case 'getCurrentContextRequest':
        case 'getInfoRequest':
        case 'getOrCreateChannelRequest':
        case 'getUserChannelsRequest':
        case 'intentListenerUnsubscribeRequest':
        case 'intentResultRequest':
        case 'joinUserChannelRequest':
        case 'leaveCurrentChannelRequest':
        case 'openRequest':
        case 'privateChannelAddEventListenerRequest':
        case 'privateChannelDisconnectRequest':
        case 'privateChannelUnsubscribeEventListenerRequest':
        case 'raiseIntentForContextRequest':
        case 'raiseIntentRequest':
        case 'heartbeatAcknowledgementRequest':
            return true;
        default:
            return neverCheck(requestMessage); // just to ensure that we have covered all values in our switch statement
    }
}

export function isAppRequestMessage(value: any): value is BrowserTypes.AppRequestMessage {
    const requestMessage = value as BrowserTypes.AppRequestMessage;

    return (
        requestMessage != null &&
        typeof requestMessage.meta === 'object' &&
        typeof requestMessage.payload === 'object' &&
        isRequestMessageType(requestMessage.type) &&
        typeof requestMessage.meta.requestUuid === 'string' &&
        requestMessage.meta.timestamp instanceof Date
    );
}

export function isAppResponseMessage(value: any): value is BrowserTypes.AgentResponseMessage {
    const requestMessage = value as BrowserTypes.AgentResponseMessage;

    return (
        requestMessage != null &&
        typeof requestMessage.meta === 'object' &&
        typeof requestMessage.payload === 'object' &&
        typeof requestMessage.type === 'string' &&
        typeof requestMessage.meta.requestUuid === 'string' &&
        requestMessage.meta.timestamp instanceof Date &&
        typeof requestMessage.meta.responseUuid === 'string'
    );
}

export function isAppEventMessage(value: any): value is BrowserTypes.AgentEventMessage {
    const eventMessage = value as BrowserTypes.AgentEventMessage;
    return (
        eventMessage != null &&
        typeof eventMessage.meta === 'object' &&
        typeof eventMessage.payload === 'object' &&
        typeof eventMessage.type === 'string' &&
        eventMessage.meta.timestamp instanceof Date &&
        typeof eventMessage.meta.eventUuid === 'string'
    );
}

export type PrivateChannelListenerEvents =
    | BrowserTypes.PrivateChannelOnAddContextListenerEvent
    | BrowserTypes.PrivateChannelOnUnsubscribeEvent
    | BrowserTypes.PrivateChannelOnDisconnectEvent;

export function isPrivateChannelEvent(value: any): value is PrivateChannelListenerEvents {
    return (
        isAppEventMessage(value) &&
        (value.type === 'privateChannelOnAddContextListenerEvent' ||
            value.type === 'privateChannelOnUnsubscribeEvent' ||
            value.type === 'privateChannelOnDisconnectEvent')
    );
}

/* istanbul ignore next */
export function isResponsePayloadError(value: any): value is BrowserTypes.ResponsePayloadError {
    const responseError: BrowserTypes.ResponsePayloadError = value;

    switch (responseError) {
        case 'ApiTimeout':
        case 'AccessDenied':
        case 'CreationFailed':
        case 'MalformedContext':
        case 'NoChannelFound':
        case 'AppNotFound':
        case 'AppTimeout':
        case 'DesktopAgentNotFound':
        case 'ErrorOnLaunch':
        case 'ResolverUnavailable':
        case 'IntentDeliveryFailed':
        case 'NoAppsFound':
        case 'ResolverTimeout':
        case 'TargetAppUnavailable':
        case 'TargetInstanceUnavailable':
        case 'UserCancelledResolution':
        case 'IntentHandlerRejected':
        case 'NoResultReturned':
        case 'AgentDisconnected':
        case 'NotConnectedToBridge':
        case 'ResponseToBridgeTimedOut':
        case 'MalformedMessage':
            return true;
        default:
            return neverCheck(responseError); // just to ensure that we have covered all values in our switch statement
    }
}

/* istanbul ignore next */
export function isFindInstancesErrors(value: any): value is BrowserTypes.FindInstancesErrors {
    const findInstanceError: BrowserTypes.FindInstancesErrors = value;

    switch (findInstanceError) {
        case 'ApiTimeout':
        case 'MalformedContext':
        case 'DesktopAgentNotFound':
        case 'ResolverUnavailable':
        case 'IntentDeliveryFailed':
        case 'NoAppsFound':
        case 'ResolverTimeout':
        case 'TargetAppUnavailable':
        case 'TargetInstanceUnavailable':
        case 'UserCancelledResolution':
        case 'AgentDisconnected':
        case 'NotConnectedToBridge':
        case 'ResponseToBridgeTimedOut':
        case 'MalformedMessage':
            return true;
        default:
            return neverCheck(findInstanceError); // just to ensure that we have covered all values in our switch statement
    }
}

/* istanbul ignore next */
export function isOpenError(value: any): value is BrowserTypes.OpenErrorResponsePayload {
    const openError: BrowserTypes.OpenErrorResponsePayload = value;

    switch (openError) {
        case 'ApiTimeout':
        case 'AgentDisconnected':
        case 'AppNotFound':
        case 'AppTimeout':
        case 'DesktopAgentNotFound':
        case 'ErrorOnLaunch':
        case 'MalformedContext':
        case 'MalformedMessage':
        case 'NotConnectedToBridge':
        case 'ResolverUnavailable':
        case 'ResponseToBridgeTimedOut':
            return true;
        default:
            return neverCheck(openError); // just to ensure that we have covered all values in our switch statement
    }
}

/* istanbul ignore next */
export function isPrivateChannelEventTypes(value: any): value is PrivateChannelEventTypes {
    switch (value) {
        case 'addContextListener':
        case 'unsubscribe':
        case 'disconnect':
            return true;
        default:
            return false;
    }
}

/* istanbul ignore next */
export function isPrivateChannel(value: any): value is PrivateChannel {
    const privateChannel = value as PrivateChannel;
    return (
        privateChannel != null &&
        typeof privateChannel.id === 'string' &&
        privateChannel.type === 'private' &&
        typeof privateChannel.disconnect === 'function' &&
        typeof privateChannel.addEventListener === 'function' &&
        typeof privateChannel.addContextListener === 'function' &&
        typeof privateChannel.broadcast === 'function' &&
        typeof privateChannel.getCurrentContext === 'function'
    );
}

/**
 * Request Messages
 */

export function isBroadcastRequest(value: any): value is BrowserTypes.BroadcastRequest {
    return isAppRequestMessage(value) && value.type === 'broadcastRequest';
}

export function isRaiseIntentRequest(value: any): value is BrowserTypes.RaiseIntentRequest {
    return isAppRequestMessage(value) && value.type === 'raiseIntentRequest';
}

export function isGetCurrentChannelRequest(value: any): value is BrowserTypes.GetCurrentChannelRequest {
    return isAppRequestMessage(value) && value.type === 'getCurrentChannelRequest';
}

export function isAddIntentListenerRequest(value: any): value is BrowserTypes.AddIntentListenerRequest {
    return isAppRequestMessage(value) && value.type === 'addIntentListenerRequest';
}

export function isAddContextListenerRequest(value: any): value is BrowserTypes.AddContextListenerRequest {
    return isAppRequestMessage(value) && value.type === 'addContextListenerRequest';
}

export function isRaiseIntentForContextRequest(value: any): value is BrowserTypes.RaiseIntentForContextRequest {
    return isAppRequestMessage(value) && value.type === 'raiseIntentForContextRequest';
}

export function isCreatePrivateChannelRequest(value: any): value is BrowserTypes.CreatePrivateChannelRequest {
    return isAppRequestMessage(value) && value.type === 'createPrivateChannelRequest';
}

export function isGetCurrentContextRequest(value: any): value is BrowserTypes.GetCurrentContextRequest {
    return isAppRequestMessage(value) && value.type === 'getCurrentContextRequest';
}

export function isPrivateChannelDisconnectRequest(value: any): value is BrowserTypes.PrivateChannelDisconnectRequest {
    return isAppRequestMessage(value) && value.type === 'privateChannelDisconnectRequest';
}

export function isAddEventListenerRequest(value: any): value is BrowserTypes.AddEventListenerRequest {
    return isAppRequestMessage(value) && value.type === 'addEventListenerRequest';
}

export function isHeartbeatEvent(value: any): value is BrowserTypes.HeartbeatEvent {
    return isAppEventMessage(value) && value.type === 'heartbeatEvent';
}

/**
 * Response Messages
 */

export function isIntentResultResponse(value: any): value is BrowserTypes.IntentResultResponse {
    return isAppResponseMessage(value) && value.type === 'intentResultResponse';
}

export function isGetAppMetadataResponse(value: any): value is BrowserTypes.GetAppMetadataResponse {
    return isAppResponseMessage(value) && value.type === 'getAppMetadataResponse';
}

export function isGetOrCreateChannelResponse(value: any): value is BrowserTypes.GetOrCreateChannelResponse {
    return isAppResponseMessage(value) && value.type === 'getOrCreateChannelResponse';
}

export function isBroadcastResponse(value: any): value is BrowserTypes.BroadcastResponse {
    return isAppResponseMessage(value) && value.type === 'broadcastResponse';
}

export function isJoinUserChannelResponse(value: any): value is BrowserTypes.JoinUserChannelResponse {
    return isAppResponseMessage(value) && value.type === 'joinUserChannelResponse';
}

export function isOpenResponse(value: any): value is BrowserTypes.OpenResponse {
    return isAppResponseMessage(value) && value.type === 'openResponse';
}

export function isGetUserChannelsResponse(value: any): value is BrowserTypes.GetUserChannelsResponse {
    return isAppResponseMessage(value) && value.type === 'getUserChannelsResponse';
}

export function isCreatePrivateChannelResponse(value: any): value is BrowserTypes.CreatePrivateChannelResponse {
    return isAppResponseMessage(value) && value.type === 'createPrivateChannelResponse';
}

export function isFindIntentResponse(value: any): value is BrowserTypes.FindIntentResponse {
    return isAppResponseMessage(value) && value.type === 'findIntentResponse';
}

export function isFindIntentsByContextResponse(value: any): value is BrowserTypes.FindIntentsByContextResponse {
    return isAppResponseMessage(value) && value.type === 'findIntentsByContextResponse';
}

export function isFindInstancesResponse(value: any): value is BrowserTypes.FindInstancesResponse {
    return isAppResponseMessage(value) && value.type === 'findInstancesResponse';
}

export function isRaiseIntentResponse(value: any): value is BrowserTypes.RaiseIntentResponse {
    return isAppResponseMessage(value) && value.type === 'raiseIntentResponse';
}

export function isRaiseIntentForContextResponse(value: any): value is BrowserTypes.RaiseIntentForContextResponse {
    return isAppResponseMessage(value) && value.type === 'raiseIntentForContextResponse';
}

export function isRaiseIntentResultResponse(value: any): value is BrowserTypes.RaiseIntentResultResponse {
    return isAppResponseMessage(value) && value.type === 'raiseIntentResultResponse';
}

export function isAddContextListenerResponse(value: any): value is BrowserTypes.AddContextListenerResponse {
    return isAppResponseMessage(value) && value.type === 'addContextListenerResponse';
}

export function isAddEventListenerResponse(value: any): value is BrowserTypes.AddEventListenerResponse {
    return isAppResponseMessage(value) && value.type === 'addEventListenerResponse';
}

export function isAddIntentListenerResponse(value: any): value is BrowserTypes.AddIntentListenerResponse {
    return isAppResponseMessage(value) && value.type === 'addIntentListenerResponse';
}

export function isGetInfoResponse(value: any): value is BrowserTypes.GetInfoResponse {
    return isAppResponseMessage(value) && value.type === 'getInfoResponse';
}

export function isGetCurrentChannelResponse(value: any): value is BrowserTypes.GetCurrentChannelResponse {
    return isAppResponseMessage(value) && value.type === 'getCurrentChannelResponse';
}

export function isGetCurrentContextResponse(value: any): value is BrowserTypes.GetCurrentContextResponse {
    return isAppResponseMessage(value) && value.type === 'getCurrentContextResponse';
}

export function isLeaveCurrentChannelResponse(value: any): value is BrowserTypes.LeaveCurrentChannelResponse {
    return isAppResponseMessage(value) && value.type === 'leaveCurrentChannelResponse';
}

export function isContextListenerUnsubscribeResponse(
    value: any,
): value is BrowserTypes.ContextListenerUnsubscribeResponse {
    return isAppResponseMessage(value) && value.type === 'contextListenerUnsubscribeResponse';
}

export function isIntentListenerUnsubscribeResponse(
    value: any,
): value is BrowserTypes.IntentListenerUnsubscribeResponse {
    return isAppResponseMessage(value) && value.type === 'intentListenerUnsubscribeResponse';
}

export function isPrivateChannelDisconnectResponse(value: any): value is BrowserTypes.PrivateChannelDisconnectResponse {
    return isAppResponseMessage(value) && value.type === 'privateChannelDisconnectResponse';
}

export function isEventListenerUnsubscribeResponse(value: any): value is BrowserTypes.EventListenerUnsubscribeResponse {
    return isAppResponseMessage(value) && value.type === 'eventListenerUnsubscribeResponse';
}

export function isPrivateChannelAddEventListenerResponse(
    value: any,
): value is BrowserTypes.PrivateChannelAddEventListenerResponse {
    return isAppResponseMessage(value) && value.type === 'privateChannelAddEventListenerResponse';
}

export function isPrivateChannelUnsubscribeEventListenerResponse(
    value: any,
): value is BrowserTypes.PrivateChannelUnsubscribeEventListenerResponse {
    return isAppResponseMessage(value) && value.type === 'privateChannelUnsubscribeEventListenerResponse';
}

/**
 * Event Messages
 */

export function isPrivateChannelOnAddContextListenerEvent(
    value: any,
): value is BrowserTypes.PrivateChannelOnAddContextListenerEvent {
    return isAppEventMessage(value) && value.type === 'privateChannelOnAddContextListenerEvent';
}

export function isPrivateChannelOnUnsubscribeEvent(value: any): value is BrowserTypes.PrivateChannelOnUnsubscribeEvent {
    return isAppEventMessage(value) && value.type === 'privateChannelOnUnsubscribeEvent';
}

export function isPrivateChannelOnDisconnectEvent(value: any): value is BrowserTypes.PrivateChannelOnDisconnectEvent {
    return isAppEventMessage(value) && value.type === 'privateChannelOnDisconnectEvent';
}

export function isBroadcastEvent(value: any): value is BrowserTypes.BroadcastEvent {
    return isAppEventMessage(value) && value.type === 'broadcastEvent';
}

export function isIntentEvent(value: any): value is BrowserTypes.IntentEvent {
    return isAppEventMessage(value) && value.type === 'intentEvent';
}

export function isChannelChangedEvent(value: any): value is BrowserTypes.ChannelChangedEvent {
    return isAppEventMessage(value) && value.type === 'channelChangedEvent';
}

/**
 * Handshake Messages
 */

export function isWCPHelloMessage(value: any): value is BrowserTypes.WebConnectionProtocol1Hello {
    return (value as BrowserTypes.WebConnectionProtocol1Hello).type === 'WCP1Hello';
}

export function isWCPSuccessResponse(
    value: any,
): value is BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse {
    return (
        (value as BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse).type ===
        'WCP5ValidateAppIdentityResponse'
    );
}

function neverCheck(_value: never): false {
    return false;
}
export function isWCPValidateAppIdentity(value: any): value is BrowserTypes.WebConnectionProtocol4ValidateAppIdentity {
    return (value as BrowserTypes.WebConnectionProtocol4ValidateAppIdentity).type === 'WCP4ValidateAppIdentity';
}

export function isWCPHandshake(value: any): value is BrowserTypes.WebConnectionProtocol3Handshake {
    return (value as BrowserTypes.WebConnectionProtocol3Handshake).type === 'WCP3Handshake';
}
