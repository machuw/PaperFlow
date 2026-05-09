import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Paper } from '../reader/types';
import { FREE_LIBRARY_CAP } from '../reader/lib/constants';

// Mock supabase so syncLibraryRow / addToLibrary's enqueueLibraryRowSync helper
// sees a controllable auth.getUser() response, and so importing library.ts
// doesn't spin up a real Supabase client against a fake URL.
//
// mockState allows individual tests to control papersCount and user per-test.
const mockState = {
  user: { id: 'user-test' } as { id: string } | null,
  papersCount: 0,
  paperCloudResident: false,
};

vi.mock('../reader/lib/supabase', () => {
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
      from: vi.fn((table: string) => {
        if (table === 'subscriptions') {
          return {
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: { tier: 'free' } }),
            }),
          };
        }
        if (table === 'papers') {
          return {
            select: (_: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count) {
                // Count query — returns { count: mockState.papersCount }
                return Promise.resolve({ count: mockState.papersCount });
              }
              // Residency check (eq + maybeSingle)
              return {
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: mockState.paperCloudResident ? { paper_key: 'x' } : null }),
                }),
              };
            },
          };
        }
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: null }),
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
          }),
        };
      }),
    },
  };
});

// Mock sync-queue.enqueue to observe the enqueued op shape without
// exercising the real queue's chrome.storage path — that's covered in
// sync-queue.test.ts.
vi.mock('../reader/lib/sync-queue', () => {
  const enqueueSpy = vi.fn().mockResolvedValue(undefined);
  return {
    enqueue: enqueueSpy,
    __spies: { enqueueSpy },
  };
});

import { addToLibrary, updateLibraryRow, getLibrary } from '../reader/lib/library';

// jsdom doesn't provide chrome.storage — stand up an in-memory shim
// matching the pattern in migration.test.ts / storage-schema.test.ts /
// byok-sync.test.ts.
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(storageMock, obj);
          return Promise.resolve();
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key];
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: '2402.18413',
    urlHash: 'h1',
    title: 'Contextual Residuals',
    authors: ['Khan, Y.', 'Voigt, R.'],
    abstract: 'We propose…',
    venue: 'arXiv:2402.18413 [cs.LG] 14 Feb 2026',
    outline: [],
    paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('addToLibrary → papers cloud upsert enqueue', () => {
  // Phase 28: these tests previously used syncLibraryRow (create+enqueue);
  // now they use addToLibrary which is the sole function with create + cloud-upsert privileges.
  beforeEach(async () => {
    // Reset shared mockState for each test
    mockState.user = { id: 'user-test' };
    mockState.papersCount = 0;
    mockState.paperCloudResident = false;
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;
    __spies.enqueueSpy.mockClear();
  });

  it('does NOT enqueue when user is logged out (auth.getUser → null)', async () => {
    mockState.user = null;
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;

    await addToLibrary(paper(), 18);

    expect(__spies.enqueueSpy).not.toHaveBeenCalled();
  });

  it('DOES enqueue a papers upsert op when user is signed in', async () => {
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;

    await addToLibrary(paper(), 18);

    expect(__spies.enqueueSpy).toHaveBeenCalledTimes(1);
    const op = __spies.enqueueSpy.mock.calls[0][0];
    expect(op.table).toBe('papers');
    expect(op.op).toBe('upsert');
    expect(typeof op.ts).toBe('number');
  });

  it('enqueued row has correct shape (user_id, paper_key, ISO timestamps, …)', async () => {
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;

    const p = paper({
      memory: {
        whyItMatters: '',
        role: 'Central — candidate alternative to RAG',
        judgment: 'Plausible.',
        linked: [],
        nextActions: [],
      },
    });
    await addToLibrary(p, 18);

    const { row } = __spies.enqueueSpy.mock.calls[0][0];
    expect(row.user_id).toBe('user-test');
    expect(row.paper_key).toBe('2402.18413');   // prefer id over urlHash
    expect(row.title).toBe('Contextual Residuals');
    expect(row.authors).toEqual(['Khan, Y.', 'Voigt, R.']);
    expect(row.venue).toBe('arXiv:2402.18413 [cs.LG] 14 Feb 2026');
    expect(row.pages).toBe(18);
    expect(row.role).toBe('Central');  // extractRolePrefix applied
    expect(row.library_id).toBeNull(); expect(row.topic_ids).toEqual([]);  // v2 shape
    expect(row.judgment).toBe('Plausible.');
    // added_at / last_read are ISO-8601 strings.
    expect(typeof row.added_at).toBe('string');
    expect(row.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof row.last_read).toBe('string');
    expect(row.last_read).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Phase 28 addToLibrary cap + sync-queue', () => {
  beforeEach(async () => {
    // Reset shared mockState for each test
    mockState.user = { id: 'u1' };
    mockState.papersCount = 0;
    mockState.paperCloudResident = false;
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;
    __spies.enqueueSpy.mockClear();
    const { supabase } = (await import('../reader/lib/supabase')) as any;
    vi.mocked(supabase.from).mockClear();
  });

  it('addToLibrary: writes row, enqueues papers upsert, cap banner-dismiss flag untouched when cap not hit', async () => {
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;
    // papersCount=0 — well under cap
    mockState.papersCount = 0;

    const p = paper();
    await addToLibrary(p, 18, 'arxiv-id:2402.18413');

    // Row written to local library
    const rows = await getLibrary();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('2402.18413');

    // Enqueue called once with papers upsert
    expect(__spies.enqueueSpy).toHaveBeenCalledTimes(1);
    const op = __spies.enqueueSpy.mock.calls[0][0];
    expect(op.table).toBe('papers');
    expect(op.op).toBe('upsert');
    expect(op.row.user_id).toBe('u1');
    expect(op.row.paper_key).toBe('2402.18413');

    // libraryCapBannerDismissed not removed (cap not hit)
    const stored = storageMock['libraryCapBannerDismissed'];
    expect(stored).toBeUndefined(); // was never set in the first place — not cleared
  });

  it(`addToLibrary at cap (count = FREE_LIBRARY_CAP = ${FREE_LIBRARY_CAP}): skips enqueue, clears banner-dismissed flag, local row still written`, async () => {
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;
    // Set cloud count to cap (16) and paper not yet cloud-resident
    mockState.papersCount = FREE_LIBRARY_CAP;
    mockState.paperCloudResident = false;
    // Pre-seed the banner-dismissed flag so we can assert it gets cleared
    storageMock['libraryCapBannerDismissed'] = true;

    const p = paper();
    await addToLibrary(p, 18);

    // Local row still written (best-effort)
    const rows = await getLibrary();
    expect(rows).toHaveLength(1);

    // Enqueue NOT called (cap gate hit)
    expect(__spies.enqueueSpy).not.toHaveBeenCalled();

    // libraryCapBannerDismissed cleared
    expect(storageMock['libraryCapBannerDismissed']).toBeUndefined();
  });

  it('updateLibraryRow path NEVER triggers enqueue or supabase.from("subscriptions") / supabase.from("papers")', async () => {
    const { __spies } = (await import('../reader/lib/sync-queue')) as any;
    const { supabase } = (await import('../reader/lib/supabase')) as any;

    // Seed library with an existing row
    storageMock['library'] = [{
      id: '2402.18413', urlHash: 'h1', title: 'Contextual Residuals',
      authors: ['Khan, Y.', 'Voigt, R.'], role: '', judgment: '',
      addedAt: 1, lastRead: 1, pages: 18, annotations: 0, hasMemory: false,
      libraryId: null, topicIds: [],
    }];

    await updateLibraryRow(paper(), 18);

    // Enqueue NOT called
    expect(__spies.enqueueSpy).not.toHaveBeenCalled();
    // supabase.from NOT called (no subscriptions / papers queries)
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
