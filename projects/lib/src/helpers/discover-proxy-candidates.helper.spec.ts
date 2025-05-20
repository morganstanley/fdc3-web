/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { Mock } from '@morgan-stanley/ts-mocking-bird';
import { describe, expect, it } from 'vitest';
import { discoverProxyCandidates } from './discover-proxy-candidates.helper.js';

describe('discoverProxyCandidates', () => {
    it('should return the window opener when windowRef has an opener', () => {
        const mockOpener = createMockWindow();
        const mockWindow = createMockWindow(undefined, mockOpener);

        const result = discoverProxyCandidates(mockWindow);
        expect(result).toEqual([mockOpener]);
    });

    it('should return the window  parent when windowRef has a parent', () => {
        const mockParent = createMockWindow();
        const mockWindow = createMockWindow(mockParent);

        const result = discoverProxyCandidates(mockWindow);
        expect(result).toEqual([mockParent]);
    });

    it('should return the window opener and its parent when windowRef has both', () => {
        const mockOpener = createMockWindow();
        const mockParent = createMockWindow();
        const mockWindow = createMockWindow(mockParent, mockOpener);

        const result = discoverProxyCandidates(mockWindow);
        expect(result).toEqual([mockOpener, mockParent]);
    });

    function createMockWindow(parent?: WindowProxy, opener?: WindowProxy): WindowProxy {
        const mockWindow = Mock.create<WindowProxy>();

        mockWindow.setupProperty('parent', parent ?? mockWindow.mock);

        if (opener != null) {
            mockWindow.setupProperty('opener', opener);
        }

        return mockWindow.mock;
    }
});
