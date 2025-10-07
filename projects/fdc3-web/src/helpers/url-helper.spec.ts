/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { Mock, proxyModule, registerMock, setupFunction } from '@morgan-stanley/ts-mocking-bird';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeUUUrl, generateUUUrl } from './url-helper.js';
import * as helpersImport from './uuid.helper.js';

vi.mock('./uuid.helper.js', async () => {
    const actual = await vi.importActual('./uuid.helper.js');
    return proxyModule(actual);
});

const mockedGeneratedUuid = `mocked-generated-Uuid`;

describe(`generateUUUrl`, () => {
    type SampleData = {
        first: string;
        last: string;
    };

    // create once as import will only be evaluated and destructured once
    const mockedHelpers = Mock.create<typeof helpersImport>();

    beforeEach(() => {
        // setup before each to clear function call counts
        mockedHelpers.setup(setupFunction('generateUUID', () => mockedGeneratedUuid));

        registerMock(helpersImport, mockedHelpers.mock);
    });

    it(`should return a string that can be converted back to an object when no uuid passed in`, () => {
        const data: SampleData = {
            first: 'Fred',
            last: 'Bloggs',
        };

        const encoded = generateUUUrl<SampleData>(data);

        expect(encoded.indexOf(data.first)).toBe(-1);
        expect(encoded.indexOf(data.last)).toBe(-1);

        const { payload, uuid } = decodeUUUrl<SampleData>(encoded) ?? {};

        expect(payload).toEqual(data);
        expect(uuid).toEqual(mockedGeneratedUuid);
    });

    it(`should return a string that can be converted back to an object when existing uuid passed in`, () => {
        const data: SampleData = {
            first: 'Fred',
            last: 'Bloggs',
        };
        const existingUUID = 'existing-UUID';

        const encoded = generateUUUrl<SampleData>(data, existingUUID);

        expect(encoded.indexOf(data.first)).toBe(-1);
        expect(encoded.indexOf(data.last)).toBe(-1);

        const { payload, uuid } = decodeUUUrl<SampleData>(encoded) ?? {};

        expect(payload).toEqual(data);
        expect(uuid).toEqual(existingUUID);
    });

    it(`decodeUUUrl should return undefined if passed an invalid url`, () => {
        expect(decodeUUUrl<SampleData>('not a valid url')).toBeUndefined();
    });
});
