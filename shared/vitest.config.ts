/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { join } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            enabled: true,
            all: true,
            provider: 'v8',
            reporter: ['text', 'lcov'],
            exclude: [
                '**/vitest.config.ts',
                '**/webpack.config.ts',
                '**/eslint.config.mjs',
                '**/.eslintrc.mjs',
                '**/dist/**',
                '**/node_modules/**',
                '**/index.ts',
                '**/*.d.ts',
                '**/test.ts',
                '**/test-setup.ts',
                '**/test-harness/**',
                // Don't include generated files or definition files
                '**/*.js',
                '**/docs/**',
            ],
            thresholds: {
                branches: 85,
                functions: 85,
                lines: 85,
                statements: 85,
            },
        },
        setupFiles: [join(__dirname, 'test-setup.ts')],
        reporters: ['junit', 'default'],
        environment: 'jsdom',
    },
});
