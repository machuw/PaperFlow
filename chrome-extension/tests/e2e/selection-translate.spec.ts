import { test, expect } from './_fixtures';
import {
  clickToolbarAction,
  mockChatCompletions,
  seedByokConfig,
  selectTextInParagraph,
} from './_helpers';

test.describe('Selection · Translate action flow', () => {
  test('Translate creates a TRANSLATE actionCard with the original quote and renders the streamed translation', async ({
    readerPage,
  }) => {
    await seedByokConfig(readerPage);
    await mockChatCompletions(readerPage, {
      chunks: ['译文：', '段落 1 的译文。'],
      delayMs: 200,
    });

    await selectTextInParagraph(readerPage, 'sec0-p1');
    await clickToolbarAction(readerPage, 'Translate');

    // Scope to chat region — same SSE mock is reused by overview AI calls
    // (which auto-fire in Overview tab) and by the translation we trigger.
    const chat = readerPage.getByRole('region', { name: 'AI chat assistant' });

    // ActionCard badge (chat-view.tsx:207 — kind='translate' ⇒ 'TRANSLATE').
    await expect(chat.getByText(/^TRANSLATE/)).toBeVisible();

    // ActionCard quote = full selection (paper-page.tsx selectNodeContents).
    await expect(
      chat
        .getByText(
          '"The first paragraph contains some selectable content for E2E testing."',
        )
        .first(),
    ).toBeVisible();

    // Streamed translation lands in a separate assistant message (not inside
    // the actionCard div).
    await expect(chat.getByText('译文：段落 1 的译文。')).toBeVisible();
  });
});
