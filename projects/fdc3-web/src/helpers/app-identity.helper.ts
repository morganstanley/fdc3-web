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
