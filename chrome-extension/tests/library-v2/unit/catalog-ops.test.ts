import { describe, it, expect, beforeEach } from 'vitest';
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../../../reader/types';

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

describe('Library v2 types', () => {
  it('LibraryCatalogEntry has id, name, createdAt', () => {
    const e: LibraryCatalogEntry = { id: 'a', name: 'Q4', createdAt: 1 };
    expect(e.id).toBe('a');
  });
  it('TopicCatalogEntry has id, name, createdAt', () => {
    const e: TopicCatalogEntry = { id: 'b', name: 'VLA', createdAt: 1 };
    expect(e.id).toBe('b');
  });
  it('LibraryRow has libraryId | null and topicIds: string[]', () => {
    const r: LibraryRow = {
      urlHash: 'h', title: 't', authors: [], role: '', judgment: '',
      addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
      libraryId: null, topicIds: [],
    };
    expect(r.libraryId).toBe(null);
    expect(r.topicIds).toEqual([]);
  });
});

import { createLibrary, renameLibrary, scheduleDeleteLibrary, getLibraries, createTopic } from '../../../reader/lib/library-catalog';

describe('library-catalog ops', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('createLibrary writes catalog entry with normalized name', async () => {
    const e = await createLibrary('  Q4 Reading  ');
    expect(e.name).toBe('Q4 Reading');
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await getLibraries();
    expect(list).toEqual([e]);
  });

  it('createLibrary rejects duplicate name (case-insensitive)', async () => {
    await createLibrary('VLA');
    await expect(createLibrary('vla')).rejects.toThrow('Already exists');
    await expect(createLibrary(' VLA ')).rejects.toThrow('Already exists');
  });

  it('createLibrary rejects whitespace-only / empty / >64 chars', async () => {
    await expect(createLibrary('   ')).rejects.toThrow();
    await expect(createLibrary('')).rejects.toThrow();
    await expect(createLibrary('a'.repeat(65))).rejects.toThrow();
  });

  it('renameLibrary mutates name only, id immutable', async () => {
    const e = await createLibrary('Q4');
    const renamed = await renameLibrary(e.id, 'Q4 Reading');
    expect(renamed.id).toBe(e.id);
    expect(renamed.name).toBe('Q4 Reading');
  });

  it('Library and Topic namespaces are independent', async () => {
    await createLibrary('VLA');
    const t = await createTopic('VLA');
    expect(t.name).toBe('VLA');  // no collision
  });

  it('scheduleDeleteLibrary is idempotent for unknown id', async () => {
    await expect(scheduleDeleteLibrary('unknown-id')).resolves.toBeUndefined();
  });
});
