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
import { describe, expect, it } from 'vitest';
import { appInstanceEquals, resolveAppIdentifier } from './app-identity.helper.js';

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

    describe(`${resolveAppIdentifier.name} (resolve-app-resolveAppIdentifier.helper)`, () => {
        const mockedAppId: AppIdentifier = { appId: 'mocked-app-id' };

        it('should return AppIdentifier if an AppIdentifier is passed to it', () => {
            const appIdentifier = resolveAppIdentifier(mockedAppId);

            expect(appIdentifier).toBe(mockedAppId);
        });

        it('should construct AppIdentifier if only string passed', () => {
            const appIdentifier = resolveAppIdentifier('mocked-app-id');

            expect(appIdentifier).toEqual(mockedAppId);
        });

        it('should construct AppIdentifier with newly generated instanceId if string passed with instanceId callback', () => {
            const mockedInstanceId = `mocked-instance-id`;

            const appIdentifier = resolveAppIdentifier('mocked-app-id', () => mockedInstanceId);

            expect(appIdentifier).toEqual({ ...mockedAppId, instanceId: mockedInstanceId });
        });

        it('should return undefined if no AppIdentifier or string is passed to it', () => {
            const appIdentifier = resolveAppIdentifier();

            expect(appIdentifier).toBeUndefined();
        });
    });
});
