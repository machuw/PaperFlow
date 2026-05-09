import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibrarySidebar } from '../../../reader/components/library-sidebar';
import { setItem, getItem } from '../../../reader/lib/storage-schema';

// chrome.storage mock setup (copy from tests/storage-schema.test.ts lines 4-19)
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
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
});

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

describe('First-use pill', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('renders when libraryV2Migrated=true and librariesIntroSeen!==true', async () => {
    await setItem('pf:libraryV2Migrated', true);
    const onDismiss = async () => { await setItem('pf:librariesIntroSeen', true); };
    render(<LibrarySidebar {...baseProps} introSeen={false} onDismissIntro={onDismiss} />);
    expect(screen.getByText(/Organize papers into libraries/)).toBeInTheDocument();
  });

  it('clicking dismiss writes pf:librariesIntroSeen=true', async () => {
    const onDismiss = async () => { await setItem('pf:librariesIntroSeen', true); };
    render(<LibrarySidebar {...baseProps} introSeen={false} onDismissIntro={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss intro'));
    await new Promise(r => setTimeout(r, 0));
    expect(await getItem('pf:librariesIntroSeen')).toBe(true);
  });

  it('does NOT render when introSeen=true', () => {
    render(<LibrarySidebar {...baseProps} introSeen={true} />);
    expect(screen.queryByText(/Organize papers into libraries/)).toBeNull();
  });
});
