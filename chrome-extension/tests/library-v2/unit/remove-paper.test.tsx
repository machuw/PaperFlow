import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';
import type { LibraryRow } from '../../../reader/types';

// Standard chrome.storage mock
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (k: string) => { delete storageMock[k]; return Promise.resolve(); },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

vi.mock('../../../reader/lib/sync-queue', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../reader/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  },
}));

const makeRow = (urlHash = 'paper-x', title = 'Test Paper'): LibraryRow => ({
  id: undefined,
  urlHash,
  title,
  authors: ['Author A'],
  role: '',
  judgment: '',
  addedAt: Date.now(),
  lastRead: Date.now(),
  pages: 10,
  annotations: 0,
  hasMemory: false,
  libraryId: null,
  topicIds: [],
});

describe('LibraryRowView — ⋯ menu', () => {
  it('⋯ button is present when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(
      <LibraryRowView
        row={makeRow()}
        isCurrent={false}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByLabelText(/More actions for Test Paper/)).toBeInTheDocument();
  });

  it('⋯ button is absent when onRemove is not provided', () => {
    render(
      <LibraryRowView
        row={makeRow()}
        isCurrent={false}
      />,
    );
    expect(screen.queryByLabelText(/More actions for/)).toBeNull();
  });

  it('clicking ⋯ opens menu with "Remove from library" menuitem', () => {
    const onRemove = vi.fn();
    render(
      <LibraryRowView
        row={makeRow()}
        isCurrent={false}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText(/More actions for Test Paper/));
    expect(screen.getByRole('menuitem', { name: 'Remove from library' })).toBeInTheDocument();
  });

  it('clicking "Remove from library" fires onRemove with rowKey and closes menu', () => {
    const onRemove = vi.fn();
    render(
      <LibraryRowView
        row={makeRow('paper-x')}
        isCurrent={false}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText(/More actions for Test Paper/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from library' }));
    expect(onRemove).toHaveBeenCalledWith('paper-x');
    expect(screen.queryByRole('menuitem', { name: 'Remove from library' })).toBeNull();
  });

  it('pressing Escape closes the menu', () => {
    const onRemove = vi.fn();
    render(
      <LibraryRowView
        row={makeRow()}
        isCurrent={false}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText(/More actions for Test Paper/));
    expect(screen.getByRole('menuitem', { name: 'Remove from library' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Remove from library' })).toBeNull();
  });
});
