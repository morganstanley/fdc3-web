/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { DesktopAgentProxy } from '../agent/desktop-agent-proxy.js';
import { IMSHostManifest } from '../app-directory.contracts.js';
import { DesktopAgentNext } from '../contracts.js';
import {
    isChannel,
    isContext,
    isDesktopAgentNext,
    isFullyQualifiedAppId,
    isFullyQualifiedAppIdentifier,
    isIMSHostManifest,
    isNewInstanceStrategy,
    isNonEmptyArray,
    isOpenApplicationStrategy,
    isSelectApplicationStrategy,
} from './type-predicate.helper.js';

const defaultInvalidValues: unknown[] = ['', 'simpleString', [], {}, null, undefined];

describe(`type-predicate.helper`, () => {
    const nextAgentMethods = {
        addIntentListenerWithContext: async () => ({ unsubscribe: async () => {} }),
        updateInstanceMetadata: async () => {},
        findInstances: async () => [],
        close: async () => {},
    } satisfies Pick<
        DesktopAgentNext,
        'addIntentListenerWithContext' | 'updateInstanceMetadata' | 'findInstances' | 'close'
    >;

    describe('isDesktopAgentNext', () => {
        it('should recognize the extension methods', () => {
            expect(isDesktopAgentNext(nextAgentMethods)).toBe(true);
        });

        it('should recognize inherited methods on desktop agent instances', () => {
            const agent: unknown = Object.create(DesktopAgentProxy.prototype);

            expect(isDesktopAgentNext(agent)).toBe(true);
            if (isDesktopAgentNext(agent)) {
                expectTypeOf(agent).toEqualTypeOf<DesktopAgentNext>();
            }
        });

        it.each([...defaultInvalidValues, 0, true, Symbol('agent'), () => {}])(
            'should return false for invalid value %s',
            value => {
                expect(isDesktopAgentNext(value)).toBe(false);
            },
        );

        it.each(Object.keys(nextAgentMethods))('should require %s to be callable', method => {
            for (const value of [undefined, null, 'notAFunction', true, 1, {}]) {
                expect(isDesktopAgentNext({ ...nextAgentMethods, [method]: value })).toBe(false);
            }
        });
    });

    testTypePredicate(
        isFullyQualifiedAppIdentifier,
        [{ appId: 'sample-app-id', instanceId: 'sampleInstanceID' }],
        [{ appId: 'sample-app-id' }, { instanceId: 'sampleInstanceID' }],
    );

    testTypePredicate(isNonEmptyArray, [['one'], ['one', 'two']], [[]]);

    testTypePredicate(
        isChannel,
        [{ id: 'someChannel', type: 'app' }],
        [{ id: 'someChannel' }, { type: 'app' }, { type: 'ms.someContext' }],
    );

    testTypePredicate(
        isContext,
        [{ type: 'ms.someContext' }, { type: 'ms.someContext', id: { id: '12345' } }],
        [{ id: 'someChannel', type: 'app' }],
    );

    testTypePredicate(
        isFullyQualifiedAppId,
        ['appId@hostname', 'fully-qualified-app-id@app-directory'],
        ['appId@', '@hostname', ' @', '@ ', '@', { something: 'not-an-app-id' }],
    );

    // we use a record here to ensure that we add a test for each property that we add to IMSHostManifest
    const msHostManifestTests: Record<keyof IMSHostManifest, { successTests: IMSHostManifest[]; failureTests: any[] }> =
        {
            singleton: {
                successTests: [{ singleton: true }, { singleton: false }],
                failureTests: [{ singleton: 'yes' }, { singleton: 1 }],
            },
        };

    const successTests = Object.values(msHostManifestTests).flatMap(value => value.successTests) as [
        IMSHostManifest,
        ...IMSHostManifest[],
    ];

    testTypePredicate(
        isIMSHostManifest,
        successTests,
        Object.values(msHostManifestTests).flatMap(value => value.failureTests),
    );

    testTypePredicate(
        isOpenApplicationStrategy,
        [
            { canOpen: () => Promise.resolve(true), open: () => Promise.resolve('uuid') },
            { canOpen: async () => true, open: async () => 'uuid', manifestKey: 'key' },
        ],
        [
            { canOpen: () => Promise.resolve(true) },
            { open: () => Promise.resolve('uuid') },
            { canOpen: 'notAFunction', open: () => Promise.resolve('uuid') },
            { canOpen: () => Promise.resolve(true), open: 'notAFunction' },
        ],
    );

    testTypePredicate(
        isSelectApplicationStrategy,
        [
            { canSelectApp: () => Promise.resolve(true), selectApp: () => Promise.resolve() },
            { canSelectApp: async () => true, selectApp: async () => Promise.resolve(), manifestKey: 'key' },
        ],
        [
            { canSelectApp: () => Promise.resolve(true) },
            { selectApp: () => Promise.resolve('uuid') },
            { canSelectApp: 'notAFunction', selectApp: () => Promise.resolve('uuid') },
            { canSelectApp: () => Promise.resolve(true), selectApp: 'notAFunction' },
            { canOpen: () => Promise.resolve(true), open: () => Promise.resolve('uuid') },
        ],
    );

    testTypePredicate(
        isNewInstanceStrategy,
        [{ onNewInstance: () => {} }],
        [
            { onNewInstance: 'notAFunction' },
            { canOpen: () => Promise.resolve(true), open: () => Promise.resolve('uuid') },
        ],
    );

    function testTypePredicate<T>(
        predicate: (value: any) => value is T,
        validValues: [T, ...T[]],
        invalidValues: unknown[] = [],
    ): void {
        describe(predicate.name, () => {
            validValues.forEach(testValue => {
                it(`should return true when passed ${JSON.stringify(testValue)}`, () => {
                    expect(predicate(testValue)).toBe(true);
                });
            });

            [...invalidValues, ...defaultInvalidValues].forEach(testValue => {
                it(`should return false when passed ${JSON.stringify(testValue)}`, () => {
                    expect(predicate(testValue)).toBe(false);
                });
            });
        });
    }
});
