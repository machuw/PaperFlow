import { test, expect } from './_fixtures';
import { clickToolbarAction, selectTextInParagraph } from './_helpers';

test.describe('Selection · Note action flow', () => {
  test('Note opens the editor popover; saving creates a NoteCard with quote + userText', async ({
    readerPage,
  }) => {
    await selectTextInParagraph(readerPage, 'sec0-p1');
    await clickToolbarAction(readerPage, 'Note');

    // NoteEditorPopover (note-editor-popover.tsx:27) — role=dialog aria-label.
    const editor = readerPage.getByRole('dialog', { name: 'Note editor' });
    await expect(editor).toBeVisible();
    await editor.getByRole('textbox').fill('My personal note about this paragraph');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    // Workspace Note tab → switch to the «note» subtab and assert the card.
    await readerPage.getByRole('button', { name: 'Note', exact: true }).click();
    await readerPage.getByRole('tab', { name: /^Note\s/ }).click();

    const card = readerPage.getByRole('article', { name: 'note note' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('My personal note about this paragraph');
    await expect(card).toContainText('The first paragraph contains some selectable content');
  });
});
