/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** automation-id values used across the test-harness UI - see `automation-id` attributes added to each element. */
const AUTOMATION_ID = {
    appContainer: 'fth-app-container',
    appIframe: 'fth-app-iframe',
    raiseIntentBtn: 'fth-raise-intent-btn',
    consoleClearBtn: 'fth-console-clear-btn',
    console: 'fth-console',
    resolverAppSelector: 'fdc3-app-resolver_app-selector',
} as const;

/**
 * Builds a CSS attribute selector fragment matching `data-app-id` against either the exact `appId`
 * given, or its fully qualified form (apps are registered in the FDC3 app directory as
 * `${appId}@${host}`, e.g. `app-1-root` becomes `app-1-root@localhost` once resolved - see
 * `mapUrlToFullyQualifiedAppId` in `@morgan-stanley/fdc3-web`). This lets tests refer to apps using
 * the short id from `test-harness.config.json` regardless of which form has been rendered.
 */
function dataAppIdSelector(appId: string): string {
    return `[data-app-id="${appId}"], [data-app-id^="${appId}@"]`;
}

export interface RaiseIntentOptions {
    /** The intent to raise. Defaults to whichever intent is currently selected in the intent dropdown. */
    intent?: string;
    /** The context type/value to raise the intent with. Defaults to whatever is currently in the context input. */
    context?: string;
}

export interface SelectAppInResolverOptions {
    /**
     * When `true`, selects the entry hosted by a *remote* Desktop Agent (i.e. reached via bridging -
     * rendered with a `data-desktop-agent` attribute). When `false` (default), selects the entry
     * hosted by the local Desktop Agent (no `data-desktop-agent` attribute).
     */
    remote?: boolean;
}

/**
 * Page Object / helper wrapper around a single instance of the FDC3 Test Harness "container" - i.e. a
 * single browser tab/page navigated to `index.html` (optionally with `?bridge=true`).
 *
 * A container hosts one or more top level apps (by default `app-1-root` and `app-2-root`), each
 * rendered inside its own `<app-container>`/`<iframe>`. These helpers locate a given app by the
 * `data-app-id` attribute that `app-container` renders on both its wrapper `<div>` and its `<iframe>`
 * (see `projects/test-harness/src/root-app/app-container.ts`), so tests can be written purely in
 * terms of `appId`s instead of brittle CSS/DOM structure.
 *
 * Example of writing a new automation test using these helpers:
 * ```ts
 * const containerA = await TestHarnessContainer.open(pageA, { bridge: true });
 * const containerB = await TestHarnessContainer.open(pageB, { bridge: true });
 *
 * await containerA.clearConsole('app-1-root');
 * await containerA.raiseIntent('app-1-root');
 * await containerA.selectAppInResolver('app-1-domain-A', { remote: true });
 *
 * await containerB.verifyAppOpen('app-1-domain-A');
 * ```
 */
export class TestHarnessContainer {
    private constructor(private readonly page: Page) {}

    /**
     * Navigates the given page to the test harness root app and waits for it to be ready.
     * @param page The Playwright page to navigate.
     * @param options.bridge When `true` (default), opts the container in to Desktop Agent Bridging via `?bridge=true`.
     */
    public static async open(page: Page, options: { bridge?: boolean } = {}): Promise<TestHarnessContainer> {
        const bridge = options.bridge ?? true;
        const url = `/index.html${bridge ? '?bridge=true' : ''}`;

        await page.goto(url);

        const container = new TestHarnessContainer(page);

        // The two default apps (app-1-root/app-2-root) are opened automatically once the app
        // directory has loaded - wait for both so tests can rely on them being present immediately.
        await container.verifyApps(['app-1-root', 'app-2-root']);

        return container;
    }

    /**
     * Locates the `<app-container>` element hosting the given appId, wherever it is currently
     * rendered at the root level of this container (i.e. not nested inside another app's iframe).
     */
    private appContainer(appId: string): Locator {
        return this.page.locator(`[automation-id="${AUTOMATION_ID.appContainer}"]:is(${dataAppIdSelector(appId)})`);
    }

    /**
     * Returns a `FrameLocator` for the iframe hosting the given appId, so its internal UI
     * (buttons, console, etc.) can be interacted with.
     */
    public frame(appId: string): FrameLocator {
        return this.page.frameLocator(
            `iframe[automation-id="${AUTOMATION_ID.appIframe}"]:is(${dataAppIdSelector(appId)})`,
        );
    }

    /**
     * Clears the console of the given app (clicks the console's "Clear" button).
     * @param appId The appId of the app whose console should be cleared.
     */
    public async clearConsole(appId: string): Promise<void> {
        await this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.consoleClearBtn}"]`).click();
    }

    /**
     * Clears the consoles of multiple apps in this container.
     * @param appIds The appIds of the apps whose consoles should be cleared.
     */
    public async clearConsoles(appIds: string[]): Promise<void> {
        for (const appId of appIds) {
            await this.clearConsole(appId);
        }
    }

    /**
     * Clicks the "Raise Intent" button for the given app, optionally first selecting a specific
     * intent and/or setting the context to raise it with.
     * @param appId The appId of the app that should raise the intent.
     * @param options Optional intent/context overrides. When omitted, whatever is currently selected/entered in the UI is used.
     */
    public async raiseIntent(appId: string, options: RaiseIntentOptions = {}): Promise<void> {
        const frame = this.frame(appId);

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        if (options.intent != null) {
            await frame.locator('#intent-selector select').selectOption(options.intent);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.raiseIntentBtn}"]`).click();
    }

    /**
     * Selects an app from the FDC3 App Resolver popup that opens when a raised intent has multiple
     * candidate apps. The resolver is rendered at the root of the container's document (not inside an
     * app iframe), since it belongs to the container's own Desktop Agent/UI provider.
     * @param appId The appId of the app to select in the resolver.
     * @param options.remote When `true`, selects the instance of `appId` hosted by a remote Desktop Agent (bridged) rather than the local one.
     */
    public async selectAppInResolver(appId: string, options: SelectAppInResolverOptions = {}): Promise<void> {
        const remoteFilter = options.remote ? '[data-desktop-agent]' : ':not([data-desktop-agent])';

        await this.page
            .locator(
                `[automation-id="${AUTOMATION_ID.resolverAppSelector}"]${remoteFilter}:is(${dataAppIdSelector(appId)})`,
            )
            .first()
            .click();
    }

    /**
     * Waits for an app with the given appId to be open (rendered) at the root level of this container.
     * @param appId The appId to wait for.
     * @param options.timeout Optional override for how long to wait, in milliseconds.
     */
    public async verifyAppOpen(appId: string, options: { timeout?: number } = {}): Promise<void> {
        await expect(this.appContainer(appId)).toBeAttached({ timeout: options.timeout });
    }

    /**
     * Waits for every appId in the given list to be open (rendered) at the root level of this container.
     * @param appIds The appIds to wait for.
     * @param options.timeout Optional override for how long to wait, in milliseconds.
     */
    public async verifyApps(appIds: string[], options: { timeout?: number } = {}): Promise<void> {
        for (const appId of appIds) {
            await this.verifyAppOpen(appId, options);
        }
    }

    /**
     * Returns the current text content of the given app's console.
     * @param appId The appId of the app whose console text should be returned.
     */
    public async getConsoleText(appId: string): Promise<string> {
        return (await this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.console}"]`).innerText()).trim();
    }

    /**
     * Waits for the given app's console to contain text matching `pattern`.
     * @param appId The appId of the app whose console should be checked.
     * @param pattern A string (substring match) or regular expression to match against the console text.
     * @param options.timeout Optional override for how long to wait, in milliseconds.
     */
    public async verifyConsoleContains(
        appId: string,
        pattern: string | RegExp,
        options: { timeout?: number } = {},
    ): Promise<void> {
        await expect(this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.console}"]`)).toContainText(pattern, {
            timeout: options.timeout,
        });
    }
}
