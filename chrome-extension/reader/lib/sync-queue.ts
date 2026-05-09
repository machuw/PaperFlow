// chrome-extension/reader/lib/sync-queue.ts

import { supabase } from './supabase'
import { getItem, setItem, removeItem } from './storage-schema'

export type PendingOp =
  | { table: string; op: 'upsert' | 'delete'; row: any; ts: number }
  | { kind: 'rpc'; fn: 'delete-library' | 'delete-topic'; args: any; ts: number }

export type SyncableNoteKind = 'note' | 'highlight'

/**
 * Gate which note kinds are pushed to the cloud margin_notes table.
 * §5.3: only 'note' and 'highlight' are user-content worth syncing.
 * AI-derived kinds ('explain', 'translate') stay local — they're large,
 * regenerable, and have low cross-device value. Deprecated kinds
 * ('summarize', 'ask') are kept in AiActionKind for historical compat
 * (§17.A.1) but must not be pushed if a stale local row still has them.
 * Legacy rows without a kind field default to 'note' per §10.2 → sync.
 */
export function shouldSyncNote(kind: string | undefined): boolean {
  return kind === undefined || kind === 'note' || kind === 'highlight'
}

/**
 * Append to the offline queue. Writes that failed because the client is
 * offline sit here until `drain()` flushes them back online.
 */
export async function enqueue(op: PendingOp): Promise<void> {
  const q = (await getItem('sync:queue')) ?? []
  q.push(op)
  await setItem('sync:queue', q)
}

/**
 * Flush pending ops to Supabase. No-op when offline. On any failure the
 * queue is preserved — next drain retries from the top. upsert is idempotent
 * by spec's UPSERT semantics, so replaying a partial drain is safe.
 */
export async function drain(): Promise<void> {
  if (!navigator.onLine) return
  const q = (await getItem('sync:queue')) ?? []
  // Cache paper_key → paper_id resolutions within a single drain pass; the
  // map is rebuilt next drain so it never goes stale across sessions.
  const paperKeyCache = new Map<string, string>()
  let cachedUserId: string | null = null
  const getUserId = async (): Promise<string | null> => {
    if (cachedUserId !== null) return cachedUserId
    const { data: { user } } = await supabase.auth.getUser()
    cachedUserId = user?.id ?? null
    return cachedUserId
  }
  const resolvePaperId = async (paperKey: string): Promise<string | null> => {
    if (paperKeyCache.has(paperKey)) return paperKeyCache.get(paperKey)!
    const { data, error } = await supabase
      .from('papers')
      .select('id')
      .eq('paper_key', paperKey)
      .maybeSingle()
    if (error || !data?.id) return null
    paperKeyCache.set(paperKey, data.id as string)
    return data.id as string
  }
  for (const op of q) {
    try {
      if ('kind' in op && op.kind === 'rpc') {
        const { error } = await supabase.functions.invoke(op.fn, { body: op.args })
        if (error) throw error
        continue
      }
      if (op.op === 'upsert') {
        // A5: notes/highlights tables need {user_id, paper_id (uuid)} which
        // aren't available at enqueue time — call sites stash paper_key on
        // a virtual field and we resolve it here, alongside session user_id.
        let row = op.row
        if (
          (op.table === 'margin_notes' || op.table === 'highlights') &&
          row && typeof row === 'object' && typeof row.paper_key === 'string'
        ) {
          const userId = await getUserId()
          if (!userId) throw new Error('drain: no user session')
          const paperId = await resolvePaperId(row.paper_key)
          if (!paperId) {
            // Paper not yet synced to cloud — defer to next drain. The papers
            // upsert is enqueued earlier so on next online cycle it lands first.
            throw new Error(`drain: paper_key="${row.paper_key}" not yet in papers — deferring`)
          }
          const { paper_key, ...rest } = row
          row = { ...rest, user_id: userId, paper_id: paperId }
        }
        const { error } = await supabase.from(op.table).upsert(row)
        if (error) throw error
      }
      if (op.op === 'delete') {
        const { error } = await supabase.from(op.table).delete().match(op.row)
        if (error) throw error
      }
    } catch (err: any) {
      // Papers-table cap-trigger (TODO.md § Post-launch, once landed) surfaces
      // as a Postgres P0001 "raise exception" whose message mentions the cap.
      // Wipe the F1 banner-dismiss flag so the banner reappears on next
      // drawer open. Queue is still preserved — caller will retry.
      if ('table' in op && op.table === 'papers') {
        const isCapError =
          err?.code === 'P0001' ||
          (typeof err?.message === 'string' && err.message.includes('cap'))
        if (isCapError) {
          await removeItem('libraryCapBannerDismissed')
        }
      }
      return  // keep queue; retry on next drain
    }
  }
  await removeItem('sync:queue')
}

/**
 * Empty the queue unconditionally. Used by logout (spec §15.1) to prevent
 * cross-account data leak: without this, Alice's offline writes could be
 * submitted under Bob's JWT after Alice logs out and Bob logs in.
 */
export async function clear(): Promise<void> {
  await removeItem('sync:queue')
}

// Auto-drain on reconnect. Safe to attach at module load: if the module
// isn't running (e.g., reader tab closed), sw.js triggers drain via
// chrome.alarms in Task B9.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void drain() })
}
