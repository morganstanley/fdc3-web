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
 * Tests in this suite sometimes need a second, independent context (acting like a separate
 * browser/machine connecting to its own Desktop Agent) - e.g. bridged-mode tests need a "container B"
 * that is distinct from container A. Non-bridged tests, on the other hand, never need one (there's no
 * bridge for a second container's Desktop Agent to connect to), so that second context shouldn't be
 * created/wasted at all in that mode.
 *
 * Playwright decides whether a fixture is "used" by a test purely from the fixture names destructured
 * in that test's parameter list - it does not look at conditionals inside the test body. So exposing
 * an actual `pageB`/`contextB` *value* fixture (as earlier revisions of this file did) would mean
 * Playwright spins up the second context/video recorder for *every* test that destructures it, even
 * if the test's own logic never ends up needing it (e.g. because it's running in non-bridged mode).
 *
 * `openPageB` below instead exposes a *factory function* fixture - the second context/page is only
 * actually created the first time (and only if) a test calls `await openPageB()`. Container A keeps
 * using Playwright's own default `context`/`page` fixtures unchanged, which already read
 * `viewport`/`video`/`screenshot` etc. from the project's `use` config and handle attaching
 * video/screenshots to the HTML report automatically; `openPageB` mirrors that same automatic
 * behaviour (viewport, video recording) for the page(s) it creates. Screenshots are intentionally
 * *not* duplicated here - Playwright's built-in `screenshot: 'on'` already captures one screenshot per
 * page automatically, so attaching another one for pageB would just add a confusing extra image to
 * the report.
 */
export const test = base.extend<{ openPageB: () => Promise<Page> }>({
    openPageB: async ({ browser }, use, testInfo) => {
        let context: BrowserContext | undefined;

        await use(async () => {
            const { viewport, video } = testInfo.project.use;
            const recordVideo =
                video != null && video !== 'off'
                    ? { dir: testInfo.outputPath('video-b'), size: viewport ?? undefined }
                    : undefined;

            context = await browser.newContext({ viewport, recordVideo });
            return context.newPage();
        });

        if (context != null) {
            const { video } = testInfo.project.use;

            // Capture page references *before* closing the context - `context.pages()` returns an
            // empty array once the context is closed, and video recording is only fully flushed to
            // disk once the context (not just its pages) closes, so `page.video().path()` must be
            // read afterwards.
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
        }
    },
});

export { expect } from '@playwright/test';
