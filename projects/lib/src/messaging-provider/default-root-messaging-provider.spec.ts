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
import {
    any,
    IMocked,
    Mock,
    proxyJestModule,
    registerMock,
    setupFunction,
    setupProperty,
} from '@morgan-stanley/ts-mocking-bird';
import { IncomingMessageCallback, IRootIncomingMessageEnvelope, IRootOutgoingMessageEnvelope } from '../contracts';
import * as helpersImport from '../helpers';
import { DefaultRootMessagingProvider } from './default-root-messaging-provider';

jest.mock('../helpers', () => proxyJestModule(require.resolve('../helpers')));

const mockedDate = new Date(2024, 1, 0, 0, 0, 0);
const mockedGeneratedUuid = `mocked-generated-Uuid`;

const helloMessage: BrowserTypes.WebConnectionProtocol1Hello = {
    meta: {
        connectionAttemptUuid: mockedGeneratedUuid,
        timestamp: mockedDate,
    },
    payload: {
        actualUrl: '',
        fdc3Version: '1.0',
        identityUrl: '',
    },
    type: 'WCP1Hello',
};

const handshakeResponseMessage: BrowserTypes.WebConnectionProtocol3Handshake = {
    meta: {
        connectionAttemptUuid: mockedGeneratedUuid,
        timestamp: mockedDate,
    },
    payload: {
        fdc3Version: '1.0',
        channelSelectorUrl: false,
        intentResolverUrl: false,
    },
    type: 'WCP3Handshake',
};

describe('DefaultRootMessagingProvider', () => {
    let uuidResult = mockedGeneratedUuid;
    let mockRootWindow: IMocked<WindowProxy>;
    let mockProxyWindow: IMocked<WindowProxy>;
    let mockMessageChannel: IMocked<MessageChannel>;
    let mockMessagePortOne: IMocked<MessagePort>;
    let mockMessagePortTwo: IMocked<MessagePort>;
    let mockedHelpers: IMocked<typeof helpersImport>;

    beforeEach(() => {
        mockRootWindow = Mock.create<WindowProxy>().setup(setupFunction('addEventListener'));
        mockProxyWindow = Mock.create<WindowProxy>().setup(setupFunction('postMessage'));

        createMockMessageChannel();

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => uuidResult),
            setupFunction('getTimestamp', () => mockedDate),
            setupFunction('generateHandshakeResponseMessage', () => handshakeResponseMessage),
        );

        registerMock(helpersImport, mockedHelpers.mock);
    });

    function createInstance(): DefaultRootMessagingProvider {
        return new DefaultRootMessagingProvider(mockRootWindow.mock, () => mockMessageChannel.mock);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();
    });

    it('should respond to hello messages from windowRef and create new message channels', () => {
        createInstance();

        expect(mockRootWindow.withFunction('addEventListener').withParametersEqualTo('message', any())).wasCalledOnce();

        dispatchHelloMessage();

        expect(mockMessagePortOne.withFunction('start')).wasCalledOnce();

        expect(
            mockProxyWindow.withFunction('postMessage').withParametersEqualTo(handshakeResponseMessage, {
                targetOrigin: '*',
                transfer: [mockMessagePortTwo.mock],
            }),
        ).wasCalledOnce();
    });

    it(`should subscribe to messages on message ports and forward them to registered callback`, () => {
        const callbackOne = Mock.create<RootCallback>().setup(setupFunction('callback'));
        const callbackTwo = Mock.create<RootCallback>().setup(setupFunction('callback'));

        const instance = createInstance();

        dispatchHelloMessage();

        expect(
            mockMessagePortOne.withFunction('addEventListener').withParametersEqualTo('message', any()),
        ).wasCalledOnce();

        instance.subscribe(callbackOne.mock.callback);
        instance.subscribe(callbackTwo.mock.callback);

        const expectedMessage: IRootIncomingMessageEnvelope = {
            payload: {
                meta: { requestUuid: 'mockedRequestUuid', timestamp: mockedDate },
                payload: {},
                type: 'getInfoRequest',
            },
            channelId: mockedGeneratedUuid,
        };

        (
            mockMessagePortOne.functionCallLookup.addEventListener?.[0][1] as unknown as ({
                data,
            }: {
                data: any;
            }) => void
        )({ data: expectedMessage.payload });

        expect(callbackOne.withFunction('callback').withParametersEqualTo(expectedMessage)).wasCalledOnce();
        expect(callbackTwo.withFunction('callback').withParametersEqualTo(expectedMessage)).wasCalledOnce();
    });

    it('should publish message to the corresponding message channel', () => {
        const instance = createInstance();

        dispatchHelloMessage();

        const outgoingMessage: IRootOutgoingMessageEnvelope = {
            payload: {
                meta: { requestUuid: 'mockedRequestUuid', responseUuid: 'mockedResponseUuid', timestamp: mockedDate },
                payload: {},
                type: 'raiseIntentResponse',
            },
            channelIds: [mockedGeneratedUuid],
        };

        instance.publish(outgoingMessage);

        expect(
            mockMessagePortOne.withFunction('postMessage').withParametersEqualTo(outgoingMessage.payload),
        ).wasCalledOnce();
    });

    it('should publish message to multiple corresponding message channels', () => {
        const instance = createInstance();

        // setup a few channels
        uuidResult = 'channelOne';
        const messagePortOne = createMockMessageChannel().portOne;
        dispatchHelloMessage();

        uuidResult = 'channelTwo';
        const messagePortTwo = createMockMessageChannel().portOne;
        dispatchHelloMessage();

        uuidResult = 'channelThree';
        const messagePortThree = createMockMessageChannel().portOne;
        dispatchHelloMessage();

        const outgoingMessage: IRootOutgoingMessageEnvelope = {
            payload: {
                meta: { requestUuid: 'mockedRequestUuid', responseUuid: 'mockedResponseUuid', timestamp: mockedDate },
                payload: {},
                type: 'raiseIntentResponse',
            },
            channelIds: ['channelOne', 'channelTwo', 'unknownChannel'],
        };

        instance.publish(outgoingMessage);

        expect(
            messagePortOne.withFunction('postMessage').withParametersEqualTo(outgoingMessage.payload),
        ).wasCalledOnce();
        expect(
            messagePortTwo.withFunction('postMessage').withParametersEqualTo(outgoingMessage.payload),
        ).wasCalledOnce();
        expect(messagePortThree.withFunction('postMessage')).wasNotCalled();
    });

    function dispatchHelloMessage() {
        (
            mockRootWindow.functionCallLookup.addEventListener?.[0][1] as unknown as ({
                data,
                source,
            }: {
                data: any;
                source: any;
            }) => void
        )({
            data: helloMessage,
            source: mockProxyWindow.mock,
        });
    }

    function createMockMessageChannel(): {
        channel: IMocked<MessageChannel>;
        portOne: IMocked<MessagePort>;
        portTwo: IMocked<MessagePort>;
    } {
        const portOne = Mock.create<MessagePort>().setup(
            setupFunction('start'),
            setupFunction('postMessage'),
            setupFunction('addEventListener'),
        );
        const portTwo = Mock.create<MessagePort>().setup(
            setupFunction('start'),
            setupFunction('postMessage'),
            setupFunction('addEventListener'),
        );

        const channel = Mock.create<MessageChannel>().setup(
            setupProperty('port1', portOne.mock),
            setupProperty('port2', portTwo.mock),
        );

        mockMessagePortOne = portOne;
        mockMessagePortTwo = portTwo;
        mockMessageChannel = channel;

        return { channel, portOne, portTwo };
    }
});

type RootCallback = {
    callback: IncomingMessageCallback<IRootIncomingMessageEnvelope>;
};
