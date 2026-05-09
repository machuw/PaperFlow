import type { Paper, LibraryRow } from '../types';
import { paperKey } from './ids';
import { extractRolePrefix } from './paper';
import {
  getLibraryRaw, setLibraryRaw, LIB_LOCK_KEY,
  getHighlights, getNotes, withKeyLock,
} from './storage';
import { enqueue } from './sync-queue';
import { supabase } from './supabase';
import { removeItem } from './storage-schema';
import { FREE_LIBRARY_CAP } from './constants';

export async function getLibrary(): Promise<LibraryRow[]> {
  const raw = await getLibraryRaw();
  if (!Array.isArray(raw)) return [];
  return raw as LibraryRow[];
}

/**
 * Internal raw upsert — writes `row` into the `library` storage key without
 * acquiring LIB_LOCK_KEY. Must only be called from within an existing
 * withKeyLock(LIB_LOCK_KEY) critical section to avoid races.
 */
async function upsertLibraryEntryRaw(row: LibraryRow): Promise<LibraryRow[]> {
  const existing = await getLibrary();
  const key = row.id ?? row.urlHash;
  const idx = existing.findIndex((e) => (e.id ?? e.urlHash) === key);
  const next = idx === -1 ? [...existing, row] : existing.map((e, j) => j === idx ? row : e);
  await setLibraryRaw(next);
  return next;
}

export async function upsertLibraryEntry(row: LibraryRow): Promise<LibraryRow[]> {
  return withKeyLock(LIB_LOCK_KEY, async () => {
    return upsertLibraryEntryRaw(row);
  });
}

export async function removeLibraryEntry(paperKeyToRemove: string): Promise<LibraryRow[]> {
  return withKeyLock(LIB_LOCK_KEY, async () => {
    const existing = await getLibrary();
    const next = existing.filter((e) => (e.id ?? e.urlHash) !== paperKeyToRemove);
    await setLibraryRaw(next);
    return next;
  });
}

/**
 * Compute hasMemory per §3.4 — any field is considered set only if it has
 * non-whitespace content (for strings) or non-empty length (for arrays).
 */
function computeHasMemory(m: Paper['memory']): boolean {
  return !!(
    m.whyItMatters?.trim() ||
    m.role?.trim() ||
    m.judgment?.trim() ||
    m.linked.length > 0 ||
    m.nextActions.length > 0
  );
}

/**
 * Add a paper to the library. This is the ONLY function permitted to create
 * a new library row. Runs cap check + cloud upsert via enqueueLibraryRowSync.
 *
 * Wraps the full read+write sequence in withKeyLock(LIB_LOCK_KEY) to prevent
 * stale-read races when two tabs Add the same paper concurrently (T-28-02).
 * Uses upsertLibraryEntryRaw inside the lock to avoid nested lock deadlock.
 *
 * Called from: Add to Library button onClick (Phase 28 Plan 03).
 */
export async function addToLibrary(paper: Paper, pages: number, src?: string): Promise<void> {
  return withKeyLock(LIB_LOCK_KEY, async () => {
    const key = paperKey(paper);
    const [highlights, notes] = await Promise.all([
      getHighlights(key),
      getNotes(key),
    ]);
    const existing = await getLibrary();
    const existingRow = existing.find((e) => (e.id ?? e.urlHash) === key);
    const now = Date.now();

    const row: LibraryRow = {
      id: paper.id,
      urlHash: paper.urlHash,
      title: paper.title,
      authors: paper.authors,
      role: extractRolePrefix(paper.memory.role),
      judgment: paper.memory.judgment,
      // Idempotent re-add: preserve original addedAt if row already exists
      addedAt: existingRow?.addedAt ?? now,
      lastRead: now,
      pages,
      annotations: highlights.length + notes.length,
      hasMemory: computeHasMemory(paper.memory),
      libraryId: existingRow?.libraryId ?? null,
      topicIds: existingRow?.topicIds ?? [],
      src: src ?? existingRow?.src,
    };

    await upsertLibraryEntryRaw(row);
    // best-effort cloud sync — local row is written regardless of cloud failure (D-08)
    await enqueueLibraryRowSync(row, paper, pages).catch(() => { /* best effort */ });
  });
}

/**
 * Refresh metadata on an existing library row. Silent no-op when the row is
 * missing — this is intentional (LIB-OPTIN-06): opening or editing a paper
 * that the user has NOT Added to library must not silently create a row.
 *
 * Preserves: addedAt, libraryId, topicIds.
 * Stamps: lastRead = now.
 * Recomputes: annotations, hasMemory, role, judgment.
 *
 * FORBIDDEN inside this function:
 *   - enqueue / enqueueLibraryRowSync (no cloud sync)
 *   - shouldSkipFreeCap / removeItem('libraryCapBannerDismissed') (no cap check)
 *   - supabase.from (no cloud queries)
 *
 * Called from: patchMemory after / addHighlight after (Phase 28 Plan 03).
 */
export async function updateLibraryRow(paper: Paper, pages: number, src?: string): Promise<void> {
  return withKeyLock(LIB_LOCK_KEY, async () => {
    const existing = await getLibrary();
    const key = paperKey(paper);
    const existingRow = existing.find((e) => (e.id ?? e.urlHash) === key);
    // Silent no-op when paper is not in library (LIB-OPTIN-06)
    if (!existingRow) return;

    const [highlights, notes] = await Promise.all([
      getHighlights(key),
      getNotes(key),
    ]);

    const row: LibraryRow = {
      id: paper.id,
      urlHash: paper.urlHash,
      title: paper.title,
      authors: paper.authors,
      role: extractRolePrefix(paper.memory.role),
      judgment: paper.memory.judgment,
      // Preserve original addedAt, libraryId, topicIds
      addedAt: existingRow.addedAt,
      lastRead: Date.now(),
      pages,
      annotations: highlights.length + notes.length,
      hasMemory: computeHasMemory(paper.memory),
      libraryId: existingRow.libraryId,
      topicIds: existingRow.topicIds,
      // Preserve src when caller passes none
      src: src ?? existingRow.src,
    };

    await upsertLibraryEntryRaw(row);
    // No enqueue — updateLibraryRow never touches cloud sync / cap paths (D-12)
  });
}

/**
 * Enqueue an upsert for the `papers` cloud row. Skips silently when the user
 * is not logged in. The queue drains on SW startup + online events (see
 * background/sw.ts + sync-queue.ts).
 *
 * Free-tier cap (spec §7.4 Option B): when a Free user already has
 * FREE_LIBRARY_CAP papers in cloud, NEW papers stay local-only — we skip the
 * enqueue and clear the cap-banner dismiss timestamp so the banner reappears
 * on next drawer open. Updates to papers already cloud-resident still sync.
 *
 * Only called from addToLibrary — never from updateLibraryRow (D-12).
 */
async function enqueueLibraryRowSync(row: LibraryRow, paper: Paper, pages: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;  // BYOK-only / logged-out: skip cloud sync

  const paperKeyVal = row.id ?? row.urlHash;
  if (await shouldSkipFreeCap(paperKeyVal)) {
    await removeItem('libraryCapBannerDismissed');
    return;
  }

  await enqueue({
    table: 'papers',
    op: 'upsert',
    row: {
      user_id: user.id,
      paper_key: paperKeyVal,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue ?? null,
      pages,
      role: row.role || null,
      library_id: row.libraryId,
      topic_ids: row.topicIds,
      judgment: row.judgment || null,
      added_at: new Date(row.addedAt).toISOString(),
      last_read: new Date(row.lastRead).toISOString(),
    },
    ts: Date.now(),
  });
}

/**
 * Free-tier cap gate. Returns true when the cloud upsert should be skipped:
 * Free user, cloud already at/over cap, paper not already cloud-resident.
 * For paid tiers and update-paths this is a no-op.
 */
async function shouldSkipFreeCap(paperKeyVal: string): Promise<boolean> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier')
    .maybeSingle();
  if (sub?.tier !== 'free') return false;

  // fail-open: network error / RLS fault returns count=null → 0 < cap → skip gate doesn't fire.
  // Intentional: transient failures must not block local rows entering sync-queue (D-08 best-effort).
  const { count } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true });
  if ((count ?? 0) < FREE_LIBRARY_CAP) return false;

  // Already-cloud-resident papers can keep updating (last_read, role, etc.).
  const { data: existing } = await supabase
    .from('papers')
    .select('paper_key')
    .eq('paper_key', paperKeyVal)
    .maybeSingle();
  return !existing;
}
