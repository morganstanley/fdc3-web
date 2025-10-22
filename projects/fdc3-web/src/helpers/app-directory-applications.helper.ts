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
import {
    BackoffRetryParams,
    FullyQualifiedAppId,
    FullyQualifiedAppIdentifier,
    LocalAppDirectory,
    LocalAppDirectoryEntry,
} from '../contracts.js';

export type FullyQualifiedAppDirectoryApplication = AppDirectoryApplication & { appId: FullyQualifiedAppId };

/**
 * Convert a local app directory into an array of applications with fully-qualified app IDs.
 *
 * Each LocalAppDirectoryEntry is mapped to a FullyQualifiedAppDirectoryApplication by
 * converting the local appId into a FullyQualifiedAppId derived from the entry URL's hostname.
 *
 * @param local - Array of local app directory entries to map
 * @returns Array of applications with fully-qualified appId and web details
 */
export function mapLocalAppDirectory(local: LocalAppDirectory): FullyQualifiedAppDirectoryApplication[] {
    return local.apps.map(app => mapLocalApp(app, local.host));
}

function mapLocalApp(local: LocalAppDirectoryEntry, hostname: string): FullyQualifiedAppDirectoryApplication {
    const fullyQualifiedAppId = constructFullyQualifiedAppId(local.appId, hostname);

    return {
        appId: fullyQualifiedAppId,
        title: local.title,
        type: 'web',
        details: { url: local.url },
    };
}

/**
 * Build a FullyQualifiedAppId from a URL and an appId.
 *
 * The hostname portion of the provided URL is used to form an id of the form:
 * "<appId>@<hostname>".
 *
 * @param url - The app's launch URL (parsed with the URL constructor)
 * @param appId - The local application identifier
 * @returns Fully qualified app id string combining appId and the URL hostname
 */
export function mapUrlToFullyQualifiedAppId(url: string, appId: string): FullyQualifiedAppId {
    const hostname = new URL(url).hostname;

    return constructFullyQualifiedAppId(appId, hostname);
}

function constructFullyQualifiedAppId(appId: string, hostname: string): FullyQualifiedAppId {
    return `${appId}@${hostname}`;
}

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
        const response = await fetch(`${url}`).then(response => response.json()); // TODO: retry if initial fetch fails
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
