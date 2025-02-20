/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { RootWindowMessagingProvider } from './root-window-messaging-provider';
import { rootWindowMessagingProviderFactory } from './root-window-messaging-provider-factory';

describe('rootWindowMessagingProviderFactory', () => {
    beforeAll(() => {
        function channelMock() {}
        channelMock.prototype = {
            name: null,
            onmessage: null,
        };
        channelMock.prototype.postMessage = function (data: any) {
            this.onmessage({ data });
        };
        (window as any).BroadcastChannel = channelMock;
    });

    it('should return an instance of RootWindowMessagingProvider with the correct appIdentifier', async () => {
        // Act
        const provider = await rootWindowMessagingProviderFactory();

        // Assert
        expect(provider).toBeInstanceOf(RootWindowMessagingProvider);
    });

    it('should return the same instance of RootWindowMessagingProvider when called multiple times with the same appIdentifier', async () => {
        // Act
        const provider1 = await rootWindowMessagingProviderFactory();
        const provider2 = await rootWindowMessagingProviderFactory();

        // Assert
        expect(provider1).toBe(provider2);
    });
});
