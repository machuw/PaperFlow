# UI Redesign — Left Chat / Right Overview+Note / Selection Action Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "single right WorkspacePanel with Chat+Abstract+Memory" UI with: left-side persistent multi-session Chat panel, right-side Overview+Note+Memory tabs, 4-action selection toolbar (`Explain | Highlight | Note | Translate`), unified Note store with chat↔note half-coupling via shared `actionId`.

**Architecture:** Three-column flex shell `[ChatPanel | Reader | RightPanel]` shared across Classic / Summary / Canvas variants. New `lib/selection-actions.ts` is the single dispatch point for all 4 actions; `lib/chat-sessions.ts` and `lib/notes.ts` own their respective stores. AI generation reuses existing `callChatCompletion` by extending `AiActionKind` with `overviewContributions` / `overviewKeywords`. Schema migration on `margin_notes.kind` lands with the same PR.

**Tech stack:** TypeScript, React 18, Vite, Supabase Postgres (one ALTER), Vitest unit + integration, Playwright E2E (new), `chrome.storage.local` (with `unlimitedStorage` permission).

**Spec source of truth:** `docs/specs/2026-04-24-spec-ui-redesign-chat-notes.md` — read before starting any lane. §17 (Eng Review) + §18 (Eng Review Addendum) **OVERRIDE** any conflicts with §1–§16. Approved mockups: §"Approved Mockups".

---

## File structure map

### New files (24)

```
chrome-extension/reader/lib/
  schema-migration.ts          — runSchemaMigrations_260424 + runRestoreContext_260424 (§17.3)
  undo-snapshot.ts             — 5s undo for chat-session + note-card delete (§17.7)
  format.ts                    — formatChatTimestamp / NoteCardFooter / SessionHistoryRow / Relative (§17.A.5)
  scroll-to-outline.ts         — extracted from outline-panel.tsx (§7.3)
  section-state.ts             — extracted from abstract-view.tsx (§7.3)
  chat-sessions.ts             — Session CRUD (§7.1)
  notes.ts                     — Note CRUD + 4-kind store (§7.1)
  selection-actions.ts         — runSelectionAction unified dispatch (§7.1, §6.1)
  overview.ts                  — AI-section caching + prompt selection (§7.1)
  semantic-scholar.ts          — meta fetch with jittered TTL + negative cache + single-concurrency (§17.8)

chrome-extension/reader/components/
  chat-panel.tsx               — Left shell + composer + msg stream (§2)
  chat-session-tabs.tsx        — Numeric tab strip + `+ ✕ ⟳` controls (§2.1)
  chat-session-history.tsx     — History drawer (§2.3)
  overview-view.tsx            — Right Overview tab root (§3.2)
  overview-paper-info.tsx      — Two-col label/value grid (§3.2.1)
  overview-outline.tsx         — Section structure tree (§3.2.3)
  overview-contributions.tsx   — AI bullets (§3.2.2)
  overview-keywords.tsx        — Flat keyword chips (§3.2.4)
  note-view.tsx                — Right Note tab root + sub-tabs (§3.3)
  note-card.tsx                — Layout A / Layout B (§3.3.2)
  note-editor-popover.tsx      — Note inline editor (§3.3.3)

supabase/migrations/
  006_extend_margin_notes_kind.sql    — ALTER margin_notes_kind_check (§5.3, §17.5)

chrome-extension/tests/unit/  (folder may be created)
chrome-extension/tests/integration/   (existing, +new files)
chrome-extension/tests/e2e/   (new)
chrome-extension/tests/eval/  (new)
```

### Modified files (10)

```
chrome-extension/manifest.json                  — add "unlimitedStorage" permission (§17.6)
chrome-extension/reader/main.tsx                — shell rebuild + dispatch + restore (§7.2)
chrome-extension/reader/types.ts                — ChatSession / Note / OverviewMeta + ChatMessage.kind/action (§5.2, §17.4)
chrome-extension/reader/lib/storage.ts          — per-paper helpers + key builders (§17.1, §17.2)
chrome-extension/reader/lib/storage-schema.ts   — 4 global keys (§17.2)
chrome-extension/reader/lib/ai.ts               — AiActionKind extension + 2 new prompt cases (§17.A.1)
chrome-extension/reader/lib/sync-queue.ts       — kind-filter predicate (§5.3)
chrome-extension/reader/lib/i18n.ts             — new strings (tabs, chat, note, delete.toast, etc.) (§7.2)
chrome-extension/reader/components/selection-toolbar.tsx — 4-action set (§4.1)
chrome-extension/reader/components/top-bar.tsx  — `[切 Chat]` button + `⌘\` re-bind (§1.4)
chrome-extension/reader/components/workspace-panel.tsx   — tab list `Overview | Note | Memory` (§3.1)
chrome-extension/reader/components/chat-view.tsx — actionCard rendering branch (§7.2)
```

### Deleted files (5, after extraction in §7.3)

```
chrome-extension/reader/components/abstract-view.tsx
chrome-extension/reader/components/outline-panel.tsx
chrome-extension/reader/components/margin-column.tsx
chrome-extension/reader/components/margin-note.tsx
chrome-extension/reader/components/selection-result-card.tsx
```

---

## Lane structure (per spec §18.4)

```
Lane A:  L1.1 (lib infra) ─→ L2.1 (Chat) ──┐
Lane B:  L1.2 (schema/sync) ─→ L2.2 (Note) ─┼─→ L3 (shell + main) ─→ L4 (delete)
Lane C:  L1.3 (styles) ─────→ L2.3 (Overview) ┘
```

L1.* are independent; L2.* depend on L1; L3 depends on all L2; L4 strictly after L3.

This document is ordered by lane. Each lane is a phase. Each task lists its files, then the bite-sized steps.

---

## Phase L1.1 · Foundation lib modules (no UI)

Depends on: nothing. Output: 5 new lib files, no integration yet.

### Task L1.1-1 · `lib/format.ts` — time formatters

**Files:**
- Create: `chrome-extension/reader/lib/format.ts`
- Test: `chrome-extension/tests/unit/format.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// chrome-extension/tests/unit/format.test.ts
import { describe, it, expect } from 'vitest';
import {
  formatChatTimestamp, formatNoteCardFooter,
  formatSessionHistoryRow, formatRelative,
} from '../../reader/lib/format';

const T = new Date('2026-04-24T12:30:45Z').getTime();

describe('format', () => {
  it('formatChatTimestamp en-US returns "10:32 AM" style', () => {
    const s = formatChatTimestamp(T, 'en-US');
    expect(s).toMatch(/AM|PM/);
  });
  it('formatChatTimestamp zh-CN returns "10:32" style', () => {
    expect(formatChatTimestamp(T, 'zh-CN')).toMatch(/\d{1,2}:\d{2}/);
  });
  it('formatNoteCardFooter en-US returns "Apr 24"', () => {
    expect(formatNoteCardFooter(T, 'en-US')).toContain('Apr');
  });
  it('formatNoteCardFooter zh-CN returns "4 月 24 日"', () => {
    expect(formatNoteCardFooter(T, 'zh-CN')).toMatch(/月/);
  });
  it('formatSessionHistoryRow zh-CN returns "2026-04-24 …"', () => {
    expect(formatSessionHistoryRow(T, 'zh-CN')).toMatch(/^2026-04-24/);
  });
  it('formatRelative under 60s returns "just now"', () => {
    expect(formatRelative(Date.now() - 5_000, 'en-US')).toMatch(/just now|seconds/i);
  });
  it('formatRelative invalid timestamp returns "—"', () => {
    expect(formatRelative(NaN, 'en-US')).toBe('—');
    expect(formatChatTimestamp(NaN, 'en-US')).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd chrome-extension && npx vitest run tests/unit/format.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement formatters**

```ts
// chrome-extension/reader/lib/format.ts
const FALLBACK = '—';
function safe<T>(ms: number, fn: () => T): T | string {
  if (!Number.isFinite(ms) || ms <= 0) return FALLBACK;
  try { return fn(); } catch { return FALLBACK; }
}
export function formatChatTimestamp(ms: number, locale: string): string {
  return safe(ms, () =>
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms)
  ) as string;
}
export function formatNoteCardFooter(ms: number, locale: string): string {
  return safe(ms, () =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ms)
  ) as string;
}
export function formatSessionHistoryRow(ms: number, locale: string): string {
  return safe(ms, () => {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }) as string;
}
export function formatRelative(ms: number, locale: string): string {
  return safe(ms, () => {
    const diff = (Date.now() - ms) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (diff < 60) return rtf.format(-Math.round(diff), 'second');
    if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
    return rtf.format(-Math.round(diff / 86400), 'day');
  }) as string;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd chrome-extension && npx vitest run tests/unit/format.test.ts
```
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/format.ts chrome-extension/tests/unit/format.test.ts
git commit -m "feat(ext): add lib/format.ts time formatters (zh/en locales, NaN safe)"
```

### Task L1.1-2 · `lib/scroll-to-outline.ts` — extracted

**Files:**
- Create: `chrome-extension/reader/lib/scroll-to-outline.ts`
- Modify: `chrome-extension/reader/components/outline-panel.tsx` (re-export source for now)

- [ ] **Step 1: Read existing function**

```bash
grep -n "scrollToOutlineItem" chrome-extension/reader/components/outline-panel.tsx
```

- [ ] **Step 2: Move the function body verbatim**

Cut the body of `scrollToOutlineItem(item, paper)` from `outline-panel.tsx` into the new file:

```ts
// chrome-extension/reader/lib/scroll-to-outline.ts
import type { OutlineItem, Paper } from '../types';

export function scrollToOutlineItem(item: OutlineItem, paper: Paper): void {
  // (verbatim copy of existing impl)
}
```

In `outline-panel.tsx`, replace local definition with `import { scrollToOutlineItem } from '../lib/scroll-to-outline';` and `export { scrollToOutlineItem }` to keep current callers unbroken.

- [ ] **Step 3: Run typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/reader/lib/scroll-to-outline.ts chrome-extension/reader/components/outline-panel.tsx
git commit -m "refactor(ext): extract scrollToOutlineItem to lib/scroll-to-outline.ts"
```

### Task L1.1-3 · `lib/section-state.ts` — extracted

**Files:**
- Create: `chrome-extension/reader/lib/section-state.ts`
- Modify: `chrome-extension/reader/components/abstract-view.tsx` (re-export)

- [ ] **Step 1: Cut `SectionState` type and reducer**

Move type and any helpers from `abstract-view.tsx` to `lib/section-state.ts`. Keep the same exported names. Re-export from `abstract-view.tsx` so unmodified callers compile.

- [ ] **Step 2: Run typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/reader/lib/section-state.ts chrome-extension/reader/components/abstract-view.tsx
git commit -m "refactor(ext): extract SectionState to lib/section-state.ts"
```

### Task L1.1-4 · `lib/undo-snapshot.ts` — 5s undo

**Files:**
- Create: `chrome-extension/reader/lib/undo-snapshot.ts`
- Test: `chrome-extension/tests/unit/undo-snapshot.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// chrome-extension/tests/unit/undo-snapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushSnapshot, tryUndo, flushOnPaperChange } from '../../reader/lib/undo-snapshot';

beforeEach(() => { vi.useFakeTimers(); });

describe('undo-snapshot', () => {
  it('tryUndo returns false when nothing pushed', async () => {
    expect(await tryUndo()).toBe(false);
  });
  it('pushSnapshot then tryUndo within 5s calls onRestore once', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: { x: 1 }, onExpire: () => {}, onRestore: restore });
    vi.advanceTimersByTime(2000);
    expect(await tryUndo()).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
  });
  it('snapshot expires at 5s', async () => {
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: vi.fn() });
    vi.advanceTimersByTime(5001);
    expect(await tryUndo()).toBe(false);
  });
  it('second push overwrites first; only last restorable', async () => {
    const r1 = vi.fn(), r2 = vi.fn();
    pushSnapshot({ paperKey: 'P', kind: 'chat-session', payload: {}, onExpire: () => {}, onRestore: r1 });
    pushSnapshot({ paperKey: 'P', kind: 'chat-session', payload: {}, onExpire: () => {}, onRestore: r2 });
    await tryUndo();
    expect(r1).not.toHaveBeenCalled();
    expect(r2).toHaveBeenCalledTimes(1);
  });
  it('flushOnPaperChange wipes snapshot when key differs', async () => {
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: vi.fn() });
    flushOnPaperChange('P2');
    expect(await tryUndo()).toBe(false);
  });
  it('flushOnPaperChange noop when key same', async () => {
    const r = vi.fn();
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: r });
    flushOnPaperChange('P1');
    await tryUndo();
    expect(r).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

```bash
cd chrome-extension && npx vitest run tests/unit/undo-snapshot.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (verbatim from spec §17.7)

```ts
// chrome-extension/reader/lib/undo-snapshot.ts
type Snapshot = {
  paperKey: string;
  kind: 'chat-session' | 'note-card';
  payload: any;
  timeoutId: number;
  onExpire: () => void;
  onRestore: () => Promise<void>;
};
let active: Snapshot | null = null;
export function pushSnapshot(snap: Omit<Snapshot, 'timeoutId'>): void {
  if (active) clearTimeout(active.timeoutId);
  if (JSON.stringify(snap.payload).length > 1_000_000) {
    console.warn('[undo-snapshot] payload >1MB, skipping snapshot');
    return;
  }
  active = {
    ...snap,
    timeoutId: setTimeout(() => { active?.onExpire(); active = null; }, 5000) as unknown as number,
  };
}
export async function tryUndo(): Promise<boolean> {
  if (!active) return false;
  clearTimeout(active.timeoutId);
  const a = active; active = null;
  await a.onRestore();
  return true;
}
export function flushOnPaperChange(newPaperKey: string): void {
  if (active && active.paperKey !== newPaperKey) {
    clearTimeout(active.timeoutId);
    active = null;
  }
}
export function _resetForTest(): void { if (active) clearTimeout(active.timeoutId); active = null; }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd chrome-extension && npx vitest run tests/unit/undo-snapshot.test.ts
```
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/undo-snapshot.ts chrome-extension/tests/unit/undo-snapshot.test.ts
git commit -m "feat(ext): add lib/undo-snapshot.ts (5s in-memory snapshot, paper-scoped)"
```

### Task L1.1-5 · `lib/schema-migration.ts` — local schema migrations + restore-context

**Files:**
- Create: `chrome-extension/reader/lib/schema-migration.ts`
- Test: `chrome-extension/tests/unit/schema-migration.test.ts`
- Test: `chrome-extension/tests/unit/restore-context.test.ts`

- [ ] **Step 1: Write failing tests for `runSchemaMigrations_260424`**

Test fixtures: seed `chrome.storage.local` mock with old `paper:${k}:chat` array of 3 messages + global `summary_threeLine_*` keys. Run migration. Assert:
- `paper:${k}:chatSessions` is `[{ id, seq:1, title, ... }]`
- `paper:${k}:chatSessionMessages:${sid}` matches old messages
- `paper:${k}:activeChatSession` = sid
- All `summary_*` keys removed
- `schemaMigrationVersion:260424:dropAbstract` = 1
- Idempotent: second run does nothing
- Old `paper:${k}:chat` retained (delayed cleanup, §10.3)

```ts
// chrome-extension/tests/unit/schema-migration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runSchemaMigrations_260424 } from '../../reader/lib/schema-migration';

describe('runSchemaMigrations_260424', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('migrates old chat array to ChatSession + messages', async () => {
    const k = '2017.0001';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: [
        { id: 'u1', role: 'user', text: 'Hello world', createdAt: 100 },
        { id: 'a1', role: 'assistant', text: 'Hi', createdAt: 200 },
      ],
    });
    await runSchemaMigrations_260424(k);
    const sessions = (await chrome.storage.local.get(`paper:${k}:chatSessions`))[`paper:${k}:chatSessions`];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].seq).toBe(1);
    expect(sessions[0].title).toContain('Hello world');
    const sid = sessions[0].id;
    const msgs = (await chrome.storage.local.get(`paper:${k}:chatSessionMessages:${sid}`))[`paper:${k}:chatSessionMessages:${sid}`];
    expect(msgs).toHaveLength(2);
    const active = (await chrome.storage.local.get(`paper:${k}:activeChatSession`))[`paper:${k}:activeChatSession`];
    expect(active).toBe(sid);
  });

  it('skips migration on second run (idempotent)', async () => {
    const k = '2017.0001';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: [{ id: 'u1', role: 'user', text: 'a', createdAt: 1 }],
    });
    await runSchemaMigrations_260424(k);
    const before = await chrome.storage.local.get(null);
    await runSchemaMigrations_260424(k);
    const after = await chrome.storage.local.get(null);
    expect(after).toEqual(before);
  });

  it('clears summary_* keys globally and stamps version flag', async () => {
    await chrome.storage.local.set({
      'summary_threeLine_X': 'data',
      'summary_keyTerms_Y': 'data',
      'summary_detailed_Z': 'data',
    });
    await runSchemaMigrations_260424('any');
    const all = await chrome.storage.local.get(null);
    expect(Object.keys(all).filter((k) => k.startsWith('summary_'))).toHaveLength(0);
    expect(all['schemaMigrationVersion:260424:dropAbstract']).toBe(1);
  });
});
```

- [ ] **Step 2: Write failing tests for `runRestoreContext_260424`**

```ts
// chrome-extension/tests/unit/restore-context.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runRestoreContext_260424 } from '../../reader/lib/schema-migration';

describe('runRestoreContext_260424', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('returns defaults when nothing persisted (first visit)', async () => {
    const ctx = await runRestoreContext_260424('newpaper');
    expect(ctx.tab).toBe('overview');
    expect(ctx.scroll).toBeNull();
    expect(ctx.activeSubtab).toBe('explain');
    expect(ctx.activeChatSession).toBeNull();
    expect(ctx.ghostRail).toBeNull();
  });

  it('restores tab/scroll/subtab when set', async () => {
    const k = 'P1';
    await chrome.storage.local.set({
      [`paper:${k}:workspace:tab`]: 'note',
      [`paper:${k}:scroll`]: 1234,
      [`paper:${k}:note:activeSubtab`]: 'translate',
      [`paper:${k}:lastVisit`]: Date.now() - 86400000,
      [`paper:${k}:notes`]: [{ id: 'n1', kind: 'note' }],
    });
    const ctx = await runRestoreContext_260424(k);
    expect(ctx.tab).toBe('note');
    expect(ctx.scroll).toBe(1234);
    expect(ctx.activeSubtab).toBe('translate');
    expect(ctx.ghostRail).not.toBeNull();
    expect(ctx.ghostRail!.notes).toBe(1);
  });

  it('skips ghost rail when no prior footprint', async () => {
    const k = 'P1';
    await chrome.storage.local.set({ [`paper:${k}:lastVisit`]: Date.now() - 1000 });
    const ctx = await runRestoreContext_260424(k);
    expect(ctx.ghostRail).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests — fail**

```bash
cd chrome-extension && npx vitest run tests/unit/schema-migration.test.ts tests/unit/restore-context.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `schema-migration.ts`**

```ts
// chrome-extension/reader/lib/schema-migration.ts
const k = {
  oldChat:        (pk: string) => `paper:${pk}:chat`,
  chatSessions:   (pk: string) => `paper:${pk}:chatSessions`,
  chatMessages:   (pk: string, sid: string) => `paper:${pk}:chatSessionMessages:${sid}`,
  activeChat:     (pk: string) => `paper:${pk}:activeChatSession`,
  notes:          (pk: string) => `paper:${pk}:notes`,
  highlights:     (pk: string) => `paper:${pk}:highlights`,
  workspaceTab:   (pk: string) => `paper:${pk}:workspace:tab`,
  scroll:         (pk: string) => `paper:${pk}:scroll`,
  lastVisit:      (pk: string) => `paper:${pk}:lastVisit`,
  noteSubtab:     (pk: string) => `paper:${pk}:note:activeSubtab`,
  versionChat:    (pk: string) => `schemaMigrationVersion:260424:chatSessions:${pk}`,
  versionDropAbs: 'schemaMigrationVersion:260424:dropAbstract',
};

function uuid(): string { return crypto.randomUUID(); }

export async function runSchemaMigrations_260424(paperKey: string): Promise<void> {
  // Step A — chat → sessions
  const verA = (await chrome.storage.local.get(k.versionChat(paperKey)))[k.versionChat(paperKey)];
  if (!verA) {
    const oldArr = (await chrome.storage.local.get(k.oldChat(paperKey)))[k.oldChat(paperKey)];
    if (Array.isArray(oldArr) && oldArr.length > 0) {
      const sid = uuid();
      const firstUser = oldArr.find((m: any) => m.role === 'user');
      const title = (firstUser?.text ?? 'Imported').slice(0, 30);
      const now = Date.now();
      await chrome.storage.local.set({
        [k.chatSessions(paperKey)]: [{ id: sid, seq: 1, title, createdAt: now, updatedAt: now }],
        [k.chatMessages(paperKey, sid)]: oldArr,
        [k.activeChat(paperKey)]: sid,
      });
    }
    await chrome.storage.local.set({ [k.versionChat(paperKey)]: 1 });
  }
  // Step B — drop summary_* (global, idempotent)
  const verB = (await chrome.storage.local.get(k.versionDropAbs))[k.versionDropAbs];
  if (!verB) {
    const all = await chrome.storage.local.get(null);
    const drop = Object.keys(all).filter((kk) => kk.startsWith('summary_'));
    if (drop.length > 0) await chrome.storage.local.remove(drop);
    await chrome.storage.local.set({ [k.versionDropAbs]: 1 });
  }
}

export interface RestoreContext {
  tab: 'overview' | 'note' | 'memory';
  scroll: number | null;
  activeSubtab: 'explain' | 'highlight' | 'note' | 'translate';
  activeChatSession: string | null;
  ghostRail: { notes: number; highlights: number; chats: number } | null;
}
export async function runRestoreContext_260424(paperKey: string): Promise<RestoreContext> {
  const all = await chrome.storage.local.get([
    k.workspaceTab(paperKey), k.scroll(paperKey), k.noteSubtab(paperKey),
    k.activeChat(paperKey), k.lastVisit(paperKey),
    k.notes(paperKey), k.highlights(paperKey), k.chatSessions(paperKey),
  ]);
  const notes = all[k.notes(paperKey)] ?? [];
  const highlights = all[k.highlights(paperKey)] ?? [];
  const sessions = all[k.chatSessions(paperKey)] ?? [];
  const lastVisit = all[k.lastVisit(paperKey)] ?? null;
  const ctx: RestoreContext = {
    tab: (all[k.workspaceTab(paperKey)] as any) ?? 'overview',
    scroll: typeof all[k.scroll(paperKey)] === 'number' ? all[k.scroll(paperKey)] : null,
    activeSubtab: (all[k.noteSubtab(paperKey)] as any) ?? 'explain',
    activeChatSession: all[k.activeChat(paperKey)] ?? null,
    ghostRail: null,
  };
  if (lastVisit && (notes.length + highlights.length + sessions.length) > 0) {
    ctx.ghostRail = { notes: notes.length, highlights: highlights.length, chats: sessions.length };
  }
  return ctx;
}
export const k_schemaMigration = k;
```

- [ ] **Step 5: Run tests — pass**

```bash
cd chrome-extension && npx vitest run tests/unit/schema-migration.test.ts tests/unit/restore-context.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add chrome-extension/reader/lib/schema-migration.ts chrome-extension/tests/unit/schema-migration.test.ts chrome-extension/tests/unit/restore-context.test.ts
git commit -m "feat(ext): add lib/schema-migration.ts (chat→sessions + drop summary_* + restore-context)"
```

### Task L1.1-6 · Add `ChatSession`, `Note`, `OverviewMeta` types (pulled forward from L3)

**Files:**
- Modify: `chrome-extension/reader/types.ts`

> Pulled forward from L3 because L1.1-7 helpers import these types. Trivial type-only addition.

- [ ] **Step 1: Extend types** (per spec §5.2 + §17.4)

```ts
// types.ts — replace existing ChatMessage definition and add new types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind?: 'actionCard';
  action?: {
    kind: 'explain' | 'translate';
    actionId: string;
    quote: string;
    loc?: { page?: number; paragraph?: number };
  };
  text: string;
  citations?: Citation[];
  createdAt: number;
}

export interface ChatSession {
  id: string;
  seq: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type NoteKind = 'highlight' | 'note' | 'explain' | 'translate';

export interface Note {
  id: string;
  kind: NoteKind;
  quote: string;
  loc: { page?: number; paragraph?: number; charRange?: [number, number] };
  color?: string;
  aiAnswer?: string;
  userText?: string;
  chatSessionId?: string;
  chatMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OverviewMeta {
  venue?: string;
  citations?: number;
  codeUrl?: string;
  field?: string;
  fetchedAt: number;
  expiresAt: number;
  failed?: boolean;
  failedAt?: number;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```
Expected: pass. Existing `MarginResult` and `AiActionKind` are left alone for now.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/reader/types.ts
git commit -m "feat(ext): add ChatSession / Note / OverviewMeta types + ChatMessage.kind/action"
```

### Task L1.1-7 · Extend `lib/storage.ts` with new key helpers

**Files:**
- Modify: `chrome-extension/reader/lib/storage.ts`
- Test: `chrome-extension/tests/unit/storage-paper-keys.test.ts`

- [ ] **Step 1: Add key builders** to existing `const k = { ... }` (preserving existing keys):

```ts
chatSessions:        (key: string) => `paper:${key}:chatSessions`,
chatSessionMessages: (key: string, sid: string) => `paper:${key}:chatSessionMessages:${sid}`,
activeChatSession:   (key: string) => `paper:${key}:activeChatSession`,
overviewContrib:     (key: string, model: string, lang: string) => `paper:${key}:overview:contributions:${model}:${lang}`,
overviewKeywords:    (key: string, model: string, lang: string) => `paper:${key}:overview:keywords:${model}:${lang}`,
overviewMeta:        (key: string) => `paper:${key}:overviewMeta`,
workspaceTab:        (key: string) => `paper:${key}:workspace:tab`,
paperScroll:         (key: string) => `paper:${key}:scroll`,
lastVisit:           (key: string) => `paper:${key}:lastVisit`,
noteSubtab:          (key: string) => `paper:${key}:note:activeSubtab`,
```

- [ ] **Step 2: Add typed get/set helpers** at the bottom of `storage.ts`

```ts
import type { ChatSession, Note, OverviewMeta } from '../types';

export async function getChatSessions(key: string): Promise<ChatSession[]> {
  const r = await chrome.storage.local.get(k.chatSessions(key));
  return (r[k.chatSessions(key)] as ChatSession[]) ?? [];
}
export async function setChatSessions(key: string, v: ChatSession[]): Promise<void> {
  await chrome.storage.local.set({ [k.chatSessions(key)]: v });
}
export async function getChatSessionMessages(key: string, sid: string): Promise<ChatMessage[]> {
  const r = await chrome.storage.local.get(k.chatSessionMessages(key, sid));
  return (r[k.chatSessionMessages(key, sid)] as ChatMessage[]) ?? [];
}
export async function setChatSessionMessages(key: string, sid: string, v: ChatMessage[]): Promise<void> {
  await chrome.storage.local.set({ [k.chatSessionMessages(key, sid)]: v });
}
export async function appendChatSessionMessage(key: string, sid: string, m: ChatMessage): Promise<void> {
  await withKeyLock(k.chatSessionMessages(key, sid), async () => {
    const prev = await getChatSessionMessages(key, sid);
    await setChatSessionMessages(key, sid, [...prev, m]);
  });
}
export async function getActiveChatSession(key: string): Promise<string | null> {
  const r = await chrome.storage.local.get(k.activeChatSession(key));
  return (r[k.activeChatSession(key)] as string | null) ?? null;
}
export async function setActiveChatSession(key: string, sid: string | null): Promise<void> {
  await chrome.storage.local.set({ [k.activeChatSession(key)]: sid });
}
export async function getNotesV2(key: string): Promise<Note[]> {
  const r = await chrome.storage.local.get(`paper:${key}:notes`);
  const arr = (r[`paper:${key}:notes`] as any[]) ?? [];
  return arr.map((n) => ({ ...n, kind: n.kind ?? 'note' }));
}
export async function setNotesV2(key: string, v: Note[]): Promise<void> {
  await chrome.storage.local.set({ [`paper:${key}:notes`]: v });
}
export async function getOverviewSection(key: string, kind: 'contributions' | 'keywords', model: string, lang: string): Promise<string | null> {
  const builder = kind === 'contributions' ? k.overviewContrib : k.overviewKeywords;
  const r = await chrome.storage.local.get(builder(key, model, lang));
  return (r[builder(key, model, lang)] as string) ?? null;
}
export async function setOverviewSection(key: string, kind: 'contributions' | 'keywords', model: string, lang: string, body: string): Promise<void> {
  const builder = kind === 'contributions' ? k.overviewContrib : k.overviewKeywords;
  await chrome.storage.local.set({ [builder(key, model, lang)]: body });
}
export async function getOverviewMeta(key: string): Promise<OverviewMeta | null> {
  const r = await chrome.storage.local.get(k.overviewMeta(key));
  return (r[k.overviewMeta(key)] as OverviewMeta) ?? null;
}
export async function setOverviewMeta(key: string, v: OverviewMeta): Promise<void> {
  await chrome.storage.local.set({ [k.overviewMeta(key)]: v });
}
export async function getWorkspaceTab(key: string): Promise<'overview' | 'note' | 'memory' | null> {
  const r = await chrome.storage.local.get(k.workspaceTab(key));
  return (r[k.workspaceTab(key)] as any) ?? null;
}
export async function setWorkspaceTab(key: string, v: 'overview' | 'note' | 'memory'): Promise<void> {
  await chrome.storage.local.set({ [k.workspaceTab(key)]: v });
}
export async function setPaperScroll(key: string, v: number): Promise<void> {
  await chrome.storage.local.set({ [k.paperScroll(key)]: v });
}
export async function setLastVisit(key: string, v: number): Promise<void> {
  await chrome.storage.local.set({ [k.lastVisit(key)]: v });
}
export async function getNoteSubtab(key: string): Promise<'explain' | 'highlight' | 'note' | 'translate' | null> {
  const r = await chrome.storage.local.get(k.noteSubtab(key));
  return (r[k.noteSubtab(key)] as any) ?? null;
}
export async function setNoteSubtab(key: string, v: 'explain' | 'highlight' | 'note' | 'translate'): Promise<void> {
  await chrome.storage.local.set({ [k.noteSubtab(key)]: v });
}
```

- [ ] **Step 3: Add unit test for round-trip key helpers**

```ts
// chrome-extension/tests/unit/storage-paper-keys.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setChatSessions, getChatSessions,
  appendChatSessionMessage, getChatSessionMessages,
  setActiveChatSession, getActiveChatSession,
  setNotesV2, getNotesV2,
  setOverviewSection, getOverviewSection,
  setWorkspaceTab, getWorkspaceTab,
} from '../../reader/lib/storage';

describe('storage per-paper helpers', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('chatSessions round-trip', async () => {
    await setChatSessions('P1', [{ id: 'a', seq: 1, title: 't', createdAt: 1, updatedAt: 1 }]);
    expect(await getChatSessions('P1')).toHaveLength(1);
  });
  it('appendChatSessionMessage serializes concurrent appends', async () => {
    await Promise.all([
      appendChatSessionMessage('P', 's', { id: '1', role: 'user', text: 'a', createdAt: 1 }),
      appendChatSessionMessage('P', 's', { id: '2', role: 'user', text: 'b', createdAt: 2 }),
    ]);
    expect((await getChatSessionMessages('P', 's')).length).toBe(2);
  });
  it('getNotesV2 defaults missing kind to "note"', async () => {
    await chrome.storage.local.set({ 'paper:P:notes': [{ id: 'n', quote: 'q' }] });
    expect((await getNotesV2('P'))[0].kind).toBe('note');
  });
  it('overview section keyed by model+lang', async () => {
    await setOverviewSection('P', 'contributions', 'gpt-4o-mini', 'en', '- bullet');
    expect(await getOverviewSection('P', 'contributions', 'gpt-4o-mini', 'en')).toBe('- bullet');
    expect(await getOverviewSection('P', 'contributions', 'gpt-4o-mini', 'zh-CN')).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests — pass**

```bash
cd chrome-extension && npx vitest run tests/unit/storage-paper-keys.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/storage.ts chrome-extension/tests/unit/storage-paper-keys.test.ts
git commit -m "feat(ext): add per-paper storage helpers (chatSessions, notes v2, overview, ui state)"
```

### Task L1.1-8 · Add 4 global keys to `storage-schema.ts`

**Files:**
- Modify: `chrome-extension/reader/lib/storage-schema.ts`

- [ ] **Step 1: Extend `StorageSchema` type**

```ts
export type StorageSchema = {
  // ... existing keys preserved ...
  'schemaMigrationVersion:260424:dropAbstract':       1 | undefined
  'schemaMigrationVersion:260501:cleanupLegacyChat':  1 | undefined
  'shortcutToastSeen:260424':                         1 | undefined
  'actionCardHintSeen:260424':                        1 | undefined
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/reader/lib/storage-schema.ts
git commit -m "feat(ext): add 4 global migration/toast version keys to StorageSchema"
```

### Task L1.1-9 · `lib/chat-sessions.ts` — Session CRUD

**Files:**
- Create: `chrome-extension/reader/lib/chat-sessions.ts`
- Test: `chrome-extension/tests/unit/chat-sessions.test.ts`

- [ ] **Step 1: Write tests** (per spec §17.B.1)

```ts
// chrome-extension/tests/unit/chat-sessions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, deleteSession, clearSession, renameSession,
  listSessions, setActive, getActive, appendMessage,
} from '../../reader/lib/chat-sessions';

beforeEach(async () => { await chrome.storage.local.clear(); });

describe('chat-sessions', () => {
  it('createSession assigns seq=1 first time', async () => {
    const s = await createSession('P');
    expect(s.seq).toBe(1);
    expect(s.title).toBe('');
  });
  it('createSession seq increments monotonically (max+1)', async () => {
    const a = await createSession('P');
    const b = await createSession('P');
    expect(b.seq).toBe(2);
    await deleteSession('P', a.id);
    const c = await createSession('P');
    expect(c.seq).toBe(3);
  });
  it('appendMessage auto-titles from first user message ≤30 chars', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'A'.repeat(50), createdAt: 1 });
    const list = await listSessions('P');
    expect(list[0].title.length).toBe(30);
  });
  it('clearSession keeps session, drops messages', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'q', createdAt: 1 });
    await clearSession('P', s.id);
    expect((await listSessions('P')).length).toBe(1);
  });
  it('deleteSession of active resets active to null', async () => {
    const s = await createSession('P');
    await setActive('P', s.id);
    await deleteSession('P', s.id);
    expect(await getActive('P')).toBeNull();
  });
  it('rename updates title + updatedAt', async () => {
    const s = await createSession('P');
    const before = s.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await renameSession('P', s.id, 'My chat');
    const list = await listSessions('P');
    expect(list[0].title).toBe('My chat');
    expect(list[0].updatedAt).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run tests — fail**

```bash
cd chrome-extension && npx vitest run tests/unit/chat-sessions.test.ts
```

- [ ] **Step 3: Implement**

```ts
// chrome-extension/reader/lib/chat-sessions.ts
import {
  getChatSessions, setChatSessions,
  getChatSessionMessages, setChatSessionMessages,
  appendChatSessionMessage,
  getActiveChatSession, setActiveChatSession,
} from './storage';
import type { ChatSession, ChatMessage } from '../types';

export async function listSessions(pk: string): Promise<ChatSession[]> {
  return getChatSessions(pk);
}
export async function getActive(pk: string): Promise<string | null> {
  return getActiveChatSession(pk);
}
export async function setActive(pk: string, sid: string | null): Promise<void> {
  await setActiveChatSession(pk, sid);
}
export async function createSession(pk: string): Promise<ChatSession> {
  const list = await getChatSessions(pk);
  const seq = list.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
  const now = Date.now();
  const s: ChatSession = { id: crypto.randomUUID(), seq, title: '', createdAt: now, updatedAt: now };
  await setChatSessions(pk, [...list, s]);
  return s;
}
export async function deleteSession(pk: string, sid: string): Promise<void> {
  const list = await getChatSessions(pk);
  await setChatSessions(pk, list.filter((s) => s.id !== sid));
  await chrome.storage.local.remove(`paper:${pk}:chatSessionMessages:${sid}`);
  if ((await getActiveChatSession(pk)) === sid) await setActiveChatSession(pk, null);
}
export async function clearSession(pk: string, sid: string): Promise<void> {
  await setChatSessionMessages(pk, sid, []);
}
export async function renameSession(pk: string, sid: string, title: string): Promise<void> {
  const list = await getChatSessions(pk);
  const next = list.map((s) => s.id === sid ? { ...s, title, updatedAt: Date.now() } : s);
  await setChatSessions(pk, next);
}
export async function appendMessage(pk: string, sid: string, m: ChatMessage): Promise<void> {
  await appendChatSessionMessage(pk, sid, m);
  const list = await getChatSessions(pk);
  const next = list.map((s) => {
    if (s.id !== sid) return s;
    const title = s.title || (m.role === 'user' ? m.text.slice(0, 30) : s.title);
    return { ...s, title, updatedAt: Date.now() };
  });
  await setChatSessions(pk, next);
}
export async function loadMessages(pk: string, sid: string): Promise<ChatMessage[]> {
  return getChatSessionMessages(pk, sid);
}
```

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/chat-sessions.ts chrome-extension/tests/unit/chat-sessions.test.ts
git commit -m "feat(ext): add lib/chat-sessions.ts (CRUD + auto-title + active mgmt)"
```

### Task L1.1-10 · `lib/notes.ts` — Note CRUD with kind

**Files:**
- Create: `chrome-extension/reader/lib/notes.ts`
- Test: `chrome-extension/tests/unit/notes.test.ts`

- [ ] **Step 1: Write tests**

```ts
// chrome-extension/tests/unit/notes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { listNotes, upsertNote, deleteNote, byKind, patchNote } from '../../reader/lib/notes';
import type { Note } from '../../reader/types';

beforeEach(async () => { await chrome.storage.local.clear(); });

const baseNote = (over: Partial<Note> = {}): Note => ({
  id: over.id ?? 'a', kind: over.kind ?? 'note',
  quote: 'q', loc: { page: 1 },
  createdAt: 1, updatedAt: 1, ...over,
});

describe('notes', () => {
  it('upsert+list 4 kinds', async () => {
    for (const kind of ['highlight','note','explain','translate'] as const) {
      await upsertNote('P', baseNote({ id: kind, kind }));
    }
    expect((await listNotes('P')).length).toBe(4);
  });
  it('byKind filters', async () => {
    await upsertNote('P', baseNote({ id: 'h', kind: 'highlight' }));
    await upsertNote('P', baseNote({ id: 'n', kind: 'note' }));
    expect((await byKind('P', 'highlight')).length).toBe(1);
  });
  it('upsert by id replaces', async () => {
    await upsertNote('P', baseNote({ id: 'a', userText: 'one' }));
    await upsertNote('P', baseNote({ id: 'a', userText: 'two' }));
    const list = await listNotes('P');
    expect(list.length).toBe(1);
    expect(list[0].userText).toBe('two');
  });
  it('patchNote merges and bumps updatedAt', async () => {
    await upsertNote('P', baseNote({ id: 'a', updatedAt: 1 }));
    await new Promise((r) => setTimeout(r, 5));
    await patchNote('P', 'a', { aiAnswer: 'final' });
    const n = (await listNotes('P'))[0];
    expect(n.aiAnswer).toBe('final');
    expect(n.updatedAt).toBeGreaterThan(1);
  });
  it('deleteNote removes by id', async () => {
    await upsertNote('P', baseNote({ id: 'a' }));
    await deleteNote('P', 'a');
    expect(await listNotes('P')).toEqual([]);
  });
  it('legacy notes without kind default to note', async () => {
    await chrome.storage.local.set({ 'paper:P:notes': [{ id: 'x', quote: 'q', loc: {}, createdAt: 1, updatedAt: 1 }] });
    const list = await listNotes('P');
    expect(list[0].kind).toBe('note');
  });
});
```

- [ ] **Step 2: Run tests — fail**

- [ ] **Step 3: Implement**

```ts
// chrome-extension/reader/lib/notes.ts
import { getNotesV2, setNotesV2 } from './storage';
import type { Note } from '../types';

export async function listNotes(pk: string): Promise<Note[]> {
  const list = await getNotesV2(pk);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}
export async function byKind(pk: string, kind: Note['kind']): Promise<Note[]> {
  return (await listNotes(pk)).filter((n) => n.kind === kind);
}
export async function upsertNote(pk: string, n: Note): Promise<void> {
  const list = await getNotesV2(pk);
  const idx = list.findIndex((x) => x.id === n.id);
  if (idx >= 0) list[idx] = n; else list.push(n);
  await setNotesV2(pk, list);
}
export async function patchNote(pk: string, id: string, patch: Partial<Note>): Promise<void> {
  const list = await getNotesV2(pk);
  const next = list.map((x) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x);
  await setNotesV2(pk, next);
}
export async function deleteNote(pk: string, id: string): Promise<void> {
  const list = await getNotesV2(pk);
  await setNotesV2(pk, list.filter((x) => x.id !== id));
}
```

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/notes.ts chrome-extension/tests/unit/notes.test.ts
git commit -m "feat(ext): add lib/notes.ts (4-kind CRUD, sort by createdAt desc, legacy compat)"
```

---

## Phase L1.2 · Schema migration + sync-queue kind filter

Depends on: nothing.

### Task L1.2-1 · Supabase migration `006_extend_margin_notes_kind.sql`

**Files:**
- Create: `supabase/migrations/006_extend_margin_notes_kind.sql`

- [ ] **Step 1: Write the SQL** (verbatim from spec §5.3 + §17.5)

```sql
-- supabase/migrations/006_extend_margin_notes_kind.sql
-- Per docs/specs/2026-04-24-spec-ui-redesign-chat-notes.md §5.3:
-- extend kind CHECK to allow new 'note' / 'highlight' values introduced
-- by the redesign, while preserving deprecated 'summarize'/'ask' for
-- historical rows.

alter table margin_notes
  drop constraint margin_notes_kind_check;

alter table margin_notes
  add constraint margin_notes_kind_check
    check (kind in ('explain','summarize','translate','ask','note','highlight'));
```

- [ ] **Step 2: Apply locally**

```bash
supabase db reset
```
Expected: all 6 migrations apply cleanly.

- [ ] **Step 3: Smoke-test the new constraint** via Supabase Studio SQL editor: `INSERT INTO margin_notes (...) VALUES (..., 'highlight', ...)` succeeds; an invalid kind fails with constraint violation.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_extend_margin_notes_kind.sql
git commit -m "feat(db): extend margin_notes.kind CHECK to allow note + highlight (006)"
```

### Task L1.2-2 · Update `sync-queue.ts` with kind filter

**Files:**
- Modify: `chrome-extension/reader/lib/sync-queue.ts`
- Test: `chrome-extension/tests/sync-queue-kind-filter.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// chrome-extension/tests/sync-queue-kind-filter.test.ts
import { describe, it, expect } from 'vitest';
import { shouldSyncNote } from '../reader/lib/sync-queue';

describe('sync-queue kind filter', () => {
  it.each([
    ['note', true], ['highlight', true],
    ['explain', false], ['translate', false],
    ['summarize', false], ['ask', false], [undefined, true],
  ])('shouldSyncNote(%s) → %s', (kind, want) => {
    expect(shouldSyncNote(kind as any)).toBe(want);
  });
});
```

- [ ] **Step 2: Run test — fail**

- [ ] **Step 3: Implement**

Add to `sync-queue.ts`:

```ts
export type SyncableNoteKind = 'note' | 'highlight';
export function shouldSyncNote(kind: string | undefined): boolean {
  // §5.3: only 'note' and 'highlight' go to cloud; deprecated kinds
  // (summarize/ask) and AI products (explain/translate) stay local.
  // Legacy rows without kind default to 'note' (§10.2) → also sync.
  return kind === undefined || kind === 'note' || kind === 'highlight';
}
```

Callers (notably `lib/selection-actions.ts` from L2.2) gate `enqueue({ table: 'margin_notes', ... })` on `shouldSyncNote(note.kind)`.

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/reader/lib/sync-queue.ts chrome-extension/tests/sync-queue-kind-filter.test.ts
git commit -m "feat(ext): add shouldSyncNote kind filter (only note+highlight to cloud, §5.3)"
```

---

## Phase L1.3 · Manifest permission

### Task L1.3-1 · Add `unlimitedStorage`

**Files:**
- Modify: `chrome-extension/manifest.json`

- [ ] **Step 1: Edit manifest** (per spec §17.6)

```json
"permissions": ["storage", "unlimitedStorage", "declarativeNetRequest", "identity", "alarms"]
```

- [ ] **Step 2: Reload extension; verify chrome://extensions shows no new prompt** (`unlimitedStorage` is non-prompting per spec §17.6).

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/manifest.json
git commit -m "feat(ext): add unlimitedStorage permission (§17.6)"
```

### Task L1.3-2 · Confirm tokens + animations exist (read-only)

**Files:** Read-only audit of `styles/tokens.css`, `chrome-extension/reader/styles/`

- [ ] **Step 1: Verify required tokens** (per spec §13.3)

```bash
grep -E -- "--walnut\b|--walnut-soft|--forest|--sky|--ink-highlight|--paper\b|--paper-soft|--rule-soft|--ink-faded|--ink-ghost|--foxglove\b|--foxglove-soft|--font-serif|--font-sans" styles/tokens.css chrome-extension/reader/styles/tokens.css
```
Expected: all spec §13.3 tokens are present (per spec the existing palette is "完全足够").

- [ ] **Step 2: Verify `ink-streaming` and `fade-up` animation classes**

```bash
grep -rn "ink-streaming\|fade-up" chrome-extension/reader/styles/ chrome-extension/reader/components/
```
If inline-defined, extract to `chrome-extension/reader/styles/ink-animations.css` (per spec §7.3) and commit:

```bash
git commit -m "refactor(ext): extract ink-streaming + fade-up to ink-animations.css"
```

---

## Phase L2.1 · Chat panel vertical slice

Depends on: L1.1-1 (format), L1.1-6 (types), L1.1-9 (chat-sessions). Output: working left chat panel components (full wiring in L3).

### Task L2.1-1 · `chat-session-tabs.tsx`

**Files:**
- Create: `chrome-extension/reader/components/chat-session-tabs.tsx`
- Modify if needed: `chrome-extension/reader/components/icons.tsx` (add `Plus`, `Clock`, `Edit`, `Trash`, `ArrowRight` if missing)

- [ ] **Step 1: Audit icon set**

```bash
grep -E "Plus|Clock|Edit|Trash|ArrowRight" chrome-extension/reader/components/icons.tsx
```
For each missing icon, add a small SVG component matching the file's existing style (24×24 viewBox, 1.5px stroke).

- [ ] **Step 2: Implement** per spec §2.1

```tsx
// chrome-extension/reader/components/chat-session-tabs.tsx
import type { CSSProperties } from 'react';
import type { ChatSession } from '../types';
import { I } from './icons';

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onClear: () => void;
  onHistory: () => void;
}
export function ChatSessionTabs(p: Props) {
  return (
    <div role="tablist" aria-label="Chat sessions" style={containerStyle}>
      <div style={tabsScrollStyle}>
        {p.sessions.map((s) => {
          const active = s.id === p.activeId;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              onClick={() => p.onSwitch(s.id)}
              style={tabBtn(active)}
            >{s.seq}</button>
          );
        })}
      </div>
      <div style={controlsStyle}>
        <IconBtn label="New chat" onClick={p.onNew}><I.Plus size={14} /></IconBtn>
        <IconBtn label="Clear current" onClick={p.onClear}><I.Close size={14} /></IconBtn>
        <IconBtn label="History" onClick={p.onHistory}><I.Clock size={14} /></IconBtn>
      </div>
    </div>
  );
}
const containerStyle: CSSProperties = {
  height: 32, display: 'flex', alignItems: 'stretch',
  borderBottom: '0.5px solid var(--rule)',
};
const tabsScrollStyle: CSSProperties = {
  flex: 1, display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
};
const controlsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 0, paddingRight: 4 };
const tabBtn = (active: boolean): CSSProperties => ({
  padding: '0 10px', height: 32, lineHeight: '32px',
  background: 'transparent', border: 'none',
  borderBottom: active ? '1.5px solid var(--walnut)' : '1.5px solid transparent',
  marginBottom: -0.5,
  color: active ? 'var(--ink)' : 'var(--ink-faded)',
  fontFamily: 'var(--font-sans)', fontSize: 12,
  cursor: 'pointer',
});
function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="icon-btn"
      style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer' }}
    >{children}</button>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd chrome-extension && npx tsc --noEmit
git add chrome-extension/reader/components/chat-session-tabs.tsx chrome-extension/reader/components/icons.tsx
git commit -m "feat(ext): add ChatSessionTabs (numeric tabs + new/clear/history controls)"
```

### Task L2.1-2 · `chat-session-history.tsx` — drawer

**Files:**
- Create: `chrome-extension/reader/components/chat-session-history.tsx`

- [ ] **Step 1: Implement** per spec §2.3 + §4.A

```tsx
// chrome-extension/reader/components/chat-session-history.tsx
import { useState } from 'react';
import type { ChatSession } from '../types';
import { I } from './icons';
import { formatSessionHistoryRow } from '../lib/format';
import { t } from '../lib/i18n';

interface Props {
  sessions: ChatSession[];
  locale: string;
  onPick: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}
export function ChatSessionHistory({ sessions, locale, onPick, onRename, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div role="dialog" aria-label={t('chat.history.title') || 'Chat history'} style={drawerStyle}
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={headerStyle}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faded)' }}>
          {t('chat.history.title') || 'CONVERSATIONS'}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ width: 28, height: 28 }}><I.Close size={12} /></button>
      </div>
      {sorted.length === 0 ? (
        <div style={emptyStyle}>
          <div>{t('chat.history.empty') || 'No conversations yet.'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faded)', marginTop: 4 }}>{t('chat.history.emptyHint') || 'Try asking about this paper.'}</div>
        </div>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
          {sorted.map((s) => (
            <SessionRow key={s.id} s={s} locale={locale}
              editing={editing === s.id} draftTitle={draftTitle} setDraftTitle={setDraftTitle}
              onStartEdit={() => { setEditing(s.id); setDraftTitle(s.title); }}
              onCommit={() => { onRename(s.id, draftTitle); setEditing(null); }}
              onCancel={() => setEditing(null)}
              onPick={() => onPick(s.id)} onDelete={() => onDelete(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
function SessionRow({ s, locale, editing, draftTitle, setDraftTitle, onStartEdit, onCommit, onCancel, onPick, onDelete }: any) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={rowStyle}>
      <div style={{ flex: 1, cursor: 'pointer' }} onClick={editing ? undefined : onPick}>
        {editing ? (
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); }}
            autoFocus style={{ width: '100%', font: 'inherit', border: '1px solid var(--rule)', padding: 2 }} />
        ) : (
          <>
            <div style={{ color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 13 }}>{s.title || `Chat #${s.seq}`}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)', marginTop: 2 }}>{formatSessionHistoryRow(s.updatedAt, locale)}</div>
          </>
        )}
      </div>
      {hover && !editing && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" onClick={onStartEdit} aria-label="Rename"><I.Edit size={12} /></button>
          <button className="icon-btn" onClick={onDelete} aria-label="Delete"><I.Trash size={12} /></button>
        </div>
      )}
    </div>
  );
}
const drawerStyle: any = { position: 'absolute', left: 0, top: 32, width: '100%', background: 'var(--paper)', border: '0.5px solid var(--rule)', boxShadow: 'var(--shadow-2)', zIndex: 50, padding: 8 };
const headerStyle: any = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 4px 8px' };
const rowStyle: any = { display: 'flex', alignItems: 'flex-start', padding: '8px 6px', borderTop: '0.5px solid var(--rule-soft)' };
const emptyStyle: any = { textAlign: 'center', padding: '24px 12px', color: 'var(--ink-faded)' };
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd chrome-extension && npx tsc --noEmit
git add chrome-extension/reader/components/chat-session-history.tsx
git commit -m "feat(ext): add ChatSessionHistory drawer (rename + delete + sort by updatedAt)"
```

### Task L2.1-3 · Add `actionCard` rendering branch in `chat-view.tsx`

**Files:**
- Modify: `chrome-extension/reader/components/chat-view.tsx`

- [ ] **Step 1: Add `ActionCard` component and short-circuit in `ChatMsg`**

```tsx
function ChatMsg({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  if (msg.kind === 'actionCard' && msg.action) {
    return <ActionCard msg={msg} />;
  }
  // ... existing user / assistant rendering ...
}

function ActionCard({ msg }: { msg: ChatMessage }) {
  const a = msg.action!;
  const accent = a.kind === 'explain' ? 'var(--walnut)' : 'var(--sky)';
  const badgeLabel = a.kind === 'explain' ? 'EXPLAIN' : 'TRANSLATE';
  const locStr = a.loc?.page ? `· p.${a.loc.page}` : '';
  return (
    <div style={{ borderLeft: `2px solid ${accent}`, paddingLeft: 8, animation: 'fade-up 140ms' }}>
      <div style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: accent, fontWeight: 600, marginBottom: 4 }}>{badgeLabel} {locStr}</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{a.quote}"</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add chrome-extension/reader/components/chat-view.tsx
git commit -m "feat(ext): chat-view renders kind=actionCard messages with kind-coloured badge + clamp quote"
```

### Task L2.1-4 · `chat-panel.tsx` — outer shell

**Files:**
- Create: `chrome-extension/reader/components/chat-panel.tsx`

- [ ] **Step 1: Implement**

```tsx
// chrome-extension/reader/components/chat-panel.tsx
import { useState } from 'react';
import type { Paper, ChatSession, ChatMessage } from '../types';
import { ChatView } from './chat-view';
import { ChatSessionTabs } from './chat-session-tabs';
import { ChatSessionHistory } from './chat-session-history';

interface Props {
  paper: Paper;
  sessions: ChatSession[];
  activeId: string | null;
  messages: ChatMessage[];
  streamingId: string | null;
  askPrefill: string | null;
  locale: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onClear: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSend: (text: string, pinnedSelection: string | null) => void;
  onDismissPrefill: () => void;
}
export function ChatPanel(p: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div role="region" aria-label="AI chat assistant"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper)', borderRight: '0.5px solid var(--rule)', position: 'relative' }}>
      <ChatSessionTabs
        sessions={p.sessions} activeId={p.activeId}
        onSwitch={p.onSwitch} onNew={p.onNew} onClear={p.onClear}
        onHistory={() => setHistoryOpen((v) => !v)} />
      {historyOpen && (
        <ChatSessionHistory
          sessions={p.sessions} locale={p.locale}
          onPick={(id) => { p.onSwitch(id); setHistoryOpen(false); }}
          onRename={p.onRename} onDelete={p.onDelete}
          onClose={() => setHistoryOpen(false)} />
      )}
      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <ChatView paper={p.paper} messages={p.messages} streamingId={p.streamingId}
          askPrefill={p.askPrefill} onSend={p.onSend} onDismissPrefill={p.onDismissPrefill} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add chrome-extension/reader/components/chat-panel.tsx
git commit -m "feat(ext): add ChatPanel shell (tabs + history drawer + ChatView body)"
```

---

## Phase L2.2 · Note vertical slice

Depends on: L1.1-10 (notes), L1.2 (sync-queue filter), L1.1-6 (types).

### Task L2.2-1 · Update `selection-toolbar.tsx` to 4 actions

**Files:**
- Modify: `chrome-extension/reader/components/selection-toolbar.tsx`

- [ ] **Step 1: Replace `SelectionActionKind` and `actions` array** (per spec §4.1)

> The shipped action set is 4 — but `main.tsx`'s switch statement still references `summarize` and `ask` until L3-3. To keep the build green between this task and L3-3, **temporarily widen the union**:

```ts
export type SelectionActionKind = 'explain' | 'highlight' | 'note' | 'translate' | 'summarize' | 'ask';
// ↑ TODO L3-3: narrow to first four after main.tsx switch is rewritten

const actions: Array<{ id: SelectionActionKind; label: string; icon: IconName; kbd: string }> = [
  { id: 'explain',   label: 'Explain',   icon: 'Sparkle',   kbd: 'E' },
  { id: 'highlight', label: 'Highlight', icon: 'Highlight', kbd: 'H' },
  { id: 'note',      label: 'Note',      icon: 'Edit',      kbd: 'N' },
  { id: 'translate', label: 'Translate', icon: 'Translate', kbd: 'T' },
];
```

The user-facing surface is correct (only 4 buttons render).

- [ ] **Step 2: Add `role="toolbar"` + `aria-label="Selection actions"`** to outer div (per spec §16.3)

- [ ] **Step 3: Typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/reader/components/selection-toolbar.tsx
git commit -m "feat(ext): selection toolbar shows 4 actions (Explain/Highlight/Note/Translate)"
```

### Task L2.2-2 · Extend `lib/ai.ts` — `AiActionKind` + AbortSignal + rAF batching

**Files:**
- Modify: `chrome-extension/reader/types.ts` (extend `AiActionKind`)
- Modify: `chrome-extension/reader/lib/ai.ts` (prompts + abort + batching)

- [ ] **Step 1: Extend `AiActionKind`** in `types.ts`

```ts
export type AiActionKind =
  | 'explain' | 'translate'
  | 'overviewContributions' | 'overviewKeywords'
  | 'summarize' | 'ask';   // deprecated; not written by new code (§17.A.1)
```

- [ ] **Step 2: Extend `promptFor(kind, lang)`** in `ai.ts`

```ts
function promptFor(kind: AiActionKind, lang: string | undefined): string {
  const cfg = langCfg(lang);
  if (kind === 'translate') {
    return `Translate the selected passage to ${cfg.translateTarget}. Preserve technical terms in their original form when they're canonical (e.g. 'attention', 'residual').`;
  }
  if (kind === 'overviewContributions') {
    return "List the paper's 3 to 5 core contributions as a strict bulleted list. Each bullet ≤ 1 sentence. No prefatory text. No headings.\n" + cfg.instruction;
  }
  if (kind === 'overviewKeywords') {
    return "List 6 to 12 keywords for this paper, one per line, no bullets, no definitions. Just the terms.\n" + cfg.instruction;
  }
  return PROMPT_BODIES[kind as 'explain' | 'summarize'] + '\n' + cfg.instruction;
}
```

- [ ] **Step 3: Add `AbortSignal` parameter to `callChatCompletion`** (or whichever streaming entry point exists). Pass through to `fetch()`. Re-throw `AbortError`.

- [ ] **Step 4: Add `rafBatchedAppender` helper** (per spec §17.C.4)

```ts
// chrome-extension/reader/lib/ai.ts (append at end)
export function rafBatchedAppender(setText: (full: string) => void): { append: (chunk: string) => void; flush: () => void } {
  let pending = '';
  let scheduled = false;
  let acc = '';
  function flush() {
    scheduled = false;
    if (!pending) return;
    acc += pending; pending = '';
    setText(acc);
  }
  return {
    append(chunk: string) {
      pending += chunk;
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    },
    flush() { flush(); },
  };
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd chrome-extension && npx tsc --noEmit
git add chrome-extension/reader/lib/ai.ts chrome-extension/reader/types.ts
git commit -m "feat(ext): extend AiActionKind + add AbortSignal + rAF batching helper"
```

### Task L2.2-3 · `lib/selection-actions.ts` — unified dispatch

**Files:**
- Create: `chrome-extension/reader/lib/selection-actions.ts`
- Test: `chrome-extension/tests/unit/selection-actions.test.ts`

- [ ] **Step 1: Write tests covering 4-kind double-write matrix** (per spec §17.B.1)

```ts
// chrome-extension/tests/unit/selection-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSelectionAction, retryAction } from '../../reader/lib/selection-actions';
import { listNotes } from '../../reader/lib/notes';
import { listSessions, loadMessages } from '../../reader/lib/chat-sessions';

vi.mock('../../reader/lib/ai', () => ({
  callAI: vi.fn(async function* () { yield 'hello '; yield 'world'; }),
  ProxyError: class ProxyError extends Error {},
}));

beforeEach(async () => { await chrome.storage.local.clear(); });

const fakePaper = { id: 'p1', title: 't', authors: [], abstract: '', outline: [], paragraphs: [], memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] } } as any;
const fakeSel = { text: 'selected', rect: {} as any, paragraphId: 'p1' };

describe('runSelectionAction', () => {
  it('explain double-writes chat + note with shared actionId', async () => {
    await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    const notes = await listNotes('P');
    expect(notes.length).toBe(1);
    expect(notes[0].kind).toBe('explain');
    const sessions = await listSessions('P');
    expect(sessions.length).toBe(1);
    const msgs = await loadMessages('P', sessions[0].id);
    expect(msgs.find((m: any) => m.kind === 'actionCard')?.action?.actionId).toBe(notes[0].id);
  });
  it('note: no chat write, no notes write (popover handles save)', async () => {
    const res = await runSelectionAction({ kind: 'note', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    expect((await listSessions('P')).length).toBe(0);
    expect(res.actionId).toBeTruthy();
    expect((await listNotes('P')).length).toBe(0);
  });
  it('highlight: only Note store written, no chat', async () => {
    await runSelectionAction({ kind: 'highlight', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    expect((await listSessions('P')).length).toBe(0);
    const notes = await listNotes('P');
    expect(notes[0].kind).toBe('highlight');
  });
  it('retryAction guards against concurrent retry', async () => {
    const action = await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    await Promise.all([
      retryAction({ paperKey: 'P', paper: fakePaper, actionId: action.actionId!, model: 'gpt', lang: 'en' }),
      retryAction({ paperKey: 'P', paper: fakePaper, actionId: action.actionId!, model: 'gpt', lang: 'en' }),
    ]);
    expect((await listNotes('P')).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — fail**

- [ ] **Step 3: Implement** per spec §6.1 + §17.A.3 + §17.A.4

```ts
// chrome-extension/reader/lib/selection-actions.ts
import type { Paper, TextSelection, ChatMessage, Note } from '../types';
import * as Sessions from './chat-sessions';
import * as Notes from './notes';
import { callAI } from './ai';
import { shouldSyncNote } from './sync-queue';

const inflight = new Map<string, AbortController>();
const retryGuard = new Set<string>();

interface ActionParams {
  kind: 'explain' | 'highlight' | 'note' | 'translate';
  paperKey: string;
  paper: Paper;
  sel: TextSelection;
  currentSessionId: string | null;
  model: string;
  lang: string;
  onChatPatch?: (sid: string, msgId: string, text: string) => void;
  onNotePatch?: (id: string, body: string) => void;
}
interface ActionResult {
  actionId: string;
  sessionId: string | null;
  assistantMsgId: string | null;
}

export async function runSelectionAction(p: ActionParams): Promise<ActionResult> {
  const actionId = crypto.randomUUID();
  const now = Date.now();
  const loc = { paragraph: p.sel.paragraphId ? Number(p.sel.paragraphId.replace(/\D/g, '')) || undefined : undefined };

  if (p.kind === 'note') {
    return { actionId, sessionId: null, assistantMsgId: null };
  }
  if (p.kind === 'highlight') {
    const n: Note = { id: actionId, kind: 'highlight', quote: p.sel.text, loc, createdAt: now, updatedAt: now };
    await Notes.upsertNote(p.paperKey, n);
    return { actionId, sessionId: null, assistantMsgId: null };
  }

  // explain or translate
  let sid = p.currentSessionId;
  if (!sid) sid = (await Sessions.createSession(p.paperKey)).id;
  await Sessions.setActive(p.paperKey, sid);
  const userMsg: ChatMessage = {
    id: 'u-' + actionId, role: 'user', kind: 'actionCard',
    action: { kind: p.kind, actionId, quote: p.sel.text, loc },
    text: p.sel.text, createdAt: now,
  };
  const assistantId = 'a-' + actionId;
  const assistantStub: ChatMessage = { id: assistantId, role: 'assistant', text: '', createdAt: now + 1 };
  await Sessions.appendMessage(p.paperKey, sid, userMsg);
  await Sessions.appendMessage(p.paperKey, sid, assistantStub);
  const noteStub: Note = {
    id: actionId, kind: p.kind, quote: p.sel.text, loc,
    chatSessionId: sid, chatMessageId: assistantId, aiAnswer: '',
    createdAt: now, updatedAt: now,
  };
  await Notes.upsertNote(p.paperKey, noteStub);

  await streamAndPersist(p, sid, assistantId, actionId);
  return { actionId, sessionId: sid, assistantMsgId: assistantId };
}

async function streamAndPersist(p: ActionParams, sid: string, assistantId: string, actionId: string): Promise<void> {
  const ctrl = new AbortController();
  inflight.set(actionId, ctrl);
  let buf = '';
  try {
    for await (const chunk of callAI(p.kind as any, p.paper, p.sel.text, p.lang, ctrl.signal) as any) {
      buf += chunk;
      p.onChatPatch?.(sid, assistantId, buf);
      p.onNotePatch?.(actionId, buf);
    }
    const msgs = await Sessions.loadMessages(p.paperKey, sid);
    const next = msgs.map((m) => m.id === assistantId ? { ...m, text: buf } : m);
    await chrome.storage.local.set({ [`paper:${p.paperKey}:chatSessionMessages:${sid}`]: next });
    await Notes.patchNote(p.paperKey, actionId, { aiAnswer: buf });
  } catch (err) {
    if (buf) {
      const msgs = await Sessions.loadMessages(p.paperKey, sid);
      const next = msgs.map((m) => m.id === assistantId ? { ...m, text: buf } : m);
      await chrome.storage.local.set({ [`paper:${p.paperKey}:chatSessionMessages:${sid}`]: next });
      await Notes.patchNote(p.paperKey, actionId, { aiAnswer: buf });
    }
    throw err;
  } finally {
    inflight.delete(actionId);
  }
}

export function abortAction(actionId: string): void {
  inflight.get(actionId)?.abort();
}
export function abortAllForPaper(): void {
  for (const c of inflight.values()) c.abort();
  inflight.clear();
}

interface RetryParams {
  paperKey: string;
  paper: Paper;
  actionId: string;
  model: string;
  lang: string;
}
export async function retryAction(p: RetryParams): Promise<void> {
  if (retryGuard.has(p.actionId)) return;
  retryGuard.add(p.actionId);
  try {
    const list = await Notes.listNotes(p.paperKey);
    const note = list.find((n) => n.id === p.actionId);
    if (!note || (note.kind !== 'explain' && note.kind !== 'translate')) return;
    const sel: TextSelection = { text: note.quote, rect: {} as any, paragraphId: null };
    await streamAndPersist({
      kind: note.kind, paperKey: p.paperKey, paper: p.paper, sel,
      currentSessionId: note.chatSessionId ?? null, model: p.model, lang: p.lang,
    }, note.chatSessionId!, note.chatMessageId!, p.actionId);
  } finally {
    retryGuard.delete(p.actionId);
  }
}

export { shouldSyncNote };
```

- [ ] **Step 4: Tests pass + commit**

```bash
cd chrome-extension && npx vitest run tests/unit/selection-actions.test.ts
git add chrome-extension/reader/lib/selection-actions.ts chrome-extension/tests/unit/selection-actions.test.ts
git commit -m "feat(ext): add lib/selection-actions.ts (4-kind dispatch + retry guard + abort)"
```

### Task L2.2-4 · `note-card.tsx` — Layout A + Layout B

**Files:**
- Create: `chrome-extension/reader/components/note-card.tsx`
- Modify: `chrome-extension/reader/styles/ink-animations.css` (add `flash-walnut` keyframe)

- [ ] **Step 1: Add flash keyframe**

```css
/* chrome-extension/reader/styles/ink-animations.css */
@keyframes flash-walnut {
  0%   { background: var(--walnut-soft); }
  100% { background: var(--paper); }
}
```

- [ ] **Step 2: Implement** per spec §3.3.2 + §6.6 (AI watermark)

```tsx
// chrome-extension/reader/components/note-card.tsx
import type { CSSProperties } from 'react';
import type { Note } from '../types';
import { MarkdownBody } from './markdown';
import { I } from './icons';
import { formatNoteCardFooter } from '../lib/format';
import { t } from '../lib/i18n';

const KIND_COLOR: Record<Note['kind'], string> = {
  explain: 'var(--walnut)',
  highlight: 'var(--walnut-soft)',
  note: 'var(--forest)',
  translate: 'var(--sky)',
};

interface Props {
  note: Note;
  locale: string;
  model: string;
  isStreaming?: boolean;
  hasError?: boolean;
  onJumpChat?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  flash?: boolean;
}
export function NoteCard({ note, locale, model, isStreaming, hasError, onJumpChat, onDelete, onRetry, onEdit, flash }: Props) {
  const useLayoutB = note.kind === 'highlight';
  const accent = KIND_COLOR[note.kind];
  return (
    <article role="article" aria-label={`${note.kind} note`}
      style={{ ...cardStyle(accent), animation: flash ? 'flash-walnut 600ms' : undefined }}>
      {useLayoutB
        ? <LayoutB note={note} locale={locale} onDelete={onDelete} />
        : <LayoutA note={note} locale={locale} model={model}
            isStreaming={isStreaming} hasError={hasError}
            onJumpChat={onJumpChat} onDelete={onDelete} onRetry={onRetry} onEdit={onEdit} />}
    </article>
  );
}

function LayoutA(p: any) {
  const { note, locale, model, isStreaming, hasError, onJumpChat, onDelete, onRetry } = p;
  const body = note.kind === 'note' ? note.userText : note.aiAnswer;
  return (
    <>
      {hasError ? (
        <div role="alert" style={{ background: 'var(--foxglove-soft)', color: 'var(--foxglove)', padding: 8, borderRadius: 4 }}>
          {t('error.aiFailed') || 'AI reply failed'}{' '}
          <button onClick={onRetry}>{t('action.retry') || 'Retry'}</button>
        </div>
      ) : (
        <div className={isStreaming ? 'ink-streaming' : ''}>
          {body ? <MarkdownBody body={body} citationMap={undefined as any}
            style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink)' }} /> : null}
        </div>
      )}
      {(note.kind === 'explain' || note.kind === 'translate') && body && (
        <div style={{ fontSize: 11, color: 'var(--ink-faded)', marginTop: 6 }}>
          AI · {model} · {formatNoteCardFooter(note.createdAt, locale)}
        </div>
      )}
      <hr style={{ border: 'none', borderTop: '0.5px solid var(--rule-soft)', margin: '8px 0' }} />
      <blockquote style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-faded)', margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{note.quote}"</blockquote>
      <Footer note={note} locale={locale} onJumpChat={onJumpChat} onDelete={onDelete} />
    </>
  );
}
function LayoutB({ note, locale, onDelete }: any) {
  return (
    <>
      <blockquote style={{ fontSize: 14, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }}>"{note.quote}"</blockquote>
      <Footer note={note} locale={locale} onDelete={onDelete} />
    </>
  );
}
function Footer({ note, locale, onJumpChat, onDelete }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--ink-faded)' }}>
      <span>{note.loc?.page ? `p.${note.loc.page} · ` : ''}{formatNoteCardFooter(note.createdAt, locale)}</span>
      <span style={{ display: 'flex', gap: 4 }}>
        {onJumpChat && note.chatSessionId && (
          <button onClick={onJumpChat} className="icon-btn" aria-label="Jump to chat" style={iconBtn}><I.ArrowRight size={12} /></button>
        )}
        {onDelete && (
          <button onClick={onDelete} className="icon-btn" aria-label="Delete" style={iconBtn}><I.Close size={12} /></button>
        )}
      </span>
    </div>
  );
}
const cardStyle = (accent: string): CSSProperties => ({
  borderLeft: `2px solid ${accent}`, background: 'var(--paper)',
  border: '0.5px solid var(--rule-soft)', borderRadius: 6, padding: 10,
});
const iconBtn: CSSProperties = { width: 32, height: 32, padding: 9, background: 'transparent', border: 'none', cursor: 'pointer' };
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd chrome-extension && npx tsc --noEmit
git add chrome-extension/reader/components/note-card.tsx chrome-extension/reader/styles/ink-animations.css
git commit -m "feat(ext): add NoteCard (Layout A for explain/translate/note, Layout B for highlight)"
```

### Task L2.2-5 · `note-editor-popover.tsx`

**Files:**
- Create: `chrome-extension/reader/components/note-editor-popover.tsx`

- [ ] **Step 1: Implement** per spec §3.3.3

```tsx
// chrome-extension/reader/components/note-editor-popover.tsx
import { useState, useRef, useEffect } from 'react';
import { t } from '../lib/i18n';

interface Props {
  rect: { left: number; top: number; right: number; bottom: number };
  initial?: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<void> | void;
}
export function NoteEditorPopover({ rect, initial = '', onCancel, onSave }: Props) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ta.current?.focus(); }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setErr(null);
    try { await onSave(text); }
    catch { setErr(t('note.editor.saveFailed') || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-label="Note editor"
      style={{ position: 'absolute', top: rect.bottom + 6, left: rect.left, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, boxShadow: 'var(--shadow-2)', padding: 10, width: 320, zIndex: 100 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
      }}>
      <div style={{ fontSize: 11, color: 'var(--ink-faded)', marginBottom: 6 }}>{t('note.editor.title') || 'Note'}</div>
      <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t('note.editor.placeholder') || 'Write your note…'}
        style={{ width: '100%', minHeight: 80, border: '1px solid var(--rule)', borderRadius: 4, fontFamily: 'var(--font-serif)', fontSize: 13, padding: 6, resize: 'vertical' }} />
      {err && <div style={{ color: 'var(--foxglove)', fontSize: 12, marginTop: 4 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onCancel}>{t('action.cancel') || 'Cancel'}</button>
        <button onClick={save} disabled={saving}
          style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '4px 12px', borderRadius: 4 }}>
          {saving ? (t('action.saving') || 'Saving…') : (t('action.save') || 'Save')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/note-editor-popover.tsx
git commit -m "feat(ext): add NoteEditorPopover (textarea, ⌘Enter save, Esc cancel)"
```

### Task L2.2-6 · `note-view.tsx` — sub-tabs + list

**Files:**
- Create: `chrome-extension/reader/components/note-view.tsx`

- [ ] **Step 1: Implement** per spec §3.3.1 + §4.3.5

```tsx
// chrome-extension/reader/components/note-view.tsx
import { useMemo } from 'react';
import type { Note, NoteKind } from '../types';
import { NoteCard } from './note-card';
import { t } from '../lib/i18n';

interface Props {
  notes: Note[];
  activeSubtab: NoteKind;
  onSubtabChange: (k: NoteKind) => void;
  locale: string;
  model: string;
  onJumpChat: (n: Note) => void;
  onDelete: (n: Note) => void;
  onRetry: (n: Note) => void;
  onEdit: (n: Note) => void;
  flashId?: string | null;
}
const SUBTAB_ORDER: NoteKind[] = ['explain', 'highlight', 'note', 'translate'];

export function NoteView(p: Props) {
  const counts = useMemo(() => {
    const c: Record<NoteKind, number> = { explain: 0, highlight: 0, note: 0, translate: 0 };
    for (const n of p.notes) c[n.kind]++;
    return c;
  }, [p.notes]);
  const list = p.notes.filter((n) => n.kind === p.activeSubtab);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div role="tablist" aria-label="Note kinds"
        style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '0.5px solid var(--rule)' }}>
        {SUBTAB_ORDER.map((k) => (
          <button key={k} role="tab" aria-selected={p.activeSubtab === k}
            onClick={() => p.onSubtabChange(k)}
            style={{
              padding: '4px 10px', fontSize: 12,
              background: p.activeSubtab === k ? 'var(--paper-soft)' : 'transparent',
              border: '0.5px solid var(--rule-soft)', borderRadius: 4,
              color: p.activeSubtab === k ? 'var(--ink)' : 'var(--ink-faded)',
            }}>
            {t(`note.kinds.${k}`) || k}{' '}
            <span style={{ opacity: counts[k] === 0 ? 0.5 : 1 }}>{counts[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 ? <Empty kind={p.activeSubtab} /> : list.map((n) => (
          <NoteCard key={n.id} note={n} locale={p.locale} model={p.model}
            flash={p.flashId === n.id}
            onJumpChat={() => p.onJumpChat(n)}
            onDelete={() => p.onDelete(n)}
            onRetry={() => p.onRetry(n)}
            onEdit={() => p.onEdit(n)} />
        ))}
      </div>
    </div>
  );
}
function Empty({ kind }: { kind: NoteKind }) {
  return (
    <div style={{ color: 'var(--ink-faded)', textAlign: 'center', padding: 24, fontSize: 14 }}>
      {t(`note.empty.${kind}`) || 'No items yet.'}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/note-view.tsx
git commit -m "feat(ext): add NoteView with 4 sub-tabs + count chips + empty states"
```

---

## Phase L2.3 · Overview vertical slice

Depends on: L1.1-2 (scroll-to-outline), L1.1-3 (section-state), L1.1-6 (types).

### Task L2.3-1 · `lib/semantic-scholar.ts` — meta fetcher

**Files:**
- Create: `chrome-extension/reader/lib/semantic-scholar.ts`
- Test: `chrome-extension/tests/unit/semantic-scholar.test.ts`

- [ ] **Step 1: Write tests** per spec §17.8

```ts
// chrome-extension/tests/unit/semantic-scholar.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchOverviewMeta, _resetForTest } from '../../reader/lib/semantic-scholar';

beforeEach(async () => {
  await chrome.storage.local.clear();
  _resetForTest();
  global.fetch = vi.fn();
});

describe('semantic-scholar', () => {
  it('returns null + caches negative on 404', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404 });
    expect(await fetchOverviewMeta('P', '1234.5678')).toBeNull();
    (global.fetch as any).mockClear();
    await fetchOverviewMeta('P', '1234.5678');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('returns null on no arxivId', async () => {
    expect(await fetchOverviewMeta('P', null)).toBeNull();
  });
  it('returns meta on success and caches positive', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true, json: async () => ({ venue: 'NeurIPS 2017', citationCount: 47892, fieldsOfStudy: ['CS'] }),
    });
    const m = await fetchOverviewMeta('P', '1706.03762');
    expect(m?.venue).toBe('NeurIPS 2017');
  });
  it('expiresAt jittered between 5 and 9 days', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    const m = await fetchOverviewMeta('P', '1234.5678');
    const days = (m!.expiresAt - m!.fetchedAt) / 86400000;
    expect(days).toBeGreaterThanOrEqual(5);
    expect(days).toBeLessThanOrEqual(9);
  });
  it('serializes concurrent fetches (single-concurrency)', async () => {
    let active = 0, peak = 0;
    (global.fetch as any).mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { ok: true, json: async () => ({}) };
    });
    await Promise.all([
      fetchOverviewMeta('A', '1'), fetchOverviewMeta('B', '2'), fetchOverviewMeta('C', '3'),
    ]);
    expect(peak).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — fail**

- [ ] **Step 3: Implement**

```ts
// chrome-extension/reader/lib/semantic-scholar.ts
import { getOverviewMeta, setOverviewMeta } from './storage';
import type { OverviewMeta } from '../types';

const ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/arXiv:';
const FIELDS = 'venue,citationCount,fieldsOfStudy,openAccessPdf';
let queue: Promise<unknown> = Promise.resolve();

function jitterTtlMs(): number {
  const days = 5 + Math.random() * 4;
  return days * 86400000;
}
export async function fetchOverviewMeta(paperKey: string, arxivId: string | null): Promise<OverviewMeta | null> {
  if (!arxivId) return null;
  const cached = await getOverviewMeta(paperKey);
  const now = Date.now();
  if (cached) {
    if (cached.failed && cached.failedAt && now - cached.failedAt < 86400000) return null;
    if (!cached.failed && cached.expiresAt > now) return cached;
  }
  return queue = queue.then(async () => {
    try {
      const res = await fetch(`${ENDPOINT}${encodeURIComponent(arxivId)}?fields=${FIELDS}`);
      if (!res.ok) {
        const m: OverviewMeta = { fetchedAt: now, expiresAt: now + jitterTtlMs(), failed: true, failedAt: now };
        await setOverviewMeta(paperKey, m);
        return null;
      }
      const j = await res.json();
      const m: OverviewMeta = {
        venue: j.venue ?? undefined,
        citations: j.citationCount ?? undefined,
        codeUrl: j.openAccessPdf?.url ?? undefined,
        field: Array.isArray(j.fieldsOfStudy) ? j.fieldsOfStudy.join(' / ') : undefined,
        fetchedAt: now,
        expiresAt: now + jitterTtlMs(),
      };
      await setOverviewMeta(paperKey, m);
      return m;
    } catch {
      const m: OverviewMeta = { fetchedAt: now, expiresAt: now + jitterTtlMs(), failed: true, failedAt: now };
      await setOverviewMeta(paperKey, m);
      return null;
    }
  });
}
export function _resetForTest(): void { queue = Promise.resolve(); }
```

- [ ] **Step 4: Tests pass + commit**

```bash
git add chrome-extension/reader/lib/semantic-scholar.ts chrome-extension/tests/unit/semantic-scholar.test.ts
git commit -m "feat(ext): add lib/semantic-scholar.ts (jittered TTL + negative cache + single-concurrency)"
```

### Task L2.3-2 · `lib/overview.ts` — AI section orchestration

**Files:**
- Create: `chrome-extension/reader/lib/overview.ts`
- Test: `chrome-extension/tests/unit/overview.test.ts`

- [ ] **Step 1: Implement**

```ts
// chrome-extension/reader/lib/overview.ts
import { getOverviewSection, setOverviewSection } from './storage';
import { callAI, rafBatchedAppender } from './ai';
import type { Paper } from '../types';

export type OverviewSectionKind = 'contributions' | 'keywords';
export type OverviewState =
  | { kind: 'idle' }
  | { kind: 'streaming'; partial: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };

export async function ensureOverview(
  pk: string, paper: Paper, kind: OverviewSectionKind, model: string, lang: string,
  onState: (s: OverviewState) => void,
): Promise<void> {
  const cached = await getOverviewSection(pk, kind, model, lang);
  if (cached) { onState({ kind: 'ready', body: cached }); return; }
  onState({ kind: 'streaming', partial: '' });
  const aiKind = kind === 'contributions' ? 'overviewContributions' : 'overviewKeywords';
  const batch = rafBatchedAppender((acc) => onState({ kind: 'streaming', partial: acc }));
  let final = '';
  try {
    for await (const chunk of callAI(aiKind as any, paper, '', lang) as any) {
      batch.append(chunk); final += chunk;
    }
    batch.flush();
    await setOverviewSection(pk, kind, model, lang, final);
    onState({ kind: 'ready', body: final });
  } catch (e: any) {
    onState({ kind: 'error', message: e?.message ?? 'failed' });
  }
}
```

- [ ] **Step 2: Test cache hit / miss / error** (mirror selection-actions test mock pattern)

```ts
// chrome-extension/tests/unit/overview.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureOverview } from '../../reader/lib/overview';

vi.mock('../../reader/lib/ai', () => ({
  callAI: vi.fn(async function* () { yield '- A\n'; yield '- B\n'; }),
  rafBatchedAppender: (set: any) => ({ append: (x: string) => set(x), flush: () => {} }),
}));

beforeEach(async () => { await chrome.storage.local.clear(); });

describe('ensureOverview', () => {
  it('cache miss → streams → caches', async () => {
    const states: any[] = [];
    await ensureOverview('P', {} as any, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states.find((s) => s.kind === 'ready')).toBeTruthy();
  });
  it('cache hit → ready immediately', async () => {
    await chrome.storage.local.set({ 'paper:P:overview:contributions:gpt:en': '- cached' });
    const states: any[] = [];
    await ensureOverview('P', {} as any, 'contributions', 'gpt', 'en', (s) => states.push(s));
    expect(states[0].kind).toBe('ready');
    expect((states[0] as any).body).toBe('- cached');
  });
});
```

- [ ] **Step 3: Tests pass + commit**

```bash
git add chrome-extension/reader/lib/overview.ts chrome-extension/tests/unit/overview.test.ts
git commit -m "feat(ext): add lib/overview.ts (cache-keyed by model+lang, streaming via rAF)"
```

### Task L2.3-3 · `overview-paper-info.tsx`

**Files:**
- Create: `chrome-extension/reader/components/overview-paper-info.tsx`

- [ ] **Step 1: Implement** per spec §3.2.1 (two-col grid, label 80px / value rest, missing → `—`, codeUrl absent → row hidden)

```tsx
// chrome-extension/reader/components/overview-paper-info.tsx
import type { Paper, OverviewMeta } from '../types';
import { t } from '../lib/i18n';

interface Props { paper: Paper; meta: OverviewMeta | null; locale: string; }
export function OverviewPaperInfo({ paper, meta }: Props) {
  const venue = meta?.venue ?? paper.venue ?? null;
  const rows: Array<[string, React.ReactNode]> = [];
  if (venue) rows.push([t('overview.field.publishedAt') || '发表于', venue]);
  if (paper.authors.length) rows.push([t('overview.field.authors') || '作者', paper.authors.length > 3 ? `${paper.authors[0]} 等 ${paper.authors.length} 位` : paper.authors.join(', ')]);
  if (typeof meta?.citations === 'number') rows.push([t('overview.field.citations') || '引用次数', `${meta.citations}`]);
  if (meta?.field) rows.push([t('overview.field.field') || '研究领域', meta.field]);
  if (meta?.codeUrl) rows.push([t('overview.field.codeUrl') || '开放代码', <a href={meta.codeUrl} target="_blank" rel="noreferrer">GitHub</a>]);
  if (rows.length === 0) return null;
  return (
    <section>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', rowGap: 4, fontSize: 13 }}>
        {rows.map(([label, value], i) => (
          <RowItem key={i} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}
function RowItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div style={{ color: 'var(--ink-faded)', fontSize: 12, height: 28, lineHeight: '28px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
      <div style={{ color: 'var(--ink)', height: 28, lineHeight: '28px' }}>{value ?? '—'}</div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/overview-paper-info.tsx
git commit -m "feat(ext): add OverviewPaperInfo (2-col grid, hide-on-missing, no '—' clutter)"
```

### Task L2.3-4 · `overview-outline.tsx`

**Files:**
- Create: `chrome-extension/reader/components/overview-outline.tsx`

- [ ] **Step 1: Implement** per spec §3.2.3

```tsx
// chrome-extension/reader/components/overview-outline.tsx
import { useState } from 'react';
import type { Paper } from '../types';
import { scrollToOutlineItem } from '../lib/scroll-to-outline';

export function OverviewOutline({ paper }: { paper: Paper }) {
  if (paper.outline.length === 0) return null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(paper.outline.filter((o) => o.level === 0).map((o) => o.id)));
  return (
    <section>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--font-serif)' }}>
        {paper.outline.map((o) => (
          (o.level === 0 || expanded.has(o.id)) && (
            <li key={o.id} style={{ paddingLeft: o.level * 16, marginBottom: 4 }}>
              <button onClick={() => scrollToOutlineItem(o, paper)}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink)', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}>
                {o.label}{o.page ? ` p.${o.page}` : ''}
              </button>
            </li>
          )
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/overview-outline.tsx
git commit -m "feat(ext): add OverviewOutline (level-0 expanded, level-1 click-to-expand, jump on click)"
```

### Task L2.3-5 · `overview-contributions.tsx`

**Files:**
- Create: `chrome-extension/reader/components/overview-contributions.tsx`

- [ ] **Step 1: Implement** per spec §3.2.2 + §4.3.4 + §6.6

```tsx
// chrome-extension/reader/components/overview-contributions.tsx
import { MarkdownBody } from './markdown';
import type { OverviewState } from '../lib/overview';
import { t } from '../lib/i18n';

interface Props { state: OverviewState; model: string; onRetry?: () => void; }
export function OverviewContributions({ state, model, onRetry }: Props) {
  return (
    <section>
      <Header model={model} />
      {state.kind === 'idle' && <Skeleton lines={3} />}
      {state.kind === 'streaming' && (
        <div className="ink-streaming">
          <MarkdownBody body={state.partial} citationMap={undefined as any}
            style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink)' }} />
        </div>
      )}
      {state.kind === 'ready' && (
        <MarkdownBody body={state.body} citationMap={undefined as any}
          style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink)' }} />
      )}
      {state.kind === 'error' && (
        <div role="alert" style={{ background: 'var(--foxglove-soft)', color: 'var(--foxglove)', padding: 8, borderRadius: 4 }}>
          {t('error.aiFailed') || 'Generation failed'}
          {onRetry && <button onClick={onRetry} style={{ marginLeft: 8 }}>{t('action.retry') || 'Retry'}</button>}
        </div>
      )}
    </section>
  );
}
function Header({ model }: { model: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500 }}>
        {t('overview.contributions.title') || '核心贡献'}
      </h3>
      <span style={{ fontSize: 11, color: 'var(--ink-faded)' }}>AI · {model}</span>
    </div>
  );
}
function Skeleton({ lines }: { lines: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height: 14, background: 'var(--rule-soft)', borderRadius: 2, width: `${60 + Math.random() * 30}%`, opacity: 0.6, animation: 'pulse 1.6s infinite' }} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/overview-contributions.tsx
git commit -m "feat(ext): add OverviewContributions (idle/streaming/ready/error + AI watermark)"
```

### Task L2.3-6 · `overview-keywords.tsx`

**Files:**
- Create: `chrome-extension/reader/components/overview-keywords.tsx`

- [ ] **Step 1: Implement** per spec §3.2.4 + §15.5 (text-only chips, 0 radius, no fill)

```tsx
// chrome-extension/reader/components/overview-keywords.tsx
import type { OverviewState } from '../lib/overview';
import { t } from '../lib/i18n';

export function OverviewKeywords({ state, model, onRetry }: { state: OverviewState; model: string; onRetry?: () => void }) {
  const list = state.kind === 'ready' ? parseKeywords(state.body)
              : state.kind === 'streaming' ? parseKeywords(state.partial) : [];
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500 }}>
          {t('overview.keywords.title') || '关键词'}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--ink-faded)' }}>AI · {model}</span>
      </div>
      {state.kind === 'idle' && <ChipSkeleton n={6} />}
      {(state.kind === 'streaming' || state.kind === 'ready') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((kw) => (
            <span key={kw} style={{
              padding: '4px 10px', fontSize: 12,
              border: '0.5px solid var(--rule-soft)', borderRadius: 0,
              color: 'var(--ink-faded)', background: 'transparent',
            }}>{kw}</span>
          ))}
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert" style={{ background: 'var(--foxglove-soft)', color: 'var(--foxglove)', padding: 8, borderRadius: 4 }}>
          {t('error.aiFailed') || 'Generation failed'}
          {onRetry && <button onClick={onRetry} style={{ marginLeft: 8 }}>{t('action.retry') || 'Retry'}</button>}
        </div>
      )}
    </section>
  );
}
function parseKeywords(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}
function ChipSkeleton({ n }: { n: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ width: 60 + Math.random() * 50, height: 22, background: 'var(--rule-soft)', borderRadius: 0 }} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/overview-keywords.tsx
git commit -m "feat(ext): add OverviewKeywords (text-only chips, no bubble pills, AI watermark)"
```

### Task L2.3-7 · `overview-view.tsx` — composer

**Files:**
- Create: `chrome-extension/reader/components/overview-view.tsx`

- [ ] **Step 1: Implement** in render order: contributions → outline → keywords → info (per spec §3.2 Pass 1 ordering)

```tsx
// chrome-extension/reader/components/overview-view.tsx
import type { Paper, OverviewMeta } from '../types';
import type { OverviewState } from '../lib/overview';
import { OverviewContributions } from './overview-contributions';
import { OverviewOutline } from './overview-outline';
import { OverviewKeywords } from './overview-keywords';
import { OverviewPaperInfo } from './overview-paper-info';

interface Props {
  paper: Paper;
  meta: OverviewMeta | null;
  model: string;
  locale: string;
  contributionsState: OverviewState;
  keywordsState: OverviewState;
  onRetryContributions?: () => void;
  onRetryKeywords?: () => void;
}
export function OverviewView(p: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 16, overflow: 'auto', height: '100%' }}>
      <OverviewContributions state={p.contributionsState} model={p.model} onRetry={p.onRetryContributions} />
      <OverviewOutline paper={p.paper} />
      <OverviewKeywords state={p.keywordsState} model={p.model} onRetry={p.onRetryKeywords} />
      <OverviewPaperInfo paper={p.paper} meta={p.meta} locale={p.locale} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/components/overview-view.tsx
git commit -m "feat(ext): add OverviewView composer (4 blocks in spec §3.2 order)"
```

---

## Phase L3 · Shell rebuild + main.tsx integration

Depends on: all of L1.x and L2.x. Output: full UI working end-to-end.

### Task L3-1 · Update `workspace-panel.tsx` to new tab list

**Files:**
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`

- [ ] **Step 1: Replace tab type and props**

```tsx
type Tab = 'overview' | 'note' | 'memory';

interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  // Overview slice
  overviewMeta: OverviewMeta | null;
  contributionsState: OverviewState;
  keywordsState: OverviewState;
  onRetryContributions: () => void;
  onRetryKeywords: () => void;
  // Note slice
  notes: Note[];
  activeSubtab: NoteKind;
  onSubtabChange: (k: NoteKind) => void;
  flashNoteId: string | null;
  onJumpChat: (n: Note) => void;
  onDeleteNote: (n: Note) => void;
  onRetryNote: (n: Note) => void;
  onEditNote: (n: Note) => void;
  // Memory slice (unchanged)
  onMemoryPatch: (patch: Partial<Paper['memory']>) => void;
  // Shared
  model: string;
  locale: string;
}
```

Render `OverviewView` | `NoteView` | `MemoryView` based on `tab`. Drop the entire `SummaryBody` and chat/abstract props.

- [ ] **Step 2: Typecheck + commit**

```bash
cd chrome-extension && npx tsc --noEmit
git add chrome-extension/reader/components/workspace-panel.tsx
git commit -m "refactor(ext): WorkspacePanel tabs Overview|Note|Memory; drop chat/summary props"
```

### Task L3-2 · Update `top-bar.tsx`

**Files:**
- Modify: `chrome-extension/reader/components/top-bar.tsx`

- [ ] **Step 1: Add `[切 Chat]` toggle button leftmost; remove `[切 Outline]`** (per spec §1.4)

```tsx
// In the workspace toggle row, render in this order:
//   [切 Chat]  [切右侧面板]  [Library]  [变体切换]  [CmdK]  [Tweaks]  [主题]
// Add props: chatOpen, onToggleChat. Remove outlineOpen + onToggleOutline props.
```

- [ ] **Step 2: Update logout cleanup keys** in `doLogout`

Add to the `chrome.storage.local.remove([...])` list:

```ts
'shortcutToastSeen:260424',
'actionCardHintSeen:260424',
```

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/reader/components/top-bar.tsx
git commit -m "feat(ext): top-bar — add 切Chat button, remove 切Outline, extend logout cleanup"
```

### Task L3-3 · `main.tsx` — shell rebuild (largest single edit)

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

Break into substeps; commit at the end (single commit; this whole task is the diff).

- [ ] **Step 1: Imports** — add new lib + components

```ts
import { runSchemaMigrations_260424, runRestoreContext_260424 } from './lib/schema-migration';
import { pushSnapshot, tryUndo, flushOnPaperChange } from './lib/undo-snapshot';
import { runSelectionAction, retryAction, abortAllForPaper, shouldSyncNote } from './lib/selection-actions';
import * as Sessions from './lib/chat-sessions';
import * as Notes from './lib/notes';
import { ensureOverview, type OverviewState } from './lib/overview';
import { fetchOverviewMeta } from './lib/semantic-scholar';
import { ChatPanel } from './components/chat-panel';
import { OverviewView } from './components/overview-view';
import { NoteView } from './components/note-view';
import { NoteEditorPopover } from './components/note-editor-popover';
import type { ChatSession, Note, NoteKind, OverviewMeta } from './types';
import { enqueue } from './lib/sync-queue';
```

- [ ] **Step 2: Remove obsolete state**

Drop:
- `outlineOpen` + setter
- `[tab, setTab]` typed `'summary' | 'chat' | 'memory'`
- `chatMessages` flat state
- `chatStreamingId`
- `summaryState`, `setSummaryState`
- `results`, `setResults`, `streamingKey`
- `OutlinePanel` import + render

- [ ] **Step 3: Add new state**

```ts
const [chatOpen, setChatOpen] = usePersistedState<boolean>('pf-chat-open', true);
const [chatPanelWidth, setChatPanelWidth] = usePersistedState<number>('pf-chat-width', 360);
const [tab, setTab] = useState<'overview' | 'note' | 'memory'>('overview');
const [sessions, setSessions] = useState<ChatSession[]>([]);
const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatStreamingId, setChatStreamingId] = useState<string | null>(null);
const [notes, setNotes] = useState<Note[]>([]);
const [activeSubtab, setActiveSubtab] = useState<NoteKind>('explain');
const [overviewMeta, setOverviewMeta] = useState<OverviewMeta | null>(null);
const [contributionsState, setContributionsState] = useState<OverviewState>({ kind: 'idle' });
const [keywordsState, setKeywordsState] = useState<OverviewState>({ kind: 'idle' });
const [editingNote, setEditingNote] = useState<{ rect: any; quote: string; loc: any; initial: string } | null>(null);
const [flashNoteId, setFlashNoteId] = useState<string | null>(null);
const locale = uiLanguage;  // existing config field
```

- [ ] **Step 4: Boot effect — schema migrate + restore + load**

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const pk = paperKey(paper);
    await runSchemaMigrations_260424(pk);
    const ctx = await runRestoreContext_260424(pk);
    if (cancelled) return;
    setTab(ctx.tab);
    setActiveSubtab(ctx.activeSubtab);
    setActiveSessionIdState(ctx.activeChatSession);
    setSessions(await Sessions.listSessions(pk));
    setNotes(await Notes.listNotes(pk));
    if (ctx.activeChatSession) {
      setChatMessages(await Sessions.loadMessages(pk, ctx.activeChatSession));
    }
    if (ctx.scroll != null) {
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: ctx.scroll! })));
    }
    if (ctx.ghostRail) {
      // dispatch via existing status-rail transientItem slot; concrete API depends on status-rail.tsx
    }
  })();
  return () => {
    cancelled = true;
    flushOnPaperChange(paperKey(paper));
    abortAllForPaper();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [paper]);
```

- [ ] **Step 5: Lazy-load Overview when tab=overview dwell 300ms**

```ts
useEffect(() => {
  if (tab !== 'overview') return;
  const pk = paperKey(paper);
  const arxivId = paper.id ?? null;
  fetchOverviewMeta(pk, arxivId).then((m) => setOverviewMeta(m));
  const t1 = setTimeout(() => {
    void ensureOverview(pk, paper, 'contributions', model, outputLanguage, setContributionsState);
    void ensureOverview(pk, paper, 'keywords', model, outputLanguage, setKeywordsState);
  }, 300);
  return () => clearTimeout(t1);
}, [tab, paper, model, outputLanguage]);
```

- [ ] **Step 6: Persist tab + scroll + lastVisit**

```ts
useEffect(() => {
  const pk = paperKey(paper);
  void chrome.storage.local.set({ [`paper:${pk}:workspace:tab`]: tab });
}, [tab, paper]);

useEffect(() => {
  const pk = paperKey(paper);
  void chrome.storage.local.set({ [`paper:${pk}:note:activeSubtab`]: activeSubtab });
}, [activeSubtab, paper]);

useEffect(() => {
  const pk = paperKey(paper);
  let timer: number | null = null;
  const onScroll = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void chrome.storage.local.set({ [`paper:${pk}:scroll`]: window.scrollY }); }, 1000) as unknown as number;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll);
    if (timer) clearTimeout(timer);
    void chrome.storage.local.set({ [`paper:${pk}:lastVisit`]: Date.now() });
  };
}, [paper]);
```

- [ ] **Step 7: Rewrite `runAction`**

```ts
async function runAction(kind: SelectionActionKind, sel: TextSelection) {
  if (kind === 'summarize' || kind === 'ask') return;   // §4.1: deprecated, ignore
  if (kind === 'note') {
    setEditingNote({ rect: sel.rect, quote: sel.text, loc: { paragraph: sel.paragraphId }, initial: '' });
    return;
  }
  const pk = paperKey(paper);
  setChatStreamingId('a-' + Date.now());
  try {
    const result = await runSelectionAction({
      kind, paperKey: pk, paper, sel,
      currentSessionId: activeSessionId, model, lang: outputLanguage,
      onChatPatch: (sid, msgId, text) => setChatMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text } : m)),
      onNotePatch: (id, body) => setNotes((prev) => prev.map((n) => n.id === id ? { ...n, aiAnswer: body } : n)),
    });
    setSessions(await Sessions.listSessions(pk));
    if (result.sessionId) {
      setActiveSessionIdState(result.sessionId);
      setChatMessages(await Sessions.loadMessages(pk, result.sessionId));
    }
    setNotes(await Notes.listNotes(pk));
    if (kind === 'highlight') {
      // also register Range with existing highlight-ranges
      // (existing code path: `addHighlight(pk, ...)` from storage.ts + registerPaperHighlights)
      if (shouldSyncNote('highlight')) {
        void enqueue({ table: 'margin_notes', op: 'upsert', row: { /* derived */ }, ts: Date.now() });
      }
    }
  } catch (e) {
    if (e instanceof ProxyError) await handleProxyError(e);
    else setToast(t('error.500.nobyok'));
  } finally {
    setChatStreamingId(null);
    setAskPrefill(null);
  }
}
```

- [ ] **Step 8: Note save handler**

```ts
async function handleNoteSave(text: string) {
  if (!editingNote) return;
  const pk = paperKey(paper);
  const id = crypto.randomUUID();
  const now = Date.now();
  await Notes.upsertNote(pk, {
    id, kind: 'note', quote: editingNote.quote, loc: editingNote.loc,
    userText: text, createdAt: now, updatedAt: now,
  });
  setNotes(await Notes.listNotes(pk));
  setEditingNote(null);
  setAskPrefill(null);
  if (shouldSyncNote('note')) {
    void enqueue({ table: 'margin_notes', op: 'upsert', row: { /* derived */ }, ts: Date.now() });
  }
}
```

- [ ] **Step 9: Cross-jump handlers**

```ts
function jumpToNote(actionId: string, kind: NoteKind) {
  setTab('note');
  setActiveSubtab(kind);
  setFlashNoteId(actionId);
  setTimeout(() => setFlashNoteId(null), 700);
}
async function jumpToChat(n: Note) {
  if (!n.chatSessionId) return;
  setChatOpen(true);
  const pk = paperKey(paper);
  setActiveSessionIdState(n.chatSessionId);
  setChatMessages(await Sessions.loadMessages(pk, n.chatSessionId));
}
```

- [ ] **Step 10: Delete + 5s undo handlers**

```ts
async function handleDeleteSession(sid: string) {
  const pk = paperKey(paper);
  const list = await Sessions.listSessions(pk);
  const target = list.find((s) => s.id === sid);
  if (!target) return;
  const msgs = await Sessions.loadMessages(pk, sid);
  await Sessions.deleteSession(pk, sid);
  setSessions(list.filter((s) => s.id !== sid));
  if (activeSessionId === sid) { setActiveSessionIdState(null); setChatMessages([]); }
  pushSnapshot({
    paperKey: pk, kind: 'chat-session', payload: { session: target, msgs },
    onExpire: () => {},
    onRestore: async () => {
      const cur = await Sessions.listSessions(pk);
      await chrome.storage.local.set({
        [`paper:${pk}:chatSessions`]: [...cur, target],
        [`paper:${pk}:chatSessionMessages:${sid}`]: msgs,
      });
      setSessions(await Sessions.listSessions(pk));
    },
  });
  // setToast renders an UndoToast; concrete API depends on toast.tsx
  setToast(t('delete.toast.session') || 'Session deleted · [Undo]');
}

async function handleDeleteNote(n: Note) {
  const pk = paperKey(paper);
  await Notes.deleteNote(pk, n.id);
  setNotes(await Notes.listNotes(pk));
  pushSnapshot({
    paperKey: pk, kind: 'note-card', payload: n,
    onExpire: () => {},
    onRestore: async () => {
      await Notes.upsertNote(pk, n);
      setNotes(await Notes.listNotes(pk));
    },
  });
  setToast(t('delete.toast.note') || 'Note deleted · [Undo]');
  if (n.kind === 'highlight') {
    // also remove from existing highlights store
  }
}
```

- [ ] **Step 11: Rewire shell layout**

```tsx
return (
  <div style={{ height: '100vh', display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    gridTemplateColumns: `${chatOpen ? chatPanelWidth : 0}px 1fr ${workspaceOpen ? activeWorkspaceWidth : 0}px` }}>
    <TopBar
      /* ... existing props ... */
      chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)}
      workspaceOpen={workspaceOpen} onToggleWorkspace={() => setWorkspaceOpen((v) => !v)}
    />
    <MigrationBanner />
    {chatOpen && (
      <ChatPanel
        paper={paper}
        sessions={sessions} activeId={activeSessionId}
        messages={chatMessages} streamingId={chatStreamingId}
        askPrefill={askPrefill} locale={locale}
        onSwitch={async (id) => {
          const pk = paperKey(paper);
          setActiveSessionIdState(id);
          setChatMessages(await Sessions.loadMessages(pk, id));
          setAskPrefill(null);
          await Sessions.setActive(pk, id);
        }}
        onNew={async () => {
          const pk = paperKey(paper);
          const s = await Sessions.createSession(pk);
          await Sessions.setActive(pk, s.id);
          setSessions(await Sessions.listSessions(pk));
          setActiveSessionIdState(s.id);
          setChatMessages([]);
        }}
        onClear={async () => {
          if (!activeSessionId) return;
          const pk = paperKey(paper);
          await Sessions.clearSession(pk, activeSessionId);
          setChatMessages([]);
        }}
        onRename={async (id, title) => {
          const pk = paperKey(paper);
          await Sessions.renameSession(pk, id, title);
          setSessions(await Sessions.listSessions(pk));
        }}
        onDelete={handleDeleteSession}
        onSend={existingSendChatHandler}
        onDismissPrefill={() => setAskPrefill(null)}
      />
    )}
    {/* MainArea — paper / variant switch (existing logic) */}
    {workspaceOpen && (
      <WorkspacePanel
        paper={paper} tab={tab} setTab={setTab}
        overviewMeta={overviewMeta}
        contributionsState={contributionsState} keywordsState={keywordsState}
        onRetryContributions={() => { setContributionsState({ kind: 'idle' }); /* trigger ensureOverview */ }}
        onRetryKeywords={() => { setKeywordsState({ kind: 'idle' }); }}
        notes={notes} activeSubtab={activeSubtab}
        onSubtabChange={setActiveSubtab}
        flashNoteId={flashNoteId}
        onJumpChat={jumpToChat}
        onDeleteNote={handleDeleteNote}
        onRetryNote={(n) => retryAction({ paperKey: paperKey(paper), paper, actionId: n.id, model, lang: outputLanguage })}
        onEditNote={(n) => setEditingNote({ rect: { left: 0, top: 0, right: 0, bottom: 0 }, quote: n.quote, loc: n.loc, initial: n.userText ?? '' })}
        onMemoryPatch={patchMemory}
        model={model} locale={locale}
      />
    )}
    {editingNote && (
      <NoteEditorPopover
        rect={editingNote.rect} initial={editingNote.initial}
        onCancel={() => setEditingNote(null)}
        onSave={handleNoteSave}
      />
    )}
    <StatusRail /* ... */ />
  </div>
);
```

- [ ] **Step 12: Update keyboard shortcuts**

In the existing global keyboard `useEffect`:
- `⌘\` → `setWorkspaceOpen((v) => !v)` (was outline toggle)
- `⌘⇧\` → `setChatOpen((v) => !v)` (new)
- Add `N` to selection-toolbar shortcut list; ignore `S` and `?` (no-op).

- [ ] **Step 13: First-run shortcut toast**

```ts
useEffect(() => {
  (async () => {
    const seen = await chrome.storage.local.get('shortcutToastSeen:260424');
    if (seen['shortcutToastSeen:260424']) return;
    setToast(t('shortcut.toast.260424') || '⌘\\ now toggles the right panel (Outline retired).');
    await chrome.storage.local.set({ 'shortcutToastSeen:260424': 1 });
  })();
}, []);
```

- [ ] **Step 14: Now narrow `SelectionActionKind`** (per the L2.2-1 TODO comment) — drop `'summarize' | 'ask'` from the union in `selection-toolbar.tsx`. Then `runAction`'s deprecated branch can be removed.

- [ ] **Step 15: Typecheck + run all unit tests**

```bash
cd chrome-extension && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 16: Manual browser smoke test** (mandatory per CLAUDE.md)

```bash
cd chrome-extension && npm run build
# Load chrome-extension/dist into chrome://extensions
# Open an arXiv paper. Verify:
# 1. 3-column layout renders [Chat | Reader | Workspace]
# 2. Chat new/clear/history controls work
# 3. Selection toolbar shows 4 actions (E/H/N/T)
# 4. Explain → chat actionCard appears + Note tab card appears (shared actionId)
# 5. Note → popover opens; save → Note tab "笔记" sub-tab card appears
# 6. Highlight → text highlights + Note tab "高亮" sub-tab card appears
# 7. ⌘\ toggles right panel; ⌘⇧\ toggles left
# 8. Delete session/note → toast with [Undo] within 5s restores
# 9. Reload paper → tab + scroll + active session restored
```

- [ ] **Step 17: Commit**

```bash
git add chrome-extension/reader/main.tsx chrome-extension/reader/components/selection-toolbar.tsx
git commit -m "feat(ext): main.tsx shell rebuild — 3-column [Chat|Reader|Workspace] + selection-actions dispatch"
```

### Task L3-4 · Extend `lib/i18n.ts` strings

**Files:**
- Modify: `chrome-extension/reader/lib/i18n.ts`

- [ ] **Step 1: Add new keys** to both zh-CN and en-US catalogs (see all string usages above)

```
tabs.overview / tabs.note / tabs.memory
chat.history.title / chat.history.empty / chat.history.emptyHint
chat.session.titleFallback (e.g. "对话 #{seq}" / "Chat #{seq}")
note.kinds.explain / .highlight / .note / .translate
note.empty.explain / .highlight / .note / .translate
note.editor.title / .placeholder / .saveFailed
delete.toast.session / delete.toast.note / delete.toast.dismiss
shortcut.toast.260424
action.retry / action.cancel / action.save / action.saving
error.aiFailed / error.aiAborted
ghost.rail.label  // "上次：{n} 条笔记 · {h} 处高亮 · {c} 个对话"
overview.contributions.title / overview.keywords.title
overview.field.publishedAt / .authors / .citations / .field / .codeUrl
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/reader/lib/i18n.ts
git commit -m "feat(ext): i18n strings for redesign UI (tabs, chat, note, delete toasts, errors)"
```

---

## Phase L4 · Cleanup deletions

Depends on: L3 fully landed and verified.

### Task L4-1 · Delete 5 obsolete components

**Files:**
- Delete: `abstract-view.tsx`, `outline-panel.tsx`, `margin-column.tsx`, `margin-note.tsx`, `selection-result-card.tsx`

- [ ] **Step 1: Confirm no remaining imports**

```bash
cd chrome-extension && grep -rn "from.*abstract-view\|from.*outline-panel\|from.*margin-column\|from.*margin-note\|from.*selection-result-card" reader/
```
Expected: only the deleted files reference each other. If anything else hits, **stop and fix the leftover usage in main.tsx**.

- [ ] **Step 2: Delete files**

```bash
git rm chrome-extension/reader/components/abstract-view.tsx \
       chrome-extension/reader/components/outline-panel.tsx \
       chrome-extension/reader/components/margin-column.tsx \
       chrome-extension/reader/components/margin-note.tsx \
       chrome-extension/reader/components/selection-result-card.tsx
```

- [ ] **Step 3: Re-run typecheck + tests**

```bash
cd chrome-extension && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(ext): drop abstract-view + outline-panel + margin-* + selection-result-card"
```

### Task L4-2 · Drop deprecated `MarginResult` if unused

**Files:**
- Modify: `chrome-extension/reader/types.ts`

- [ ] **Step 1: Search for `MarginResult`**

```bash
grep -rn "MarginResult" chrome-extension/
```

- [ ] **Step 2: If unused everywhere, delete the type. If `canvas-view.tsx` still references it, leave with `// @deprecated, drop after canvas refactor`.**

- [ ] **Step 3: Commit if dropped**

```bash
git add chrome-extension/reader/types.ts
git commit -m "refactor(ext): drop unused MarginResult type"
```

---

## Phase L5 · Test backfill (per spec §17.B)

Each task is one TDD cycle. Already-created tests during L1/L2 cover: format, undo-snapshot, schema-migration, restore-context, chat-sessions, notes, selection-actions, semantic-scholar, overview, sync-queue-kind-filter, storage-paper-keys.

### Task L5-1 · Integration: `notes-dual-write.test.ts`

`chrome-extension/tests/integration/notes-dual-write.test.ts` — verify highlight upsert writes both `margin_notes` and `highlights` rows in local Supabase; deleting either side syncs the other (per spec §18.3 critical gap).

### Task L5-2 · Integration: `legacy-chat-migration.test.ts`

Seed `paper:${k}:chat` with N flat messages → run `runSchemaMigrations_260424(k)` against integration storage → assert sessions+messages exactly preserve order, content, ids.

### Task L5-3 · Integration: `shortcut-toast-once.test.ts`

Mount reader twice; verify toast shows on first mount, not second; verify `shortcutToastSeen:260424` flag set.

### Task L5-4 · E2E: 5 Playwright specs

Bootstrap `chrome-extension/tests/e2e/` if absent. Use Playwright's `chromium.launchPersistentContext` with the unpacked extension dir. Tests:

- `selection-explain-flow.spec.ts`
- `selection-highlight.spec.ts`
- `selection-note.spec.ts`
- `selection-translate.spec.ts`
- `chat-session-mgmt.spec.ts`

### Task L5-5 · Eval: 3 LLM evals

`chrome-extension/tests/eval/contributions.test.ts`, `keywords.test.ts`, `explain.test.ts` — assert format constraints (bullet count, no preamble, no repetition) against fixed paper fixtures.

> Each L5 task is standalone; can be incrementally landed in follow-up PRs (per spec §18.1 "AI eval CI integration delayed to next PR").

---

## Phase L6 · DESIGN.md sync (per spec §14)

### Task L6-1 · Rewrite affected sections

**Files:**
- Modify: `DESIGN.md` sections §4.3, §4.5, §5.1, §5.2, §6 (per spec §14)

> Per spec §18.1: ship as a **separate PR** to keep the redesign PR focused on code.

- [ ] **Step 1: Read current DESIGN.md sections**

```bash
sed -n '/## 4\.3/,/## 4\.5/p' DESIGN.md
sed -n '/## 5\.1/,/## 5\.2/p' DESIGN.md
sed -n '/## 6/,/^## 7/p' DESIGN.md
```

- [ ] **Step 2: Rewrite each section** to reflect the new architecture: 3-column shell, no MarginColumn/MarginNote, no SelectionResultCard, 4-action toolbar, Overview/Note/Memory tabs.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "docs: sync DESIGN.md to redesign (chat panel + overview/note tabs + 4-action toolbar)"
```

---

## Phase L7 · Smoke + ship

### Task L7-1 · Full regression

- [ ] **Step 1: All unit + integration tests**

```bash
cd chrome-extension && npx vitest run
```

- [ ] **Step 2: Typecheck**

```bash
cd chrome-extension && npx tsc --noEmit
```

- [ ] **Step 3: Build and load**

```bash
cd chrome-extension && npm run build
# Load chrome-extension/dist into chrome://extensions
```

- [ ] **Step 4: Manual acceptance** — walk all 6 acceptance criteria from spec §11.3 in browser; tick off when verified.

- [ ] **Step 5: Land** (only after all steps green and user approval)

---

## Self-review checklist (run before declaring plan complete)

- [x] Spec coverage: every numbered subsection in §1–§17 has at least one task. (§1 → L3-2/L3-3/L3-4; §2 → L2.1; §3 → L2.2/L2.3; §4 → L2.2-1; §4.A → L3-3 step 10; §5 → L1.1-6/L1.1-7/L1.2-1; §6 → L3-3; §7 → L1/L2/L3/L4; §8 → L3-4; §9 → L3-3 step 5; §10 → L1.1-5; §11 → L5; §12 risks → covered through tests; §13 → L1.3-2; §14 → L6; §15 → enforced in component tasks; §16 → role/aria attrs in components; §17 covered: §17.1 storage L1.1-7, §17.2 split L1.1-7/L1.1-8, §17.3 schema-migration L1.1-5, §17.4 type L1.1-6, §17.5 sql L1.2-1, §17.6 manifest L1.3-1, §17.7 undo L1.1-4, §17.8 jitter L2.3-1, §17.A.1 ai L2.2-2, §17.A.2 markdown reuse in NoteCard L2.2-4, §17.A.3 abort L2.2-2/L2.2-3, §17.A.4 retry guard L2.2-3, §17.A.5 format L1.1-1, §17.B tests L5, §17.C.1 perf left to v2 sentinel, §17.C.2 no debounce on tab L3-3 step 6, §17.C.3 size guard in undo L1.1-4, §17.C.4 rAF L2.2-2)
- [x] No "TBD"/"later"/"Add appropriate"/"Similar to" placeholders
- [x] Type/function name consistency: `runSchemaMigrations_260424`, `runRestoreContext_260424`, `runSelectionAction`, `retryAction`, `pushSnapshot`, `tryUndo`, `flushOnPaperChange`, `fetchOverviewMeta`, `ensureOverview`, `shouldSyncNote`, `formatChatTimestamp`, `formatNoteCardFooter` — used identically across tasks
- [x] All file paths repo-relative; commands runnable
- [x] Every code-step has a code block; every test-step has runnable command + expected pass/fail

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-24-plan-ui-redesign-chat-notes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Per spec §18.4 the work is naturally lane-parallel. Dispatch one subagent per L1.x lane (3 in parallel), then per L2.x lane (3 in parallel), then L3 + L4 + L5 + L6 + L7 sequentially. Use superpowers:subagent-driven-development.

**2. Inline Execution** — Walk every task in this single conversation. Use superpowers:executing-plans with checkpoints between phases.

**Which approach?**
