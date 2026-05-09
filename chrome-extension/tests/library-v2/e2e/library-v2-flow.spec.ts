import { test, expect, seedLibraryFixture } from './_fixtures';

test.describe('Library v2 — remove paper', () => {
  test('remove paper from library with toast undo', async ({ readerPage }) => {
    await seedLibraryFixture(readerPage, {
      libraries: [],
      topics: [],
      rows: [
        { urlHash: 'paper-x', title: 'Removable Paper' },
      ],
    });
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    const card = drawer.locator('[data-paper-key="paper-x"]');
    await card.hover();
    await card.getByLabel(/More actions for Removable Paper/).click();
    await readerPage.getByRole('menuitem', { name: 'Remove from library' }).click();

    // Card disappears
    await expect(card).toBeHidden();

    // Toast shows
    const undo = readerPage.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible({ timeout: 3000 });

    // Undo restores
    await undo.click();
    await expect(drawer.locator('[data-paper-key="paper-x"]')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Library v2 — happy path', () => {
  test('create library, assign, create topic, filter, delete with undo', async ({ readerPage }) => {
    // Seed: 2 papers, no libraries / topics yet
    await seedLibraryFixture(readerPage, {
      libraries: [],
      topics: [],
      rows: [
        { urlHash: 'paper-a', title: 'Paper A' },
        { urlHash: 'paper-b', title: 'Paper B' },
      ],
    });

    // 1. Open Library drawer
    await readerPage.keyboard.press('Meta+L');
    const drawer = readerPage.locator('[role="dialog"][aria-label="Library"]');
    await expect(drawer).toBeVisible();

    // Default selection = All Papers. The auto-seed on paper open adds the
    // fake paper as a 3rd row (paper-a + paper-b + e2e-fake-paper).
    await expect(drawer.getByLabel(/All Papers, 3 papers/)).toBeVisible();
    await expect(drawer.getByText('Paper A')).toBeVisible();
    await expect(drawer.getByText('Paper B')).toBeVisible();

    // 2. Create a library "Q4 Reading" via the inline input
    await drawer.getByText('+ New library').click();
    const newLibInput = drawer.getByLabel('New library name');
    await newLibInput.fill('Q4 Reading');
    await newLibInput.press('Enter');
    await expect(drawer.getByLabel(/Q4 Reading, 0 papers/)).toBeVisible();

    // 3. Click + Set library on Paper A
    const cardA = drawer.locator('[data-paper-key="paper-a"]');
    await cardA.getByLabel('Set library').click();
    // Popover renders — click Q4 Reading
    await readerPage.getByRole('button', { name: 'Assign library Q4 Reading' }).click();
    await expect(cardA.getByLabel('Library: Q4 Reading')).toBeVisible();
    // Sidebar count updates
    await expect(drawer.getByLabel(/Q4 Reading, 1 papers/)).toBeVisible();

    // 4. Create a topic "VLA" via the chip popover (+ Set topic → filter "VLA" → + Create)
    await cardA.getByLabel('Set topic').click();
    const topicFilter = readerPage.getByRole('dialog', { name: 'Choose topics' }).getByPlaceholder(/Filter or create/);
    await topicFilter.fill('VLA');
    await readerPage.getByRole('button', { name: /\+ Create "VLA"/ }).click();
    // Topic chip appears on the card; popover stays open. Close it with Esc.
    await readerPage.keyboard.press('Escape');
    await expect(cardA.getByText('VLA')).toBeVisible();

    // 5. Sidebar → click # VLA, header narrows
    await drawer.getByLabel(/Topic VLA, 1 papers/).click();
    await expect(drawer.getByText(/Tagged/)).toBeVisible();
    await expect(drawer.getByText(/'VLA'/)).toBeVisible();
    await expect(drawer.getByText('Paper A')).toBeVisible();
    await expect(drawer.getByText('Paper B')).toBeHidden();

    // 6. Sidebar → click Q4 Reading, only Paper A
    await drawer.getByLabel(/Q4 Reading, 1 papers/).click();
    await expect(drawer.getByText('Paper A')).toBeVisible();
    await expect(drawer.getByText('Paper B')).toBeHidden();

    // 7. All Papers → all 3 visible again
    await drawer.getByLabel(/All Papers, 3 papers/).click();
    await expect(drawer.getByText('Paper A')).toBeVisible();
    await expect(drawer.getByText('Paper B')).toBeVisible();

    // 8. Delete the VLA topic via ⋯ menu → confirm → Undo
    const vlaMore = drawer.getByLabel(/More actions for # VLA/);
    await vlaMore.click();
    await readerPage.getByRole('menuitem', { name: 'Delete' }).click();
    // ConfirmModal opens
    const confirm = readerPage.getByRole('dialog', { name: /Delete topic/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    // Toast appears with Undo button
    const undoBtn = readerPage.getByRole('button', { name: 'Undo' });
    await expect(undoBtn).toBeVisible({ timeout: 3_000 });
    // Topic gone from sidebar before undo
    await expect(drawer.getByLabel(/Topic VLA/)).toBeHidden();

    // Click Undo within the 5s window
    await undoBtn.click();
    // Topic reappears in sidebar
    await expect(drawer.getByLabel(/Topic VLA, 1 papers/)).toBeVisible({ timeout: 3_000 });
    // And the chip is back on Paper A
    await expect(cardA.getByText('VLA')).toBeVisible();
  });
});
