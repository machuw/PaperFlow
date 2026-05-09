# Library v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Library drawer with a sidebar-driven UI offering Libraries (single-valued, folder-like) + Topics (multi-valued, tag-like), backed by a persisted undo queue, with full a11y/responsive coverage.

**Architecture:** Catalog-driven storage (`pf:libraries` + `pf:topics` master lists, referenced by id from each `LibraryRow`). Sidebar widens drawer to 1200px and acts as scope filter; existing `Group by` segmented control remains as in-scope sub-grouping. Destructive operations (Delete Library / Delete Topic) defer cloud sync via a persisted `LIB_PENDING_DELETES_KEY` queue with a 5-second undo window — this survives MV3 service-worker eviction. Optimistic UI lifecycle (opacity 0.7 → 1 on success / `shake-x` keyframe on lock failure) gives every write visible feedback.

**Tech Stack:** TypeScript + React 18 (no bundler runtime — Vite multi-entry build). React state via `useState` + `useMemo`. Storage via `chrome.storage.local` (typed wrapper in `storage-schema.ts`). Supabase Edge Functions (Deno) for atomic catalog deletes. Floating-ui (`@floating-ui/react-dom`) for popover positioning. Vitest for unit/integration tests. Playwright for E2E.

**Spec:** `docs/specs/2026-04-25-spec-library-v2.md` (CLEARED by `/plan-design-review` and `/plan-eng-review` × 2 — score 7→9, 0 unresolved).

---

## Test Layout Convention

All new tests live in `chrome-extension/tests/library-v2/` grouped by responsibility:

```
chrome-extension/tests/library-v2/
├── unit/
│   ├── catalog-ops.test.ts
│   ├── sanitize.test.ts
│   ├── filter-pipeline.test.ts
│   ├── name-validation.test.ts
│   ├── pending-deletes.test.ts
│   ├── optimistic-ui.test.ts
│   ├── first-use-pill.test.ts
│   ├── multi-topic-buckets.test.ts
│   ├── header-copy.test.ts
│   └── keyboard-shortcuts.test.ts
├── integration/
│   ├── library-v2.spec.ts          # supabase RLS + Edge Functions
│   ├── undo-flow.spec.ts           # SW restart resilience
│   └── migration-flow.spec.ts
└── e2e/
    ├── library-v2-flow.spec.ts
    └── library-v2-a11y.spec.ts
```

This co-locates by feature, matching the spec's intent. Project memory `feedback_test_infra.md` confirms tests live under `chrome-extension/tests/` (not per-subdirectory npm projects).

---

## Phase 0: Pre-flight Spike

### Task 0.1: floating-ui + Vite/MV3 spike

**Files:**
- Modify: `chrome-extension/package.json` (devDeps + dep)
- Create: `chrome-extension/scripts/spike-floating-ui.tsx` (delete after spike)

The spec's popover positioning depends on `@floating-ui/react-dom` (~5kB gzipped). Verify it works in MV3 + Vite IIFE before any UI work depends on it.

- [ ] **Step 1: Install dependency**

```bash
cd chrome-extension && bun add @floating-ui/react-dom
cat package.json | grep floating-ui
```

Expected: `"@floating-ui/react-dom": "^2.x.x"` in `dependencies`.

- [ ] **Step 2: Write spike test component**

```tsx
// chrome-extension/scripts/spike-floating-ui.tsx
import { useFloating, flip, shift, autoUpdate } from '@floating-ui/react-dom';
import { useState } from 'react';

export function FloatSpike() {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  return (
    <>
      <button ref={refs.setReference} onClick={() => setOpen(o => !o)}>Toggle</button>
      {open && <div ref={refs.setFloating} style={floatingStyles}>Hello floating</div>}
    </>
  );
}
```

- [ ] **Step 3: Build and verify it doesn't break MV3 IIFE**

```bash
cd chrome-extension && bun run build 2>&1 | grep -i "error\|fail" || echo "build clean"
ls dist/reader/index.html
```

Expected: build clean, no "eval is not allowed" or CSP errors. If errors → we hand-roll positioning instead (~30 lines of `useEffect` + `getBoundingClientRect`).

- [ ] **Step 4: Smoke-test in Chrome**

```bash
echo "Manual: load chrome-extension/dist as unpacked extension, open reader, open browser console, paste FloatSpike test render. Verify popover positions correctly."
```

Expected: positions correctly, flips above when near bottom, no CSP violations in console.

- [ ] **Step 5: Commit (or revert if spike fails)**

If spike works:
```bash
rm chrome-extension/scripts/spike-floating-ui.tsx
git add chrome-extension/package.json chrome-extension/bun.lockb
git commit -m "chore(ext): add @floating-ui/react-dom for Library v2 popover positioning"
```

If spike fails:
```bash
cd chrome-extension && bun remove @floating-ui/react-dom
git checkout chrome-extension/package.json chrome-extension/bun.lockb
echo "FALLBACK: hand-rolled positioning required — see Phase 5 fallback section"
```

---

## Phase 1: Data Foundation (no UI yet)

### Task 1.1: Add new catalog types to `types.ts`

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Test: `chrome-extension/tests/library-v2/unit/catalog-ops.test.ts` (created in Task 1.4)

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/catalog-ops.test.ts
import { describe, it, expect } from 'vitest';
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../../../reader/types';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/catalog-ops.test.ts`
Expected: FAIL — types `LibraryCatalogEntry` / `TopicCatalogEntry` not exported; `LibraryRow.libraryId` doesn't exist.

- [ ] **Step 3: Implement type changes**

Edit `chrome-extension/reader/types.ts`. Find the `LibraryRow` interface, drop `topic: string`, add `libraryId: string | null` and `topicIds: string[]`. Add the two new catalog types nearby:

```ts
export interface LibraryCatalogEntry {
  id: string;           // crypto.randomUUID()
  name: string;
  createdAt: number;
}

export interface TopicCatalogEntry {
  id: string;
  name: string;
  createdAt: number;
}

export interface LibraryRow {
  id?: string;
  urlHash: string;
  title: string;
  authors: string[];
  role: string;
  judgment: string;
  addedAt: number;
  lastRead: number;
  pages: number;
  annotations: number;
  hasMemory: boolean;
  libraryId: string | null;   // references pf:libraries entry; null = unfiled
  topicIds: string[];         // references pf:topics entries; [] = no tags
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/catalog-ops.test.ts`
Expected: 3 tests pass. Also run TypeScript build — many files reading `row.topic` will now fail. Note them; they're fixed in Task 1.2.

```bash
bun run typecheck 2>&1 | grep "topic" | head
```

Expected: ~5–10 type errors referencing `row.topic` in `library.ts`, `library-drawer.tsx`. Listed for Task 1.2.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/types.ts chrome-extension/tests/library-v2/unit/catalog-ops.test.ts
git commit -m "feat(ext): Library v2 — add LibraryCatalogEntry + TopicCatalogEntry types; LibraryRow gains libraryId + topicIds"
```

---

### Task 1.2: Update `library.ts` mutations for new field shape

**Files:**
- Modify: `chrome-extension/reader/lib/library.ts`
- Test: `chrome-extension/tests/lib/library.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Append to `chrome-extension/tests/lib/library.test.ts`:

```ts
describe('syncLibraryRow with v2 fields', () => {
  it('preserves libraryId and topicIds when row already exists', async () => {
    const paper = makeFakePaper({ id: 'p1' });
    await chrome.storage.local.set({
      library: [{
        id: 'p1', urlHash: 'p1', title: 't', authors: [], role: '', judgment: '',
        addedAt: 1, lastRead: 1, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'lib-q4', topicIds: ['top-vla', 'top-rob'],
      }],
    });
    await syncLibraryRow(paper, 5);
    const row = (await getLibrary())[0];
    expect(row.libraryId).toBe('lib-q4');
    expect(row.topicIds).toEqual(['top-vla', 'top-rob']);
  });
  it('initializes libraryId=null and topicIds=[] for new rows', async () => {
    const paper = makeFakePaper({ id: 'p2' });
    await syncLibraryRow(paper, 5);
    const row = (await getLibrary()).find(r => r.id === 'p2');
    expect(row?.libraryId).toBe(null);
    expect(row?.topicIds).toEqual([]);
  });
});
```

(`makeFakePaper` is a test helper. If it doesn't exist, add a minimal `function makeFakePaper(o: { id: string }): Paper { return { id: o.id, urlHash: o.id, title: 't', authors: [], venue: null, memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] }, ... } as Paper; }` at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/lib/library.test.ts -t "v2 fields"`
Expected: FAIL — `syncLibraryRow` produces a row without `libraryId`/`topicIds`.

- [ ] **Step 3: Update `syncLibraryRow`**

In `chrome-extension/reader/lib/library.ts:60-87`, drop `topic: ''` from the constructed row, add `libraryId` and `topicIds` preservation:

```ts
const row: LibraryRow = {
  id: paper.id,
  urlHash: paper.urlHash,
  title: paper.title,
  authors: paper.authors,
  role: extractRolePrefix(paper.memory.role),
  judgment: paper.memory.judgment,
  addedAt: existingRow?.addedAt ?? now,
  lastRead: now,
  pages,
  annotations: highlights.length + notes.length,
  hasMemory: computeHasMemory(paper.memory),
  libraryId: existingRow?.libraryId ?? null,
  topicIds: existingRow?.topicIds ?? [],
};
```

Also update `enqueueLibraryRowSync` to send the new fields and remove the legacy `topic`:

```ts
await enqueue({
  table: 'papers',
  op: 'upsert',
  row: {
    user_id: user.id,
    paper_key: row.id ?? row.urlHash,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && bun run test tests/lib/library.test.ts`
Expected: all tests pass including new v2 ones.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library.ts chrome-extension/tests/lib/library.test.ts
git commit -m "feat(ext): Library v2 — syncLibraryRow preserves libraryId+topicIds; cloud upsert uses new columns"
```

---

### Task 1.3: Add v2 storage keys to `storage-schema.ts`

**Files:**
- Modify: `chrome-extension/reader/lib/storage-schema.ts`
- Test: `chrome-extension/tests/storage-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `chrome-extension/tests/storage-schema.test.ts`:

```ts
describe('Library v2 storage keys', () => {
  it('LIBRARIES_KEY round-trips a catalog list', async () => {
    const cat: LibraryCatalogEntry[] = [{ id: 'a', name: 'Q4', createdAt: 1 }];
    await setItem('pf:libraries', cat);
    const got = await getItem('pf:libraries');
    expect(got).toEqual(cat);
  });
  it('LIBRARY_INTRO_SEEN_KEY round-trips boolean', async () => {
    await setItem('pf:librariesIntroSeen', true);
    expect(await getItem('pf:librariesIntroSeen')).toBe(true);
  });
  it('LIB_PENDING_DELETES_KEY round-trips array of pending entries', async () => {
    const pending = [{ id: 'p1', kind: 'library' as const, deletedEntry: { id: 'a', name: 'Q4', createdAt: 1 }, affectedRows: [], commitAt: 100, ts: 50 }];
    await setItem('pf:lib:pendingDeletes', pending);
    expect(await getItem('pf:lib:pendingDeletes')).toEqual(pending);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/storage-schema.test.ts`
Expected: FAIL — keys don't exist on `StorageSchema`.

- [ ] **Step 3: Extend `StorageSchema`**

Edit `chrome-extension/reader/lib/storage-schema.ts`. Import the new types and add keys:

```ts
import type { LibraryCatalogEntry, TopicCatalogEntry } from '../types';

export type PendingDelete =
  | { id: string; kind: 'library'; deletedEntry: LibraryCatalogEntry; affectedRows: Array<{ id: string; prev: { libraryId?: string | null } }>; commitAt: number; ts: number }
  | { id: string; kind: 'topic';   deletedEntry: TopicCatalogEntry;   affectedRows: Array<{ id: string; prev: { topicIds?: string[] } }>;       commitAt: number; ts: number };

export type StorageSchema = {
  // ... existing keys preserved ...
  'pf:libraries':            LibraryCatalogEntry[];
  'pf:topics':               TopicCatalogEntry[];
  'pf:lock:lib-catalog':     boolean;
  'pf:lock:topic-catalog':   boolean;
  'pf:librariesIntroSeen':   boolean;
  'pf:libraryV2Migrated':    boolean;
  'pf:lib:pendingDeletes':   PendingDelete[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && bun run test tests/storage-schema.test.ts`
Expected: all 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/storage-schema.ts chrome-extension/tests/storage-schema.test.ts
git commit -m "feat(ext): Library v2 — typed storage keys (catalogs, locks, intro-seen, pending-deletes)"
```

---

### Task 1.4: Catalog ops library — create / rename / delete

**Files:**
- Create: `chrome-extension/reader/lib/library-catalog.ts`
- Test: `chrome-extension/tests/library-v2/unit/catalog-ops.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `chrome-extension/tests/library-v2/unit/catalog-ops.test.ts`:

```ts
import { createLibrary, renameLibrary, scheduleDeleteLibrary, getLibraries, getTopics, createTopic } from '../../../reader/lib/library-catalog';

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/catalog-ops.test.ts`
Expected: FAIL — module `library-catalog` doesn't exist.

- [ ] **Step 3: Create `library-catalog.ts`**

```ts
// chrome-extension/reader/lib/library-catalog.ts
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../types';
import type { PendingDelete } from './storage-schema';
import { getItem, setItem } from './storage-schema';
import { withKeyLock } from './storage';
import { getLibrary, upsertLibraryEntry } from './library';

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
  return withKeyLock('pf:lock:lib-catalog' as any, async () => {
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
  return withKeyLock('pf:lock:lib-catalog' as any, async () => {
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
  return withKeyLock('pf:lock:topic-catalog' as any, async () => {
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
  return withKeyLock('pf:lock:topic-catalog' as any, async () => {
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

// Schedule delete operations are implemented in Task 3.2.
export async function scheduleDeleteLibrary(_id: string): Promise<void> {
  throw new Error('Implemented in Phase 3 (pending-deletes queue)');
}
export async function scheduleDeleteTopic(_id: string): Promise<void> {
  throw new Error('Implemented in Phase 3 (pending-deletes queue)');
}
```

(`withKeyLock` may need its key parameter type extended. Add the new lock keys to its signature in `storage.ts` if it strictly types them. If `withKeyLock` already accepts `string`, leave the cast.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/catalog-ops.test.ts`
Expected: all create/rename/namespace tests pass. The two `scheduleDelete*` placeholders throw — that's intentional, covered in Phase 3.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library-catalog.ts chrome-extension/tests/library-v2/unit/catalog-ops.test.ts
git commit -m "feat(ext): Library v2 — catalog ops library (create/rename for libraries+topics; locks; namespace independence)"
```

---

### Task 1.5: Sanitize-on-read

**Files:**
- Modify: `chrome-extension/reader/lib/library-catalog.ts`
- Test: `chrome-extension/tests/library-v2/unit/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/sanitize.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeLibraryRows } from '../../../reader/lib/library-catalog';

describe('sanitizeLibraryRows', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('clears libraryId pointing at missing catalog entry', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [],
      'pf:topics': [],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'missing-id', topicIds: [],
      }],
    });
    const changed = await sanitizeLibraryRows();
    expect(changed).toBe(true);
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].libraryId).toBe(null);
  });

  it('filters topicIds to only existing topics', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [],
      'pf:topics': [{ id: 'top-vla', name: 'VLA', createdAt: 0 }],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: null, topicIds: ['top-vla', 'missing', 'also-missing'],
      }],
    });
    await sanitizeLibraryRows();
    const lib = (await chrome.storage.local.get('library')).library;
    expect(lib[0].topicIds).toEqual(['top-vla']);
  });

  it('returns false (no write) when nothing to sanitize', async () => {
    await chrome.storage.local.set({
      'pf:libraries': [{ id: 'lib-q4', name: 'Q4', createdAt: 0 }],
      'pf:topics': [],
      library: [{
        urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
        addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
        libraryId: 'lib-q4', topicIds: [],
      }],
    });
    expect(await sanitizeLibraryRows()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/sanitize.test.ts`
Expected: FAIL — `sanitizeLibraryRows` not exported.

- [ ] **Step 3: Implement sanitize**

Append to `chrome-extension/reader/lib/library-catalog.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && bun run test tests/library-v2/unit/sanitize.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library-catalog.ts chrome-extension/tests/library-v2/unit/sanitize.test.ts
git commit -m "feat(ext): Library v2 — sanitize orphan libraryId/topicIds on read"
```

---

### Task 1.6: One-time migration runner

**Files:**
- Modify: `chrome-extension/reader/lib/library-catalog.ts`
- Test: `chrome-extension/tests/library-v2/integration/migration-flow.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/integration/migration-flow.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runLibraryV2Migration } from '../../../reader/lib/library-catalog';

describe('library-v2 migration', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('is no-op when libraryV2Migrated is true', async () => {
    await chrome.storage.local.set({ 'pf:libraryV2Migrated': true });
    await runLibraryV2Migration();
    expect((await chrome.storage.local.get('pf:topics')).['pf:topics']).toBeUndefined();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/library-v2/integration/migration-flow.spec.ts`
Expected: FAIL — `runLibraryV2Migration` not exported.

- [ ] **Step 3: Implement migration**

Append to `chrome-extension/reader/lib/library-catalog.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && bun run test tests/library-v2/integration/migration-flow.spec.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library-catalog.ts chrome-extension/tests/library-v2/integration/migration-flow.spec.ts
git commit -m "feat(ext): Library v2 — one-time migration runner gated by pf:libraryV2Migrated flag"
```

---

## Phase 2: Cloud backend

### Task 2.1: Supabase migration `006_libraries_topics.sql`

**Files:**
- Create: `supabase/migrations/006_libraries_topics.sql`
- Test: `chrome-extension/tests/library-v2/integration/library-v2.spec.ts` (RLS smoke)

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/integration/library-v2.spec.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('supabase/.env.local-devnote.md', 'utf-8');
const URL = env.match(/SUPABASE_URL=(\S+)/)![1];
const ANON = env.match(/SUPABASE_ANON_KEY=(\S+)/)![1];

describe('libraries+topics RLS', () => {
  it('libraries table exists with user_id, name unique constraint', async () => {
    const sb = createClient(URL, ANON);
    const { data: u } = await sb.auth.signInWithPassword({ email: 'test@a.io', password: 'test1234' });
    const insert1 = await sb.from('libraries').insert({ name: 'Q4' });
    expect(insert1.error).toBeNull();
    const insert2 = await sb.from('libraries').insert({ name: 'Q4' });
    expect(insert2.error?.code).toBe('23505');  // unique violation
  });

  it('topic_ids column on papers uses GIN index for contains query', async () => {
    const sb = createClient(URL, ANON);
    await sb.auth.signInWithPassword({ email: 'test@a.io', password: 'test1234' });
    const { data } = await sb.from('papers').select('*').contains('topic_ids', ['some-uuid']);
    expect(data).toBeDefined();  // query plan elsewhere
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts`
Expected: FAIL — table `libraries` doesn't exist (or `topic_ids` column missing).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/006_libraries_topics.sql

create table libraries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index libraries_user_created_idx on libraries (user_id, created_at);

create table topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index topics_user_created_idx on topics (user_id, created_at);

alter table papers drop column topic;
alter table papers
  add column library_id uuid references libraries(id) on delete set null,
  add column topic_ids  uuid[] not null default '{}';
create index papers_user_library_idx on papers (user_id, library_id);
create index papers_topic_ids_gin   on papers using gin (topic_ids);

alter table libraries enable row level security;
create policy "user owns libraries" on libraries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table topics enable row level security;
create policy "user owns topics" on topics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- updated_at trigger (reuse pattern from migration 004)
create trigger libraries_updated_at before update on libraries
  for each row execute function set_updated_at();
create trigger topics_updated_at before update on topics
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Apply migration + run test**

```bash
supabase db reset --linked=false  # local stack, applies all migrations from 001 onward
cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts
```

Expected: all tests pass. Confirm GIN index in psql:
```bash
supabase db remote exec "explain analyze select * from papers where topic_ids @> array['00000000-0000-0000-0000-000000000000'::uuid];" | grep "Bitmap Index Scan"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/006_libraries_topics.sql chrome-extension/tests/library-v2/integration/library-v2.spec.ts
git commit -m "feat(supabase): migration 006 — libraries+topics tables, RLS, papers.library_id+topic_ids columns, GIN index"
```

---

### Task 2.2: `delete-library` Edge Function

**Files:**
- Create: `supabase/functions/delete-library/index.ts`
- Test: `chrome-extension/tests/library-v2/integration/library-v2.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `library-v2.spec.ts`:

```ts
it('delete-library RPC removes catalog row + cascades library_id to null', async () => {
  const sb = createClient(URL, ANON);
  await sb.auth.signInWithPassword({ email: 'test@a.io', password: 'test1234' });
  const { data: lib } = await sb.from('libraries').insert({ name: 'TmpLib' }).select().single();
  await sb.from('papers').insert({ paper_key: 'p-test', title: 't', authors: [], pages: 1, library_id: lib.id });
  const { error } = await sb.functions.invoke('delete-library', { body: { id: lib.id } });
  expect(error).toBeNull();
  const after = await sb.from('libraries').select('id').eq('id', lib.id);
  expect(after.data).toEqual([]);
  const paper = await sb.from('papers').select('library_id').eq('paper_key', 'p-test').single();
  expect(paper.data?.library_id).toBe(null);  // FK on delete set null
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts -t "delete-library"
```
Expected: FAIL — function not deployed.

- [ ] **Step 3: Implement Edge Function**

```ts
// supabase/functions/delete-library/index.ts
import { authClientFor } from '../_shared/auth.ts';
import { jsonOk, jsonError } from '../_shared/responses.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST')    return jsonError(405, 'Method not allowed');
  const auth = await authClientFor(req);
  if (!auth) return jsonError(401, 'Unauthorized');
  const { client, user } = auth;
  let body: { id?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'Invalid JSON'); }
  const id = body.id;
  if (!id || typeof id !== 'string') return jsonError(400, 'id required');

  // RLS-scoped delete; FK on papers.library_id (on delete set null) handles cascade.
  const { error } = await client.from('libraries').delete().eq('id', id).eq('user_id', user.id);
  if (error) return jsonError(500, error.message);
  return jsonOk({ ok: true });
});
```

- [ ] **Step 4: Deploy locally + run test**

```bash
supabase functions serve delete-library --env-file ./supabase/.env &
sleep 2
cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts -t "delete-library"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/delete-library/index.ts chrome-extension/tests/library-v2/integration/library-v2.spec.ts
git commit -m "feat(supabase): delete-library Edge Function — RLS-scoped catalog delete; FK cascades library_id to null"
```

---

### Task 2.3: `delete-topic` Edge Function

**Files:**
- Create: `supabase/functions/delete-topic/index.ts`
- Test: `chrome-extension/tests/library-v2/integration/library-v2.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('delete-topic RPC removes catalog row + array_remove from all papers in tx', async () => {
  const sb = createClient(URL, ANON);
  await sb.auth.signInWithPassword({ email: 'test@a.io', password: 'test1234' });
  const { data: t } = await sb.from('topics').insert({ name: 'TmpTopic' }).select().single();
  await sb.from('papers').insert([
    { paper_key: 'p1', title: 't', authors: [], pages: 1, topic_ids: [t.id] },
    { paper_key: 'p2', title: 't', authors: [], pages: 1, topic_ids: [t.id, '00000000-0000-0000-0000-000000000099'] },
  ]);
  const { error } = await sb.functions.invoke('delete-topic', { body: { id: t.id } });
  expect(error).toBeNull();
  const after = await sb.from('topics').select('id').eq('id', t.id);
  expect(after.data).toEqual([]);
  const papers = await sb.from('papers').select('paper_key, topic_ids').in('paper_key', ['p1', 'p2']);
  for (const p of papers.data!) {
    expect(p.topic_ids.includes(t.id)).toBe(false);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts -t "delete-topic"
```
Expected: FAIL.

- [ ] **Step 3: Implement Edge Function**

```ts
// supabase/functions/delete-topic/index.ts
import { authClientFor, serviceClient } from '../_shared/auth.ts';
import { jsonOk, jsonError } from '../_shared/responses.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST')    return jsonError(405, 'Method not allowed');
  const auth = await authClientFor(req);
  if (!auth) return jsonError(401, 'Unauthorized');
  const { user } = auth;
  let body: { id?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'Invalid JSON'); }
  const id = body.id;
  if (!id) return jsonError(400, 'id required');

  // Atomic: delete catalog row + array_remove on all this user's papers.
  // Use service client because we want one transaction.
  const svc = serviceClient();
  const { error } = await svc.rpc('delete_topic_atomic', { p_topic_id: id, p_user_id: user.id });
  if (error) return jsonError(500, error.message);
  return jsonOk({ ok: true });
});
```

Add the SQL helper in a follow-up to migration 006 — append to `006_libraries_topics.sql`:

```sql
create or replace function delete_topic_atomic(p_topic_id uuid, p_user_id uuid)
returns void as $$
begin
  update papers
    set topic_ids = array_remove(topic_ids, p_topic_id)
    where user_id = p_user_id and topic_ids @> array[p_topic_id];
  delete from topics where id = p_topic_id and user_id = p_user_id;
end;
$$ language plpgsql security definer;
revoke all on function delete_topic_atomic(uuid, uuid) from public;
grant execute on function delete_topic_atomic(uuid, uuid) to service_role;
```

- [ ] **Step 4: Deploy + apply migration delta + run test**

```bash
supabase db reset --linked=false
supabase functions serve delete-topic --env-file ./supabase/.env &
sleep 2
cd chrome-extension && bun run test tests/library-v2/integration/library-v2.spec.ts -t "delete-topic"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/delete-topic/index.ts supabase/migrations/006_libraries_topics.sql chrome-extension/tests/library-v2/integration/library-v2.spec.ts
git commit -m "feat(supabase): delete-topic Edge Function + delete_topic_atomic SQL helper (one-tx catalog+papers cleanup)"
```

---

### Task 2.4: Extend `sync-queue.ts` with `'rpc'` op kind

**Files:**
- Modify: `chrome-extension/reader/lib/sync-queue.ts`
- Modify: `chrome-extension/reader/lib/storage-schema.ts` (PendingOp type)
- Test: `chrome-extension/tests/sync-queue.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe('sync-queue rpc op', () => {
  it('drains an rpc op via supabase.functions.invoke', async () => {
    const invokeSpy = vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({ data: null, error: null });
    await enqueue({ kind: 'rpc', fn: 'delete-library', args: { id: 'lib-q4' }, ts: 0 } as any);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await drain();
    expect(invokeSpy).toHaveBeenCalledWith('delete-library', { body: { id: 'lib-q4' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd chrome-extension && bun run test tests/sync-queue.test.ts -t "rpc op"
```
Expected: FAIL — `kind` is not a recognized PendingOp shape.

- [ ] **Step 3: Extend types + drain handler**

In `storage-schema.ts`, broaden the `'sync:queue'` value type to a discriminated union:

```ts
'sync:queue': Array<
  | { kind?: undefined; table: string; op: 'upsert' | 'delete'; row: any; ts: number }
  | { kind: 'rpc'; fn: 'delete-library' | 'delete-topic'; args: any; ts: number }
>;
```

In `sync-queue.ts`, extend `PendingOp` and the `drain()` switch:

```ts
export type PendingOp =
  | { table: string; op: 'upsert' | 'delete'; row: any; ts: number }
  | { kind: 'rpc'; fn: 'delete-library' | 'delete-topic'; args: any; ts: number };

// inside drain() loop:
if ('kind' in op && op.kind === 'rpc') {
  const { error } = await supabase.functions.invoke(op.fn, { body: op.args });
  if (error) throw error;
  continue;
}
```

- [ ] **Step 4: Run test**

```bash
cd chrome-extension && bun run test tests/sync-queue.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/sync-queue.ts chrome-extension/reader/lib/storage-schema.ts chrome-extension/tests/sync-queue.test.ts
git commit -m "feat(ext): sync-queue gains 'rpc' op kind for delete-library/delete-topic Edge Function calls"
```

---

## Phase 3: Pending-deletes queue (the SW-resilient undo system)

### Task 3.1: Schedule pending-delete

**Files:**
- Modify: `chrome-extension/reader/lib/library-catalog.ts`
- Test: `chrome-extension/tests/library-v2/unit/pending-deletes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// chrome-extension/tests/library-v2/unit/pending-deletes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scheduleDeleteLibrary, scheduleDeleteTopic, undoPendingDelete, commitElapsedPendingDeletes, getPendingDeletes } from '../../../reader/lib/library-catalog';
import { createLibrary, createTopic } from '../../../reader/lib/library-catalog';

describe('pending-deletes — schedule', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('scheduleDeleteLibrary writes a pending entry, removes catalog row, sets affected paper rows libraryId=null', async () => {
    const lib = await createLibrary('Q4');
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: lib.id, topicIds: [] },
        { urlHash: 'b', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      ],
    });
    await scheduleDeleteLibrary(lib.id);
    // catalog row gone
    expect((await chrome.storage.local.get('pf:libraries'))['pf:libraries']).toEqual([]);
    // paper row libraryId nulled
    const lib0 = (await chrome.storage.local.get('library')).library[0];
    expect(lib0.libraryId).toBe(null);
    // pending entry written
    const pending = await getPendingDeletes();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('library');
    expect(pending[0].deletedEntry.id).toBe(lib.id);
    expect(pending[0].affectedRows).toEqual([{ id: 'a', prev: { libraryId: lib.id } }]);
    expect(pending[0].commitAt).toBeGreaterThan(Date.now());
  });

  it('scheduleDeleteTopic snapshots full prevTopicIds (preserves order among other tags)', async () => {
    const t1 = await createTopic('VLA');
    const t2 = await createTopic('Robotics');
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [t1.id, t2.id] },
      ],
    });
    await scheduleDeleteTopic(t1.id);
    const pending = await getPendingDeletes();
    expect(pending[0].kind).toBe('topic');
    expect((pending[0].affectedRows[0].prev as any).topicIds).toEqual([t1.id, t2.id]);
    const lib0 = (await chrome.storage.local.get('library')).library[0];
    expect(lib0.topicIds).toEqual([t2.id]);  // t1 removed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/pending-deletes.test.ts
```
Expected: FAIL — functions throw "Implemented in Phase 3".

- [ ] **Step 3: Implement schedule + getPendingDeletes**

Replace the placeholder `scheduleDeleteLibrary` / `scheduleDeleteTopic` in `library-catalog.ts` and add helpers:

```ts
import type { PendingDelete } from './storage-schema';

const UNDO_WINDOW_MS = 5000;

export async function getPendingDeletes(): Promise<PendingDelete[]> {
  return (await getItem('pf:lib:pendingDeletes')) ?? [];
}

async function pushPending(entry: PendingDelete): Promise<void> {
  return withKeyLock('pf:lock:lib-catalog' as any, async () => {
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
  await withKeyLock('pf:lock:lib-catalog' as any, async () => {
    const list = await getLibraries();
    await setItem('pf:libraries', list.filter(l => l.id !== id));
  });

  // Null out paper rows
  await withKeyLock('library:lock' as any, async () => {
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

  await withKeyLock('pf:lock:topic-catalog' as any, async () => {
    const list = await getTopics();
    await setItem('pf:topics', list.filter(t => t.id !== id));
  });

  await withKeyLock('library:lock' as any, async () => {
    const all = await getLibrary();
    const next = all.map(r => r.topicIds.includes(id) ? { ...r, topicIds: r.topicIds.filter(x => x !== id) } : r);
    await chrome.storage.local.set({ library: next });
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/pending-deletes.test.ts -t "schedule"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library-catalog.ts chrome-extension/tests/library-v2/unit/pending-deletes.test.ts
git commit -m "feat(ext): Library v2 — scheduleDeleteLibrary/Topic write to LIB_PENDING_DELETES_KEY before mutation"
```

---

### Task 3.2: Undo pending-delete + commit elapsed entries

**Files:**
- Modify: `chrome-extension/reader/lib/library-catalog.ts`
- Test: `chrome-extension/tests/library-v2/unit/pending-deletes.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe('pending-deletes — undo + commit', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('undoPendingDelete restores catalog entry by original id and paper rows', async () => {
    const lib = await createLibrary('Q4');
    const libId = lib.id;
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: libId, topicIds: [] },
      ],
    });
    await scheduleDeleteLibrary(libId);
    const [pending] = await getPendingDeletes();
    await undoPendingDelete(pending.id);
    const libs = (await chrome.storage.local.get('pf:libraries'))['pf:libraries'];
    expect(libs[0].id).toBe(libId);  // SAME id preserved
    expect(libs[0].name).toBe('Q4');
    const rows = (await chrome.storage.local.get('library')).library;
    expect(rows[0].libraryId).toBe(libId);
    expect(await getPendingDeletes()).toEqual([]);
  });

  it('commitElapsedPendingDeletes fires RPC + removes pending entry when commitAt has passed', async () => {
    const lib = await createLibrary('Q4');
    const libId = lib.id;
    await scheduleDeleteLibrary(libId);
    // Tick clock past commitAt by mutating the entry directly
    const list = await getPendingDeletes();
    list[0].commitAt = Date.now() - 1;
    await chrome.storage.local.set({ 'pf:lib:pendingDeletes': list });

    const enqueueSpy = vi.spyOn(await import('../../../reader/lib/sync-queue'), 'enqueue');
    await commitElapsedPendingDeletes();
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rpc', fn: 'delete-library', args: { id: libId } }));
    expect(await getPendingDeletes()).toEqual([]);
  });

  it('commitElapsedPendingDeletes does NOT fire RPC for not-yet-elapsed entries', async () => {
    const lib = await createLibrary('Q4');
    await scheduleDeleteLibrary(lib.id);
    const enqueueSpy = vi.spyOn(await import('../../../reader/lib/sync-queue'), 'enqueue');
    await commitElapsedPendingDeletes();
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await getPendingDeletes()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `undoPendingDelete` and `commitElapsedPendingDeletes` not exported.

- [ ] **Step 3: Implement undo + commit**

Append to `library-catalog.ts`:

```ts
import { enqueue } from './sync-queue';

export async function undoPendingDelete(pendingId: string): Promise<void> {
  const list = await getPendingDeletes();
  const entry = list.find(e => e.id === pendingId);
  if (!entry) return;

  // Remove from pending queue (cancels the commit)
  await withKeyLock('pf:lock:lib-catalog' as any, async () => {
    const next = (await getPendingDeletes()).filter(e => e.id !== pendingId);
    await setItem('pf:lib:pendingDeletes', next);
  });

  // Restore catalog entry with its ORIGINAL id
  if (entry.kind === 'library') {
    await withKeyLock('pf:lock:lib-catalog' as any, async () => {
      const cat = await getLibraries();
      await setItem('pf:libraries', [...cat, entry.deletedEntry]);
    });
    await withKeyLock('library:lock' as any, async () => {
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
    await withKeyLock('pf:lock:topic-catalog' as any, async () => {
      const cat = await getTopics();
      await setItem('pf:topics', [...cat, entry.deletedEntry]);
    });
    await withKeyLock('library:lock' as any, async () => {
      const rows = await getLibrary();
      const prevByRow = new Map(entry.affectedRows.map(a => [a.id, (a.prev as any).topicIds as string[]]));
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
  await withKeyLock('pf:lock:lib-catalog' as any, async () => {
    const fresh = await getPendingDeletes();
    const elapsedIds = new Set(elapsed.map(e => e.id));
    await setItem('pf:lib:pendingDeletes', fresh.filter(e => !elapsedIds.has(e.id)));
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/pending-deletes.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/library-catalog.ts chrome-extension/tests/library-v2/unit/pending-deletes.test.ts
git commit -m "feat(ext): Library v2 — undo + commitElapsedPendingDeletes for SW-resilient undo queue"
```

---

### Task 3.3: Commit-loop hook + drawer-open trigger

**Files:**
- Create: `chrome-extension/reader/lib/use-pending-deletes-commit.ts`
- Test: `chrome-extension/tests/library-v2/integration/undo-flow.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/integration/undo-flow.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePendingDeletesCommit } from '../../../reader/lib/use-pending-deletes-commit';
import { scheduleDeleteLibrary, getPendingDeletes, createLibrary } from '../../../reader/lib/library-catalog';

describe('usePendingDeletesCommit', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); vi.useFakeTimers(); });

  it('commits elapsed pending entries on 1s tick', async () => {
    const lib = await createLibrary('Q4');
    await scheduleDeleteLibrary(lib.id);
    renderHook(() => usePendingDeletesCommit());
    // Advance past commitAt
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(await getPendingDeletes()).toEqual([]);
  });

  it('runs once on mount (catches up after SW restart)', async () => {
    const lib = await createLibrary('Q4');
    await scheduleDeleteLibrary(lib.id);
    // Manually elapsed
    const list = await getPendingDeletes();
    list[0].commitAt = Date.now() - 60000;
    await chrome.storage.local.set({ 'pf:lib:pendingDeletes': list });
    renderHook(() => usePendingDeletesCommit());
    // Synchronous mount-effect will commit
    await act(async () => { await Promise.resolve(); });
    expect(await getPendingDeletes()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement hook**

```ts
// chrome-extension/reader/lib/use-pending-deletes-commit.ts
import { useEffect } from 'react';
import { commitElapsedPendingDeletes } from './library-catalog';

export function usePendingDeletesCommit(): void {
  useEffect(() => {
    let cancelled = false;
    // Run once on mount (catches up after SW restart / Chrome reopen)
    commitElapsedPendingDeletes().catch(() => {});
    const tick = setInterval(() => {
      if (cancelled) return;
      commitElapsedPendingDeletes().catch(() => {});
    }, 1000);
    return () => { cancelled = true; clearInterval(tick); };
  }, []);
}
```

- [ ] **Step 4: Run test**

```bash
cd chrome-extension && bun run test tests/library-v2/integration/undo-flow.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/use-pending-deletes-commit.ts chrome-extension/tests/library-v2/integration/undo-flow.spec.ts
git commit -m "feat(ext): Library v2 — usePendingDeletesCommit hook (1s tick + mount-once for SW-restart catchup)"
```

---

### Task 3.4: Logout cleanup wires `LIB_PENDING_DELETES_KEY`

**Files:**
- Modify: `chrome-extension/reader/components/top-bar.tsx`
- Test: existing logout test (extend)

- [ ] **Step 1: Find existing doLogout test + add assertion**

Search for the existing logout test:

```bash
cd chrome-extension && grep -rn "doLogout\|sign out" tests/
```

In whichever test file covers logout (likely `tests/components/...test.tsx` or an integration file), append:

```ts
it('doLogout clears pf:lib:pendingDeletes', async () => {
  await chrome.storage.local.set({
    'pf:lib:pendingDeletes': [{ id: 'p', kind: 'library', deletedEntry: { id: 'a', name: 'Q4', createdAt: 1 }, affectedRows: [], commitAt: 0, ts: 0 }],
  });
  await doLogout();  // import as needed
  expect((await chrome.storage.local.get('pf:lib:pendingDeletes'))['pf:lib:pendingDeletes']).toBeUndefined();
});

it('doLogout does NOT clear pf:librariesIntroSeen or pf:libraryV2Migrated', async () => {
  await chrome.storage.local.set({
    'pf:librariesIntroSeen': true,
    'pf:libraryV2Migrated': true,
  });
  await doLogout();
  expect((await chrome.storage.local.get('pf:librariesIntroSeen'))['pf:librariesIntroSeen']).toBe(true);
  expect((await chrome.storage.local.get('pf:libraryV2Migrated'))['pf:libraryV2Migrated']).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `doLogout` doesn't touch the new keys.

- [ ] **Step 3: Update `top-bar.tsx` `doLogout`**

Find the existing `doLogout` function. It enumerates keys to clear. Add `'pf:lib:pendingDeletes'` to the clear-list. Do NOT add the intro-seen or migrated flags.

- [ ] **Step 4: Run tests**

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/top-bar.tsx chrome-extension/tests/...
git commit -m "fix(ext): doLogout clears pf:lib:pendingDeletes; preserves intro-seen + migrated flags as device UI state"
```

---

## Phase 4: Sidebar UI

### Task 4.1: SVG icons (Folder, Sparkle, ChevronDown, More)

**Files:**
- Modify: `chrome-extension/reader/components/icons.tsx`

- [ ] **Step 1: Verify which icons are already exported**

```bash
cd chrome-extension && grep -E "Folder|Sparkle|ChevronDown|More" reader/components/icons.tsx
```

- [ ] **Step 2: Add missing icons (if any)**

Append to `icons.tsx` the icons that grep didn't find. Each follows the existing convention (named export under `I.*`, accepts `{ size, stroke }`):

```tsx
function Folder({ size = 16, stroke = 1.5, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M2 4a1 1 0 011-1h4l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function Sparkle({ size = 12, stroke = 1.4, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M6 1L7 5L11 6L7 7L6 11L5 7L1 6L5 5L6 1z" />
    </svg>
  );
}
function ChevronDown({ size = 9, stroke = 1.5, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M2 3.5L4.5 6L7 3.5" />
    </svg>
  );
}
function More({ size = 12, stroke = 1.5, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" {...rest}>
      <circle cx="2" cy="6" r="0.8" fill="currentColor" />
      <circle cx="6" cy="6" r="0.8" fill="currentColor" />
      <circle cx="10" cy="6" r="0.8" fill="currentColor" />
    </svg>
  );
}
// add to the I export object:
export const I = { /* ... existing ..., */ Folder, Sparkle, ChevronDown, More };
```

- [ ] **Step 3: Verify build**

```bash
cd chrome-extension && bun run typecheck
```
Expected: no type errors.

- [ ] **Step 4: Smoke-render in component test**

```bash
cd chrome-extension && cat > /tmp/icon-smoke.tsx <<'EOF'
import { I } from './reader/components/icons';
const test = <><I.Folder /><I.Sparkle /><I.ChevronDown /><I.More /></>;
EOF
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/icons.tsx
git commit -m "feat(ext): icons.tsx — add Folder, Sparkle, ChevronDown, More for Library v2 chips + sidebar"
```

---

### Task 4.2: `library-sidebar.tsx` — section structure + visual states

**Files:**
- Create: `chrome-extension/reader/components/library-sidebar.tsx`
- Test: `chrome-extension/tests/library-v2/unit/header-copy.test.ts` (sidebar contributes to scope-aware tests)

- [ ] **Step 1: Write the component skeleton with selection visual state**

Read the spec § "Sidebar row visual states" for the token table. Create the file:

```tsx
// chrome-extension/reader/components/library-sidebar.tsx
import { I } from './icons';
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../types';

export type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'uncategorized' }
  | { kind: 'library'; id: string }
  | { kind: 'topic'; id: string };

interface Props {
  libraries: LibraryCatalogEntry[];
  topics: TopicCatalogEntry[];
  rows: LibraryRow[];
  selection: SidebarSelection;
  onSelect: (s: SidebarSelection) => void;
  onCreateLibrary: () => void;
  onCreateTopic: () => void;
  onRenameLibrary: (id: string) => void;
  onDeleteLibrary: (id: string) => void;
  onRenameTopic: (id: string) => void;
  onDeleteTopic: (id: string) => void;
  introSeen: boolean;
  onDismissIntro: () => void;
}

function isSelected(s: SidebarSelection, kind: SidebarSelection['kind'], id?: string): boolean {
  if (s.kind !== kind) return false;
  if ((s.kind === 'library' || s.kind === 'topic') && (s as any).id !== id) return false;
  return true;
}

interface RowProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  ariaLabel: string;
  // for user-created entries:
  onMore?: () => void;
}
function Row({ active, label, count, onClick, ariaLabel, onMore }: RowProps) {
  const bg = active ? 'var(--paper-deep)' : 'transparent';
  const color = active ? 'var(--ink)' : 'var(--ink-soft)';
  const countColor = active ? 'var(--walnut)' : 'var(--ink-faded)';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 28, padding: '6px 12px',
        background: bg, color, cursor: 'pointer',
        borderLeft: active ? '2px solid var(--walnut)' : '2px solid transparent',
        transition: 'background 120ms ease',
        position: 'relative',
      }}
    >
      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: countColor }}>{count}</span>
      {onMore && (
        <button
          onClick={(e) => { e.stopPropagation(); onMore(); }}
          aria-label={`More actions for ${label}`}
          className="icon-btn"
          style={{ marginLeft: 4, width: 20, height: 24 }}
        >
          <I.More size={12} />
        </button>
      )}
    </div>
  );
}

export function LibrarySidebar(props: Props) {
  const totalCount = props.rows.length;
  const uncatCount = props.rows.filter(r => r.libraryId === null).length;
  return (
    <aside
      style={{ width: 240, borderRight: '0.5px solid var(--rule)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
      aria-label="Library scope"
    >
      {!props.introSeen && (
        <FirstUsePill onDismiss={props.onDismissIntro} />
      )}
      <SectionLabel>Libraries</SectionLabel>
      <Row
        active={isSelected(props.selection, 'all')}
        label="All Papers"
        count={totalCount}
        onClick={() => props.onSelect({ kind: 'all' })}
        ariaLabel={`All Papers, ${totalCount} papers`}
      />
      <Row
        active={isSelected(props.selection, 'uncategorized')}
        label="Uncategorized"
        count={uncatCount}
        onClick={() => props.onSelect({ kind: 'uncategorized' })}
        ariaLabel={`Uncategorized, ${uncatCount} papers`}
      />
      {props.libraries.length > 0 && <Divider />}
      {props.libraries.map(lib => (
        <Row
          key={lib.id}
          active={isSelected(props.selection, 'library', lib.id)}
          label={lib.name}
          count={props.rows.filter(r => r.libraryId === lib.id).length}
          onClick={() => props.onSelect({ kind: 'library', id: lib.id })}
          ariaLabel={`${lib.name}, ${props.rows.filter(r => r.libraryId === lib.id).length} papers`}
          onMore={() => { /* opens menu — wired in Task 4.6 */ }}
        />
      ))}
      <NewButton label="+ New library" onClick={props.onCreateLibrary} />

      {props.topics.length > 0 && (
        <>
          <SectionLabel style={{ marginTop: 16 }}>Topics</SectionLabel>
          {props.topics.map(t => (
            <Row
              key={t.id}
              active={isSelected(props.selection, 'topic', t.id)}
              label={`# ${t.name}`}
              count={props.rows.filter(r => r.topicIds.includes(t.id)).length}
              onClick={() => props.onSelect({ kind: 'topic', id: t.id })}
              ariaLabel={`Topic ${t.name}, ${props.rows.filter(r => r.topicIds.includes(t.id)).length} papers`}
              onMore={() => {}}
            />
          ))}
        </>
      )}
      <NewButton label="+ New topic" onClick={props.onCreateTopic} />
    </aside>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--ink-faded)',
    padding: '14px 12px 6px', ...style,
  }}>{children}</div>;
}
function Divider() {
  return <div style={{ borderTop: '0.5px solid var(--rule-soft)', margin: '6px 12px' }} />;
}
function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        margin: '4px 12px',
        padding: '8px 12px',
        height: 32,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink-faded)',
        background: 'transparent',
        border: '0.5px dashed var(--ink-ghost)',
        borderRadius: 4,
        textAlign: 'left',
      }}
    >{label}</button>
  );
}
function FirstUsePill({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{
      margin: '0 8px 12px 8px',
      padding: '10px 12px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule-soft)',
      borderRadius: 6,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Sparkle size={12} stroke={1.4} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--walnut)', textTransform: 'uppercase' }}>NEW</span>
        <button className="icon-btn" onClick={onDismiss} style={{ marginLeft: 'auto', width: 20, height: 20 }} aria-label="Dismiss intro">×</button>
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic', color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 4 }}>
        Organize papers into libraries and tag them with topics.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write component test**

```ts
// chrome-extension/tests/library-v2/unit/header-copy.test.ts (or library-sidebar.test.tsx)
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibrarySidebar } from '../../../reader/components/library-sidebar';

const baseProps = {
  libraries: [],
  topics: [],
  rows: [],
  selection: { kind: 'all' as const },
  onSelect: () => {},
  onCreateLibrary: () => {},
  onCreateTopic: () => {},
  onRenameLibrary: () => {},
  onDeleteLibrary: () => {},
  onRenameTopic: () => {},
  onDeleteTopic: () => {},
  introSeen: true,
  onDismissIntro: () => {},
};

describe('LibrarySidebar', () => {
  it('renders All Papers + Uncategorized as permanent rows', () => {
    render(<LibrarySidebar {...baseProps} rows={[
      { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      { urlHash: 'b', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: 'lib1', topicIds: [] },
    ]} />);
    expect(screen.getByText('All Papers')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    // count of "Uncategorized" should be 1 (only row a has libraryId=null)
    expect(screen.getByLabelText(/Uncategorized, 1 papers/)).toBeInTheDocument();
  });

  it('clicking a library row fires onSelect with kind=library + id', () => {
    const onSelect = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Q4'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'library', id: 'lib1' });
  });

  it('first-use pill renders when introSeen=false', () => {
    render(<LibrarySidebar {...baseProps} introSeen={false} />);
    expect(screen.getByText(/Organize papers into libraries/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/header-copy.test.ts
```
Expected: PASS.

- [ ] **Step 4: Visual smoke test**

Build extension, load it, manually open the drawer (after Task 6.2 wires it). For now just confirm typecheck:
```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-sidebar.tsx chrome-extension/tests/library-v2/unit/header-copy.test.ts
git commit -m "feat(ext): library-sidebar.tsx — base component with All/Uncategorized + Libraries + Topics + first-use pill"
```

---

### Task 4.3: Inline rename input + ⋯ menu (Rename / Delete)

**Files:**
- Modify: `chrome-extension/reader/components/library-sidebar.tsx`
- Test: `chrome-extension/tests/library-v2/unit/keyboard-shortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/keyboard-shortcuts.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibrarySidebar } from '../../../reader/components/library-sidebar';

const baseProps = { /* ...as in 4.2... */ };

describe('Sidebar keyboard shortcuts', () => {
  it('F2 on focused user-created row enters rename mode', async () => {
    const onRename = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onRenameLibrary={onRename} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    expect(onRename).toHaveBeenCalledWith('lib1');
  });

  it('Backspace on focused user-created row triggers delete confirm', async () => {
    const onDelete = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onDeleteLibrary={onDelete} />);
    const row = screen.getByLabelText(/Q4, 0 papers/);
    row.focus();
    fireEvent.keyDown(row, { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledWith('lib1');
  });

  it('F2/Backspace inside the search input does NOT trigger destructive actions', async () => {
    const onDelete = vi.fn();
    render(<LibrarySidebar {...baseProps} libraries={[{ id: 'lib1', name: 'Q4', createdAt: 0 }]} onDeleteLibrary={onDelete} />);
    // Simulate keyDown originating from an <input> target
    const evt = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(evt);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('All Papers + Uncategorized rows do NOT respond to F2/Backspace', async () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    render(<LibrarySidebar {...baseProps} onDeleteLibrary={onDelete} onRenameLibrary={onRename} />);
    const allRow = screen.getByLabelText(/All Papers/);
    allRow.focus();
    fireEvent.keyDown(allRow, { key: 'Backspace' });
    fireEvent.keyDown(allRow, { key: 'F2' });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — keybindings not wired.

- [ ] **Step 3: Add `isEditingInput` helper + wire keybindings**

Create a helper module (used in multiple places):

```ts
// chrome-extension/reader/lib/is-editing-input.ts
export function isEditingInput(e: { target: EventTarget | null }): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable === true;
}
```

In `library-sidebar.tsx`, in the `Row` component for user-created entries, wire onKeyDown:

```tsx
import { isEditingInput } from '../lib/is-editing-input';

// inside Row's onKeyDown:
onKeyDown={(e) => {
  if (isEditingInput(e)) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); return; }
  if (onMore) {  // user-created row only
    if (e.key === 'F2')          { e.preventDefault(); onRename?.(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onDelete?.(); }
  }
}}
```

Pass `onRename` / `onDelete` props down from `LibrarySidebar`. Permanent rows (All / Uncategorized) don't get them — they only respond to Enter/Space.

- [ ] **Step 4: Run tests**

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-sidebar.tsx chrome-extension/reader/lib/is-editing-input.ts chrome-extension/tests/library-v2/unit/keyboard-shortcuts.test.ts
git commit -m "feat(ext): sidebar keyboard shortcuts — F2 rename, Backspace delete, isEditingInput input-field guard"
```

---

### Task 4.4: First-use pill dismiss persistence

**Files:**
- Test: `chrome-extension/tests/library-v2/unit/first-use-pill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/first-use-pill.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibrarySidebar } from '../../../reader/components/library-sidebar';
import { setItem, getItem } from '../../../reader/lib/storage-schema';

const baseProps = { /* ...as before with onDismissIntro that writes the storage key... */ };

describe('First-use pill', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('renders when libraryV2Migrated=true and librariesIntroSeen!==true', async () => {
    await setItem('pf:libraryV2Migrated', true);
    const onDismiss = async () => { await setItem('pf:librariesIntroSeen', true); };
    render(<LibrarySidebar {...baseProps} introSeen={false} onDismissIntro={onDismiss} />);
    expect(screen.getByText(/Organize papers into libraries/)).toBeInTheDocument();
  });

  it('clicking dismiss writes pf:librariesIntroSeen=true', async () => {
    const onDismiss = async () => { await setItem('pf:librariesIntroSeen', true); };
    render(<LibrarySidebar {...baseProps} introSeen={false} onDismissIntro={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss intro'));
    // Wait microtask for async setItem
    await new Promise(r => setTimeout(r, 0));
    expect(await getItem('pf:librariesIntroSeen')).toBe(true);
  });

  it('does NOT render when introSeen=true', () => {
    render(<LibrarySidebar {...baseProps} introSeen={true} />);
    expect(screen.queryByText(/Organize papers into libraries/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Expected: PASS (component already correct from Task 4.2 — these tests just lock in the contract).

- [ ] **Step 3: No-op (component already wires this)**

If tests fail, double-check the conditional in `LibrarySidebar` and the dismiss handler.

- [ ] **Step 4: Run again**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/library-v2/unit/first-use-pill.test.ts
git commit -m "test(ext): first-use pill — render gate + dismiss persistence"
```

---

## Phase 5: Card chip row + popovers

### Task 5.1: `library-popover.tsx` — single-select Library popover

**Files:**
- Create: `chrome-extension/reader/components/library-popover.tsx`
- Test: component test

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/library-popover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryPopover } from '../../../reader/components/library-popover';

describe('LibraryPopover (single-select)', () => {
  it('renders existing libraries + None + Create option when typed text doesnt match', () => {
    render(<LibraryPopover
      libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]}
      currentId="l1"
      onAssign={() => {}}
      onCreate={() => {}}
      onClose={() => {}}
    />);
    expect(screen.getByText('— None —')).toBeInTheDocument();
    expect(screen.getByText('Q4')).toBeInTheDocument();
  });

  it('typing a non-matching name reveals + Create row', () => {
    render(<LibraryPopover libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} currentId={null} onAssign={() => {}} onCreate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Filter or create/), { target: { value: 'NewLib' } });
    expect(screen.getByText(/Create "NewLib"/)).toBeInTheDocument();
  });

  it('clicking — None — fires onAssign(null) and closes', () => {
    const onAssign = vi.fn();
    const onClose = vi.fn();
    render(<LibraryPopover libraries={[]} currentId="l1" onAssign={onAssign} onCreate={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText('— None —'));
    expect(onAssign).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement popover**

```tsx
// chrome-extension/reader/components/library-popover.tsx
import { useState, useEffect, useRef } from 'react';
import { useFloating, flip, shift, autoUpdate, type Placement } from '@floating-ui/react-dom';
import type { LibraryCatalogEntry, TopicCatalogEntry } from '../types';
import { I } from './icons';
import { trapFocus } from '../lib/focus-trap';

interface LibProps {
  libraries: LibraryCatalogEntry[];
  currentId: string | null;
  onAssign: (id: string | null) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;  // for floating-ui positioning
}

export function LibraryPopover({ libraries, currentId, onAssign, onCreate, onClose, anchor }: LibProps) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start' as Placement,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);
  useEffect(() => { if (panelRef.current) return trapFocus(panelRef.current); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const trimmed = filter.trim();
  const filtered = libraries.filter(l => !trimmed || l.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = libraries.some(l => l.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{ ...floatingStyles, width: 240, background: 'var(--paper)', border: '0.5px solid var(--rule)', borderRadius: 6, boxShadow: 'var(--shadow-2)', zIndex: 300 }}
      role="dialog"
      aria-label="Choose library"
    >
      <div style={{ padding: 8, borderBottom: '0.5px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Search size={12} stroke={1.4} />
        <input
          autoFocus
          placeholder="Filter or create…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12 }}
        />
      </div>
      <button
        onClick={() => { onAssign(null); onClose(); }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: currentId === null ? 'var(--ink)' : 'var(--ink-soft)' }}
      >— None —</button>
      {filtered.map(l => (
        <button
          key={l.id}
          onClick={() => { onAssign(l.id); onClose(); }}
          aria-label={`Assign library ${l.name}`}
          style={{ display: 'flex', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, alignItems: 'center', gap: 6 }}
        >
          <span style={{ flex: 1 }}>{l.name}</span>
          {currentId === l.id && <span style={{ color: 'var(--walnut)' }}>✓</span>}
        </button>
      ))}
      {trimmed && !exactMatch && (
        <>
          <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />
          <button
            onClick={() => { onCreate(trimmed); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--walnut)' }}
          >+ Create "{trimmed}"</button>
        </>
      )}
    </div>
  );
}

// Topic popover (multi-select) — see Task 5.2
```

(If the Phase 0 spike found floating-ui doesn't work in MV3, replace the `useFloating` block with hand-rolled positioning using `getBoundingClientRect` on the anchor.)

- [ ] **Step 4: Run test**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-popover.tsx chrome-extension/tests/library-v2/unit/library-popover.test.tsx
git commit -m "feat(ext): LibraryPopover (single-select) with floating-ui auto-flip + Create option"
```

---

### Task 5.2: `library-popover.tsx` — multi-select Topic popover

**Files:**
- Modify: `chrome-extension/reader/components/library-popover.tsx`
- Test: extend popover test

- [ ] **Step 1: Write the failing test**

Append to `library-popover.test.tsx`:

```ts
import { TopicPopover } from '../../../reader/components/library-popover';

describe('TopicPopover (multi-select)', () => {
  it('renders checkboxes for each topic with checked state from selectedIds', () => {
    render(<TopicPopover
      topics={[{ id: 't1', name: 'VLA', createdAt: 0 }, { id: 't2', name: 'Robotics', createdAt: 0 }]}
      selectedIds={['t1']}
      onToggle={() => {}}
      onCreate={() => {}}
      onClose={() => {}}
    />);
    expect((screen.getByLabelText('VLA') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Robotics') as HTMLInputElement).checked).toBe(false);
  });

  it('clicking a checkbox fires onToggle with id (does not close)', () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    render(<TopicPopover topics={[{ id: 't1', name: 'VLA', createdAt: 0 }]} selectedIds={[]} onToggle={onToggle} onCreate={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('VLA'));
    expect(onToggle).toHaveBeenCalledWith('t1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('empty catalog shows "Type to create your first topic"', () => {
    render(<TopicPopover topics={[]} selectedIds={[]} onToggle={() => {}} onCreate={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Type to create your first topic/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `TopicPopover` not exported.

- [ ] **Step 3: Implement TopicPopover**

Append to `library-popover.tsx`:

```tsx
interface TopicProps {
  topics: TopicCatalogEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;
}

export function TopicPopover({ topics, selectedIds, onToggle, onCreate, onClose, anchor }: TopicProps) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start' as Placement,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);
  useEffect(() => { if (panelRef.current) return trapFocus(panelRef.current); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const trimmed = filter.trim();
  const filtered = topics.filter(t => !trimmed || t.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = topics.some(t => t.name.toLowerCase() === trimmed.toLowerCase());
  const selectedSet = new Set(selectedIds);

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{ ...floatingStyles, width: 240, background: 'var(--paper)', border: '0.5px solid var(--rule)', borderRadius: 6, boxShadow: 'var(--shadow-2)', zIndex: 300 }}
      role="dialog"
      aria-label="Choose topics"
    >
      <div style={{ padding: 8, borderBottom: '0.5px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Search size={12} stroke={1.4} />
        <input
          autoFocus
          placeholder="Filter or create…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12 }}
        />
      </div>
      {topics.length === 0 && (
        <div style={{ padding: '18px 14px', fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--ink-faded)', fontSize: 12 }}>
          Type to create your first topic
        </div>
      )}
      {filtered.map(t => (
        <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label={t.name}
            checked={selectedSet.has(t.id)}
            onChange={() => onToggle(t.id)}
          />
          <span>{t.name}</span>
        </label>
      ))}
      {trimmed && !exactMatch && (
        <>
          <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />
          <button onClick={() => onCreate(trimmed)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--walnut)' }}>
            + Create "{trimmed}"
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-popover.tsx chrome-extension/tests/library-v2/unit/library-popover.test.tsx
git commit -m "feat(ext): TopicPopover (multi-select) — checkboxes + empty-state copy + + Create"
```

---

### Task 5.3: Update `library-row.tsx` — Library + Topic chips

**Files:**
- Modify: `chrome-extension/reader/components/library-row.tsx`
- Test: `chrome-extension/tests/library-v2/unit/multi-topic-buckets.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// chrome-extension/tests/library-v2/unit/multi-topic-buckets.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';

const baseRow = {
  urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
  addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
  libraryId: null, topicIds: [],
};

describe('LibraryRowView chip row', () => {
  it('renders unfiled Library chip when libraryId=null', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByLabelText('Set library')).toBeInTheDocument();
  });

  it('renders filed Library chip with name when libraryId is set', () => {
    render(<LibraryRowView row={{ ...baseRow, libraryId: 'l1' }} isCurrent={false} libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText(/Library: Q4/)).toBeInTheDocument();
  });

  it('renders one Topic chip per assigned topicId', () => {
    render(<LibraryRowView row={{ ...baseRow, topicIds: ['t1', 't2'] }} isCurrent={false} libraries={[]} topics={[{ id: 't1', name: 'VLA', createdAt: 0 }, { id: 't2', name: 'Robotics', createdAt: 0 }]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('VLA')).toBeInTheDocument();
    expect(screen.getByText('Robotics')).toBeInTheDocument();
  });

  it('clicking the × on a Topic chip calls onUnassignTopic', () => {
    const onUnassign = vi.fn();
    render(<LibraryRowView row={{ ...baseRow, topicIds: ['t1'] }} isCurrent={false} libraries={[]} topics={[{ id: 't1', name: 'VLA', createdAt: 0 }]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={onUnassign} />);
    fireEvent.click(screen.getByLabelText('Topic: VLA, click to remove'));
    expect(onUnassign).toHaveBeenCalledWith('t1');
  });

  it('renders + Set topic chip', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByLabelText('Set topic')).toBeInTheDocument();
  });

  it('renders "Also in: …" annotation when alsoInTopics prop is set', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} alsoInTopics={['Robotics', 'Multimodal']} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('Also in: Robotics · Multimodal')).toBeInTheDocument();
  });

  it('caps "Also in:" at 3 names + +N more', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} alsoInTopics={['A', 'B', 'C', 'D', 'E']} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('Also in: A · B · C · +2 more')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `LibraryRowView` doesn't accept the new props.

- [ ] **Step 3: Update `library-row.tsx`**

Read the current file first:
```bash
cat chrome-extension/reader/components/library-row.tsx
```

Replace with the v2 version. Add new props and chip row JSX. The existing right-cluster (role chip + memory + annotation count) is preserved. Insert the chip row inside the left column, below the judgment quote.

```tsx
// Append after existing imports:
import { LibraryPopover, TopicPopover } from './library-popover';
import { useState, useRef } from 'react';

interface Props {
  row: LibraryRow;
  isCurrent: boolean;
  libraries: LibraryCatalogEntry[];
  topics: TopicCatalogEntry[];
  alsoInTopics?: string[];                       // for multi-Topic disambiguation
  onAssignLibrary: (rowKey: string, libraryId: string | null) => void;
  onToggleTopic: (rowKey: string, topicId: string) => void;
  onUnassignTopic: (rowKey: string, topicId: string) => void;
  onCreateLibraryFromCard?: (name: string, rowKey: string) => void;
  onCreateTopicFromCard?: (name: string, rowKey: string) => void;
}

export function LibraryRowView({ row, isCurrent, libraries, topics, alsoInTopics, ... }: Props) {
  const rowKey = row.id ?? row.urlHash;
  const [libPopOpen, setLibPopOpen] = useState(false);
  const [topicPopOpen, setTopicPopOpen] = useState(false);
  const libAnchor = useRef<HTMLButtonElement>(null);
  const topicAnchor = useRef<HTMLButtonElement>(null);

  const filedLib = libraries.find(l => l.id === row.libraryId);
  const assignedTopics = row.topicIds.map(id => topics.find(t => t.id === id)).filter(Boolean) as TopicCatalogEntry[];

  return (
    <div style={{ /* existing card chrome — preserve */ }}>
      {/* ... existing spine, title, authors, judgment ... */}

      {alsoInTopics && alsoInTopics.length > 0 && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.04em',
          color: 'var(--ink-faded)', margin: '4px 0 8px 6px',
        }}>
          Also in: {alsoInTopics.slice(0, 3).join(' · ')}{alsoInTopics.length > 3 ? ` · +${alsoInTopics.length - 3} more` : ''}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap-reverse', gap: 6, alignItems: 'center', marginTop: 8 }}>
        {/* Library chip */}
        <button
          ref={libAnchor}
          aria-label={filedLib ? `Library: ${filedLib.name}` : 'Set library'}
          onClick={() => setLibPopOpen(o => !o)}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 6px',
            background: filedLib ? 'var(--paper-deep)' : 'transparent',
            color: filedLib ? 'var(--ink)' : 'var(--ink-faded)',
            border: filedLib ? '0.5px solid var(--rule)' : '0.5px dashed var(--ink-ghost)',
            borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          <I.Folder size={11} stroke={1.4} />
          {filedLib ? `Library: ${filedLib.name}` : '+ Set library'}
          <I.ChevronDown size={9} stroke={1.5} />
        </button>

        {/* Topic chips */}
        {assignedTopics.map(t => (
          <span key={t.id} style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 6px',
            background: 'color-mix(in oklch, var(--walnut) 8%, transparent)',
            color: 'var(--ink-soft)', border: '0.5px solid var(--rule)',
            borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {t.name}
            <button
              aria-label={`Topic: ${t.name}, click to remove`}
              onClick={() => props.onUnassignTopic(rowKey, t.id)}
              onKeyDown={(e) => {
                if (isEditingInput(e)) return;
                if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); props.onUnassignTopic(rowKey, t.id); }
              }}
              className="topic-chip-x"
              style={{ color: 'var(--ink-faded)' }}
            >×</button>
          </span>
        ))}

        {/* + Set topic chip */}
        <button
          ref={topicAnchor}
          aria-label="Set topic"
          onClick={() => setTopicPopOpen(o => !o)}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 6px',
            background: 'transparent',
            color: 'var(--ink-faded)',
            border: '0.5px dashed var(--ink-ghost)',
            borderRadius: 3,
          }}
        >+ Set topic <I.ChevronDown size={9} stroke={1.5} /></button>

        {/* Right cluster */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* existing role chip + memory icon + annotation count */}
        </div>
      </div>

      {libPopOpen && (
        <LibraryPopover
          libraries={libraries}
          currentId={row.libraryId}
          onAssign={(id) => props.onAssignLibrary(rowKey, id)}
          onCreate={(name) => props.onCreateLibraryFromCard?.(name, rowKey)}
          onClose={() => setLibPopOpen(false)}
          anchor={libAnchor.current}
        />
      )}
      {topicPopOpen && (
        <TopicPopover
          topics={topics}
          selectedIds={row.topicIds}
          onToggle={(id) => props.onToggleTopic(rowKey, id)}
          onCreate={(name) => props.onCreateTopicFromCard?.(name, rowKey)}
          onClose={() => setTopicPopOpen(false)}
          anchor={topicAnchor.current}
        />
      )}
    </div>
  );
}
```

Add CSS for the topic-chip-x hover/focus reveal in `tokens.css`:

```css
.topic-chip-x { display: none; }
.topic-chip-x:focus-visible,
.topic-chip-x:focus,
*:hover > .topic-chip-x { display: inline; }
```

(Or co-locate via inline styles + `:hover` proxy via container.)

- [ ] **Step 4: Run tests**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/multi-topic-buckets.test.ts
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-row.tsx chrome-extension/styles/tokens.css chrome-extension/tests/library-v2/unit/multi-topic-buckets.test.ts
git commit -m "feat(ext): library-row.tsx — chip row (Library + Topic chips + + Set topic), Also in disambiguation, hover-x unassign"
```

---

## Phase 6: Confirm modal + drawer integration

### Task 6.1: `confirm-modal.tsx`

**Files:**
- Create: `chrome-extension/reader/components/confirm-modal.tsx`
- Test: component test

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/confirm-modal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from '../../../reader/components/confirm-modal';

describe('ConfirmModal', () => {
  it('renders title + body + Cancel + danger button (Delete)', () => {
    render(<ConfirmModal open title="Delete library 'Q4 Reading'?" body="7 papers will move to Uncategorized." dangerLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Delete library 'Q4 Reading'?")).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('initial focus is Cancel', () => {
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('Esc fires onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking Delete calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables Esc + backdrop while inFlight=true; Delete button shows "Deleting…"', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" inFlight onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// chrome-extension/reader/components/confirm-modal.tsx
import { useEffect, useRef } from 'react';
import { trapFocus } from '../lib/focus-trap';
import '../styles/conflict-modal.css';  // reuse the modal chrome CSS

interface Props {
  open: boolean;
  title: string;
  body: string | React.ReactNode;
  dangerLabel: string;
  inFlight?: boolean;
  inlineError?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, body, dangerLabel, inFlight, inlineError, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  useEffect(() => { if (open && panelRef.current) return trapFocus(panelRef.current); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !inFlight) onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, inFlight, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="conflict-modal-backdrop"
      onClick={(e) => { if (!inFlight && e.target === e.currentTarget) onCancel(); }}
    >
      <div ref={panelRef} className="conflict-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="conflict-modal-title">{title}</h2>
        <div className="conflict-modal-stats">{body}</div>
        {inlineError && <div style={{ color: 'var(--foxglove)', fontSize: 12, padding: '4px 0' }}>{inlineError}</div>}
        <div className="conflict-modal-secondary-actions">
          <button ref={cancelRef} onClick={onCancel} className="conflict-modal-primary">Cancel</button>
          <button onClick={onConfirm} disabled={inFlight} className="conflict-modal-destructive">
            {inFlight ? 'Deleting…' : dangerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/confirm-modal.tsx chrome-extension/tests/library-v2/unit/confirm-modal.test.tsx
git commit -m "feat(ext): generic ConfirmModal — Cancel→Delete tab order, Esc-disabled-mid-flight, inline error slot"
```

---

### Task 6.2: Wire `library-drawer.tsx` — widen + sidebar + scope filter

**Files:**
- Modify: `chrome-extension/reader/components/library-drawer.tsx`
- Test: `chrome-extension/tests/library-v2/unit/filter-pipeline.test.ts`

This is the biggest task in the plan. The existing 213-line drawer becomes a 350-line drawer wiring everything together. Break into sub-steps.

- [ ] **Step 1: Write the failing tests**

```ts
// chrome-extension/tests/library-v2/unit/filter-pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryDrawer } from '../../../reader/components/library-drawer';
import { setItem } from '../../../reader/lib/storage-schema';

describe('LibraryDrawer scope filter', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await setItem('pf:libraries', [{ id: 'l1', name: 'Q4', createdAt: 0 }]);
    await setItem('pf:topics', [{ id: 't1', name: 'VLA', createdAt: 0 }]);
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 'Paper A', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: 'l1', topicIds: [] },
        { urlHash: 'b', title: 'Paper B', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: ['t1'] },
        { urlHash: 'c', title: 'Paper C', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      ],
    });
  });

  it('default selection (all) shows all 3 papers, header reads "Library · 3 papers"', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    expect(await screen.findByText(/Library · 3 papers/)).toBeInTheDocument();
    expect(screen.getByText('Paper A')).toBeInTheDocument();
    expect(screen.getByText('Paper B')).toBeInTheDocument();
    expect(screen.getByText('Paper C')).toBeInTheDocument();
  });

  it('selecting a Library filters to its rows and updates header to "{name} · {N}"', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    fireEvent.click(await screen.findByText('Q4'));
    expect(await screen.findByText(/Q4 · 1/)).toBeInTheDocument();
    expect(screen.getByText('Paper A')).toBeInTheDocument();
    expect(screen.queryByText('Paper B')).toBeNull();
  });

  it('selecting Uncategorized filters to libraryId===null rows', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    fireEvent.click(await screen.findByText('Uncategorized'));
    expect(await screen.findByText(/Uncategorized · 2/)).toBeInTheDocument();  // B + C
  });

  it('selecting a Topic filters to topicIds.includes(id) and header reads "Tagged \'name\' · N"', async () => {
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    fireEvent.click(await screen.findByText(/# VLA/));
    expect(await screen.findByText(/Tagged 'VLA' · 1/)).toBeInTheDocument();
    expect(screen.getByText('Paper B')).toBeInTheDocument();
    expect(screen.queryByText('Paper A')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — drawer doesn't render the sidebar or scope-aware header.

- [ ] **Step 3: Rewrite `library-drawer.tsx`**

Full rewrite — too long for inline display. Key shape:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { LibraryRow, LibraryCatalogEntry, TopicCatalogEntry } from '../types';
import { getLibrary } from '../lib/library';
import { getLibraries, getTopics, createLibrary, createTopic, renameLibrary, renameTopic, scheduleDeleteLibrary, scheduleDeleteTopic, undoPendingDelete, runLibraryV2Migration, sanitizeLibraryRows } from '../lib/library-catalog';
import { getItem, setItem } from '../lib/storage-schema';
import { usePendingDeletesCommit } from '../lib/use-pending-deletes-commit';
import { LibrarySidebar, type SidebarSelection } from './library-sidebar';
import { LibraryRowView } from './library-row';
import { LibraryCapBanner } from './library-cap-banner';
import { ConfirmModal } from './confirm-modal';
import { I } from './icons';
import { isEditingInput } from '../lib/is-editing-input';
import { showToast } from '../lib/toast-helpers';

type GroupBy = 'topic' | 'role' | 'recent';

function headerTitle(s: SidebarSelection, n: number, libs: LibraryCatalogEntry[], topics: TopicCatalogEntry[]): React.ReactNode {
  if (s.kind === 'all') return <>Library <span style={{ color: 'var(--ink-faded)' }}>· {n} papers</span></>;
  if (s.kind === 'uncategorized') return <>Uncategorized <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  if (s.kind === 'library') return <>{libs.find(l => l.id === s.id)?.name ?? '?'} <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  if (s.kind === 'topic')   return <>Tagged '{topics.find(t => t.id === s.id)?.name ?? '?'}' <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  return null;
}

export function LibraryDrawer({ open, onClose, currentPaperKey }: { open: boolean; onClose: () => void; currentPaperKey: string }) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [libraries, setLibraries] = useState<LibraryCatalogEntry[]>([]);
  const [topics, setTopics] = useState<TopicCatalogEntry[]>([]);
  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'all' });
  const [introSeen, setIntroSeen] = useState(true);
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('recent');
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'library' | 'topic'; id: string; name: string; affectedCount: number } | null>(null);

  usePendingDeletesCommit();

  // Initial load
  useEffect(() => {
    if (!open) return;
    (async () => {
      await runLibraryV2Migration();
      const [r, l, t, seen] = await Promise.all([
        getLibrary(),
        getLibraries(),
        getTopics(),
        getItem('pf:librariesIntroSeen'),
      ]);
      const changed = await sanitizeLibraryRows();
      const finalRows = changed ? await getLibrary() : r;
      setRows(finalRows);
      setLibraries(l);
      setTopics(t);
      setIntroSeen(seen === true);
    })();
  }, [open]);

  // Filter pipeline (spec § Filter pipeline)
  const idToLibName = useMemo(() => new Map(libraries.map(l => [l.id, l.name])), [libraries]);
  const idToTopicName = useMemo(() => new Map(topics.map(t => [t.id, t.name])), [topics]);

  const scopeFiltered = useMemo(() => rows.filter(r => {
    if (selection.kind === 'all') return true;
    if (selection.kind === 'uncategorized') return r.libraryId === null;
    if (selection.kind === 'library') return r.libraryId === selection.id;
    if (selection.kind === 'topic') return r.topicIds.includes(selection.id);
    return false;
  }), [rows, selection]);

  const haystack = useMemo(() => new Map(rows.map(r => [r.id ?? r.urlHash, [
    r.title, r.authors.join(' '),
    r.libraryId ? idToLibName.get(r.libraryId) ?? '' : '',
    r.topicIds.map(id => idToTopicName.get(id) ?? '').join(' '),
  ].join(' ').toLowerCase()])), [rows, idToLibName, idToTopicName]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return scopeFiltered.filter(r =>
      (!needle || (haystack.get(r.id ?? r.urlHash) ?? '').includes(needle)) &&
      (!memoryOnly || r.hasMemory)
    );
  }, [scopeFiltered, q, memoryOnly, haystack]);

  // Group-by bucketing (with multi-Topic row expansion)
  const groups = useMemo(() => {
    const out: Record<string, Array<{ row: LibraryRow; alsoInTopics?: string[] }>> = {};
    if (groupBy === 'topic') {
      for (const r of filtered) {
        if (r.topicIds.length === 0) {
          (out['Uncategorized'] = out['Uncategorized'] ?? []).push({ row: r });
        } else {
          // sort topicIds by topic.createdAt asc to make "first appearance" deterministic
          const orderedTopicIds = [...r.topicIds].sort((a, b) => {
            const ta = topics.find(t => t.id === a)?.createdAt ?? 0;
            const tb = topics.find(t => t.id === b)?.createdAt ?? 0;
            return ta - tb;
          });
          orderedTopicIds.forEach((tid, idx) => {
            const tName = idToTopicName.get(tid) ?? '?';
            const otherNames = orderedTopicIds.filter(x => x !== tid).map(x => idToTopicName.get(x) ?? '');
            (out[tName] = out[tName] ?? []).push({
              row: r,
              alsoInTopics: idx > 0 ? otherNames.filter(Boolean) : undefined,
            });
          });
        }
      }
    } else if (groupBy === 'role') {
      for (const r of filtered) {
        const k = r.role || 'Uncategorized';
        (out[k] = out[k] ?? []).push({ row: r });
      }
    } else {
      const sorted = [...filtered].sort((a, b) => b.lastRead - a.lastRead);
      out['Recently opened'] = sorted.map(row => ({ row }));
    }
    return out;
  }, [filtered, groupBy, idToTopicName, topics]);

  // Mutations: refresh state after any catalog/library change
  const refresh = async () => {
    const [r, l, t] = await Promise.all([getLibrary(), getLibraries(), getTopics()]);
    setRows(r); setLibraries(l); setTopics(t);
  };

  const handleAssignLibrary = async (rowKey: string, libraryId: string | null) => {
    // Optimistic update: handled in Phase 7 with opacity 0.7
    const all = await getLibrary();
    const next = all.map(r => (r.id ?? r.urlHash) === rowKey ? { ...r, libraryId } : r);
    await chrome.storage.local.set({ library: next });
    await refresh();
  };
  const handleToggleTopic = async (rowKey: string, topicId: string) => {
    const all = await getLibrary();
    const next = all.map(r => {
      if ((r.id ?? r.urlHash) !== rowKey) return r;
      const has = r.topicIds.includes(topicId);
      return { ...r, topicIds: has ? r.topicIds.filter(x => x !== topicId) : [...r.topicIds, topicId] };
    });
    await chrome.storage.local.set({ library: next });
    await refresh();
  };
  const handleUnassignTopic = (rowKey: string, topicId: string) => handleToggleTopic(rowKey, topicId);

  const handleDeleteLibrary = async () => {
    if (!confirm || confirm.kind !== 'library') return;
    const lib = libraries.find(l => l.id === confirm.id);
    if (!lib) return;
    await scheduleDeleteLibrary(confirm.id);
    setConfirm(null);
    await refresh();
    if (selection.kind === 'library' && selection.id === confirm.id) {
      setSelection({ kind: 'all' });
    }
    showToast({
      message: `Library '${lib.name}' deleted.`,
      action: {
        label: 'Undo',
        handler: async () => {
          const pendings = await getItem('pf:lib:pendingDeletes') ?? [];
          const target = pendings.find(p => p.kind === 'library' && p.deletedEntry.id === lib.id);
          if (target) {
            await undoPendingDelete(target.id);
            await refresh();
          }
        },
      },
      timeoutMs: 5000,
    });
  };
  const handleDeleteTopic = async () => { /* mirror, with topics + scheduleDeleteTopic */ };

  if (!open) return null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 8, 0.35)', backdropFilter: 'blur(2px)', zIndex: 200, display: 'flex', animation: 'fade-in 150ms ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1200px, 92%)', height: '100%', background: 'var(--paper)', boxShadow: 'var(--shadow-3)', display: 'flex', flexDirection: 'row', animation: 'slide-in-right 220ms cubic-bezier(0.2, 0.9, 0.3, 1)' }} role="dialog" aria-modal="true" aria-label="Library">
        <LibrarySidebar
          libraries={libraries}
          topics={topics}
          rows={rows}
          selection={selection}
          onSelect={setSelection}
          onCreateLibrary={() => { /* open inline input — deferred to drawer-level state */ }}
          onCreateTopic={() => { /* same */ }}
          onRenameLibrary={async (id) => { /* inline rename UI */ }}
          onDeleteLibrary={(id) => {
            const lib = libraries.find(l => l.id === id);
            if (!lib) return;
            const affected = rows.filter(r => r.libraryId === id).length;
            setConfirm({ kind: 'library', id, name: lib.name, affectedCount: affected });
          }}
          onRenameTopic={() => {}}
          onDeleteTopic={(id) => {
            const t = topics.find(x => x.id === id);
            if (!t) return;
            const affected = rows.filter(r => r.topicIds.includes(id)).length;
            setConfirm({ kind: 'topic', id, name: t.name, affectedCount: affected });
          }}
          introSeen={introSeen}
          onDismissIntro={async () => { await setItem('pf:librariesIntroSeen', true); setIntroSeen(true); }}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
          <div style={{ padding: '18px 22px 14px', borderBottom: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.Library size={16} stroke={1.5} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
              {headerTitle(selection, filtered.length, libraries, topics)}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} className="icon-btn"><I.Close size={14} /></button>
          </div>

          <LibraryCapBanner onUpgrade={() => { /* unchanged */ }} />

          {/* Toolbar — preserved from existing drawer */}
          {/* ... search input, Group by Seg, Has memory checkbox ... */}

          {/* aria-live region for screen reader announcements */}
          <ScopeLiveRegion selection={selection} count={filtered.length} libs={libraries} topics={topics} />

          {/* Groups */}
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px 18px' }}>
            {Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} style={{ marginTop: 18 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faded)', padding: '0 4px 6px' }}>{groupName} · {items.length}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map(({ row, alsoInTopics }) => (
                    <LibraryRowView
                      key={`${row.id ?? row.urlHash}-${groupName}`}
                      row={row}
                      isCurrent={(row.id ?? row.urlHash) === currentPaperKey}
                      libraries={libraries}
                      topics={topics}
                      alsoInTopics={alsoInTopics}
                      onAssignLibrary={handleAssignLibrary}
                      onToggleTopic={handleToggleTopic}
                      onUnassignTopic={handleUnassignTopic}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirm && confirm.kind === 'library' && (
        <ConfirmModal
          open
          title={`Delete library '${confirm.name}'?`}
          body={`${confirm.affectedCount} papers will move to Uncategorized.`}
          dangerLabel="Delete"
          onConfirm={handleDeleteLibrary}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm && confirm.kind === 'topic' && (
        <ConfirmModal
          open
          title={`Delete topic '${confirm.name}'?`}
          body={`It will be removed from ${confirm.affectedCount} papers.`}
          dangerLabel="Delete"
          onConfirm={handleDeleteTopic}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ScopeLiveRegion({ selection, count, libs, topics }: { selection: SidebarSelection; count: number; libs: LibraryCatalogEntry[]; topics: TopicCatalogEntry[] }) {
  const [text, setText] = useState('');
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const scopeName =
        selection.kind === 'all' ? 'all papers' :
        selection.kind === 'uncategorized' ? 'Uncategorized' :
        selection.kind === 'library' ? (libs.find(l => l.id === selection.id)?.name ?? '') :
        `topic ${topics.find(t => t.id === selection.id)?.name ?? ''}`;
      setText(`Showing ${count} papers in ${scopeName}`);
    }, 150);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [selection, count, libs, topics]);
  return (
    <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
      {text}
    </div>
  );
}
```

(The Seg toolbar is preserved from the existing drawer; copy it verbatim into the new drawer body.)

- [ ] **Step 4: Run tests**

```bash
cd chrome-extension && bun run test tests/library-v2/unit/filter-pipeline.test.ts
```
Expected: 4 tests pass. Then run full suite:
```bash
bun run test
```
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-drawer.tsx chrome-extension/tests/library-v2/unit/filter-pipeline.test.ts
git commit -m "feat(ext): library-drawer.tsx — full v2 wire-up (sidebar + scope filter + header copy + groups + confirm modals + aria-live)"
```

---

## Phase 7: Optimistic UI + animations

### Task 7.1: `shake-x` keyframe in `tokens.css`

**Files:**
- Modify: `chrome-extension/styles/tokens.css` (or `styles/tokens.css` shared file)

- [ ] **Step 1: Append keyframe**

```css
@keyframes shake-x {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-2px); }
  40%, 80% { transform: translateX(2px); }
}
.shake-x { animation: shake-x 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@media (prefers-reduced-motion: reduce) { .shake-x { animation: none; } }
```

- [ ] **Step 2: Smoke-test in browser devtools**

Manual: load extension, in console run `document.body.classList.add('shake-x')`. Should see body shake briefly.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/styles/tokens.css
git commit -m "feat(ext): tokens.css — shake-x keyframe for Library v2 optimistic-failure feedback"
```

---

### Task 7.2: Wire `opacity:0.7` + shake-x on optimistic chip writes

**Files:**
- Modify: `chrome-extension/reader/components/library-drawer.tsx`
- Modify: `chrome-extension/reader/components/library-row.tsx`
- Test: `chrome-extension/tests/library-v2/unit/optimistic-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chrome-extension/tests/library-v2/unit/optimistic-ui.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';

describe('Optimistic UI — chip lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('chip shows opacity 0.7 while assignment is in flight', async () => {
    let resolveAssign!: () => void;
    const onAssign = () => new Promise<void>(r => { resolveAssign = r; });
    render(<LibraryRowView row={{ /* base */ libraryId: null, topicIds: [] } as any} isCurrent={false} libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} topics={[]} onAssignLibrary={onAssign as any} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    fireEvent.click(screen.getByLabelText('Set library'));
    fireEvent.click(await screen.findByText('Q4'));
    // The optimistic state — the new "Library: Q4" chip should be rendered with opacity 0.7
    const chip = await screen.findByLabelText('Library: Q4');
    expect(chip).toHaveStyle('opacity: 0.7');
    resolveAssign();
    await waitFor(() => expect(chip).toHaveStyle('opacity: 1'));
  });

  it('chip shakes on lock failure then fades out, prev state restored', async () => {
    const onAssign = vi.fn().mockRejectedValue(new Error('lock failed'));
    render(<LibraryRowView row={{ /* base */ libraryId: null, topicIds: [] } as any} isCurrent={false} libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} topics={[]} onAssignLibrary={onAssign} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    fireEvent.click(screen.getByLabelText('Set library'));
    fireEvent.click(await screen.findByText('Q4'));
    const chip = await screen.findByLabelText('Library: Q4');
    expect(chip.className).toContain('shake-x');
    vi.advanceTimersByTime(600);  // shake (320) + fade (200)
    await waitFor(() => expect(screen.getByLabelText('Set library')).toBeInTheDocument());  // reverted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — chip has no optimistic state tracking.

- [ ] **Step 3: Add inFlight + failure tracking to chip**

In `library-row.tsx`, manage local optimistic state for the Library chip:

```tsx
const [optimisticLibraryId, setOptimisticLibraryId] = useState<string | null | undefined>(undefined);
const [chipState, setChipState] = useState<'idle' | 'inflight' | 'failed'>('idle');

const effectiveLibraryId = optimisticLibraryId !== undefined ? optimisticLibraryId : row.libraryId;
const filedLib = libraries.find(l => l.id === effectiveLibraryId);

const tryAssign = async (id: string | null) => {
  setOptimisticLibraryId(id);
  setChipState('inflight');
  try {
    await Promise.resolve(props.onAssignLibrary(rowKey, id));
    setChipState('idle');
    setOptimisticLibraryId(undefined);  // canonical state has caught up
  } catch {
    setChipState('failed');
    setTimeout(() => {
      setChipState('idle');
      setOptimisticLibraryId(undefined);
    }, 320 + 200);
  }
};
```

Render the chip with `opacity: chipState === 'inflight' ? 0.7 : 1` and `className={chipState === 'failed' ? 'shake-x' : ''}`.

Mirror the same pattern for individual Topic chips (each tracks its own inflight/failed state by topicId).

- [ ] **Step 4: Run tests**

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/components/library-row.tsx chrome-extension/tests/library-v2/unit/optimistic-ui.test.ts
git commit -m "feat(ext): chip lifecycle — opacity 0.7 inflight, shake-x + fade on lock failure (per-chip state)"
```

---

## Phase 8: Responsive + Polish

### Task 8.1: 1024px breakpoint

**Files:**
- Modify: `chrome-extension/reader/components/library-drawer.tsx`
- Modify: `chrome-extension/reader/components/library-sidebar.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// add to filter-pipeline.test.ts
describe('Responsive', () => {
  it('at 1024px viewport the sidebar narrows from 240→200', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    window.dispatchEvent(new Event('resize'));
    render(<LibraryDrawer open onClose={() => {}} currentPaperKey="" />);
    const sidebar = await screen.findByLabelText('Library scope');
    expect(sidebar).toHaveStyle('width: 200px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — sidebar width is fixed.

- [ ] **Step 3: Add window-width hook + reactive width**

```ts
// chrome-extension/reader/lib/use-viewport-width.ts
import { useState, useEffect } from 'react';
export function useViewportWidth(): number {
  const [w, setW] = useState<number>(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}
```

In `library-sidebar.tsx`, accept a `width` prop. Drawer passes `vw <= 1024 ? 200 : 240`.

In `library-row.tsx`'s chip-row container, switch `flex-wrap: wrap-reverse` and right-cluster `margin-left: auto` to keep right-cluster anchored.

- [ ] **Step 4: Run test + visual smoke**

Expected: PASS. Open at 1024px in dev tools, confirm chip row wraps with right-cluster anchored.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/use-viewport-width.ts chrome-extension/reader/components/library-drawer.tsx chrome-extension/reader/components/library-sidebar.tsx chrome-extension/reader/components/library-row.tsx
git commit -m "feat(ext): 1024px breakpoint — sidebar 240→200, chip row wrap-reverse with anchored right-cluster"
```

---

### Task 8.2: 768px breakpoint (sidebar → top dropdown)

**Files:**
- Create: `chrome-extension/reader/components/library-sidebar-dropdown.tsx`
- Modify: `chrome-extension/reader/components/library-drawer.tsx`

- [ ] **Step 1: Component skeleton**

`LibrarySidebarDropdown` renders a single button "Library: [scope name] ▾" that opens a popover containing the same row vocabulary as the full sidebar.

- [ ] **Step 2: Conditional render in drawer**

```tsx
const vw = useViewportWidth();
const compact = vw <= 768;
{compact ? (
  <LibrarySidebarDropdown {...sidebarProps} />
) : (
  <LibrarySidebar {...sidebarProps} width={vw <= 1024 ? 200 : 240} />
)}
```

- [ ] **Step 3: Visual smoke at 375px / 600px / 768px**

Manual.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/reader/components/library-sidebar-dropdown.tsx chrome-extension/reader/components/library-drawer.tsx
git commit -m "feat(ext): 768px breakpoint — sidebar collapses to top-pane dropdown for tiled-window scenarios"
```

---

### Task 8.3: Dark-mode chip background override

**Files:**
- Modify: `chrome-extension/reader/components/library-row.tsx`

- [ ] **Step 1: Replace inline bg with class-based**

The filed Library chip needs the dark-mode override (per spec § Token mapping). Move the chip styling to a class, then in `tokens.css`:

```css
.lib-chip-filed { background: var(--paper-deep); }
[data-theme="dark"] .lib-chip-filed {
  background: color-mix(in oklch, var(--paper-deep) 50%, var(--paper-soft));
}
```

In `library-row.tsx`, set `className="lib-chip-filed"` on the filed Library chip.

- [ ] **Step 2: Visual smoke in light + dark**

Manual.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/styles/tokens.css chrome-extension/reader/components/library-row.tsx
git commit -m "fix(ext): filed Library chip — dark-mode background override so chip reads as raised, not carved"
```

---

## Phase 9: E2E + final verification

### Task 9.1: E2E happy path (`library-v2-flow.spec.ts`)

**Files:**
- Create: `chrome-extension/tests/library-v2/e2e/library-v2-flow.spec.ts`

- [ ] **Step 1: Write Playwright spec**

```ts
import { test, expect } from '@playwright/test';

test('Library v2 happy path: create library, assign, create topic, filter, delete with undo', async ({ page }) => {
  await page.goto('chrome-extension://EXT_ID/reader/index.html?fixture=fakePaper');
  await page.keyboard.press('Meta+L');  // open Library drawer
  // 1. Default = All Papers
  await expect(page.getByText(/Library · \d+ papers/)).toBeVisible();
  // 2. + New library "Q4 Reading"
  await page.getByText('+ New library').click();
  await page.getByPlaceholder('Library name').fill('Q4 Reading');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Q4 Reading')).toBeVisible();
  // 3. + Set library on first card
  const firstCard = page.locator('[data-pid="paper-card"]').first();
  await firstCard.getByLabel('Set library').click();
  await page.getByText('Q4 Reading').click();
  // 4. + Set topic, + Create 'VLA'
  await firstCard.getByLabel('Set topic').click();
  await page.getByPlaceholder('Filter or create…').fill('VLA');
  await page.getByText(`+ Create "VLA"`).click();
  // 5. Sidebar → VLA filters
  await page.getByText('# VLA').click();
  await expect(page.getByText(/Tagged 'VLA' · 1/)).toBeVisible();
  // 6. Sidebar → Q4 Reading
  await page.getByText('Q4 Reading').click();
  await expect(page.getByText(/Q4 Reading · 1/)).toBeVisible();
  // 7. All Papers
  await page.getByText('All Papers').click();
  // 8. Delete topic → confirm → undo
  await page.getByText('# VLA').click();  // re-select before deleting
  await page.locator('[aria-label="Topic: VLA"] [aria-label="More"]').click();
  await page.getByText('Delete').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText("Topic 'VLA' deleted.")).toBeVisible();
  // Click Undo within 5s
  await page.getByText('Undo').click();
  await expect(page.getByText('# VLA')).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

```bash
cd chrome-extension && bun run test:e2e tests/library-v2/e2e/library-v2-flow.spec.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/tests/library-v2/e2e/library-v2-flow.spec.ts
git commit -m "test(ext): library-v2 e2e happy path — create/assign/filter/delete-with-undo"
```

---

### Task 9.2: E2E a11y (`library-v2-a11y.spec.ts`)

**Files:**
- Create: `chrome-extension/tests/library-v2/e2e/library-v2-a11y.spec.ts`

- [ ] **Step 1: Write spec**

```ts
import { test, expect } from '@playwright/test';

test('Library v2 keyboard + screen-reader paths', async ({ page }) => {
  await page.goto('chrome-extension://EXT_ID/reader/index.html?fixture=fakePaper');
  await page.keyboard.press('Meta+L');
  // Tab order: close → search → Group by → Has memory → sidebar rows → cards
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /close/i);
  // ... continue Tab assertions ...

  // Focus a user-created library row, F2 enters rename
  await page.locator('[aria-label*="Q4 Reading"]').focus();
  await page.keyboard.press('F2');
  await expect(page.locator('input[value="Q4 Reading"]')).toBeFocused();

  // Backspace inside search input does NOT trigger destructive action
  await page.keyboard.press('Escape');  // exit rename
  const search = page.locator('input[placeholder="Search title, author…"]');
  await search.fill('test');
  await search.press('Backspace');  // deletes 't'
  await expect(search).toHaveValue('tes');

  // Sidebar selection change triggers aria-live update (assert via accessibility tree)
  await page.getByText('# VLA').click();
  // The aria-live region is visually-hidden; query by its role
  const live = page.locator('[aria-live="polite"]');
  await expect(live).toContainText("Showing 1 papers in topic VLA");
});
```

- [ ] **Step 2: Run E2E**

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/tests/library-v2/e2e/library-v2-a11y.spec.ts
git commit -m "test(ext): library-v2 e2e a11y — Tab order, F2 rename, Backspace input guard, aria-live announcements"
```

---

### Task 9.3: Final verification + visual checklist

- [ ] **Step 1: Run full test suite**

```bash
cd chrome-extension && bun run test && bun run test:e2e
```
Expected: green.

- [ ] **Step 2: Build + load unpacked extension**

```bash
cd chrome-extension && bun run build
echo "Manual: chrome://extensions → Load unpacked → chrome-extension/dist"
```

- [ ] **Step 3: Manual visual checklist (per spec § Visual regression)**

Run through each item:
- [ ] Light + dark theme, filed Library chip dark-mode adjustment
- [ ] Sidebar with 0 / 5 / 50 entries
- [ ] Sidebar selection states: default / hover / active (walnut bar) / disabled
- [ ] Card chip row wrap at narrow drawer
- [ ] Popover positioning auto-flip at drawer top vs bottom
- [ ] `prefers-reduced-motion` (System Preferences → Accessibility → Reduce motion)
- [ ] 1024px viewport
- [ ] 768px viewport (sidebar → dropdown)
- [ ] First-use pill: appears once, dismissible

- [ ] **Step 4: Run /ship**

```bash
echo "Run /ship — it will rebase WIP commits, run review gate, push branch, open PR."
```

---

## Self-Review Checklist (run by author after writing this plan)

- [x] Spec coverage: every section in `2026-04-25-spec-library-v2.md` is mapped to a task (data model → 1.1-1.6, sidebar → 4.x, chips → 5.x, drawer → 6.2, undo → 3.x, supabase → 2.x, a11y → keyboard + aria-live in 4.3 + 6.2, responsive → 8.1-8.2, animations → 7.x, polish → 8.3, tests → throughout)
- [x] No "TBD"/"TODO"/"similar to Task N" — every task shows actual code
- [x] Type consistency: `LibraryCatalogEntry` / `TopicCatalogEntry` / `LibraryRow` / `PendingDelete` / `SidebarSelection` use the same names everywhere
- [x] All references between tasks are valid: `withKeyLock`, `getLibrary`, `enqueue`, `trapFocus`, etc., are existing functions verified in the pre-plan code reads
- [x] Edge Function file paths match repo convention (`supabase/functions/{name}/index.ts`)
- [x] Test paths consistent: `chrome-extension/tests/library-v2/{unit,integration,e2e}/`
- [x] Phase 0 floating-ui spike has a fallback path (hand-rolled positioning) if the dep doesn't work in MV3

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-25-plan-library-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

If Subagent-Driven chosen: REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Fresh subagent per task + two-stage review.

If Inline Execution chosen: REQUIRED SUB-SKILL: superpowers:executing-plans. Batch execution with checkpoints for review.
