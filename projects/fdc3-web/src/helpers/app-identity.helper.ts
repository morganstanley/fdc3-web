/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier } from '@finos/fdc3';
import { FullyQualifiedAppIdentifier } from '../contracts.js';
import { isFullyQualifiedAppId } from './type-predicate.helper.js';

/**
 * compares two app identifiers and ensures that the app id and instance id are the same
 */
export function appInstanceEquals(appOne: AppIdentifier, appTwo: AppIdentifier): boolean {
    return appOne.appId === appTwo.appId && appOne.instanceId != null && appOne.instanceId === appTwo.instanceId;
}

/**
 * takes an appIdentifier or a string and returns an AppIdentifier
 * if an instanceId function is provided will populate the instanceId of the returned identifier
 */
export function resolveAppIdentifier(app: AppIdentifier): AppIdentifier;
export function resolveAppIdentifier(app: string | AppIdentifier): AppIdentifier;
export function resolveAppIdentifier(
    app: string | AppIdentifier,
    instanceId: () => string,
): FullyQualifiedAppIdentifier;
export function resolveAppIdentifier(app?: AppIdentifier): AppIdentifier | undefined;
export function resolveAppIdentifier(
    app?: string | AppIdentifier,
    instanceId?: () => string,
): AppIdentifier | undefined;
export function resolveAppIdentifier(
    app?: AppIdentifier | string,
    instanceId?: () => string,
): AppIdentifier | undefined {
    if (typeof app === 'object') {
        return app;
    } else {
        let identifier: AppIdentifier | undefined = app != null ? { appId: app } : undefined;

        if (instanceId != null && identifier! != null) {
            identifier = { ...identifier, instanceId: instanceId() };
        }

        return identifier;
    }
}

export function toUnqualifiedAppId(appId: string): string {
    return isFullyQualifiedAppId(appId) ? appId.split('@')[0] : appId;
}

/**
 * Determines whether two app ids refer to the same application, tolerating a mix of fully
 * qualified (appId@hostname) and unqualified (appId) forms.
 *
 * - If the two ids are equal they match.
 * - If both ids are fully qualified they must match exactly, so the same unqualified name hosted
 *   on different hosts is not treated as a match.
 * - Otherwise (at least one id is unqualified) the unqualified portions are compared, allowing an
 *   unqualified id to match a fully qualified one and vice versa.
 */
export function appIdsMatch(appIdOne: string, appIdTwo: string): boolean {
    if (appIdOne === appIdTwo) {
        return true;
    }

    if (isFullyQualifiedAppId(appIdOne) && isFullyQualifiedAppId(appIdTwo)) {
        return false;
    }

    return toUnqualifiedAppId(appIdOne) === toUnqualifiedAppId(appIdTwo);
}
