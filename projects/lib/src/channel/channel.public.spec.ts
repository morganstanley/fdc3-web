/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes, Channel, Contact, Context, ContextHandler, Listener } from '@finos/fdc3';
import { ChannelError } from '@finos/fdc3';
import { IMocked, Mock, proxyModule, registerMock, setupFunction, toBe } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EventMessage,
    FullyQualifiedAppIdentifier,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
    Message,
    ResponseMessage,
} from '../contracts.js';
import { isBroadcastRequest } from '../helpers/index.js';
import * as helpersImport from '../helpers/index.js';
import { ContextListener } from './channel.contracts.js';
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
const mockedResponseUuid = `mocked-response-uuid`;

// We test both PublicChannel and PrivateChannelImpl in here as one extends the other and most implementation is the same
const testPrivate = [false, true];

testPrivate.forEach(isPrivateImpl => {
    const suiteDescription = isPrivateImpl
        ? `${PrivateChannel.name} (channel.private)`
        : `${PublicChannel.name} (channel.public)`;

    describe(suiteDescription, () => {
        let mockMessagingProvider: IMocked<IProxyMessagingProvider>;
        let mockedHelpers: IMocked<typeof helpersImport>;
        let mockContextListener: IMocked<ContextListener>;

        let appIdentifier: FullyQualifiedAppIdentifier;

        let sendMessageCallbacks: ((message: IProxyOutgoingMessageEnvelope) => void)[];
        let currentDate: Date;
        let contact: Contact;

        beforeEach(() => {
            sendMessageCallbacks = [];
            currentDate = new Date(2024, 1, 0, 0, 0, 0);
            appIdentifier = { appId: mockedAppId, instanceId: mockedInstanceId };

            mockMessagingProvider = Mock.create<IProxyMessagingProvider>().setup(
                setupFunction('sendMessage', message => sendMessageCallbacks.forEach(callback => callback(message))),
                setupFunction('addResponseHandler'),
            );

            mockContextListener = Mock.create<ContextListener>();

            mockedHelpers = Mock.create<typeof helpersImport>().setup(
                setupFunction('generateUUID', () => mockedRequestUuid),
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

            contact = {
                type: 'fdc3.contact',
                name: 'Joe Bloggs',
                id: {
                    username: 'jo_bloggs',
                    phone: '079712345678',
                },
            };
        });

        async function createInstance(channel?: BrowserTypes.Channel): Promise<Channel> {
            channel = channel ?? { id: mockedChannelId, type: isPrivateImpl ? 'private' : 'user' };

            let instance: Channel;

            if (isPrivateImpl) {
                instance = new PrivateChannel(
                    channel,
                    appIdentifier,
                    mockMessagingProvider.mock,
                    mockContextListener.mock,
                );
            } else {
                instance = new PublicChannel(
                    channel,
                    appIdentifier,
                    mockMessagingProvider.mock,
                    mockContextListener.mock,
                );
            }

            await wait();

            return instance;
        }

        it(`should create`, async () => {
            const instance = await createInstance();
            expect(instance).toBeInstanceOf(PublicChannel);
        });

        if (isPrivateImpl) {
            it(`should be created by factory`, () => {
                const instance = new ChannelFactory().createPrivateChannel(
                    { id: mockedChannelId, type: 'private' },
                    appIdentifier,
                    mockMessagingProvider.mock,
                );

                expect(instance).toBeInstanceOf(PrivateChannel);
            });
        } else {
            it(`should be created by factory`, () => {
                const instance = new ChannelFactory().createPublicChannel(
                    { id: mockedChannelId, type: 'user' },
                    appIdentifier,
                    mockMessagingProvider.mock,
                );

                expect(instance).toBeInstanceOf(PublicChannel);
            });
        }

        // https://fdc3.finos.org/docs/api/ref/Channel#getcurrentcontext
        describe('getCurrentContext', () => {
            it(`should return promise from contextListener`, async () => {
                const context: Context = { type: 'mockedContextListenerContext' };

                mockContextListener.setupFunction('getCurrentContext', () => Promise.resolve(context));

                const instance = await createInstance();

                await expect(instance.getCurrentContext('customContext')).resolves.toBe(context);
                expect(
                    mockContextListener.withFunction('getCurrentContext').withParameters('customContext'),
                ).wasCalledOnce();
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#broadcast
        describe('broadcast', () => {
            it('should publish context to other apps on desktop in user channel app is joined to', async () => {
                const instance = await createInstance();

                instance.broadcast(contact);

                const expectedMessage: BrowserTypes.BroadcastRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        channelId: mockedChannelId,
                        context: contact,
                    },
                    type: 'broadcastRequest',
                };

                await wait();

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should resolve the returned promise when the corresponding response message is received from the root agent', async () => {
                const instance = await createInstance();

                let error: Error | undefined;

                const requestMessagePromise = awaitMessage(isBroadcastRequest);
                const responsePromise = instance.broadcast(contact).catch(err => (error = err));

                const responseMessage: BrowserTypes.BroadcastResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'broadcastResponse',
                };

                await requestMessagePromise;
                postMessage(responseMessage);

                const result = await responsePromise;

                expect(error).toBeUndefined();
                expect(result).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided', async () => {
                const instance = await createInstance();

                let error: Error | undefined;

                const requestMessagePromise = awaitMessage(isBroadcastRequest);
                const responsePromise = instance.broadcast(contact).catch(err => (error = err));

                const responseMessage: BrowserTypes.BroadcastResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ChannelError.MalformedContext,
                    },
                    type: 'broadcastResponse',
                };

                await requestMessagePromise;

                postMessage(responseMessage);

                await responsePromise;

                expect(error).toEqual(ChannelError.MalformedContext);
            });

            it('should publish context to other apps on desktop in channel calling function', async () => {
                const instance = await createInstance();

                const expectedMessage: BrowserTypes.BroadcastRequest = {
                    meta: createExpectedRequestMeta(),
                    payload: {
                        channelId: mockedChannelId,
                        context: contact,
                    },
                    type: 'broadcastRequest',
                };

                const requestPromise = awaitMessage(isBroadcastRequest);

                instance.broadcast(contact);

                await requestPromise;

                expect(
                    mockMessagingProvider
                        .withFunction('sendMessage')
                        .withParametersEqualTo({ payload: expectedMessage }),
                ).wasCalledOnce();
            });

            it('should resolve the returned promise when called by channel and the corresponding response message is received from the root agent', async () => {
                const instance = await createInstance();

                let error: Error | undefined;

                const responseMessage: BrowserTypes.BroadcastResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {},
                    type: 'broadcastResponse',
                };

                const requestPromise = awaitMessage(isBroadcastRequest);
                const responsePromise = instance.broadcast(contact).catch(err => (error = err));

                await requestPromise;

                postMessage(responseMessage);

                await responsePromise;

                expect(error).toBeUndefined();
            });

            it('should reject promise with same error message returned in response if one is provided when called by channel', async () => {
                const instance = await createInstance();

                let error: Error | undefined;

                const responseMessage: BrowserTypes.BroadcastResponse = {
                    meta: {
                        requestUuid: mockedRequestUuid,
                        timestamp: currentDate,
                        responseUuid: mockedResponseUuid,
                    },
                    payload: {
                        error: ChannelError.MalformedContext,
                    },
                    type: 'broadcastResponse',
                };

                const requestPromise = awaitMessage(isBroadcastRequest);
                const responsePromise = instance.broadcast(contact).catch(err => (error = err));

                await requestPromise;
                postMessage(responseMessage);

                await responsePromise;

                expect(error).toEqual(ChannelError.MalformedContext);
            });
        });

        //https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener
        describe('addContextListener', () => {
            let mockHandler: IMocked<{ handler: ContextHandler }>;

            beforeEach(() => {
                mockHandler = Mock.create<{ handler: ContextHandler }>().setup(setupFunction('handler'));
            });

            it(`should return promise from contextListener`, async () => {
                const listener: Listener = Mock.create<Listener>().mock;

                mockContextListener.setupFunction('addContextListener', () => Promise.resolve(listener));

                const instance = await createInstance();

                await expect(instance.addContextListener('fdc3.contact', mockHandler.mock.handler)).resolves.toBe(
                    listener,
                );
                expect(
                    (mockContextListener as IMocked<any>)
                        .withFunction('addContextListener')
                        .withParameters('fdc3.contact', toBe(mockHandler.mock.handler)),
                ).wasCalledOnce();
            });
        });

        /**
         * pushes a message to any subscribers of the Mock messaging provider
         */
        function postMessage(message: ResponseMessage | EventMessage): void {
            mockMessagingProvider.functionCallLookup.addResponseHandler?.forEach(params =>
                params[0]({ payload: message }),
            );
        }

        function createExpectedRequestMeta(): BrowserTypes.AddContextListenerRequestMeta {
            return {
                requestUuid: mockedRequestUuid,
                timestamp: currentDate,
                source: appIdentifier,
            };
        }

        function awaitMessage<T extends Message>(predicate: (message: Message) => message is T): Promise<T> {
            return new Promise(resolve => {
                sendMessageCallbacks.push(envelope => {
                    const message = envelope.payload;
                    if (predicate(message)) {
                        resolve(message);
                    }
                });
            });
        }
    });
});

async function wait(delay: number = 50): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
}
