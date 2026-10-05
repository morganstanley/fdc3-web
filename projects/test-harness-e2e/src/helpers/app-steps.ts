/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { expect, type FrameLocator, type Page, test as base } from '@playwright/test';

type Outcome = { ok: boolean; value?: any; error?: string };

/** Every interaction and assertion has a named report step, including setup and callback checks. */
export class AppSteps {
    public readonly frame: FrameLocator | Page;

    constructor(
        public readonly page: Page,
        public readonly url: string,
        public readonly name: string,
        index = 0,
    ) {
        this.frame =
            url === ''
                ? page
                : page.locator(`[automation-id="fth-app-iframe"][data-app-url="${url}"]`).nth(index).contentFrame();
    }

    public async ready(): Promise<void> {
        await base.step(`Given ${this.name} is connected to the desktop agent`, async () => {
            await expect(this.frame.getByTestId('fth-api-explorer')).toHaveAttribute('data-ready', '');
            await this.show();
        });
    }

    public async show(): Promise<void> {
        await base.step(`Open the API explorer in ${this.name}`, async () => {
            await this.frame.getByTestId('fth-api-toggle').click();
        });
    }

    public async start(method: string, args: unknown[] = [], target = 'agent', save = 'result'): Promise<void> {
        await base.step(`When ${this.name} calls ${target}.${method}(${JSON.stringify(args)})`, async () => {
            await this.frame.getByTestId('fth-api-target').fill(target);
            await this.frame.getByTestId('fth-api-method').selectOption(method);
            await this.frame.getByTestId('fth-api-save').fill(save);
            await this.frame.getByTestId('fth-api-args').fill(JSON.stringify(args));
            await this.frame.getByTestId('fth-api-run').click();
        });
    }

    public async outcome(): Promise<Outcome> {
        return base.step(`Then ${this.name} receives an API response`, async () => {
            const result = this.frame.getByTestId('fth-api-result');
            await expect(result).not.toBeEmpty();
            return JSON.parse((await result.textContent())!);
        });
    }

    public async call(method: string, args: unknown[] = [], target = 'agent', save = 'result'): Promise<any> {
        return base.step(`${this.name}: ${target}.${method}`, async () => {
            await this.start(method, args, target, save);
            return this.success();
        });
    }

    public async success(): Promise<any> {
        return base.step(`Then the call succeeds in ${this.name}`, async () => {
            const result = await this.outcome();
            expect(result, result.error).toMatchObject({ ok: true });
            return result.value;
        });
    }

    public async rejects(method: string, args: unknown[], error: string, target = 'agent'): Promise<void> {
        await base.step(`Then ${target}.${method} rejects with ${error}`, async () => {
            await this.start(method, args, target);
            expect(await this.outcome()).toEqual({ ok: false, error });
        });
    }

    public async received(listener: string, args: unknown[]): Promise<void> {
        await base.step(`Then ${this.name}'s ${listener} handler receives ${JSON.stringify(args)}`, async () => {
            await expect
                .poll(() => this.events(listener))
                .toEqual(expect.arrayContaining([expect.objectContaining({ args: expect.arrayContaining(args) })]));
        });
    }

    public async events(listener: string): Promise<{ listener: string; args: any[] }[]> {
        const events = JSON.parse((await this.frame.getByTestId('fth-api-events').textContent())!);
        return events.filter((event: { listener: string }) => event.listener === listener);
    }

    public async eventCount(listener: string, count: number): Promise<void> {
        await base.step(`Then ${this.name}'s ${listener} handler has exactly ${count} callbacks`, async () => {
            await expect.poll(async () => (await this.events(listener)).length).toBe(count);
        });
    }

    public async identity(): Promise<{ appId: string; instanceId: string }> {
        const { appMetadata } = await this.call('getInfo');
        return { appId: appMetadata.appId, instanceId: appMetadata.instanceId };
    }

    public async selectResolver(app: { appId: string; instanceId?: string }, intent?: string): Promise<void> {
        await base.step(
            `Resolve the intent to ${app.appId}${app.instanceId ? ' / ' + app.instanceId : ''}`,
            async () => {
                const instance = app.instanceId
                    ? `[data-app-instance-id="${app.instanceId}"]`
                    : ':not([data-app-instance-id])';
                await this.page
                    .locator(
                        `[automation-id="fdc3-app-resolver_app-selector"][data-app-id="${app.appId}"]${instance}${intent ? `[data-intent="${intent}"]` : ''}`,
                    )
                    .click();
            },
        );
    }
}

export async function check(title: string, actual: unknown, expected: unknown): Promise<void> {
    await base.step(`Then ${title}`, async () => {
        expect(actual).toEqual(expected);
    });
}
