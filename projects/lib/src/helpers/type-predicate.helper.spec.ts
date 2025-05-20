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
import {
    isChannel,
    isContext,
    isFullyQualifiedAppId,
    isFullyQualifiedAppIdentifier,
    isNonEmptyArray,
} from './type-predicate.helper.js';

const defaultInvalidValues: unknown[] = ['', 'simpleString', [], {}, null, undefined];

describe(`type-predicate.helper`, () => {
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
