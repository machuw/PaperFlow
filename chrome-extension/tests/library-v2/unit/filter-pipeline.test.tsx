import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub Supabase so LibraryCapBanner doesn't start auth timers or make real calls.
// The banner calls: .from('subscriptions').select('tier').maybeSingle()
//               and .from('papers').select('*', {count,head}).
// Return null data so banner stays hidden; no counts > 30.
const sbChain = {
  select: () => sbChain,
  eq: () => sbChain,
  single: () => Promise.resolve({ data: null, error: null }),
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
  then: undefined as any, // not a thenable itself — methods return the promise
};
vi.mock('../../../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ ...sbChain, select: () => ({ ...sbChain }) }),
  },
}));

// chrome.storage mock — must run before any module that calls chrome.storage at import time.
const storageMock: Record<string, unknown> = {};
function makeChromeMock() {
  return {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null) return Promise.resolve({ ...storageMock });
          const keys = Array.isArray(k) ? k : [k];
          return Promise.resolve(Object.fromEntries(keys.filter(x => x in storageMock).map(x => [x, storageMock[x]])));
        },
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storageMock[k];
          return Promise.resolve();
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
}
(globalThis as any).chrome = makeChromeMock();

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryDrawer } from '../../../reader/components/library-drawer';
import { setItem } from '../../../reader/lib/storage-schema';

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = makeChromeMock();
});

describe('LibraryDrawer scope filter', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await setItem('pf:libraries', [{ id: 'l1', name: 'Q4', createdAt: 0 }]);
    await setItem('pf:topics', [{ id: 't1', name: 'VLA', createdAt: 0 }]);
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 'Paper A', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: 'l1', topicIds: [] },
        { urlHash: 'b', title: 'Paper B', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: ['t1'] },
        { urlHash: 'c', title: 'Paper C', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      ],
    });
    // pre-mark as migrated to skip migration in tests
    await setItem('pf:libraryV2Migrated', true);
  });

  it('default selection (all) shows all 3 papers, header reads "Library · 3 papers"', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    expect(await screen.findByText(/Library/)).toBeInTheDocument();
    expect(await screen.findByText(/· 3 papers/)).toBeInTheDocument();
    expect(screen.getByText('Paper A')).toBeInTheDocument();
    expect(screen.getByText('Paper B')).toBeInTheDocument();
    expect(screen.getByText('Paper C')).toBeInTheDocument();
  });

  it('selecting a Library filters to its rows and updates header to "{name} · {N}"', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    // Click the sidebar row (aria-label uniquely identifies it before selection)
    fireEvent.click(await screen.findByLabelText(/Q4, 1 papers/));
    // After selection header renders "Q4 · 1" — at least one element with Q4 exists
    expect((await screen.findAllByText('Q4')).length).toBeGreaterThan(0);
    // The header span contains exactly "· 1" (no prefix) — regex anchored to start
    expect(await screen.findByText(/^· 1$/)).toBeInTheDocument();
    expect(screen.getByText('Paper A')).toBeInTheDocument();
    expect(screen.queryByText('Paper B')).toBeNull();
  });

  it('selecting Uncategorized filters to libraryId===null rows', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    // The sidebar has a Row with aria-label like "Uncategorized, 2 papers"
    fireEvent.click(await screen.findByLabelText(/Uncategorized,/));
    // The header span contains exactly "· 2" — anchored regex avoids matching group headers
    expect(await screen.findByText(/^· 2$/)).toBeInTheDocument();
  });

  it('selecting a Topic filters to topicIds.includes(id)', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    fireEvent.click(await screen.findByText(/# VLA/));
    expect(await screen.findByText(/Tagged/)).toBeInTheDocument();
    expect(await screen.findByText(/'VLA'/)).toBeInTheDocument();
    expect(screen.getByText('Paper B')).toBeInTheDocument();
    expect(screen.queryByText('Paper A')).toBeNull();
  });
});

describe('Responsive', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await setItem('pf:libraryV2Migrated', true);
  });

  it('at 1024px viewport the sidebar narrows from 240→200', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    window.dispatchEvent(new Event('resize'));
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    const sidebar = await screen.findByLabelText('Library scope');
    expect(sidebar).toHaveStyle('width: 200px');
  });

  it('at 1280px viewport the sidebar uses 240px', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    window.dispatchEvent(new Event('resize'));
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    const sidebar = await screen.findByLabelText('Library scope');
    expect(sidebar).toHaveStyle('width: 240px');
  });

  it('at 768px viewport the sidebar collapses to top dropdown', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
    window.dispatchEvent(new Event('resize'));
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    // Dropdown trigger has aria-label like "Library scope: All Papers"
    expect(await screen.findByLabelText(/Library scope:/)).toBeInTheDocument();
    // The full sidebar's "Library scope" aside isn't rendered
    expect(screen.queryByLabelText(/^Library scope$/)).toBeNull();
  });
});
