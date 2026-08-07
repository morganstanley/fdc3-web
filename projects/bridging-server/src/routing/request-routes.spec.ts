/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it } from 'vitest';
import { buildRequestRoutes, REQUEST_ROUTES } from './request-routes.js';

describe(`REQUEST_ROUTES`, () => {
    it(`should classify the six request/response families as 'request'`, () => {
        const requestKinds = [
            'findIntentRequest',
            'findIntentsByContextRequest',
            'findInstancesRequest',
            'getAppMetadataRequest',
            'openRequest',
            'raiseIntentRequest',
        ] as const;

        requestKinds.forEach(type => {
            expect(REQUEST_ROUTES[type].kind).toBe('request');
        });
    });

    it(`should classify broadcastRequest and the six PrivateChannel.* types as 'fanout'`, () => {
        const fanoutKinds = [
            'broadcastRequest',
            'PrivateChannel.broadcast',
            'PrivateChannel.eventListenerAdded',
            'PrivateChannel.eventListenerRemoved',
            'PrivateChannel.onAddContextListener',
            'PrivateChannel.onDisconnect',
            'PrivateChannel.onUnsubscribe',
        ] as const;

        fanoutKinds.forEach(type => {
            expect(REQUEST_ROUTES[type].kind).toBe('fanout');
        });
    });

    it(`should only mark broadcastRequest as updating channelsState`, () => {
        expect(REQUEST_ROUTES.broadcastRequest).toEqual({ kind: 'fanout', updatesChannelsState: true });
        expect(REQUEST_ROUTES['PrivateChannel.broadcast']).toEqual({ kind: 'fanout', updatesChannelsState: false });
    });
});

describe(`buildRequestRoutes`, () => {
    it(`should return the shared default table unchanged when no overrides are supplied`, () => {
        expect(buildRequestRoutes()).toBe(REQUEST_ROUTES);
    });

    it(`should override the timeout for the specified request family only`, () => {
        const routes = buildRequestRoutes({ findIntentRequest: 1234 });

        expect(routes.findIntentRequest).toMatchObject({ timeoutMs: 1234 });
        expect(routes.openRequest).toBe(REQUEST_ROUTES.openRequest);
    });

    it(`should not mutate the shared default table`, () => {
        buildRequestRoutes({ findIntentRequest: 1234 });

        expect(REQUEST_ROUTES.findIntentRequest.timeoutMs).not.toBe(1234);
    });

    it(`should ignore an override for a fanout (responseless) family`, () => {
        const routes = buildRequestRoutes({ ['PrivateChannel.broadcast' as any]: 1234 });

        expect(routes['PrivateChannel.broadcast']).toEqual(REQUEST_ROUTES['PrivateChannel.broadcast']);
    });
});
