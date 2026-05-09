import { test, expect } from './_fixtures';
import { mockChatCompletions, seedByokConfig } from './_helpers';

test.describe('Chat composer · streaming', () => {
  test('assistant message shows AI-thinking indicator while streaming, then renders streamed text', async ({
    readerPage,
  }) => {
    await seedByokConfig(readerPage);
    await mockChatCompletions(readerPage, { chunks: ['Hello, ', 'world!'], delayMs: 700 });

    // Scope to the chat region (chat-panel.tsx:66) — the same SSE mock is
    // also consumed by the auto-firing Overview contributions/keywords AI
    // calls, which render the same text in the right panel.
    const chat = readerPage.getByRole('region', { name: 'AI chat assistant' });

    const composer = chat.locator('textarea.pf-chat-composer');
    await composer.fill('What does this paper claim?');
    await composer.press('Enter');

    // Mid-stream: while the assistant message has empty text, ChatView renders
    // TypingDots (chat-view.tsx:176-201) — role=status + aria-label is unique
    // to that component, so this disambiguates from any concurrent overview /
    // toast / migration-banner status nodes.
    await expect(chat.getByRole('status', { name: 'AI is thinking' })).toBeVisible();

    // Stream completes ⇒ joined text renders inside the chat region and the
    // TypingDots unmount.
    await expect(chat.getByText('Hello, world!')).toBeVisible();
    await expect(chat.getByRole('status', { name: 'AI is thinking' })).toHaveCount(0);
  });
});
