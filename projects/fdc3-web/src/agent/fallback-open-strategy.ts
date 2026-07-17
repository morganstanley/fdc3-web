/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { OpenError } from '@finos/fdc3';
import {
    ApplicationStrategyParams,
    CloseApplicationStrategyParams,
    ICloseApplicationStrategy,
    IOpenApplicationStrategy,
    OpenApplicationStrategyResolverParams,
} from '../contracts.js';
import { isWebAppDetails, subscribeToConnectionAttemptUuids } from '../helpers/index.js';

/**
 * The default application strategy used by the desktop agent when no consumer-provided strategy is
 * able to open (or close) an application.
 *
 * As an {@link IOpenApplicationStrategy} it opens web apps in a new browser window.
 *
 * As an {@link ICloseApplicationStrategy} it provides the default `fdc3.close()` implementation:
 * it keeps a reference to every window it opened (keyed by instanceId) and closes that window when
 * the app requests to be closed. It will only ever close windows that it opened itself — apps
 * opened by a consumer-provided strategy must be closed by a consumer-provided
 * {@link ICloseApplicationStrategy}.
 */
export class FallbackOpenStrategy implements IOpenApplicationStrategy, ICloseApplicationStrategy {
    /**
     * Windows opened by this strategy, keyed by the instanceId of the app they host, so that they
     * can be closed later in response to an `fdc3.close()` call.
     */
    private readonly openedWindows: Map<string, WindowProxy> = new Map();

    //window parameter is passed during testing
    constructor(private currentWindow: Window = window) {}

    public async canOpen(params: ApplicationStrategyParams): Promise<boolean> {
        return params.appDirectoryRecord.type === 'web' && isWebAppDetails(params.appDirectoryRecord.details);
    }

    public async open(params: OpenApplicationStrategyResolverParams): Promise<string> {
        if (!isWebAppDetails(params.appDirectoryRecord.details)) {
            //this should not occur since canOpen() will have already checked this
            return Promise.reject(OpenError.ErrorOnLaunch);
        }
        const newWindow = this.currentWindow.open(params.appDirectoryRecord.details.url, '_blank', 'popup');
        if (newWindow == null) {
            //new window could not be opened
            return Promise.reject(OpenError.ErrorOnLaunch);
        }

        // track the opened window so that it can be closed later in response to an fdc3.close() call
        params.appReadyPromise
            .then(identity => this.openedWindows.set(identity.instanceId, newWindow))
            .catch(() => {
                /* app never became ready - nothing to track */
            });

        return new Promise(resolve => {
            const subscription = subscribeToConnectionAttemptUuids(
                this.currentWindow,
                newWindow,
                connectionAttemptUUid => {
                    subscription.unsubscribe();

                    resolve(connectionAttemptUUid);
                },
            );
        });
    }

    /**
     * The default close strategy can only close windows that this strategy opened itself.
     */
    public async canCloseApp(params: CloseApplicationStrategyParams): Promise<boolean> {
        return this.openedWindows.has(params.appIdentifier.instanceId);
    }

    public async closeApp(params: CloseApplicationStrategyParams): Promise<void> {
        const openedWindow = this.openedWindows.get(params.appIdentifier.instanceId);

        if (openedWindow == null) {
            //this should not occur since canCloseApp() will have already checked this
            return Promise.reject(`No window tracked for instanceId ${params.appIdentifier.instanceId}`);
        }

        openedWindow.close();
        this.openedWindows.delete(params.appIdentifier.instanceId);
    }
}
