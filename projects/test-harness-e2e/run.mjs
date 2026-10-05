/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Node 24 snapshots proxy settings at startup. Set bypasses before launching Playwright.
const require = createRequire(import.meta.url);
const env = { ...process.env };
for (const key of ['NO_PROXY', 'no_proxy']) env[key] = `localhost,127.0.0.1,${env[key] ?? ''}`;
const child = spawn(
    process.execPath,
    [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        'projects/test-harness-e2e/playwright.config.ts',
        ...process.argv.slice(2),
    ],
    { env, stdio: 'inherit' },
);
child.on('exit', code => {
    process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
