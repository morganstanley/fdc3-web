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
    appSelector: 'fth-app-selector',
    desktopAgentSelector: 'fth-desktop-agent-selector',
    openInstanceBtn: 'fth-open-instance-btn',
    getAppMetadataBtn: 'fth-get-app-metadata-btn',
    findInstancesBtn: 'fth-find-instances-btn',
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

        // Start every test from a clean slate - clear out any pre-existing console output (e.g. from
        // the app directory/bridge connection logging that happens automatically on load) in both
        // default apps, so `verifyConsoleContains` assertions later in a test can't accidentally
        // match leftover output from container startup.
        await container.clearConsoles(['app-1-root', 'app-2-root']);

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

    /**
     * Selects `targetAppId` in the given app's app/instance selector dropdown (used by the
     * open/getAppMetadata/findInstances actions), waiting for the corresponding `<option>` to appear
     * first - the dropdown is populated asynchronously from the local app directory shortly after the
     * app loads (see `getSelectableApps` in `default-app.ts`), so it may not be populated yet. Options
     * are rendered using each app's fully qualified appId (e.g. `app-1-domain-A@localhost`), so
     * `targetAppId` (the short form) is matched as a prefix rather than selected verbatim.
     */
    private async selectTargetApp(appId: string, targetAppId: string): Promise<void> {
        const frame = this.frame(appId);
        const selector = frame.locator(`[automation-id="${AUTOMATION_ID.appSelector}"] select`);
        const option = selector.locator('option', { hasText: new RegExp(`^${targetAppId}(@|$)`) });

        await expect(option).toBeAttached();
        await selector.selectOption(await option.first().innerText());
    }

    /**
     * Selects `desktopAgent` (or `undefined` for the "local (no desktopAgent)" option) in the given
     * app's "Open on Desktop Agent" dropdown, waiting for it to appear first - it is populated
     * asynchronously via a `findInstances()` call triggered by the app selector's `change` event (see
     * `onAppSelectorChanged` in `default-app.ts`), so it may not have refreshed yet.
     * @param appId The appId of the app whose desktop agent dropdown should be set.
     * @param desktopAgent The desktop agent name to select, or `undefined`/omitted to select the local option.
     */
    private async selectDesktopAgent(appId: string, desktopAgent?: string): Promise<void> {
        const frame = this.frame(appId);
        const selector = frame.locator(`[automation-id="${AUTOMATION_ID.desktopAgentSelector}"] select`);

        if (desktopAgent == null) {
            await selector.selectOption('local (no desktopAgent)');
            return;
        }

        const option = selector.locator('option', { hasText: desktopAgent });
        await expect(option).toBeAttached();
        await selector.selectOption(await option.first().innerText());
    }

    /**
     * Calls `fdc3.open()` (via the "Open" button) from the given app to open a new instance of
     * `targetAppId`, using the app/instance selector dropdown populated from the local app directory
     * (see `renderAppAndInstanceInfoSection`/`getSelectableApps` in `default-app.ts` - this dropdown
     * is always sourced from the *local* app directory, never bridge-merged, so this call opens a new
     * instance within the *same* container regardless of bridged/non-bridged mode).
     *
     * To open a new instance on a *specific, remote* bridged Desktop Agent instead, pass its name as
     * `options.desktopAgent` - this selects it in the "Open on Desktop Agent" dropdown first, which is
     * populated by calling `findInstances()` for `targetAppId` and extracting/deduplicating each
     * returned instance's `desktopAgent` (see `updateDesktopAgentsForSelectedApp` in `default-app.ts`).
     * This requires at least one instance of `targetAppId` to already be open on that remote agent -
     * call {@link findInstances} (or open one) first if needed.
     * @param appId The appId of the app that should call `open()`.
     * @param targetAppId The appId (from the app directory) to open a new instance of.
     * @param options.desktopAgent When given, targets this specific bridged Desktop Agent rather than opening locally.
     */
    public async open(appId: string, targetAppId: string, options: { desktopAgent?: string } = {}): Promise<void> {
        await this.selectTargetApp(appId, targetAppId);
        await this.selectDesktopAgent(appId, options.desktopAgent);
        await this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.openInstanceBtn}"]`).click();
    }

    /**
     * Waits for the given app's "Open on Desktop Agent" dropdown to be populated with at least one
     * remote `desktopAgent` option (beyond the always-present "local (no desktopAgent)" one), then
     * returns all of the discovered remote agent names. The dropdown is populated asynchronously via
     * a `findInstances()` call (see {@link findInstances}/`onAppSelectorChanged` in `default-app.ts`),
     * so this should be called *after* triggering that (e.g. via {@link findInstances}) rather than
     * immediately reading the dropdown, which may not have updated yet.
     * @param appId The appId of the app whose desktop agent dropdown options should be waited on/read.
     * @param options.timeout Optional override for how long to wait, in milliseconds.
     */
    public async getDesktopAgentOptions(appId: string, options: { timeout?: number } = {}): Promise<string[]> {
        const remoteOptions = this.frame(appId).locator(
            `[automation-id="${AUTOMATION_ID.desktopAgentSelector}"] select option:not(:text-is("local (no desktopAgent)"))`,
        );

        await expect(remoteOptions.first()).toBeAttached({ timeout: options.timeout });

        return await remoteOptions.allInnerTexts();
    }

    /**
     * Calls `fdc3.getAppMetadata()` (via the "Get Metadata" button) from the given app for
     * `targetAppId`, logging the result to the calling app's console.
     * @param appId The appId of the app that should call `getAppMetadata()`.
     * @param targetAppId The appId (from the app directory) to fetch metadata for.
     */
    public async getAppMetadata(appId: string, targetAppId: string): Promise<void> {
        await this.selectTargetApp(appId, targetAppId);
        await this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.getAppMetadataBtn}"]`).click();
    }

    /**
     * Calls `fdc3.findInstances()` (via the "Find Instances" button) from the given app for
     * `targetAppId`, logging the result to the calling app's console.
     * @param appId The appId of the app that should call `findInstances()`.
     * @param targetAppId The appId (from the app directory) to find open instances of.
     */
    public async findInstances(appId: string, targetAppId: string): Promise<void> {
        await this.selectTargetApp(appId, targetAppId);
        await this.frame(appId).locator(`[automation-id="${AUTOMATION_ID.findInstancesBtn}"]`).click();
    }
}
