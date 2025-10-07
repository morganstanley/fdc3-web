/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { any, IMocked, Mock, setupFunction, setupProperty } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it } from 'vitest';
import { IncomingMessageCallback, IProxyIncomingMessageEnvelope, IProxyOutgoingMessageEnvelope } from '../contracts.js';
import { DefaultProxyMessagingProvider } from './default-proxy-messaging-provider.js';

describe('DefaultProxyMessagingProvider', () => {
    let mockMessagePort: IMocked<MessagePort>;

    beforeEach(() => {
        mockMessagePort = Mock.create<MessagePort>().setup(
            setupFunction('start'),
            setupFunction('addEventListener'),
            setupFunction('postMessage'),
        );
    });

    function createInstance(): DefaultProxyMessagingProvider {
        return new DefaultProxyMessagingProvider(mockMessagePort.mock);
    }

    it(`should create`, () => {
        const instance = createInstance();
        expect(instance).toBeDefined();

        expect(mockMessagePort.withFunction('start')).wasCalledOnce();
    });

    it('should send a message', () => {
        const instance = createInstance();
        const message: IProxyOutgoingMessageEnvelope = {
            payload: {
                type: 'getInfoRequest',
                meta: { requestUuid: 'mockedRequestUuid', timestamp: new Date() },
                payload: {},
            },
        };

        instance.sendMessage(message);

        expect(mockMessagePort.withFunction('postMessage').withParametersEqualTo(message.payload)).wasCalledOnce();
    });

    it('should subscribe to messages from the message port', () => {
        const callbackOne = Mock.create<ProxyCallback>().setup(setupFunction('callback'));
        const callbackTwo = Mock.create<ProxyCallback>().setup(setupFunction('callback'));

        const instance = createInstance();

        expect(
            mockMessagePort.withFunction('addEventListener').withParametersEqualTo('message', any()),
        ).wasCalledOnce();

        instance.addResponseHandler(callbackOne.mock.callback);
        instance.addResponseHandler(callbackTwo.mock.callback);

        const eventListener = mockMessagePort.functionCallLookup.addEventListener?.[0][1] as any;

        const expectedMessage: IProxyIncomingMessageEnvelope = {
            payload: {
                meta: { requestUuid: '', responseUuid: '', timestamp: new Date() },
                payload: {},
                type: 'raiseIntentResponse',
            },
        };

        const event: MessageEvent = Mock.create<MessageEvent>().setup(
            setupProperty('data', expectedMessage.payload),
        ).mock;

        eventListener?.(event);

        expect(callbackOne.withFunction('callback').withParametersEqualTo(expectedMessage)).wasCalledOnce();
        expect(callbackTwo.withFunction('callback').withParametersEqualTo(expectedMessage)).wasCalledOnce();
    });
});

type ProxyCallback = {
    callback: IncomingMessageCallback<IProxyIncomingMessageEnvelope>;
};
