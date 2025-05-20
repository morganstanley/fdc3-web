/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { AppMetadata, BrowserTypes, ImplementationMetadata } from '@finos/fdc3';
import { AppDirectoryApplication } from '../app-directory.contracts.js';
import { defaultBackoffRetry, FDC3_PROVIDER, FDC3_VERSION } from '../constants.js';
import { BackoffRetryParams, FullyQualifiedAppIdentifier } from '../contracts.js';

/**
 * Fetches app directory applications from single app directory url
 */
export async function getAppDirectoryApplications(
    url: string,
    backoffRetry?: BackoffRetryParams,
): Promise<AppDirectoryApplication[]> {
    return getAppDirectoryApplicationsImpl(url, { ...defaultBackoffRetry, ...backoffRetry });
}

export async function getAppDirectoryApplicationsImpl(
    url: string,
    backoffRetry: Required<BackoffRetryParams>,
    attempt = 1,
): Promise<AppDirectoryApplication[]> {
    try {
        const response = await fetch(`${url}/v2/apps`).then(response => response.json()); // TODO: retry if initial fetch fails
        if (response.message != 'OK' || response.applications == null) {
            //request has failed for this app directory url
            return [];
        }
        return response.applications;
    } catch (err) {
        if (attempt < backoffRetry.maxAttempts) {
            const delay = backoffRetry.baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
            console.warn(`Loading directory attempt ${attempt} failed. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return getAppDirectoryApplicationsImpl(url, backoffRetry, attempt + 1); // Recursive call
        } else {
            console.error(`Max retries reached. Unable to fetch directory applications`, { url });
            throw new Error(
                `Error occurred when reading apps from app directory after ${backoffRetry.maxAttempts} attempts`,
            );
        }
    }
}

export function getImplementationMetadata(
    appIdentifier: FullyQualifiedAppIdentifier,
    applicationMetadata?: AppMetadata,
): ImplementationMetadata {
    return {
        //version must be a numeric semver version
        fdc3Version: FDC3_VERSION,
        provider: FDC3_PROVIDER,
        optionalFeatures: {
            OriginatingAppMetadata: true,
            UserChannelMembershipAPIs: true,
            DesktopAgentBridging: false,
        },
        appMetadata: mapApplicationToMetadata(appIdentifier, applicationMetadata),
    };
}

export function mapApplicationToMetadata(
    appIdentifier: BrowserTypes.AppIdentifier,
    appMetadata?: AppMetadata,
): AppMetadata {
    return {
        appId: appIdentifier.appId,
        instanceId: appIdentifier.instanceId,
        version: appMetadata?.version,
        title: appMetadata?.title,
        tooltip: appMetadata?.tooltip,
        description: appMetadata?.description,
        icons: appMetadata?.icons,
        screenshots: appMetadata?.screenshots,
    };
}
