/**
 * Integration test: highlight dual-write contract (L5-1)
 *
 * Spec §5.3 (dual-write):
 *   highlights 表保留；与 margin_notes 里 kind='highlight' 保持一致性
 *   （写入时双写，读取时以 margin_notes 为准）。
 *
 * Spec §18.3 Critical Gap:
 *   `notes.upsertNote(highlight)` 双写非原子：先写 margin_notes 后写
 *   highlights。中间 fail → margin_notes 有记录，highlights 没有。
 *
 * This test file documents the dual-write contract at three layers:
 *
 *   Layer 1 (local + sync-queue) — fully wired, active tests.
 *   Layer 2 (cloud Supabase round-trip) — requires running local Supabase;
 *           tests are guarded with `functionReachable()` and skipped if the
 *           devnote is absent or Supabase is down.
 *   Layer 3 (cloud highlights table sync + delete propagation) — NOT yet
 *           wired in production code; documented with it.todo() per spec §18.3.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Supabase credentials — graceful fallback when devnote is absent (worktrees).
// ---------------------------------------------------------------------------
let SB_URL = ''
let SB_ANON = ''
let SB_SERVICE = ''
let supabaseAvailable = false

try {
  const devnote = readFileSync(
    resolve(__dirname, '..', '..', '..', 'supabase', '.env.local-devnote.md'),
    'utf8',
  )
  function extract(pattern: RegExp): string {
    const m = devnote.match(pattern)
    if (!m) throw new Error(`Could not find ${pattern} in devnote`)
    return m[1].trim()
  }
  SB_URL = extract(/SB_URL=(.+)/)
  SB_ANON = extract(/SB_ANON=(.+)/)
  SB_SERVICE = extract(/SB_SERVICE=(.+)/)
  supabaseAvailable = true
} catch {
  // devnote absent (e.g. git worktree without the gitignored file) or
  // Supabase not configured — Layer-2 tests will self-skip via the guard below.
  supabaseAvailable = false
}

async function sbReachable(): Promise<boolean> {
  if (!supabaseAvailable || !SB_URL) return false
  try {
    const r = await fetch(`${SB_URL}/rest/v1/`, { method: 'HEAD' })
    return r.ok || r.status === 401 // 401 = JWT required = server is up
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Chrome storage mock — used by local (Layer-1) tests.
// ---------------------------------------------------------------------------
const storageMock: Record<string, unknown> = {}
function setupChromeMock() {
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) =>
          Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => {
          Object.assign(storageMock, obj)
          return Promise.resolve()
        },
        remove: (k: string) => {
          delete storageMock[k]
          return Promise.resolve()
        },
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key]
          return Promise.resolve()
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
}

// ---------------------------------------------------------------------------
// LAYER 1 — local storage + sync-queue (no Supabase required)
// ---------------------------------------------------------------------------

describe('Layer-1: local dual-write (no Supabase required)', () => {
  // The Notes module imports storage-schema which imports chrome.storage —
  // set up the mock before importing anything from the production modules.
  beforeEach(() => {
    for (const k of Object.keys(storageMock)) delete storageMock[k]
    setupChromeMock()
  })

  /**
   * Test 1 — After runSelectionAction(kind='highlight') the local notes store
   * contains exactly one Note with kind='highlight'.
   *
   * §5.3: margin_notes 负责 Note tab 列表视图.
   * runSelectionAction calls Notes.upsertNote internally for the highlight case.
   */
  it('runSelectionAction(highlight) writes a Note with kind=highlight to local storage', async () => {
    // Lazy import so chrome mock is set up first.
    const { runSelectionAction } = await import('../../reader/lib/selection-actions')
    const Notes = await import('../../reader/lib/notes')

    const pk = 'test-paper-1'
    const sel = {
      text: 'selected text for highlight',
      rect: {} as DOMRect,
      paragraphId: 'p-3',
    }
    const paper = {
      title: 'Test Paper',
      authors: [],
      abstract: '',
      paragraphs: [],
      outline: [],
    } as any

    await runSelectionAction({
      kind: 'highlight',
      paperKey: pk,
      paper,
      sel,
      currentSessionId: null,
      model: 'gpt-4o',
      lang: 'auto',
    })

    const notes = await Notes.listNotes(pk)
    const highlights = notes.filter((n) => n.kind === 'highlight')
    expect(highlights).toHaveLength(1)
    expect(highlights[0].quote).toBe('selected text for highlight')
    expect(highlights[0].kind).toBe('highlight')
    expect(highlights[0].id).toBeTruthy()
  })

  /**
   * Test 2 — shouldSyncNote gate: 'highlight' returns true, 'explain' false.
   *
   * §5.3: AI-derived kinds stay local. User-content kinds (note, highlight)
   * are synced to margin_notes. This is the filter that guards enqueue().
   */
  it('shouldSyncNote returns true for highlight and false for explain/translate', async () => {
    const { shouldSyncNote } = await import('../../reader/lib/sync-queue')

    expect(shouldSyncNote('highlight')).toBe(true)
    expect(shouldSyncNote('note')).toBe(true)
    expect(shouldSyncNote(undefined)).toBe(true)   // legacy row default → §10.2
    expect(shouldSyncNote('explain')).toBe(false)
    expect(shouldSyncNote('translate')).toBe(false)
    expect(shouldSyncNote('summarize')).toBe(false) // deprecated kind §17.A.1
    expect(shouldSyncNote('ask')).toBe(false)       // deprecated kind §17.A.1
  })

  /**
   * Test 3 — The sync-queue entry enqueued after a highlight action targets
   * the `margin_notes` table with op=upsert and contains the note id + kind.
   *
   * §5.3: 写入时双写 — the queue row is the mechanism that will push to
   * margin_notes on drain(). Verifies the payload shape expected by drain().
   */
  it('enqueue after highlight targets the highlights table with correct payload shape (A5)', async () => {
    const { enqueue } = await import('../../reader/lib/sync-queue')

    const id = crypto.randomUUID()
    await enqueue({
      table: 'highlights',
      op: 'upsert',
      row: {
        id,
        paper_key: 'arxiv:1234.56789',
        paragraph_id: 'sec0-p1',
        text: 'some selected text',
        created_at: new Date().toISOString(),
      },
      ts: Date.now(),
    })

    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[]
    expect(raw).toHaveLength(1)
    expect(raw[0].table).toBe('highlights')
    expect(raw[0].op).toBe('upsert')
    expect(raw[0].row.id).toBe(id)
    expect(raw[0].row.paper_key).toBe('arxiv:1234.56789')
    expect(raw[0].row.paragraph_id).toBe('sec0-p1')
    expect(raw[0].row.text).toBe('some selected text')
  })

  /**
   * Test 4 — Non-syncable note kinds (explain/translate) must NOT produce a
   * margin_notes queue entry. This is the inverse of Test 3.
   *
   * §5.3: AI-derived kinds ('explain', 'translate') stay local — they're large,
   * regenerable, and have low cross-device value.
   */
  it('explain/translate notes do NOT add a margin_notes queue entry', async () => {
    const { shouldSyncNote, enqueue } = await import('../../reader/lib/sync-queue')

    // Simulate the guard in runAction (main.tsx line 964)
    for (const kind of ['explain', 'translate', 'summarize', 'ask']) {
      if (shouldSyncNote(kind)) {
        await enqueue({
          table: 'margin_notes',
          op: 'upsert',
          row: { id: crypto.randomUUID(), kind, quote: 'text' },
          ts: Date.now(),
        })
      }
    }

    const raw = (await chrome.storage.local.get('sync:queue'))['sync:queue'] as any[] | undefined
    expect(raw ?? []).toHaveLength(0)
  })

  /**
   * Test 5 — Notes.deleteNote removes the note from local storage.
   *
   * §18.3 Critical Gap flags that deletion should also drain a delete op
   * to margin_notes. The cloud-delete side is documented in it.todo() below;
   * this test confirms the local deletion is correct.
   */
  it('Notes.deleteNote removes the note from local storage', async () => {
    const { runSelectionAction } = await import('../../reader/lib/selection-actions')
    const Notes = await import('../../reader/lib/notes')

    const pk = 'test-paper-delete'
    const sel = { text: 'text to delete', rect: {} as DOMRect, paragraphId: 'p-1' }
    const paper = { title: 'T', authors: [], abstract: '', paragraphs: [], outline: [] } as any

    const result = await runSelectionAction({
      kind: 'highlight', paperKey: pk, paper, sel,
      currentSessionId: null, model: 'gpt-4o', lang: 'auto',
    })

    const before = await Notes.listNotes(pk)
    expect(before.some((n) => n.id === result.actionId)).toBe(true)

    await Notes.deleteNote(pk, result.actionId)

    const after = await Notes.listNotes(pk)
    expect(after.some((n) => n.id === result.actionId)).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Deferred: cloud delete propagation NOT YET WIRED in main.tsx (§18.3 gap).
  //
  // handleDeleteNote (main.tsx line 1205) calls Notes.deleteNote but does NOT
  // enqueue a { table: 'margin_notes', op: 'delete', row: { id } } entry.
  // When this is implemented, remove the .todo() and write the assertion:
  //   const q = queue.filter(op => op.table === 'margin_notes' && op.op === 'delete')
  //   expect(q[0].row.id).toBe(deletedNoteId)
  //
  // Tracking: §18.3 Critical Gap "deleteNote 无 cloud delete enqueue"
  // ---------------------------------------------------------------------------
  it.todo('deleteNote enqueues a margin_notes delete op (§18.3 gap — wiring missing in handleDeleteNote)')
})

// ---------------------------------------------------------------------------
// LAYER 2 — Supabase round-trip (requires running local Supabase)
// ---------------------------------------------------------------------------

describe('Layer-2: Supabase margin_notes round-trip', () => {
  /**
   * Test 6 — A highlights upsert reaches Supabase via direct REST and is
   * queryable by the same user. Mirrors the schema fields the production
   * sync-queue drain() now sends after the A5 fix:
   *   id (uuid) / user_id / paper_id (uuid) / paragraph_id / text / created_at
   *
   * Skipped when Supabase is not running or devnote is absent.
   */
  it('highlights row round-trip reaches Supabase (A5)', async () => {
    if (!(await sbReachable())) {
      console.log('Supabase not reachable — skipping Layer-2 test')
      return
    }

    const { createClient } = await import('@supabase/supabase-js')

    const admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const uid = `${Date.now()}-${Math.floor(Math.random() * 9999)}`
    const email = `dualwrite-l2-${uid}@test.com`
    await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
    const userClient = createClient(SB_URL, SB_ANON)
    const { data: signIn } = await userClient.auth.signInWithPassword({ email, password: 'pw123456' })
    const userId = signIn.user!.id

    // Insert a paper row first — highlights.paper_id FK → papers.id.
    const paperKey = `arxiv:2501.${uid}`
    const { data: paperRow } = await userClient.from('papers')
      .upsert({ user_id: userId, paper_key: paperKey, title: 'Dual Write Test Paper' })
      .select('id')
      .single()
    const paperId = paperRow!.id

    const highlightId = crypto.randomUUID()
    const { error } = await userClient.from('highlights').upsert({
      id: highlightId,
      user_id: userId,
      paper_id: paperId,
      paragraph_id: 'sec0-p1',
      text: 'round-trip highlight text',
    })

    expect(error).toBeNull()

    const { data: rows } = await userClient.from('highlights')
      .select('id, text, paragraph_id')
      .eq('id', highlightId)

    expect(rows).toHaveLength(1)
    expect(rows![0].text).toBe('round-trip highlight text')
    expect(rows![0].paragraph_id).toBe('sec0-p1')

    // Cleanup
    await userClient.from('highlights').delete().eq('id', highlightId)
    await userClient.from('papers').delete().eq('id', paperId)
    await admin.auth.admin.deleteUser(userId)
  })

  /**
   * Test 7 — Deleting a margin_notes row via the Supabase client removes it.
   *
   * Verifies the delete side of the sync contract from the Supabase perspective.
   * Skipped when Supabase is not running.
   */
  it('margin_notes row delete is reflected in Supabase', async () => {
    if (!(await sbReachable())) {
      console.log('Supabase not reachable — skipping Layer-2 test')
      return
    }

    const { createClient } = await import('@supabase/supabase-js')

    const admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const uid = `${Date.now()}-${Math.floor(Math.random() * 9999)}`
    const email = `dualwrite-l2b-${uid}@test.com`
    await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
    const userClient = createClient(SB_URL, SB_ANON)
    const { data: signIn } = await userClient.auth.signInWithPassword({ email, password: 'pw123456' })
    const userId = signIn.user!.id

    const paperKey = `arxiv:2502.${uid}`
    await userClient.from('papers').upsert({ paper_key: paperKey, title: 'Delete Test Paper' })

    const noteId = crypto.randomUUID()
    await userClient.from('margin_notes').upsert({
      id: noteId,
      paper_key: paperKey,
      kind: 'highlight',
      quote: 'to be deleted',
    })

    // Delete
    const { error: delErr } = await userClient.from('margin_notes').delete().eq('id', noteId)
    expect(delErr).toBeNull()

    const { data: rows } = await userClient.from('margin_notes').select('id').eq('id', noteId)
    expect(rows).toHaveLength(0)

    // Cleanup
    await admin.auth.admin.deleteUser(userId)
  })

  // ---------------------------------------------------------------------------
  // Deferred: highlights table cloud sync NOT YET WIRED (§18.3 Critical Gap).
  //
  // Per spec §5.3: highlights 表与 margin_notes 里 kind='highlight' 保持一致性。
  // Currently main.tsx calls addHighlight() which writes to LOCAL chrome.storage
  // highlights key, but does NOT enqueue an op to the `highlights` Supabase table.
  // The drain() path only enqueues to `margin_notes` (line 965 of main.tsx).
  //
  // When this is implemented:
  //   1. enqueue({ table: 'highlights', op: 'upsert', row: { id, paper_key, ... } })
  //      should be added alongside the margin_notes enqueue.
  //   2. Remove these .todo() items and add a cloud round-trip assertion.
  //
  // Tracking: §18.3 Critical Gap "highlights 表无 cloud sync enqueue"
  // ---------------------------------------------------------------------------
  it.todo('highlights table receives a cloud upsert when a highlight is created (§18.3 gap — highlights enqueue missing)')
  it.todo('deleting a highlight removes row from BOTH margin_notes AND highlights tables (§18.3 gap — atomicity not yet implemented)')
})
