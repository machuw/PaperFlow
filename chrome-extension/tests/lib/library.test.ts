import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub supabase so importing library.ts doesn't spin up a real Supabase
// client against the fake VITE env URL (which triggers an unhandled
// rejection in jsdom at module load). These tests only exercise local
// storage paths — the cloud-sync enqueue hop is covered in
// tests/library-cloud-sync.test.ts.
vi.mock('../../reader/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

import {
  getLibrary, upsertLibraryEntry, removeLibraryEntry,
  addToLibrary, updateLibraryRow,
} from '../../reader/lib/library';
import { paperKey as getPaperKey } from '../../reader/lib/ids';
import type { Paper, LibraryRow } from '../../reader/types';

type StorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function makeMockStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      await new Promise((r) => setTimeout(r, 0));
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
    set: async (items) => {
      await new Promise((r) => setTimeout(r, 0));
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) data.delete(k);
    },
  };
}

beforeEach(() => {
  const local = makeMockStorage();
  (globalThis as any).chrome = { storage: { local } };
});

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: '2402.18413',
    urlHash: 'h1',
    title: 'Contextual Residuals',
    authors: ['Khan, Y.', 'Voigt, R.'],
    abstract: 'We propose…',
    venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
    outline: [
      { id: 'o0', label: '1 Introduction', level: 0, page: 1 },
      { id: 'o1', label: '2 Method', level: 0, page: 5 },
    ],
    paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

const makeFakePaper = paper;

describe('library CRUD', () => {
  it('getLibrary returns [] when unset', async () => {
    expect(await getLibrary()).toEqual([]);
  });

  it('upsertLibraryEntry adds a new row', async () => {
    const row: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: ['A'], role: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 10, annotations: 0, hasMemory: false,
      libraryId: null, topicIds: [],
    };
    await upsertLibraryEntry(row);
    expect(await getLibrary()).toEqual([row]);
  });

  it('upsertLibraryEntry replaces by paperKey match', async () => {
    const first: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: ['A'], role: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 10, annotations: 0, hasMemory: false,
      libraryId: null, topicIds: [],
    };
    const second = { ...first, title: 'T2', lastRead: 2 };
    await upsertLibraryEntry(first);
    await upsertLibraryEntry(second);
    const got = await getLibrary();
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe('T2');
  });

  it('removeLibraryEntry drops by paperKey', async () => {
    const row: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: [], role: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 0, annotations: 0, hasMemory: false,
      libraryId: null, topicIds: [],
    };
    await upsertLibraryEntry(row);
    await removeLibraryEntry('p1');
    expect(await getLibrary()).toEqual([]);
  });

  it('addToLibrary computes row from paper + storage and upserts', async () => {
    // Phase 28: test row creation via addToLibrary (syncLibraryRow is now update-only alias)
    // No prior highlights/notes/memory.
    const p = paper();
    await addToLibrary(p, /* pages */ 18);
    const got = await getLibrary();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: '2402.18413',
      urlHash: 'h1',
      title: 'Contextual Residuals',
      authors: ['Khan, Y.', 'Voigt, R.'],
      role: '',
      judgment: '',
      libraryId: null,
      topicIds: [],
      pages: 18,
      annotations: 0,
      hasMemory: false,
    });
    expect(got[0].addedAt).toBeGreaterThan(0);
    expect(got[0].lastRead).toBe(got[0].addedAt);
  });

  it('addToLibrary preserves addedAt; updateLibraryRow updates lastRead on second sync', async () => {
    // Phase 28: create via addToLibrary, then refresh via updateLibraryRow
    const p = paper();
    await addToLibrary(p, 18);
    const first = (await getLibrary())[0];
    // Wait a tick so lastRead differs.
    await new Promise((r) => setTimeout(r, 2));
    await updateLibraryRow(p, 18);
    const second = (await getLibrary())[0];
    expect(second.addedAt).toBe(first.addedAt);
    expect(second.lastRead).toBeGreaterThanOrEqual(first.lastRead);
  });

  it('addToLibrary computes role from extractRolePrefix(memory.role)', async () => {
    const p = paper({
      memory: {
        whyItMatters: '',
        role: 'Central — candidate alternative to RAG',
        judgment: 'Plausible but unverified.',
        linked: [], nextActions: [],
      },
    });
    await addToLibrary(p, 18);
    const row = (await getLibrary())[0];
    expect(row.role).toBe('Central');
    expect(row.judgment).toBe('Plausible but unverified.');
  });

  it('addToLibrary hasMemory is true when any non-empty field exists', async () => {
    const p = paper({
      memory: { whyItMatters: 'matters', role: '', judgment: '', linked: [], nextActions: [] },
    });
    await addToLibrary(p, 18);
    expect((await getLibrary())[0].hasMemory).toBe(true);
  });

  it('addToLibrary hasMemory treats whitespace-only fields as unset', async () => {
    const p = paper({
      memory: { whyItMatters: '   ', role: '', judgment: '', linked: [], nextActions: [] },
    });
    await addToLibrary(p, 18);
    expect((await getLibrary())[0].hasMemory).toBe(false);
  });

  it('addToLibrary annotations counts highlights + notes', async () => {
    // Pre-seed storage with 2 highlights + 3 notes for paperKey='2402.18413'
    await (globalThis as any).chrome.storage.local.set({
      'paper:2402.18413:highlights': [
        { paragraphId: 'sec0-p0', text: 'a', color: 'yellow' },
        { paragraphId: 'sec0-p1', text: 'b', color: 'yellow' },
      ],
      'paper:2402.18413:notes': [
        { id: 'n1', kind: 'explain', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 1 },
        { id: 'n2', kind: 'summarize', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 2 },
        { id: 'n3', kind: 'translate', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 3 },
      ],
    });
    const p = paper();
    await addToLibrary(p, 18);
    expect((await getLibrary())[0].annotations).toBe(5);
  });
});

describe('library v2 fields (libraryId / topicIds)', () => {
  it('updateLibraryRow preserves libraryId and topicIds when row already exists', async () => {
    // Phase 28: updateLibraryRow preserves v2 fields on existing rows
    const p = makeFakePaper({ id: 'p1' });
    await chrome.storage.local.set({
      library: [{
        id: 'p1', urlHash: 'p1', title: 't', authors: [], role: '', judgment: '',
        addedAt: 1, lastRead: 1, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'lib-q4', topicIds: ['top-vla', 'top-rob'],
      }],
    });
    await updateLibraryRow(p, 5);
    const row = (await getLibrary())[0];
    expect(row.libraryId).toBe('lib-q4');
    expect(row.topicIds).toEqual(['top-vla', 'top-rob']);
  });
  it('addToLibrary initializes libraryId=null and topicIds=[] for new rows', async () => {
    // Phase 28: addToLibrary creates rows with default v2 fields
    const p = makeFakePaper({ id: 'p2' });
    await addToLibrary(p, 5);
    const row = (await getLibrary()).find(r => r.id === 'p2');
    expect(row?.libraryId).toBe(null);
    expect(row?.topicIds).toEqual([]);
  });
});

describe('Phase 28 addToLibrary / updateLibraryRow split', () => {
  it('fresh open: updateLibraryRow on missing row is silent no-op', async () => {
    // GIVEN: empty library
    const p = paper();
    // WHEN: updateLibraryRow on a paper not yet in library
    await updateLibraryRow(p, 18);
    // THEN: library unchanged (still empty), no write occurred
    expect(await getLibrary()).toEqual([]);
  });

  it('updateLibraryRow on existing row refreshes lastRead + annotations, preserves addedAt + libraryId + topicIds', async () => {
    // Seed library with an existing row with known addedAt=1, libraryId, topicIds
    await (globalThis as any).chrome.storage.local.set({
      library: [{
        id: '2402.18413', urlHash: 'h1', title: 'Contextual Residuals',
        authors: ['Khan, Y.', 'Voigt, R.'], role: '', judgment: '',
        addedAt: 1, lastRead: 1, pages: 18, annotations: 0, hasMemory: false,
        libraryId: 'lib-q4', topicIds: ['t1'],
      }],
      // Seed 2 highlights + 3 notes so annotations = 5
      'paper:2402.18413:highlights': [
        { paragraphId: 'p0', text: 'a', color: 'yellow' },
        { paragraphId: 'p1', text: 'b', color: 'yellow' },
      ],
      'paper:2402.18413:notes': [
        { id: 'n1', kind: 'explain', source: 's', body: 'b', paragraphId: 'p0', createdAt: 1 },
        { id: 'n2', kind: 'summarize', source: 's', body: 'b', paragraphId: 'p0', createdAt: 2 },
        { id: 'n3', kind: 'translate', source: 's', body: 'b', paragraphId: 'p0', createdAt: 3 },
      ],
    });
    // Paper with memory.role that extracts to 'Central'
    const pWithMemory = paper({
      id: '2402.18413', urlHash: 'h1',
      memory: { whyItMatters: '', role: 'Central — alt RAG', judgment: '', linked: [], nextActions: [] },
    });
    await new Promise((r) => setTimeout(r, 2)); // ensure lastRead > 1
    await updateLibraryRow(pWithMemory, 18);
    const row = (await getLibrary())[0];
    // addedAt preserved
    expect(row.addedAt).toBe(1);
    // lastRead updated
    expect(row.lastRead).toBeGreaterThan(1);
    // annotations recomputed
    expect(row.annotations).toBe(5);
    // role extracted
    expect(row.role).toBe('Central');
    // libraryId and topicIds preserved
    expect(row.libraryId).toBe('lib-q4');
    expect(row.topicIds).toEqual(['t1']);
  });

  it('remove + reopen: getLibrary empty after remove; subsequent updateLibraryRow is no-op', async () => {
    const p = paper();
    // Add then remove
    await addToLibrary(p, 18);
    expect(await getLibrary()).toHaveLength(1);
    await removeLibraryEntry(getPaperKey(p));
    expect(await getLibrary()).toEqual([]);
    // updateLibraryRow after remove is no-op
    await updateLibraryRow(p, 18);
    expect(await getLibrary()).toEqual([]);
  });

  it('historical preserve: pre-seeded rows in chrome.storage.local "library" key returned unchanged from getLibrary() (LIB-OPTIN-04)', async () => {
    // Simulate a legacy row already in storage before Phase 28
    const legacyRow = {
      id: 'legacy-1', urlHash: 'lh1', title: 'Legacy Paper',
      authors: ['Old, A.'], role: 'Foundational', judgment: 'Solid.',
      addedAt: 1000, lastRead: 2000, pages: 12, annotations: 3, hasMemory: true,
      libraryId: null, topicIds: [],
    };
    await (globalThis as any).chrome.storage.local.set({ library: [legacyRow] });
    // getLibrary returns the row byte-for-byte unchanged
    const rows = await getLibrary();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(legacyRow);
  });
});
