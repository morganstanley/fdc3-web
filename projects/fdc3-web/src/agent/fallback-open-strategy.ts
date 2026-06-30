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
import { IOpenApplicationStrategy, OpenApplicationStrategyResolverParams } from '../contracts.js';
import { isWebAppDetails, subscribeToConnectionAttemptUuids } from '../helpers/index.js';

/**
 * Interval (ms) used to poll `window.closed` on the newly-opened popup.
 * Kept short so that instance removal is perceived as near-instant.
 */
const WINDOW_CLOSED_POLL_INTERVAL_MS = 500;

export class FallbackOpenStrategy implements IOpenApplicationStrategy {
    //window parameter is passed during testing
    constructor(private currentWindow: Window = window) {}

    public async canOpen(params: OpenApplicationStrategyResolverParams): Promise<boolean> {
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

        if (params.onWindowClosed != null) {
            this.monitorWindowClosed(newWindow, params.onWindowClosed);
        }

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
     * Polls `childWindow.closed` at a fixed interval. As soon as the window is detected as closed
     * the `onClosed` callback is invoked and polling stops.
     *
     * We poll from the *root* window context so that the check survives even when the child
     * window's own JavaScript execution is torn down during unload.
     */
    private monitorWindowClosed(childWindow: Window, onClosed: () => void): void {
        const poll = setInterval(() => {
            if (childWindow.closed) {
                clearInterval(poll);
                onClosed();
            }
        }, WINDOW_CLOSED_POLL_INTERVAL_MS);
    }
}
