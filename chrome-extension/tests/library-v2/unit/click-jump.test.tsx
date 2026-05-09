import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';
import type { LibraryRow, LibraryCatalogEntry } from '../../../reader/types';

// Phase 27 / Task A2 — TDD reproduction matrix for the closest() guard bug.
// The card itself carries role="button" when clickable; the original guard
// `closest('button, a, input, [role="button"], [role="menu"], [role="menuitem"]')`
// always matches the card itself, so onPaperClick never fires from a click.
//
// These 6 cases pin down the desired contract:
//   - card-body click  → fires
//   - child button     → blocked
//   - library popover  → blocked
//   - text selection   → blocked
//   - Enter key        → fires
//   - non-clickable    → no role=button, no tabIndex

const baseRow: LibraryRow = {
  id: '2401.99999',
  urlHash: 'h-99999',
  title: 'Attention Is All You Need (test)',
  authors: ['Vaswani et al.'],
  role: '',
  judgment: '',
  addedAt: 0,
  lastRead: 0,
  pages: 12,
  annotations: 0,
  hasMemory: false,
  libraryId: null,
  topicIds: [],
  src: 'https://arxiv.org/abs/2401.99999',
};

const libs: LibraryCatalogEntry[] = [
  { id: 'l1', name: 'Q4', createdAt: 0 },
];

describe('LibraryRowView — click-jump matrix (Phase 27 / A1+A2)', () => {
  let originalGetSelection: typeof window.getSelection;

  beforeEach(() => {
    originalGetSelection = window.getSelection.bind(window);
  });

  afterEach(() => {
    window.getSelection = originalGetSelection;
  });

  it('fires onPaperClick when the card body is clicked', () => {
    const onPaperClick = vi.fn();
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={false}
        libraries={libs}
        topics={[]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onPaperClick={onPaperClick}
      />,
    );

    // The card root has aria-label "Open <title>"
    const card = screen.getByLabelText(/Open Attention Is All You Need/);
    fireEvent.click(card);

    expect(onPaperClick).toHaveBeenCalledTimes(1);
    expect(onPaperClick).toHaveBeenCalledWith('2401.99999');
  });

  it('does NOT fire onPaperClick when a child button is clicked', () => {
    const onPaperClick = vi.fn();
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={false}
        libraries={libs}
        topics={[]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onRemove={() => {}}
        onPaperClick={onPaperClick}
      />,
    );

    // "Set library" button is rendered when libraryId is null and libs is non-empty
    fireEvent.click(screen.getByLabelText('Set library'));

    expect(onPaperClick).not.toHaveBeenCalled();
  });

  it('does NOT fire onPaperClick when a topic-chip button is clicked', () => {
    const onPaperClick = vi.fn();
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={false}
        libraries={libs}
        topics={[{ id: 't1', name: 'transformers', createdAt: 0 }]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onPaperClick={onPaperClick}
      />,
    );

    // "Set topic" button is the topic-popover trigger
    fireEvent.click(screen.getByLabelText('Set topic'));

    expect(onPaperClick).not.toHaveBeenCalled();
  });

  it('does NOT fire onPaperClick when text is selected on the card', () => {
    const onPaperClick = vi.fn();
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={false}
        libraries={libs}
        topics={[]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onPaperClick={onPaperClick}
      />,
    );

    // Simulate an active text selection — drag-select that ends in a click
    window.getSelection = () =>
      ({ toString: () => 'Attention Is' }) as unknown as Selection;

    fireEvent.click(screen.getByLabelText(/Open Attention/));

    expect(onPaperClick).not.toHaveBeenCalled();
  });

  it('fires onPaperClick on Enter key when focus is on the card itself', () => {
    const onPaperClick = vi.fn();
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={false}
        libraries={libs}
        topics={[]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onPaperClick={onPaperClick}
      />,
    );

    const card = screen.getByLabelText(/Open Attention/);
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onPaperClick).toHaveBeenCalledWith('2401.99999');
  });

  it('renders no role=button / tabIndex when isCurrent=true', () => {
    render(
      <LibraryRowView
        row={baseRow}
        isCurrent={true}
        libraries={libs}
        topics={[]}
        onAssignLibrary={() => {}}
        onToggleTopic={() => {}}
        onUnassignTopic={() => {}}
        onPaperClick={() => {}}
      />,
    );

    // The card root should not be exposed as a button when this paper is open
    expect(
      screen.queryByLabelText(/Open Attention Is All You Need/),
    ).not.toBeInTheDocument();
  });
});
