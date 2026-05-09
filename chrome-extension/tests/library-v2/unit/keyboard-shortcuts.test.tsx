import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibrarySidebar } from '../../../reader/components/library-sidebar';

const baseProps = {
  libraries: [],
  topics: [],
  rows: [],
  selection: { kind: 'all' as const },
  onSelect: () => {},
  onCreateLibrary: () => {},
  onCreateTopic: () => {},
  onRenameLibrary: () => {},
  onDeleteLibrary: () => {},
  onRenameTopic: () => {},
  onDeleteTopic: () => {},
  introSeen: true,
  onDismissIntro: () => {},
};

describe('Sidebar keyboard shortcuts', () => {
  it('F2 on focused user-created row enters rename mode', async () => {
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    expect(screen.getByLabelText(/Rename library Q4/)).toBeInTheDocument();
  });

  it('Backspace on focused user-created row triggers delete confirm', async () => {
    const onDelete = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onDeleteLibrary={onDelete} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledWith('lib1');
  });

  it('All Papers + Uncategorized rows do NOT respond to F2/Backspace', async () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    render(<LibrarySidebar {...baseProps} onDeleteLibrary={onDelete} onRenameLibrary={onRename} />);
    const allRow = screen.getByLabelText(/All Papers/);
    allRow.focus();
    fireEvent.keyDown(allRow, { key: 'Backspace' });
    fireEvent.keyDown(allRow, { key: 'F2' });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('isEditingInput skips inputs/textareas/contenteditable', async () => {
    // Test the helper directly since the sidebar's onKeyDown uses it.
    const { isEditingInput } = await import('../../../reader/lib/is-editing-input');
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isEditingInput({ target: input })).toBe(true);
    expect(isEditingInput({ target: textarea })).toBe(true);
    expect(isEditingInput({ target: div })).toBe(false);
    expect(isEditingInput({ target: editable })).toBe(true);
    expect(isEditingInput({ target: null })).toBe(false);
  });
});
