/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, it } from 'vitest';
import { appIdsMatch, appInstanceEquals, toUnqualifiedAppId } from './app-identity.helper.js';

describe(`app-identity.helper`, () => {
    describe(`${appInstanceEquals.name} (app-identity.helper)`, () => {
        it(`should return true if appId and instanceId are the same and instanceID is defined`, () => {
            expect(
                appInstanceEquals(
                    { appId: 'appOne', instanceId: 'instanceOne' },
                    { appId: 'appOne', instanceId: 'instanceOne' },
                ),
            ).toBe(true);
        });

        it(`should return false if appId differs`, () => {
            expect(
                appInstanceEquals(
                    { appId: 'appOne', instanceId: 'instanceOne' },
                    { appId: 'appTwo', instanceId: 'instanceOne' },
                ),
            ).toBe(false);
        });

        it(`should return false if instanceId differs`, () => {
            expect(
                appInstanceEquals(
                    { appId: 'appOne', instanceId: 'instanceOne' },
                    { appId: 'appOne', instanceId: 'instanceTwo' },
                ),
            ).toBe(false);
        });

        it(`should return false if instanceId is only defined once`, () => {
            expect(appInstanceEquals({ appId: 'appOne' }, { appId: 'appOne', instanceId: 'instanceOne' })).toBe(false);
        });

        it(`should return false if instanceId is not defined`, () => {
            expect(appInstanceEquals({ appId: 'appOne' }, { appId: 'appOne' })).toBe(false);
        });
    });

    describe(`${toUnqualifiedAppId.name} (app-identity.helper)`, () => {
        it('should strip the host from a fully qualified app id', () => {
            expect(toUnqualifiedAppId('my-app@jubako.ms.com')).toBe('my-app');
        });

        it('should return an unqualified app id unchanged', () => {
            expect(toUnqualifiedAppId('my-app')).toBe('my-app');
        });
    });

    describe(`${appIdsMatch.name} (app-identity.helper)`, () => {
        it('should match two identical fully qualified app ids', () => {
            expect(appIdsMatch('my-app@jubako.ms.com', 'my-app@jubako.ms.com')).toBe(true);
        });

        it('should match two identical unqualified app ids', () => {
            expect(appIdsMatch('my-app', 'my-app')).toBe(true);
        });

        it('should match an unqualified app id against a fully qualified app id', () => {
            expect(appIdsMatch('my-app@jubako.ms.com', 'my-app')).toBe(true);
        });

        it('should match a fully qualified app id against an unqualified app id', () => {
            expect(appIdsMatch('my-app', 'my-app@jubako.ms.com')).toBe(true);
        });

        it('should not match different unqualified app ids', () => {
            expect(appIdsMatch('my-app', 'other-app')).toBe(false);
        });

        it('should not match the same unqualified name on different hosts', () => {
            expect(appIdsMatch('my-app@host-one.ms.com', 'my-app@host-two.ms.com')).toBe(false);
        });

        it('should not match an unqualified app id against a different fully qualified app id', () => {
            expect(appIdsMatch('other-app@jubako.ms.com', 'my-app')).toBe(false);
        });
    });
});
