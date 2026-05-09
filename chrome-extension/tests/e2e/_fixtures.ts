import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = resolve(__dirname, '../../dist');

/**
 * Playwright fixtures for loading the unpacked PaperFlow Chrome extension.
 *
 * Chrome MV3 extensions can't load in true headless mode — we use
 * launchPersistentContext with --load-extension. The extension's MV3
 * service worker exposes its dynamic ID via context.serviceWorkers().
 *
 * For Library-v2-specific fixtures (seedLibraryFixture etc.), see
 * tests/library-v2/e2e/_fixtures.ts.
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  readerPage: Page;
}>({
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(ctx);
    await ctx.close();
  },

  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = sw.url().split('/')[2];
    await use(id);
  },

  readerPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    // ?e2e=fake-paper bypasses arXiv/PDF loading and renders a stub Paper —
    // see reader/main.tsx:1696. Without this, Boot fails with "No #src= in URL".
    await page.goto(`chrome-extension://${extensionId}/reader/index.html?e2e=fake-paper`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });
    await use(page);
    await page.close();
  },
});

export const expect = test.expect;
