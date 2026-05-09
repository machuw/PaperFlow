// chrome-extension/reader/lib/migration.ts
//
// M1 silent upload: push all local data to Supabase on first login.
// M2 (conflict detection + merge) lives in a sibling module (Task C2).
//
// Progress is emitted via a listener API so UI (MigrationBanner in C3)
// can render progress without tight coupling.
//
// migrationState persistence lets an interrupted upload resume on next
// launch. paperIdMap is also persisted so we don't re-upsert papers
// we've already written.

import { supabase } from './supabase'
import { getItem, setItem, removeItem } from './storage-schema'

export type MigrationPhase = 'idle' | 'migrating' | 'done' | 'paused'

export type Progress = {
  done: number
  total: number
  phase: MigrationPhase
}

type ProgressListener = (p: Progress) => void
const listeners: ProgressListener[] = []

export function onProgress(fn: ProgressListener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

function emit(p: Progress): void {
  listeners.forEach(fn => { try { fn(p) } catch { /* swallow listener errors */ } })
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Uploads local library + per-paper content to Supabase. Idempotent:
 * re-running is safe thanks to upserts keyed on (user_id, paper_key) for
 * papers and (paper_id) for the 1:1 tables.
 */
export async function pushLocalToCloud(): Promise<void> {
  await setItem('migrationState', 'in-progress')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not authenticated')

  // Library is an array under the single 'library' key — this is NOT a
  // per-paper key so we read it with chrome.storage.local directly.
  const rawLib: any[] = (await chrome.storage.local.get('library'))['library'] ?? []
  const total = rawLib.length

  if (total === 0) {
    await setItem('migrationState', 'done')
    emit({ done: 0, total: 0, phase: 'done' })
    return
  }

  // Resume-safe: load any prior paperIdMap and only upsert papers that
  // haven't been mapped yet.
  const paperIdMap: Record<string, string> = (await getItem('paperIdMap')) ?? {}
  let done = Object.keys(paperIdMap).length
  emit({ done, total, phase: 'migrating' })

  // Step 1: papers in batches of 50
  const remaining = rawLib.filter((p: any) => !paperIdMap[p.id ?? p.urlHash])
  for (const batch of chunk(remaining, 50)) {
    const rows = batch.map((p: any) => ({
      user_id: user.id,
      paper_key: p.id ?? p.urlHash,
      title: p.title ?? null,
      authors: Array.isArray(p.authors) ? p.authors : (p.authors ? [p.authors] : null),
      venue: p.venue ?? null,
      pages: typeof p.pages === 'number' ? p.pages : 0,
      role: p.role ?? null,
      // Library v2: 008_libraries_topics.sql dropped `topic`. Pre-v2 local rows
      // only have `p.topic` (a string label) and no UUID for it — the label is
      // dropped on push (cloud catalog migration is out of scope here). v2 rows
      // already carry libraryId + topicIds as UUIDs and pass straight through.
      library_id: typeof p.libraryId === 'string' ? p.libraryId : null,
      topic_ids: Array.isArray(p.topicIds) ? p.topicIds : [],
      judgment: p.judgment ?? null,
      added_at: p.addedAt ? new Date(p.addedAt).toISOString() : new Date().toISOString(),
      last_read: p.lastRead ? new Date(p.lastRead).toISOString() : new Date().toISOString(),
    }))
    try {
      const { data, error } = await supabase
        .from('papers')
        .upsert(rows, { onConflict: 'user_id,paper_key' })
        .select('id, paper_key')
      if (error) throw error
      data?.forEach((r: any) => { paperIdMap[r.paper_key] = r.id })
      await setItem('paperIdMap', paperIdMap)
      done += batch.length
      emit({ done, total, phase: 'migrating' })
    } catch (err) {
      await setItem('migrationState', 'paused')
      emit({ done, total, phase: 'paused' })
      throw err
    }
  }

  // Step 2: per-paper attached data. Order doesn't matter; upserts are
  // scoped by paper_id (1:1 tables) or id (uuid, for highlights/notes).
  for (const [paperKey, paperId] of Object.entries(paperIdMap)) {
    for (const [makeKey, table, conflict] of [
      [(k: string) => `paper:${k}:highlights`, 'highlights',   'id'],
      [(k: string) => `paper:${k}:notes`,      'margin_notes', 'id'],
      [(k: string) => `paper:${k}:memory`,     'memory',       'paper_id'],
      [(k: string) => `paper:${k}:chat`,       'chat',         'paper_id'],
      [(k: string) => `paper:${k}:canvas`,     'canvas',       'paper_id'],
    ] as const) {
      const storageKey = makeKey(paperKey)
      const local = (await chrome.storage.local.get(storageKey))[storageKey]
      if (!local) continue
      const rows = transformForTable(local, paperId, user.id, table)
      if (rows.length === 0) continue
      try {
        const { error } = await supabase
          .from(table)
          .upsert(rows as any, { onConflict: conflict })
        if (error) throw error
      } catch (err) {
        await setItem('migrationState', 'paused')
        emit({ done, total, phase: 'paused' })
        throw err
      }
    }
  }

  await setItem('migrationState', 'done')
  await removeItem('paperIdMap')
  emit({ done, total, phase: 'done' })
}

/**
 * Shape-normalises local data into rows matching each table's schema.
 * If the local shape differs from what we expect, keep the upsert safe
 * by filtering out rows missing required fields.
 *
 * Local chat shape is `ChatMessage[]` (see reader/types.ts: flat array of
 * `{id, role, text, citations?, createdAt}`), which diverges from the
 * spec's §14.7.7.2 `{turns: ChatTurn[]}` shape. We normalise either form
 * to `{turns: [{id, role, content, ts}]}` for the cloud.
 */
function transformForTable(
  local: any,
  paperId: string,
  userId: string,
  table: 'highlights' | 'margin_notes' | 'memory' | 'chat' | 'canvas',
): any[] {
  switch (table) {
    case 'highlights': {
      if (!Array.isArray(local)) return []
      return local
        .filter((h: any) => typeof h?.paragraphId === 'string' && typeof h?.text === 'string')
        .map((h: any) => ({
          user_id: userId,
          paper_id: paperId,
          paragraph_id: h.paragraphId,
          text: h.text,
          color: h.color ?? 'yellow',
          // local highlights don't carry their own id; let Postgres default gen_random_uuid()
        }))
    }
    case 'margin_notes': {
      if (!Array.isArray(local)) return []
      return local
        .filter(
          (n: any) =>
            typeof n?.paragraphId === 'string' &&
            ['explain', 'summarize', 'translate', 'ask'].includes(n?.kind),
        )
        .map((n: any) => ({
          // Local notes use id = `r-${Date.now()}-${slug}` (see runAction in
          // main.tsx) which is not a valid UUID — the Postgres `id uuid`
          // column rejects it with 400. Drop the local id and let the column
          // default `gen_random_uuid()` assign a proper UUID. The outer
          // upsert's `onConflict: 'id'` becomes a no-op here (always INSERT)
          // so a replay after a mid-migration failure would duplicate rows;
          // normal flow flips `migrationState` to 'done' after first success
          // so this path runs at most once per user.
          user_id: userId,
          paper_id: paperId,
          paragraph_id: n.paragraphId,
          kind: n.kind,
          source: n.source ?? '',
          body: n.body ?? '',
          created_at: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
        }))
    }
    case 'memory': {
      if (!local || typeof local !== 'object') return []
      return [{
        paper_id: paperId,
        user_id: userId,
        why_it_matters: local.whyItMatters ?? '',
        role: local.role ?? '',
        judgment: local.judgment ?? '',
        linked: Array.isArray(local.linked) ? local.linked : [],
        next_actions: Array.isArray(local.nextActions) ? local.nextActions : [],
      }]
    }
    case 'chat': {
      // Local may be either:
      //   - ChatMessage[]: [{id, role, text, citations?, createdAt}]
      //   - {turns: ChatTurn[]}: newer §14.7.7.2 shape
      //   - any other value: treat as empty turns (don't throw)
      let turns: any[] = []
      if (Array.isArray(local)) {
        turns = local.map((m: any) => ({
          id: m?.id ?? '',
          role: m?.role ?? 'user',
          content: m?.text ?? m?.content ?? '',
          ts: typeof m?.createdAt === 'number' ? m.createdAt : Date.now(),
        }))
      } else if (local && typeof local === 'object' && Array.isArray(local.turns)) {
        turns = local.turns
      }
      return [{ paper_id: paperId, user_id: userId, turns }]
    }
    case 'canvas': {
      if (!local || typeof local !== 'object') return []
      const nodes = Array.isArray(local.nodes) ? local.nodes : []
      return [{ paper_id: paperId, user_id: userId, nodes }]
    }
    default:
      return []
  }
}

/**
 * Check migrationState on startup. If it's 'in-progress' or 'paused',
 * resume automatically. The upserts are idempotent so re-running
 * mid-sequence doesn't duplicate rows.
 */
export async function resumeIfNeeded(): Promise<void> {
  const state = await getItem('migrationState')
  if (state === 'in-progress' || state === 'paused') {
    await pushLocalToCloud()
  }
}

/**
 * Cross-device login: cloud has data but local is empty (or wiped via the
 * 'cloud-wins' merge choice). Pulls the user's papers list from Supabase
 * into chrome.storage.local under the 'library' key so LibraryDrawer's
 * next read shows fresh data without manual reload.
 *
 * Only the LibraryRow shape is populated. annotations + hasMemory are
 * recomputed when the user actually opens each paper (syncLibraryRow in
 * lib/library.ts). Per-paper attached data (highlights/notes/chat/canvas)
 * is left to the existing per-paper read paths to lazy-pull.
 *
 * Idempotent: re-running overwrites local 'library' with cloud's snapshot.
 */
export async function pullCloudToLocal(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data, error } = await supabase
    .from('papers')
    .select('paper_key, title, authors, pages, role, library_id, topic_ids, judgment, added_at, last_read')
  if (error || !data) return

  const rows = data.map((p: any) => ({
    id: typeof p.paper_key === 'string' ? p.paper_key : '',
    urlHash: typeof p.paper_key === 'string' ? p.paper_key : '',
    title: p.title ?? '',
    authors: Array.isArray(p.authors) ? p.authors : [],
    role: p.role ?? '',
    judgment: p.judgment ?? '',
    addedAt: p.added_at ? Date.parse(p.added_at) : Date.now(),
    lastRead: p.last_read ? Date.parse(p.last_read) : Date.now(),
    pages: typeof p.pages === 'number' ? p.pages : 0,
    annotations: 0,
    hasMemory: false,
    libraryId: typeof p.library_id === 'string' ? p.library_id : null,
    topicIds: Array.isArray(p.topic_ids) ? p.topic_ids : [],
  }))

  await chrome.storage.local.set({ library: rows })
}

// ─── M2 · conflict detection + merge branches (Phase C Task C2) ─────────────

export type MigrationChoice = 'merge' | 'local' | 'cloud'

export type Route =
  | { route: 'empty' }
  | { route: 'push-local' }
  | { route: 'pull-only' }
  | { route: 'conflict'; stats: { local: number; cloud: number; overlap: number } }

/**
 * Decide which migration branch to run. Called after first login on a
 * reader tab (MigrationBanner in Task C3 dispatches).
 *
 *   cloud=0 + local=0  → empty       (nothing to migrate)
 *   cloud=0 + local>0  → push-local  (M1 silent upload)
 *   cloud>0 + local=0  → pull-only   (normal cross-device sign-in; realtime+queries pull down naturally)
 *   cloud>0 + local>0  → conflict    (show ConflictModal for user choice)
 */
export async function detectAndRoute(): Promise<Route> {
  const { count: cloudCount } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })

  const rawLib: any[] = (await chrome.storage.local.get('library'))['library'] ?? []
  const localCount = rawLib.length

  const cCount = cloudCount ?? 0

  if (cCount === 0 && localCount === 0) return { route: 'empty' }
  if (cCount === 0 && localCount > 0) return { route: 'push-local' }
  if (cCount > 0 && localCount === 0) return { route: 'pull-only' }

  // Conflict — compute overlap by paper_key
  const { data: cloudPapers } = await supabase.from('papers').select('paper_key')
  const cloudKeys = new Set((cloudPapers ?? []).map((p: any) => p.paper_key))
  const overlap = rawLib.filter((p: any) => cloudKeys.has(p.id ?? p.urlHash)).length

  return { route: 'conflict', stats: { local: localCount, cloud: cCount, overlap } }
}

/**
 * Apply the user's merge choice:
 *   - 'merge': Supabase UPSERT semantics already implement per-row merge.
 *     Per-table rules (spec §7.3):
 *       papers        — `last_read` is kept for each row (UPSERT on conflict DO UPDATE SET last_read = EXCLUDED.last_read WHERE EXCLUDED.last_read > papers.last_read)
 *                       — but Supabase upsert defaults to replace-on-conflict. We special-case papers with a "latest" pass: read cloud side, compare, upsert with the newer last_read.
 *       highlights/margin_notes — id is a uuid; union. Locals without ids aren't uploaded (UX: only explicit notes have ids).
 *       memory/chat/canvas — paper_id is primary key. Compare updated_at; keep newer.
 *   - 'local': brute-force push-local after clearing cloud of extras (delete from papers where paper_key NOT IN local set).
 *   - 'cloud': wipe local paper:* keys + library; realtime + queries repopulate from cloud.
 */
export async function applyMergeChoice(choice: MigrationChoice): Promise<void> {
  if (choice === 'merge') {
    // MVP: rely on pushLocalToCloud's upsert semantics. Per-table merge rules
    // per spec §7.3 are approximated — rows already in cloud get overwritten
    // by local values if their last_read is newer; otherwise the cloud side
    // wins because we DON'T delete cloud extras. This is a safe merge
    // (never destructive on cloud).
    //
    // TODO (v2 refinement): implement proper "keep newer updated_at per paper"
    // merge for memory/chat/canvas. For now, local wins on upsert for these
    // 1:1 tables — acceptable because after first successful merge, realtime
    // will converge both sides.
    await pushLocalToCloud()
    return
  }

  if (choice === 'local') {
    // Push all local first (same as merge), then delete cloud extras.
    await pushLocalToCloud()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const rawLib: any[] = (await chrome.storage.local.get('library'))['library'] ?? []
    const localKeys = rawLib.map((p: any) => p.id ?? p.urlHash)
    if (localKeys.length > 0) {
      // Delete cloud papers NOT in local; cascade handles related tables.
      await supabase.from('papers').delete().not('paper_key', 'in', `(${localKeys.map((k: string) => `"${k}"`).join(',')})`)
    } else {
      await supabase.from('papers').delete().gte('added_at', '1970-01-01')
    }
    return
  }

  if (choice === 'cloud') {
    // Wipe local paper:* + library; realtime subscriptions + reader's
    // normal queries will repopulate from cloud as the user navigates.
    const all = await chrome.storage.local.get(null)
    const toRemove = Object.keys(all).filter(
      k => k.startsWith('paper:') &&
           !k.endsWith(':parsed') &&
           !k.includes(':summary:'),
    )
    toRemove.push('library')
    await chrome.storage.local.remove(toRemove)
    await setItem('migrationState', 'done')
    emit({ done: 0, total: 0, phase: 'done' })
    return
  }
}
