/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AppMetadata, BrowserTypes } from '@finos/fdc3';
import { AppDirectoryApplication } from '../app-directory.contracts';
import { FDC3_PROVIDER, FDC3_VERSION } from '../constants';
import { FullyQualifiedAppIdentifier } from '../contracts';
import {
    getAppDirectoryApplications,
    getImplementationMetadata,
    mapApplicationToMetadata,
} from './app-directory-applications.helper';

describe('app-directory-applications.helper', () => {
    describe('getAppDirectoryApplications', () => {
        const mockAppDirectoryUrl = 'http://mock-app-directory';
        const mockApplications: AppDirectoryApplication[] = [
            {
                appId: 'app1',
                title: 'App 1',
                type: 'web',
                details: { url: 'https://app1.example.com' },
                version: '1.0.0',
            },
            {
                appId: 'app2',
                title: 'App 2',
                type: 'web',
                details: { url: 'https://app2.example.com' },
                version: '2.0.0',
            },
        ];

        beforeEach(() => {
            // Reset fetch mock before each test
            global.fetch = jest.fn();
        });

        it('should fetch applications from the app directory URL', async () => {
            // Mock successful fetch response
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: jest.fn().mockResolvedValueOnce({
                    message: 'OK',
                    applications: mockApplications,
                }),
            });

            const result = await getAppDirectoryApplications(mockAppDirectoryUrl);

            // Verify fetch was called with the correct URL
            expect(global.fetch).toHaveBeenCalledWith(`${mockAppDirectoryUrl}/v2/apps`);

            // Verify the returned applications match the mock data
            expect(result).toEqual(mockApplications);
        });

        it('should return an empty array if the response message is not OK', async () => {
            // Mock failed fetch response
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: jest.fn().mockResolvedValueOnce({
                    message: 'Error',
                    applications: null,
                }),
            });

            const result = await getAppDirectoryApplications(mockAppDirectoryUrl);

            // Verify fetch was called
            expect(global.fetch).toHaveBeenCalled();

            // Verify an empty array is returned
            expect(result).toEqual([]);
        });

        it('should return an empty array if applications is null', async () => {
            // Mock fetch response with null applications
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: jest.fn().mockResolvedValueOnce({
                    message: 'OK',
                    applications: null,
                }),
            });

            const result = await getAppDirectoryApplications(mockAppDirectoryUrl);

            // Verify fetch was called
            expect(global.fetch).toHaveBeenCalled();

            // Verify an empty array is returned
            expect(result).toEqual([]);
        });

        it('should throw an error if fetch fails', async () => {
            // Mock fetch error
            const mockError = new Error('Network error');
            (global.fetch as jest.Mock).mockRejectedValueOnce(mockError);

            // Mock console.error to prevent test output noise
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            // Verify the function throws the expected error
            await expect(getAppDirectoryApplications(mockAppDirectoryUrl)).rejects.toThrow(
                'Error occurred when reading apps from app directory',
            );

            // Verify console.error was called with the original error
            expect(consoleErrorSpy).toHaveBeenCalledWith(mockError);

            // Restore console.error
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getImplementationMetadata', () => {
        const mockAppIdentifier: FullyQualifiedAppIdentifier = {
            appId: 'test-app-id',
            instanceId: 'test-instance-id',
        };

        const mockAppMetadata: AppMetadata = {
            appId: 'test-app-id',
            instanceId: 'test-instance-id',
            title: 'Test App',
            description: 'Test App Description',
            version: '1.0.0',
            tooltip: 'Test Tooltip',
            icons: [{ src: 'icon.png' }],
            screenshots: [{ src: 'screenshot.png' }],
        };

        it('should return implementation metadata with the correct structure', () => {
            const result = getImplementationMetadata(mockAppIdentifier, mockAppMetadata);

            // Verify the result has the expected structure and values
            expect(result).toEqual({
                fdc3Version: FDC3_VERSION,
                provider: FDC3_PROVIDER,
                optionalFeatures: {
                    OriginatingAppMetadata: true,
                    UserChannelMembershipAPIs: true,
                    DesktopAgentBridging: false,
                },
                appMetadata: mockAppMetadata,
            });
        });

        it('should work with minimal app identifier and no metadata', () => {
            const result = getImplementationMetadata(mockAppIdentifier);

            // Verify the result has the expected structure
            expect(result).toEqual({
                fdc3Version: FDC3_VERSION,
                provider: FDC3_PROVIDER,
                optionalFeatures: {
                    OriginatingAppMetadata: true,
                    UserChannelMembershipAPIs: true,
                    DesktopAgentBridging: false,
                },
                appMetadata: {
                    appId: mockAppIdentifier.appId,
                    instanceId: mockAppIdentifier.instanceId,
                    version: undefined,
                    title: undefined,
                    tooltip: undefined,
                    description: undefined,
                    icons: undefined,
                    screenshots: undefined,
                },
            });
        });
    });

    describe('mapApplicationToMetadata', () => {
        const mockAppIdentifier: BrowserTypes.AppIdentifier = {
            appId: 'test-app-id',
            instanceId: 'test-instance-id',
        };

        const mockAppMetadata: AppMetadata = {
            appId: 'different-app-id', // This should be overridden
            instanceId: 'different-instance-id', // This should be overridden
            title: 'Test App',
            description: 'Test App Description',
            version: '1.0.0',
            tooltip: 'Test Tooltip',
            icons: [{ src: 'icon.png' }],
            screenshots: [{ src: 'screenshot.png' }],
        };

        it('should map application data to metadata format with all fields', () => {
            const result = mapApplicationToMetadata(mockAppIdentifier, mockAppMetadata);

            // Verify the result has the expected structure and values
            expect(result).toEqual({
                appId: mockAppIdentifier.appId, // Should use the identifier's appId
                instanceId: mockAppIdentifier.instanceId, // Should use the identifier's instanceId
                title: mockAppMetadata.title,
                description: mockAppMetadata.description,
                version: mockAppMetadata.version,
                tooltip: mockAppMetadata.tooltip,
                icons: mockAppMetadata.icons,
                screenshots: mockAppMetadata.screenshots,
            });
        });

        it('should work with minimal app identifier and no metadata', () => {
            const result = mapApplicationToMetadata(mockAppIdentifier);

            // Verify the result has the expected structure
            expect(result).toEqual({
                appId: mockAppIdentifier.appId,
                instanceId: mockAppIdentifier.instanceId,
                version: undefined,
                title: undefined,
                tooltip: undefined,
                description: undefined,
                icons: undefined,
                screenshots: undefined,
            });
        });

        it('should override appId and instanceId from the metadata with values from the identifier', () => {
            const result = mapApplicationToMetadata(mockAppIdentifier, mockAppMetadata);

            // Verify the appId and instanceId are from the identifier, not the metadata
            expect(result.appId).toBe(mockAppIdentifier.appId);
            expect(result.instanceId).toBe(mockAppIdentifier.instanceId);
            expect(result.appId).not.toBe(mockAppMetadata.appId);
            expect(result.instanceId).not.toBe(mockAppMetadata.instanceId);
        });
    });
});
