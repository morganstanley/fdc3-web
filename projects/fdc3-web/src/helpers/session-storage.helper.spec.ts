/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX, DesktopAgentDetails, WebDesktopAgentType } from '@finos/fdc3';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDesktopAgentDetails, setDesktopAgentDetails } from './session-storage.helper.js';

describe('session-storage.helper', () => {
    const detailsForApp = (identityUrl: string): DesktopAgentDetails => ({
        agentType: WebDesktopAgentType.ProxyParent,
        identityUrl,
        actualUrl: identityUrl,
        appId: 'my-app-id',
        instanceId: 'instance-1',
        instanceUuid: 'uuid-1',
    });

    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it('should return undefined when no details have been persisted', () => {
        expect(getDesktopAgentDetails('https://my-app.com')).toBeUndefined();
    });

    it('should persist and retrieve details keyed by identityUrl', () => {
        const details = detailsForApp('https://my-app.com');
        setDesktopAgentDetails(details);

        expect(getDesktopAgentDetails('https://my-app.com')).toEqual(details);
        expect(getDesktopAgentDetails('https://other-app.com')).toBeUndefined();
    });

    it('should store records for multiple identity urls without collision', () => {
        const first = detailsForApp('https://app-one.com');
        const second = detailsForApp('https://app-two.com');

        setDesktopAgentDetails(first);
        setDesktopAgentDetails(second);

        expect(getDesktopAgentDetails('https://app-one.com')).toEqual(first);
        expect(getDesktopAgentDetails('https://app-two.com')).toEqual(second);
    });

    it('should store details under the standard session storage key', () => {
        setDesktopAgentDetails(detailsForApp('https://my-app.com'));

        const raw = window.sessionStorage.getItem(DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)['https://my-app.com'].appId).toBe('my-app-id');
    });

    it('should return undefined when stored data is corrupt', () => {
        window.sessionStorage.setItem(DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX, '{ not json');
        expect(getDesktopAgentDetails('https://my-app.com')).toBeUndefined();
    });
});
