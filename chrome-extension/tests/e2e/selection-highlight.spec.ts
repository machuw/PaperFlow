import { test, expect } from './_fixtures';
import { FAKE_PAPER_KEY, clickToolbarAction, selectTextInParagraph } from './_helpers';

test.describe('Selection · Highlight action flow', () => {
  test('Highlight writes storage entry, mirrors to NoteView, paints via Custom Highlight API, and persists across reload', async ({
    readerPage,
  }) => {
    await selectTextInParagraph(readerPage, 'sec0-p1');
    await clickToolbarAction(readerPage, 'Highlight');

    // (a) Storage round-trip — paper:{pk}:highlights gets the entry.
    const hl = await readerPage.evaluate(async (pk) => {
      const all = await chrome.storage.local.get(`paper:${pk}:highlights`);
      return all[`paper:${pk}:highlights`] as
        | Array<{ paragraphId: string; text: string; color: string }>
        | undefined;
    }, FAKE_PAPER_KEY);
    expect(hl).toHaveLength(1);
    expect(hl![0]).toMatchObject({ paragraphId: 'sec0-p1', color: 'yellow' });
    expect(hl![0].text.length).toBeGreaterThan(5);

    // (b) NoteView Highlight subtab shows a matching NoteCard.
    // The workspace «Note» tab button shares text with the toolbar's Note
    // action; the toolbar already unmounted (selection cleared by runAction),
    // so name=Note now uniquely matches the workspace tab.
    await readerPage.getByRole('button', { name: 'Note', exact: true }).click();
    await readerPage.getByRole('tab', { name: /^Highlight\s/ }).click();
    await expect(readerPage.getByRole('article', { name: 'highlight note' })).toBeVisible();

    // (c) CSS Custom Highlight API got the range painted.
    const painted = await readerPage.evaluate(() => {
      const css = (window as { CSS?: { highlights?: { get: (k: string) => { size: number } | undefined } } }).CSS;
      return css?.highlights?.get('hl-yellow')?.size ?? 0;
    });
    expect(painted).toBeGreaterThan(0);

    // Reload — highlight survives.
    await readerPage.reload();
    await readerPage.locator('#root').waitFor({ state: 'visible' });
    const hl2 = await readerPage.evaluate(async (pk) => {
      const all = await chrome.storage.local.get(`paper:${pk}:highlights`);
      return all[`paper:${pk}:highlights`] as Array<{ paragraphId: string }> | undefined;
    }, FAKE_PAPER_KEY);
    expect(hl2).toHaveLength(1);
    expect(hl2![0].paragraphId).toBe('sec0-p1');
  });
});
