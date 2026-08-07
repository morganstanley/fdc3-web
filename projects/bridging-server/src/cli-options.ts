/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingServerLogLevel } from './contracts.js';

export interface CliOptions {
    host?: string;
    portRange?: [number, number];
    logLevel?: BridgingServerLogLevel;
    authToken?: string;
}

const LOG_LEVELS: BridgingServerLogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Parses server options from argv (`--host`, `--port-range`, `--log-level`, `--auth-token`) and,
 * for anything not passed on the command line, from the environment
 * (`BRIDGE_HOST`, `BRIDGE_PORT_RANGE`, `BRIDGE_LOG_LEVEL`, `BRIDGE_AUTH_TOKEN`). argv wins.
 */
export function parseCliOptions(argv: string[], env: Record<string, string | undefined>): CliOptions {
    const flags = parseFlags(argv);

    const host = flags['host'] ?? env['BRIDGE_HOST'];
    const portRangeInput = flags['port-range'] ?? env['BRIDGE_PORT_RANGE'];
    const logLevelInput = flags['log-level'] ?? env['BRIDGE_LOG_LEVEL'];
    const authToken = flags['auth-token'] ?? env['BRIDGE_AUTH_TOKEN'];

    return {
        ...(host != null ? { host } : {}),
        ...(portRangeInput != null ? { portRange: parsePortRange(portRangeInput) } : {}),
        ...(isLogLevel(logLevelInput) ? { logLevel: logLevelInput } : {}),
        ...(authToken != null ? { authToken } : {}),
    };
}

function parseFlags(argv: string[]): Record<string, string> {
    const flags: Record<string, string> = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg.startsWith('--')) {
            flags[arg.slice(2)] = argv[i + 1];
            i++;
        }
    }

    return flags;
}

function parsePortRange(value: string): [number, number] | undefined {
    const [start, end] = value.split('-').map(part => Number.parseInt(part, 10));

    return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : undefined;
}

function isLogLevel(value: string | undefined): value is BridgingServerLogLevel {
    return LOG_LEVELS.includes(value as BridgingServerLogLevel);
}
