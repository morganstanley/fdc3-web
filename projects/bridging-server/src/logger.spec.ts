/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './logger.js';

describe(`${Logger.name}`, () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it(`should write debug/info to console.log and warn/error to console.error when level is 'debug'`, () => {
        const logger = new Logger('debug');

        logger.debug('a debug message');
        logger.info('an info message');
        logger.warn('a warn message');
        logger.error('an error message');

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it(`should default to level 'info' and suppress debug messages`, () => {
        const logger = new Logger();

        logger.debug('should be suppressed');
        logger.info('should be shown');

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0][0]).toContain('should be shown');
    });

    it(`should suppress everything below the configured level`, () => {
        const logger = new Logger('error');

        logger.debug('suppressed');
        logger.info('suppressed');
        logger.warn('suppressed');
        logger.error('shown');

        expect(logSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it(`should pass details through as a second argument when supplied`, () => {
        const logger = new Logger('debug');
        const details = { foo: 'bar' };

        logger.info('message with details', details);

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('message with details'), details);
    });

    it(`should not pass a second argument when details is omitted`, () => {
        const logger = new Logger('debug');

        logger.info('message without details');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('message without details'));
        expect(logSpy.mock.calls[0].length).toBe(1);
    });

    it(`should prefix messages with an ISO timestamp and the upper-cased level`, () => {
        const logger = new Logger('debug');

        logger.warn('careful');

        expect(errorSpy.mock.calls[0][0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z] \[WARN] careful$/);
    });
});
