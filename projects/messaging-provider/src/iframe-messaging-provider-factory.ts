/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { IProxyMessagingProvider } from '@morgan-stanley/fdc3-web';
import { IframeMessagingProvider } from './iframe-messaging-provider.js';

// There can only be one messaging provider per window
let singletonIframeWindowMessagingProvider: IframeMessagingProvider | null = null;

export async function iframeMessagingProviderFactory(): Promise<IProxyMessagingProvider> {
    if (singletonIframeWindowMessagingProvider === null) {
        singletonIframeWindowMessagingProvider = new IframeMessagingProvider();
    }

    await singletonIframeWindowMessagingProvider.initializeRelay();
    console.log(
        `Iframe messaging provider initialized with channelId: ${singletonIframeWindowMessagingProvider.channelId}`,
    );
    if (singletonIframeWindowMessagingProvider !== null) {
        return singletonIframeWindowMessagingProvider;
    } else {
        throw new Error('Failed to initialize relay');
    }
}
