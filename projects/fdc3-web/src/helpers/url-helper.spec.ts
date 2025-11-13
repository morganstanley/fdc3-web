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
import { decodeUUUrl, generateUUUrl, urlContainsAllElements } from './url-helper.js';
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

describe(`urlContainsAllElements`, () => {
    const tests: { description: string; appDUrl: string; matches?: string[]; failures?: string[] }[] = [
        {
            description: 'path includes file no params and no hash',
            appDUrl: 'https://example.com/pathOne/index.html',
            matches: [
                'https://example.com/pathOne/index.html',
                'https://example.com/pathOne/index.html?paramOne=valueOne',
                'https://example.com/pathOne/index.html#someAnchor',
                'https://example.com/pathOne/index.html?paramOne=valueOne&paramTwo=valueTwo#someAnchor',
                'https://example.com/pathOne/index.html?paramOne=valueOne#someAnchor',
            ],
            failures: [
                'https://example.com/pathTwo/index.html',
                'https://example.com/pathTwo/otherFile.html',
                'http://example.com/pathOne/index.html',
                'https://other-host.com/pathOne/index.html',
                'https://example.co.uk/pathOne/index.html',
                'https://example.com:8080/pathOne/index.html',
            ],
        },
        {
            description: 'path has port',
            appDUrl: 'https://example.com:8080/pathOne/index.html',
            matches: ['https://example.com:8080/pathOne/index.html'],
            failures: ['https://example.com:80/pathOne/index.html', 'https://example.com/pathOne/index.html'],
        },
        {
            description: 'path includes multiple url params',
            appDUrl: 'https://example.com:8080/pathOne?paramOne=valueOne&paramTwo=valueTwo',
            matches: [
                'https://example.com:8080/pathOne?paramOne=valueOne&paramTwo=valueTwo',
                'https://example.com:8080/pathOne/pathTwo?paramOne=valueOne&paramTwo=valueTwo',
                'https://example.com:8080/pathOne?paramOne=valueOne&paramTwo=valueTwo&paramThree=valueThree',
                'https://example.com:8080/pathOne?paramOne=valueOne&paramTwo=valueTwo#someHash',
                'https://example.com:8080/pathOne?otherParam=otherValue&paramOne=valueOne&paramTwo=valueTwo',
                'https://example.com:8080/pathOne?paramOne=valueOne&otherParam=otherValue&paramTwo=valueTwo',
            ],
            failures: [
                'https://example.com:8080/pathOne?paramOne=valueOne',
                'https://example.com:8080/pathOne?paramTwo=valueTwo',
            ],
        },
        {
            description: 'path includes hash',
            appDUrl: 'https://example.com:8080/pathOne#someHash',
            matches: [
                'https://example.com:8080/pathOne#someHash',
                'https://example.com:8080/pathOne?paramOne=valueOne&paramTwo=valueTwo#someHash',
                'https://example.com:8080/pathOne/pathTwo#someHash',
            ],
            failures: ['https://example.com:8080/pathOne'],
        },
        {
            description: 'path has multiple sections',
            appDUrl: 'https://example.com:8080/pathOne/pathTwo',
            matches: [
                'https://example.com:8080/pathOne/pathTwo',
                'https://example.com:8080/pathOne/pathTwo?paramOne=valueOne&paramTwo=valueTwo#someHash',
            ],
            failures: ['https://example.com:8080/pathOne'],
        },
        // below tests taken from https://github.com/finos/fdc3/issues/1337
        {
            description: 'Path and search present, exact match available',
            appDUrl: 'https://example.com/path?search=text',
            matches: ['https://example.com/path?search=text'],
        },
        {
            description: 'Path and hash present, no exact match, need to ignore path in input to match',
            appDUrl: 'https://example.com/#hash',
            matches: ['https://example.com/altPath#hash'],
        },
        {
            description: 'Path only present, exact match available',
            appDUrl: 'https://example.com/path',
            matches: ['https://example.com/path'],
        },
        {
            description: 'Path only present but not matchable, match on domain only',
            appDUrl: 'https://example.com/',
            matches: ['https://example.com/altPath'],
        },
        {
            description: 'path, search and hash present, but no match on search param or path, select match without',
            appDUrl: 'https://example.com/#hash',
            matches: ['https://example.com/altPath?search=tulip#hash'],
        },
        {
            description: 'Ignore trailing slashes on path',
            appDUrl: 'https://example.com/#hash',
            matches: ['https://example.com#hash'],
        },
        {
            description: 'Hash present but unknown, match origin only, ignoring trailing slash',
            appDUrl: 'https://example.com/',
            matches: ['https://example.com#unknownHash'],
        },
    ];

    tests.forEach(({ description, appDUrl, matches, failures }) => {
        describe(description, () => {
            matches?.forEach(comparisonUrl => {
                it(`should return true when comparing appD Url '${appDUrl}' to comparison url: ${comparisonUrl}`, () => {
                    expect(urlContainsAllElements(appDUrl, comparisonUrl)).toBe(true);
                });
            });

            failures?.forEach(comparisonUrl => {
                it(`should return false when comparing appD Url '${appDUrl}' to comparison url: ${comparisonUrl}`, () => {
                    expect(urlContainsAllElements(appDUrl, comparisonUrl)).toBe(false);
                });
            });
        });
    });
});
