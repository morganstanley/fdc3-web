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
    raiseIntentForContextBtn: 'fth-raise-intent-for-context-btn',
    findIntentBtn: 'fth-find-intent-btn',
    findIntentsByContextBtn: 'fth-find-intents-by-context-btn',
    addContextListenerBtn: 'fth-add-context-listener-btn',
    broadcastBtn: 'fth-broadcast-btn',
    broadcastChannelSelector: 'fth-broadcast-channel-selector',
    channelsToggleBtn: 'fth-channels-toggle-btn',
    channelSelectorToggleBtn: 'fth-channel-selector-toggle-btn',
    channelSelectorBtn: 'fth-channel-selector-btn',
    consoleClearBtn: 'fth-console-clear-btn',
    console: 'fth-console',
    resolverAppSelector: 'fdc3-app-resolver_app-selector',
    appSelector: 'fth-app-selector',
    desktopAgentSelector: 'fth-desktop-agent-selector',
    openInstanceBtn: 'fth-open-instance-btn',
    getAppMetadataBtn: 'fth-get-app-metadata-btn',
    findInstancesBtn: 'fth-find-instances-btn',
    intentListenerSelector: 'fth-intent-listener-selector',
    addIntentListenerBtn: 'fth-add-intent-listener-btn',
    eventTypeSelector: 'fth-event-type-selector',
    addEventListenerBtn: 'fth-add-event-listener-btn',
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
     * Clicks the "Raise Intent for Context" button for the given app, optionally first setting the
     * context to raise it with. Unlike {@link raiseIntent}, no specific intent is chosen up front -
     * `fdc3.raiseIntentForContext()` lets the Desktop Agent/resolver pick from every intent
     * registered against the given context type.
     * @param appId The appId of the app that should raise the intent for context.
     * @param options.context Optional context type override. When omitted, whatever is currently entered in the UI is used.
     */
    public async raiseIntentForContext(appId: string, options: { context?: string } = {}): Promise<void> {
        const frame = this.frame(appId);

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.raiseIntentForContextBtn}"]`).click();
    }

    /**
     * Calls `fdc3.addIntentListener()` (via the "Add" button in the "Add Intent Listener" section)
     * from the given app, for the given intent (selected from the dropdown of intents not already
     * listened for). Once registered, the app will log `Received Intent::` whenever that intent is
     * raised at it, and will return an `ms.test-harness.raiseIntentResult` context as the result.
     * @param appId The appId of the app that should add the intent listener.
     * @param intent The intent to add a listener for, e.g. `"StartCall"`.
     */
    public async addIntentListener(appId: string, intent: string): Promise<void> {
        const frame = this.frame(appId);

        await frame.locator(`[automation-id="${AUTOMATION_ID.intentListenerSelector}"] select`).selectOption(intent);
        await frame.locator(`[automation-id="${AUTOMATION_ID.addIntentListenerBtn}"]`).click();
    }

    /**
     * Calls `fdc3.addEventListener()` (via the "Add" button in the "Add Event Listener" section)
     * from the given app, for the given event type. Once registered, the app will log
     * `Received Event::` whenever a matching FDC3 event occurs (e.g. `userChannelChanged` after
     * {@link joinUserChannel}/`leaveCurrentChannel()` is called).
     * @param appId The appId of the app that should add the event listener.
     * @param eventType The event type to listen for - `"userChannelChanged"` or `"all events"` (adds a listener for every FDC3 event type, passing `null` to `addEventListener()`).
     */
    public async addEventListener(appId: string, eventType: 'userChannelChanged' | 'all events'): Promise<void> {
        const frame = this.frame(appId);

        await frame.locator(`[automation-id="${AUTOMATION_ID.eventTypeSelector}"] select`).selectOption(eventType);
        await frame.locator(`[automation-id="${AUTOMATION_ID.addEventListenerBtn}"]`).click();
    }

    /**
     * Calls `fdc3.findIntent()` (via the "Find Intent" button) from the given app, optionally first
     * selecting a specific intent and/or setting the context to find it with, logging the resulting
     * `AppIntent` to the calling app's console.
     * @param appId The appId of the app that should call `findIntent()`.
     * @param options Optional intent/context overrides. When omitted, whatever is currently selected/entered in the UI is used.
     */
    public async findIntent(appId: string, options: RaiseIntentOptions = {}): Promise<void> {
        const frame = this.frame(appId);

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        if (options.intent != null) {
            await frame.locator('#intent-selector select').selectOption(options.intent);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.findIntentBtn}"]`).click();
    }

    /**
     * Calls `fdc3.findIntentsByContext()` (via the "Find Intents By Context" button) from the given
     * app, optionally first setting the context to find intents for, logging the resulting
     * `AppIntent[]` to the calling app's console.
     * @param appId The appId of the app that should call `findIntentsByContext()`.
     * @param options.context Optional context type override. When omitted, whatever is currently entered in the UI is used.
     */
    public async findIntentsByContext(appId: string, options: { context?: string } = {}): Promise<void> {
        const frame = this.frame(appId);

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.findIntentsByContextBtn}"]`).click();
    }

    /**
     * Expands the given app's collapsible "Channels" panel (containing the broadcast/context
     * listener/private-channel controls), if it isn't already expanded. The panel starts collapsed
     * (`display: none`) - see `renderChannelsSection`/`toggleChannelCollapsibleBody` in
     * `default-app.ts` - so any interaction with its contents must expand it first.
     */
    private async expandChannelsSection(appId: string): Promise<void> {
        const frame = this.frame(appId);
        const body = frame.locator('#channel-collapsible-body');

        if (!(await body.isVisible())) {
            await frame.locator(`[automation-id="${AUTOMATION_ID.channelsToggleBtn}"]`).click();
            await expect(body).toBeVisible();
        }
    }

    /**
     * Joins the given app to a user channel via the `<ms-channel-selector>` widget: clicks the
     * channel indicator to reveal the channel buttons (if not already revealed), then clicks the
     * button for the given channel id.
     * @param appId The appId of the app that should join the channel.
     * @param channelId The id of the user channel to join, e.g. `"fdc3.channel.1"`.
     */
    public async joinUserChannel(appId: string, channelId: string): Promise<void> {
        const frame = this.frame(appId);
        const channelBtn = frame.locator(
            `[automation-id="${AUTOMATION_ID.channelSelectorBtn}"][data-channel-id="${channelId}"]`,
        );

        if (!(await channelBtn.isVisible())) {
            await frame.locator(`[automation-id="${AUTOMATION_ID.channelSelectorToggleBtn}"]`).click();
            await expect(channelBtn).toBeVisible();
        }

        await channelBtn.click();
    }

    /**
     * Calls `fdc3.addContextListener()` (via the "Add Context Listener" button) from the given app,
     * optionally first selecting a specific channel to listen on and/or setting the context type to
     * listen for. Passing no context type (or an empty string, the UI default) adds a listener for
     * all context types.
     * @param appId The appId of the app that should add the context listener.
     * @param options.channel The channel to add the listener to - `"current user channel"` (default, the UI's own default selection) or the id of a previously created/joined app channel/private channel.
     * @param options.context The context type to listen for. Omit (or pass an empty string) to listen for all context types.
     */
    public async addContextListener(
        appId: string,
        options: { channel?: string; context?: string } = {},
    ): Promise<void> {
        await this.expandChannelsSection(appId);
        const frame = this.frame(appId);

        if (options.channel != null) {
            await frame
                .locator(`[automation-id="${AUTOMATION_ID.broadcastChannelSelector}"] select`)
                .selectOption(options.channel);
        }

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.addContextListenerBtn}"]`).click();
    }

    /**
     * Calls `fdc3.broadcast()` (via the "Broadcast" button) from the given app, optionally first
     * selecting a specific channel to broadcast on and/or setting the context type/value to
     * broadcast.
     * @param appId The appId of the app that should broadcast.
     * @param options.channel The channel to broadcast on - `"current user channel"` (default, the UI's own default selection) or the id of a previously created/joined app channel/private channel.
     * @param options.context The context type to broadcast. Defaults to whatever is currently entered in the UI.
     */
    public async broadcast(appId: string, options: { channel?: string; context?: string } = {}): Promise<void> {
        await this.expandChannelsSection(appId);
        const frame = this.frame(appId);

        if (options.channel != null) {
            await frame
                .locator(`[automation-id="${AUTOMATION_ID.broadcastChannelSelector}"] select`)
                .selectOption(options.channel);
        }

        if (options.context != null) {
            await frame.locator('#context-input').fill(options.context);
        }

        await frame.locator(`[automation-id="${AUTOMATION_ID.broadcastBtn}"]`).click();
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
