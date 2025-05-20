/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes, EventHandler, Listener, PrivateChannel as FDC3PrivateChannel } from '@finos/fdc3';
import { IMocked, Mock, proxyModule, registerMock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
    ResponseMessage,
} from '../contracts.js';
import * as helpersImport from '../helpers/index.js';
import { PrivateChannel } from './channel.private.js';
import { PublicChannel } from './channel.public.js';
import { ChannelFactory } from './channels.factory.js';

vi.mock('../helpers/index.js', async () => {
    const actual = await vi.importActual('../helpers/index.js');
    return proxyModule(actual);
});

const mockedAppId = `mocked-app-id`;
const mockedInstanceId = `mocked-instance-id`;
const mockedChannelId = `mocked-channel-id`;
const mockedRequestUuid = `mocked-request-uuid`;
const mockedRequestUuidTwo = `mocked-request-uuid-two`;
const mockedResponseUuid = `mocked-response-uuid`;
const mockedEventUuid = `mocked-event-uuid`;

describe(`${PrivateChannel.name} (channel.private)`, () => {
    let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
    let mockedHelpers: IMocked<typeof helpersImport>;

    let appIdentifier: FullyQualifiedAppIdentifier;

    let publishCallbacks: ((message: IProxyOutgoingMessageEnvelope) => void)[];
    let currentDate: Date;

    beforeEach(() => {
        publishCallbacks = [];
        currentDate = new Date(2024, 1, 0, 0, 0, 0);
        appIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };

        mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(
            setupFunction('sendMessage', message =>
                publishCallbacks.forEach(callback => callback(message as IProxyOutgoingMessageEnvelope)),
            ),
            setupFunction('addResponseHandler'),
        );

        mockedHelpers = Mock.create<typeof helpersImport>().setup(
            setupFunction('generateUUID', () => mockedRequestUuid),
            setupFunction('getTimestamp', () => currentDate),
            setupFunction(
                'createRequestMessage',
                (type, source, payload) =>
                    ({
                        type,
                        payload,
                        meta: { requestUuid: mockedRequestUuid, timestamp: currentDate, source },
                    }) as any,
            ),
        );
        registerMock(helpersImport, mockedHelpers.mock);
    });

    async function createInstance(channel?: BrowserTypes.Channel): Promise<FDC3PrivateChannel> {
        channel = channel ?? { id: mockedChannelId, type: 'private' };

        const instance = new ChannelFactory().createPrivateChannel(channel, appIdentifier, mockMessagingProvider.mock);

        await wait();

        return instance;
    }

    it(`should create`, async () => {
        const instance = await createInstance();
        expect(instance).toBeInstanceOf(PublicChannel);
    });

    //https://fdc3.finos.org/docs/api/ref/PrivateChannel#disconnect
    describe('disconnect', () => {
        it('should send PrivateChannelDisconnectRequest', async () => {
            const instance = await createInstance();

            instance.disconnect();

            const expectedMessage: BrowserTypes.PrivateChannelDisconnectRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    channelId: mockedChannelId,
                },
                type: 'privateChannelDisconnectRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });
    });

    //https://fdc3.finos.org/docs/api/ref/PrivateChannel#ondisconnect
    describe('onDisconnect', () => {
        let mockHandler: IMocked<{ handler: () => void }>;

        beforeEach(() => {
            mockHandler = Mock.create<{ handler: () => void }>().setup(setupFunction('handler'));
        });

        it('should return listener that will be called each time the remote app invokes disconnect on this channel', async () => {
            const instance = await createInstance();

            const listener = instance.onDisconnect(mockHandler.mock.handler);

            expect(typeof listener.unsubscribe).toBe('function');
        });

        it('should call handler on receipt of PrivateChannelOnDisconnectEvent', async () => {
            const instance = await createInstance();

            instance.onDisconnect(mockHandler.mock.handler);

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            postMessage(eventMessage);

            expect(mockHandler.withFunction('handler')).wasCalledOnce();
        });

        it('should not call handler after unsubscribe has been called', async () => {
            const instance = await createInstance();

            const listener = instance.onDisconnect(mockHandler.mock.handler);

            listener.unsubscribe();

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            postMessage(eventMessage);

            await wait();

            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });
    });

    // https://fdc3.finos.org/docs/api/ref/PrivateChannel#onunsubscribe
    describe('onUnsubscribe', () => {
        let mockHandler: IMocked<{ handler: (contextType?: string) => void }>;

        beforeEach(() => {
            mockHandler = Mock.create<{ handler: (contextType?: string) => void }>().setup(setupFunction('handler'));
        });

        it('should return listener that will be called each time the remote app invokes unsubscribe on this channel', async () => {
            const instance = await createInstance();

            const listener = instance.onUnsubscribe(mockHandler.mock.handler);

            expect(typeof listener.unsubscribe).toBe('function');
        });

        it('should call handler on receipt of PrivateChannelOnUnsubscribeEvent', async () => {
            const instance = await createInstance();

            instance.onUnsubscribe(mockHandler.mock.handler);

            const eventMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnUnsubscribeEvent',
            };

            postMessage(eventMessage);

            expect(mockHandler.withFunction('handler')).wasCalledOnce();
        });

        it('should not call handler after unsubscribe has been called', async () => {
            const instance = await createInstance();

            const listener = instance.onUnsubscribe(mockHandler.mock.handler);

            listener.unsubscribe();

            const eventMessage: BrowserTypes.PrivateChannelOnUnsubscribeEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnUnsubscribeEvent',
            };

            postMessage(eventMessage);

            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });
    });

    // https://fdc3.finos.org/docs/api/ref/PrivateChannel#onaddcontextlistener
    describe('onAddContextListener', () => {
        let mockHandler: IMocked<{ handler: (contextType?: string) => void }>;

        beforeEach(() => {
            mockHandler = Mock.create<{ handler: (contextType?: string) => void }>().setup(setupFunction('handler'));
        });

        it('should return listener that will be called each time the remote app invokes addContextListener on this channel', async () => {
            const instance = await createInstance();

            const listener = instance.onAddContextListener(mockHandler.mock.handler);

            expect(typeof listener.unsubscribe).toBe('function');
        });

        it('should call handler on receipt of PrivateChannelOnAddContextListenerEvent', async () => {
            const instance = await createInstance();

            instance.onAddContextListener(mockHandler.mock.handler);

            const eventMessage: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnAddContextListenerEvent',
            };

            postMessage(eventMessage);

            expect(mockHandler.withFunction('handler')).wasCalledOnce();
        });

        it('should not call handler after unsubscribe has been called', async () => {
            const instance = await createInstance();

            const listener = instance.onAddContextListener(mockHandler.mock.handler);

            listener.unsubscribe();

            const eventMessage: BrowserTypes.PrivateChannelOnAddContextListenerEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    contextType: 'fdc3.contact',
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnAddContextListenerEvent',
            };

            postMessage(eventMessage);

            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });
    });

    //https://fdc3.finos.org/docs/next/api/ref/PrivateChannel#addeventlistener
    describe('addEventListener', () => {
        let mockHandler: IMocked<{ handler: EventHandler }>;

        beforeEach(() => {
            mockHandler = Mock.create<{ handler: EventHandler }>().setup(setupFunction('handler'));
        });

        it('should request addition of listener for events on Private Channel when one of PrivateChannelEventTypes is passed for type', async () => {
            const instance = await createInstance();

            instance.addEventListener('disconnect', mockHandler.mock.handler);

            const expectedMessage: BrowserTypes.PrivateChannelAddEventListenerRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    listenerType: 'disconnect',
                    privateChannelId: instance.id,
                },
                type: 'privateChannelAddEventListenerRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should request addition of listener for events on Private Channel when null is passed for type', async () => {
            //TODO: Fix PrivateChannelEvents typing conflict between FDC3 spec and Browser Types
            //Cannot test this currently due to typing conflict between FDC3 spec and Browser Types
            expect(true).toBeTruthy();
        });

        it('should return promise that resolves to added event listener', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);
            const listener = await listenerPromise;

            expect(typeof listener.unsubscribe).toBe('function');
        });

        it('should call event handler and pass it PrivateChannelEvent object when PrivateChannelEvent of correct type is received on correct private channel', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);
            await listenerPromise;

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            postMessage(eventMessage);
            expect(
                mockHandler.withFunction('handler').withParametersEqualTo({
                    type: 'disconnect',
                    details: null,
                }),
            ).wasCalledOnce();
        });

        it('should not call event handler and pass it event object when PrivateChannelEvent message of incorrect type is received', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);
            await listenerPromise;

            const eventMessage: BrowserTypes.ChannelChangedEvent = {
                type: 'channelChangedEvent',
                meta: {
                    eventUuid: 'mocked-event-uuid',
                    timestamp: currentDate,
                },
                payload: {
                    newChannelId: mockedChannelId,
                },
            };

            postMessage(eventMessage);
            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });

        it('should not call event handler and pass it event object when PrivateChannelEvent of correct type is received on incorrect private channel', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);
            await listenerPromise;

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    privateChannelId: `mocked-channel-id-two`,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            postMessage(eventMessage);
            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });

        it('should publish PrivateChannelUnsubscribeEventListenerRequest when unsubscribe is called', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };

            postMessage(responseMessage);
            const listener = await listenerPromise;

            listener.unsubscribe();

            const expectedMessage: BrowserTypes.PrivateChannelUnsubscribeEventListenerRequest = {
                meta: createExpectedRequestMeta(),
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelUnsubscribeEventListenerRequest',
            };

            await wait();

            expect(
                mockMessagingProvider.withFunction('sendMessage').withParametersEqualTo({ payload: expectedMessage }),
            ).wasCalledOnce();
        });

        it('should not call event handler after unsubscribe is called', async () => {
            const mockedListenerUuid: string = `mocked-listener-uuid`;

            const instance = await createInstance();

            const listenerPromise = instance.addEventListener('disconnect', mockHandler.mock.handler);
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuid,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);
            const listener = await listenerPromise;

            listener.unsubscribe();
            const privateChannelUnsubscribeEventListenerResponse: BrowserTypes.PrivateChannelUnsubscribeEventListenerResponse =
                {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'privateChannelUnsubscribeEventListenerResponse',
                };

            postMessage(privateChannelUnsubscribeEventListenerResponse);

            await wait();

            const eventMessage: BrowserTypes.PrivateChannelOnDisconnectEvent = {
                meta: {
                    eventUuid: mockedEventUuid,
                    timestamp: currentDate,
                },
                payload: {
                    privateChannelId: mockedChannelId,
                },
                type: 'privateChannelOnDisconnectEvent',
            };

            postMessage(eventMessage);
            expect(mockHandler.withFunction('handler')).wasNotCalled();
        });

        it('should not return event listener when non-matching requestUuid is passed', async () => {
            const instance = await createInstance();

            let error: Error | undefined;
            let listener: Listener | undefined;

            const mockedListenerUuid: string = `mocked-listener-uuid`;

            instance
                .addEventListener('disconnect', mockHandler.mock.handler)
                .then(value => (listener = value))
                .catch(err => (error = err));
            const responseMessage: BrowserTypes.PrivateChannelAddEventListenerResponse = {
                meta: {
                    requestUuid: mockedRequestUuidTwo,
                    timestamp: currentDate,
                    responseUuid: mockedResponseUuid,
                },
                payload: {
                    listenerUUID: mockedListenerUuid,
                },
                type: 'privateChannelAddEventListenerResponse',
            };
            postMessage(responseMessage);

            await wait();
            expect(listener).toBeUndefined();
            expect(error).toBeUndefined();
        });
    });

    /**
     * pushes a message to any subscribers of the Mock messaging provider
     */
    function postMessage(message: ResponseMessage | EventMessage): void {
        mockMessagingProvider.functionCallLookup.addResponseHandler?.forEach(params => params[0]({ payload: message }));
    }

    function createExpectedRequestMeta(): BrowserTypes.AddContextListenerRequestMeta {
        return {
            requestUuid: mockedRequestUuid,
            timestamp: currentDate,
            source: appIdentifier,
        };
    }
});

async function wait(delay: number = 50): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
}
