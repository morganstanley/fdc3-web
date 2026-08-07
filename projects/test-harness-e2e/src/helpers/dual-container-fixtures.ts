/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { type BrowserContext, type Page, test as base } from '@playwright/test';

/**
 * Tests in this suite need two independent contexts (each acting like a separate browser/machine
 * connecting to its own Desktop Agent), so a single test can't rely solely on Playwright's default
 * `context`/`page` fixtures - those only ever provide one context per test.
 *
 * Container A uses Playwright's own default `context`/`page` fixtures unchanged, which already read
 * `viewport`/`video`/`screenshot` etc. from the project's `use` config and handle attaching
 * video/screenshots to the HTML report automatically.
 *
 * `contextB`/`pageB` below provide an equivalent *second* context/page, mirroring that same
 * automatic behaviour (viewport, video recording) by reading the same `use` config, rather than
 * duplicating hardcoded values in individual spec files. Screenshots are intentionally *not*
 * duplicated here - Playwright's built-in `screenshot: 'on'` already captures one screenshot per page
 * (both A and B) automatically, so attaching another one for `pageB` would just add a confusing
 * third/fourth image to the report.
 */
export const test = base.extend<{ contextB: BrowserContext; pageB: Page }>({
    contextB: async ({ browser }, use, testInfo) => {
        const { viewport, video } = testInfo.project.use;
        const recordVideo =
            video != null && video !== 'off'
                ? { dir: testInfo.outputPath('video-b'), size: viewport ?? undefined }
                : undefined;

        const context = await browser.newContext({ viewport, recordVideo });
        await use(context);

        // Capture page references *before* closing the context - `context.pages()` returns an empty
        // array once the context is closed, and video recording is only fully flushed to disk once
        // the context (not just its pages) closes, so `page.video().path()` must be read afterwards.
        const pages = context.pages();
        await context.close();

        if (video != null && video !== 'off') {
            for (const page of pages) {
                const videoPath = await page.video()?.path();
                if (videoPath != null) {
                    await testInfo.attach('pageB.webm', { path: videoPath, contentType: 'video/webm' });
                }
            }
        }
    },
    pageB: async ({ contextB }, use) => {
        const page = await contextB.newPage();
        await use(page);
    },
});

export { expect } from '@playwright/test';
