import { test, expect, seedLibraryFixture } from './_fixtures';

test.describe('Library v2 — keyboard + screen reader', () => {
  test('F2 on user-created row enters inline rename mode (input focused, value pre-filled)', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4 Reading' }],
      topics: [],
      rows: [{ urlHash: 'paper-a', title: 'Paper A', libraryId: 'l1' }],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    // Focus the user-created library row, press F2
    const row = drawer.getByLabel(/Q4 Reading, 1 papers/);
    await row.focus();
    await readerPage.keyboard.press('F2');

    // Inline rename input appears, pre-filled with current name
    const renameInput = drawer.getByLabel(/Rename library Q4 Reading/);
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('Q4 Reading');
    await expect(renameInput).toBeFocused();
  });

  test('Backspace inside the search input deletes a character (does not trigger destructive action)', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4 Reading' }],
      topics: [],
      rows: [{ urlHash: 'paper-a', title: 'Paper A', libraryId: 'l1' }],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    const search = drawer.getByPlaceholder(/Search title, author/);
    await search.fill('test');
    await search.press('Backspace');
    await expect(search).toHaveValue('tes');

    // Library catalog still has Q4 Reading — nothing destructive happened
    await expect(drawer.getByLabel(/Q4 Reading, 1 papers/)).toBeVisible();
  });

  test('Esc closes the inline rename input without persisting', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4' }],
      topics: [],
      rows: [],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    const row = drawer.getByLabel(/Q4, 0 papers/);
    await row.focus();
    await readerPage.keyboard.press('F2');
    const input = drawer.getByLabel(/Rename library Q4/);
    await input.fill('Q4 New');
    await input.press('Escape');

    // Input gone, original name preserved
    await expect(input).toBeHidden();
    await expect(drawer.getByLabel(/Q4, 0 papers/)).toBeVisible();
  });

  test('Sidebar selection change updates aria-live region with scope name + count', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4' }],
      topics: [{ id: 't1', name: 'VLA' }],
      rows: [
        { urlHash: 'paper-a', title: 'Paper A', libraryId: 'l1', topicIds: ['t1'] },
        { urlHash: 'paper-b', title: 'Paper B' },
      ],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    // Click # VLA in sidebar
    await drawer.getByLabel(/Topic VLA/).click();

    // ScopeLiveRegion is a visually-hidden polite announcer.
    // It debounces 150ms before updating, so wait for the text.
    const live = drawer.locator('[aria-live="polite"]');
    await expect(live).toContainText(/Showing 1 papers in topic VLA/i, { timeout: 2_000 });
  });

  test('ConfirmModal initial focus is Cancel; Esc closes (when not in flight)', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [{ id: 'l1', name: 'Q4' }],
      topics: [],
      rows: [{ urlHash: 'paper-a', title: 'Paper A', libraryId: 'l1' }],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');

    // Open ⋯ menu on Q4, click Delete
    await drawer.getByLabel(/More actions for Q4/).click();
    await readerPage.getByRole('menuitem', { name: 'Delete' }).click();

    const confirm = readerPage.getByRole('dialog', { name: /Delete library/ });
    await expect(confirm).toBeVisible();

    // Initial focus is Cancel
    const cancelBtn = confirm.getByRole('button', { name: 'Cancel' });
    await expect(cancelBtn).toBeFocused();

    // Esc closes
    await readerPage.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
  });
});
