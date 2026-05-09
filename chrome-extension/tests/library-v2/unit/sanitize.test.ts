import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeLibraryRows } from '../../../reader/lib/library-catalog';

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

describe('sanitizeLibraryRows', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('clears libraryId pointing at missing catalog entry', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [],
      'pf:topics': [],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'missing-id', topicIds: [],
      }],
    });
    const changed = await sanitizeLibraryRows();
    expect(changed).toBe(true);
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].libraryId).toBe(null);
  });

  it('filters topicIds to only existing topics', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [],
      'pf:topics': [{ id: 'top-vla', name: 'VLA', createdAt: 0 }],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: null, topicIds: ['top-vla', 'missing', 'also-missing'],
      }],
    });
    await sanitizeLibraryRows();
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].topicIds).toEqual(['top-vla']);
  });

  it('returns false (no write) when nothing to sanitize', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [{ id: 'lib-q4', name: 'Q4', createdAt: 0 }],
      'pf:topics': [],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'lib-q4', topicIds: [],
      }],
    });
    expect(await sanitizeLibraryRows()).toBe(false);
  });
});
