/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { ContextHandler } from '@finos/fdc3';
import { describe, expect, it } from 'vitest';
import { resolveContextType } from './context.helper.js';

describe('context.helper', () => {
    describe('resolveContextType', () => {
        it('should handle context type and handler', () => {
            const contextType = 'fdc3.contact';
            const contextHandler: ContextHandler = () => {};

            const result = resolveContextType(contextType, contextHandler);

            expect(result).toEqual({
                contextType: 'fdc3.contact',
                contextHandler,
            });
        });

        it('should handle just a handler with null context type', () => {
            const contextHandler: ContextHandler = () => {};

            const result = resolveContextType(contextHandler);

            expect(result).toEqual({
                contextType: null,
                contextHandler,
            });
        });

        it('should throw error when handler is not provided', () => {
            const contextType = 'fdc3.contact';

            expect(() => {
                // @ts-expect-error - Testing runtime behavior with invalid types
                resolveContextType(contextType, null);
            }).toThrow('Context handler must be defined');
        });

        it('should throw error when both parameters are null', () => {
            expect(() => {
                resolveContextType(null);
            }).toThrow('Context handler must be defined');
        });
    });
});
