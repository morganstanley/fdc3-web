/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

export const instrument = { type: 'fdc3.instrument', id: { ticker: 'MS' } };
export const contact = { type: 'fdc3.contact', name: 'Ada', id: { email: 'ada@example.test' } };
export const metadata = { traceId: 'playwright-trace', custom: { test: 'metadata forwarding' } };
export const omitted = { $undefined: true };
export const handler = (name: string, returns?: unknown): { $handler: string; returns?: unknown } =>
    returns === undefined ? { $handler: name } : { $handler: name, returns };
export const ref = (name: string): { $ref: string } => ({ $ref: name });
export const appId = (name: string): { appId: string } => ({ appId: `${name}@localhost` });
export const reply = { type: 'e2e.reply', value: 'handled' };
