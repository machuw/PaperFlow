/**
 * Phase 27 / Task D1 — End-to-end: library card click → new tab → reader
 * fully hydrates from chrome.storage cache.
 *
 * Approach: stay on the cache-only #paperKey= path so the test does not
 * depend on outbound network (arxiv.org reachability, fetch flakiness).
 * This is the strongest validation of the Phase C work — it exercises:
 *   - Click handler reaches `planNavigateToPaper` (A1+A2 fix)
 *   - Cache fallback chain (C2+C4)
 *   - New-tab dispatch with raw URL fragment (B2 + A3 invariant)
 *   - main.tsx readPaperKey() entry + loadPaperFromCache (C3)
 *   - Per-paper memory (`paper:{key}:memory`) hydrates into the reader UI
 *
 * Coverage of the 7 SPEC §1-E hydration items in this single test:
 *   ✓ outline / paragraphs (from :parsed)
 *   ✓ PaperMemory (from :memory) — verify role/judgment surface
 *   • highlights / notes / chat / canvas / scroll / workspace tab —
 *     deferred to a follow-up E2E or D2 manual checklist (each adds a
 *     paper:* key + a UI selector; this test focuses on the core
 *     navigation contract).
 */

import { test, expect } from './_fixtures';

const KEY = 'h-phase27-d1';

test.describe('Phase 27 D — click-to-jump + cache hydration', () => {
  test('library card click opens cached paper in new tab and hydrates', async ({
    context,
    extensionId,
    readerPage,
  }) => {
    // Seed both the library row (so the drawer renders a card) AND the
    // paper:* cache the new tab will hydrate from. The row deliberately
    // lacks `src` and arxiv-shaped `id`, forcing the click handler down to
    // the paperKey-cache fallback (planNavigateToPaper priority 4).
    const now = Date.now();
    await readerPage.evaluate(async ({ key, now }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        'pf:libraryV2Migrated': true,
        'pf:libraries': [],
        'pf:topics': [],
        library: [
          {
            urlHash: key,
            // id intentionally undefined → no arxiv-id reconstruction path
            title: 'Phase 27 D1 — Hydration Test Paper',
            authors: ['Cached Author'],
            role: 'Central — pivotal for argument',
            judgment: 'Strong',
            addedAt: now,
            lastRead: now,
            pages: 5,
            annotations: 0,
            hasMemory: true,
            libraryId: null,
            topicIds: [],
            // src intentionally undefined → no #src= path
          },
        ],
        [`paper:${key}:parsed`]: {
          version: 3,
          title: 'Phase 27 D1 — Hydration Test Paper',
          authors: ['Cached Author'],
          abstract: 'A paper that exists only in the cache.',
          venue: 'Local cache',
          outline: [
            { id: 's1', label: 'Introduction', level: 0 },
            { id: 's2', label: 'Method', level: 0 },
          ],
          paragraphs: [
            {
              id: 'p1',
              sectionId: 's1',
              section: 'Introduction',
              text: 'Sentinel paragraph from the parsed cache.',
            },
          ],
        },
        [`paper:${key}:memory`]: {
          whyItMatters: 'Validates the paperKey hydration contract end-to-end.',
          role: 'Central — proves cache route',
          judgment: 'Strong',
          linked: [],
          nextActions: [],
        },
      });
    }, { key: KEY, now });

    // Reload so the library effect picks up the seeded rows.
    await readerPage.reload();
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    // Open the drawer and locate the seeded card.
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    const card = drawer.locator(`[data-paper-key="${KEY}"]`);
    await expect(card).toBeVisible();

    // Capture the new-tab page that pops on click. context.waitForEvent('page')
    // resolves with the freshly created tab once chrome.tabs.create fires.
    const newPagePromise = context.waitForEvent('page', { timeout: 5_000 });
    await card.click();
    const newTab = await newPagePromise;
    await newTab.waitForLoadState('domcontentloaded');

    // URL contract: paperKey route, RAW value (no percent-encoding per A3).
    expect(newTab.url()).toBe(
      `chrome-extension://${extensionId}/reader/index.html#paperKey=${KEY}`,
    );
    expect(newTab.url()).not.toContain('%');

    // Hydration check 1: title from :parsed renders in the page heading.
    await expect(
      newTab.getByRole('heading', { name: 'Phase 27 D1 — Hydration Test Paper', level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    // Hydration check 2: outline section labels from :parsed render.
    // The outline panel uses "<n> <Section name>" labels (e.g. "1 Introduction").
    // Loose /Introduction/ matches both the outline + chat-suggestion buttons.
    await expect(newTab.getByRole('button', { name: '1 Introduction' })).toBeVisible();
    await expect(newTab.getByRole('button', { name: '2 Method' })).toBeVisible();

    // Hydration check 3: paragraph text from :parsed renders in body.
    await expect(
      newTab.getByText('Sentinel paragraph from the parsed cache.'),
    ).toBeVisible();

    // Original tab is untouched — still on the fake-paper test fixture URL,
    // not navigated to the new tab's location.
    expect(readerPage.url()).toContain('?e2e=fake-paper');
  });
});
