import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock supabase client — avoid hitting real endpoints, and sidestep the
// env-var check in supabase.ts that would throw at import time.
vi.mock('../reader/lib/supabase', () => {
  // Per-test configurable state. `__state` / `__spies` are accessed via
  // `await import('../reader/lib/supabase')` in each test case.
  const state: any = {
    user: { id: 'user-test' },
    upsertPapersResponse: (rows: any[]) =>
      rows.map((r: any, i: number) => ({ id: `paper-uuid-${i}`, paper_key: r.paper_key })),
    upsertRelatedError: null as null | Error,
    cloudPaperCount: 0,
    cloudPaperKeys: [] as { paper_key: string }[],
  }

  const upsertPapersSpy = vi.fn().mockImplementation((rows: any[]) => ({
    select: () => Promise.resolve({ data: state.upsertPapersResponse(rows), error: null }),
  }))
  const upsertOtherSpy = vi.fn().mockImplementation(() => ({
    data: null,
    error: state.upsertRelatedError,
  }))
  // Rich chainable builder for select + count
  const builderFor = (table: string): any => {
    const builder: any = {
      upsert: (rows: any[], _opts: any) =>
        table === 'papers'
          ? upsertPapersSpy(rows)
          : upsertOtherSpy(rows),
      select: (_cols?: string, opts?: any) => {
        if (table === 'papers' && opts?.count === 'exact' && opts?.head) {
          return Promise.resolve({ count: state.cloudPaperCount, data: null, error: null })
        }
        if (table === 'papers') {
          return Promise.resolve({ data: state.cloudPaperKeys, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      delete: () => ({
        not: (_col: string, _op: string, _val: any) => Promise.resolve({ data: null, error: null }),
        gte: (_col: string, _v: any) => Promise.resolve({ data: null, error: null }),
      }),
    }
    return builder
  }
  const fromSpy = vi.fn((table: string) => builderFor(table))

  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: state.user } }) },
      from: fromSpy,
    },
    __state: state,
    __spies: { upsertPapersSpy, upsertOtherSpy, fromSpy },
  }
})

import {
  pushLocalToCloud,
  pullCloudToLocal,
  resumeIfNeeded,
  onProgress,
  detectAndRoute,
  applyMergeChoice,
  type Progress,
} from '../reader/lib/migration'

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) {
            return Promise.resolve({ ...storageMock })
          }
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {}
            for (const key of k) if (key in storageMock) out[key] = storageMock[key]
            return Promise.resolve(out)
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {})
        },
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve() },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k]
          for (const key of keys) delete storageMock[key]
          return Promise.resolve()
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve() },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
})

describe('migration.ts — M1 silent upload', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    vi.clearAllMocks()
  })

  it('empty library → migrationState=done, progress emits total=0', async () => {
    const events: Progress[] = []
    const unsub = onProgress(p => events.push(p))
    await pushLocalToCloud()
    unsub()
    const state = (await chrome.storage.local.get('migrationState'))['migrationState']
    expect(state).toBe('done')
    expect(events[events.length - 1]).toEqual({ done: 0, total: 0, phase: 'done' })
  })

  it('3 papers + per-paper data → papers + related tables all upserted', async () => {
    await chrome.storage.local.set({
      library: [
        { id: 'p1', urlHash: 'h1', title: 'A', authors: ['X'], addedAt: 1, lastRead: 2, pages: 10 },
        { id: 'p2', urlHash: 'h2', title: 'B', authors: ['Y'], addedAt: 1, lastRead: 2, pages: 8 },
        {         urlHash: 'h3', title: 'C', authors: ['Z'], addedAt: 1, lastRead: 2, pages: 4 },
      ],
      'paper:p1:highlights': [{ paragraphId: 'q1', text: 'hi', color: 'yellow' }],
      'paper:p1:memory': { whyItMatters: 'matters', role: '', judgment: '', linked: [], nextActions: [] },
      'paper:h3:chat': { turns: [{ id: 't1', role: 'user', content: 'ask', ts: 1 }] },
    })
    const { __spies } = (await import('../reader/lib/supabase')) as any
    await pushLocalToCloud()

    // 1 batch of papers (3 rows)
    expect(__spies.upsertPapersSpy).toHaveBeenCalledTimes(1)
    expect(__spies.upsertPapersSpy.mock.calls[0][0]).toHaveLength(3)

    // per-paper tables — only tables that had local data should be upserted
    const otherCalls = __spies.fromSpy.mock.calls
      .map((c: any[]) => c[0])
      .filter((t: string) => t !== 'papers')
    expect(otherCalls).toEqual(expect.arrayContaining(['highlights', 'memory', 'chat']))

    const state = (await chrome.storage.local.get('migrationState'))['migrationState']
    expect(state).toBe('done')
  })

  it('papers payload matches v2 schema — no `topic` column, library_id + topic_ids passed through', async () => {
    // Regression: 008_libraries_topics.sql dropped `papers.topic`. Sending it
    // returns 400 from PostgREST. Old local rows (only `topic` label) get
    // null/[]; v2 rows pass libraryId+topicIds through.
    await chrome.storage.local.set({
      library: [
        // pre-v2 row — has legacy `topic` label only
        { id: 'p1', urlHash: 'h1', title: 'A', authors: ['X'], addedAt: 1, lastRead: 2, pages: 5, topic: 'ML' },
        // v2 row — has libraryId + topicIds
        {
          id: 'p2', urlHash: 'h2', title: 'B', authors: ['Y'], addedAt: 1, lastRead: 2, pages: 5,
          libraryId: 'lib-uuid-1', topicIds: ['topic-uuid-a', 'topic-uuid-b'],
        },
      ],
    })
    const { __spies } = (await import('../reader/lib/supabase')) as any
    await pushLocalToCloud()

    const sentRows = __spies.upsertPapersSpy.mock.calls[0][0]
    expect(sentRows).toHaveLength(2)
    for (const r of sentRows) {
      expect(r).not.toHaveProperty('topic')   // dead column, must NOT be sent
      expect(r).toHaveProperty('library_id')
      expect(r).toHaveProperty('topic_ids')
    }
    expect(sentRows[0]).toMatchObject({ library_id: null, topic_ids: [] })
    expect(sentRows[1]).toMatchObject({ library_id: 'lib-uuid-1', topic_ids: ['topic-uuid-a', 'topic-uuid-b'] })
  })

  it('resume: paused state re-runs pushLocalToCloud (idempotent)', async () => {
    await chrome.storage.local.set({
      library: [{ id: 'p1', urlHash: 'h1', title: 'X', pages: 0, addedAt: 1, lastRead: 1 }],
      migrationState: 'paused',
    })
    const { __spies } = (await import('../reader/lib/supabase')) as any
    await resumeIfNeeded()
    expect(__spies.upsertPapersSpy).toHaveBeenCalled()
    const state = (await chrome.storage.local.get('migrationState'))['migrationState']
    expect(state).toBe('done')
  })

  it('resume: done state is a no-op', async () => {
    await chrome.storage.local.set({ migrationState: 'done' })
    const { __spies } = (await import('../reader/lib/supabase')) as any
    await resumeIfNeeded()
    expect(__spies.upsertPapersSpy).not.toHaveBeenCalled()
  })
})

describe('migration.ts — M2 detection + merge', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    vi.clearAllMocks()
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.cloudPaperCount = 0
    __state.cloudPaperKeys = []
  })

  it('detectAndRoute: cloud=0 local=0 → empty', async () => {
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.cloudPaperCount = 0
    __state.cloudPaperKeys = []
    await chrome.storage.local.set({ library: [] })
    const route = await detectAndRoute()
    expect(route).toEqual({ route: 'empty' })
  })

  it('detectAndRoute: cloud=0 local=2 → push-local', async () => {
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.cloudPaperCount = 0
    __state.cloudPaperKeys = []
    await chrome.storage.local.set({
      library: [{ id: 'p1', urlHash: 'h1' }, { id: 'p2', urlHash: 'h2' }],
    })
    const route = await detectAndRoute()
    expect(route).toEqual({ route: 'push-local' })
  })

  it('detectAndRoute: cloud=3 local=0 → pull-only', async () => {
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.cloudPaperCount = 3
    __state.cloudPaperKeys = [{ paper_key: 'a' }, { paper_key: 'b' }, { paper_key: 'c' }]
    await chrome.storage.local.set({ library: [] })
    const route = await detectAndRoute()
    expect(route).toEqual({ route: 'pull-only' })
  })

  it('detectAndRoute: conflict with overlap computed correctly', async () => {
    const { __state } = (await import('../reader/lib/supabase')) as any
    __state.cloudPaperCount = 3
    __state.cloudPaperKeys = [{ paper_key: 'a' }, { paper_key: 'b' }, { paper_key: 'c' }]
    await chrome.storage.local.set({
      library: [
        { id: 'a', urlHash: 'ha' },  // overlap
        { id: 'd', urlHash: 'hd' },  // local-only
        {           urlHash: 'c' },   // overlap (via urlHash fallback)
      ],
    })
    const route = await detectAndRoute()
    expect(route).toEqual({
      route: 'conflict',
      stats: { local: 3, cloud: 3, overlap: 2 },
    })
  })

  it('applyMergeChoice("cloud") wipes local paper:* + library + sets state=done', async () => {
    await chrome.storage.local.set({
      library: [{ id: 'x' }],
      'paper:x:highlights': [{ paragraphId: 'p1', text: 'hi' }],
      'paper:x:parsed': { outline: [] },       // preserved
      'paper:x:summary:v1': 'cached',          // preserved
    })
    await applyMergeChoice('cloud')
    const all = await chrome.storage.local.get(null)
    expect(all['library']).toBeUndefined()
    expect(all['paper:x:highlights']).toBeUndefined()
    expect(all['paper:x:parsed']).toBeDefined()   // regenerable caches preserved
    expect(all['paper:x:summary:v1']).toBeDefined()
    expect(all['migrationState']).toBe('done')
  })
})

describe('pullCloudToLocal — cross-device login (todo: 登录后自动刷新)', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    vi.clearAllMocks()
  })

  it('writes a populated library to chrome.storage.local from cloud rows', async () => {
    const mod = (await import('../reader/lib/supabase')) as any
    mod.__state.cloudPaperKeys = [
      {
        paper_key: 'arxiv-2401-12345',
        title: 'Attention All You Need',
        authors: ['A. Smith', 'B. Jones'],
        pages: 12,
        role: 'foundational',
        library_id: 'lib-uuid-1',
        topic_ids: ['topic-a', 'topic-b'],
        judgment: 'must-read',
        added_at: '2026-04-01T00:00:00.000Z',
        last_read: '2026-04-26T00:00:00.000Z',
      },
    ]
    await pullCloudToLocal()
    const lib = (await chrome.storage.local.get('library'))['library'] as any[]
    expect(Array.isArray(lib)).toBe(true)
    expect(lib).toHaveLength(1)
    expect(lib[0]).toMatchObject({
      id: 'arxiv-2401-12345',
      urlHash: 'arxiv-2401-12345',
      title: 'Attention All You Need',
      authors: ['A. Smith', 'B. Jones'],
      pages: 12,
      role: 'foundational',
      libraryId: 'lib-uuid-1',
      topicIds: ['topic-a', 'topic-b'],
      judgment: 'must-read',
      annotations: 0,        // recomputed by syncLibraryRow when paper opens
      hasMemory: false,      // recomputed when paper opens
    })
    // Date fields parsed from ISO → ms timestamps
    expect(lib[0].addedAt).toBe(Date.parse('2026-04-01T00:00:00.000Z'))
    expect(lib[0].lastRead).toBe(Date.parse('2026-04-26T00:00:00.000Z'))
  })

  it('handles missing/null fields gracefully (defaults to safe values)', async () => {
    const mod = (await import('../reader/lib/supabase')) as any
    mod.__state.cloudPaperKeys = [
      {
        paper_key: 'minimal',
        title: null,
        authors: null,
        pages: null,
        role: null,
        library_id: null,
        topic_ids: null,
        judgment: null,
        added_at: null,
        last_read: null,
      },
    ]
    await pullCloudToLocal()
    const lib = (await chrome.storage.local.get('library'))['library'] as any[]
    expect(lib).toHaveLength(1)
    expect(lib[0]).toMatchObject({
      id: 'minimal',
      urlHash: 'minimal',
      title: '',
      authors: [],
      role: '',
      judgment: '',
      pages: 0,
      libraryId: null,
      topicIds: [],
    })
    // Null date → defaults to "now" (we don't assert exact ms — just that
    // it's a valid number, not NaN/undefined)
    expect(typeof lib[0].addedAt).toBe('number')
    expect(Number.isFinite(lib[0].addedAt)).toBe(true)
  })

  it('overwrites local library with cloud snapshot (idempotent)', async () => {
    await chrome.storage.local.set({
      library: [{ id: 'old-stale', urlHash: 'old-stale', title: 'Stale' }],
    })
    const mod = (await import('../reader/lib/supabase')) as any
    mod.__state.cloudPaperKeys = [
      {
        paper_key: 'fresh',
        title: 'Fresh',
        authors: [],
        pages: 5,
        role: '',
        library_id: null,
        topic_ids: [],
        judgment: '',
        added_at: '2026-04-27T00:00:00.000Z',
        last_read: '2026-04-27T00:00:00.000Z',
      },
    ]
    await pullCloudToLocal()
    const lib = (await chrome.storage.local.get('library'))['library'] as any[]
    expect(lib).toHaveLength(1)
    expect(lib[0].id).toBe('fresh')   // 'old-stale' is gone — full replacement
  })

  it('no-op (early return) when not authenticated', async () => {
    const mod = (await import('../reader/lib/supabase')) as any
    const prevUser = mod.__state.user
    mod.__state.user = null
    await chrome.storage.local.set({
      library: [{ id: 'preserve-me', urlHash: 'preserve-me' }],
    })
    await pullCloudToLocal()
    const lib = (await chrome.storage.local.get('library'))['library'] as any[]
    // Library untouched because we early-returned
    expect(lib).toHaveLength(1)
    expect(lib[0].id).toBe('preserve-me')
    mod.__state.user = prevUser   // restore for other tests
  })
})
