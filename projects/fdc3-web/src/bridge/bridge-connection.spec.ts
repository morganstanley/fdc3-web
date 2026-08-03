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
import * as helpersImport from '../helpers/index.js';
import { BridgeConnection, BridgeConnectionParams } from './bridge-connection.js';
import { FakeBridgeTransport } from './bridge-transport.fake.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedGeneratedUuid = 'mocked-generated-Uuid';

const implementationMetadata = {
    fdc3Version: '2.2',
    provider: 'Morgan Stanley',
    optionalFeatures: { DesktopAgentBridging: true, OriginatingAppMetadata: true, UserChannelMembershipAPIs: true },
};

const helloMessage = {
    type: 'hello',
    payload: { authRequired: false, desktopAgentBridgeVersion: '1.0.0', supportedFDC3Versions: ['2.2'] },
    meta: { timestamp: new Date() },
};

describe(`BridgeConnection`, () => {
    let transport: FakeBridgeTransport;
    let onRemoteAgentDisconnected: ReturnType<typeof vi.fn>;
    let adoptChannelsState: ReturnType<typeof vi.fn>;
    let mockedHelpers: IMocked<typeof helpersImport>;

    function createInstance(overrides: Partial<BridgeConnectionParams> = {}): BridgeConnection {
        return new BridgeConnection({
            transport,
            requestedName: 'my-agent',
            getImplementationMetadata: () => Promise.resolve(implementationMetadata),
            getChannelsState: () => ({}),
            adoptChannelsState,
            onRemoteAgentDisconnected,
            ...overrides,
        });
    }

    beforeEach(() => {
        transport = new FakeBridgeTransport();
        onRemoteAgentDisconnected = vi.fn();
        adoptChannelsState = vi.fn();

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => mockedGeneratedUuid),
        );
        registerMock(helpersImport, mockedHelpers.mock);
    });

    it(`connect() should delegate to transport.connect()`, () => {
        const instance = createInstance();
        instance.connect();

        expect(transport.connectCallCount).toBe(1);
    });

    it(`should send exactly one handshake with no authToken key when authRequired is false`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive(helloMessage);
        await flush();

        expect(transport.sent).toHaveLength(1);
        expect(transport.sent[0]).toEqual({
            type: 'handshake',
            payload: {
                implementationMetadata,
                requestedName: 'my-agent',
                channelsState: {},
            },
            meta: { requestUuid: mockedGeneratedUuid, timestamp: expect.any(Date) },
        });
        expect(Object.keys((transport.sent[0] as any).payload)).not.toContain('authToken');
    });

    it(`should include authToken in the handshake payload when supplied`, async () => {
        const instance = createInstance({ authToken: 'jwt-token' });
        instance.connect();

        transport.receive(helloMessage);
        await flush();

        expect((transport.sent[0] as any).payload.authToken).toBe('jwt-token');
    });

    it(`should not send a handshake and should reset() when authRequired and the validator returns false`, async () => {
        const instance = createInstance({ validateBridgeAuthToken: () => false });
        instance.connect();

        transport.receive({ ...helloMessage, payload: { ...helloMessage.payload, authRequired: true } });
        await flush();

        expect(transport.sent).toHaveLength(0);
        expect(transport.resetCallCount).toBe(1);
    });

    it(`should send a handshake when authRequired and the validator returns true`, async () => {
        const instance = createInstance({ validateBridgeAuthToken: () => true });
        instance.connect();

        transport.receive({ ...helloMessage, payload: { ...helloMessage.payload, authRequired: true } });
        await flush();

        expect(transport.sent).toHaveLength(1);
    });

    it(`should still send a handshake when authRequired and no validator was configured`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive({ ...helloMessage, payload: { ...helloMessage.payload, authRequired: true } });
        await flush();

        expect(transport.sent).toHaveLength(1);
    });

    it(`should still send a handshake for an unsupported FDC3 version`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive({ ...helloMessage, payload: { ...helloMessage.payload, supportedFDC3Versions: ['1.2'] } });
        await flush();

        expect(transport.sent).toHaveLength(1);
    });

    it(`should adopt agentName and channelsState from a connectedAgentsUpdate matching the handshake requestUuid`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive(helloMessage);
        await flush();

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [{ desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' }],
                channelsState: { channel1: [{ type: 'fdc3.contact' }] },
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        expect(instance.agentName).toBe('agent-a');
        expect(adoptChannelsState).toHaveBeenCalledWith({ channel1: [{ type: 'fdc3.contact' }] });
    });

    it(`should not adopt addAgent from a later update with a different requestUuid (the PoC regression)`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive(helloMessage);
        await flush();

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [{ desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' }],
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-b',
                allAgents: [
                    { desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-b', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                ],
            },
            meta: { requestUuid: 'a-different-uuid', responseUuid: 'r2', timestamp: new Date() },
        });

        expect(instance.agentName).toBe('agent-a');
        expect(onRemoteAgentDisconnected).not.toHaveBeenCalled();
    });

    it(`should fire onRemoteAgentDisconnected when removeAgent is set`, async () => {
        const instance = createInstance();
        instance.connect();
        transport.receive(helloMessage);
        await flush();
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [
                    { desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-b', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                ],
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                removeAgent: 'agent-b',
                allAgents: [{ desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' }],
            },
            meta: { requestUuid: 'later-uuid', responseUuid: 'r2', timestamp: new Date() },
        });

        expect(onRemoteAgentDisconnected).toHaveBeenCalledWith('agent-b');
    });

    it(`should fire onRemoteAgentDisconnected for an agent vanishing from allAgents without removeAgent`, async () => {
        const instance = createInstance();
        instance.connect();
        transport.receive(helloMessage);
        await flush();
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [
                    { desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-b', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                ],
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                allAgents: [{ desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' }],
            },
            meta: { requestUuid: 'later-uuid', responseUuid: 'r2', timestamp: new Date() },
        });

        expect(onRemoteAgentDisconnected).toHaveBeenCalledWith('agent-b');
    });

    it(`should not include our own assigned name in the set of tracked remote agents`, async () => {
        const instance = createInstance();
        instance.connect();
        transport.receive(helloMessage);
        await flush();
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [{ desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' }],
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: { allAgents: [] },
            meta: { requestUuid: 'later-uuid', responseUuid: 'r2', timestamp: new Date() },
        });

        // agent-a is US, so it must never be reported as a departed remote agent
        expect(onRemoteAgentDisconnected).not.toHaveBeenCalled();
    });

    it(`should reset agentName and call transport.reset() on authenticationFailed`, async () => {
        const instance = createInstance();
        instance.connect();
        transport.receive(helloMessage);
        await flush();
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: { addAgent: 'agent-a', allAgents: [] },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.receive({
            type: 'authenticationFailed',
            payload: { message: 'bad token' },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r2', timestamp: new Date() },
        });

        expect(instance.agentName).toBeUndefined();
        expect(transport.resetCallCount).toBe(1);
    });

    it(`should notify departure of every known agent and clear agentName when the transport disconnects`, async () => {
        const instance = createInstance();
        instance.connect();
        transport.receive(helloMessage);
        await flush();
        transport.receive({
            type: 'connectedAgentsUpdate',
            payload: {
                addAgent: 'agent-a',
                allAgents: [
                    { desktopAgent: 'agent-a', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-b', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                    { desktopAgent: 'agent-c', fdc3Version: '2.2', optionalFeatures: {}, provider: 'MS' },
                ],
            },
            meta: { requestUuid: mockedGeneratedUuid, responseUuid: 'r1', timestamp: new Date() },
        });

        transport.setState('disconnected');

        expect(instance.agentName).toBeUndefined();
        expect(onRemoteAgentDisconnected).toHaveBeenCalledWith('agent-b');
        expect(onRemoteAgentDisconnected).toHaveBeenCalledWith('agent-c');
        expect(onRemoteAgentDisconnected).toHaveBeenCalledTimes(2);
    });

    it(`should ignore non-connection messages`, async () => {
        const instance = createInstance();
        instance.connect();

        transport.receive({
            type: 'findIntentRequest',
            payload: { intent: 'ViewChart' },
            meta: { requestUuid: 'r1', timestamp: new Date(), source: { desktopAgent: 'agent-b' } },
        });
        transport.receive({
            type: 'findIntentResponse',
            payload: { appIntent: { apps: [] } },
            meta: { requestUuid: 'r1', responseUuid: 'r2', timestamp: new Date() },
        });

        expect(transport.sent).toHaveLength(0);
    });

    it(`close() should unsubscribe so a later hello sends no handshake`, async () => {
        const instance = createInstance();
        instance.connect();
        instance.close();

        transport.receive(helloMessage);
        await flush();

        expect(transport.sent).toHaveLength(0);
    });
});

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
