// chrome-extension/reader/lib/library-catalog.ts
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../types';
import { getItem, setItem } from './storage-schema';
import type { PendingDelete } from './storage-schema';
import { withKeyLock } from './storage';
import { getLibrary } from './library';
import { enqueue } from './sync-queue';
// upsertLibraryEntry — imported and used in Task 1.6.

const NAME_MAX = 64;

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  if (trimmed.length > NAME_MAX) throw new Error(`Name must be ≤${NAME_MAX} chars`);
  return trimmed;
}

function caseInsensitiveCollision(existing: { name: string }[], candidate: string): boolean {
  const c = candidate.toLowerCase();
  return existing.some(e => e.name.toLowerCase() === c);
}

export async function getLibraries(): Promise<LibraryCatalogEntry[]> {
  return (await getItem('pf:libraries')) ?? [];
}

export async function getTopics(): Promise<TopicCatalogEntry[]> {
  return (await getItem('pf:topics')) ?? [];
}

export async function createLibrary(name: string): Promise<LibraryCatalogEntry> {
  const normalized = normalizeName(name);
  return withKeyLock('pf:lock:lib-catalog', async () => {
    const existing = await getLibraries();
    if (caseInsensitiveCollision(existing, normalized)) {
      throw new Error('Already exists');
    }
    const entry: LibraryCatalogEntry = {
      id: crypto.randomUUID(),
      name: normalized,
      createdAt: Date.now(),
    };
    await setItem('pf:libraries', [...existing, entry]);
    return entry;
  });
}

export async function renameLibrary(id: string, newName: string): Promise<LibraryCatalogEntry> {
  const normalized = normalizeName(newName);
  return withKeyLock('pf:lock:lib-catalog', async () => {
    const list = await getLibraries();
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Library not found');
    if (list[idx].name === normalized) return list[idx];  // silent no-op
    if (caseInsensitiveCollision(list.filter((_, i) => i !== idx), normalized)) {
      throw new Error('Already exists');
    }
    const next = [...list];
    next[idx] = { ...list[idx], name: normalized };
    await setItem('pf:libraries', next);
    return next[idx];
  });
}

export async function createTopic(name: string): Promise<TopicCatalogEntry> {
  const normalized = normalizeName(name);
  return withKeyLock('pf:lock:topic-catalog', async () => {
    const existing = await getTopics();
    if (caseInsensitiveCollision(existing, normalized)) {
      throw new Error('Already exists');
    }
    const entry: TopicCatalogEntry = {
      id: crypto.randomUUID(),
      name: normalized,
      createdAt: Date.now(),
    };
    await setItem('pf:topics', [...existing, entry]);
    return entry;
  });
}

export async function renameTopic(id: string, newName: string): Promise<TopicCatalogEntry> {
  const normalized = normalizeName(newName);
  return withKeyLock('pf:lock:topic-catalog', async () => {
    const list = await getTopics();
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Topic not found');
    if (list[idx].name === normalized) return list[idx];
    if (caseInsensitiveCollision(list.filter((_, i) => i !== idx), normalized)) {
      throw new Error('Already exists');
    }
    const next = [...list];
    next[idx] = { ...list[idx], name: normalized };
    await setItem('pf:topics', next);
    return next[idx];
  });
}

const UNDO_WINDOW_MS = 5000;

export async function getPendingDeletes(): Promise<PendingDelete[]> {
  return (await getItem('pf:lib:pendingDeletes')) ?? [];
}

async function pushPending(entry: PendingDelete): Promise<void> {
  return withKeyLock('pf:lock:lib-catalog', async () => {
    const list = await getPendingDeletes();
    await setItem('pf:lib:pendingDeletes', [...list, entry]);
  });
}

export async function scheduleDeleteLibrary(id: string): Promise<void> {
  const libs = await getLibraries();
  const entry = libs.find(l => l.id === id);
  if (!entry) return;  // idempotent
  const rows = await getLibrary();
  const affectedRows = rows
    .filter(r => r.libraryId === id)
    .map(r => ({ id: r.id ?? r.urlHash, prev: { libraryId: id } }));

  // Persist pending entry FIRST so we don't lose it if subsequent writes fail.
  const pending: PendingDelete = {
    id: crypto.randomUUID(),
    kind: 'library',
    deletedEntry: entry,
    affectedRows,
    commitAt: Date.now() + UNDO_WINDOW_MS,
    ts: Date.now(),
  };
  await pushPending(pending);

  // Remove from catalog
  await withKeyLock('pf:lock:lib-catalog', async () => {
    const list = await getLibraries();
    await setItem('pf:libraries', list.filter(l => l.id !== id));
  });

  // Null out paper rows
  await withKeyLock('library:lock', async () => {
    const all = await getLibrary();
    const next = all.map(r => r.libraryId === id ? { ...r, libraryId: null } : r);
    await chrome.storage.local.set({ library: next });
  });
}

export async function scheduleDeleteTopic(id: string): Promise<void> {
  const topics = await getTopics();
  const entry = topics.find(t => t.id === id);
  if (!entry) return;
  const rows = await getLibrary();
  const affectedRows = rows
    .filter(r => r.topicIds.includes(id))
    .map(r => ({ id: r.id ?? r.urlHash, prev: { topicIds: [...r.topicIds] } }));

  const pending: PendingDelete = {
    id: crypto.randomUUID(),
    kind: 'topic',
    deletedEntry: entry,
    affectedRows,
    commitAt: Date.now() + UNDO_WINDOW_MS,
    ts: Date.now(),
  };
  await pushPending(pending);

  await withKeyLock('pf:lock:topic-catalog', async () => {
    const list = await getTopics();
    await setItem('pf:topics', list.filter(t => t.id !== id));
  });

  await withKeyLock('library:lock', async () => {
    const all = await getLibrary();
    const next = all.map(r => r.topicIds.includes(id) ? { ...r, topicIds: r.topicIds.filter(x => x !== id) } : r);
    await chrome.storage.local.set({ library: next });
  });
}

/**
 * Walk all rows; clear libraryId references that don't match a live catalog
 * entry, and filter topicIds to existing topics. Idempotent. Returns true
 * if anything changed (so caller can write back).
 */
export async function sanitizeLibraryRows(): Promise<boolean> {
  const [libs, topics, rows] = await Promise.all([
    getLibraries(),
    getTopics(),
    getLibrary(),
  ]);
  const libIds = new Set(libs.map(l => l.id));
  const topicIds = new Set(topics.map(t => t.id));
  let mutated = false;
  const next: LibraryRow[] = rows.map(r => {
    let changed = false;
    let libraryId = r.libraryId;
    let nextTopicIds = r.topicIds;
    if (libraryId !== null && !libIds.has(libraryId)) {
      libraryId = null;
      changed = true;
    }
    const filtered = r.topicIds.filter(id => topicIds.has(id));
    if (filtered.length !== r.topicIds.length) {
      nextTopicIds = filtered;
      changed = true;
    }
    if (changed) {
      mutated = true;
      return { ...r, libraryId, topicIds: nextTopicIds };
    }
    return r;
  });
  if (mutated) {
    await chrome.storage.local.set({ library: next });
  }
  return mutated;
}

/**
 * One-time migration. Idempotent — gated by `pf:libraryV2Migrated` flag.
 * - Legacy `topic: string` rows → write topic into topics catalog, set topicIds.
 * - Rows missing libraryId/topicIds → initialize null/[].
 */
export async function runLibraryV2Migration(): Promise<void> {
  const flag = await getItem('pf:libraryV2Migrated');
  if (flag === true) return;

  const rawLib = (await chrome.storage.local.get('library')).library as Array<LibraryRow & { topic?: string }> | undefined;
  const rows = Array.isArray(rawLib) ? rawLib : [];

  // Collect legacy topics, case-insensitive dedup
  const topicNameToId = new Map<string, string>();
  const newTopics: TopicCatalogEntry[] = [];
  for (const r of rows) {
    const legacy = r.topic?.trim();
    if (!legacy) continue;
    const key = legacy.toLowerCase();
    if (!topicNameToId.has(key)) {
      const id = crypto.randomUUID();
      topicNameToId.set(key, id);
      newTopics.push({ id, name: legacy, createdAt: Date.now() });
    }
  }
  if (newTopics.length > 0) {
    const existing = await getTopics();
    await setItem('pf:topics', [...existing, ...newTopics]);
  }

  // Rewrite rows
  const next: LibraryRow[] = rows.map(r => {
    const legacy = r.topic?.trim();
    const topicIds: string[] = legacy ? [topicNameToId.get(legacy.toLowerCase())!] : (r.topicIds ?? []);
    const libraryId = r.libraryId ?? null;
    const { topic: _drop, ...rest } = r as any;
    return { ...rest, libraryId, topicIds };
  });
  await chrome.storage.local.set({ library: next });
  await setItem('pf:libraryV2Migrated', true);
}

export async function undoPendingDelete(pendingId: string): Promise<void> {
  const list = await getPendingDeletes();
  const entry = list.find(e => e.id === pendingId);
  if (!entry) return;

  // Remove from pending queue (cancels the commit)
  await withKeyLock('pf:lock:lib-catalog', async () => {
    const next = (await getPendingDeletes()).filter(e => e.id !== pendingId);
    await setItem('pf:lib:pendingDeletes', next);
  });

  // Restore catalog entry with its ORIGINAL id
  if (entry.kind === 'library') {
    await withKeyLock('pf:lock:lib-catalog', async () => {
      const cat = await getLibraries();
      await setItem('pf:libraries', [...cat, entry.deletedEntry]);
    });
    await withKeyLock('library:lock', async () => {
      const rows = await getLibrary();
      const affectedSet = new Set(entry.affectedRows.map(a => a.id));
      const next = rows.map(r => {
        const key = r.id ?? r.urlHash;
        if (affectedSet.has(key)) return { ...r, libraryId: entry.deletedEntry.id };
        return r;
      });
      await chrome.storage.local.set({ library: next });
    });
  } else {
    await withKeyLock('pf:lock:topic-catalog', async () => {
      const cat = await getTopics();
      await setItem('pf:topics', [...cat, entry.deletedEntry]);
    });
    await withKeyLock('library:lock', async () => {
      const rows = await getLibrary();
      const prevByRow = new Map(entry.affectedRows.map(a => [a.id, (a.prev as { topicIds?: string[] }).topicIds ?? []]));
      const next = rows.map(r => {
        const prev = prevByRow.get(r.id ?? r.urlHash);
        return prev ? { ...r, topicIds: prev } : r;
      });
      await chrome.storage.local.set({ library: next });
    });
  }
}

export async function commitElapsedPendingDeletes(): Promise<void> {
  const now = Date.now();
  const list = await getPendingDeletes();
  const elapsed = list.filter(e => now >= e.commitAt);
  if (elapsed.length === 0) return;

  for (const entry of elapsed) {
    const fn = entry.kind === 'library' ? 'delete-library' : 'delete-topic';
    await enqueue({ kind: 'rpc', fn, args: { id: entry.deletedEntry.id }, ts: Date.now() });
  }
  await withKeyLock('pf:lock:lib-catalog', async () => {
    const fresh = await getPendingDeletes();
    const elapsedIds = new Set(elapsed.map(e => e.id));
    await setItem('pf:lib:pendingDeletes', fresh.filter(e => !elapsedIds.has(e.id)));
  });
}
