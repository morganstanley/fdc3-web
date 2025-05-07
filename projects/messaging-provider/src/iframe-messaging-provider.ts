/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { BrowserTypes } from '@finos/fdc3';
import {
    discoverProxyCandidates,
    generateHelloMessage,
    generateUUID,
    IProxyIncomingMessageEnvelope,
    IProxyMessagingProvider,
    IProxyOutgoingMessageEnvelope,
} from '@morgan-stanley/fdc3-web';

/**
 * Represents an iframe channel adaptor that allows communication between the main window and an iframe.
 */
export class IframeMessagingProvider implements IProxyMessagingProvider {
    private readonly iframe: HTMLIFrameElement;
    private readonly listeners = new Set<(message: IProxyIncomingMessageEnvelope) => void>();
    private relayConnected: boolean = false;
    private relayInitializeTimeout: any = null;
    private firstLoadIframe: boolean = true;
    private traceMessagingComms: boolean = true;
    public readonly channelId = generateUUID();

    constructor(
        private connectionTimeout: number = 5000,
        private readonly messageChannel: MessageChannel = new MessageChannel(),
        private documentRef: Document = document,
        private readonly consoleRef: Console = window.console,
        private readonly windowRef: Window = window,
    ) {
        this.iframe = this.documentRef.createElement('iframe');
        this.iframe.sandbox?.add('allow-same-origin');
        this.iframe.sandbox?.add('allow-scripts');
        this.iframe.style.display = 'none';

        this.documentRef.body.appendChild(this.iframe);

        if (this.traceMessagingComms) {
            this.consoleRef.log(`IFrameMessagingProvider created with channelId: ${this.channelId}`);
        }
    }

    /**
     * Initializes the relay by discovering and setting the source of the iframe to the URL of the desktop agent proxy.
     */
    public initializeRelay(): Promise<void> {
        return new Promise<void>(
            (resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) => {
                this.parentMessagingProviderHandshake(resolve, reject);
            },
        );
    }

    /**
     * Performs a handshake with the parent window to establish a connection and obtain the URL of the iframe.
     */
    private parentMessagingProviderHandshake(
        resolve: (value: void | PromiseLike<void>) => void,
        reject: (reason?: any) => void,
    ): void {
        const nonce = generateUUID();
        const messageListener = (event: MessageEvent): void => {
            if (event.data.type === 'ack' && event.data.nonce === nonce && event.data.url !== undefined) {
                this.traceMessagingComms = event.data.traceMessagingComms;
                // validate that event.data.url is a valid URL
                if (typeof event.data.url !== 'string' || !event.data.url.match(/^https?:\/\//)) {
                    this.consoleRef.error('Invalid URL received from parent window');
                    reject(`Invalid URL [${event.data.url}] received from parent window`);
                    return;
                }
                this.iframe.addEventListener('load', () => this.frameLoaded(resolve));
                this.iframe.addEventListener('error', (): any => {
                    this.shutdownRelay();
                    this.consoleRef.error(`Error loading FDC3 iframe relay at URL: ${event.data.url}`);
                    reject(`Error loading iframe`);
                });
                this.iframe.src = `${event.data.url}?channelId=${this.channelId}`;

                this.windowRef.removeEventListener('message', messageListener);

                this.initializeDesktopAgentProxyChildWindowListener(event.data.url);
            }
            if (event.data.type === 'ack' && event.data.nonce !== nonce) {
                this.consoleRef.error('Invalid nonce received from parent window');
            }
        };
        this.windowRef.addEventListener('message', messageListener);
        //check for all possible proxy windows
        const candidateProxyWindows = discoverProxyCandidates();

        if (this.traceMessagingComms) {
            this.consoleRef.log(
                `[HANDSHAKE] iframe > root. Hello message sent to ${candidateProxyWindows.length} ancestor windows`,
            );
        }

        candidateProxyWindows.forEach(proxyWindow =>
            proxyWindow.postMessage(
                {
                    type: 'hello',
                    nonce: nonce,
                },
                '*',
            ),
        );

        // If the relay does not connect within the timeout period, reject the Promise.
        this.relayInitializeTimeout = setTimeout(() => {
            if (!this.relayConnected) {
                reject('Relay handshake failed. Shutting down relay.');
                this.shutdownRelay();
            }
        }, this.connectionTimeout);
    }

    /**
     * Initializes the desktop agent proxy child window listener.
     * @param url the URL of the iframe to send to the desktop agent proxy.
     */
    private initializeDesktopAgentProxyChildWindowListener(url: string): void {
        const messageListener = (event: MessageEvent): any => {
            if (event.data.type === 'hello' && event.data.nonce !== undefined) {
                event.source?.postMessage(
                    {
                        type: 'ack',
                        nonce: event.data.nonce,
                        url,
                        traceMessagingComms: this.traceMessagingComms,
                    },
                    {
                        targetOrigin: event.origin,
                    },
                );
            }
        };
        this.windowRef.addEventListener('message', messageListener);
    }

    /**
     * Handles the load event of the iframe.
     */
    private frameLoaded(resolve: (value: void | PromiseLike<void>) => void): void {
        if (!this.firstLoadIframe) {
            // This is required for the case that the relay is shutdown due to a connection timeout
            return;
        }
        this.iframe.contentWindow?.postMessage('message-port', '*', [this.messageChannel.port2]);

        this.messageChannel.port1.start();
        this.messageChannel.port1.onmessage = (...args) => {
            this.onMessage.call(this, ...args, resolve);
        };
        const helloMessage = generateHelloMessage();
        this.messageChannel.port1.postMessage(helloMessage);

        this.firstLoadIframe = false;
    }

    /**
     * Handles messages received from the iframe channel adapter.
     */
    private onMessage(event: MessageEvent, resolve: (value: void | PromiseLike<void>) => void): void {
        if (event.data.type === 'WCP3Handshake') {
            if (this.relayInitializeTimeout) {
                clearTimeout(this.relayInitializeTimeout);
            }
            this.relayConnected = true;
            this.consoleRef.log(
                `Relay connected to iframe with implementation details: ${(<BrowserTypes.WebConnectionProtocol3Handshake>event.data).payload.fdc3Version}`,
            );
            resolve();
        } else {
            if (this.traceMessagingComms) {
                this.consoleRef.log(`[MESSAGE] iframe relay > proxy agent: ${JSON.stringify(event.data, null, 2)}`);
            }
            this.listeners.forEach(callback => {
                callback({ payload: event.data });
            });
        }
    }

    /**
     * Shuts down the relay by clearing the source of the iframe.
     */
    public shutdownRelay(): void {
        this.iframe.src = '';
        this.messageChannel.port1.close();
        this.messageChannel.port1.onmessage = null;
        this.relayConnected = false;
    }

    /**
     * Publishes a message by sending it to the iframe's content window.
     * @param message The message to be published.
     */
    public sendMessage(message: IProxyOutgoingMessageEnvelope): void {
        if (this.relayConnected) {
            this.messageChannel.port1.postMessage(message.payload);
        } else {
            this.consoleRef.error('Relay not connected. Cannot publish message.');
        }
    }

    /**
     * Subscribes to messages received from the iframe channel adapter.
     * @param callback The callback function to be invoked when a message is received.
     */
    public addResponseHandler(callback: (message: IProxyIncomingMessageEnvelope) => void): void {
        this.listeners.add(callback);
    }

    /**
     * Unsubscribes a callback function from receiving messages.
     * @param callback - The callback function to unsubscribe.
     */
    public unsubscribe(callback: (message: IProxyIncomingMessageEnvelope) => void): void {
        this.listeners.delete(callback);
    }
}
