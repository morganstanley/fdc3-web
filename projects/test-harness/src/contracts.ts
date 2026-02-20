/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppIdentifier, Context } from '@finos/fdc3';
import { AppDirectoryApplication, FullyQualifiedAppIdentifier, WebAppDetails } from '@morgan-stanley/fdc3-web';

export interface AddApp {
    application: AppDirectoryApplication;
}

export interface ListComponentChange {
    item: string;
    selected: boolean;
}

export const SelectAppContextType = 'ms.fdc3.test-harness.select-app' as const;
export const OpenAppContextType = 'ms.fdc3.test-harness.open-app' as const;
export const AppOpenedContextType = 'ms.fdc3.test-harness.app-opened' as const;
export const SelectableAppsResponseContextType = `ms.fdc3.test-harness.selectable-apps.response` as const;
export const SelectableAppsRequestContextType = `ms.fdc3.test-harness.selectable-apps.request` as const;
export const OpenAppOptionsContext = 'ms.fdc3.test-harness.open-app-options' as const;

export interface ISelectAppContext extends Context {
    type: typeof SelectAppContextType;
    appIdentifier?: FullyQualifiedAppIdentifier;
}

export const SelectableAppsIntent = 'ms.fdc3.test-harness.selectable-apps';

export interface ISelectableAppsRequestContext extends Context {
    type: typeof SelectableAppsRequestContextType;
}

export interface ISelectableAppsResponseContext extends Context {
    type: typeof SelectableAppsResponseContextType;
    applications: AppDirectoryApplication[];
}

export const OpenAppIntent = 'ms.fdc3.test-harness.open-app';

export interface IOpenAppContext<
    T extends typeof OpenAppContextType | typeof AppOpenedContextType = typeof OpenAppContextType,
> extends Context {
    type: T;
    openRequestUuid: string;
    appIdentifier: AppIdentifier;
    webDetails: WebAppDetails;
    newWindow: boolean;
}

export interface IAppOpenedContext extends IOpenAppContext<typeof AppOpenedContextType> {
    openRequestUuid: string;
    appIdentifier: AppIdentifier;
    webDetails: WebAppDetails;
    newWindow: boolean;
    connectionAttemptUuid: string;
}
