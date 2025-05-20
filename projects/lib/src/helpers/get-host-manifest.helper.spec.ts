/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationHostManifests } from '../app-directory.contracts.js';
import { getHostManifest } from './get-host-manifest.helper.js';

describe('getHostManifest', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('should return undefined when manifestKey is null', async () => {
        const result = await getHostManifest({}, null as any); // trick type system into letting us test null
        expect(result).toBeUndefined();
    });

    it('should return undefined when manifestKey is undefined', async () => {
        const result = await getHostManifest({});
        expect(result).toBeUndefined();
    });

    it('should return the manifest object when manifest is an object', async () => {
        const manifests: ApplicationHostManifests = {
            testKey: { prop: 'value' },
        };
        const result = await getHostManifest(manifests, 'testKey');
        expect(result).toEqual({ prop: 'value' });
    });

    it('should return null when manifest is null', async () => {
        const manifests: ApplicationHostManifests = {
            testKey: null as any,
        };
        const result = await getHostManifest(manifests, 'testKey');
        expect(result).toBeNull();
    });

    it('should fetch manifest when manifest is a string URL', async () => {
        const mockManifest = { prop: 'fetched value' };
        const mockResponse = {
            json: vi.fn().mockResolvedValue(mockManifest),
        };
        (global.fetch as any).mockResolvedValue(mockResponse);

        const manifests: ApplicationHostManifests = {
            testKey: 'https://example.com/manifest.json',
        };

        const result = await getHostManifest(manifests, 'testKey');

        expect(global.fetch).toHaveBeenCalledWith('https://example.com/manifest.json');
        expect(result).toEqual(mockManifest);
    });

    it('should throw an error when fetch fails', async () => {
        (global.fetch as any).mockRejectedValue(new Error('Network error'));

        const manifests: ApplicationHostManifests = {
            testKey: 'https://example.com/manifest.json',
        };

        await expect(getHostManifest(manifests, 'testKey')).rejects.toThrow('Error occurred when fetching manifest');
        expect(console.error).toHaveBeenCalled();
    });

    it('should return undefined when manifests parameter is undefined', async () => {
        const result = await getHostManifest(undefined, 'testKey');
        expect(result).toBeUndefined();
    });
});
