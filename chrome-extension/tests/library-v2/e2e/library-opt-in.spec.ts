/**
 * Phase 28 / Plan 04 — E2E: Library opt-in Add/Remove flows.
 *
 * Covers D-16 acceptance scenarios:
 *   1. happy-path: open → Add → close tab → reopen → already Added
 *   2. ephemeral-after-delete: Add → confirm Move out → reopen returns to Add state
 *
 * Verifies:
 *   - LIB-OPTIN-02: opening the reader does NOT auto-save a library row
 *   - LIB-OPTIN-05: remove path (ConfirmModal) deletes the row; reopen stays unAdded
 *   - LIB-OPTIN-07: at least 1 e2e scenario covers the cross-tab + persistence contract
 *
 * Fixtures: reuses `_fixtures.ts` from this directory — no new fixture infra.
 */

import { test, expect } from './_fixtures';

/**
 * Lock extension locale to 'en' so button text assertions match
 * English i18n strings regardless of the CI machine's system locale.
 *
 * Called before each page navigation in scenarios that use manual
 * context.newPage() instead of the `readerPage` fixture.
 */
async function lockLocaleEn(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.local.set({ config_uiLanguage: 'en' });
  });
}

/**
 * Clear chrome.storage.local completely so each test starts from
 * a known empty state (no residual library rows from prior tests).
 */
async function clearStorage(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.local.clear();
  });
}

test.describe('Phase 28: Library opt-in', () => {
  /**
   * Scenario 1 — Happy-path persistence
   *
   * Open reader → verify no auto-save → click Add → verify "Added" state +
   * storage write → close tab → reopen → verify "Added" state survives reload.
   */
  test('happy-path: open → Add → close → reopen → already Added', async ({
    context,
    extensionId,
  }) => {
    // --- Step 1: Open reader fresh, start from empty storage ---
    const page = await context.newPage();
    // Temporarily go to a chrome page so we have an extension context for
    // chrome.storage.local.clear() before loading the reader.
    await page.goto(`chrome-extension://${extensionId}/reader/index.html?e2e=fake-paper`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });

    // Clear any residual library state from previous tests
    await clearStorage(page);
    // Lock locale to English for stable button-text assertions
    await lockLocaleEn(page);

    // Reload after clearing + locale lock so reader boots with clean state
    await page.reload();
    await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });

    // --- Step 2: Verify LIB-OPTIN-02 — opening did NOT auto-save a library row ---
    const libraryBefore = await page.evaluate(async () => {
      const r = await chrome.storage.local.get('library');
      return r.library ?? null;
    });
    // Either null/undefined (never written) or empty array — both prove no auto-save.
    expect(Array.isArray(libraryBefore) ? libraryBefore.length : 0).toBe(0);

    // --- Step 3: Add button is visible with "Add to Library" label ---
    const addBtn = page.getByRole('button', { name: /Add to Library/i });
    await expect(addBtn).toBeVisible();

    // --- Step 4: Click Add ---
    await addBtn.click();

    // --- Step 5: Button flips to "Added" ---
    await expect(page.getByRole('button', { name: /^Added$/i })).toBeVisible();

    // --- Step 6: Library row written to chrome.storage.local ---
    const libraryAfter = await page.evaluate(async () => {
      const r = await chrome.storage.local.get('library');
      return r.library as Array<{ urlHash: string }> | undefined;
    });
    expect(Array.isArray(libraryAfter)).toBe(true);
    expect(libraryAfter!.length).toBe(1);
    // Confirm row matches the fake paper's urlHash (e2e-fake-paper)
    expect(libraryAfter![0].urlHash).toBe('e2e-fake-paper');

    // --- Step 7: Close tab ---
    await page.close();

    // --- Step 8: Reopen in a new tab at the same URL ---
    const page2 = await context.newPage();
    await page2.goto(`chrome-extension://${extensionId}/reader/index.html?e2e=fake-paper`);
    await page2.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });

    // --- Step 9: Button is already in "Added" state on reopen ---
    // (isInLibrary state derived from chrome.storage.local on mount — LIB-OPTIN-07 round-trip)
    await expect(page2.getByRole('button', { name: /^Added$/i })).toBeVisible();

    await page2.close();
  });

  /**
   * Scenario 2 — Ephemeral-after-delete
   *
   * Open reader → Add → confirm Move out via ConfirmModal → verify unAdded state
   * + storage emptied → reload → verify unAdded state persists (no auto-readd) →
   * Add again (idempotent re-add).
   */
  test('ephemeral-after-delete: Add → confirm Move out → reopen returns to Add state', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader/index.html?e2e=fake-paper`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });

    // Clear residual state + lock locale
    await clearStorage(page);
    await lockLocaleEn(page);

    await page.reload();
    await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });

    // --- Step 1: Add the paper ---
    const addBtn = page.getByRole('button', { name: /Add to Library/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.getByRole('button', { name: /^Added$/i })).toBeVisible();

    // --- Step 2: Click "Added" → ConfirmModal opens ---
    await page.getByRole('button', { name: /^Added$/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // --- Step 3: Modal body contains D-04 reassurance language ---
    // Length-based sanity check — the en confirm-remove-body is >80 chars.
    const bodyText = await modal.textContent();
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(30);

    // --- Step 4: Click the danger button ("Move out") ---
    await modal.getByRole('button', { name: /Move out/i }).click();

    // --- Step 5: Modal closes; button reverts to "Add to Library" (LIB-OPTIN-05) ---
    await expect(modal).not.toBeVisible();
    const addBtnAfterRemove = page.getByRole('button', { name: /Add to Library/i });
    await expect(addBtnAfterRemove).toBeVisible();

    // --- Step 6: Library storage is emptied ---
    const afterRemoveLen = await page.evaluate(async () => {
      const r = await chrome.storage.local.get('library');
      return (r.library as Array<unknown> ?? []).length;
    });
    expect(afterRemoveLen).toBe(0);

    // --- Step 7: Reload — delete persists (no auto-readd on open) ---
    await page.reload();
    await page.locator('#root').waitFor({ state: 'visible', timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Add to Library/i })).toBeVisible();

    // --- Step 8: Re-Add succeeds idempotently ---
    await page.getByRole('button', { name: /Add to Library/i }).click();
    await expect(page.getByRole('button', { name: /^Added$/i })).toBeVisible();

    await page.close();
  });
});
