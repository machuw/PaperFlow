# PaperFlow Chrome Extension — Phase 3: AI Core + BYOK + E/S/T Actions + Memory Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up AI-assisted reading. Add a BYOK Options page, implement `reader/lib/ai.ts` (OpenAI-compatible streaming client with §3.7 context/memory/prompt contracts), wire E/S/T selection actions to stream results into MarginNotes (Focus) or SelectionResultCard (Classic), persist completed notes to `paper:{key}:notes`, and ship the Memory tab (Classic Workspace) with inline editing that feeds default margin notes. Ask (?) and Chat tab stay in Plan 4.

**Architecture:** BYOK config lives at `chrome.storage.local['config']` (keyed, not per-paper). `lib/ai.ts` is framework-free: it takes a `Paper`, memory, and an action kind, builds messages per §3.7.1/§3.7.2/§3.7.3, and returns an `AsyncIterable<string>` of text chunks from `fetch` + `ReadableStream`. ViewerApp's `runAction` drives the stream, pushing incremental text into a new margin-note entry in `results` state and persisting via `onStreamDone` to `paper:{key}:notes`. A per-key write queue (`withKeyLock`) serializes storage mutations. StatusRail reacts to config changes via `chrome.storage.onChanged`.

**Tech Stack:** React 18, TypeScript 5 strict, native `fetch` + `ReadableStream` + `TextDecoder` (no SSE parser dep), Vitest.

**Spec references:**
- §3.3 Selection actions + keyboard handler (actions now call AI)
- §3.4 Margin notes persistence schema (`paper:{key}:notes`)
- §3.5 Memory empty-state rules (affects MarginColumn default notes)
- §3.6 Role standard values + `extractRolePrefix` (quick-select buttons in Memory tab)
- §3.7.1 Paper context injection format (title / authors / abstract / paragraphs)
- §3.7.2 Memory injection block (only non-empty fields, nextActions filter)
- §3.7.3 Prompt templates (Explain / Summarize / Translate; Summary/Chat/Ask deferred)
- §3.7.4 Citation parsing (deferred to Plan 4 — Chat tab)
- §3.8 AI error paths (no BYOK, network, stream abort)
- §8.1 Focus MarginColumn + default memory notes + anchoring + streaming animation
- §8.2 Classic WorkspacePanel → SelectionResultCard + MemoryView inline edit

**Plan 2 review carryover (resolved in Task 1):**
- Follow-up #1: `SelectionToolbar` clamp uses fixed 120–540 range — fix with a `paperCardWidth` prop.
- Follow-up #2: Split `variant` → `variant` (in-memory) + `persistedVariant` (localStorage) per §3.7.5. Phase 3 lays the infrastructure even though Ask itself is Plan 4.
- Follow-up #3: `icons.tsx` `Record<string, IconComponent>` widens keys; tighten to a literal union so typos fail typecheck.
- Follow-up #4: `addHighlight` (and the upcoming `addNote`) non-atomic read-then-write; introduce `withKeyLock` and wrap both.

**Not in Phase 3:**
- Summary tab (3-section cache, 3s throttle + 300ms dwell) — Plan 4
- Chat tab + `[pN]`/`[abs]` citation parsing (§3.7.4) — Plan 4
- Ask (?) action + `SelectionPinnedChip` (§3.7.5) — Plan 4
- Library drawer real data + LibraryRow — Plan 4
- Canvas view — Plan 5
- CmdK AI commands (§9.1 Paper/Memory groups) — Plan 4

---

## File Map

| File | Responsibility | Action |
|------|----------------|--------|
| `chrome-extension/reader/components/selection-toolbar.tsx` | accept `paperCardWidth` for clamp | Modify |
| `chrome-extension/reader/components/icons.tsx` | literal-union key | Modify |
| `chrome-extension/reader/lib/storage.ts` | `withKeyLock`, config CRUD, notes CRUD | Modify |
| `chrome-extension/reader/types.ts` | `AiConfig`, `AiActionKind`, `MarginResult` | Modify |
| `chrome-extension/options/index.html` | link to main.tsx | Modify |
| `chrome-extension/options/main.tsx` | BYOK React form | Create |
| `chrome-extension/vite.config.ts` | options entry + copy plugin | Modify |
| `chrome-extension/reader/lib/ai.ts` | context builders + prompts + streaming fetch | Create |
| `chrome-extension/tests/lib/ai.test.ts` | unit tests for builders + prompts + streaming mock | Create |
| `chrome-extension/reader/lib/paper.ts` | `findIntroParagraphs` (already exists) | unchanged |
| `chrome-extension/reader/components/margin-note.tsx` | single MarginNote (streaming text, SVG leader, tone) | Create |
| `chrome-extension/reader/components/margin-column.tsx` | stacks notes, anchor algorithm, seeds memory defaults | Create |
| `chrome-extension/reader/components/selection-result-card.tsx` | Classic result card (header + quote + body) | Create |
| `chrome-extension/reader/components/memory-view.tsx` | MemoryView with inline edit + nextActions | Create |
| `chrome-extension/reader/components/workspace-panel.tsx` | render SelectionResultCard + MemoryView | Modify |
| `chrome-extension/reader/components/status-rail.tsx` | reactive to `chrome.storage.onChanged('config')` | Modify |
| `chrome-extension/reader/main.tsx` | variant split, AI runAction, results state, notes seed | Modify |

**Total new:** 7 files (2 components, 1 options entry, 1 ai lib, 1 memory component, 1 margin column, 1 margin note). **Modified:** 8.

---

## Task 1: Plan 2 review carryover fixes

**Files:**
- Modify: `chrome-extension/reader/components/selection-toolbar.tsx`
- Modify: `chrome-extension/reader/components/icons.tsx`
- Modify: `chrome-extension/reader/main.tsx` (variant split)

**Spec reference:** Addresses Plan 2 review follow-ups #1, #2, #3. #4 (storage write queue) lands in Task 2 because it needs a new test.

### Step 1: Tighten `icons.tsx` to a literal-union key

Replace the `export const I: Record<string, IconComponent>` declaration with a `satisfies` expression over an object literal. Open `chrome-extension/reader/components/icons.tsx` and change the `I` export to:

```typescript
export const I = {
  Sidebar:   (p) => <Icon {...p}><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></Icon>,
  Library:   (p) => <Icon {...p}><rect x="2.5" y="2.5" width="3" height="11" rx="0.5"/><rect x="6.5" y="2.5" width="3" height="11" rx="0.5"/><path d="M9.5 4.5l2.4-0.7 2.6 9.1-2.4 0.7z"/></Icon>,
  Command:   (p) => <Icon {...p}><path d="M5 5h6v6H5zM5 5a1.5 1.5 0 1 1 0-3M11 5a1.5 1.5 0 1 0 0-3M5 11a1.5 1.5 0 1 0 0 3M11 11a1.5 1.5 0 1 1 0 3"/></Icon>,
  Settings:  (p) => <Icon {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></Icon>,
  Sparkle:   (p) => <Icon {...p}><path d="M8 2.5l1.3 3.2L12.5 7l-3.2 1.3L8 11.5l-1.3-3.2L3.5 7l3.2-1.3z"/><path d="M12 11.5l0.5 1 1 0.5-1 0.5-0.5 1-0.5-1-1-0.5 1-0.5z"/></Icon>,
  Book:      (p) => <Icon {...p}><path d="M2.5 3.5a1 1 0 0 1 1-1H8v11H3.5a1 1 0 0 1-1-1zM13.5 3.5a1 1 0 0 0-1-1H8v11h4.5a1 1 0 0 0 1-1z"/></Icon>,
  Grid:      (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.5"/></Icon>,
  Layers:    (p) => <Icon {...p}><path d="M8 2.5L2 5.5l6 3 6-3zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></Icon>,
  Moon:      (p) => <Icon {...p}><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z"/></Icon>,
  Sun:       (p) => <Icon {...p}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></Icon>,
  Search:    (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></Icon>,
  Close:     (p) => <Icon {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></Icon>,
  Quote:     (p) => <Icon {...p}><path d="M3 6.5c0-2 1-3 2.5-3M3 6.5v3h2.5v-3zM9 6.5c0-2 1-3 2.5-3M9 6.5v3h2.5v-3z"/></Icon>,
  Translate: (p) => <Icon {...p}><path d="M2.5 4h5M5 2.5v1.5M3 4c0 2.5 2 5 4 5"/><path d="M7 9c-1.5 0-2.5-1-2.5-1"/><path d="M8.5 13.5l3-7 3 7M9.5 11.5h4"/></Icon>,
  Highlight: (p) => <Icon {...p}><path d="M10 2.5l3.5 3.5-6.5 6.5-3 0.5 0.5-3z"/><path d="M2.5 14h5"/></Icon>,
  Chat:      (p) => <Icon {...p}><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-0a1.5 1.5 0 0 1-1.5-1.5z"/></Icon>,
  Memory:    (p) => <Icon {...p}><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/><circle cx="8" cy="8" r="2.5"/></Icon>,
  Edit:      (p) => <Icon {...p}><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></Icon>,
  Check:     (p) => <Icon {...p}><path d="M3 8.5l3 3 7-7"/></Icon>,
  Plus:      (p) => <Icon {...p}><path d="M8 3v10M3 8h10"/></Icon>,
  Refresh:   (p) => <Icon {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2h-2"/></Icon>,
  ArrowRight:(p) => <Icon {...p}><path d="M3 8h10M9 4l4 4-4 4"/></Icon>,
  Link:      (p) => <Icon {...p}><path d="M7 9l-2 2a2 2 0 1 1-2.8-2.8l2-2M9 7l2-2a2 2 0 1 1 2.8 2.8l-2 2M6 10l4-4"/></Icon>,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof I;
```

Note the additions (`Memory`, `Edit`, `Check`, `Plus`, `Refresh`, `ArrowRight`, `Link`) — Plan 3 consumes these for Memory tab + Refresh button patterns. `satisfies` preserves the literal-key type so `keyof typeof I` is a narrow union.

### Step 2: Update `SelectionToolbar` `icon` prop type

Open `chrome-extension/reader/components/selection-toolbar.tsx`. Change the existing `Array<{ id: ...; icon: keyof typeof I; ... }>` usage to import the new `IconName` type and use it:

Replace the import line `import { I } from './icons';` with:

```typescript
import { I } from './icons';
import type { IconName } from './icons';
```

Change the `actions` array type annotation from `icon: keyof typeof I` to `icon: IconName`:

```typescript
  const actions: Array<{ id: SelectionActionKind; label: string; icon: IconName; kbd: string }> = [
    { id: 'explain',   label: 'Explain',    icon: 'Sparkle',   kbd: 'E' },
    { id: 'summarize', label: 'Summarize',  icon: 'Quote',     kbd: 'S' },
    { id: 'translate', label: 'Translate',  icon: 'Translate', kbd: 'T' },
    { id: 'highlight', label: 'Highlight',  icon: 'Highlight', kbd: 'H' },
    { id: 'ask',       label: 'Ask about…', icon: 'Chat',      kbd: '?' },
  ];
```

### Step 3: Fix `SelectionToolbar` clamp to paper card width

Add `paperCardWidth` as a Props field on `SelectionToolbar`, and replace the hardcoded 120/540 clamp range:

```typescript
interface Props {
  selection: TextSelection | null;
  onAction: (kind: SelectionActionKind, sel: TextSelection) => void;
  onClose: () => void;
  paperCardWidth: number;
}

export function SelectionToolbar({ selection, onAction, onClose, paperCardWidth }: Props) {
  if (!selection) return null;
  const { rect } = selection;
  const top = Math.max(rect.top - 44, 8);
  // Clamp inside the paper card. 60px = the card's horizontal padding (spec §8.1 reader column),
  // so the toolbar stays within the reading area rather than drifting into the margin notes column.
  const minX = 60;
  const maxX = Math.max(paperCardWidth - 60, minX + 1);
  const left = Math.min(Math.max(rect.left + rect.width / 2, minX), maxX);
```

Rest of the component body stays the same.

### Step 4: Pass `paperCardWidth` from ViewerApp

Open `chrome-extension/reader/main.tsx`. Find the `<SelectionToolbar ... />` render and add the new prop:

```tsx
            <SelectionToolbar
              selection={selection}
              onAction={runAction}
              onClose={closeSelection}
              paperCardWidth={tweaks.pageWidth}
            />
```

### Step 5: Split `variant` into `variant` + `persistedVariant`

Still in `chrome-extension/reader/main.tsx`, replace this line:

```typescript
  const [variant, setVariant] = usePersistedState<ReaderVariant>('pf-variant', 'focus');
```

With a two-layer state where `variant` is the in-memory active variant and `persistedVariant` is the localStorage-backed one. User-initiated changes write both; transient switches only update `variant`:

```typescript
  const [persistedVariant, setPersistedVariant] = usePersistedState<ReaderVariant>('pf-variant', 'focus');
  const [variant, setVariantInMemory] = useState<ReaderVariant>(persistedVariant);

  /**
   * Set the active variant. Pass `{ transient: true }` to avoid persisting
   * the change (spec §3.7.5: Ask's auto-switch to Classic must not clobber
   * the user's saved default). Regular TopBar / CmdK calls omit opts, so
   * the default behavior matches a single persisted setter.
   */
  const setVariant = (v: ReaderVariant, opts?: { transient?: boolean }) => {
    setVariantInMemory(v);
    if (!opts?.transient) setPersistedVariant(v);
  };
```

The current call sites (`setVariant('focus')`, TopBar `setVariant={setVariant}`, CmdK `setVariant={setVariant}`) keep working because the new signature has an optional second argument.

Plan 4 will call `setVariant('classic', { transient: true })` when Ask triggers.

### Step 6: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. The literal-union tightening might surface unused icon references or mistyped strings — fix any that appear.

### Step 7: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/selection-toolbar.tsx \
  chrome-extension/reader/components/icons.tsx \
  chrome-extension/reader/main.tsx
git commit -m "fix(ext): Plan 2 carryover — toolbar clamp + icon literal keys + variant split"
```

---

## Task 2: `withKeyLock` storage serializer + wrap `addHighlight` (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Spec reference:** Plan 2 review follow-up #4. Forthcoming `addNote` + potential future writers need the same pattern.

### Step 1: Add a failing concurrency test

Append to `chrome-extension/tests/lib/storage.test.ts` inside the existing `describe('highlights', …)` (or a new describe right after):

```typescript
describe('highlight write serialization', () => {
  it('two concurrent addHighlight calls both land without loss', async () => {
    const a = addHighlight('kc', { paragraphId: 'sec0-p0', text: 'A', color: 'yellow' });
    const b = addHighlight('kc', { paragraphId: 'sec0-p1', text: 'B', color: 'yellow' });
    await Promise.all([a, b]);
    const final = await getHighlights('kc');
    expect(final).toHaveLength(2);
    expect(final.map((h) => h.text).sort()).toEqual(['A', 'B']);
  });
});
```

Update the `makeMockStorage()` helper in the same file to introduce a microtask delay in `get` so the race is observable. Find:

```typescript
    get: async (keys) => {
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
```

Replace with:

```typescript
    get: async (keys) => {
      // Simulate chrome.storage.local's cross-IPC latency so read-then-write
      // race conditions are observable in tests.
      await new Promise((r) => setTimeout(r, 0));
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: the new test fails — final length is 1, not 2, because both `addHighlight` calls read the same empty baseline before either writes.

### Step 3: Implement `withKeyLock` + wrap `addHighlight`

Open `chrome-extension/reader/lib/storage.ts`. Above the existing `async function get<T>(...)`, add:

```typescript
/**
 * Serialize async storage read-modify-write sequences per key.
 * Two callers with the same key queue behind each other; different keys
 * run in parallel. Returns whatever `fn` returns.
 *
 * Pattern:
 *   withKeyLock(k.notes(key), async () => {
 *     const prev = await get(...);
 *     await set(..., [...prev, next]);
 *   });
 */
const keyLocks = new Map<string, Promise<unknown>>();

export async function withKeyLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(lockKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);   // run fn regardless of previous outcome
  keyLocks.set(lockKey, next);
  try {
    return await next;
  } finally {
    // If no newer caller has taken the slot, clear it so the map doesn't grow unbounded.
    if (keyLocks.get(lockKey) === next) keyLocks.delete(lockKey);
  }
}
```

Now wrap `addHighlight`:

```typescript
export async function addHighlight(paperKey: string, h: Highlight): Promise<Highlight[]> {
  return withKeyLock(k.highlights(paperKey), async () => {
    const existing = await getHighlights(paperKey);
    const isDup = existing.some((e) => e.paragraphId === h.paragraphId && e.text === h.text);
    if (isDup) return existing;
    const next = [...existing, h];
    await setHighlights(paperKey, next);
    return next;
  });
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: all storage tests pass (9 total — previous 8 + 1 new). Full suite green (59 tests).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/storage.ts chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): withKeyLock serializer + wrap addHighlight"
```

---

## Task 3: `AiConfig` type + config storage wrappers (TDD)

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Spec reference:** §3.3 BYOK fields (baseURL, apiKey, model). Config is stored separately from per-paper state — key `'config'`.

### Step 1: Add `AiConfig` type

Open `chrome-extension/reader/types.ts`. Append at the end:

```typescript
/**
 * OpenAI-compatible BYOK config. `baseURL` is normalized (no trailing slash)
 * when saved. Missing fields mean "not configured"; §3.8 BYOK error path
 * gates on `!config.apiKey`.
 */
export interface AiConfig {
  baseURL: string;   // e.g. 'https://api.openai.com/v1'
  apiKey: string;
  model: string;     // e.g. 'gpt-4.1-mini'
}

export const EMPTY_AI_CONFIG: AiConfig = { baseURL: '', apiKey: '', model: '' };
```

### Step 2: Write failing tests for `getConfig` / `setConfig`

Open `chrome-extension/tests/lib/storage.test.ts`. Extend the existing top-of-file imports:

```typescript
import { getConfig, setConfig } from '../../reader/lib/storage';
import type { AiConfig } from '../../reader/types';
```

Append a new describe block:

```typescript
describe('config', () => {
  it('round-trips an AiConfig', async () => {
    const c: AiConfig = { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'gpt-4.1-mini' };
    await setConfig(c);
    expect(await getConfig()).toEqual(c);
  });

  it('returns null when not configured', async () => {
    expect(await getConfig()).toBeNull();
  });

  it('normalizes trailing slash on baseURL', async () => {
    await setConfig({ baseURL: 'https://example.com/v1/', apiKey: 'x', model: 'm' });
    const got = await getConfig();
    expect(got?.baseURL).toBe('https://example.com/v1');
  });

  it('leaves baseURL alone when it has no trailing slash', async () => {
    await setConfig({ baseURL: 'https://example.com/v1', apiKey: 'x', model: 'm' });
    expect((await getConfig())?.baseURL).toBe('https://example.com/v1');
  });
});
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: module export errors for `getConfig`/`setConfig`.

### Step 4: Implement `getConfig` / `setConfig` in `storage.ts`

Open `chrome-extension/reader/lib/storage.ts`. Extend the `types` import:

```typescript
import type { Paper, PaperMemory, Highlight, AiConfig } from '../types';
```

Append at the end of the file:

```typescript
const CONFIG_KEY = 'config';

export async function getConfig(): Promise<AiConfig | null> {
  return get<AiConfig>(CONFIG_KEY);
}

export async function setConfig(value: AiConfig): Promise<void> {
  // Normalize baseURL: drop a single trailing slash so ai.ts can safely
  // concatenate `/chat/completions` without producing a `//` (§3.3).
  const normalized: AiConfig = {
    ...value,
    baseURL: value.baseURL.replace(/\/+$/, ''),
  };
  await set(CONFIG_KEY, normalized);
}
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: all storage tests pass (13 total — previous 9 + 4 new). Full suite green (63 tests).

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): AiConfig type + getConfig/setConfig with baseURL normalization"
```

---

## Task 4: Options page — BYOK React form

**Files:**
- Create: `chrome-extension/options/main.tsx`
- Modify: `chrome-extension/options/index.html`
- Modify: `chrome-extension/vite.config.ts`

**Spec reference:** §3.8 "Configure API key →" target. Options page lives at `options/index.html` (declared in `manifest.json` as `options_ui.page`).

### Step 1: Rewrite `options/index.html` to host React

Replace the entire contents of `chrome-extension/options/index.html` with:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>PaperFlow Options</title>
  <link rel="stylesheet" href="../reader/styles/tokens.css"/>
</head>
<body style="background: var(--paper-deep); color: var(--ink); font-family: var(--font-sans); margin: 0;">
  <div id="root">Loading…</div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

### Step 2: Create `options/main.tsx`

Create `chrome-extension/options/main.tsx`:

```typescript
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { getConfig, setConfig } from '../reader/lib/storage';
import type { AiConfig } from '../reader/types';
import { EMPTY_AI_CONFIG } from '../reader/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function OptionsApp() {
  const [cfg, setCfg] = useState<AiConfig>(EMPTY_AI_CONFIG);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    getConfig().then((c) => {
      if (c) setCfg(c);
      setLoaded(true);
    });
  }, []);

  const onChange = (patch: Partial<AiConfig>) => {
    setCfg({ ...cfg, ...patch });
    setSaveState('idle');
  };

  const save = async () => {
    setErr('');
    if (!cfg.baseURL.trim()) { setErr('baseURL is required.'); return; }
    if (!cfg.apiKey.trim())  { setErr('API key is required.'); return; }
    if (!cfg.model.trim())   { setErr('Model is required.'); return; }
    setSaveState('saving');
    try {
      await setConfig(cfg);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1600);
    } catch (e) {
      setSaveState('error');
      setErr(String(e));
    }
  };

  if (!loaded) {
    return <div style={{ padding: 32, fontStyle: 'italic', color: 'var(--ink-faded)' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{
        fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600,
        color: 'var(--ink)', marginBottom: 6,
      }}>PaperFlow Options</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-faded)', marginBottom: 28, lineHeight: 1.5 }}>
        Bring-your-own-key configuration. Any OpenAI-compatible endpoint
        works. Values are stored locally in <code style={{ fontSize: 11 }}>chrome.storage.local</code>
        and never leave this browser.
      </p>

      <Field label="Base URL" hint="e.g. https://api.openai.com/v1">
        <input
          type="url"
          value={cfg.baseURL}
          onChange={(e) => onChange({ baseURL: e.target.value })}
          placeholder="https://api.openai.com/v1"
          style={input()}
        />
      </Field>

      <Field label="API key" hint="Treated as a secret; shown as dots.">
        <input
          type="password"
          value={cfg.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder="sk-..."
          style={input()}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Model" hint="e.g. gpt-4.1-mini, claude-3-5-sonnet (via proxy)">
        <input
          type="text"
          value={cfg.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder="gpt-4.1-mini"
          style={input()}
          autoComplete="off"
        />
      </Field>

      {err && (
        <div style={{
          padding: '8px 12px', marginBottom: 16,
          background: 'color-mix(in oklch, var(--foxglove) 10%, transparent)',
          border: '0.5px solid var(--foxglove)', borderRadius: 6,
          color: 'var(--foxglove)', fontSize: 12,
        }}>{err}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={save}
          disabled={saveState === 'saving'}
          style={{
            padding: '8px 18px',
            background: 'var(--ink)', color: 'var(--paper)',
            borderRadius: 6, fontSize: 13, fontWeight: 500,
            cursor: saveState === 'saving' ? 'default' : 'pointer',
            opacity: saveState === 'saving' ? 0.6 : 1,
          }}
        >{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
        {saveState === 'saved' && (
          <span style={{ fontSize: 12, color: 'var(--forest)' }}>✓ Saved.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{
        display: 'block',
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 5,
      }}>{label}</label>
      {children}
      {hint && (
        <div style={{
          fontSize: 11, color: 'var(--ink-faded)',
          fontStyle: 'italic', marginTop: 4,
        }}>{hint}</div>
      )}
    </div>
  );
}

function input(): React.CSSProperties {
  return {
    width: '100%', padding: '8px 10px',
    background: 'var(--paper)', color: 'var(--ink)',
    border: '0.5px solid var(--rule)', borderRadius: 6,
    fontSize: 13, fontFamily: 'var(--font-sans)',
    outline: 'none',
  };
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
```

### Step 3: Add `options` as a Vite entry

Open `chrome-extension/vite.config.ts`. The existing `rollupOptions.input` has `reader` and `sw`. Add `options`:

```typescript
      input: {
        reader: resolve(__dirname, 'reader/index.html'),
        options: resolve(__dirname, 'options/index.html'),
        sw: resolve(__dirname, 'background/sw.ts'),
      },
```

And in the `copy-static` plugin, remove the `options/index.html` copyFile line (it's now a real Vite entry and gets processed/copied automatically). The plugin's `writeBundle()` should now be:

```typescript
      writeBundle() {
        mkdirSync('dist', { recursive: true });
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('rules.json', 'dist/rules.json');
      },
```

(Drop the `mkdirSync('dist/options', ...)` + `copyFileSync('options/index.html', 'dist/options/index.html')` — Vite handles them via the new `options` input.)

### Step 4: Build + verify `dist/options/` layout

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected:
- Typecheck: exit 0
- Build: `dist/options/index.html` exists, linked to an asset bundle under `dist/assets/` (React is bundled). No top-level `import` remains in the HTML.

Spot-check with:

```bash
grep -o 'type="module"' dist/options/index.html
```

Expected: one match.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/options/index.html \
  chrome-extension/options/main.tsx \
  chrome-extension/vite.config.ts
git commit -m "feat(ext): Options page — BYOK form (baseURL + apiKey + model)"
```

---

## Task 5: `MarginResult` type + notes storage (TDD)

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Spec reference:** §3.4 margin-note persistence.

### Step 1: Add `MarginResult` + `AiActionKind` types

Open `chrome-extension/reader/types.ts`. Append at the end:

```typescript
/**
 * AI action kinds that generate a margin-note / selection-result card.
 * Matches selection-toolbar.tsx `SelectionActionKind` minus 'highlight'
 * (highlights don't produce AI output) and minus 'ask' (Plan 4).
 */
export type AiActionKind = 'explain' | 'summarize' | 'translate';

/**
 * A completed or in-progress AI result anchored to a paragraph (§3.4).
 * Both Focus MarginNotes and Classic SelectionResultCards render from this
 * shape. `body` grows as stream chunks arrive; `createdAt` is the moment
 * the stream began.
 */
export interface MarginResult {
  id: string;            // 'r-' + Date.now() + '-' + rand
  kind: AiActionKind;
  source: string;        // selected text
  body: string;
  paragraphId: string;   // anchor
  createdAt: number;     // epoch ms
}
```

### Step 2: Write failing notes storage tests

Open `chrome-extension/tests/lib/storage.test.ts`. Add imports:

```typescript
import { getNotes, setNotes, addNote } from '../../reader/lib/storage';
import type { MarginResult } from '../../reader/types';
```

Append a new describe block:

```typescript
describe('notes', () => {
  const sample: MarginResult = {
    id: 'r-1', kind: 'explain', source: 's', body: 'b',
    paragraphId: 'sec0-p0', createdAt: 1000,
  };

  it('round-trips notes array', async () => {
    await setNotes('n1', [sample]);
    expect(await getNotes('n1')).toEqual([sample]);
  });

  it('returns empty array when absent', async () => {
    expect(await getNotes('missing')).toEqual([]);
  });

  it('addNote appends to the end', async () => {
    await addNote('n1', sample);
    await addNote('n1', { ...sample, id: 'r-2', body: 'b2' });
    const got = await getNotes('n1');
    expect(got.map((n) => n.id)).toEqual(['r-1', 'r-2']);
  });

  it('addNote serializes concurrent calls', async () => {
    const a = addNote('nc', { ...sample, id: 'r-a' });
    const b = addNote('nc', { ...sample, id: 'r-b' });
    await Promise.all([a, b]);
    const final = await getNotes('nc');
    expect(final).toHaveLength(2);
    expect(final.map((n) => n.id).sort()).toEqual(['r-a', 'r-b']);
  });
});
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: module export errors for `getNotes` / `setNotes` / `addNote`.

### Step 4: Implement notes wrappers

Open `chrome-extension/reader/lib/storage.ts`. Extend the types import:

```typescript
import type { Paper, PaperMemory, Highlight, AiConfig, MarginResult } from '../types';
```

Append at the end:

```typescript
export async function getNotes(paperKey: string): Promise<MarginResult[]> {
  return (await get<MarginResult[]>(k.notes(paperKey))) ?? [];
}

export async function setNotes(paperKey: string, value: MarginResult[]): Promise<void> {
  await set(k.notes(paperKey), value);
}

/** Append a completed note. Serialized per key via withKeyLock. */
export async function addNote(paperKey: string, note: MarginResult): Promise<MarginResult[]> {
  return withKeyLock(k.notes(paperKey), async () => {
    const existing = await getNotes(paperKey);
    const next = [...existing, note];
    await setNotes(paperKey, next);
    return next;
  });
}
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: all storage tests pass (17 total — previous 13 + 4 new). Full suite green (67 tests).

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): MarginResult type + notes storage (get/set/add with lock)"
```

---

## Task 6: `ai.ts` — paper context builder (TDD)

**Files:**
- Create: `chrome-extension/reader/lib/ai.ts`
- Create: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.7.1 paper context format.

### Step 1: Write failing tests for `buildPaperContext`

Create `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPaperContext } from '../../reader/lib/ai';
import type { Paper } from '../../reader/types';

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: '2402.18413',
    urlHash: 'abc123def456',
    title: 'Contextual Residuals',
    authors: ['Khan, Y.', 'Voigt, R.'],
    abstract: 'We propose a lightweight residual memory.',
    venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
    outline: [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ],
    paragraphs: [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'Intro first.' },
      { id: 'sec0-p1', sectionId: 'o0', section: '1 Introduction', text: 'Intro second.' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'Method goes here.' },
    ],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('buildPaperContext', () => {
  it('emits title, byline, venue, abstract, and paragraphs in order', () => {
    const ctx = buildPaperContext(samplePaper());
    expect(ctx).toContain('# Contextual Residuals');
    expect(ctx).toContain('By Khan, Y., Voigt, R.');
    expect(ctx).toContain('Published in arXiv:2402.18413  [cs.LG]  14 Feb 2026');
    expect(ctx).toContain('## Abstract\nWe propose a lightweight residual memory.');
    expect(ctx).toContain('[p1] §1 Introduction · Intro first.');
    expect(ctx).toContain('[p2] §1 Introduction · Intro second.');
    expect(ctx).toContain('[p3] §2 Method · Method goes here.');
  });

  it('omits "Published in" when venue is empty', () => {
    const ctx = buildPaperContext(samplePaper({ venue: undefined }));
    expect(ctx).not.toContain('Published in');
    expect(ctx).toContain('By Khan, Y., Voigt, R.');
  });

  it('omits the Abstract block when abstract is empty but keeps [abs] hint', () => {
    const ctx = buildPaperContext(samplePaper({ abstract: '' }));
    expect(ctx).not.toContain('## Abstract');
    expect(ctx).toContain('cite the abstract as [abs]');
  });

  it('numbers paragraphs starting at [p1] (1-based)', () => {
    const ctx = buildPaperContext(samplePaper());
    expect(ctx).not.toContain('[p0]');
    expect(ctx).toContain('[p1]');
    expect(ctx).toContain('[p3]');
    expect(ctx).not.toContain('[p4]');
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/ai.test.ts
```

Expected: module-not-found.

### Step 3: Implement `buildPaperContext` in `lib/ai.ts`

Create `chrome-extension/reader/lib/ai.ts`:

```typescript
import type { Paper } from '../types';

/**
 * Build the "Paper" markdown block injected into every AI call (§3.7.1).
 * Paragraphs are labeled [p1]..[pN] (1-based) with their section prefix so
 * the model can emit tight citations.
 *
 * Abstract block is skipped when empty; the citation hint line is kept so
 * the model knows the [abs] token exists even if it has nothing to cite.
 */
export function buildPaperContext(paper: Paper): string {
  const parts: string[] = [];
  parts.push(`# ${paper.title}\n`);
  const byline = `By ${paper.authors.join(', ')}.${paper.venue ? ` Published in ${paper.venue}.` : ''}`;
  parts.push(byline + '\n');

  if (paper.abstract) {
    parts.push(`## Abstract\n${paper.abstract}\n`);
  }

  parts.push(
    '## Paragraphs (cite with paragraph ids like [p1]; cite the abstract as [abs]):'
  );
  paper.paragraphs.forEach((p, idx) => {
    parts.push(`[p${idx + 1}] §${p.section} · ${p.text}`);
  });

  return parts.join('\n');
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: 4 tests pass.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts \
  chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts buildPaperContext (§3.7.1)"
```

---

## Task 7: `ai.ts` — memory injection + prompt templates (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.7.2 memory injection, §3.7.3 prompt templates.

### Step 1: Write failing tests for `buildMemoryInjection` + `buildMessages`

Append to `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { buildMemoryInjection, buildMessages, PROMPTS } from '../../reader/lib/ai';
import type { PaperMemory } from '../../reader/types';

const emptyMem: PaperMemory = {
  whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [],
};

describe('buildMemoryInjection', () => {
  it('returns empty string when all fields are empty', () => {
    expect(buildMemoryInjection(emptyMem)).toBe('');
  });

  it('includes whyItMatters when non-empty', () => {
    const out = buildMemoryInjection({ ...emptyMem, whyItMatters: 'matters to me' });
    expect(out).toContain('# Reader\'s memory on this paper');
    expect(out).toContain('- Why it matters: matters to me');
  });

  it('omits whyItMatters line when only whitespace', () => {
    const out = buildMemoryInjection({ ...emptyMem, role: 'Central', whyItMatters: '   ' });
    expect(out).not.toContain('Why it matters');
    expect(out).toContain('- Role in research: Central');
  });

  it('includes linked block only when array non-empty', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      linked: [{ title: 'Landmark Attention', why: 'predecessor', role: 'Ancestor' }],
    };
    const out = buildMemoryInjection(mem);
    expect(out).toContain('- Linked work:');
    expect(out).toContain('  - Landmark Attention (Ancestor): predecessor');
  });

  it('filters done actions from nextActions', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      nextActions: [
        { text: 'Re-read §4', done: false },
        { text: 'Cite in draft', done: true },
        { text: 'Run ablation', done: false },
      ],
    };
    const out = buildMemoryInjection(mem);
    expect(out).toContain('- [ ] Re-read §4');
    expect(out).toContain('- [ ] Run ablation');
    expect(out).not.toContain('Cite in draft');
  });

  it('omits Outstanding actions block when all actions are done', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      nextActions: [{ text: 'done', done: true }],
    };
    expect(buildMemoryInjection(mem)).toBe('');
  });
});

describe('PROMPTS', () => {
  it('has template strings for Explain / Summarize / Translate', () => {
    expect(PROMPTS.explain).toMatch(/selected passage/i);
    expect(PROMPTS.summarize).toMatch(/1.2 sentences|Compress/i);
    expect(PROMPTS.translate).toMatch(/中文/);
  });

  it('appends the "reader\'s language" line to non-Translate prompts', () => {
    expect(PROMPTS.explain).toMatch(/Respond in the reader's language/);
    expect(PROMPTS.summarize).toMatch(/Respond in the reader's language/);
    expect(PROMPTS.translate).not.toMatch(/Respond in the reader's language/);
  });
});

describe('buildMessages', () => {
  it('produces system + user messages for Explain with paper context + selection', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildMessages('explain', paper, 'Attention is already excellent at short-range recall');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(PROMPTS.explain);
    expect(msgs[0].content).toContain('# Contextual Residuals');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('Attention is already excellent');
  });

  it('injects memory block into system prompt when memory non-empty', () => {
    const paper = samplePaper({
      memory: { ...emptyMem, whyItMatters: 'matters' },
    });
    const msgs = buildMessages('summarize', paper, 'x');
    expect(msgs[0].content).toContain('Why it matters: matters');
  });

  it('does not include memory block when all memory fields empty', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildMessages('translate', paper, 'x');
    expect(msgs[0].content).not.toContain('Reader\'s memory on this paper');
  });
});
```

Note: `samplePaper` is already defined earlier in the file from Task 6.

### Step 2: Run to confirm failure

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: module export errors for `buildMemoryInjection`, `buildMessages`, `PROMPTS`.

### Step 3: Extend `lib/ai.ts`

Open `chrome-extension/reader/lib/ai.ts`. Update the imports line:

```typescript
import type { Paper, PaperMemory, AiActionKind } from '../types';
```

Append after `buildPaperContext`:

```typescript
/**
 * Emit the "Reader's memory on this paper" block (§3.7.2) if any field is
 * non-empty after whitespace-trim. `nextActions` is filtered to undone items;
 * if no field remains, returns ''.
 */
export function buildMemoryInjection(m: PaperMemory): string {
  const lines: string[] = [];
  if (m.whyItMatters && m.whyItMatters.trim()) lines.push(`- Why it matters: ${m.whyItMatters.trim()}`);
  if (m.role && m.role.trim())                 lines.push(`- Role in research: ${m.role.trim()}`);
  if (m.judgment && m.judgment.trim())         lines.push(`- Personal judgment: ${m.judgment.trim()}`);

  if (m.linked.length > 0) {
    lines.push('- Linked work:');
    for (const l of m.linked) {
      lines.push(`  - ${l.title} (${l.role}): ${l.why}`);
    }
  }

  const todo = m.nextActions.filter((a) => !a.done);
  if (todo.length > 0) {
    lines.push('- Outstanding actions:');
    for (const a of todo) lines.push(`  - [ ] ${a.text}`);
  }

  if (lines.length === 0) return '';
  return `# Reader's memory on this paper\n${lines.join('\n')}`;
}

const LANG_SUFFIX = "Respond in the reader's language if they asked in one; otherwise default to English.";

export const PROMPTS = {
  explain:   "The reader selected a passage. Explain what it's actually claiming, in 2–4 sentences, at the level of a colleague thinking out loud. Avoid restating; go to the underlying claim.\n" + LANG_SUFFIX,
  summarize: "Compress the selected passage to 1–2 sentences that preserve its core claim.\n" + LANG_SUFFIX,
  translate: "Translate the selected passage to 中文 (Simplified Chinese). Preserve technical terms in their original form when they're canonical (e.g. 'attention', 'residual').",
} as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Assemble the message list for a given selection action (§3.7.3).
 * Shape: [system { PROMPT + paper context + memory? }, user { selected text }].
 */
export function buildMessages(
  kind: AiActionKind,
  paper: Paper,
  selectedText: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const systemParts = [PROMPTS[kind], '', paperCtx];
  if (mem) systemParts.push('', mem);
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: selectedText },
  ];
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: 13 tests pass (4 from Task 6 + 6 memory + 2 prompts + 3 buildMessages = 15? Recount — 6 + 2 + 3 = 11 new; + 4 = 15). Full suite green (~78 tests).

Actual count may differ by ±1 depending on describe parsing — what matters is `tests/lib/ai.test.ts` goes green.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts memory injection + prompt templates + buildMessages (§3.7.2/3.7.3)"
```

---

## Task 8: `ai.ts` — streaming `callChatCompletion` (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.3 OpenAI-compatible `/v1/chat/completions` streaming via native `fetch` + `ReadableStream`. Output is markdown plain text (no structured output).

### Step 1: Write failing streaming test

Append to `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { callChatCompletion } from '../../reader/lib/ai';
import type { AiConfig } from '../../reader/types';
import { vi } from 'vitest';

const cfg: AiConfig = {
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
};

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

describe('callChatCompletion', () => {
  it('yields decoded content deltas from SSE frames', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('Hello world');
  });

  it('handles chunked SSE frames split across reads', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"A"',
        '}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('AB');
  });

  it('skips data frames without delta.content', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('ok');
  });

  it('throws when HTTP status is non-2xx', async () => {
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as any;
    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }]);
    await expect(async () => { for await (const _ of iter) {} })
      .rejects.toThrow(/429/);
  });

  it('sends POST to {baseURL}/chat/completions with bearer + JSON body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(sseBody(['data: [DONE]\n\n']), { status: 200 })
    );
    global.fetch = fetchMock as any;

    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }]);
    for await (const _ of iter) {}

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('aborts the fetch when signal fires', async () => {
    const abortMock = vi.fn();
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', abortMock);
      return new Response(sseBody(['data: [DONE]\n\n']), { status: 200 });
    }) as any;

    const ac = new AbortController();
    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }], { signal: ac.signal });
    ac.abort();
    try { for await (const _ of iter) {} } catch { /* expected */ }
    expect(abortMock).toHaveBeenCalled();
  });
});
```

### Step 2: Run to confirm failure

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: `callChatCompletion` not exported.

### Step 3: Implement `callChatCompletion`

Append to `chrome-extension/reader/lib/ai.ts`:

```typescript
import type { AiConfig } from '../types';

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * OpenAI-compatible streaming chat completion. Yields assistant content deltas
 * as they arrive. Throws on non-2xx. Caller is responsible for aggregating
 * chunks and handling `AbortError` / other fetch failures.
 *
 * Endpoint shape follows §3.3: `{baseURL}/chat/completions` with bearer token.
 * `baseURL` is expected to already be normalized (trailing slash stripped by
 * `setConfig` in storage.ts).
 */
export async function* callChatCompletion(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: CallOptions = {},
): AsyncIterable<string> {
  const url = `${cfg.baseURL}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`AI request failed: ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
  }
  if (!res.body) throw new Error('AI response body is empty');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse complete SSE events from the buffer. Each event is terminated by a blank line.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        // Frame lines: typically a single `data: {...}` or `data: [DONE]`.
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          const payload = dataLine.slice(6).trim();
          if (payload === '[DONE]') return;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // Malformed frame — skip silently. Streams sometimes emit partial frames
            // on reconnect; the outer loop will pick up the next complete one.
          }
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: all ai tests pass (previous + 6 new streaming tests).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts callChatCompletion streaming SSE parser"
```

---

## Task 9: `MarginNote` component

**Files:**
- Create: `chrome-extension/reader/components/margin-note.tsx`

**Spec reference:** §8.1 MarginNote visual — leader SVG, tone color, `ink-streaming` class, quoted source.

### Step 1: Create `margin-note.tsx`

```typescript
import type { MarginResult, AiActionKind } from '../types';

interface Tone {
  color: string;
  label: string;
}

/** Map the result kind (plus synthetic 'why'/'linked' used by default notes) to tone. */
const TONES: Record<AiActionKind | 'why' | 'linked', Tone> = {
  explain:   { color: 'var(--sky)',      label: 'explain' },
  summarize: { color: 'var(--walnut)',   label: 'summarize' },
  translate: { color: 'var(--forest)',   label: 'translate' },
  why:       { color: 'var(--walnut)',   label: 'why this matters' },
  linked:    { color: 'var(--sky)',      label: 'linked context' },
};

/**
 * A single margin note. `variant`:
 *   - 'ai'   = streaming AI result; uses ink-streaming cursor when streaming.
 *   - 'why'  = default note sourced from paper.memory.whyItMatters.
 *   - 'linked' = default note sourced from paper.memory.linked[0].
 * Defaults ignore `streaming` and have no `source` (they aren't from a selection).
 */
interface Props {
  offset: number;           // absolute Y position inside MarginColumn
  variant: AiActionKind | 'why' | 'linked';
  label?: string;           // override for default notes (e.g. uppercased 'WHY THIS MATTERS')
  source?: string;          // original quoted text (AI notes)
  body: string;             // visible text; when streaming, may be a partial slice
  streaming?: boolean;
}

export function MarginNote({ offset, variant, label, source, body, streaming }: Props) {
  const tone = TONES[variant];
  const displayLabel = (label ?? tone.label).toUpperCase();

  return (
    <div
      style={{
        position: 'absolute', top: offset, left: 0, right: 0,
        animation: 'margin-note-in 380ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
    >
      {/* leader line — ink pen draw from paper margin into the note */}
      <svg
        width="40" height="28" viewBox="0 0 40 28"
        style={{ position: 'absolute', left: -36, top: 14, pointerEvents: 'none' }}
      >
        <path
          d="M0 14 C 12 14, 20 18, 36 20"
          stroke={tone.color} strokeWidth="1" fill="none" strokeLinecap="round"
          style={{
            strokeDasharray: 60,
            animation: 'ink-pen-draw 520ms cubic-bezier(0.3, 0.7, 0.4, 1) forwards',
          }}
        />
        <circle
          cx="36" cy="20" r="1.6" fill={tone.color} opacity="0.7"
          style={{ animation: 'fade-in 320ms 420ms both' }}
        />
      </svg>

      <div
        style={{
          padding: '10px 14px',
          background: `color-mix(in oklch, ${tone.color} 6%, var(--paper-soft))`,
          borderLeft: `2px solid ${tone.color}`,
          borderRadius: '0 6px 6px 0',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            color: tone.color, fontWeight: 600, marginBottom: 5,
          }}
        >
          {displayLabel}
        </div>

        {source && (
          <div
            style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              fontSize: 10.5, color: 'var(--ink-faded)',
              borderLeft: '1px solid var(--rule)',
              paddingLeft: 6, marginBottom: 6, lineHeight: 1.4,
            }}
          >
            "{source.slice(0, 80)}{source.length > 80 ? '…' : ''}"
          </div>
        )}

        <div
          className={streaming ? 'ink-streaming' : ''}
          style={{
            fontFamily: 'var(--font-serif)', fontSize: 12.5,
            lineHeight: 1.55, color: 'var(--ink)',
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

export type { MarginResult };
```

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/margin-note.tsx
git commit -m "feat(ext): MarginNote component (tone + SVG leader + streaming text)"
```

---

## Task 10: `MarginColumn` component — anchor algorithm + default notes

**Files:**
- Create: `chrome-extension/reader/components/margin-column.tsx`

**Spec reference:** §8.1 MarginColumn — note stacking with `minGap=110`, two post-mount recomputes (120ms + 400ms), resize listener, default memory notes with `findIntroParagraphs` anchoring.

### Step 1: Create `margin-column.tsx`

```typescript
import { useEffect, useState } from 'react';
import type { Paper, MarginResult, AiActionKind } from '../types';
import { findIntroParagraphs } from '../lib/paper';
import { MarginNote } from './margin-note';

interface Props {
  paper: Paper;
  results: MarginResult[];
  streamingKey: string | null;   // id of the currently-streaming result, if any
}

interface ComputedNote {
  id: string;
  variant: AiActionKind | 'why' | 'linked';
  label?: string;
  source?: string;
  body: string;
  anchorPid: string | null;       // paragraph id to anchor to; null = fall through stack
  streaming: boolean;
}

const MIN_GAP = 110;

/**
 * Build the full list of notes to render this frame:
 * 1. Default "WHY THIS MATTERS" note, iff memory.whyItMatters non-empty (§3.5).
 * 2. Default "LINKED CONTEXT" note, iff memory.linked[0] exists.
 * 3. AI result notes in creation order, each anchored to its source paragraph.
 *
 * Default-note anchors come from findIntroParagraphs (§8.1): first two intro
 * paragraphs, falling through to paper.paragraphs[0..1] if Introduction has
 * fewer than 2 paragraphs.
 */
function buildNotes(paper: Paper, results: MarginResult[], streamingKey: string | null): ComputedNote[] {
  const out: ComputedNote[] = [];

  const intro = findIntroParagraphs(paper);
  const first = intro[0] ?? paper.paragraphs[0];
  const second = intro[1] ?? paper.paragraphs[1];

  if (paper.memory.whyItMatters && paper.memory.whyItMatters.trim() && first) {
    out.push({
      id: 'default-why',
      variant: 'why',
      label: 'WHY THIS MATTERS',
      body: paper.memory.whyItMatters.trim(),
      anchorPid: first.id,
      streaming: false,
    });
  }

  const link0 = paper.memory.linked[0];
  if (link0 && second) {
    out.push({
      id: 'default-linked',
      variant: 'linked',
      label: 'LINKED CONTEXT',
      body: `→ ${link0.title} — ${link0.why}`,
      anchorPid: second.id,
      streaming: false,
    });
  }

  for (const r of results) {
    out.push({
      id: r.id,
      variant: r.kind,
      source: r.source,
      body: r.body,
      anchorPid: r.paragraphId,
      streaming: streamingKey === r.id,
    });
  }

  return out;
}

export function MarginColumn({ paper, results, streamingKey }: Props) {
  const notes = buildNotes(paper, results, streamingKey);
  const [offsets, setOffsets] = useState<Record<string, number>>({});

  useEffect(() => {
    const compute = () => {
      const container = document.querySelector('.margin-column-root');
      if (!container) return;
      const parentTop = container.getBoundingClientRect().top;
      const taken: number[] = [];
      const next: Record<string, number> = {};
      for (const n of notes) {
        if (!n.anchorPid) continue;
        const el = document.querySelector(`[data-pid="${n.anchorPid}"]`);
        if (!el) continue;
        let y = el.getBoundingClientRect().top - parentTop - 12;
        for (const t of taken) {
          if (Math.abs(y - t) < MIN_GAP) y = t + MIN_GAP;
        }
        taken.push(y);
        next[n.id] = y;
      }
      setOffsets(next);
    };

    compute();
    const t1 = setTimeout(compute, 120);
    const t2 = setTimeout(compute, 400);
    window.addEventListener('resize', compute);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', compute);
    };
    // Recompute when the set of anchor ids changes (adding/removing notes).
    // Using a stable key keeps this bounded — we deliberately exclude `paper` identity.
  }, [notes.map((n) => n.id + ':' + (n.anchorPid ?? '')).join(',')]);

  return (
    <div className="margin-column-root" style={{ position: 'relative', paddingTop: 12, minHeight: '100%' }}>
      {notes.map((n, i) => (
        <MarginNote
          key={n.id}
          offset={offsets[n.id] ?? 200 + i * 160}
          variant={n.variant}
          label={n.label}
          source={n.source}
          body={n.body}
          streaming={n.streaming}
        />
      ))}
    </div>
  );
}
```

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/margin-column.tsx
git commit -m "feat(ext): MarginColumn — anchor algorithm + default memory notes (§8.1)"
```

---

## Task 11: `SelectionResultCard` component (Classic)

**Files:**
- Create: `chrome-extension/reader/components/selection-result-card.tsx`

**Spec reference:** §8.2 Classic SelectionResultCard — colored dot (pulse when streaming) + action label + loc + Copy/Close + blockquote + body (ink-streaming during stream).

### Step 1: Create `selection-result-card.tsx`

```typescript
import type { MarginResult, Paper } from '../types';
import { I } from './icons';

interface Props {
  paper: Paper;
  result: MarginResult;
  streaming: boolean;
  onCopy: (body: string) => void;
  onClose: () => void;
}

const TONE: Record<MarginResult['kind'], { label: string; color: string }> = {
  explain:   { label: 'Explain',    color: 'var(--sky)' },
  summarize: { label: 'Summarize',  color: 'var(--walnut)' },
  translate: { label: 'Translate',  color: 'var(--forest)' },
};

function formatLoc(paper: Paper, paragraphId: string): string {
  const idx = paper.paragraphs.findIndex((p) => p.id === paragraphId);
  if (idx === -1) return '¶ ?';
  const p = paper.paragraphs[idx];
  const outlineItem = paper.outline.find((o) => o.id === p.sectionId);
  const parts: string[] = [];
  if (outlineItem?.page != null) parts.push(`p. ${outlineItem.page}`);
  parts.push(`§${p.section}`);
  parts.push(`¶ p${idx + 1}`);
  return parts.join(' · ');
}

export function SelectionResultCard({ paper, result, streaming, onCopy, onClose }: Props) {
  const tone = TONE[result.kind];
  const loc = formatLoc(paper, result.paragraphId);

  return (
    <div
      style={{
        padding: '14px 14px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 8,
        animation: 'fade-up 180ms ease-out',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 6, height: 6, borderRadius: 6, background: tone.color,
            animation: streaming ? 'pulse-ink 1.1s infinite' : 'none',
          }}
        />
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: tone.color, fontWeight: 600,
        }}>{tone.label}</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-ghost)',
        }}>· {loc}</span>
        <div style={{ flex: 1 }} />
        <button
          className="icon-btn"
          style={{ width: 20, height: 20 }}
          title="Copy result text"
          onClick={() => onCopy(result.body)}
        ><I.Close size={10} /></button>
        <button
          className="icon-btn"
          style={{ width: 20, height: 20 }}
          title="Close"
          onClick={onClose}
        ><I.Close size={10} /></button>
      </div>

      <blockquote style={{
        margin: '0 0 10px', padding: '4px 10px',
        borderLeft: '2px solid var(--walnut-soft)',
        fontFamily: 'var(--font-serif)', fontSize: 11.5,
        fontStyle: 'italic', color: 'var(--ink-faded)', lineHeight: 1.5,
      }}>"{result.source}"</blockquote>

      <div
        className={streaming ? 'ink-streaming' : ''}
        style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
          color: 'var(--ink)',
        }}
      >{result.body}</div>
    </div>
  );
}
```

Note: the two right-side buttons both use `I.Close`, a prototype quirk. The first is semantically "Copy" but uses the same icon (the prototype also didn't have a distinct copy icon — `I.Copy` was only added in Task 1). For visual fidelity with the prototype we keep `Close` on both. If you'd prefer the actual distinction, swap `I.Close size={10}` on the copy button to `I.Copy size={10}` — both icons exist now. Either is spec-compliant.

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/selection-result-card.tsx
git commit -m "feat(ext): SelectionResultCard (Classic) with loc + pulse + blockquote"
```

---

## Task 12: Focus variant wiring — `MarginColumn` in ViewerApp

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.1 Focus layout (paper column + margin-notes column).

### Step 1: Add `results` / `streamingKey` state + seed notes on mount

Open `chrome-extension/reader/main.tsx`. Add to the `storage` import:

```typescript
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory,
  getHighlights, addHighlight, getNotes,
} from './lib/storage';
```

Extend the types import:

```typescript
import type { Paper, ReaderVariant, Tweaks, Highlight, TextSelection, MarginResult } from './types';
```

Add two new state slots inside `ViewerApp` (alongside `highlights`):

```typescript
  const [results, setResults] = useState<MarginResult[]>([]);
  const [streamingKey, setStreamingKey] = useState<string | null>(null);
```

Add a mount effect that seeds `results` from storage (adjacent to the highlight seed):

```typescript
  // Seed margin notes from storage on mount so past results survive reload.
  useEffect(() => {
    let cancelled = false;
    getNotes(paperKey(paper)).then((ns) => {
      if (!cancelled) setResults(ns);
    });
    return () => { cancelled = true; };
  }, [paper]);
```

### Step 2: Render `MarginColumn` in Focus variant

Still in `main.tsx`, import the component:

```typescript
import { MarginColumn } from './components/margin-column';
```

The existing variant branch (from Plan 2 Task 16) renders the reader column as a single paper card. For Focus variant, the layout must become `[paper | margin-column]` when `tweaks.margins` is on. Replace the inner reader column content with a grid:

Find the block (in the `variant === 'canvas' ? … : (…)` branch):

```tsx
          <div
            ref={readerScrollRef}
            style={{
              flex: 1, minWidth: 0, overflow: 'auto',
              padding: '28px 24px 60px',
              display: 'flex', justifyContent: 'center',
            }}
          >
            <div
              className={tweaks.grain ? 'paper-grain' : ''}
              style={{...paper card...}}
            >
              <PaperPage .../>
              <SelectionToolbar .../>
            </div>
          </div>
```

Replace the inner `<div>` (the paper card) with a grid containing the paper card + optional margin column. Leave the scroll container alone:

```tsx
          <div
            ref={readerScrollRef}
            style={{
              flex: 1, minWidth: 0, overflow: 'auto',
              padding: '28px 24px 60px',
              display: 'flex', justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  variant === 'focus' && tweaks.margins
                    ? `${tweaks.pageWidth}px 240px`
                    : `${tweaks.pageWidth}px`,
                gap: variant === 'focus' && tweaks.margins ? 32 : 0,
                position: 'relative',
                margin: '0 auto',
                minWidth: 'min-content',
              }}
            >
              <div
                className={tweaks.grain ? 'paper-grain' : ''}
                style={{
                  background: 'var(--paper)',
                  border: '0.5px solid var(--rule)',
                  borderRadius: 2,
                  boxShadow: 'var(--shadow-2)',
                  padding: '56px 60px 80px',
                  position: 'relative',
                  minHeight: 900,
                }}
              >
                <PaperPage paper={paper} highlights={highlights} onSelect={setSelection} font={tweaks.readerFont} />
                <SelectionToolbar
                  selection={selection}
                  onAction={runAction}
                  onClose={closeSelection}
                  paperCardWidth={tweaks.pageWidth}
                />
              </div>

              {variant === 'focus' && tweaks.margins && (
                <MarginColumn paper={paper} results={results} streamingKey={streamingKey} />
              )}
            </div>
          </div>
```

The change preserves width/padding of the paper card and introduces a sibling margin column only in Focus.

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. The margin column currently renders nothing (empty results, empty memory) — that's the expected Phase 3 cold-start UX.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): Focus variant wires MarginColumn + seeds notes from storage"
```

---

## Task 13: Classic variant wiring — `SelectionResultCard` in `WorkspacePanel`

**Files:**
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.2 Classic Summary tab shows the latest `SelectionResultCard` above its body.

### Step 1: Extend `WorkspacePanel` to accept `results` + `streamingKey` + `paper`

Open `chrome-extension/reader/components/workspace-panel.tsx`. Add props and render the latest result card at the top of the Summary tab.

Replace the file contents with:

```typescript
import { CSSProperties } from 'react';
import type { Paper, MarginResult } from '../types';
import { SelectionResultCard } from './selection-result-card';
import { setToast } from './toast';

type Tab = 'summary' | 'chat' | 'memory';

interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  results: MarginResult[];
  streamingKey: string | null;
  onCloseLatest: () => void;
}

export function WorkspacePanel({ paper, tab, setTab, results, streamingKey, onCloseLatest }: Props) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderLeft: '0.5px solid var(--rule)',
    }}>
      <div style={{
        display: 'flex', borderBottom: '0.5px solid var(--rule)',
        padding: '8px 12px 0', gap: 2,
      }}>
        <TabBtn id="summary" label="Summary" active={tab} onClick={setTab} />
        <TabBtn id="chat"    label="Chat"    active={tab} onClick={setTab} />
        <TabBtn id="memory"  label="Memory"  active={tab} onClick={setTab} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {tab === 'summary' && <SummaryBody paper={paper} results={results} streamingKey={streamingKey} onCloseLatest={onCloseLatest} />}
        {tab === 'chat' && <Placeholder tab="chat" />}
        {tab === 'memory' && <Placeholder tab="memory" />}
      </div>
    </div>
  );
}

function SummaryBody({
  paper, results, streamingKey, onCloseLatest,
}: { paper: Paper; results: MarginResult[]; streamingKey: string | null; onCloseLatest: () => void }) {
  const latest = results[results.length - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {latest && (
        <SelectionResultCard
          paper={paper}
          result={latest}
          streaming={streamingKey === latest.id}
          onCopy={(body) => {
            navigator.clipboard.writeText(body).then(
              () => setToast('Copied.'),
              () => setToast('Copy failed.')
            );
          }}
          onClose={onCloseLatest}
        />
      )}
      <div style={{
        padding: 18,
        border: '0.5px dashed var(--rule)', borderRadius: 8,
        color: 'var(--ink-faded)', fontSize: 12, fontStyle: 'italic',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          textTransform: 'uppercase', marginBottom: 6, color: 'var(--ink-faded)',
        }}>summary</div>
        Three-line summary, key terms, and detailed summary arrive in Plan 4.
      </div>
    </div>
  );
}

function Placeholder({ tab }: { tab: 'chat' | 'memory' }) {
  const plan = tab === 'memory' ? 'Plan 3 (Task 18)' : 'Plan 4';
  return (
    <div style={{
      padding: 18,
      border: '0.5px dashed var(--rule)', borderRadius: 8,
      color: 'var(--ink-faded)', fontSize: 12, fontStyle: 'italic',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 6, color: 'var(--ink-faded)',
      }}>{tab}</div>
      Arrives in {plan}.
    </div>
  );
}

function TabBtn({
  id, label, active, onClick,
}: { id: Tab; label: string; active: Tab; onClick: (t: Tab) => void }) {
  const isActive = active === id;
  const style: CSSProperties = {
    padding: '8px 12px', fontSize: 12,
    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
    borderBottom: isActive ? '2px solid var(--walnut)' : '2px solid transparent',
    marginBottom: -0.5,
    fontWeight: isActive ? 600 : 400,
  };
  return <button onClick={() => onClick(id)} style={style}>{label}</button>;
}
```

Note: the Memory placeholder references "Task 18" — it's replaced by the real MemoryView in Task 18 of this plan.

### Step 2: Update `WorkspacePanel` caller in `main.tsx`

Open `chrome-extension/reader/main.tsx`. Find the `<WorkspacePanel tab={tab} setTab={setTab} />` render and replace with:

```tsx
            <WorkspacePanel
              paper={paper}
              tab={tab}
              setTab={setTab}
              results={results}
              streamingKey={streamingKey}
              onCloseLatest={() => setResults((rs) => rs.slice(0, -1))}
            />
```

Note: `onCloseLatest` removes the most recent entry from state only — it does NOT write to `paper:{key}:notes`. Closing a Classic card hides it for the current session but the note persists for future reloads (§8.2 "Classic only shows latest; history lives in Focus margin column"). If the persisted-vs-session distinction ever matters, Plan 4+ can refine.

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): WorkspacePanel Summary tab shows latest SelectionResultCard"
```

---

## Task 14: AI `runAction` — dispatch, stream, persist, handle §3.8 errors

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.3 action dispatch, §3.7 AI contract (already in `ai.ts`), §3.8 error paths (no BYOK / network / stream abort).

### Step 1: Rewrite `runAction` to call the streaming AI client

Open `chrome-extension/reader/main.tsx`. Add imports:

```typescript
import { addNote, getConfig } from './lib/storage';
import { buildMessages, callChatCompletion } from './lib/ai';
```

Replace the existing `runAction` implementation (Task 9's version that only handled highlight) with:

```typescript
  const runAction = async (kind: SelectionActionKind, sel: TextSelection) => {
    // Clear selection UI early regardless of action branch.
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    if (kind === 'highlight') {
      if (!sel.paragraphId) { setToast('Selection must be inside a paragraph to highlight.'); return; }
      const pid = sel.paragraphId;
      const next = await addHighlight(paperKey(paper), {
        paragraphId: pid, text: sel.text, color: 'yellow',
      });
      setHighlights(next);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-pid="${pid}"]`);
        if (!el) return;
        el.classList.add('paragraph-pinged');
        setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
      });
      return;
    }

    if (kind === 'ask') {
      // Ask lands in Plan 4; for now, toast and bail.
      setToast('Ask arrives in Plan 4.');
      return;
    }

    // E / S / T — AI streaming path
    if (!sel.paragraphId) { setToast('Selection must be inside a paragraph.'); return; }

    const config = await getConfig();
    if (!config || !config.apiKey) {
      setToast('API key not configured — open Options to set it.');
      // §3.8: the user-visible "Configure API key →" inline action is a
      // Plan 3.x polish. For now the toast is the only signal. The error
      // note pattern (inline error card in MarginColumn / SelectionResultCard)
      // ships in Task 20.
      return;
    }

    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const pending: MarginResult = {
      id,
      kind,
      source: sel.text,
      body: '',
      paragraphId: sel.paragraphId,
      createdAt: Date.now(),
    };

    // In Classic, the Summary tab always auto-focuses on the latest card, so
    // ensure we land there. In Focus, MarginColumn picks this up automatically.
    if (variant === 'classic') setTab('summary');

    setResults((rs) => [...rs, pending]);
    setStreamingKey(id);

    // Brief ink-ping animation on the source paragraph.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-pid="${sel.paragraphId}"]`);
      if (!el) return;
      el.classList.add('paragraph-pinged');
      setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
    });

    const messages = buildMessages(kind, paper, sel.text);
    let accum = '';
    try {
      for await (const chunk of callChatCompletion(config, messages)) {
        accum += chunk;
        // Update the matching in-memory entry so both Focus margin note and
        // Classic card re-render with the growing body.
        setResults((rs) => rs.map((r) => r.id === id ? { ...r, body: accum } : r));
      }
      // Stream ended cleanly → persist (§3.4).
      const completed: MarginResult = { ...pending, body: accum };
      await addNote(paperKey(paper), completed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
      // Remove the failed entry so we don't leave an empty placeholder (§3.8).
      setResults((rs) => rs.filter((r) => r.id !== id));
    } finally {
      setStreamingKey((k) => (k === id ? null : k));
    }
  };
```

Note: update the `runAction` callers (keyboard handler, SelectionToolbar) — they already pass `(kind, selection)`. The new `runAction` is async, but the callers don't await it (fire-and-forget is correct). TypeScript will complain if any caller typed the handler as sync; check both and fix if needed (`onAction={(k, s) => { void runAction(k, s); }}` is a safe no-op wrapper if required).

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): runAction streams E/S/T via ai.ts; persists + handles errors (§3.8)"
```

---

## Task 15: `StatusRail` reactive BYOK state

**Files:**
- Modify: `chrome-extension/reader/components/status-rail.tsx`

**Spec reference:** §3.8 StatusRail BYOK indicator must update live when Options page saves.

### Step 1: Retype state to `AiConfig | null` and listen to `chrome.storage.onChanged`

Phase 2's `status-rail.tsx` defined an internal `PaperFlowConfig` type duplicating what `AiConfig` (Task 3) now canonicalizes. Replace both the type + effect.

Open `chrome-extension/reader/components/status-rail.tsx`. Remove the local `PaperFlowConfig` interface. Add imports:

```typescript
import { getConfig } from '../lib/storage';
import type { AiConfig } from '../types';
```

Change the state declaration from `PaperFlowConfig | null` to `AiConfig | null`:

```typescript
  const [config, setConfig] = useState<AiConfig | null>(null);
```

Replace the existing `useEffect` with one that reads via `getConfig()` and subscribes to live changes:

```typescript
  useEffect(() => {
    let cancelled = false;
    getConfig().then((c) => { if (!cancelled) setConfig(c); });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!('config' in changes)) return;
      setConfig((changes.config.newValue as AiConfig | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
```

The dot logic `configured = !!config?.apiKey` and text `modelText = config?.model ?? 'not configured'` stays unchanged — both handle the new `AiConfig | null` shape correctly because `AiConfig.apiKey` is a non-optional `string` that's `''` when unset.

### Step 2: Build + typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/status-rail.tsx
git commit -m "feat(ext): StatusRail subscribes to chrome.storage.onChanged for live BYOK state"
```

---

## Task 16: Memory tab — read-only skeleton

**Files:**
- Create: `chrome-extension/reader/components/memory-view.tsx`
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`

**Spec reference:** §8.2 Memory tab — whyItMatters headline, role/judgment fields, linked (read-only), nextActions (checkable). This task lays down the read-only skeleton; editing ships in Task 17.

### Step 1: Create `memory-view.tsx`

```typescript
import type { Paper } from '../types';

interface Props {
  paper: Paper;
  onPatch: (patch: Partial<Paper['memory']>) => void;
}

/**
 * MemoryView read-only skeleton. Task 17 adds inline editing. Task 18 adds
 * nextActions add/toggle/delete + empty-state CTAs.
 */
export function MemoryView({ paper }: Props) {
  const m = paper.memory;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {m.whyItMatters.trim() ? (
        <div
          style={{
            padding: '16px 16px 14px',
            background: 'linear-gradient(180deg, var(--paper-soft) 0%, var(--paper) 100%)',
            border: '0.5px solid var(--rule)',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--walnut)', marginBottom: 6,
              fontWeight: 600,
            }}
          >Why this matters — for you</div>
          <div
            style={{
              fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.6,
              color: 'var(--ink)', fontWeight: 500,
            }}
          >{m.whyItMatters}</div>
        </div>
      ) : null}

      <Section label="Role in your research">
        <ReadOnlyText value={m.role} placeholder="(not set)" />
      </Section>

      <Section label="Your judgment">
        <ReadOnlyText value={m.judgment} placeholder="(not set)" />
      </Section>

      {m.linked.length > 0 && (
        <section>
          <SectionLabel>Linked context</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.linked.map((l, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  background: 'var(--paper-soft)',
                  border: '0.5px solid var(--rule)',
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-serif)', fontSize: 13, fontWeight: 600,
                    color: 'var(--ink)',
                  }}
                >{l.title}</div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 10, color: 'var(--ink-faded)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >{l.role}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: 'var(--font-serif)', fontStyle: 'italic',
                    fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
                  }}
                >{l.why}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Next actions</SectionLabel>
        {m.nextActions.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
            No actions yet. Editing lands in Task 18.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {m.nextActions.map((a, i) => (
            <label
              key={i}
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                padding: '8px 10px',
                background: 'var(--paper-soft)',
                border: '0.5px solid var(--rule)',
                borderRadius: 6,
                fontFamily: 'var(--font-serif)', fontSize: 12.5, lineHeight: 1.5,
                color: 'var(--ink-soft)',
              }}
            >
              <input type="checkbox" checked={a.done} readOnly style={{ marginTop: 3 }} />
              <span style={{ flex: 1, textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 8,
      }}
    >{children}</div>
  );
}

function ReadOnlyText({ value, placeholder }: { value: string; placeholder: string }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.6,
        color: value.trim() ? 'var(--ink)' : 'var(--ink-ghost)',
        padding: '2px 0', fontStyle: value.trim() ? 'normal' : 'italic',
      }}
    >{value.trim() || placeholder}</div>
  );
}
```

### Step 2: Wire MemoryView into WorkspacePanel

Open `chrome-extension/reader/components/workspace-panel.tsx`. Import MemoryView and pass an `onPatch` callback. Update `Props`:

```typescript
interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  results: MarginResult[];
  streamingKey: string | null;
  onCloseLatest: () => void;
  onMemoryPatch: (patch: Partial<Paper['memory']>) => void;
}
```

Update the tab render:

```tsx
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {tab === 'summary' && <SummaryBody paper={paper} results={results} streamingKey={streamingKey} onCloseLatest={onCloseLatest} />}
        {tab === 'chat' && <Placeholder tab="chat" />}
        {tab === 'memory' && <MemoryView paper={paper} onPatch={onMemoryPatch} />}
      </div>
```

Add the import at the top:

```typescript
import { MemoryView } from './memory-view';
```

The `Placeholder` function's `tab` param type narrows to `'chat'` since Memory is handled separately now:

```typescript
function Placeholder({ tab }: { tab: 'chat' }) {
  return (
    // ... same body, but the Plan 4 reference is cleaner
  );
}
```

Update any line that previously branched on `tab === 'memory'` inside Placeholder.

### Step 3: Wire `onMemoryPatch` in `main.tsx`

Add a helper inside `ViewerApp` (above `runAction`):

```typescript
  const patchMemory = async (patch: Partial<Paper['memory']>) => {
    const next = { ...paper.memory, ...patch };
    // Mutating `paper` via useState is impossible here because paper is a Boot
    // prop, not ViewerApp state. Instead write to storage and force the Memory
    // tab / margin column to re-render via a bump counter OR a local shadow
    // copy. We use a shadow copy: `memoryOverlay` holds any unsaved patches
    // applied on top of the parent paper.memory for render.
    await setMemory(paperKey(paper), next);
    setMemoryOverlay(next);
  };
```

Right below the existing `results`/`streamingKey` useState lines, add:

```typescript
  const [memoryOverlay, setMemoryOverlay] = useState<Paper['memory'] | null>(null);
```

Seed it on mount (same effect that loads notes, or a new one):

```typescript
  useEffect(() => { setMemoryOverlay(paper.memory); }, [paper]);
```

Create a computed `effectivePaper` that child components read instead of `paper`:

```typescript
  const effectivePaper: Paper = memoryOverlay ? { ...paper, memory: memoryOverlay } : paper;
```

Pass `effectivePaper` (not `paper`) to `OutlinePanel`, `PaperPage`, `MarginColumn`, `WorkspacePanel`, `TopBar`, `runAction`'s internal `paper` reference, and the notes seed effect's `paperKey(paper)` call — replace all `paper` usages inside the render/runAction with `effectivePaper`.

Wire the prop:

```tsx
            <WorkspacePanel
              paper={effectivePaper}
              tab={tab}
              setTab={setTab}
              results={results}
              streamingKey={streamingKey}
              onCloseLatest={() => setResults((rs) => rs.slice(0, -1))}
              onMemoryPatch={patchMemory}
            />
```

Also update `buildMessages(kind, effectivePaper, sel.text)` inside `runAction` (so memory injection uses current state).

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/memory-view.tsx \
  chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): MemoryView read-only + memoryOverlay state + Workspace wiring"
```

---

## Task 17: Memory tab — inline edit for role + judgment

**Files:**
- Modify: `chrome-extension/reader/components/memory-view.tsx`

**Spec reference:** §8.2 role with quick-select standard buttons, judgment with foxglove edit border, Save/Cancel flow, live write via `onPatch`.

### Step 1: Extract `EditableField` + quick-select logic

Replace `memory-view.tsx`'s existing `Section` / `ReadOnlyText` usage for role + judgment with an `EditableField` that toggles between display and edit modes.

Add the new component + standard-role constants at the top of `memory-view.tsx` (below the imports):

```typescript
import { useState } from 'react';
import { I } from './icons';

const ROLE_STANDARDS = [
  'Background',
  'Method reference',
  'Counter-evidence',
  'Tangential',
  'Central',
] as const;
```

Replace the two `<Section label="Role in your research">` / `<Section label="Your judgment">` blocks in the rendered tree with:

```tsx
      <EditableField
        label="Role in your research"
        value={m.role}
        tone="walnut"
        options={[...ROLE_STANDARDS]}
        onSave={(v) => onPatch({ role: v })}
      />

      <EditableField
        label="Your judgment"
        value={m.judgment}
        tone="foxglove"
        onSave={(v) => onPatch({ judgment: v })}
      />
```

Append the `EditableField` implementation at the bottom of the file (after the helper functions):

```typescript
interface EditableFieldProps {
  label: string;
  value: string;
  tone: 'walnut' | 'foxglove';
  options?: string[];
  onSave: (v: string) => void;
}

function EditableField({ label, value, tone, options, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const toneColor = tone === 'foxglove' ? 'var(--foxglove)' : 'var(--walnut)';

  // Sync draft when incoming value changes (e.g. after patch round-trip).
  // Only overwrite when not currently editing to avoid clobbering user input.
  if (!editing && draft !== value) {
    setDraft(value);
  }

  const applyOption = (opt: string) => {
    // Format: "{opt} — {freeform suffix}". If draft already had a " — " suffix,
    // preserve it. Otherwise just set draft to "{opt} — ".
    const rest = draft.split(' — ').slice(1).join(' — ');
    setDraft(rest ? `${opt} — ${rest}` : `${opt} — `);
  };

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)',
        }}>{label}</div>
        {!editing && (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            style={{
              fontSize: 10, color: 'var(--ink-faded)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          ><I.Edit size={10} stroke={1.4} /> edit</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={3}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: `0.5px solid ${toneColor}`,
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink)', resize: 'vertical', outline: 'none',
            }}
          />
          {options && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {options.map((o) => (
                <button
                  key={o}
                  onClick={() => applyOption(o)}
                  style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 3,
                    border: '0.5px solid var(--rule)',
                    color: 'var(--ink-faded)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >{o}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setDraft(value); setEditing(false); }}
              style={{ fontSize: 11, color: 'var(--ink-faded)', padding: '4px 10px' }}
            >Cancel</button>
            <button
              onClick={() => { onSave(draft); setEditing(false); }}
              style={{
                fontSize: 11, padding: '4px 10px',
                background: 'var(--ink)', color: 'var(--paper)',
                borderRadius: 4, fontWeight: 500,
              }}
            >Save</button>
          </div>
        </div>
      ) : (
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.6,
          color: value.trim() ? 'var(--ink)' : 'var(--ink-ghost)',
          padding: '2px 0', fontStyle: value.trim() ? 'normal' : 'italic',
        }}>
          {value.trim() || '(not set)'}
        </div>
      )}
    </section>
  );
}
```

Remove the now-unused `Section`, `ReadOnlyText`, and their call sites (they're superseded by `EditableField`). Keep `SectionLabel` — it's still used by Linked context and Next actions.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/memory-view.tsx
git commit -m "feat(ext): MemoryView role + judgment inline edit with standard-role quick select"
```

---

## Task 18: Memory `nextActions` — add/toggle/delete

**Files:**
- Modify: `chrome-extension/reader/components/memory-view.tsx`

**Spec reference:** §8.2 nextActions checklist — add via "+ Add action" input, checkbox toggles `done` per §3.5 schema, hover reveals delete.

### Step 1: Replace the read-only nextActions section with an interactive one

Open `chrome-extension/reader/components/memory-view.tsx`. Replace the existing `<section>` containing `Next actions` with:

```tsx
      <NextActionsSection actions={m.nextActions} onPatch={onPatch} />
```

Add the `NextActionsSection` component at the bottom of the file:

```typescript
interface NextActionsProps {
  actions: Paper['memory']['nextActions'];
  onPatch: (patch: Partial<Paper['memory']>) => void;
}

function NextActionsSection({ actions, onPatch }: NextActionsProps) {
  const [draft, setDraft] = useState('');

  const toggle = (i: number) => {
    const next = actions.map((a, j) => (j === i ? { ...a, done: !a.done } : a));
    onPatch({ nextActions: next });
  };

  const remove = (i: number) => {
    onPatch({ nextActions: actions.filter((_, j) => j !== i) });
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onPatch({ nextActions: [...actions, { text, done: false }] });
    setDraft('');
  };

  return (
    <section>
      <SectionLabel>Next actions</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map((a, i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 12.5, lineHeight: 1.5,
              color: 'var(--ink-soft)',
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget.querySelector<HTMLButtonElement>('button[data-nx-del]');
              if (btn) btn.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget.querySelector<HTMLButtonElement>('button[data-nx-del]');
              if (btn) btn.style.opacity = '0';
            }}
          >
            <input
              type="checkbox"
              checked={a.done}
              onChange={() => toggle(i)}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <span style={{ flex: 1, textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span>
            <button
              data-nx-del
              onClick={() => remove(i)}
              title="Remove action"
              style={{
                opacity: 0, transition: 'opacity 120ms',
                color: 'var(--ink-faded)',
                padding: 0, marginLeft: 6, fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}
        <div
          style={{
            display: 'flex', gap: 6, alignItems: 'center',
            padding: '6px 10px',
            background: 'var(--paper-soft)',
            border: '0.5px dashed var(--rule)',
            borderRadius: 6,
          }}
        >
          <I.Plus size={11} stroke={1.5} style={{ color: 'var(--ink-faded)' }} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="Add action…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontFamily: 'var(--font-serif)', fontSize: 12.5, color: 'var(--ink)',
            }}
          />
          {draft.trim() && (
            <button
              onClick={add}
              style={{
                fontSize: 11, padding: '2px 8px',
                background: 'var(--ink)', color: 'var(--paper)',
                borderRadius: 3,
              }}
            >Add</button>
          )}
        </div>
      </div>
    </section>
  );
}
```

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/memory-view.tsx
git commit -m "feat(ext): MemoryView nextActions add/toggle/delete"
```

---

## Task 19: Memory empty-state CTA + whyItMatters absence handling

**Files:**
- Modify: `chrome-extension/reader/components/memory-view.tsx`

**Spec reference:** §3.5 empty-state rules — CTA "Set role and judgment to ground your memory" when both empty; whyItMatters card hidden when `''`; linked section hidden when no linked items (already handled in Task 16).

### Step 1: Add the empty-state CTA

Open `chrome-extension/reader/components/memory-view.tsx`. At the top of the `MemoryView` return (before the `{m.whyItMatters.trim() ? (` conditional), add:

```tsx
      {!m.role.trim() && !m.judgment.trim() && (
        <div
          style={{
            padding: '10px 12px',
            background: 'color-mix(in oklch, var(--walnut) 8%, var(--paper-soft))',
            border: '0.5px solid var(--walnut-soft)',
            borderRadius: 6,
            fontSize: 12, color: 'var(--ink-soft)',
            fontStyle: 'italic', lineHeight: 1.5,
          }}
        >
          Set role and judgment to ground your memory.
        </div>
      )}
```

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/memory-view.tsx
git commit -m "feat(ext): MemoryView empty-state CTA for role+judgment"
```

---

## Task 20: §3.8 inline error rendering — no-config error note

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.8 — when API key is missing, inline an error at the note position (MarginColumn or SelectionResultCard) with "Configure API key →" linking to Options via `chrome.runtime.openOptionsPage()`.

### Step 1: Represent the error as a synthetic `MarginResult`

Extend the `MarginResult` type to include an `error` marker. Instead of widening the type (which would ripple into ai.ts / storage), we use a `body` field containing a known prefix; MarginNote and SelectionResultCard already render `body` as text. Simpler: render a dedicated `ErrorNote` component fed by a separate state slot. That's what we do.

Open `chrome-extension/reader/main.tsx`. Add near the other state:

```typescript
  const [pendingError, setPendingError] = useState<{
    id: string;
    paragraphId: string;
    message: string;
  } | null>(null);
```

Inside `runAction`, replace the "no config" toast-only branch with:

```typescript
    if (!config || !config.apiKey) {
      setPendingError({
        id: `err-${Date.now()}`,
        paragraphId: sel.paragraphId,
        message: 'API key not configured. Click to open Options →',
      });
      setTimeout(() => setPendingError(null), 6500);
      return;
    }
```

And create an inline `<ErrorBanner>` at the top of the paper reading area that overlays when `pendingError` is set. Add below the rest of the reader column:

```tsx
      {pendingError && (
        <div
          role="alert"
          onClick={() => chrome.runtime.openOptionsPage()}
          style={{
            position: 'fixed', bottom: 64, left: '50%', transform: 'translateX(-50%)',
            background: 'color-mix(in oklch, var(--foxglove) 12%, var(--paper-soft))',
            border: '0.5px solid var(--foxglove)',
            borderRadius: 6, padding: '10px 14px',
            fontSize: 12, color: 'var(--foxglove)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-2)',
            zIndex: 450,
            animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
          }}
        >{pendingError.message}</div>
      )}
```

### Step 2: Replace the placeholder toast

In the `!config || !config.apiKey` check inside `runAction`, delete the `setToast('API key not configured …')` line (if still present from Task 14) — the inline banner is the primary surface now. The `setPendingError(...)` line replaces it.

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): inline BYOK error banner with click-through to Options (§3.8)"
```

---

## Task 21: Final — tests + typecheck + build + smoke

**Files:** (no source changes unless fixes required)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected: all tests pass. Phase 2 shipped with 58 tests; Phase 3 adds:
- `storage.test.ts`: +1 (highlight race) +4 (config) +4 (notes) = +9
- `ai.test.ts`: 4 (paper context) +8 (memory+prompts+buildMessages) +6 (streaming) = 18 new
Total ~85 tests.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit 0. `dist/` contains `options/index.html` (now a Vite entry), `dist/assets/options-*.js`, updated `reader-*.js`. Verify:

```bash
ls dist/options/ dist/assets/ | head -20
```

Expected: at least `index.html` under `dist/options/` and at least one `options-*.js` under `dist/assets/`.

- [ ] **Step 4: Manual Chrome smoke test**

1. `chrome://extensions` → remove the Phase 2 PaperFlow → Load unpacked → `chrome-extension/dist/`.
2. Right-click the extension → Options → fill in baseURL / apiKey / model → Save. Verify "✓ Saved." flashes.
3. Navigate to `https://arxiv.org/html/2402.18413`. StatusRail dot should be forest green, showing `local memory · {model} · BYOK`.
4. Select text in a paragraph → toolbar appears → press `E`. In Focus: a MarginNote appears alongside the paragraph and types out the explanation. In Classic: SelectionResultCard streams at the top of Summary tab.
5. Reload the page. Past margin notes are restored (Focus shows them stacked).
6. Switch to Classic → Memory tab. Click "edit" on Role → type "Background — strong", click a quick-select "Central" → verify prefix swap → Save. Reload and confirm persistence.
7. Add a nextAction, check it, uncheck, delete. Reload — state persists.
8. Remove the Options config (delete apiKey field, Save). StatusRail dot goes foxglove. Trigger E again — inline error banner appears with "Click to open Options →". Click it → Options page opens.
9. Test stream abort resilience (optional): trigger E, then navigate to another paper. No crash.

- [ ] **Step 5: Append verification log**

Append to this plan file at the bottom:

```markdown
---

## Verification log

Phase 3 automated verification complete (2026-04-21):
- `npm test` → ~85 passed across 7 files
- `npm run typecheck` → exit 0
- `npm run build` → green; `dist/options/` has real Vite output; reader + content + sw unchanged layout
- Manual Chrome smoke test (BYOK save, E/S/T streaming in Focus + Classic, Memory edit/persist, inline BYOK error) is user-driven and runs after merge.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-21-plan-phase-3-ai-core.md
git commit -m "docs(plan): Phase 3 verification log"
```

---

## Phase 3 Done Criteria

- ✅ Options page BYOK form saves `{baseURL, apiKey, model}` to `chrome.storage.local.config` with trailing-slash normalization
- ✅ StatusRail dot + model text update live on config change
- ✅ E/S/T selection actions call OpenAI-compatible `/chat/completions` streaming
- ✅ Focus variant streams result into `MarginNote` anchored to the source paragraph
- ✅ Classic variant streams result into `SelectionResultCard` at top of Summary tab
- ✅ Completed notes persist to `paper:{key}:notes`; reload restores them
- ✅ Memory tab supports role + judgment inline edit with standard-role quick-select
- ✅ Memory nextActions add / toggle / delete; done state persists
- ✅ Memory whyItMatters + linked empty states follow §3.5 rules
- ✅ §3.8 BYOK missing error renders as inline clickable banner opening Options page
- ✅ Plan 2 review follow-ups resolved: toolbar clamp, icons typing, variant split, storage write queue
- ✅ All unit tests pass (~85); typecheck clean; build green

---

## Verification log

Phase 3 automated verification complete (2026-04-21):
- `npm test` → 88 passed across 7 files (ids 11, parse 3, paper 11, storage 17, arxiv 16, pdf 9, ai 21)
- `npm run typecheck` → exit 0
- `npm run build` → green; `dist/options/index.html` present as real Vite entry (options-*.js), shared `storage-*.js` + `storage-*.css` chunks reused across reader + options; content `inject.js` unchanged IIFE
- Manual Chrome smoke test (BYOK save via Options page, E/S/T streaming in Focus + Classic, Memory role/judgment edit + nextActions CRUD, inline BYOK error banner click-through to Options) is user-driven and runs after merge.

## Next: Plan 4

Plan 4 introduces the full Classic Summary tab (three model-isolated cache sections with 3s throttle + 300ms dwell trigger, §3.9 cache keys, §8.2 loading states), the Chat tab with citation parsing per §3.7.4, the Ask (?) selection action with SelectionPinnedChip (§3.7.5, consumes the `{ transient: true }` variant path from Task 1 here), and the Library drawer wired to real `chrome.storage.local` with role/topic/recent grouping and LibraryRow rendering (§3.4). CmdK gains Paper/Memory AI commands at that time.
