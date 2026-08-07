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
import { parseCliOptions } from './cli-options.js';

describe(`parseCliOptions`, () => {
    it(`should return an empty object when nothing is supplied`, () => {
        expect(parseCliOptions([], {})).toEqual({});
    });

    it(`should parse all four flags from argv`, () => {
        const options = parseCliOptions(
            ['--host', '0.0.0.0', '--port-range', '5000-5010', '--log-level', 'debug', '--auth-token', 'secret'],
            {},
        );

        expect(options).toEqual({ host: '0.0.0.0', portRange: [5000, 5010], logLevel: 'debug', authToken: 'secret' });
    });

    it(`should fall back to environment variables when a flag is absent`, () => {
        const options = parseCliOptions([], {
            BRIDGE_HOST: '0.0.0.0',
            BRIDGE_PORT_RANGE: '5000-5010',
            BRIDGE_LOG_LEVEL: 'warn',
            BRIDGE_AUTH_TOKEN: 'env-secret',
        });

        expect(options).toEqual({
            host: '0.0.0.0',
            portRange: [5000, 5010],
            logLevel: 'warn',
            authToken: 'env-secret',
        });
    });

    it(`should let an argv flag win over the equivalent environment variable`, () => {
        const options = parseCliOptions(['--host', 'from-argv'], { BRIDGE_HOST: 'from-env' });

        expect(options.host).toBe('from-argv');
    });

    it(`should ignore an invalid log level from the environment`, () => {
        const options = parseCliOptions([], { BRIDGE_LOG_LEVEL: 'not-a-level' });

        expect(options.logLevel).toBeUndefined();
    });

    it(`should omit portRange when the value cannot be parsed as start-end`, () => {
        const options = parseCliOptions(['--port-range', 'garbage'], {});

        expect(options.portRange).toBeUndefined();
    });
});
