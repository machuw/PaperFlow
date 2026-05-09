import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = resolve(__dirname, '../../../dist');

/**
 * Playwright fixtures for loading the unpacked Chrome extension.
 *
 * Chrome MV3 extensions can't load in true headless mode. We use
 * launchPersistentContext with --load-extension. The extension's MV3
 * service worker exposes its dynamic ID via context.serviceWorkers().
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
    await page.goto(`chrome-extension://${extensionId}/reader/index.html?e2e=fake-paper`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });
    await use(page);
    await page.close();
  },
});

export const expect = test.expect;

/**
 * Seed `chrome.storage.local` with a Library v2 fixture. Runs in the
 * extension page context so `chrome.storage.local.set` is available.
 *
 * Returns the seeded state — useful for assertions on initial counts.
 */
export async function seedLibraryFixture(page: Page, opts?: {
  libraries?: Array<{ id: string; name: string }>;
  topics?: Array<{ id: string; name: string }>;
  rows?: Array<{
    urlHash: string;
    title: string;
    libraryId?: string | null;
    topicIds?: string[];
  }>;
}) {
  const libraries = opts?.libraries ?? [];
  const topics = opts?.topics ?? [];
  const rows = opts?.rows ?? [];

  await page.evaluate(async ({ libraries, topics, rows }) => {
    const now = Date.now();
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      'pf:libraryV2Migrated': true,
      'pf:libraries': libraries.map((l) => ({ ...l, createdAt: now })),
      'pf:topics': topics.map((t) => ({ ...t, createdAt: now })),
      library: rows.map((r) => ({
        urlHash: r.urlHash,
        title: r.title,
        authors: [],
        role: '',
        judgment: '',
        addedAt: now,
        lastRead: now,
        pages: 0,
        annotations: 0,
        hasMemory: false,
        libraryId: r.libraryId ?? null,
        topicIds: r.topicIds ?? [],
      })),
    });
  }, { libraries, topics, rows });

  await page.reload();
  await page.locator('#root').waitFor({ state: 'visible' });
}
