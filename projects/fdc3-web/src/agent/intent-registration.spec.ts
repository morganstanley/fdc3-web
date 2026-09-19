/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { ResolveError } from '@finos/fdc3';
import { describe, expect, it, vi } from 'vitest';
import { AppDirectory } from '../app-directory/directory.js';
import { ChannelFactory } from '../channel/channels.factory.js';
import type { IAppResolver, IProxyIncomingMessageEnvelope, IProxyMessagingProvider } from '../contracts.js';
import { DesktopAgentProxy } from './desktop-agent-proxy.js';

function createProxy(rejectFirst = false) {
    const callbacks: ((message: IProxyIncomingMessageEnvelope) => void)[] = [];
    const provider: IProxyMessagingProvider = {
        addResponseHandler: callback => {
            callbacks.push(callback);
        },
        sendMessage: ({ payload }) => {
            if (payload.type !== 'addIntentListenerRequest' && payload.type !== 'intentListenerUnsubscribeRequest')
                return;
            const response: IProxyIncomingMessageEnvelope = {
                payload: {
                    type:
                        payload.type === 'addIntentListenerRequest'
                            ? 'addIntentListenerResponse'
                            : 'intentListenerUnsubscribeResponse',
                    meta: {
                        requestUuid: payload.meta.requestUuid,
                        timestamp: new Date(),
                        responseUuid: crypto.randomUUID(),
                    },
                    payload:
                        rejectFirst && payload.type === 'addIntentListenerRequest'
                            ? { error: ResolveError.TargetAppUnavailable }
                            : { listenerUUID: crypto.randomUUID() },
                },
            };
            rejectFirst = false;
            queueMicrotask(() => callbacks.forEach(callback => callback(response)));
        },
    };
    return new DesktopAgentProxy({
        appIdentifier: { appId: 'test@app', instanceId: crypto.randomUUID() },
        messagingProvider: provider,
        channelFactory: new ChannelFactory(),
    });
}

describe('intent registration lifecycle', () => {
    it.each([
        [undefined, undefined],
        [undefined, ['fdc3.contact']],
        [['fdc3.contact'], undefined],
        [['fdc3.contact', 'fdc3.instrument'], ['fdc3.instrument']],
    ])('rejects overlapping registrations, including concurrent requests', async (first, second) => {
        const proxy = createProxy();
        const handler = vi.fn();
        const register = (types: string[] | undefined) =>
            types == null
                ? proxy.addIntentListener('View', handler)
                : proxy.addIntentListenerWithContext('View', types, handler);
        const pending = register(first);
        await expect(register(second)).rejects.toThrow(ResolveError.IntentListenerConflict);
        await (await pending).unsubscribe();
        await expect(register(second)).resolves.toHaveProperty('unsubscribe');
    });

    it('releases a reservation when registration fails', async () => {
        const proxy = createProxy(true);
        await expect(proxy.addIntentListener('View', vi.fn())).rejects.toBe(ResolveError.TargetAppUnavailable);
        await expect(proxy.addIntentListener('View', vi.fn())).resolves.toHaveProperty('unsubscribe');
    });

    it('allows disjoint filters, different intents and separate applications', async () => {
        const proxy = createProxy();
        await proxy.addIntentListenerWithContext('View', 'fdc3.contact', vi.fn());
        await expect(proxy.addIntentListenerWithContext('View', 'fdc3.instrument', vi.fn())).resolves.toHaveProperty(
            'unsubscribe',
        );
        await expect(proxy.addIntentListener('Other', vi.fn())).resolves.toHaveProperty('unsubscribe');
        await expect(createProxy().addIntentListener('View', vi.fn())).resolves.toHaveProperty('unsubscribe');
    });

    it('removes dynamic mappings but retains remaining filters and static declarations', async () => {
        const resolver: IAppResolver = { resolveAppForIntent: vi.fn(), resolveAppForContext: vi.fn() };
        const directory = new AppDirectory('root@app', Promise.resolve(resolver), [], undefined, {
            title: 'Root',
            type: 'web',
            details: { url: 'https://app/' },
            interop: { intents: { listensFor: { Static: { contexts: ['fdc3.contact'] } } } },
        });
        const app = directory.rootAppIdentifier;
        await directory.registerIntentListener(app, 'Dynamic', [{ type: 'fdc3.contact' }], 'contact');
        await directory.registerIntentListener(app, 'Dynamic', [{ type: 'fdc3.instrument' }], 'instrument');
        directory.unregisterIntentListener(app, 'Dynamic', 'contact');
        expect((await directory.getAppIntent('Dynamic', { type: 'fdc3.contact' })).apps).toEqual([]);
        expect((await directory.getAppIntent('Dynamic', { type: 'fdc3.instrument' })).apps).toContainEqual(
            expect.objectContaining(app),
        );
        directory.unregisterIntentListener(app, 'Dynamic', 'instrument');
        expect((await directory.getAppIntent('Dynamic')).apps).toEqual([]);
        await directory.registerIntentListener(app, 'Static', [{ type: 'fdc3.instrument' }], 'extra');
        directory.unregisterIntentListener(app, 'Static', 'extra');
        expect((await directory.getAppIntent('Static', { type: 'fdc3.contact' })).apps).toContainEqual(
            expect.objectContaining(app),
        );
        expect((await directory.getAppIntent('Static', { type: 'fdc3.instrument' })).apps).toEqual([]);
    });
});
