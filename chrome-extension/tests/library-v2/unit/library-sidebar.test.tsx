import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
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

describe('LibrarySidebar', () => {
  it('renders All Papers + Uncategorized as permanent rows', () => {
    render(<LibrarySidebar {...baseProps} rows={[
      { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      { urlHash: 'b', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: 'lib1', topicIds: [] },
    ]} />);
    expect(screen.getByText('All Papers')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByLabelText(/Uncategorized, 1 papers/)).toBeInTheDocument();
  });

  it('clicking a library row fires onSelect with kind=library + id', () => {
    const onSelect = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Q4'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'library', id: 'lib1' });
  });

  it('first-use pill renders when introSeen=false', () => {
    render(<LibrarySidebar {...baseProps} introSeen={false} />);
    expect(screen.getByText(/Organize papers into libraries/)).toBeInTheDocument();
  });
});

describe('LibrarySidebar — inline create', () => {
  it('clicking "+ New library" opens an inline input', () => {
    render(<LibrarySidebar {...baseProps} />);
    fireEvent.click(screen.getByText('+ New library'));
    expect(screen.getByLabelText('New library name')).toBeInTheDocument();
  });

  it('Enter on inline input submits the name to onCreateLibrary', () => {
    const onCreate = vi.fn();
    render(<LibrarySidebar {...baseProps} onCreateLibrary={onCreate} />);
    fireEvent.click(screen.getByText('+ New library'));
    const input = screen.getByLabelText('New library name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Q4 Reading' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('Q4 Reading');
  });

  it('Esc on inline input cancels without calling onCreateLibrary', () => {
    const onCreate = vi.fn();
    render(<LibrarySidebar {...baseProps} onCreateLibrary={onCreate} />);
    fireEvent.click(screen.getByText('+ New library'));
    const input = screen.getByLabelText('New library name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Q4' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('New library name')).toBeNull();
    expect(screen.getByText('+ New library')).toBeInTheDocument();
  });

  it('empty/whitespace name is ignored on Enter', () => {
    const onCreate = vi.fn();
    render(<LibrarySidebar {...baseProps} onCreateLibrary={onCreate} />);
    fireEvent.click(screen.getByText('+ New library'));
    const input = screen.getByLabelText('New library name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('LibrarySidebar — inline rename', () => {
  it('F2 on user-created library row enters rename mode with current name pre-filled', () => {
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = screen.getByLabelText(/Rename library Q4/) as HTMLInputElement;
    expect(input.value).toBe('Q4');
  });

  it('Enter on rename input fires onRenameLibrary(id, name)', () => {
    const onRename = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onRenameLibrary={onRename} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = screen.getByLabelText(/Rename library Q4/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Q4 Reading' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('lib1', 'Q4 Reading');
  });
});

describe('LibrarySidebar — ⋯ menu', () => {
  it('clicking the ⋯ button on a user-created row opens a menu with Rename + Delete', () => {
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} />);
    const moreBtn = screen.getByLabelText(/More actions for Q4/);
    fireEvent.click(moreBtn);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('clicking Rename in the menu enters inline rename mode', () => {
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} />);
    fireEvent.click(screen.getByLabelText(/More actions for Q4/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByLabelText(/Rename library Q4/)).toBeInTheDocument();
  });

  it('clicking Delete in the menu fires onDeleteLibrary(id)', () => {
    const onDelete = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onDeleteLibrary={onDelete} />);
    fireEvent.click(screen.getByLabelText(/More actions for Q4/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('lib1');
  });

  it('Escape closes the menu', () => {
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} />);
    fireEvent.click(screen.getByLabelText(/More actions for Q4/));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('topic ⋯ menu Delete fires onDeleteTopic(id)', () => {
    const onDelete = vi.fn();
    render(<LibrarySidebar {...baseProps} topics={[{ id: 't1', name: 'VLA', createdAt: 0 }]} onDeleteTopic={onDelete} />);
    fireEvent.click(screen.getByLabelText(/More actions for # VLA/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('t1');
  });
});
