/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

export function discoverProxyCandidates(windowRef?: Window): Window[] {
    const candidates: Window[] = [];

    addCandidates(windowRef ?? window, candidates);

    return candidates;
}

function addCandidates(window: Window, candidates: Window[]): Window[] {
    if (window == null) {
        return candidates;
    }

    if (window.opener != null) {
        candidates.push(window.opener);
        addCandidates(window.opener, candidates);
    }

    if (window.parent != null && window.parent !== window) {
        candidates.push(window.parent);
        addCandidates(window.parent, candidates);
    }

    return candidates;
}
