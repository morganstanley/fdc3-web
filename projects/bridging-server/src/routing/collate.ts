/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes } from '@finos/fdc3';

/** One agent's successful contribution to a collated response. */
export interface ResponsePart {
    desktopAgent: string;
    payload: Record<string, any>;
}

/**
 * Stamping happens per-part, before merging, and is load-bearing rather than cosmetic: the fdc3-web
 * client's AppDirectory merges local and remote discovery results by concatenation with no dedupe,
 * relying on "remote entries carry desktopAgent, local ones don't" to keep identifiers from
 * colliding, and an unstamped returned app/instance identifier makes the originating agent try to
 * resolve a remote app locally.
 */
function stampAll(items: any[] | undefined, desktopAgent: string): any[] {
    return (items ?? []).map(item => ({ ...item, desktopAgent }));
}

/**
 * Every collate function must be total over `parts.length === 0` (the zero-recipient case - see
 * BRIDGING_SERVER_DESIGN.md#Edge-cases) and iterates `parts` in the order it is given, which callers
 * must supply in recipient-enumeration order so collated output is deterministic given a fixed
 * roster.
 */
export function collateFindIntent(
    parts: ResponsePart[],
    request: BridgingTypes.AgentRequestMessage,
): Record<string, any> {
    const withApps = parts.find(part => (part.payload.appIntent?.apps ?? []).length > 0);
    const intent = withApps?.payload.appIntent?.intent ??
        parts[0]?.payload.appIntent?.intent ?? { name: request.payload.intent };

    return {
        appIntent: {
            intent,
            apps: parts.flatMap(part => stampAll(part.payload.appIntent?.apps, part.desktopAgent)),
        },
    };
}

/** Merges by intent.name (case-sensitive); the first agent to mention an intent name wins its
 *  IntentMetadata (differing displayName across agents is expected, not an error). */
export function collateFindIntentsByContext(parts: ResponsePart[]): Record<string, any> {
    const merged = new Map<string, { intent: unknown; apps: any[] }>();

    for (const part of parts) {
        for (const appIntent of part.payload.appIntents ?? []) {
            const stampedApps = stampAll(appIntent.apps, part.desktopAgent);
            const existing = merged.get(appIntent.intent?.name);

            if (existing == null) {
                merged.set(appIntent.intent?.name, { intent: appIntent.intent, apps: stampedApps });
            } else {
                existing.apps.push(...stampedApps);
            }
        }
    }

    return { appIntents: [...merged.values()] };
}

export function collateFindInstances(parts: ResponsePart[]): Record<string, any> {
    return { appIdentifiers: parts.flatMap(part => stampAll(part.payload.appIdentifiers, part.desktopAgent)) };
}

/** Only ever called with at most one part - getAppMetadataRequest is always resolved to a single
 *  target agent (see request-routes.ts). */
export function collateGetAppMetadata(parts: ResponsePart[]): Record<string, any> {
    const part = parts[0];

    return { appMetadata: part != null ? { ...part.payload.appMetadata, desktopAgent: part.desktopAgent } : undefined };
}

/** Only ever called with at most one part - openRequest is always resolved to a single target agent. */
export function collateOpen(parts: ResponsePart[]): Record<string, any> {
    const part = parts[0];

    return {
        appIdentifier: part != null ? { ...part.payload.appIdentifier, desktopAgent: part.desktopAgent } : undefined,
    };
}

/** Only ever called with at most one part - raiseIntentRequest is always resolved to a single target
 *  agent. Stamps intentResolution.source, which the originating app may use to target a follow-up
 *  intent. */
export function collateRaiseIntent(parts: ResponsePart[]): Record<string, any> {
    const part = parts[0];

    if (part == null) {
        return { intentResolution: undefined };
    }

    return {
        intentResolution: {
            ...part.payload.intentResolution,
            source: { ...part.payload.intentResolution?.source, desktopAgent: part.desktopAgent },
        },
    };
}
