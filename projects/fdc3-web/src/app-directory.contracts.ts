/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { Icon, Image } from '@finos/fdc3';

export type AppDirectoryApplicationType = 'web' | 'native' | 'citrix' | 'onlineNative' | 'other';
export type WebAppDetails = { url: string };
export type NativeAppDetails = { path: string; arguments?: string };
export type CitrixAppDetails = { alias: string; arguments?: string };
export type OnlineNativeAppDetails = { url: string };
export type OtherAppDetails = undefined;
export type AppDirectoryApplicationDetails =
    | WebAppDetails
    | NativeAppDetails
    | CitrixAppDetails
    | OnlineNativeAppDetails
    | OtherAppDetails;
//manifest key can map to manifest object or URI from which manifest can be retrieved
export type ApplicationHostManifests = { [key: string]: object | string };
export type AppDirectoryContextResultTypePair = { contexts: string[]; resultType?: string };
type AppDirectoryInterop = {
    intents?: {
        listensFor?: { [key: string]: AppDirectoryContextResultTypePair };
        raises?: { [key: string]: string[] };
    };
    userChannels?: {
        broadcasts?: string[];
        listensFor?: string[];
    };
    appChannels?: [
        {
            id: string;
            description?: string;
            broadcasts?: string[];
            listensFor?: string[];
        },
    ];
};

type BaseApplication = {
    appId: string;
    title: string;
    type: AppDirectoryApplicationType;
    details: AppDirectoryApplicationDetails;
    version?: string;
    tooltip?: string;
    lang?: string;
    description?: string;
    categories?: string[];
    icons?: Icon[];
    screenshots?: Image[];
    contactEmail?: string;
    supportEmail?: string;
    moreInfo?: string;
    publisher?: string;
    hostManifests?: ApplicationHostManifests;
    interop?: AppDirectoryInterop;
};

export type AppDirectoryApplication = BaseApplication & { localizedVersions?: { [key: string]: BaseApplication } };
