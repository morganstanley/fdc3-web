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
import { describe, expect, it } from 'vitest';
import {
    collateFindInstances,
    collateFindIntent,
    collateFindIntentsByContext,
    collateGetAppMetadata,
    collateOpen,
    collateRaiseIntent,
} from './collate.js';

const findIntentRequest = {
    type: 'findIntentRequest',
    payload: { intent: 'ViewChart' },
    meta: { requestUuid: 'u', timestamp: new Date() },
} as unknown as BridgingTypes.AgentRequestMessage;

describe(`collateFindIntent`, () => {
    it(`should be total over zero parts, falling back to the request's intent name`, () => {
        expect(collateFindIntent([], findIntentRequest)).toEqual({
            appIntent: { intent: { name: 'ViewChart' }, apps: [] },
        });
    });

    it(`should concatenate and stamp apps from every agent that returned some`, () => {
        const result = collateFindIntent(
            [
                {
                    desktopAgent: 'AgentB',
                    payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'app1' }] } },
                },
                {
                    desktopAgent: 'AgentC',
                    payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [{ appId: 'app2' }] } },
                },
            ],
            findIntentRequest,
        );

        expect(result).toEqual({
            appIntent: {
                intent: { name: 'ViewChart' },
                apps: [
                    { appId: 'app1', desktopAgent: 'AgentB' },
                    { appId: 'app2', desktopAgent: 'AgentC' },
                ],
            },
        });
    });

    it(`should take the intent metadata from the first agent that actually returned apps`, () => {
        const result = collateFindIntent(
            [
                { desktopAgent: 'AgentB', payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } } },
                {
                    desktopAgent: 'AgentC',
                    payload: {
                        appIntent: {
                            intent: { name: 'ViewChart', displayName: 'View Chart' },
                            apps: [{ appId: 'app2' }],
                        },
                    },
                },
            ],
            findIntentRequest,
        );

        expect(result.appIntent.intent).toEqual({ name: 'ViewChart', displayName: 'View Chart' });
    });

    it(`should fall back to the first part's intent metadata when nobody returned apps`, () => {
        const result = collateFindIntent(
            [{ desktopAgent: 'AgentB', payload: { appIntent: { intent: { name: 'ViewChart' }, apps: [] } } }],
            findIntentRequest,
        );

        expect(result.appIntent.intent).toEqual({ name: 'ViewChart' });
        expect(result.appIntent.apps).toEqual([]);
    });
});

describe(`collateFindIntentsByContext`, () => {
    it(`should be total over zero parts`, () => {
        expect(collateFindIntentsByContext([])).toEqual({ appIntents: [] });
    });

    it(`should merge apps for the same intent name across agents`, () => {
        const result = collateFindIntentsByContext([
            {
                desktopAgent: 'AgentB',
                payload: { appIntents: [{ intent: { name: 'ViewChart' }, apps: [{ appId: 'app1' }] }] },
            },
            {
                desktopAgent: 'AgentC',
                payload: { appIntents: [{ intent: { name: 'ViewChart' }, apps: [{ appId: 'app2' }] }] },
            },
        ]);

        expect(result).toEqual({
            appIntents: [
                {
                    intent: { name: 'ViewChart' },
                    apps: [
                        { appId: 'app1', desktopAgent: 'AgentB' },
                        { appId: 'app2', desktopAgent: 'AgentC' },
                    ],
                },
            ],
        });
    });

    it(`should keep a remote-only intent that no other agent mentioned`, () => {
        const result = collateFindIntentsByContext([
            {
                desktopAgent: 'AgentB',
                payload: { appIntents: [{ intent: { name: 'StartChat' }, apps: [{ appId: 'chatApp' }] }] },
            },
        ]);

        expect(result.appIntents).toEqual([
            { intent: { name: 'StartChat' }, apps: [{ appId: 'chatApp', desktopAgent: 'AgentB' }] },
        ]);
    });

    it(`should let the first agent's intent metadata win on a displayName conflict`, () => {
        const result = collateFindIntentsByContext([
            {
                desktopAgent: 'AgentB',
                payload: {
                    appIntents: [{ intent: { name: 'ViewChart', displayName: 'From B' }, apps: [{ appId: 'app1' }] }],
                },
            },
            {
                desktopAgent: 'AgentC',
                payload: {
                    appIntents: [{ intent: { name: 'ViewChart', displayName: 'From C' }, apps: [{ appId: 'app2' }] }],
                },
            },
        ]);

        expect(result.appIntents[0].intent).toEqual({ name: 'ViewChart', displayName: 'From B' });
    });
});

describe(`collateFindInstances`, () => {
    it(`should be total over zero parts`, () => {
        expect(collateFindInstances([])).toEqual({ appIdentifiers: [] });
    });

    it(`should concatenate and stamp appIdentifiers across agents`, () => {
        const result = collateFindInstances([
            { desktopAgent: 'AgentB', payload: { appIdentifiers: [{ appId: 'app1', instanceId: 'i1' }] } },
            { desktopAgent: 'AgentC', payload: { appIdentifiers: [{ appId: 'app1', instanceId: 'i2' }] } },
        ]);

        expect(result).toEqual({
            appIdentifiers: [
                { appId: 'app1', instanceId: 'i1', desktopAgent: 'AgentB' },
                { appId: 'app1', instanceId: 'i2', desktopAgent: 'AgentC' },
            ],
        });
    });
});

describe(`collateGetAppMetadata`, () => {
    it(`should return undefined appMetadata when there is no part`, () => {
        expect(collateGetAppMetadata([])).toEqual({ appMetadata: undefined });
    });

    it(`should stamp desktopAgent onto the single part's appMetadata`, () => {
        const result = collateGetAppMetadata([
            { desktopAgent: 'AgentB', payload: { appMetadata: { appId: 'app1', title: 'App One' } } },
        ]);

        expect(result).toEqual({ appMetadata: { appId: 'app1', title: 'App One', desktopAgent: 'AgentB' } });
    });
});

describe(`collateOpen`, () => {
    it(`should return undefined appIdentifier when there is no part`, () => {
        expect(collateOpen([])).toEqual({ appIdentifier: undefined });
    });

    it(`should stamp desktopAgent onto the single part's appIdentifier`, () => {
        const result = collateOpen([
            { desktopAgent: 'AgentB', payload: { appIdentifier: { appId: 'app1', instanceId: 'i1' } } },
        ]);

        expect(result).toEqual({ appIdentifier: { appId: 'app1', instanceId: 'i1', desktopAgent: 'AgentB' } });
    });
});

describe(`collateRaiseIntent`, () => {
    it(`should return undefined intentResolution when there is no part`, () => {
        expect(collateRaiseIntent([])).toEqual({ intentResolution: undefined });
    });

    it(`should stamp desktopAgent onto intentResolution.source`, () => {
        const result = collateRaiseIntent([
            {
                desktopAgent: 'AgentB',
                payload: { intentResolution: { intent: 'ViewChart', source: { appId: 'app1', instanceId: 'i1' } } },
            },
        ]);

        expect(result).toEqual({
            intentResolution: {
                intent: 'ViewChart',
                source: { appId: 'app1', instanceId: 'i1', desktopAgent: 'AgentB' },
            },
        });
    });
});
