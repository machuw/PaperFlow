import { test, expect } from './_fixtures';
import { seedSelectionFixture } from './_helpers';

test.describe('Selection · Explain action flow', () => {
  test('reader root mounts with extension fixture', async ({ readerPage }) => {
    await expect(readerPage.locator('#root')).toBeVisible();
  });

  test('seeded ActionCard renders with EXPLAIN badge, quote, and Jump-to-note button', async ({ readerPage }) => {
    await seedSelectionFixture(readerPage, {
      kind: 'explain',
      quote: 'The selected passage about attention heads',
    });

    // Badge label (chat-view.tsx:214 — "EXPLAIN" + optional ` · p.N`)
    await expect(readerPage.getByText(/^EXPLAIN(?:\s|$)/)).toBeVisible();
    // Quote rendered with surrounding double-quotes (chat-view.tsx:215)
    await expect(
      readerPage.getByText('"The selected passage about attention heads"'),
    ).toBeVisible();
    // [→ Note] button only renders when a Note with the same actionId exists
    // (chat-view.tsx:209-216). Its presence proves the actionId/note linkage.
    await expect(readerPage.getByRole('button', { name: 'Jump to note' })).toBeVisible();
  });

  test('clicking [→ Note] reveals the matching NoteCard in the right panel', async ({ readerPage }) => {
    await seedSelectionFixture(readerPage, { kind: 'explain' });

    // Right panel defaults to Overview — NoteCard is not yet in the DOM.
    await expect(readerPage.getByRole('article', { name: 'explain note' })).toHaveCount(0);

    await readerPage.getByRole('button', { name: 'Jump to note' }).click();

    // jumpToNote (main.tsx:1251) sets tab='note' + activeSubtab='explain'
    // + flash; the matching NoteCard renders in NoteView.
    await expect(readerPage.getByRole('article', { name: 'explain note' })).toBeVisible();
  });

  test('long ActionCard quote applies CSS line-clamp:3', async ({ readerPage }) => {
    const longQuote =
      'lorem ipsum dolor sit amet consectetur adipiscing elit ' +
      'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
      'ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ' +
      'ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit';
    await seedSelectionFixture(readerPage, { kind: 'explain', quote: longQuote });

    const quoteEl = readerPage.getByText(`"${longQuote}"`);
    await expect(quoteEl).toBeVisible();
    const clamp = await quoteEl.evaluate(
      (el) => getComputedStyle(el).webkitLineClamp || (el as HTMLElement).style.webkitLineClamp,
    );
    expect(clamp).toBe('3');
  });

  // Originally planned tests #4 + #5 retired — both targeted behaviors that
  // don't exist in current implementation:
  //   #4 «selection → ink-streaming cursor»: main.tsx:367 sets chatStreamingId
  //      to a '__selection__' sentinel during explain/translate flows so it
  //      intentionally won't match any message id. The genuine ink-streaming
  //      visual fires only for chat-composer sends — covered in
  //      chat-composer.spec.ts.
  //   #5 «NoteCard error state + Retry button»: note-card.tsx's `hasError` /
  //      `isStreaming` props are declared but no caller in reader/main.tsx
  //      passes them (dead branch). Retire until the feature is wired.
});
