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
import { toFindInstancesError, toOpenError, toRaiseIntentResultError } from './bridge-error.helper.js';

describe(`bridge-error.helper`, () => {
    describe(`toFindInstancesError`, () => {
        it(`should pass a valid member through unchanged`, () => {
            expect(toFindInstancesError('NoAppsFound', 'TargetAppUnavailable')).toBe('NoAppsFound');
        });

        it(`should fall back for a non-member`, () => {
            expect(toFindInstancesError(new Error('boom'), 'TargetAppUnavailable')).toBe('TargetAppUnavailable');
        });

        it(`should fall back for undefined`, () => {
            expect(toFindInstancesError(undefined, 'NoAppsFound')).toBe('NoAppsFound');
        });

        it(`should fall back for a member of a different error family`, () => {
            // 'ErrorOnLaunch' is a member of OpenErrorResponsePayload, not FindInstancesErrors
            expect(toFindInstancesError('ErrorOnLaunch', 'NoAppsFound')).toBe('NoAppsFound');
        });
    });

    describe(`toOpenError`, () => {
        it(`should pass a valid member through unchanged`, () => {
            expect(toOpenError('AppNotFound', 'ErrorOnLaunch')).toBe('AppNotFound');
        });

        it(`should fall back for a non-member`, () => {
            expect(toOpenError(new Error('boom'), 'ErrorOnLaunch')).toBe('ErrorOnLaunch');
        });

        it(`should fall back for a member of a different error family`, () => {
            // 'NoAppsFound' is a member of FindInstancesErrors, not OpenErrorResponsePayload
            expect(toOpenError('NoAppsFound', 'AppNotFound')).toBe('AppNotFound');
        });
    });

    describe(`toRaiseIntentResultError`, () => {
        it(`should pass a valid member through unchanged`, () => {
            expect(toRaiseIntentResultError('IntentHandlerRejected', 'NoResultReturned')).toBe('IntentHandlerRejected');
        });

        it(`should fall back for a non-member`, () => {
            expect(toRaiseIntentResultError(new Error('boom'), 'NoResultReturned')).toBe('NoResultReturned');
        });

        it(`should fall back for undefined`, () => {
            expect(toRaiseIntentResultError(undefined, 'IntentHandlerRejected')).toBe('IntentHandlerRejected');
        });
    });
});
