# Library v2 — Outline Sidebar + Libraries + Multi-Topic Tags

**Date:** 2026-04-25
**Status:** Spec — pending implementation plan
**Scope:** Chrome extension `LibraryDrawer` UX + storage + Supabase schema

## Summary

Redesign the Library drawer to introduce a left outline sidebar with two
user-managed taxonomies — **Libraries** (single-valued, folder-like) and
**Topics** (multi-valued, tag-like) — replacing today's empty `topic`
field. Each paper belongs to at most one Library and any number of Topics.
The sidebar acts as a scope filter; the existing `Group by Topic | Role |
Recent` segmented control acts as the in-scope sub-grouping. The drawer
widens from `min(880px, 80%)` to `min(1200px, 92%)` to accommodate the new
layout. Standard CRUD (Create / Rename / Delete / Assign / Unassign) is
supported for both taxonomies, with delete confirmation modals.

## Motivation

Today's Library drawer flattens the user's reading collection into a single
list with three group-by axes (Topic / Role / Recent). The `topic` field
exists in `LibraryRow` and the `papers.topic` column exists in Supabase,
but no UI ever populates them — they are always empty. As users accumulate
papers across multiple research threads, they need a real organizational
system: a way to group papers into projects ("Q4 Reading", "Robotics Lit
Review") and a way to tag papers across projects ("VLA", "Multimodal").
This is the standard folder + tag model from Zotero / Mendeley / Notion.

## Decisions

| # | Decision |
|---|---|
| D1 | Multi-Topic per paper (array). |
| D2 | No "Favorites" smart filter in v1 (avoids new schema field). |
| D3 | Two-axis model: 1 Library (single, optional) + N Topics (multi). |
| D4 | Library is optional. Sidebar always shows a permanent "All Papers" anchor at the top of the LIBRARIES section. |
| D5 | Library assignment via single-value chip + dropdown popover on each paper card (mirrors the Topic chip pattern). |
| D6 | Standard CRUD: Create / Rename / Delete / Assign / Unassign. Delete shows a confirmation modal. No reorder or merge in v1. |
| D7 | Sidebar is the scope filter; Group-by is the in-scope sub-grouping. They coexist. |
| D8 | Drawer widens to `min(1200px, 92%)`; `slide-in-right` animation preserved. |
| D9 | Catalog-driven storage: separate `pf:libraries` and `pf:topics` master lists, referenced by id from each `LibraryRow`. |

## Data Model

### New types (`chrome-extension/reader/types.ts`)

```ts
export interface LibraryCatalogEntry {
  id: string;           // crypto.randomUUID()
  name: string;         // user-visible name
  createdAt: number;
}

export interface TopicCatalogEntry {
  id: string;
  name: string;
  createdAt: number;
}
```

### `LibraryRow` field changes

```ts
export interface LibraryRow {
  // unchanged
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

  // removed
  // topic: string;     ← drop. v1 always-empty field; no data loss.

  // added
  libraryId: string | null;   // references pf:libraries entry; null = unfiled
  topicIds: string[];         // references pf:topics entries; [] = no tags
}
```

### Storage keys (`storage-schema.ts`)

```ts
export const LIBRARIES_KEY            = 'pf:libraries';        // LibraryCatalogEntry[]
export const TOPICS_KEY               = 'pf:topics';           // TopicCatalogEntry[]
export const LIB_CATALOG_LOCK_KEY     = 'pf:lock:lib-catalog';
export const TOPIC_CATALOG_LOCK_KEY   = 'pf:lock:topic-catalog';

// UI dismissal state — local-only, NOT cloud-synced, NOT cleared on logout.
// These represent "this device's user has seen this onboarding nudge once."
// Treating them as identity-bound would mean every fresh login re-shows the
// pill and re-runs the migration, which is worse than the alternative.
export const LIBRARY_INTRO_SEEN_KEY   = 'pf:librariesIntroSeen'; // boolean
export const LIBRARY_V2_MIGRATED_KEY  = 'pf:libraryV2Migrated';  // boolean

// Pending destructive operations queue — survives SW restart so the 5s undo
// window doesn't lose its trailing cloud-sync RPC if the user closes the
// drawer / Chrome restarts / SW is evicted. See "Delete Library" / "Delete
// Topic" undo flow below.
export const LIB_PENDING_DELETES_KEY  = 'pf:lib:pendingDeletes';
// Shape: Array<{
//   id: string;            // crypto.randomUUID() for this pending op
//   kind: 'library' | 'topic';
//   deletedEntry: LibraryCatalogEntry | TopicCatalogEntry;
//   affectedRows: Array<{ id: string; prev: { libraryId?: string|null; topicIds?: string[] } }>;
//   commitAt: number;      // ms epoch — fire RPC at this time
//   ts: number;            // ms epoch — when scheduled
// }>
```

`top-bar.tsx`'s `doLogout` should NOT add `LIBRARY_INTRO_SEEN_KEY` or
`LIBRARY_V2_MIGRATED_KEY` to its clear-list — they are device UI state, not
session state. `LIB_PENDING_DELETES_KEY` SHOULD be cleared on logout (any
pending undoes are scoped to the previous user's catalog and shouldn't carry
forward).

### Invariants

1. `LibraryRow.libraryId` is either `null` or matches a live `pf:libraries` entry's `id`.
2. `LibraryRow.topicIds` contains only ids that match live `pf:topics` entries; `[]` means "no Topic" — these papers appear under the "Uncategorized" sidebar smart-filter when one is selected.
3. Names are unique per catalog, compared case-insensitively after `trim()`. `"VLA" / "vla" / " VLA "` collide. Library and Topic namespaces are independent — a Library named "VLA" and a Topic named "VLA" can coexist.
4. Ids are immutable; rename only mutates `name`.

### Derived (computed at render time, not persisted)

- Library row count: `rows.filter(r => r.libraryId === lib.id).length`
- Topic row count: `rows.filter(r => r.topicIds.includes(t.id)).length`
- "All Papers" count: `rows.length`
- "Uncategorized" count: `rows.filter(r => r.libraryId === null).length`

## Sidebar (left 240px)

### Visual structure

```
LIBRARIES
  ● All Papers      12       ← permanent, system, top of section
    Uncategorized    2       ← smart-filter: libraryId === null
    ───                      ← 0.5px rule separating system from user-created
    Q4 Reading       7       ← user-created Library
    Robotics Lit     5

TOPICS
  # VLA              3
  # Multimodal       3
  # Robotics         1

[ + New library  ]
[ + New topic    ]
```

### Selection state

```ts
type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'uncategorized' }
  | { kind: 'library'; id: string }
  | { kind: 'topic'; id: string };
```

Held in `LibraryDrawer` `useState`, **not persisted** — drawer reopen always
resets to `{kind:'all'}`.

### Sidebar row visual states

| State    | Background     | Text color   | Count color  | Accent                                   |
|----------|----------------|--------------|--------------|------------------------------------------|
| Default  | transparent    | `--ink-soft` | `--ink-faded`| (none)                                   |
| Hover    | `--paper-deep` | `--ink`      | `--ink-soft` | (none)                                   |
| Active   | `--paper-deep` | `--ink`      | `--walnut`   | 2px `--walnut` bar on left edge of row   |
| Disabled (mid-rename submit, etc.) | transparent | `--ink-ghost` | `--ink-ghost` | (none) |

- Row height: 28px. Padding: 6px 12px. Gap between glyph/icon and label: 8px.
- The `●` in the visual ASCII above represents the **active-state walnut bar** (a 2px-wide left edge), not a literal bullet glyph. There is no bullet marker in default or hover states.
- "All Papers" and "Uncategorized" rows render the same way as user-created rows; the `+ New` buttons sit below the user-created list with the same row dimensions.
- Transition: `background 120ms ease`. The walnut bar appears instantly on selection (no slide-in animation — selections need to feel synchronous with the click).

### Row interactions (user-created entries only)

- On hover, a `⋯` overflow button appears at row right
- Click `⋯` (or right-click row) → menu:
  - **Rename** — replace label with inline `input`; Enter commits, Esc cancels
  - **Delete** — opens confirmation modal (see CRUD below)
- "All Papers" and "Uncategorized" rows have no menu
- Sort: `createdAt asc` within each section (stable, append-on-create)

### "+ New library / + New topic" buttons

- Click appends an inline `input` row at the bottom of the corresponding section
- Enter validates (trim → non-empty → unique check) → on success, generates id, writes catalog, closes input, selects the new entry
- Esc cancels, input closes; duplicate name shows a 12px inline "Already exists" warning

### First-use teaching pill

The first time the v2 drawer opens after the migration completes (i.e.,
once `libraryV2Migrated === true` and `librariesIntroSeen !== true`),
render a dismissible teaching pill at the very top of the sidebar (above
the LIBRARIES section header):

```
┌────────────────────────────────────┐
│ ✨ NEW                          [×]│
│ Organize papers into libraries     │
│ and tag them with topics.          │
└────────────────────────────────────┘
```

- Background: `--paper-soft`. Border: `0.5px solid var(--rule-soft)`.
- Padding: `10px 12px`. Margin: `0 8px 12px 8px`.
- "NEW" badge: `--font-mono` 9px uppercase tracking `0.08em`, color `--walnut`.
- Body copy: `--font-serif` 12px italic, color `--ink-soft`, line-height `1.5`.
- Close `×`: 12px icon, `--ink-faded`, `icon-btn` styles.
- On dismiss → write `librariesIntroSeen: true` to `chrome.storage.local`. Never shown again.
- Sync key: not synced. Per-device dismissal is the simplest correct behavior.

## Main Pane

### Layout (within the 1200px drawer)

```
┌── 240 ──┬───────────────── ~960 ─────────────────┐
│ Sidebar │  Library · {N} papers              [×]  │
│         │  ─────────────────────────────────────  │
│         │  [LibraryCapBanner — free over-cap]     │
│         │  ─────────────────────────────────────  │
│         │  [🔍 Search...]  Group by [...]   ☐ Has memory │
│         │  ─────────────────────────────────────  │
│         │  GROUP HEADER · count                   │
│         │  ┌─ paper card ──────────────────────┐  │
└─────────┴─────────────────────────────────────────┘
```

### Filter pipeline

```
allRows
  → SidebarSelection scope filter
  → search query filter (title, authors, library name, topic names)
  → memoryOnly filter
  → groupBy bucketing
  → render
```

**Scope filter:**
- `{kind:'all'}` — no filter
- `{kind:'uncategorized'}` — `r.libraryId === null`
- `{kind:'library', id}` — `r.libraryId === id`
- `{kind:'topic', id}` — `r.topicIds.includes(id)`

### Group-by behaviour

| Group-by | Bucket key | Notes |
|---|---|---|
| `Topic` | Each row is **expanded** into one entry per `topicIds[i]`; rows with `topicIds.length === 0` go into a single "Uncategorized" bucket. A multi-Topic paper appears once in each Topic bucket — intentional. |
| `Role` | `r.role || 'Uncategorized'` (unchanged from today). |
| `Recent` | All rows in `'Recently opened'` bucket, sorted by `lastRead desc`. |

**Multi-Topic disambiguation when grouped by Topic.** A paper appearing in
multiple Topic buckets needs to be visually marked as "the same paper, also
shown elsewhere" — otherwise users read it as duplicate data. Approach:

- The card's first appearance (the bucket whose Topic comes first in
  `paper.topicIds`) renders normally.
- Subsequent appearances render normally PLUS a small one-line annotation
  above the chip row: `Also in: {otherTopicNames.join(' · ')}`
- Typography: `var(--font-mono)` 9px tracking `0.04em`, color `--ink-faded`,
  margin `4px 0 8px 6px` (after the spine).
- The annotation lists the OTHER Topics this paper is in (excluding the
  current bucket). Cap at 3 names + `+N more` if more than 4 total.
- This makes the multi-bucket relationship legible without duplicating
  the data; the card visual itself stays unchanged.

### Header total

The header's title varies by `SidebarSelection` so the main pane self-orients (Krug's "Where am I?"):

| Selection           | Header title                  |
|---------------------|-------------------------------|
| `kind: 'all'`       | `Library · {N} papers`        |
| `kind: 'uncategorized'` | `Uncategorized · {N}`     |
| `kind: 'library'`   | `{libraryName} · {N}`         |
| `kind: 'topic'`     | `Tagged '{topicName}' · {N}`  |

Counts reflect the **visible scope**, not the global library size. Typography:
`var(--font-serif)` 18px weight 600 (matches today's drawer header). The name
itself uses `--ink`; the ` · {N}` suffix uses `--ink-faded`. Long names
ellipsis-truncate at the available width with no tooltip (full name is also
visible in the active sidebar row).

### Search scope

Extended from today's `title` + `authors` to also include the resolved
`library name` and `topic names`. Implementation: build a per-row
`searchHaystack` string in `useMemo` after id-to-name resolution; search
runs `includes` on the haystack.

### Empty states

| Scenario | Copy |
|---|---|
| Whole library empty | "Open a paper to start your library." |
| Selected Library has 0 papers | "No papers in this library yet." |
| Selected Topic has 0 papers | "No papers tagged with this topic yet." |
| Uncategorized has 0 papers | "No uncategorized papers." |
| Search / Has memory filtered out everything | "No papers match your filters." |

## Card Visual

### Element ordering (top to bottom, single card)

```
┌─ Paper card ─────────────────────────────────────────────────┐
│ ┃ Title                                       ⓘ {annotations}│
│ ┃ Authors · {pages}p · {when}                                │
│ ┃ "judgment quote"                                           │
│ ┃                                                            │
│ ┃ [📁 Library: Q4 Reading ▾] [VLA] [Robotics] [+ Set topic ▾]│
│ ┃                                          [Reviewer] [🧠]    │
└──────────────────────────────────────────────────────────────┘
   ↑ spine: walnut-deep if current, else ROLE_COLORS[role]
```

### Glyph system note

The visual ASCII in this spec uses emoji shorthand (📁 ✨ 🔍 🧠) for
readability. **Implementation must use SVG icons from `components/icons.tsx`,
not literal emoji characters.** Mixing emoji with the existing SVG icon
vocabulary (already in `library-row.tsx`, `library-cap-banner.tsx`, etc.)
would fragment the visual system, fail dark-mode color theming (emoji can't
inherit `var(--ink)`), and render inconsistently across OS emoji fonts.

| Spec shorthand | Implementation                              | Notes |
|----------------|---------------------------------------------|-------|
| 📁             | `<I.Folder size={11} stroke={1.4} />`       | Add to `icons.tsx` if missing — outline folder, walnut-tinted when filed |
| 🔍             | `<I.Search size={12} stroke={1.4} />`       | Already exists |
| 🧠             | `<I.Memory size={12} stroke={1.4} />`       | Already exists |
| ✨             | `<I.Sparkle size={11} stroke={1.4} />`      | Add to `icons.tsx` — 4-point sparkle, walnut |
| ▾              | `<I.ChevronDown size={9} stroke={1.5} />`   | Add to `icons.tsx` if missing — used as popover affordance |
| ×              | `<I.Close size={9} stroke={1.5} />`         | Already exists; for chip-hover unassign |
| ⋯              | `<I.More size={12} stroke={1.5} />`         | Add if missing — sidebar row overflow menu |

All glyph implementations inherit `currentColor` so they theme correctly.
Stroke widths follow the existing 1.4 (decorative) / 1.5 (functional)
convention from `outline-panel.tsx` and `library-row.tsx`.

### Chip row (left to right)

1. **Library chip** (single-valued + dropdown):
   - Filed: `[I.Folder] Library: {name} [I.ChevronDown]` with `--paper-deep` background, `0.5px var(--rule)` border
   - Unfiled: `📁 + Set library ▾` with dashed `--ink-faded` border (lighter visual weight)
   - Always visible — provides a discoverable entry to assign
2. **Topic chips** (multi-valued, one per assigned Topic):
   - `× ` button revealed on chip hover for fast unassign of that single Topic
   - Background: `color-mix(in oklch, var(--walnut) 8%, transparent)`
3. **`+ Set topic ▾`** chip — dashed border, opens multi-select popover
4. (right-aligned) existing role chip + memory icon + annotation count

### Library popover (single-select)

```
┌──────────────────────────────┐
│ 🔍 Filter or create…         │
├──────────────────────────────┤
│ — None —                     │
│ Q4 Reading              ✓    │
│ Robotics Lit                 │
│ ─────                        │
│ + Create "RAG Notes"         │
└──────────────────────────────┘
```

- Single-select; selecting commits and closes
- "+ Create" appears when typed text doesn't match any existing entry
- Created Library is added to catalog and immediately assigned to the paper

### Topic popover (multi-select)

```
┌──────────────────────────────┐
│ 🔍 Filter or create…         │
├──────────────────────────────┤
│ ☑ VLA                        │
│ ☑ Robotics                   │
│ ☐ Multimodal                 │
│ ─────                        │
│ + Create "Benchmark"         │
└──────────────────────────────┘
```

- Multi-select; toggling a checkbox commits immediately (no "Apply" button)
- Closes on outside click or Esc
- Created Topic is auto-checked and the popover closes

### Popover positioning (both Library + Topic)

Popovers float from their trigger chip with `auto-flip` placement:

- **Vertical:** default below the trigger with `4px` offset. On open, measure
  available space below trigger within the drawer scroll-container. If
  `available_below < popover.height + 8px` (popover default ~240px tall),
  flip above with the same offset. No mid-flight re-flip on scroll.
- **Horizontal:** anchor to the trigger's left edge. Right edge is bounded
  by `drawer.right - 8px` (popover shifts left if it would spill). Wide
  drawer + leftmost chip anchor → spillover never happens in practice.
- **Implementation:** the codebase doesn't have floating-ui yet; either add
  `@floating-ui/react-dom` (~5kB gzipped) for `useFloating({ middleware: [flip(), shift()] })`
  or hand-roll ~30 lines of `useEffect` measuring `getBoundingClientRect`
  on open + `ResizeObserver`. Prefer floating-ui — the feature set
  (autoUpdate, virtual-element anchoring) will be reused by future
  popovers (CmdK suggestions, account menu refresh).
- **Close triggers:** outside-click, Esc, and any document-level scroll
  outside the popover (prevents stale anchor when the user scrolls the
  card list under an open popover).

### Token mapping

| Element | font | size | color | bg | border |
|---|---|---|---|---|---|
| Library chip (filed) | `--font-mono` | 10 | `--ink` | `--paper-deep` | `0.5px var(--rule)` |
| Library chip (unfiled) | `--font-mono` | 10 | `--ink-faded` | none | `0.5px dashed var(--ink-ghost)` |
| Topic chip | `--font-mono` | 10 | `--ink-soft` | `color-mix(in oklch, var(--walnut) 8%, transparent)` | `0.5px var(--rule)` |
| `+ Set topic` chip | `--font-mono` | 10 | `--ink-faded` | none | `0.5px dashed var(--ink-ghost)` |

**Dark-mode adjustment.** In `[data-theme="dark"]`, the filed Library chip's
background `--paper-deep` is darker than the card background `--paper-soft` —
the chip would read as a hole carved INTO the card rather than a tile placed
ON it. Override the filed chip bg in dark mode to
`color-mix(in oklch, var(--paper-deep) 50%, var(--paper-soft))` so it reads
as raised. All other tokens theme correctly via `var(--*)` inheritance.

**`Seg` segmented control reuse.** The existing `Seg` inline component in
`library-drawer.tsx:189` powers the `Group by Topic | Role | Recent`
control today and stays as-is. The new sidebar's scope filter pipes into
the same `groupBy` state — no `Seg` refactor.

The "current paper" `NOW` badge / `--walnut-soft` border behavior is unchanged.

## CRUD Lifecycle

All write operations follow this template:

```
1. Optimistically update React state
2. withKeyLock(...): write local storage
3. enqueue cloud sync (failures don't bubble)
4. On step-2 failure: roll back state + Toast "Couldn't save. Please retry."
```

### Create

Triggers: sidebar "+ New" buttons; `+ Create` rows in card popovers.

- Validate trim, non-empty, case-insensitive uniqueness
- `id = crypto.randomUUID()`
- `withKeyLock(LIB_CATALOG_LOCK_KEY | TOPIC_CATALOG_LOCK_KEY)`: re-check uniqueness, append to catalog, write back
- If invoked from a popover, also assign on the current paper's `LibraryRow`. **Sidebar selection does not change** — the user is operating on a paper card, not navigating the sidebar.
- If invoked from the sidebar `+ New` button, sidebar selection switches to the new entry.

### Rename

Trigger: sidebar row `⋯` → Rename.

- Inline input replaces label, prefilled, all-selected
- Enter commits; trim; if equals old name, silently close (no write); if duplicate, red border, no close
- `withKeyLock`: replace catalog entry's `name`
- Sidebar rows and card chips re-render automatically (id-to-name resolved at render time)

### Delete Library

Trigger: sidebar row `⋯` → Delete.

Confirmation modal:
> Delete library 'Q4 Reading'?
> 7 papers will move to Uncategorized.
> [Cancel]  [Delete]

(Note: copy no longer says "This cannot be undone." — the 5-second undo Toast
below softens that claim. After undo expires, it IS irreversible.)

On confirm:
1. **Persist a pending-delete entry** to `LIB_PENDING_DELETES_KEY` (under `withKeyLock`):
   ```ts
   { id: crypto.randomUUID(), kind: 'library',
     deletedEntry, affectedRows,
     commitAt: Date.now() + 5000, ts: Date.now() }
   ```
   `affectedRows` is `rows.filter(r => r.libraryId === deletedId).map(r => ({ id: r.id, prev: { libraryId: deletedId } }))`.
2. `withKeyLock(LIB_CATALOG_LOCK_KEY)`: remove from catalog
3. `withKeyLock(LIB_LOCK_KEY)`: rewrite all `LibraryRow` with `libraryId === deletedId` → `libraryId: null`
4. Show undo Toast `"Library 'Q4 Reading' deleted. [Undo]"` with `5000ms` auto-dismiss
5. UI: sidebar row gone; if `SidebarSelection` was on this id, switch to `{kind:'all'}`; affected cards' Library chip reverts to "+ Set library"

**Pending-delete commit loop** (runs in `LibraryDrawer` or a small singleton hook):

- A 1-second `setInterval` checks `LIB_PENDING_DELETES_KEY`. For each entry where `Date.now() >= commitAt`:
  - Enqueue the cloud sync (catalog delete RPC + papers row updates) on `sync-queue`.
  - Remove the pending entry under `withKeyLock`.
- The interval also runs **once on app startup / drawer open / SW wake** so a long-elapsed pending entry commits immediately (e.g., user closed Chrome for an hour — on next open, RPC fires).
- The local mutation (catalog row gone, affected paper rows updated) is already applied; this loop only commits the trailing cloud RPC.
- This is what makes the undo robust to SW eviction: setTimeout in component state can vanish; `chrome.storage.local` can't.

**Undo flow** (user clicks Undo within 5s):
1. `withKeyLock(LIB_PENDING_DELETES_KEY)`: remove the matching pending entry (by its id) — this is the cancel.
2. `withKeyLock(LIB_CATALOG_LOCK_KEY)`: re-insert `deletedEntry` **with its original id** (preserves stale React closure references and other tabs' in-flight reads).
3. `withKeyLock(LIB_LOCK_KEY)`: for each `affectedRow`, restore `libraryId = prev.libraryId`.
4. Toast dismisses; sidebar row re-appears with fade-up; chips on affected cards re-appear. No cloud RPC fires (pending entry was cancelled before commit).

**Race rules:**
- If user triggers a second destructive action while a pending-delete is live, the second op writes its own pending entry. They proceed independently — both commit when their `commitAt` fires. No "collapse on second action" complexity needed; the persisted queue makes them commutative.
- If two tabs each schedule a pending-delete, both write to the same key. `withKeyLock` serializes the array writes; both pending entries coexist; both commit at their respective `commitAt`. No data races.

### Delete Topic

Trigger: sidebar row `⋯` → Delete.

Confirmation modal:
> Delete topic 'VLA'?
> It will be removed from 3 papers.
> [Cancel]  [Delete]

On confirm: identical pattern to Delete Library, using the same persisted
pending-delete queue (`LIB_PENDING_DELETES_KEY`).

1. Persist pending entry: `{ kind: 'topic', deletedEntry, affectedRows, commitAt: Date.now()+5000 }`.
   - `affectedRows = rows.filter(r => r.topicIds.includes(deletedId)).map(r => ({id: r.id, prev: { topicIds: r.topicIds }}))` — store full prev `topicIds` array so the topic restores in its original position among other tags.
2. `withKeyLock(TOPIC_CATALOG_LOCK_KEY)`: remove from catalog.
3. `withKeyLock(LIB_LOCK_KEY)`: rewrite all `LibraryRow` to `topicIds.filter(id => id !== deletedId)`.
4. Show undo Toast `"Topic 'VLA' deleted. [Undo]"` with `5000ms` auto-dismiss.
5. UI: sidebar row gone; if `SidebarSelection` was on this id, switch to `{kind:'all'}`; affected card chips for that Topic disappear.

The same pending-delete commit loop (1s interval; runs on startup/wake) commits the cloud RPC at `commitAt`.

**Undo:** remove the pending entry; re-insert `deletedEntry` by id; restore each affected row's full `prev.topicIds`.

### Assign / Unassign

Library re-file: card chip popover writes `libraryId = newId | null`.
Topic toggle: write `topicIds = [...prev, id]` or `prev.filter(x => x !== id)`.
Hover-`×` on a Topic chip: unassign-single shortcut (equivalent to popover toggle off).

### Confirm modal

Build a small reusable `confirm-modal.tsx` (Cancel + danger-action two-button)
based on the existing `conflict-modal.tsx` template. Don't reuse
`conflict-modal` directly — that one is semantically tied to migration
conflicts; mixing it would muddy intent.

### Input bounds

- Name `maxLength` 64
- Whitespace-only names rejected
- Trailing/leading spaces trimmed; interior whitespace preserved
- Sidebar row ellipsis-truncates at `max-width: 160px`; tooltip shows full name

## Interaction States

The CRUD lifecycle template (above) describes *data flow*. This section
specifies the *visual* treatment of every transient state the user sees.
The principle: optimistic UI must always make its optimism legible —
never silently snap back, never freeze without indication.

### Catalog pull (sidebar load on drawer open)

- Local catalog is read **synchronously** from `chrome.storage.local` and
  rendered immediately — the sidebar is never blank. The drawer opens with
  the last-known catalog visible in 0ms.
- Cloud reconcile happens in the background. If it returns a delta
  (added / renamed / deleted by another device), apply silently — no flash,
  no skeleton. Newly-discovered rows fade-in with `fade-up 220ms`; deleted
  rows fade-out with `opacity 200ms` then collapse height `180ms`.
- If the cloud fetch fails (offline / 4xx / 5xx), do nothing. Local is the
  source of truth at present. No error toast (the user isn't trying to do
  anything here — surfacing this is noise).

### Optimistic write — success vs failure

All writes (create, rename, delete, assign, unassign) follow the same visual
contract:

| Phase                | Visual                                                                   |
|----------------------|--------------------------------------------------------------------------|
| Optimistic (in flight, before lock returns) | The new state is shown at `opacity: 0.7`. No spinner — the slight fade is the only signal. |
| Confirmed (lock + cloud both succeed) | `opacity: 1` (transition `200ms ease`). No celebration; this is the steady state. |
| Failed (lock returns error) | The optimistic element runs the `shake-x` keyframe (320ms), then fades out (`opacity 200ms`). Toast `"Couldn't save. Please retry."` appears in the same animation frame. |

The `shake-x` keyframe goes in `styles/tokens.css` alongside existing animations
(`paragraph-ping`, `margin-note-in`, `slide-in-right`, etc.) — not inline in the
chip component:

```css
@keyframes shake-x {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-2px); }
  40%, 80% { transform: translateX(2px); }
}
.shake-x { animation: shake-x 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@media (prefers-reduced-motion: reduce) {
  .shake-x { animation: none; }
}
```

- Rationale: the user sees "the thing moved → the thing wasn't right" rather
  than "the thing vanished from underneath me." Loss-aversion cognition
  needs the system to acknowledge the failure visually, not just textually.
- Sync queue failures (cloud succeeds asynchronously after the local write)
  are silent — the queue retries on online / SW startup as today.

### Inline rename input

- On `Enter`: input becomes `readonly`, opacity 0.7, with a 12px `shimmer-line`
  appended at the right. The walnut bar (active state) stays.
- On success: shimmer removed, opacity 1, input collapses back to a label.
- On failure (lock conflict / sync error): `border-color: var(--foxglove)`
  for `1.6s`, input re-enables for editing, original failed text preserved
  for the user to amend.
- 1000ms grace: if the lock takes longer than 1000ms (rare), Toast
  `"Saving…"` appears. This is an escape hatch — the lock should normally
  return in <100ms.

### Catalog `+ New library / + New topic` input

- Same as inline rename: Enter → readonly + shimmer; success → row appears
  in active selection; duplicate name → red border + 12px inline
  `"Already exists"` warning (today's spec, retained), input re-enables.

### Topic / Library popover — empty catalog

- If the catalog is empty when the user opens a popover from a card, show:
  - 🔍 Filter input (focused)
  - Body: italic serif copy `"Type to create your first topic"` (or `library`),
    `--ink-faded`, padded `18px 14px`.
  - No "+ Create" footer until the user types — once non-empty, the
    `+ Create "{typed}"` row appears at the bottom.
- This onboards users to the catalog-driven model on the first card-side
  interaction without dragging them to the sidebar.

### Topic popover — concurrent toggles

- Each checkbox toggle is **independently optimistic**. Toggling A then B
  before A's lock returns produces two writes-in-flight; each shows
  `opacity: 0.7` on its own checkbox + on the corresponding card chip.
- If A succeeds and B fails: A's chip stays at opacity 1, B's chip shakes
  and fades out, B's checkbox flips back to ☐. Toast for B only.
- The popover itself does NOT close until the user clicks outside or presses
  Esc — this preserves multi-select intent during slow networks.

### Confirm modal — delete in flight

- Delete button label changes to `"Deleting…"` and goes `disabled`. Cancel
  button stays enabled (cancel here aborts the modal but cannot rescind a
  committed lock — this is OK; the modal just closes).
- Esc and backdrop-click are **disabled** while the RPC is in flight, so
  the user can't accidentally dismiss mid-write.
- On success: modal slides out (200ms), sidebar row gone, scope reset to
  `{kind:'all'}` if affected.
- On failure: modal stays open. Delete button re-enables. Inline error
  below the modal body in `--foxglove`: `"Couldn't delete. Please retry."`
  Esc / backdrop-click re-enabled.

### Card chip row — post-rollback

- After a failed assignment that snapped back, the chip row reflows to the
  `prev` state (Library: dashed `+ Set library`; Topic: chip removed). The
  reflow uses `200ms` width transition to avoid janky snap.

## Cloud Sync

### Schema (`supabase/migrations/006_libraries_topics.sql`)

```sql
create table libraries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index on libraries (user_id, created_at);

create table topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index on topics (user_id, created_at);

alter table papers drop column topic;
alter table papers
  add column library_id uuid references libraries(id) on delete set null,
  add column topic_ids  uuid[] not null default '{}';
create index on papers (user_id, library_id);
create index on papers using gin (topic_ids);
```

Notes:
- `library_id` `on delete set null` — server-side fallback if the
  client-side rewrite of paper rows fails to land before the catalog
  delete.
- Topic deletion has no FK cascade (PostgreSQL doesn't enforce array
  references). Cleanup is done atomically inside the `delete-topic`
  Edge Function.

### RLS

```sql
alter table libraries enable row level security;
create policy "user owns libraries" on libraries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table topics enable row level security;
create policy "user owns topics" on topics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### Sync queue extensions (`sync-queue.ts`)

Add op kinds:

```ts
{ table: 'libraries', op: 'upsert', row: {...}, ts }     // create / rename
{ table: 'topics',    op: 'upsert', row: {...}, ts }
{ kind: 'rpc', fn: 'delete-library', args: { id }, ts }  // atomic catalog+rows
{ kind: 'rpc', fn: 'delete-topic',   args: { id }, ts }
{ table: 'papers', op: 'upsert', row: {..., library_id, topic_ids}, ts }  // existing path, new fields
```

### Edge Functions

```
supabase/functions/
├── delete-library/    # service-role: delete catalog row + rely on FK to null library_id
└── delete-topic/      # service-role: delete catalog row + array_remove on all papers in tx
```

Both follow existing `_shared/auth.ts` + `clients.ts` patterns.

### One-time migration (`libraryV2Migrated` flag)

On first drawer open after upgrade:

1. Read all `LibraryRow`s
2. For any row with the old non-empty `topic: string` (defensive — spec says always empty), insert that name into the topics catalog (deduped) and set `topicIds: [newId]`
3. Default `libraryId: null`, `topicIds: []` for any row missing the new fields
4. Set `libraryV2Migrated: true` to skip on subsequent opens

This is a no-op for the realistic case (everyone has empty `topic`).

### Realtime

Not subscribed for catalogs in v1 — personal library, no concurrent multi-end editing pressure. Catalogs are pulled at app startup and on drawer open.

### BYOK / offline

No change. Sync queue is a no-op when unauthenticated. Local catalogs and `LibraryRow` fields work fully via `chrome.storage.local`.

## Error Handling & Edge Cases

### Sanitize on read

On app startup and drawer open:
- Read catalogs and rows
- For each row: if `libraryId` is non-null but missing from catalog → reset to `null`; filter `topicIds` to only ids that exist in the catalog
- Write back if any change

### Concurrency

| Scenario | Handling |
|---|---|
| Modal-pending Delete races with another tab's catalog refresh | `withKeyLock` re-reads catalog at commit; missing entry → silent close (idempotent no-op) |
| Popover-selected entry is deleted in another tab during selection | Sanitize on next render clears the row's stale id |
| Two ends rename the same entry concurrently | last-write-wins by `ts` (existing `sync-queue` semantics) |

### Storage failures

Optimistic UI update → on local write failure, roll back React state + Toast `"Couldn't save. Please retry."` Sync enqueue failures are silent (queue retries on online / SW startup).

### Input edges

| Edge | Behavior |
|---|---|
| 0 libraries | LIBRARIES section shows just All Papers + Uncategorized; "+ New library" visible |
| 0 topics | TOPICS section header hidden; "+ New topic" visible |
| 50+ topics | Sidebar scrolls; no folding/search in v1 |
| 20+ topics on one paper | Card chip row wraps; no truncation |
| Long names (theoretically >64) | `maxLength=64` on inputs; legacy values truncated to 64 in display |

### Free-tier cap

Catalog entries are unbounded (small metadata). Cap behavior unchanged — it counts only `papers` rows.

## Performance

- Build a `Map<id, name>` for libraries and topics in `useMemo`; resolve in O(1) at render
- Search haystack pre-built in `useMemo` (rebuild only when rows / catalogs change)
- Sidebar counts derived from `filtered` list; no extra catalog walk

## Responsive Breakpoints

The drawer's `min(1200px, 92%)` covers desktop and large laptop. Two
explicit breakpoints handle smaller windows (Chrome extension users on
small monitors or tiled-window setups):

### Breakpoint 1 — `viewport ≤ 1024px` (compact-desktop)

- Drawer width unchanged: `min(1200px, 92%)` → effective ~942px at 1024 viewport.
- Sidebar narrows from `240px` → `200px`. Counts ellipsis-truncate at 28px.
- Sidebar row max-width for names: `120px` (was `160px`).
- Card chip row wraps to a second row inside the chip cluster, BUT the
  right-aligned cluster (role chip + memory + annotations) stays anchored
  on the first row's right edge. Achieved with `flex-wrap: wrap-reverse`
  on the chip container + `margin-left: auto` on the right cluster.
- Header total typography unchanged.

### Breakpoint 2 — `viewport ≤ 768px` (degraded fallback)

Chrome extension is technically desktop, but tiled windows and
half-screen splits land here. We do not pretend this is mobile; we just
keep it usable.

- Drawer width: `100%` (full viewport, slide-in-right preserved).
- Sidebar collapses into a top-pane dropdown:
  ```
  Library: [All Papers ▾]    [×]
  ```
  Click → popover with the same row vocabulary (LIBRARIES section, hairline,
  TOPICS section, +New entries). Selection commits and closes the popover.
- Main pane occupies full width.
- The top dropdown is the only navigation; sidebar `+ New` buttons live
  inside the popover at the bottom of each section.
- This is a degraded-fallback layout, not a designed mobile experience.
  Tests at this breakpoint are visual-checklist only.

## Accessibility

### Existing baseline (preserved)

- Sidebar rows: `role="button"`, keyboard-actionable (Enter/Space)
- Popovers: dialog semantics, Esc to close, focus trap on open
- Inline rename inputs auto-focus
- Confirm modal initial focus is on Cancel (prevents accidental delete) — matches existing `conflict-modal` behavior

### Keyboard paths (new — closes hover-only gaps)

- **Sidebar row focused** (user-created entries only): `F2` enters rename mode (equivalent to `⋯` → Rename). `Backspace` or `Delete` opens the confirm modal (equivalent to `⋯` → Delete). The `⋯` glyph stays visible (not hover-only) so mouse users see the same affordance — drop the "appears on hover" rule.
- **Topic chip on a card focused**: `Backspace` or `Delete` unassigns that single Topic (equivalent to hover-`×`). `:focus-visible` reveals the `×` glyph so mouse users navigating with Tab see the affordance.
- **Library chip focused**: `Enter` or `Space` opens the Library popover (same as click).
- **`+ Set topic` chip focused**: `Enter` opens the Topic popover.

**Input-field guard.** All keybindings above MUST early-return when `event.target` is an `<input>`, `<textarea>`, or has `[contenteditable]`. Backspace inside the search input, the inline rename input, or a popover's filter input must edit text, never trigger destructive shortcuts. Implement once via a helper:
```ts
function isEditingInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}
```
Use this guard at the top of every keydown handler in this drawer.

### Tab order

Reading order top-to-bottom, left-to-right within each surface:

1. Drawer header: close `×`
2. Toolbar: search input → `Group by` segmented control → `Has memory` checkbox
3. Sidebar: All Papers → Uncategorized → each Library (top to bottom) → each Topic → `+ New library` → `+ New topic`
4. Main pane: each card top-to-bottom; within a card: title → Library chip → each Topic chip → `+ Set topic` → role chip → memory icon → annotation count
5. Group headers are NOT in the tab order (decorative)

### Confirm modal tab order

Cancel → Delete (matches visual left-to-right). Reverse-Tab from Delete returns to Cancel. Initial focus is Cancel.

### Screen reader announcements

- Drawer container: `role="dialog"` `aria-label="Library"` `aria-modal="true"`.
- Sidebar row: `aria-label` = `"{name}, {count} papers"` (e.g., `"Q4 Reading, 7 papers"`); `aria-current="true"` when active.
- Main pane has an `aria-live="polite"` region (visually-hidden) that announces scope changes: `"Showing {N} papers in {scopeName}"` on `SidebarSelection` change. Debounced 150ms to avoid stutter when the user clicks rapidly. Implementation: `useRef<number | null>(null)` for the timer + `useEffect` cleanup `clearTimeout(timerRef.current)` on unmount AND on every selection change before re-arming. Don't use a debounce HOF — the timer needs unmount cleanup that hooks-based libraries often miss for screen-reader regions.
- Card chip row: each chip is a `<button>` with `aria-label` = `"Library: {name}"` / `"Topic: {name}, click to remove"` / `"Set library"` / `"Set topic"`.

### Touch targets

Sidebar rows are 28px tall (matches existing OutlinePanel rows). The `⋯` glyph hit area is `24x28px` to give thumb/touchpad some slack. The `+ New` buttons are `32px` tall — they're action affordances, slightly bigger than nav rows.

## Testing

### Unit (`tests/unit/library-v2/`)

- `catalog-ops.test.ts` — create/rename/delete for both taxonomies; `withKeyLock` concurrency
- `sanitize.test.ts` — orphan id cleanup; no false positives
- `filter-pipeline.test.ts` — `SidebarSelection` scopes; `Group by Topic` row-expansion; multi-condition compositions; search across name spaces
- `name-validation.test.ts` — trim, case-insensitivity, length bound
- **`pending-deletes.test.ts`** — undo-queue lifecycle: scheduled commit fires after `commitAt`; undo cancels before commit; pending entry survives module-reload (simulates SW restart) and commits on next tick; concurrent deletes coexist; logout clears `LIB_PENDING_DELETES_KEY`. **Regression-class** — these are the paths SW eviction breaks if not tested.
- **`optimistic-ui.test.ts`** — three-phase chip lifecycle (opacity 0.7 → 1 on success / shake-x + fade on lock failure); independent in-flight Topic toggles (A/B both pending; A succeeds, B fails → A confirmed, B reverts only).
- **`first-use-pill.test.ts`** — renders when `libraryV2Migrated && !librariesIntroSeen`; dismiss writes `librariesIntroSeen: true`; never re-renders after dismiss across drawer reopens.
- **`multi-topic-buckets.test.ts`** — paper with 1 topic appears once; paper with 3 topics appears in 3 buckets, first bucket has no annotation, subsequent buckets show `Also in: …` with the OTHER topic names; cap at 3 + `+N more` for 4+ topics.
- **`header-copy.test.ts`** — header title for each `SidebarSelection` variant; long-name ellipsis behavior at constrained widths.
- **`keyboard-shortcuts.test.ts`** — sidebar row F2/Backspace/Delete; Topic chip Backspace/Delete; **Backspace inside `<input>` does NOT trigger destructive action** (regression-class — guards against the input-field-guard helper being removed).

### Integration (`tests/integration/library-v2.test.ts`)

Local Supabase instance. Cases:

- Initial catalog pull on login
- Create → catalog row, unique constraint
- Rename → upsert + `updated_at`
- Delete library Edge Function → catalog row gone, `library_id` set null on affected papers
- Delete topic Edge Function → catalog row gone, `array_remove` applied across all papers
- Multi-paper / multi-topic delete cleanup
- Offline queue drain on online event
- `topic_ids` query uses GIN index (EXPLAIN check)
- **Undo flow trailing RPC** (`tests/integration/undo-flow.test.ts`): persisted pending-delete commits the catalog delete RPC + paper-row updates only after `commitAt`; an undo before `commitAt` produces zero RPCs against the cloud; a SW restart simulation (kill the in-memory timer; reload the queue from `chrome.storage.local`) commits on next tick. Validates the design-review-introduced deferred-sync semantics end-to-end.
- **Migration flow** (`tests/integration/migration-flow.test.ts`): `libraryV2Migrated` flag gates the one-time migration; legacy `topic: string` rows get migrated into the topics catalog; flag set to `true` after first run; subsequent drawer opens skip migration.

### E2E (Playwright, one new spec)

`library-v2-flow.spec.ts` — single happy-path:

1. Open Library → default `All Papers`
2. Sidebar "+ New library" → "Q4 Reading" → appears
3. Card "+ Set library ▾" → pick "Q4 Reading"
4. Card "+ Set topic ▾" → "+ Create 'VLA'"
5. Sidebar selects "VLA" → main pane filters
6. Sidebar selects "Q4 Reading" → main pane filters
7. Sidebar selects "All Papers" → main pane unfiltered
8. Delete topic "VLA" → confirm → chip + sidebar row gone
9. Delete library "Q4 Reading" → confirm → chip reverts to "+ Set library"

Branches (rename, validation, cancel, sanitize) covered by unit tests.

`library-v2-a11y.spec.ts` — accessibility happy-path (covers keyboard + screen-reader paths added by the design review):

1. Tab through drawer in declared order: close button → search → Group by Seg → Has memory → sidebar rows (top to bottom) → `+ New library` → `+ New topic` → first card → in-card chip order
2. Focus a user-created sidebar row → press F2 → input enters rename mode with text selected
3. Same row → press Backspace → confirm modal opens with focus on Cancel
4. Confirm modal Tab → Delete is the next focusable element; Reverse-Tab returns to Cancel
5. Type in search input → press Backspace → text deletes (regression: input-field guard works)
6. Sidebar selection change → assert `aria-live` region content updates with `"Showing N papers in {scope}"` after debounce window

### Visual regression

Manual checklist (no tooling in v1):
- Light + dark theme (filed Library chip dark-mode adjustment per spec § Token mapping)
- Sidebar with 0 / 5 / 50 entries
- Sidebar selection states: default / hover / active (walnut bar) / disabled
- Card chip row wrap at narrow drawer
- Popover positioning auto-flip at drawer top vs bottom
- `prefers-reduced-motion`: shake-x animation disabled, fade transitions kept
- 1024px viewport: sidebar narrows to 200px, chip row wrap-reverse with right-cluster anchored
- 768px viewport: sidebar collapses to top dropdown
- First-use pill: appears post-migration, dismissible, never reappears

### Reused infrastructure

All new tests live in the existing `chrome-extension/tests/` tree (see
project memory: `feedback_test_infra.md`).

## Out of Scope (deferred)

### v1.1 — first follow-up cycle

- **Bulk assignment** — shift-click multi-select on cards; multi-selected cards reveal a sticky bulk-action bar (Library + Topic dropdowns) above the group header. **This is the #1 v1.1 feature** — Pass 3 of the design review identified that filing 30 papers requires 60 popover dances in v1, which is the heaviest source of friction the v1 shipping experience will produce. Do not let v1.1 deprioritize it.
- Drag a card onto a sidebar entry to assign (sub-feature of the above)

### Later

- Favorites smart filter (and corresponding `favorited` field)
- "NEW" badge on recently-added papers
- Drag-to-reorder sidebar entries
- Merge two Libraries / Topics
- Realtime catalog subscription
- Per-Library scoped Topics (nested taxonomy)
- Smart filter saved-queries
- Sidebar search/folding when entries exceed 100

## Files Touched (for plan reference, not implementation guidance)

```
chrome-extension/reader/
├── types.ts                              # LibraryRow + new catalog types
├── lib/
│   ├── library.ts                        # row mutations get libraryId/topicIds
│   ├── library-catalog.ts                # NEW — create/rename/delete + sanitize
│   ├── storage-schema.ts                 # add LIBRARIES_KEY / TOPICS_KEY / locks
│   └── sync-queue.ts                     # add 'rpc' op kind
└── components/
    ├── library-drawer.tsx                # widen + add sidebar + scope wiring
    ├── library-row.tsx                   # add Library chip + Topic chips + popovers
    ├── library-sidebar.tsx               # NEW — sidebar component
    ├── library-popover.tsx               # NEW — Library + Topic popovers
    └── confirm-modal.tsx                 # NEW — generic confirmation

supabase/
├── migrations/
│   └── 006_libraries_topics.sql          # NEW — tables, indexes, RLS, papers alter
└── functions/
    ├── delete-library/                   # NEW
    └── delete-topic/                     # NEW

chrome-extension/tests/
├── unit/library-v2/                      # NEW — 4 files
├── integration/library-v2.test.ts        # NEW
└── e2e/library-v2-flow.spec.ts           # NEW
```

## Open Questions

None at spec time. All forks resolved (Q1–Q8 + Approach choice) in
collaborative refinement on 2026-04-25.

Design review on 2026-04-25 (`/plan-design-review`) closed 12 additional
design decisions across 7 passes — sidebar visual states, header copy,
interaction state coverage, undo affordance, first-use pill, glyph system,
dark-mode chip contrast, responsive breakpoints, keyboard paths, screen
reader announcements, multi-Topic disambiguation, popover positioning, and
storage-key registration. Score: 7/10 → 9/10.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR (PLAN) | 1st: 17 issues / 2 critical gaps resolved. 2nd (delta on design-review additions): 5 issues / 0 critical gaps, persisted pending-deletes added, 30 new test paths covered |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 7/10 → 9/10, 12 decisions added |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **UNRESOLVED:** 0 across all reviews
- **VERDICT:** ENG (2x) + DESIGN CLEARED — ready to /plan-phase
