import { describe, it, expect, beforeEach } from 'vitest';
import { runLibraryV2Migration } from '../../../reader/lib/library-catalog';

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

describe('library-v2 migration', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('is no-op when libraryV2Migrated is true', async () => {
    await chrome.storage.local.set({ 'pf:libraryV2Migrated': true });
    await runLibraryV2Migration();
    expect((await chrome.storage.local.get('pf:topics'))['pf:topics']).toBeUndefined();
  });

  it('migrates legacy topic: string into topics catalog and topicIds', async () => {
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, topic: 'VLA' },
        { urlHash: 'b', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, topic: 'vla' },
      ],
    });
    await runLibraryV2Migration();
    const topics = (await chrome.storage.local.get('pf:topics'))['pf:topics'];
    expect(topics).toHaveLength(1);  // case-insensitive dedup
    expect(topics[0].name).toBe('VLA');
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].topicIds).toEqual([topics[0].id]);
    expect(lib[1].topicIds).toEqual([topics[0].id]);
    expect(lib[0].libraryId).toBe(null);
    expect((await chrome.storage.local.get('pf:libraryV2Migrated'))['pf:libraryV2Migrated']).toBe(true);
  });

  it('initializes libraryId=null + topicIds=[] for rows missing v2 fields', async () => {
    await chrome.storage.local.set({
      library: [{ urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false }],
    });
    await runLibraryV2Migration();
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].libraryId).toBe(null);
    expect(lib[0].topicIds).toEqual([]);
  });
});
