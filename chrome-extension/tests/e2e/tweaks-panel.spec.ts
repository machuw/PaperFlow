import { test, expect } from './_fixtures';

/**
 * v1.0.x todo `2026-04-28-tweaks-panel-close-on-outside-click` —
 * regression coverage for the close-on-outside-click + ESC behavior
 * shipped in commit 87fe7df.
 *
 * The panel itself is keyless (it has no role="dialog"), so we anchor
 * via stable visible text "Tweaks" inside the header, plus the trigger
 * button's title="Tweaks".
 */
test.describe('TweaksPanel · close behavior', () => {
  test('clicking outside the panel closes it; trigger toggle still works', async ({
    readerPage,
  }) => {
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    const trigger = readerPage.getByRole('button', { name: 'Tweaks' });
    const panelHeader = readerPage.getByText('Tweaks', { exact: true });

    // Open via trigger.
    await trigger.click();
    await expect(panelHeader).toBeVisible();

    // Click on the reader body (outside panel + outside trigger) — panel closes.
    await readerPage.locator('#root').click({ position: { x: 50, y: 200 } });
    await expect(panelHeader).toBeHidden();

    // Trigger remains a working toggle after the outside-click cycle.
    await trigger.click();
    await expect(panelHeader).toBeVisible();
    await trigger.click();
    await expect(panelHeader).toBeHidden();
  });

  test('Escape closes the panel', async ({ readerPage }) => {
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    const trigger = readerPage.getByRole('button', { name: 'Tweaks' });
    const panelHeader = readerPage.getByText('Tweaks', { exact: true });

    await trigger.click();
    await expect(panelHeader).toBeVisible();
    await readerPage.keyboard.press('Escape');
    await expect(panelHeader).toBeHidden();
  });

  test('clicking inside the panel does NOT close it', async ({ readerPage }) => {
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    const trigger = readerPage.getByRole('button', { name: 'Tweaks' });
    const panelHeader = readerPage.getByText('Tweaks', { exact: true });

    await trigger.click();
    await expect(panelHeader).toBeVisible();

    // Click on a Tweaks panel control (the Serif/Sans segmented control).
    await readerPage.getByRole('button', { name: 'Serif', exact: true }).click();
    await expect(panelHeader).toBeVisible();
  });
});
