/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { IMocked, Mock, proxyModule, registerMock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as timestampImport from '../helpers/timestamp.helper.js';
import * as uuidImport from '../helpers/uuid.helper.js';
import {
    createBridgeAgentErrorResponse,
    createBridgeAgentRequest,
    createBridgeAgentResponse,
    createHandshakeMessage,
} from './bridge-message.factory.js';

vi.mock('../helpers/uuid.helper.js', async () => {
    const actual = await vi.importActual('../helpers/uuid.helper.js');
    return proxyModule(actual);
});
vi.mock('../helpers/timestamp.helper.js', async () => {
    const actual = await vi.importActual('../helpers/timestamp.helper.js');
    return proxyModule(actual);
});

const mockedGeneratedUuid = 'mocked-generated-Uuid';
const mockedDate = new Date(2024, 1, 0, 0, 0, 0);

describe(`bridge-message.factory`, () => {
    let mockedUuidHelper: IMocked<typeof uuidImport>;
    let mockedTimestampHelper: IMocked<typeof timestampImport>;

    beforeEach(() => {
        mockedUuidHelper = Mock.create<typeof uuidImport>().setup(
            setupFunction('generateUUID', () => mockedGeneratedUuid),
        );
        mockedTimestampHelper = Mock.create<typeof timestampImport>().setup(
            setupFunction('getTimestamp', () => mockedDate),
        );
        registerMock(uuidImport, mockedUuidHelper.mock);
        registerMock(timestampImport, mockedTimestampHelper.mock);
    });

    describe(`createBridgeAgentRequest`, () => {
        it(`should have exactly requestUuid, timestamp and source in meta when no destination is supplied`, () => {
            const source = { appId: 'app-a', instanceId: 'instance-a', desktopAgent: 'agent-a' };

            const message = createBridgeAgentRequest('findIntentRequest', { intent: 'ViewChart' }, source);

            expect(message).toEqual({
                type: 'findIntentRequest',
                payload: { intent: 'ViewChart' },
                meta: { requestUuid: mockedGeneratedUuid, timestamp: mockedDate, source },
            });
            expect(Object.keys(message.meta)).toEqual(['requestUuid', 'timestamp', 'source']);
        });

        it(`should include destination when supplied`, () => {
            const source = { appId: 'app-a', instanceId: 'instance-a', desktopAgent: 'agent-a' };
            const destination = { appId: 'app-b', desktopAgent: 'agent-b' };

            const message = createBridgeAgentRequest('openRequest', { app: destination }, source, destination);

            expect(message.meta).toEqual({
                requestUuid: mockedGeneratedUuid,
                timestamp: mockedDate,
                source,
                destination,
            });
        });
    });

    describe(`createBridgeAgentResponse`, () => {
        it(`should echo requestUuid and generate a fresh responseUuid and timestamp`, () => {
            const message = createBridgeAgentResponse(
                'findIntentResponse',
                { appIntent: { apps: [] } },
                'request-uuid',
            );

            expect(message).toEqual({
                type: 'findIntentResponse',
                payload: { appIntent: { apps: [] } },
                meta: { requestUuid: 'request-uuid', responseUuid: mockedGeneratedUuid, timestamp: mockedDate },
            });
        });
    });

    describe(`createBridgeAgentErrorResponse`, () => {
        it(`should build a payload containing exactly the error`, () => {
            const message = createBridgeAgentErrorResponse('openResponse', 'AppNotFound', 'request-uuid');

            expect(message).toEqual({
                type: 'openResponse',
                payload: { error: 'AppNotFound' },
                meta: { requestUuid: 'request-uuid', responseUuid: mockedGeneratedUuid, timestamp: mockedDate },
            });
        });
    });

    describe(`createHandshakeMessage`, () => {
        it(`should build a ConnectionStep3Handshake`, () => {
            const payload = {
                implementationMetadata: {
                    fdc3Version: '2.2',
                    provider: 'Morgan Stanley',
                    optionalFeatures: {
                        DesktopAgentBridging: true,
                        OriginatingAppMetadata: true,
                        UserChannelMembershipAPIs: true,
                    },
                },
                requestedName: 'my-agent',
                channelsState: {},
            };

            const message = createHandshakeMessage('request-uuid', payload);

            expect(message).toEqual({
                type: 'handshake',
                payload,
                meta: { requestUuid: 'request-uuid', timestamp: mockedDate },
            });
        });
    });
});
