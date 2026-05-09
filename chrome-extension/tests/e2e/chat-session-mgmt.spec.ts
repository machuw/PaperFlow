import { test, expect } from './_fixtures';
import { seedSelectionFixture } from './_helpers';

test.describe('Chat session · management', () => {
  test('clicking New chat creates seq=1 tab and switches it active', async ({ readerPage }) => {
    const tabs = readerPage.getByRole('tablist', { name: 'Chat sessions' });
    // No sessions yet — tablist is in DOM but empty.
    await expect(tabs.getByRole('tab')).toHaveCount(0);

    await tabs.getByRole('button', { name: 'New chat' }).click();

    const tab = tabs.getByRole('tab', { name: '1' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  test('Delete current chat → undo toast → click Undo restores the session', async ({
    readerPage,
  }) => {
    // Seed an existing session so the soft-delete + undo flow has something
    // to act on. seedSelectionFixture also reloads, so the tablist hydrates
    // from the seeded data.
    await seedSelectionFixture(readerPage, { kind: 'explain' });

    const tabs = readerPage.getByRole('tablist', { name: 'Chat sessions' });
    const tab1 = tabs.getByRole('tab', { name: '1' });
    await expect(tab1).toBeVisible();

    await tabs.getByRole('button', { name: 'Delete current chat' }).click();
    await expect(tab1).toBeHidden();

    const undo = readerPage.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible({ timeout: 3_000 });
    await undo.click();

    await expect(tab1).toBeVisible({ timeout: 3_000 });
  });

  test('History drawer · Rename writes new title to storage; drawer requires close+reopen to reflect it', async ({
    readerPage,
  }) => {
    const { sessionId } = await seedSelectionFixture(readerPage, { kind: 'explain' });

    const tabs = readerPage.getByRole('tablist', { name: 'Chat sessions' });
    await tabs.getByRole('button', { name: 'History' }).click();

    // Drawer aria-label = `t('chat.history.title')` = 'CONVERSATIONS' (i18n.ts:153)
    // — NOT the literal-fallback 'Chat history' the source line implies.
    const drawer = readerPage.getByRole('dialog', { name: 'CONVERSATIONS' });
    await expect(drawer).toBeVisible();

    // Hover the row to reveal Rename / Delete-permanently buttons.
    // Default seeded title is empty, so the row shows "Chat #1".
    const row = drawer.locator('div').filter({ hasText: /Chat #1/ }).first();
    await row.hover();
    await drawer.getByRole('button', { name: 'Rename' }).click();

    const input = drawer.getByRole('textbox');
    await input.fill('Renamed session');
    await input.press('Enter');

    // Storage round-trip — Sessions.renameSession persisted the new title.
    await expect
      .poll(async () =>
        readerPage.evaluate(async (sid) => {
          const all = await chrome.storage.local.get('paper:e2e-fake-paper:chatSessions');
          const list = all['paper:e2e-fake-paper:chatSessions'] as
            | Array<{ id: string; title: string }>
            | undefined;
          return list?.find((s) => s.id === sid)?.title ?? null;
        }, sessionId),
      )
      .toBe('Renamed session');

    // KNOWN STALENESS — chat-panel.tsx fetches `historySessions` once when
    // the drawer opens and onRename does NOT re-fetch it (only main.tsx's
    // outer `sessions` prop is refreshed). The user must close + reopen the
    // drawer to see the new title. Reproduce that flow here.
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    await tabs.getByRole('button', { name: 'History' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Renamed session')).toBeVisible();
  });
});
