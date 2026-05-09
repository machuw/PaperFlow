import { test, expect, seedLibraryFixture } from './_fixtures';

test.describe('Library v2 — E2E smoke', () => {
  test('extension loads + reader root mounts', async ({ readerPage }) => {
    await expect(readerPage.locator('#root')).toBeVisible();
  });

  test('extensionId fixture resolves to the MV3 service worker URL', async ({ extensionId }) => {
    expect(extensionId).toMatch(/^[a-z]{32}$/);
  });

  test('seedLibraryFixture round-trips through chrome.storage.local', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4' }],
      topics: [{ id: 't1', name: 'VLA' }],
      rows: [{ urlHash: 'a', title: 'Paper A', libraryId: 'l1' }],
    });
    const state = await readerPage.evaluate(async () => {
      const all = await chrome.storage.local.get(['pf:libraries', 'pf:topics', 'library']);
      return all;
    });
    expect(state['pf:libraries']).toHaveLength(1);
    expect(state['pf:topics']).toHaveLength(1);
    expect((state.library as Array<{ libraryId: string }>)[0].libraryId).toBe('l1');
  });
});
