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

const LEVEL_ORDER: Record<BridgingServerLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Level-filtered logger writing to stdout (debug/info) or stderr (warn/error). */
export class Logger {
    constructor(private readonly level: BridgingServerLogLevel = 'info') {}

    public debug(message: string, details?: unknown): void {
        this.write('debug', message, details);
    }

    public info(message: string, details?: unknown): void {
        this.write('info', message, details);
    }

    public warn(message: string, details?: unknown): void {
        this.write('warn', message, details);
    }

    public error(message: string, details?: unknown): void {
        this.write('error', message, details);
    }

    private write(level: BridgingServerLogLevel, message: string, details?: unknown): void {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
            return;
        }

        const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
        const write = level === 'warn' || level === 'error' ? console.error : console.log;

        if (details !== undefined) {
            write(line, details);
        } else {
            write(line);
        }
    }
}
