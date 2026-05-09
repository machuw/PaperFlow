import type { CSSProperties } from 'react';

/**
 * Single source of truth for AI/markdown body typography.
 *
 * All four MarkdownBody call sites (overview-contributions, summary-page,
 * chat-view, note-card) share this style so the side panels and the summary
 * card don't drift apart visually. When a card needs a bigger or denser
 * scale, wrap with a CSS `font-size` parent — but don't override pieces
 * of this contract piecemeal.
 */
export const READER_BODY_STYLE: CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 13.5,
  lineHeight: 1.65,
  color: 'var(--ink)',
};
