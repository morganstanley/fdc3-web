/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { AppMetadata } from '@finos/fdc3';
import { generateUUID } from '@morgan-stanley/fdc3-web';

export function generateAppTitle(appMetadata: AppMetadata): string {
    const adjectives = ['Amber', 'Bright', 'Calm', 'Golden', 'Happy', 'Silver', 'Sunny', 'Swift'];
    const animals = ['Badger 🦡', 'Falcon 🦅', 'Fox 🦊', 'Heron 🐦', 'Otter 🦦', 'Owl 🦉', 'Panda 🐼', 'Robin 🐦'];
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const suffix = (appMetadata.instanceId ?? generateUUID()).slice(0, 8);
    return `${adjective} ${animal} ${suffix}`;
}
