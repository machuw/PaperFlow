# PaperFlow Chrome Extension — Phase 4: Summary + Chat + Library + Ask

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Classic Workspace (Summary + Chat tabs), wire the Ask (?) selection action with `SelectionPinnedChip` and transient variant switching, light up the Library drawer against real `chrome.storage.local` data, and expand CmdK to the full v1 command set. Also resolve the tracked carryovers from Plan 3's review (inline BYOK error at anchor, `runAction` stale-closure, abort test teeth, SSE CRLF tolerance, Memory UX polish).

**Architecture:** Summary tab keeps three independent AI results (threeLine / keyTerms / detailed) each cached under `paper:{key}:summary:{section}:{model}` (§3.9 model-isolated cache); generation triggers 3 s after parse completes OR 300 ms after user stays on the Summary tab, whichever comes first, cancelling on tab close. Chat tab streams through the existing `ai.ts` client using the Chat base prompt (§3.7.3) + paper context + memory, then parses `[pN]` / `[abs]` citations at `onStreamDone` into `msg.citations` (§3.7.4). Ask (?) routes through Chat with a `SelectionPinnedChip`, a one-shot transient variant switch to Classic (uses Plan 3's `setVariant(v, { transient: true })` hook), and a `"About this passage: > {selected}\n\n{user input}"` wrapper. Library is a single global `chrome.storage.local['library']` array of `LibraryRow` entries, kept in sync via a `syncLibraryRow(paper, pages)` helper called from paper-open and every mutation hook (`addNote` / `addHighlight` / `patchMemory`).

**Tech Stack:** React 18, TypeScript 5 strict, Vitest. No new runtime deps.

**Spec references:**
- §3.3 Selection actions (Ask is the last missing kind)
- §3.4 Library schema + LibraryDrawer rendering + `paper:{key}:chat` + `paper:{key}:summary:*` keys
- §3.5 Memory empty-state (re-asserted in LibraryRow hasMemory)
- §3.6 Role standard values + `extractRolePrefix` (spine colors, role chip)
- §3.7.1 Paper context injection (reused for Chat)
- §3.7.2 Memory injection (reused for Chat)
- §3.7.3 Chat base prompt template
- §3.7.4 Chat `[pN]` / `[abs]` citation parsing + `formatLoc`
- §3.7.5 Ask (?) SelectionPinnedChip + transient variant + wrapper format
- §3.8 AI error paths (inline at anchor this time, replacing Plan 3's floating banner)
- §3.9 Model cache isolation for Summary
- §8.2 Classic Summary + Chat + ContextIndicator + SelectionResultCard layout
- §9.1 CmdK v1 command set (Paper + Memory + Jump + View)

**Plan 3 review carryover (resolved in Tasks 1–2):**
- **Important:** Inline BYOK error at anchor (replaces Plan 3 Task 20's floating banner).
- **Important:** `runAction` stale-closure hardening via `useCallback` with full deps.
- **Important:** Abort test teeth — never-resolving mock body so `abort()` produces a real rejection.
- **Minor:** SSE parser tolerates `\r\n\r\n` frame separators.
- **Minor:** Role quick-select "selected" styling.
- **Minor:** `nextActions` delete-button CSS `:hover` (remove imperative style mutation).

**Not in Phase 4:**
- Canvas mode (react-flow + dagre + node types) — Plan 5
- Plan 1 review residuals: I3 (arXiv API `<title>` scoping), I4 (HTML-OK/API-fail partial load), I5 (SW `return false` hygiene) — Plan 5
- `chrome.storage.local` quota toast (§10) — Plan 5
- Dark-mode verification + final polish — Plan 5
- CmdK `Jump to § N` dynamic chapter entries (§10, v1 scope-out)
- `whyItMatters` Keep/Rewrite/Doesn't fit buttons (§8.2 v1 visual-only)
- `linked` add/edit/delete (§8.2 v1 read-only)
- Translate target language configurability (§10, v1.1)

---

## File Map

| File | Responsibility | Action |
|------|----------------|--------|
| `chrome-extension/reader/main.tsx` | `runAction` → `useCallback`; inline BYOK error at anchor; Ask handler; syncLibraryRow side-effects | Modify |
| `chrome-extension/reader/lib/ai.ts` | SSE CRLF tolerance; `buildChatMessages`; `extractCitations`; `formatLoc` | Modify |
| `chrome-extension/tests/lib/ai.test.ts` | Abort teeth; Chat builders / citation parser tests | Modify |
| `chrome-extension/reader/lib/paper.ts` | `formatRelative(ms)`; `getVisibleParagraphs(container)` | Modify |
| `chrome-extension/tests/lib/paper.test.ts` | Tests for both helpers | Modify |
| `chrome-extension/reader/lib/library.ts` | `LibraryRow` CRUD + `syncLibraryRow(paper, pages)` | Create |
| `chrome-extension/tests/lib/library.test.ts` | CRUD + sync + grouping/filtering tests | Create |
| `chrome-extension/reader/lib/storage.ts` | `getChat` / `setChat` / `appendChatMessage`; `getSummarySection` / `setSummarySection` (model-keyed) | Modify |
| `chrome-extension/tests/lib/storage.test.ts` | Tests for chat + summary wrappers | Modify |
| `chrome-extension/reader/types.ts` | `ChatMessage`, `Citation`, `LibraryRow`, `SummarySection`, `AskPrefill` | Modify |
| `chrome-extension/reader/components/memory-view.tsx` | Role quick-select selected styling; nextActions delete-btn CSS polish | Modify |
| `chrome-extension/reader/components/chat-view.tsx` | Full Chat tab (messages + composer + suggestions + citations) | Create |
| `chrome-extension/reader/components/selection-pinned-chip.tsx` | Pinned chip above composer for Ask prefill | Create |
| `chrome-extension/reader/components/summary-view.tsx` | Three-section Summary + throttle + cache + refresh | Create |
| `chrome-extension/reader/components/library-drawer.tsx` | Replace placeholder shell with real drawer | Create (replaces stub in overlays.tsx) |
| `chrome-extension/reader/components/library-row.tsx` | Single row rendering + spine + role chip + NOW badge | Create |
| `chrome-extension/reader/components/context-indicator.tsx` | "Generated from full paper · N chunks · via {model}" | Create |
| `chrome-extension/reader/components/overlays.tsx` | Drop LibraryDrawer stub; expand CmdK command list | Modify |
| `chrome-extension/reader/components/workspace-panel.tsx` | Wire ChatView + SummaryView; plumb askPrefill prop | Modify |
| `chrome-extension/reader/components/selection-toolbar.tsx` | (unchanged from Plan 3 carryover fix) | Modify (carryover only) |
| `chrome-extension/reader/components/margin-column.tsx` | Inline BYOK error at anchor | Modify |
| `chrome-extension/reader/components/selection-result-card.tsx` | Inline BYOK error at top in Classic | Modify |
| `chrome-extension/reader/components/tokens.css` | `.nx-del` hover CSS selector (via styles/tokens.css) | Modify |

**New:** 7 files (library.ts + test; chat-view, summary-view, library-drawer, library-row, selection-pinned-chip, context-indicator). **Modified:** 10.

---

## Task 1: Plan 3 review carryover A — `runAction` useCallback + abort test + SSE CRLF

**Files:**
- Modify: `chrome-extension/reader/main.tsx`
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** Plan 3 review follow-ups #4, #5, #7.

### Step 1: Tighten the abort test

Open `chrome-extension/tests/lib/ai.test.ts`. Find the existing `'aborts the fetch when signal fires'` test and replace with a version that verifies the caller sees a real rejection:

```typescript
  it('aborts the fetch when signal fires and iteration throws', async () => {
    // Never-ending body so abort() has something live to interrupt.
    const neverBody = new ReadableStream<Uint8Array>({
      start(controller) {
        // Hold the controller indefinitely; only release when aborted.
        setTimeout(() => controller.close(), 5000);
      },
    });

    let abortFired = false;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => { abortFired = true; });
      // Simulate a fetch that respects the abort signal.
      if (init.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Resolve eagerly with never-ending body if not aborted in the turn.
        resolve(new Response(neverBody, { status: 200 }));
      });
    }) as any;

    const ac = new AbortController();
    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }], { signal: ac.signal });
    // Abort before anyone iterates.
    ac.abort();

    let caught: unknown = null;
    try {
      for await (const _ of iter) { /* drain */ }
    } catch (err) {
      caught = err;
    }
    expect(abortFired).toBe(true);
    expect(caught).toBeTruthy();
    expect(String(caught)).toMatch(/Abort/i);
  });
```

### Step 2: SSE CRLF tolerance

Open `chrome-extension/reader/lib/ai.ts`. Find the SSE parser loop — the line that splits on `\n\n`. Replace the inner while loop with a version that accepts both `\n\n` and `\r\n\r\n`:

```typescript
      // Parse complete SSE events from the buffer. Each event is terminated
      // by a blank line — accept both LF-LF and CRLF-CRLF variants because
      // some proxies re-encode line endings.
      const findFrame = () => {
        const lf = buffer.indexOf('\n\n');
        const crlf = buffer.indexOf('\r\n\r\n');
        if (lf === -1) return { pos: crlf, len: 4 };
        if (crlf === -1) return { pos: lf, len: 2 };
        return crlf < lf ? { pos: crlf, len: 4 } : { pos: lf, len: 2 };
      };

      let frameInfo = findFrame();
      while (frameInfo.pos !== -1) {
        const frame = buffer.slice(0, frameInfo.pos);
        buffer = buffer.slice(frameInfo.pos + frameInfo.len);

        // Frame lines: typically a single `data: {...}` or `data: [DONE]`.
        const dataLine = frame.split(/\r?\n/).find((l) => l.startsWith('data: '));
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
            // Malformed frame — skip silently.
          }
        }
        frameInfo = findFrame();
      }
```

(The outer `while (true) { …await reader.read()… }` loop is unchanged.)

### Step 3: Add a CRLF test

Append to `chrome-extension/tests/lib/ai.test.ts` inside the existing `describe('callChatCompletion', …)`:

```typescript
  it('tolerates \\r\\n\\r\\n frame separators', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"CR"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"LF"}}]}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('CRLF');
  });
```

### Step 4: `runAction` → `useCallback`

Open `chrome-extension/reader/main.tsx`. Add `useCallback` to the React imports:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
```

Wrap the existing `runAction` body in `useCallback` with the complete dep list. The callers (keyboard handler, `<SelectionToolbar onAction={runAction}>`) already invoke it fire-and-forget, so memoization doesn't break them.

Replace:

```typescript
  const runAction = async (kind: SelectionActionKind, sel: TextSelection) => {
    // ... entire existing body ...
  };
```

With:

```typescript
  const runAction = useCallback(async (kind: SelectionActionKind, sel: TextSelection) => {
    // ... entire existing body, unchanged ...
  }, [paper, effectivePaper, variant, tab, memoryOverlay]);
```

The deps include every state that the body reads: `paper` (URL-derived key), `effectivePaper` (memory injection), `variant` (auto-switch to Summary tab in Classic), `tab` (read via setTab call — but setter is stable so not needed), `memoryOverlay` (implicit via effectivePaper). Setters (`setSelection`, `setHighlights`, `setResults`, `setStreamingKey`, `setTab`, `setPendingError`) are all stable by React contract and don't need listing.

If the keydown handler's `useEffect([selection, outlineOpen])` reads `runAction`, React's exhaustive-deps lint will now require adding it. Update:

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ... existing body, unchanged ...
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, outlineOpen, runAction]);
```

### Step 5: Run tests + typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test && npm run typecheck && npm run build
```

Expected: 89 tests pass (previous 88 + 1 new CRLF). The reworked abort test should still pass against the eager-fetch pattern from Plan 3 Task 8. Build green.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx \
  chrome-extension/reader/lib/ai.ts \
  chrome-extension/tests/lib/ai.test.ts
git commit -m "fix(ext): Plan 3 review — runAction useCallback + abort test teeth + SSE CRLF"
```

---

## Task 2: Plan 3 review carryover B — inline BYOK error at anchor + memory UX polish

**Files:**
- Modify: `chrome-extension/reader/main.tsx`
- Modify: `chrome-extension/reader/components/margin-column.tsx`
- Modify: `chrome-extension/reader/components/selection-result-card.tsx`
- Modify: `chrome-extension/reader/components/memory-view.tsx`
- Modify: `chrome-extension/reader/styles/tokens.css`

**Spec reference:** Plan 3 review follow-ups #3, #6.

### Step 1: Delete the floating banner from `main.tsx`

Open `chrome-extension/reader/main.tsx`. Remove the `pendingError` state, the auto-dismiss effect, and the `<div role="alert" ...>` fixed-position banner JSX. Keep `setPendingError` signaling intact but re-shape it — the banner will now render inline inside `MarginColumn` (Focus) and at the top of the Summary tab's result list (Classic).

Rename for clarity and restructure the state:

```typescript
  // Plan 4 §3.8 inline BYOK error at anchor. When set, MarginColumn (Focus)
  // and SelectionResultCard list head (Classic) render a clickable error
  // node that calls chrome.runtime.openOptionsPage().
  const [byokError, setByokError] = useState<{
    id: string;
    paragraphId: string;
  } | null>(null);

  // Auto-dismiss 6.5 s after it's set. Reset on new error so late timers
  // don't clear a fresher banner.
  useEffect(() => {
    if (!byokError) return;
    const t = setTimeout(() => setByokError(null), 6500);
    return () => clearTimeout(t);
  }, [byokError?.id]);
```

In the `runAction` no-config branch, set `byokError` instead of `pendingError`:

```typescript
    if (!config || !config.apiKey) {
      setByokError({
        id: `err-${Date.now()}`,
        paragraphId: sel.paragraphId,
      });
      return;
    }
```

Remove the entire `<div role="alert" ... >` JSX block from the render tree.

### Step 2: Pass `byokError` into MarginColumn + WorkspacePanel

Still in `main.tsx`, thread the new state to both surfaces. Update the existing `<MarginColumn>` render:

```tsx
              {variant === 'focus' && tweaks.margins && (
                <MarginColumn
                  paper={effectivePaper}
                  results={results}
                  streamingKey={streamingKey}
                  byokError={byokError}
                  onDismissByokError={() => setByokError(null)}
                />
              )}
```

And the `<WorkspacePanel>` render:

```tsx
              <WorkspacePanel
                paper={effectivePaper}
                tab={tab}
                setTab={setTab}
                results={results}
                streamingKey={streamingKey}
                onCloseLatest={() => setResults((rs) => rs.slice(0, -1))}
                onMemoryPatch={patchMemory}
                byokError={byokError}
                onDismissByokError={() => setByokError(null)}
              />
```

### Step 3: MarginColumn renders inline error when `byokError` is set

Open `chrome-extension/reader/components/margin-column.tsx`. Extend Props:

```typescript
interface Props {
  paper: Paper;
  results: MarginResult[];
  streamingKey: string | null;
  byokError: { id: string; paragraphId: string } | null;
  onDismissByokError: () => void;
}
```

Destructure and add one more synthetic note at render time. In `buildNotes(...)`, after pushing default memory notes and before pushing AI results, check if `byokError` applies and insert an error-kind note:

```typescript
function buildNotes(
  paper: Paper,
  results: MarginResult[],
  streamingKey: string | null,
  byokError: Props['byokError'],
): ComputedNote[] {
  // ... existing default-memory-notes logic ...

  if (byokError) {
    out.push({
      id: `err-${byokError.id}`,
      variant: 'error',
      label: 'CONFIGURE API KEY',
      body: 'API key not configured. Click to open Options.',
      anchorPid: byokError.paragraphId,
      streaming: false,
    });
  }

  // ... existing loop over results ...
}
```

The `ComputedNote.variant` union grows: add `'error'` to the `AiActionKind | 'why' | 'linked'` union.

Update the `MarginNote` component (`chrome-extension/reader/components/margin-note.tsx`) `TONES` map:

```typescript
const TONES: Record<AiActionKind | 'why' | 'linked' | 'error', Tone> = {
  explain:   { color: 'var(--sky)',      label: 'explain' },
  summarize: { color: 'var(--walnut)',   label: 'summarize' },
  translate: { color: 'var(--forest)',   label: 'translate' },
  why:       { color: 'var(--walnut)',   label: 'why this matters' },
  linked:    { color: 'var(--sky)',      label: 'linked context' },
  error:     { color: 'var(--foxglove)', label: 'configure api key' },
};
```

And the `Props.variant` type signature on MarginNote:

```typescript
interface Props {
  offset: number;
  variant: AiActionKind | 'why' | 'linked' | 'error';
  // ... rest unchanged ...
}
```

In MarginColumn, wrap the `<MarginNote>` element for `'error'` variant in a button that opens Options on click:

```tsx
      {notes.map((n, i) => {
        const node = (
          <MarginNote
            offset={offsets[n.id] ?? 200 + i * 160}
            variant={n.variant}
            label={n.label}
            source={n.source}
            body={n.body}
            streaming={n.streaming}
          />
        );
        if (n.variant === 'error') {
          return (
            <div
              key={n.id}
              onClick={() => {
                chrome.runtime.openOptionsPage();
                onDismissByokError();
              }}
              style={{ cursor: 'pointer' }}
              role="alert"
            >{node}</div>
          );
        }
        return <div key={n.id}>{node}</div>;
      })}
```

Pass `byokError` into `buildNotes` when computing notes.

### Step 4: Classic — render error at top of Summary SelectionResultCard list

Open `chrome-extension/reader/components/workspace-panel.tsx`. Extend Props:

```typescript
interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  results: MarginResult[];
  streamingKey: string | null;
  onCloseLatest: () => void;
  onMemoryPatch: (patch: Partial<Paper['memory']>) => void;
  byokError: { id: string; paragraphId: string } | null;
  onDismissByokError: () => void;
}
```

Pass through to the `SummaryBody` helper. In `SummaryBody`, render an inline error node above the SelectionResultCard:

```tsx
function SummaryBody({
  paper, results, streamingKey, onCloseLatest, byokError, onDismissByokError,
}: /* extend signature */) {
  const latest = results[results.length - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {byokError && (
        <button
          role="alert"
          onClick={() => { chrome.runtime.openOptionsPage(); onDismissByokError(); }}
          style={{
            padding: '10px 14px',
            background: 'color-mix(in oklch, var(--foxglove) 12%, var(--paper-soft))',
            border: '0.5px solid var(--foxglove)',
            borderRadius: 8,
            fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic',
            color: 'var(--foxglove)', lineHeight: 1.55,
            textAlign: 'left', cursor: 'pointer',
          }}
        >API key not configured. Click to open Options →</button>
      )}
      {latest && (/* existing SelectionResultCard render, unchanged */)}
      {/* existing Plan 4 placeholder card, unchanged */}
    </div>
  );
}
```

### Step 5: Memory `nextActions` delete-button via CSS `:hover`

Open `chrome-extension/reader/styles/tokens.css`. Append near the bottom:

```css
/* MemoryView nextActions row — reveal delete button on hover. */
.nx-row .nx-del { opacity: 0; transition: opacity 120ms; }
.nx-row:hover .nx-del { opacity: 1; }
```

Open `chrome-extension/reader/components/memory-view.tsx`. Replace the `onMouseEnter`/`onMouseLeave` imperative style block on the action row with a `className="nx-row"` and give the delete button `className="nx-del"`.

Find the inner `NextActionsSection` map loop:

```typescript
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
            onMouseEnter={(e) => { /* … */ }}
            onMouseLeave={(e) => { /* … */ }}
          >
            {/* … checkbox/span/button … */}
          </div>
        ))}
```

Replace with:

```typescript
        {actions.map((a, i) => (
          <div
            key={i}
            className="nx-row"
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
            <input
              type="checkbox"
              checked={a.done}
              onChange={() => toggle(i)}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <span style={{ flex: 1, textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span>
            <button
              className="nx-del"
              onClick={() => remove(i)}
              title="Remove action"
              style={{
                color: 'var(--ink-faded)',
                padding: 0, marginLeft: 6, fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}
```

### Step 6: Role quick-select "selected" styling

Still in `chrome-extension/reader/components/memory-view.tsx`. In the `EditableField` quick-select buttons, apply a selected-state style when the option matches the current draft's standard-prefix.

Find the quick-select block:

```typescript
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
```

Replace with an inline selected-check:

```typescript
          {options && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {options.map((o) => {
                const isSelected = draft.split(' — ', 1)[0].trim() === o;
                return (
                  <button
                    key={o}
                    onClick={() => applyOption(o)}
                    style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      border: `0.5px solid ${isSelected ? toneColor : 'var(--rule)'}`,
                      background: isSelected
                        ? `color-mix(in oklch, ${toneColor} 12%, transparent)`
                        : 'transparent',
                      color: isSelected ? toneColor : 'var(--ink-faded)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >{o}</button>
                );
              })}
            </div>
          )}
```

### Step 7: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. (No new tests this task — UI polish doesn't warrant them.)

### Step 8: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx \
  chrome-extension/reader/components/margin-column.tsx \
  chrome-extension/reader/components/margin-note.tsx \
  chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/components/memory-view.tsx \
  chrome-extension/reader/styles/tokens.css
git commit -m "fix(ext): Plan 3 review — inline BYOK error at anchor + memory UX polish"
```

---

## Task 3: Helpers — `formatRelative` + `getVisibleParagraphs` (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/paper.ts`
- Modify: `chrome-extension/tests/lib/paper.test.ts`

**Spec reference:** §3.4 Library `formatRelative(lastRead)`; §9.1 CmdK "Translate current page" / "getVisibleParagraphs".

### Step 1: Write failing tests

Append to `chrome-extension/tests/lib/paper.test.ts`:

```typescript
import { formatRelative, getVisibleParagraphs } from '../../reader/lib/paper';

describe('formatRelative', () => {
  // Fixed "now" so tests are deterministic.
  const NOW = 1_700_000_000_000; // 2023-11-14 ish

  it('returns "just now" within 60 s', () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelative(NOW, NOW)).toBe('just now');
  });

  it('returns "{n} min ago" for minutes', () => {
    expect(formatRelative(NOW - 2 * 60_000, NOW)).toBe('2 min ago');
    expect(formatRelative(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
  });

  it('returns "{n} hr ago" for hours', () => {
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 hr ago');
    expect(formatRelative(NOW - 23 * 3_600_000, NOW)).toBe('23 hr ago');
  });

  it('returns "yesterday" for 24..47 h', () => {
    expect(formatRelative(NOW - 25 * 3_600_000, NOW)).toBe('yesterday');
  });

  it('returns "{n} days ago" for 2-7 days', () => {
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago');
    expect(formatRelative(NOW - 6 * 86_400_000, NOW)).toBe('6 days ago');
  });

  it('returns "{n} week(s) ago" for 7-29 days', () => {
    expect(formatRelative(NOW - 7 * 86_400_000, NOW)).toBe('1 week ago');
    expect(formatRelative(NOW - 14 * 86_400_000, NOW)).toBe('2 weeks ago');
  });

  it('returns "{n} month(s) ago" past ~30 days', () => {
    expect(formatRelative(NOW - 40 * 86_400_000, NOW)).toBe('1 month ago');
    expect(formatRelative(NOW - 90 * 86_400_000, NOW)).toBe('3 months ago');
  });

  it('returns an empty string when epochMs is 0', () => {
    expect(formatRelative(0, NOW)).toBe('');
  });
});

describe('getVisibleParagraphs', () => {
  it('returns [data-pid] elements whose rect intersects container rect', () => {
    const container = document.createElement('div');
    // Stub container rect: top=0, bottom=200.
    container.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200, x: 0, y: 0, toJSON() { return {}; },
    });

    function makePara(top: number, height: number, pid: string): HTMLElement {
      const el = document.createElement('p');
      el.setAttribute('data-pid', pid);
      el.getBoundingClientRect = () => ({
        top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() { return {}; },
      });
      container.appendChild(el);
      return el;
    }
    makePara(-50, 100, 'sec0-p0');   // fully above but bottom=50 > container.top=0 → intersects
    makePara(60, 100, 'sec0-p1');    // fully in viewport
    makePara(180, 100, 'sec0-p2');   // top=180 < container.bottom=200 → intersects
    makePara(300, 100, 'sec0-p3');   // fully below viewport → excluded

    const visible = getVisibleParagraphs(container);
    expect(visible.map((el) => el.getAttribute('data-pid'))).toEqual(['sec0-p0', 'sec0-p1', 'sec0-p2']);
  });

  it('returns an empty array when no [data-pid] elements exist', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200, x: 0, y: 0, toJSON() { return {}; },
    });
    expect(getVisibleParagraphs(container)).toEqual([]);
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/paper.test.ts
```

Expected: export errors for `formatRelative`, `getVisibleParagraphs`.

### Step 3: Implement helpers in `paper.ts`

Append to `chrome-extension/reader/lib/paper.ts`:

```typescript
/**
 * Relative-time formatter for Library (§3.4). Returns natural-language deltas
 * like "just now", "3 min ago", "yesterday", "2 weeks ago", "1 month ago".
 * Epoch ms of 0 means "never opened" — returns '' so the caller can skip.
 *
 * The `now` arg is injectable for deterministic testing; production callers
 * can omit it to get `Date.now()`.
 */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
  if (!epochMs) return '';
  const d = Math.max(0, now - epochMs);
  if (d < 60_000) return 'just now';
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(d / 3_600_000);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(d / 86_400_000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * Returns all `[data-pid]` paragraph elements inside `container` whose
 * bounding rect intersects the container's visible region (§9.1 CmdK
 * "Translate current page" scope).
 */
export function getVisibleParagraphs(container: HTMLElement): HTMLElement[] {
  const cRect = container.getBoundingClientRect();
  const all = Array.from(container.querySelectorAll<HTMLElement>('[data-pid]'));
  return all.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > cRect.top && r.top < cRect.bottom;
  });
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/paper.test.ts
```

Expected: 21 tests pass (previous 11 + 10 new = 8 formatRelative + 2 getVisibleParagraphs).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/paper.ts \
  chrome-extension/tests/lib/paper.test.ts
git commit -m "feat(ext): formatRelative + getVisibleParagraphs helpers (§3.4, §9.1)"
```

---

## Task 4: Library storage (`LibraryRow` type + CRUD + `syncLibraryRow`) (TDD)

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Create: `chrome-extension/reader/lib/library.ts`
- Create: `chrome-extension/tests/lib/library.test.ts`
- Modify: `chrome-extension/reader/lib/storage.ts` (add `LIBRARY_KEY`)

**Spec reference:** §3.4 Library schema + auto-save + `hasMemory` computation rule.

### Step 1: Add `LibraryRow` type

Open `chrome-extension/reader/types.ts`. Append:

```typescript
/**
 * Library row (§3.4). A single entry per paper in the global library.
 * Keyed by arXiv id when present, else urlHash.
 *
 * `role` is pre-computed via extractRolePrefix — a standard value or ''.
 * `topic` is '' for v1 (no topic assignment UI yet). `annotations` and
 * `hasMemory` are snapshot values refreshed at every mutation (note,
 * highlight, memory patch).
 */
export interface LibraryRow {
  id?: string;
  urlHash: string;
  title: string;
  authors: string[];
  role: string;          // '' or one of the 6 §3.6 standard values
  topic: string;
  judgment: string;
  addedAt: number;
  lastRead: number;
  pages: number;
  annotations: number;
  hasMemory: boolean;
}
```

### Step 2: Add library key to `storage.ts`

Open `chrome-extension/reader/lib/storage.ts`. Above `CONFIG_KEY`, add:

```typescript
const LIBRARY_KEY = 'library';
```

Export a minimal getter/setter inside the file (library.ts will wrap them with sync logic in Task 4 proper):

```typescript
export async function getLibraryRaw(): Promise<unknown> {
  return get(LIBRARY_KEY);
}

export async function setLibraryRaw(value: unknown): Promise<void> {
  await set(LIBRARY_KEY, value);
}

export const LIB_LOCK_KEY = 'library:lock';
```

`LIB_LOCK_KEY` is used with `withKeyLock` for all library writes so concurrent mutations (e.g. two rapid highlight presses) don't lose the row.

### Step 3: Write failing library tests

Create `chrome-extension/tests/lib/library.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLibrary, upsertLibraryEntry, syncLibraryRow, removeLibraryEntry,
} from '../../reader/lib/library';
import type { Paper, LibraryRow } from '../../reader/types';

type StorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function makeMockStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      await new Promise((r) => setTimeout(r, 0));
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
    set: async (items) => {
      await new Promise((r) => setTimeout(r, 0));
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) data.delete(k);
    },
  };
}

beforeEach(() => {
  const local = makeMockStorage();
  (globalThis as any).chrome = { storage: { local } };
});

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: '2402.18413',
    urlHash: 'h1',
    title: 'Contextual Residuals',
    authors: ['Khan, Y.', 'Voigt, R.'],
    abstract: 'We propose…',
    venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
    outline: [
      { id: 'o0', label: '1 Introduction', level: 0, page: 1 },
      { id: 'o1', label: '2 Method', level: 0, page: 5 },
    ],
    paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('library CRUD', () => {
  it('getLibrary returns [] when unset', async () => {
    expect(await getLibrary()).toEqual([]);
  });

  it('upsertLibraryEntry adds a new row', async () => {
    const row: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: ['A'], role: '', topic: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 10, annotations: 0, hasMemory: false,
    };
    await upsertLibraryEntry(row);
    expect(await getLibrary()).toEqual([row]);
  });

  it('upsertLibraryEntry replaces by paperKey match', async () => {
    const first: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: ['A'], role: '', topic: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 10, annotations: 0, hasMemory: false,
    };
    const second = { ...first, title: 'T2', lastRead: 2 };
    await upsertLibraryEntry(first);
    await upsertLibraryEntry(second);
    const got = await getLibrary();
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe('T2');
  });

  it('removeLibraryEntry drops by paperKey', async () => {
    const row: LibraryRow = {
      id: 'p1', urlHash: 'h1', title: 'T', authors: [], role: '', topic: '',
      judgment: '', addedAt: 1, lastRead: 1, pages: 0, annotations: 0, hasMemory: false,
    };
    await upsertLibraryEntry(row);
    await removeLibraryEntry('p1');
    expect(await getLibrary()).toEqual([]);
  });

  it('syncLibraryRow computes row from paper + storage and upserts', async () => {
    // No prior highlights/notes/memory.
    const p = paper();
    await syncLibraryRow(p, /* pages */ 18);
    const got = await getLibrary();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: '2402.18413',
      urlHash: 'h1',
      title: 'Contextual Residuals',
      authors: ['Khan, Y.', 'Voigt, R.'],
      role: '',
      topic: '',
      judgment: '',
      pages: 18,
      annotations: 0,
      hasMemory: false,
    });
    expect(got[0].addedAt).toBeGreaterThan(0);
    expect(got[0].lastRead).toBe(got[0].addedAt);
  });

  it('syncLibraryRow preserves addedAt and updates lastRead on second sync', async () => {
    const p = paper();
    await syncLibraryRow(p, 18);
    const first = (await getLibrary())[0];
    // Wait a tick so lastRead differs.
    await new Promise((r) => setTimeout(r, 2));
    await syncLibraryRow(p, 18);
    const second = (await getLibrary())[0];
    expect(second.addedAt).toBe(first.addedAt);
    expect(second.lastRead).toBeGreaterThanOrEqual(first.lastRead);
  });

  it('syncLibraryRow computes role from extractRolePrefix(memory.role)', async () => {
    const p = paper({
      memory: {
        whyItMatters: '',
        role: 'Central — candidate alternative to RAG',
        judgment: 'Plausible but unverified.',
        linked: [], nextActions: [],
      },
    });
    await syncLibraryRow(p, 18);
    const row = (await getLibrary())[0];
    expect(row.role).toBe('Central');
    expect(row.judgment).toBe('Plausible but unverified.');
  });

  it('syncLibraryRow hasMemory is true when any non-empty field exists', async () => {
    const p = paper({
      memory: { whyItMatters: 'matters', role: '', judgment: '', linked: [], nextActions: [] },
    });
    await syncLibraryRow(p, 18);
    expect((await getLibrary())[0].hasMemory).toBe(true);
  });

  it('syncLibraryRow hasMemory treats whitespace-only fields as unset', async () => {
    const p = paper({
      memory: { whyItMatters: '   ', role: '', judgment: '', linked: [], nextActions: [] },
    });
    await syncLibraryRow(p, 18);
    expect((await getLibrary())[0].hasMemory).toBe(false);
  });

  it('syncLibraryRow annotations counts highlights + notes', async () => {
    // Pre-seed storage with 2 highlights + 3 notes for paperKey='2402.18413'
    await (globalThis as any).chrome.storage.local.set({
      'paper:2402.18413:highlights': [
        { paragraphId: 'sec0-p0', text: 'a', color: 'yellow' },
        { paragraphId: 'sec0-p1', text: 'b', color: 'yellow' },
      ],
      'paper:2402.18413:notes': [
        { id: 'n1', kind: 'explain', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 1 },
        { id: 'n2', kind: 'summarize', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 2 },
        { id: 'n3', kind: 'translate', source: 's', body: 'b', paragraphId: 'sec0-p0', createdAt: 3 },
      ],
    });
    const p = paper();
    await syncLibraryRow(p, 18);
    expect((await getLibrary())[0].annotations).toBe(5);
  });
});
```

### Step 4: Run to confirm failure

```bash
npm test -- tests/lib/library.test.ts
```

Expected: module-not-found on `../../reader/lib/library`.

### Step 5: Implement `library.ts`

Create `chrome-extension/reader/lib/library.ts`:

```typescript
import type { Paper, LibraryRow } from '../types';
import { paperKey } from './ids';
import { extractRolePrefix } from './paper';
import {
  getLibraryRaw, setLibraryRaw, LIB_LOCK_KEY,
  getHighlights, getNotes, withKeyLock,
} from './storage';

export async function getLibrary(): Promise<LibraryRow[]> {
  const raw = await getLibraryRaw();
  if (!Array.isArray(raw)) return [];
  return raw as LibraryRow[];
}

async function rowKeyOf(row: LibraryRow): Promise<string> {
  return row.id ?? row.urlHash;
}

export async function upsertLibraryEntry(row: LibraryRow): Promise<LibraryRow[]> {
  return withKeyLock(LIB_LOCK_KEY, async () => {
    const existing = await getLibrary();
    const key = await rowKeyOf(row);
    const i = existing.findIndex(async (e) => (await rowKeyOf(e)) === key) as unknown as number;
    // `findIndex` with async predicate returns a synchronous value only if the
    // async callback resolves synchronously — which it does here because
    // rowKeyOf is pure. Still, do a clean sync pass:
    const idx = existing.findIndex((e) => (e.id ?? e.urlHash) === key);
    const next = idx === -1 ? [...existing, row] : existing.map((e, j) => j === idx ? row : e);
    await setLibraryRaw(next);
    return next;
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
 * Read-modify-write the Library row for this paper from current storage.
 * Preserves `addedAt` if a row already exists; stamps `lastRead` to now.
 * Counts annotations from per-paper highlights + notes storage.
 *
 * Called from main.tsx on:
 *   - initial paper load
 *   - after addHighlight / addNote / patchMemory
 */
export async function syncLibraryRow(paper: Paper, pages: number): Promise<void> {
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
    topic: '',
    judgment: paper.memory.judgment,
    addedAt: existingRow?.addedAt ?? now,
    lastRead: now,
    pages,
    annotations: highlights.length + notes.length,
    hasMemory: computeHasMemory(paper.memory),
  };

  await upsertLibraryEntry(row);
}
```

### Step 6: Run tests to confirm pass

```bash
npm test -- tests/lib/library.test.ts
```

Expected: 9 tests pass. Full suite: 89 + 10 (Task 3) + 9 = **108**.

### Step 7: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/reader/lib/library.ts \
  chrome-extension/tests/lib/library.test.ts
git commit -m "feat(ext): library.ts — LibraryRow CRUD + syncLibraryRow (§3.4)"
```

---

## Task 5: Auto-sync library on paper open + on mutations

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.4 "首次打开论文时自动保存到 Library" + keep row fresh as user annotates.

### Step 1: Derive `pages` and call `syncLibraryRow` at every mutation site

Open `chrome-extension/reader/main.tsx`. Add the import:

```typescript
import { syncLibraryRow } from './lib/library';
```

Compute `pages` once in ViewerApp:

```typescript
  // Total pages (§3.4): PDF mode = max outline[].page; HTML mode = 0.
  const pages = Math.max(0, ...paper.outline.map((o) => o.page ?? 0));
```

(The `Math.max(0, …)` guards against empty outlines returning `-Infinity`.)

Add a mount effect that seeds the library entry:

```typescript
  useEffect(() => {
    syncLibraryRow(effectivePaper, pages).catch(() => { /* best effort */ });
    // We want "on paper load", not "on every effectivePaper change", because
    // memory patches already trigger their own syncLibraryRow call (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper]);
```

### Step 2: Call `syncLibraryRow` from `runAction`'s highlight + note-complete branches

Still in `main.tsx`. In `runAction`'s highlight branch, after `setHighlights(next)`:

```typescript
      setHighlights(next);
      // Refresh library annotations count.
      syncLibraryRow(effectivePaper, pages).catch(() => {});
```

After the AI stream's successful `addNote(...)` call:

```typescript
      const completed: MarginResult = { ...pending, body: accum };
      await addNote(paperKey(paper), completed);
      syncLibraryRow(effectivePaper, pages).catch(() => {});
```

### Step 3: Call `syncLibraryRow` from `patchMemory`

Still in `main.tsx`. After `await setMemory(paperKey(effectivePaper), next);`:

```typescript
    setMemoryOverlay(next);
    await setMemory(paperKey(effectivePaper), next);
    // patchMemory uses the *new* memory for library sync, not the stale
    // effectivePaper closure. Build a one-shot shape for syncLibraryRow.
    await syncLibraryRow({ ...paper, memory: next }, pages);
  };
```

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): auto-sync library row on paper open + every mutation"
```

---

## Task 6: Library drawer — real data + search + group-by + filter

**Files:**
- Create: `chrome-extension/reader/components/library-drawer.tsx`
- Modify: `chrome-extension/reader/components/overlays.tsx` (drop the stub `LibraryDrawer`)
- Modify: `chrome-extension/reader/main.tsx` (import from new file + plumb current-paper detection)

**Spec reference:** §3.4 LibraryDrawer UI layout.

### Step 1: Create `library-drawer.tsx` (rows rendered in Task 7)

Create `chrome-extension/reader/components/library-drawer.tsx`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import type { LibraryRow } from '../types';
import { getLibrary } from '../lib/library';
import { I } from './icons';
import { LibraryRowView } from './library-row';

interface Props {
  open: boolean;
  onClose: () => void;
  currentPaperKey: string;
}

type GroupBy = 'topic' | 'role' | 'recent';

export function LibraryDrawer({ open, onClose, currentPaperKey }: Props) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('recent');
  const [memoryOnly, setMemoryOnly] = useState(false);

  // Refresh library on open so newly-opened papers show up.
  useEffect(() => {
    if (!open) return;
    getLibrary().then(setRows).catch(() => setRows([]));
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      (!needle ||
        r.title.toLowerCase().includes(needle) ||
        r.authors.join(', ').toLowerCase().includes(needle)) &&
      (!memoryOnly || r.hasMemory)
    );
  }, [rows, q, memoryOnly]);

  const groups = useMemo(() => {
    const out: Record<string, LibraryRow[]> = {};
    for (const r of filtered) {
      let key: string;
      if (groupBy === 'topic')       key = r.topic || 'Uncategorized';
      else if (groupBy === 'role')   key = r.role || 'Uncategorized';
      else /* recent */              key = 'Recently opened';
      out[key] = out[key] || [];
      out[key].push(r);
    }
    if (groupBy === 'recent') {
      out['Recently opened']?.sort((a, b) => b.lastRead - a.lastRead);
    }
    return out;
  }, [filtered, groupBy]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.35)',
        backdropFilter: 'blur(2px)',
        zIndex: 200, display: 'flex',
        animation: 'fade-in 150ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 80%)', height: '100%',
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'slide-in-right 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '0.5px solid var(--rule)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <I.Library size={16} stroke={1.5} />
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600 }}>
            Library · {rows.length} papers
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="icon-btn"><I.Close size={14} /></button>
        </div>

        {/* Toolbar */}
        <div style={{
          padding: '12px 22px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '0.5px solid var(--rule)',
          flexWrap: 'wrap',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 6, flex: 1, minWidth: 200, maxWidth: 320,
          }}>
            <I.Search size={12} stroke={1.4} style={{ color: 'var(--ink-faded)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, author…"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'none',
                fontSize: 12, color: 'var(--ink)',
              }}
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink-faded)' }}>Group by</div>
          <Seg
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
            options={[
              { id: 'topic', label: 'Topic' },
              { id: 'role', label: 'Role' },
              { id: 'recent', label: 'Recent' },
            ]}
          />

          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: 'var(--ink-soft)', cursor: 'pointer',
            marginLeft: 'auto',
          }}>
            <input
              type="checkbox"
              checked={memoryOnly}
              onChange={(e) => setMemoryOnly(e.target.checked)}
            />
            Has memory
          </label>
        </div>

        {/* Groups */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px 18px' }}>
          {Object.entries(groups).length === 0 && (
            <div style={{
              padding: 40,
              fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic',
              color: 'var(--ink-faded)', textAlign: 'center',
            }}>
              {rows.length === 0
                ? 'Open a paper to start your library.'
                : 'No papers match your filters.'}
            </div>
          )}
          {Object.entries(groups).map(([groupName, groupRows]) => (
            <div key={groupName} style={{ marginTop: 18 }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--ink-faded)',
                padding: '0 4px 6px',
              }}>{groupName} · {groupRows.length}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {groupRows.map((r) => (
                  <LibraryRowView
                    key={r.id ?? r.urlHash}
                    row={r}
                    isCurrent={(r.id ?? r.urlHash) === currentPaperKey}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4, padding: 1.5,
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 8px', fontSize: 11, borderRadius: 3,
            color: value === o.id ? 'var(--ink)' : 'var(--ink-faded)',
            background: value === o.id ? 'var(--paper)' : 'transparent',
            fontWeight: value === o.id ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
```

### Step 2: Remove the stub `LibraryDrawer` from `overlays.tsx`

Open `chrome-extension/reader/components/overlays.tsx`. Delete the existing `LibraryDrawer` component and its `LibraryProps` interface. Drop the export. The CmdK component in this file stays unchanged for now (expanded in Task 14).

### Step 3: Wire new LibraryDrawer into `main.tsx`

Open `chrome-extension/reader/main.tsx`. Change the overlays import:

```typescript
import { CmdK } from './components/overlays';
import { LibraryDrawer } from './components/library-drawer';
```

Update the render:

```tsx
      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentPaperKey={paperKey(paper)}
      />
```

### Step 4: Typecheck + build

Note: `LibraryRowView` doesn't exist yet — this task compiles only if Task 7 lands first. Reverse that: create a temporary stub for `LibraryRowView` to unblock:

Create a **temporary stub** file at `chrome-extension/reader/components/library-row.tsx`:

```typescript
import type { LibraryRow } from '../types';
interface Props { row: LibraryRow; isCurrent: boolean; }
export function LibraryRowView({ row, isCurrent }: Props) {
  return (
    <div style={{
      padding: '8px 12px',
      background: isCurrent ? 'color-mix(in oklch, var(--walnut) 10%, var(--paper-soft))' : 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 6,
      fontFamily: 'var(--font-serif)', fontSize: 13,
    }}>{row.title}</div>
  );
}
```

Task 7 replaces this stub with the real component.

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/library-drawer.tsx \
  chrome-extension/reader/components/library-row.tsx \
  chrome-extension/reader/components/overlays.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): LibraryDrawer — real data + search + group-by + has-memory filter"
```

---

## Task 7: LibraryRow view — spine + metadata + role chip + annotations + NOW badge

**Files:**
- Modify: `chrome-extension/reader/components/library-row.tsx` (replace stub)

**Spec reference:** §3.4 LibraryRow visual details; §3.6 role → spine color map; `--walnut-deep` for current paper.

### Step 1: Rewrite `library-row.tsx`

Replace `chrome-extension/reader/components/library-row.tsx` with:

```typescript
import type { LibraryRow } from '../types';
import { formatRelative } from '../lib/paper';
import { ROLE_COLORS } from './outline-panel';
import { I } from './icons';

interface Props {
  row: LibraryRow;
  isCurrent: boolean;
}

export function LibraryRowView({ row, isCurrent }: Props) {
  // Spine color: current paper uses --walnut-deep (spec §3.6); other rows use
  // role color map; unrecognized / empty role falls back to --ink-ghost.
  const spineColor = isCurrent
    ? 'var(--walnut-deep)'
    : ROLE_COLORS[row.role] ?? 'var(--ink-ghost)';

  const whenLabel = formatRelative(row.lastRead);

  return (
    <div style={{
      display: 'flex',
      padding: '12px 14px 12px 14px',
      background: 'var(--paper-soft)',
      border: `0.5px solid ${isCurrent ? 'var(--walnut-soft)' : 'var(--rule)'}`,
      borderRadius: 6,
      position: 'relative',
      gap: 14,
      alignItems: 'flex-start',
    }}>
      {/* Spine */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
        background: spineColor, borderRadius: '6px 0 0 6px',
      }} />

      {/* Left column: title / authors / judgment */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 13.5, fontWeight: 600,
            color: 'var(--ink)', lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            minWidth: 0, flexShrink: 1,
          }}>{row.title}</div>
          {isCurrent && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em',
              padding: '1px 5px',
              background: 'var(--walnut)', color: 'var(--paper)',
              borderRadius: 2, flexShrink: 0,
            }}>NOW</span>
          )}
        </div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 11, color: 'var(--ink-faded)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {row.authors.join(', ')}
          {row.pages > 0 && ` · ${row.pages}p`}
          {whenLabel && ` · ${whenLabel}`}
        </div>
        {row.judgment.trim() && (
          <div style={{
            marginTop: 6,
            padding: '2px 0 2px 10px',
            borderLeft: '1.5px solid var(--rule)',
            fontFamily: 'var(--font-serif)', fontStyle: 'italic',
            fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{row.judgment}</div>
        )}
      </div>

      {/* Right column: role chip + memory + annotations */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        {row.role && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.02em',
            padding: '2px 7px',
            background: `color-mix(in oklch, ${ROLE_COLORS[row.role] ?? 'var(--ink-ghost)'} 14%, transparent)`,
            color: ROLE_COLORS[row.role] ?? 'var(--ink-faded)',
            borderRadius: 3,
          }}>{row.role}</span>
        )}
        {row.hasMemory && (
          <span title="Has memory" style={{ display: 'inline-flex', color: 'var(--walnut)' }}>
            <I.Memory size={12} stroke={1.4} />
          </span>
        )}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)',
        }}>✎ {row.annotations}</span>
      </div>
    </div>
  );
}
```

The `ROLE_COLORS` is re-exported from `./outline-panel` (Plan 2 Task 10 exposed it). Verify it's still exported; if not, add `export` to its declaration.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/library-row.tsx
git commit -m "feat(ext): LibraryRow — spine + metadata + role chip + NOW badge + annotations"
```

---

## Task 8: Chat storage + `ChatMessage` type (TDD)

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Spec reference:** §3.7.4 Chat message shape; storage at `paper:{key}:chat`.

### Step 1: Add `ChatMessage` + `Citation` types

Open `chrome-extension/reader/types.ts`. Append:

```typescript
export interface Citation {
  n: number;            // 1-based display index (dedup'd by first occurrence)
  kind: 'paragraph' | 'abstract';
  quote: string;        // truncated to 140 chars
  loc: string;          // formatLoc result, e.g. 'p. 13 · §6 Discussion · ¶ p9'
}

export interface ChatMessage {
  id: string;           // 'u-' or 'a-' prefixed
  role: 'user' | 'assistant';
  text: string;         // raw model output (still contains [pN] / [abs] tokens)
  citations?: Citation[]; // populated after stream done; absent while streaming
  createdAt: number;
}
```

### Step 2: Write failing storage tests

Append to `chrome-extension/tests/lib/storage.test.ts`. First extend the top imports:

```typescript
import {
  /* existing imports */,
  getChat, setChat, appendChatMessage,
} from '../../reader/lib/storage';
import type { ChatMessage } from '../../reader/types';
```

Append:

```typescript
describe('chat', () => {
  const msg: ChatMessage = {
    id: 'u-1', role: 'user', text: 'hi', createdAt: 1000,
  };

  it('round-trips chat array', async () => {
    await setChat('c1', [msg]);
    expect(await getChat('c1')).toEqual([msg]);
  });

  it('returns empty array when absent', async () => {
    expect(await getChat('missing')).toEqual([]);
  });

  it('appendChatMessage adds to the end', async () => {
    await appendChatMessage('c1', msg);
    await appendChatMessage('c1', { ...msg, id: 'a-1', role: 'assistant', text: 'hello' });
    const got = await getChat('c1');
    expect(got.map((m) => m.id)).toEqual(['u-1', 'a-1']);
  });

  it('appendChatMessage serializes concurrent calls', async () => {
    const a = appendChatMessage('cc', { ...msg, id: 'u-a' });
    const b = appendChatMessage('cc', { ...msg, id: 'u-b' });
    await Promise.all([a, b]);
    const got = await getChat('cc');
    expect(got).toHaveLength(2);
    expect(got.map((m) => m.id).sort()).toEqual(['u-a', 'u-b']);
  });
});
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: export errors for `getChat` / `setChat` / `appendChatMessage`.

### Step 4: Implement chat storage

Open `chrome-extension/reader/lib/storage.ts`. Extend the types import:

```typescript
import type { Paper, PaperMemory, Highlight, AiConfig, MarginResult, ChatMessage } from '../types';
```

Append:

```typescript
export async function getChat(paperKey: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(k.chat(paperKey))) ?? [];
}

export async function setChat(paperKey: string, value: ChatMessage[]): Promise<void> {
  await set(k.chat(paperKey), value);
}

export async function appendChatMessage(paperKey: string, msg: ChatMessage): Promise<ChatMessage[]> {
  return withKeyLock(k.chat(paperKey), async () => {
    const existing = await getChat(paperKey);
    const next = [...existing, msg];
    await setChat(paperKey, next);
    return next;
  });
}
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: 21 tests pass (previous 17 + 4 new).

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): ChatMessage type + chat storage (get/set/append with lock)"
```

---

## Task 9: `ai.ts` — `buildChatMessages` (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.7.3 Chat base prompt; §3.7.1 paper context + §3.7.2 memory injection already implemented.

### Step 1: Write failing tests

Append to `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { buildChatMessages, CHAT_BASE_PROMPT } from '../../reader/lib/ai';

describe('CHAT_BASE_PROMPT', () => {
  it('instructs the model to cite [pN] inline', () => {
    expect(CHAT_BASE_PROMPT).toMatch(/\[pN\]/);
    expect(CHAT_BASE_PROMPT).toMatch(/cite/i);
  });

  it('tells the model to say so when the paper does not cover the question', () => {
    expect(CHAT_BASE_PROMPT).toMatch(/doesn't cover|paper doesn't/i);
  });
});

describe('buildChatMessages', () => {
  const emptyMem: PaperMemory = {
    whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [],
  };

  it('produces system + prior history + new user message', () => {
    const paper = samplePaper({ memory: emptyMem });
    const history: ChatMessage[] = [
      { id: 'u-1', role: 'user', text: 'q1', createdAt: 1 },
      { id: 'a-1', role: 'assistant', text: 'a1', createdAt: 2 },
    ];
    const msgs = buildChatMessages(paper, history, 'what is the core idea?');

    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(CHAT_BASE_PROMPT);
    expect(msgs[0].content).toContain('# Contextual Residuals');

    expect(msgs.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs.slice(1, -1).map((m) => m.content)).toEqual(['q1', 'a1']);

    expect(msgs[msgs.length - 1].role).toBe('user');
    expect(msgs[msgs.length - 1].content).toBe('what is the core idea?');
  });

  it('injects memory block when memory has content', () => {
    const paper = samplePaper({
      memory: { ...emptyMem, whyItMatters: 'matters' },
    });
    const msgs = buildChatMessages(paper, [], 'q');
    expect(msgs[0].content).toContain('Why it matters: matters');
  });

  it('drops citation metadata from history (only role + text sent to model)', () => {
    const paper = samplePaper({ memory: emptyMem });
    const history: ChatMessage[] = [
      {
        id: 'a-1', role: 'assistant', text: 'earlier reply',
        citations: [{ n: 1, kind: 'paragraph', quote: 'q', loc: 'l' }],
        createdAt: 1,
      },
    ];
    const msgs = buildChatMessages(paper, history, 'q');
    // The history-reconstruction step must not send citations (which are UI-only).
    // @ts-expect-error — we're asserting the shape we send is plain {role,content}
    expect(msgs[1].citations).toBeUndefined();
  });
});
```

The `samplePaper` / `ChatMessage` / `PaperMemory` identifiers are already imported earlier in the file from Tasks 6 and 8 of Phase 3.

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/ai.test.ts
```

Expected: export errors for `buildChatMessages`, `CHAT_BASE_PROMPT`.

### Step 3: Extend `ai.ts`

Open `chrome-extension/reader/lib/ai.ts`. Extend the types import:

```typescript
import type { Paper, PaperMemory, AiActionKind, AiConfig, ChatMessage as StoredChatMessage } from '../types';
```

Note the rename of the stored type to avoid shadowing the internal `ChatMessage` (the tagged union of system/user/assistant for OpenAI-compatible calls). Both live in separate namespaces but the rename makes the intent clearer.

Append after `buildMessages`:

```typescript
export const CHAT_BASE_PROMPT =
  "You are a research assistant grounded in the paper below. Answer strictly from the paragraphs; cite them inline using `[pN]` where N is the paragraph index shown in the context. If the paper doesn't cover the question, say so directly.\n" +
  LANG_SUFFIX;

/**
 * Build the message list for a Chat turn. Shape:
 *   [system { CHAT_BASE_PROMPT + paper + memory? }, ...history (role+text), user { input }]
 * History citations are UI-only and intentionally stripped.
 */
export function buildChatMessages(
  paper: Paper,
  history: StoredChatMessage[],
  userText: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const systemParts = [CHAT_BASE_PROMPT, '', paperCtx];
  if (mem) systemParts.push('', mem);

  const out: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
  ];
  for (const m of history) {
    out.push({ role: m.role, content: m.text });
  }
  out.push({ role: 'user', content: userText });
  return out;
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: previous + 5 new = 26 tests in the file.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts \
  chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts Chat base prompt + buildChatMessages (§3.7.3)"
```

---

## Task 10: `ai.ts` — citation parser (`extractCitations` + `formatLoc`) (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.7.4 Chat citation parsing.

### Step 1: Write failing tests

Append to `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { extractCitations, formatLoc } from '../../reader/lib/ai';

describe('formatLoc', () => {
  it('emits "p. N · §section · ¶ pN" for PDF mode', () => {
    const paper = samplePaper({
      outline: [{ id: 'o0', label: '1 Intro', level: 0, page: 3 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'x' },
      ],
    });
    expect(formatLoc(paper, 1)).toBe('p. 3 · §1 Intro · ¶ p1');
  });

  it('omits page segment for HTML mode', () => {
    const paper = samplePaper({
      outline: [{ id: 'o0', label: '1 Intro', level: 0 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'x' },
      ],
    });
    expect(formatLoc(paper, 1)).toBe('§1 Intro · ¶ p1');
  });
});

describe('extractCitations', () => {
  it('extracts [pN] and [abs] tokens by first-occurrence order', () => {
    const paper = samplePaper(); // has 3 paragraphs (indexes 1..3)
    const text = 'See [p2] and also [abs]. Again [p1] first mention.';
    const cites = extractCitations(text, paper);
    expect(cites.map((c) => ({ n: c.n, kind: c.kind }))).toEqual([
      { n: 1, kind: 'paragraph' }, // [p2] first
      { n: 2, kind: 'abstract' },
      { n: 3, kind: 'paragraph' }, // [p1]
    ]);
  });

  it('dedupes repeated tokens by the first-occurrence n', () => {
    const paper = samplePaper();
    const text = 'First [p2] then [p2] again and [p1].';
    const cites = extractCitations(text, paper);
    expect(cites.map((c) => c.n)).toEqual([1, 2]);
  });

  it('populates quote truncated to 140 chars + loc from formatLoc', () => {
    const paper = samplePaper({
      abstract: 'A'.repeat(200),
      outline: [{ id: 'o0', label: '1 Intro', level: 0, page: 1 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'B'.repeat(200) },
      ],
    });
    const cites = extractCitations('[p1] and [abs]', paper);
    expect(cites[0]).toMatchObject({ kind: 'paragraph', quote: 'B'.repeat(140), loc: 'p. 1 · §1 Intro · ¶ p1' });
    expect(cites[1]).toMatchObject({ kind: 'abstract', loc: 'Abstract', quote: 'A'.repeat(140) });
  });

  it('ignores out-of-range [pN] (dangling citations)', () => {
    const paper = samplePaper(); // 3 paragraphs
    expect(extractCitations('See [p99].', paper)).toEqual([]);
  });

  it('ignores [abs] when paper.abstract is empty', () => {
    const paper = samplePaper({ abstract: '' });
    expect(extractCitations('[abs]', paper)).toEqual([]);
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/ai.test.ts
```

Expected: export errors.

### Step 3: Implement `formatLoc` + `extractCitations`

Append to `chrome-extension/reader/lib/ai.ts`:

```typescript
import type { Citation } from '../types';

/**
 * Build the location string for a paragraph citation (§3.7.4).
 * PDF mode → 'p. {page} · §{section} · ¶ p{N}'.
 * HTML mode (no page) → '§{section} · ¶ p{N}'.
 * N is 1-based (matches buildPaperContext [pN] labels).
 */
export function formatLoc(paper: Paper, n: number): string {
  const p = paper.paragraphs[n - 1];
  if (!p) return `¶ p${n}`;
  const outlineItem = paper.outline.find((o) => o.id === p.sectionId);
  const parts: string[] = [];
  if (outlineItem?.page != null) parts.push(`p. ${outlineItem.page}`);
  parts.push(`§${p.section}`);
  parts.push(`¶ p${n}`);
  return parts.join(' · ');
}

const TRUNC = 140;

/**
 * Scan a completed assistant message for [pN] and [abs] tokens (§3.7.4).
 * Returns Citation[] in first-appearance order, deduped by (kind, n).
 * Out-of-range paragraph indexes and [abs] with no abstract are dropped.
 */
export function extractCitations(text: string, paper: Paper): Citation[] {
  const re = /\[(p\d+|abs)\]/g;
  const seen = new Set<string>();
  const out: Citation[] = [];
  let n = 1;

  for (const match of text.matchAll(re)) {
    const tok = match[1];
    if (seen.has(tok)) continue;

    if (tok === 'abs') {
      if (!paper.abstract) continue;
      seen.add(tok);
      out.push({
        n: n++,
        kind: 'abstract',
        quote: paper.abstract.slice(0, TRUNC),
        loc: 'Abstract',
      });
      continue;
    }

    const paraN = parseInt(tok.slice(1), 10);
    const para = paper.paragraphs[paraN - 1];
    if (!para) continue; // out-of-range

    seen.add(tok);
    out.push({
      n: n++,
      kind: 'paragraph',
      quote: para.text.slice(0, TRUNC),
      loc: formatLoc(paper, paraN),
    });
  }

  return out;
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: 8 new + 26 = 34 tests in ai.test.ts.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts \
  chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts extractCitations + formatLoc (§3.7.4)"
```

---

## Task 11: ChatView — messages + welcome + suggestions

**Files:**
- Create: `chrome-extension/reader/components/chat-view.tsx`

**Spec reference:** §8.2 Chat tab — welcome line + 3 suggestions keyed on first content section.

### Step 1: Create `chat-view.tsx`

Create `chrome-extension/reader/components/chat-view.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Paper, ChatMessage, Citation } from '../types';
import { I } from './icons';

interface Props {
  paper: Paper;
  messages: ChatMessage[];
  streamingId: string | null;
  askPrefill: string | null;
  onSend: (text: string, pinnedSelection: string | null) => void;
  onDismissPrefill: () => void;
}

const SECTION_BLACKLIST = ['abstract', 'references', 'acknowledgements', 'appendix', 'bibliography'];

function firstContentSection(paper: Paper): string | null {
  for (const o of paper.outline) {
    if (o.level !== 0) continue;
    if (!o.label) continue;
    const lower = o.label.toLowerCase();
    if (SECTION_BLACKLIST.some((b) => lower.includes(b))) continue;
    return o.label;
  }
  return null;
}

function suggestionSet(paper: Paper): string[] {
  const sec = firstContentSection(paper);
  if (sec) {
    return [
      `What's the core mechanism of §${sec}?`,
      'How does this compare to prior work?',
      'Where does it fail?',
    ];
  }
  return [
    "What's the core mechanism?",
    'How does this compare to prior work?',
    'Where does it fail?',
  ];
}

export function ChatView({ paper, messages, streamingId, askPrefill, onSend, onDismissPrefill }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => suggestionSet(paper), [paper]);
  const showWelcome = messages.length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingId]);

  const send = (textOverride?: string) => {
    const q = (textOverride ?? input).trim();
    if (!q) return;
    onSend(q, askPrefill);
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {showWelcome && (
          <WelcomeCard suggestions={suggestions} onPick={(s) => send(s)} />
        )}
        {messages.map((m) => (
          <ChatMsg key={m.id} msg={m} streaming={streamingId === m.id} />
        ))}
      </div>

      <Composer
        input={input}
        setInput={setInput}
        disabled={streamingId !== null}
        askPrefill={askPrefill}
        onDismissPrefill={onDismissPrefill}
        onSend={() => send()}
      />
    </div>
  );
}

function WelcomeCard({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div style={{ animation: 'fade-up 180ms' }}>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13.5, lineHeight: 1.65,
        color: 'var(--ink)',
      }}>
        I've read the paper. Ask anything — I'll cite paragraphs inline.
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic',
              color: 'var(--ink-soft)',
            }}
          >→ {s}</button>
        ))}
      </div>
    </div>
  );
}

function ChatMsg({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  if (msg.role === 'user') {
    return (
      <div style={{
        alignSelf: 'flex-end', maxWidth: '85%',
        padding: '8px 12px',
        background: 'var(--paper-deep)',
        border: '0.5px solid var(--rule)',
        borderRadius: '10px 10px 2px 10px',
        fontSize: 13, lineHeight: 1.5,
        fontFamily: 'var(--font-sans)', color: 'var(--ink)',
        animation: 'fade-up 140ms',
        whiteSpace: 'pre-wrap',
      }}>{msg.text}</div>
    );
  }

  return (
    <div style={{ maxWidth: '94%', animation: 'fade-up 180ms' }}>
      <div
        className={streaming ? 'ink-streaming' : ''}
        style={{
          fontFamily: 'var(--font-serif)', fontSize: 13.5, lineHeight: 1.65,
          color: 'var(--ink)',
        }}
      >{renderWithCitations(msg.text, msg.citations)}</div>
      {msg.citations && msg.citations.length > 0 && !streaming && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {msg.citations.map((c) => <CitationCardView key={c.n} c={c} />)}
        </div>
      )}
    </div>
  );
}

function renderWithCitations(text: string, citations: Citation[] | undefined): React.ReactNode {
  if (!citations || citations.length === 0) return text;
  const map = new Map<string, number>();
  for (const c of citations) {
    const tok = c.kind === 'abstract' ? 'abs' : `p${paragraphIndexFromQuote(c)}`;
    map.set(tok, c.n);
  }
  // Replace tokens with superscript n.
  const parts = text.split(/(\[(?:p\d+|abs)\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(p\d+|abs)\]$/);
    if (!m) return part;
    const tok = m[1];
    const n = map.get(tok);
    if (n == null) return part; // dangling — leave as-is
    return (
      <sup key={i} style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--walnut)', cursor: 'pointer',
        padding: '0 2px', fontWeight: 600,
      }}>{n}</sup>
    );
  });
}

// Invertible: given a citation, return the token it came from ('abs' or 'pN').
// We stored the n-index; recover the original by loc-parsing (¶ pN).
function paragraphIndexFromQuote(c: Citation): number {
  if (c.kind === 'abstract') return -1;
  const m = c.loc.match(/¶ p(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

function CitationCardView({ c }: { c: Citation }) {
  return (
    <div style={{
      display: 'flex', gap: 8,
      padding: '6px 10px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 5,
      fontSize: 11,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--walnut)', fontWeight: 600,
        width: 16, textAlign: 'center', flexShrink: 0,
      }}>{c.n}</div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          color: 'var(--ink-faded)', lineHeight: 1.4,
        }}>"{c.quote}"</div>
        <div style={{
          marginTop: 3,
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-ghost)', letterSpacing: '0.04em',
        }}>{c.loc}</div>
      </div>
    </div>
  );
}

interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  disabled: boolean;
  askPrefill: string | null;
  onDismissPrefill: () => void;
  onSend: () => void;
}

function Composer({ input, setInput, disabled, askPrefill, onDismissPrefill, onSend }: ComposerProps) {
  return (
    <div style={{
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      background: 'var(--paper-soft)',
      padding: '8px 10px 6px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {askPrefill && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          padding: '6px 8px',
          background: 'var(--paper-deep)',
          border: '0.5px solid var(--walnut-soft)',
          borderRadius: 6,
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 11, color: 'var(--ink-faded)',
          lineHeight: 1.4,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontStyle: 'normal',
            fontSize: 9, letterSpacing: '0.08em',
            color: 'var(--walnut)', fontWeight: 600, flexShrink: 0, marginTop: 1,
          }}>ABOUT</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            "{askPrefill.length > 120 ? askPrefill.slice(0, 120) + '…' : askPrefill}"
          </span>
          <button
            onClick={onDismissPrefill}
            className="icon-btn"
            style={{ width: 18, height: 18, flexShrink: 0 }}
            title="Drop pinned selection"
          ><I.Close size={9} /></button>
        </div>
      )}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
        }}
        placeholder={askPrefill ? 'Ask something specific, or press Enter…' : 'Ask about this paper…'}
        rows={2}
        disabled={disabled}
        style={{
          width: '100%', border: 'none', outline: 'none',
          background: 'none', resize: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 13,
          color: 'var(--ink)', lineHeight: 1.5,
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <button
          onClick={onSend}
          disabled={disabled || (!input.trim() && !askPrefill)}
          style={{
            padding: '4px 12px', fontSize: 11,
            background: 'var(--ink)', color: 'var(--paper)',
            borderRadius: 4,
            opacity: disabled || (!input.trim() && !askPrefill) ? 0.4 : 1,
            cursor: disabled ? 'default' : 'pointer',
          }}
        >Send</button>
      </div>
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
git add chrome-extension/reader/components/chat-view.tsx
git commit -m "feat(ext): ChatView — messages + welcome suggestions + composer"
```

---

## Task 12: Wire ChatView + chat send flow + persistence

**Files:**
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.2 Chat tab; §3.7.4 citation-filling-at-stream-done.

### Step 1: Extend `WorkspacePanel` props for Chat

Open `chrome-extension/reader/components/workspace-panel.tsx`. Replace the current Props + signature, and replace the `{tab === 'chat' && <Placeholder tab="chat" />}` branch with ChatView.

Add imports:

```typescript
import type { Paper, MarginResult, ChatMessage } from '../types';
import { ChatView } from './chat-view';
```

Update `Props`:

```typescript
interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  results: MarginResult[];
  streamingKey: string | null;
  onCloseLatest: () => void;
  onMemoryPatch: (patch: Partial<Paper['memory']>) => void;
  byokError: { id: string; paragraphId: string } | null;
  onDismissByokError: () => void;

  chatMessages: ChatMessage[];
  chatStreamingId: string | null;
  askPrefill: string | null;
  onChatSend: (userText: string, pinnedSelection: string | null) => void;
  onDismissAskPrefill: () => void;
}
```

Update the signature to destructure the new props, then the render:

```tsx
        {tab === 'chat' && (
          <ChatView
            paper={paper}
            messages={chatMessages}
            streamingId={chatStreamingId}
            askPrefill={askPrefill}
            onSend={onChatSend}
            onDismissPrefill={onDismissAskPrefill}
          />
        )}
```

The `Placeholder` helper is no longer needed — remove it.

### Step 2: Add chat state to `main.tsx` + load history

Open `chrome-extension/reader/main.tsx`. Add imports:

```typescript
import {
  /* existing */, getChat, appendChatMessage,
} from './lib/storage';
import { buildChatMessages, extractCitations } from './lib/ai';
import type { /* existing */, ChatMessage, Citation } from './types';
```

Add state:

```typescript
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStreamingId, setChatStreamingId] = useState<string | null>(null);
  const [askPrefill, setAskPrefill] = useState<string | null>(null);
```

Add a mount effect to seed chat from storage:

```typescript
  useEffect(() => {
    let cancelled = false;
    getChat(paperKey(paper)).then((m) => {
      if (!cancelled) setChatMessages(m);
    });
    return () => { cancelled = true; };
  }, [paper]);
```

### Step 3: Implement `onChatSend`

In `main.tsx`, add a handler (near `runAction`):

```typescript
  const onChatSend = useCallback(async (userText: string, pinnedSelection: string | null) => {
    const config = await getConfig();
    if (!config || !config.apiKey) {
      setByokError({
        id: `err-${Date.now()}`,
        paragraphId: chatMessages[0]?.id ?? paper.paragraphs[0]?.id ?? '',
      });
      return;
    }

    // Ask prefill wraps the user message per §3.7.5.
    const finalUserText = pinnedSelection
      ? `About this passage:\n> ${pinnedSelection}\n\n${userText || 'What does this mean?'}`
      : userText;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text: finalUserText,
      createdAt: Date.now(),
    };
    const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantPending: ChatMessage = {
      id: assistantId, role: 'assistant', text: '', createdAt: Date.now(),
    };

    setChatMessages((prev) => [...prev, userMsg, assistantPending]);
    setChatStreamingId(assistantId);
    setAskPrefill(null);

    // Persist user message immediately (pre-stream).
    await appendChatMessage(paperKey(paper), userMsg);

    // Build the OpenAI-compatible message list from PRIOR history
    // (not including the pending assistant we just added).
    const priorHistory = [...chatMessages, userMsg];
    const messages = buildChatMessages(effectivePaper, chatMessages, finalUserText);

    let accum = '';
    try {
      for await (const chunk of callChatCompletion(config, messages)) {
        accum += chunk;
        setChatMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, text: accum } : m)
        );
      }

      // Citation pass at stream done (§3.7.4 — never during stream).
      const citations: Citation[] = extractCitations(accum, effectivePaper);
      const completed: ChatMessage = {
        ...assistantPending,
        text: accum,
        citations: citations.length > 0 ? citations : undefined,
      };
      setChatMessages((prev) =>
        prev.map((m) => m.id === assistantId ? completed : m)
      );
      await appendChatMessage(paperKey(paper), completed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
      // Drop the empty assistant placeholder.
      setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setChatStreamingId((cur) => cur === assistantId ? null : cur);
    }

    // Silence unused-variable diagnostic for priorHistory — kept for debug/logs.
    void priorHistory;
  }, [paper, effectivePaper, chatMessages]);
```

### Step 4: Plumb new props into WorkspacePanel render

Still in `main.tsx`. Update the `<WorkspacePanel>` render:

```tsx
            <WorkspacePanel
              paper={effectivePaper}
              tab={tab}
              setTab={setTab}
              results={results}
              streamingKey={streamingKey}
              onCloseLatest={() => setResults((rs) => rs.slice(0, -1))}
              onMemoryPatch={patchMemory}
              byokError={byokError}
              onDismissByokError={() => setByokError(null)}
              chatMessages={chatMessages}
              chatStreamingId={chatStreamingId}
              askPrefill={askPrefill}
              onChatSend={onChatSend}
              onDismissAskPrefill={() => setAskPrefill(null)}
            />
```

### Step 5: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): Chat tab wired — send + stream + citation-fill + persistence"
```

---

## Task 13: Ask (?) — `SelectionPinnedChip` + transient Classic switch + focus Chat

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.7.5 Ask behavior.

### Step 1: Wire the Ask kind inside `runAction`

Open `chrome-extension/reader/main.tsx`. The existing `runAction` has an `if (kind === 'ask') { setToast('Ask arrives in Plan 4.'); return; }` branch. Replace with:

```typescript
    if (kind === 'ask') {
      setAskPrefill(sel.text);
      // Transient variant switch — §3.7.5 specifies that Ask's auto-switch
      // must NOT persist the user's variant preference.
      setVariant('classic', { transient: true });
      setTab('chat');
      // Focus the Chat composer shortly after the variant flip so the browser
      // has a chance to mount it. A plain setTimeout is sufficient.
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>('.pf-chat-composer');
        el?.focus();
      }, 100);
      return;
    }
```

### Step 2: Add a stable class to the Chat composer textarea

Open `chrome-extension/reader/components/chat-view.tsx`. Find the `<textarea>` inside `Composer` and add `className="pf-chat-composer"`:

```typescript
      <textarea
        className="pf-chat-composer"
        value={input}
        /* ...rest unchanged... */
      />
```

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx \
  chrome-extension/reader/components/chat-view.tsx
git commit -m "feat(ext): Ask (?) action — pinned chip + transient variant + Chat focus (§3.7.5)"
```

---

## Task 14: CmdK v1 — full command set (Paper + Memory + Jump + View)

**Files:**
- Modify: `chrome-extension/reader/components/overlays.tsx`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §9.1 CmdK v1 command set.

### Step 1: Expand `CmdK` command list

Open `chrome-extension/reader/components/overlays.tsx`. Update `CmdKProps` + items.

Replace the interface:

```typescript
interface CmdKProps {
  open: boolean;
  onClose: () => void;
  variant: ReaderVariant;
  setVariant: (v: ReaderVariant) => void;
  onOpenLibrary: () => void;

  // New for Plan 4 — Paper and Memory actions.
  onSummarizePaper: () => void;
  onTranslatePage: () => void;
  onAskAboutPaper: () => void;
  onSetRole: () => void;
  onWriteJudgment: () => void;
  onLinkPaper: () => void;
}
```

Update the destructure + items `useMemo`:

```typescript
export function CmdK({
  open, onClose, setVariant, onOpenLibrary,
  onSummarizePaper, onTranslatePage, onAskAboutPaper,
  onSetRole, onWriteJudgment, onLinkPaper,
}: CmdKProps) {
  /* ...q, cursor, inputRef useState setup unchanged... */

  const items = useMemo<CmdItem[]>(() => [
    { id: 'paper-summarize', group: 'Paper',  label: 'Summarize whole paper',    action: () => { onSummarizePaper(); onClose(); } },
    { id: 'paper-translate', group: 'Paper',  label: 'Translate current page',   action: () => { onTranslatePage(); onClose(); } },
    { id: 'paper-ask',       group: 'Paper',  label: 'Ask question about paper', action: () => { onAskAboutPaper(); onClose(); } },

    { id: 'mem-role',     group: 'Memory', label: 'Set role in my research…',  action: () => { onSetRole(); onClose(); } },
    { id: 'mem-judgment', group: 'Memory', label: 'Write my judgment',         action: () => { onWriteJudgment(); onClose(); } },
    { id: 'mem-link',     group: 'Memory', label: 'Link to another paper…',    action: () => { onLinkPaper(); onClose(); } },

    { id: 'lib',          group: 'Jump',   label: 'Open Library', kbd: '⌘L',    action: () => { onOpenLibrary(); onClose(); } },

    { id: 'view-focus',   group: 'View',   label: 'Layout: Focus',             action: () => { setVariant('focus'); onClose(); } },
    { id: 'view-classic', group: 'View',   label: 'Layout: Classic',           action: () => { setVariant('classic'); onClose(); } },
    { id: 'view-canvas',  group: 'View',   label: 'Layout: Canvas',            action: () => { setVariant('canvas'); onClose(); } },
  ], [setVariant, onClose, onOpenLibrary, onSummarizePaper, onTranslatePage, onAskAboutPaper, onSetRole, onWriteJudgment, onLinkPaper]);

  /* ...rest of component unchanged... */
}
```

### Step 2: Wire handlers in `main.tsx`

Open `chrome-extension/reader/main.tsx`. Near the `onChatSend` definition, add the CmdK handlers. These are Plan 4 scope:

```typescript
  const onSummarizePaper = useCallback(() => {
    setVariant('classic');
    setTab('summary');
    // SummaryView (Task 17) drives the actual generation triggered by the
    // 3s throttle + 300ms dwell rule. Switching to the tab is enough — the
    // dwell timer fires because we're now on Summary.
  }, []);

  const onTranslatePage = useCallback(async () => {
    const container = readerScrollRef.current;
    if (!container) return;
    const visible = getVisibleParagraphs(container);
    if (visible.length === 0) { setToast('No paragraphs visible on this page.'); return; }
    const config = await getConfig();
    if (!config || !config.apiKey) {
      setByokError({
        id: `err-${Date.now()}`,
        paragraphId: visible[0].getAttribute('data-pid') ?? '',
      });
      return;
    }
    // Translate each visible paragraph by kicking off the same AI runAction
    // shape used for toolbar-initiated translates. `runAction` handles all
    // the streaming/persistence already.
    for (const el of visible) {
      const pid = el.getAttribute('data-pid');
      if (!pid) continue;
      const para = effectivePaper.paragraphs.find((p) => p.id === pid);
      if (!para) continue;
      // Fire-and-forget; each call persists + updates state independently.
      await runAction('translate', {
        text: para.text,
        paragraphId: pid,
        rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0 },
      });
    }
  }, [effectivePaper, runAction]);

  const onAskAboutPaper = useCallback(() => {
    setVariant('classic', { transient: true });
    setTab('chat');
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>('.pf-chat-composer');
      el?.focus();
    }, 100);
  }, []);

  const focusMemoryField = useCallback((field: 'role' | 'judgment' | 'linked') => {
    setVariant('classic');
    setTab('memory');
    // MemoryView EditableField uses autofocus on the textarea when `editing`
    // is true; trigger it by dispatching a click on the corresponding edit
    // button shortly after the tab mount. Non-critical: if the lookup fails
    // (e.g. field already in edit mode), CmdK has done its job by switching
    // tabs.
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(`.pf-mem-edit-${field}`);
      btn?.click();
    }, 100);
  }, []);

  const onSetRole      = useCallback(() => focusMemoryField('role'),     [focusMemoryField]);
  const onWriteJudgment = useCallback(() => focusMemoryField('judgment'), [focusMemoryField]);
  const onLinkPaper     = useCallback(() => focusMemoryField('linked'),   [focusMemoryField]);
```

Import the helper:

```typescript
import { getVisibleParagraphs } from './lib/paper';
```

Update the CmdK render:

```tsx
      <CmdK
        open={cmdKOpen}
        onClose={() => setCmdKOpen(false)}
        variant={variant}
        setVariant={setVariant}
        onOpenLibrary={() => setLibraryOpen(true)}
        onSummarizePaper={onSummarizePaper}
        onTranslatePage={onTranslatePage}
        onAskAboutPaper={onAskAboutPaper}
        onSetRole={onSetRole}
        onWriteJudgment={onWriteJudgment}
        onLinkPaper={onLinkPaper}
      />
```

### Step 3: Add edit-button class hooks in MemoryView

Open `chrome-extension/reader/components/memory-view.tsx`. In the EditableField, the edit button needs a stable class so CmdK can `.click()` it. Also mark `linked` section's placeholder (since linked editing is v1-out, the CmdK command shows a toast fallback).

Find the edit button in `EditableField`:

```typescript
        {!editing && (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            style={{ ... }}
          ><I.Edit size={10} stroke={1.4} /> edit</button>
        )}
```

Replace with:

```typescript
        {!editing && (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className={label.toLowerCase().includes('role') ? 'pf-mem-edit-role'
                     : label.toLowerCase().includes('judgment') ? 'pf-mem-edit-judgment'
                     : ''}
            style={{ ... }}
          ><I.Edit size={10} stroke={1.4} /> edit</button>
        )}
```

For `linked`, there's no EditableField yet (v1 read-only). Update the Linked section's header to include `className="pf-mem-edit-linked"` on an informational button (disabled, but CmdK's `.click()` is a no-op — acceptable):

Find the Linked context section in `MemoryView`:

```typescript
      {m.linked.length > 0 && (
        <section>
          <SectionLabel>Linked context</SectionLabel>
          {/* ... */}
        </section>
      )}
```

Replace with a version that handles both empty and non-empty:

```typescript
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionLabel>Linked context</SectionLabel>
          <button
            className="pf-mem-edit-linked"
            onClick={() => {
              // v1: linked editing is out of scope (§10). CmdK falls through to here.
              // Nothing happens beyond highlighting the Memory tab.
            }}
            style={{ fontSize: 10, color: 'var(--ink-ghost)' }}
            title="Linked editing in v1.1"
          >(read-only)</button>
        </div>
        {m.linked.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
            No linked papers yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* existing linked-card map — unchanged */}
          </div>
        )}
      </section>
```

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/overlays.tsx \
  chrome-extension/reader/components/memory-view.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): CmdK v1 full command set — Paper + Memory + Jump + View (§9.1)"
```

---

## Task 15: Summary storage wrappers — model-isolated cache keys (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`
- Modify: `chrome-extension/reader/types.ts`

**Spec reference:** §3.9 Summary cache `paper:{key}:summary:{section}:{model}`.

### Step 1: Add `SummarySection` type

Open `chrome-extension/reader/types.ts`. Append:

```typescript
export type SummarySection = 'threeLine' | 'keyTerms' | 'detailed';
```

### Step 2: Write failing tests

Append to `chrome-extension/tests/lib/storage.test.ts`:

```typescript
import {
  getSummarySection, setSummarySection, clearSummarySection,
} from '../../reader/lib/storage';

describe('summary cache', () => {
  it('round-trips a summary section keyed by (paperKey, section, model)', async () => {
    await setSummarySection('p1', 'threeLine', 'gpt-4.1-mini', 'the 3-line summary');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4.1-mini')).toBe('the 3-line summary');
  });

  it('isolates by model — different models get different cached strings', async () => {
    await setSummarySection('p1', 'threeLine', 'gpt-4.1-mini', 'mini version');
    await setSummarySection('p1', 'threeLine', 'gpt-4o', '4o version');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4.1-mini')).toBe('mini version');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4o')).toBe('4o version');
  });

  it('isolates by section', async () => {
    await setSummarySection('p1', 'threeLine', 'm', '3-line');
    await setSummarySection('p1', 'keyTerms', 'm', 'terms');
    await setSummarySection('p1', 'detailed', 'm', 'detailed');
    expect(await getSummarySection('p1', 'threeLine', 'm')).toBe('3-line');
    expect(await getSummarySection('p1', 'keyTerms', 'm')).toBe('terms');
    expect(await getSummarySection('p1', 'detailed', 'm')).toBe('detailed');
  });

  it('returns null when section is absent', async () => {
    expect(await getSummarySection('missing', 'threeLine', 'm')).toBeNull();
  });

  it('clearSummarySection drops one model+section tuple without touching others', async () => {
    await setSummarySection('p1', 'threeLine', 'm1', 'a');
    await setSummarySection('p1', 'threeLine', 'm2', 'b');
    await clearSummarySection('p1', 'threeLine', 'm1');
    expect(await getSummarySection('p1', 'threeLine', 'm1')).toBeNull();
    expect(await getSummarySection('p1', 'threeLine', 'm2')).toBe('b');
  });
});
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: export errors.

### Step 4: Implement wrappers

Open `chrome-extension/reader/lib/storage.ts`. Extend the types import:

```typescript
import type { Paper, PaperMemory, Highlight, AiConfig, MarginResult, ChatMessage, SummarySection } from '../types';
```

Append:

```typescript
export async function getSummarySection(
  paperKey: string, section: SummarySection, model: string,
): Promise<string | null> {
  return get<string>(k.summary(paperKey, section, model));
}

export async function setSummarySection(
  paperKey: string, section: SummarySection, model: string, value: string,
): Promise<void> {
  await set(k.summary(paperKey, section, model), value);
}

export async function clearSummarySection(
  paperKey: string, section: SummarySection, model: string,
): Promise<void> {
  const rec = await chrome.storage.local.get(k.summary(paperKey, section, model));
  if (k.summary(paperKey, section, model) in rec) {
    await chrome.storage.local.remove(k.summary(paperKey, section, model));
  }
}
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: 26 tests pass (previous 21 + 5 new).

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): summary cache — model-isolated storage (§3.9)"
```

---

## Task 16: ai.ts Summary prompts + generateSummarySection

**Files:**
- Modify: `chrome-extension/reader/lib/ai.ts`
- Modify: `chrome-extension/tests/lib/ai.test.ts`

**Spec reference:** §3.7.3 Summary prompt templates (threeLine, keyTerms, detailed).

### Step 1: Write failing tests

Append to `chrome-extension/tests/lib/ai.test.ts`:

```typescript
import { SUMMARY_PROMPTS, buildSummaryMessages } from '../../reader/lib/ai';

describe('SUMMARY_PROMPTS', () => {
  it('contains prompts for all three sections', () => {
    expect(SUMMARY_PROMPTS.threeLine).toMatch(/3 sentences/i);
    expect(SUMMARY_PROMPTS.keyTerms).toMatch(/term.*definition|definition.*term/i);
    expect(SUMMARY_PROMPTS.detailed).toMatch(/researcher already familiar|2.3 paragraphs/i);
  });

  it('all three prompts append the reader-language suffix', () => {
    expect(SUMMARY_PROMPTS.threeLine).toMatch(/Respond in the reader's language/);
    expect(SUMMARY_PROMPTS.keyTerms).toMatch(/Respond in the reader's language/);
    expect(SUMMARY_PROMPTS.detailed).toMatch(/Respond in the reader's language/);
  });
});

describe('buildSummaryMessages', () => {
  it('produces system+user messages with the chosen section prompt + paper context', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildSummaryMessages('threeLine', paper);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(SUMMARY_PROMPTS.threeLine);
    expect(msgs[0].content).toContain('# Contextual Residuals');
    expect(msgs[1].role).toBe('user');
    // User message is just the trigger; actual content is the paper context in the system prompt.
    expect(msgs[1].content).toBeTruthy();
  });

  it('injects memory when non-empty', () => {
    const paper = samplePaper({ memory: { ...emptyMem, judgment: 'risky' } });
    const msgs = buildSummaryMessages('detailed', paper);
    expect(msgs[0].content).toContain('Personal judgment: risky');
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/ai.test.ts
```

Expected: export errors.

### Step 3: Extend `ai.ts`

Append to `chrome-extension/reader/lib/ai.ts`:

```typescript
import type { SummarySection } from '../types';

export const SUMMARY_PROMPTS: Record<SummarySection, string> = {
  threeLine:
    "You are reading a research paper. Based on the paragraphs, write exactly 3 sentences. Each sentence stands alone. Cover: (a) main idea, (b) core mechanism, (c) key limitation. No bullet points, one sentence per line.\n" +
    LANG_SUFFIX,
  keyTerms:
    "Extract 3–5 key terms from the paper. For each, write a one-sentence definition in the paper's own framing. Format: `{term} :: {definition}`, one per line.\n" +
    LANG_SUFFIX,
  detailed:
    "Write a 2–3 paragraph summary of the paper for a researcher already familiar with the field. Preserve the paper's own decomposition and honest limitations. Plain prose, no bullets.\n" +
    LANG_SUFFIX,
};

export function buildSummaryMessages(section: SummarySection, paper: Paper): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const systemParts = [SUMMARY_PROMPTS[section], '', paperCtx];
  if (mem) systemParts.push('', mem);
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: 'Produce the summary as instructed.' },
  ];
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/ai.test.ts
```

Expected: 5 new + 34 = 39 tests in ai.test.ts.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/ai.ts \
  chrome-extension/tests/lib/ai.test.ts
git commit -m "feat(ext): ai.ts Summary prompts + buildSummaryMessages (§3.7.3)"
```

---

## Task 17: SummaryView — UI skeleton (three sections + loading + error states)

**Files:**
- Create: `chrome-extension/reader/components/summary-view.tsx`
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`

**Spec reference:** §8.2 Summary tab structure.

### Step 1: Create `summary-view.tsx`

Create `chrome-extension/reader/components/summary-view.tsx`:

```typescript
import type { MarginResult, Paper, SummarySection } from '../types';
import { I } from './icons';
import { SelectionResultCard } from './selection-result-card';

export type SectionState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'streaming'; body: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };

export interface SummaryState {
  threeLine: SectionState;
  keyTerms: SectionState;
  detailed: SectionState;
}

interface Props {
  paper: Paper;
  state: SummaryState;
  onRefresh: (section: SummarySection) => void;

  // Latest SelectionResultCard (passed through from workspace-panel)
  latestResult: MarginResult | undefined;
  streamingKeyOfLatest: string | null;
  onCopyLatest: (body: string) => void;
  onCloseLatest: () => void;

  // ContextIndicator
  model: string;
  chunks: number;
}

const SECTION_TITLES: Record<SummarySection, string> = {
  threeLine: 'Three-line summary',
  keyTerms: 'Key terms',
  detailed: 'Detailed summary',
};

const REFRESHABLE: SummarySection[] = ['threeLine', 'detailed'];

export function SummaryView(props: Props) {
  const { paper, state, onRefresh, latestResult, streamingKeyOfLatest, onCopyLatest, onCloseLatest, model, chunks } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {latestResult && (
        <SelectionResultCard
          paper={paper}
          result={latestResult}
          streaming={streamingKeyOfLatest === latestResult.id}
          onCopy={onCopyLatest}
          onClose={onCloseLatest}
        />
      )}

      {(['threeLine', 'keyTerms', 'detailed'] as SummarySection[]).map((s) => (
        <SummarySectionView
          key={s}
          title={SECTION_TITLES[s]}
          state={state[s]}
          refreshable={REFRESHABLE.includes(s)}
          onRefresh={() => onRefresh(s)}
        />
      ))}

      <div style={{
        padding: '10px 12px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: 'var(--ink-faded)',
      }}>
        <I.Layers size={12} stroke={1.4} />
        <span>
          Generated from <strong style={{ color: 'var(--ink-soft)' }}>full paper</strong> · {chunks} chunks · via{' '}
          <span style={{ fontFamily: 'var(--font-mono)' }}>{model}</span>
        </span>
      </div>
    </div>
  );
}

function SummarySectionView({
  title, state, refreshable, onRefresh,
}: { title: string; state: SectionState; refreshable: boolean; onRefresh: () => void }) {
  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)',
        }}>{title}</div>
        {refreshable && state.kind !== 'loading' && state.kind !== 'streaming' && (
          <button
            className="icon-btn"
            title="Regenerate"
            onClick={onRefresh}
            style={{ width: 22, height: 22 }}
          ><I.Refresh size={11} stroke={1.4} /></button>
        )}
      </div>

      {state.kind === 'idle' && (
        <div style={{ fontSize: 12, color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
          Waiting to start…
        </div>
      )}
      {state.kind === 'loading' && <ShimmerLines />}
      {(state.kind === 'streaming' || state.kind === 'ready') && (
        <div
          className={state.kind === 'streaming' ? 'ink-streaming' : ''}
          style={{
            fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
            color: 'var(--ink-soft)', whiteSpace: 'pre-wrap',
          }}
        >{state.body}</div>
      )}
      {state.kind === 'error' && (
        <div style={{
          padding: '8px 10px',
          background: 'color-mix(in oklch, var(--foxglove) 8%, var(--paper-soft))',
          border: '0.5px solid var(--foxglove)',
          borderRadius: 6,
          fontSize: 12, color: 'var(--foxglove)', lineHeight: 1.5,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ flex: 1 }}>{state.message}</span>
          <button
            onClick={onRefresh}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 3,
              background: 'var(--foxglove)', color: 'var(--paper)',
            }}
          >Retry</button>
        </div>
      )}
    </section>
  );
}

function ShimmerLines() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="shimmer-line" style={{ width: '95%' }} />
      <div className="shimmer-line" style={{ width: '88%' }} />
      <div className="shimmer-line" style={{ width: '72%' }} />
    </div>
  );
}
```

### Step 2: Update `workspace-panel.tsx` Summary tab

Open `chrome-extension/reader/components/workspace-panel.tsx`. Replace the `SummaryBody` implementation with a thin shell that uses `SummaryView`. First extend Props:

```typescript
interface Props {
  /* ...existing props... */

  summaryState: SummaryState;
  onSummaryRefresh: (section: SummarySection) => void;
  model: string;
  chunks: number;
}
```

Import types + view:

```typescript
import type { SummaryState } from './summary-view';
import type { SummarySection } from '../types';
import { SummaryView } from './summary-view';
```

Replace the entire `SummaryBody` function with:

```typescript
function SummaryBody({
  paper, results, streamingKey, onCloseLatest,
  byokError, onDismissByokError,
  summaryState, onSummaryRefresh, model, chunks,
}: {
  paper: Paper;
  results: MarginResult[];
  streamingKey: string | null;
  onCloseLatest: () => void;
  byokError: { id: string; paragraphId: string } | null;
  onDismissByokError: () => void;
  summaryState: SummaryState;
  onSummaryRefresh: (section: SummarySection) => void;
  model: string;
  chunks: number;
}) {
  const latest = results[results.length - 1];
  return (
    <>
      {byokError && (
        <button
          role="alert"
          onClick={() => { chrome.runtime.openOptionsPage(); onDismissByokError(); }}
          style={{
            padding: '10px 14px',
            background: 'color-mix(in oklch, var(--foxglove) 12%, var(--paper-soft))',
            border: '0.5px solid var(--foxglove)',
            borderRadius: 8,
            fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic',
            color: 'var(--foxglove)', lineHeight: 1.55,
            textAlign: 'left', cursor: 'pointer',
            width: '100%',
            marginBottom: 20,
          }}
        >API key not configured. Click to open Options →</button>
      )}
      <SummaryView
        paper={paper}
        state={summaryState}
        onRefresh={onSummaryRefresh}
        latestResult={latest}
        streamingKeyOfLatest={latest ? (streamingKey === latest.id ? latest.id : null) : null}
        onCopyLatest={(body) => {
          navigator.clipboard.writeText(body).then(
            () => setToast('Copied.'),
            () => setToast('Copy failed.')
          );
        }}
        onCloseLatest={onCloseLatest}
        model={model}
        chunks={chunks}
      />
    </>
  );
}
```

In the render, pass the new props to SummaryBody:

```tsx
        {tab === 'summary' && (
          <SummaryBody
            paper={paper}
            results={results}
            streamingKey={streamingKey}
            onCloseLatest={onCloseLatest}
            byokError={byokError}
            onDismissByokError={onDismissByokError}
            summaryState={summaryState}
            onSummaryRefresh={onSummaryRefresh}
            model={model}
            chunks={chunks}
          />
        )}
```

### Step 3: Temp-stub the summary state in `main.tsx`

Open `chrome-extension/reader/main.tsx`. Add a temporary idle summary state that Task 18 replaces:

```typescript
import type { SummaryState } from './components/summary-view';
import type { SummarySection } from './types';

  // Placeholder — Task 18 implements real fetch/cache/throttle.
  const [summaryState, setSummaryState] = useState<SummaryState>({
    threeLine: { kind: 'idle' },
    keyTerms: { kind: 'idle' },
    detailed: { kind: 'idle' },
  });
  const onSummaryRefresh = useCallback((_section: SummarySection) => {
    // Implemented in Task 18.
  }, []);

  // Chunk estimate per §3.2: paragraphs merged to ~500 tokens. Rough approximation.
  const chunks = useMemo(() => {
    const chars = paper.paragraphs.reduce((n, p) => n + p.text.length, 0);
    const tokens = Math.ceil(chars / 4);
    return Math.max(1, Math.ceil(tokens / 500));
  }, [paper]);

  const model = ''; // filled by Task 18 effect

  void summaryState; void onSummaryRefresh; void chunks; void model;
```

Pass to WorkspacePanel:

```tsx
            <WorkspacePanel
              /* ...existing props... */
              summaryState={summaryState}
              onSummaryRefresh={onSummaryRefresh}
              model={model}
              chunks={chunks}
            />
```

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/summary-view.tsx \
  chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): SummaryView UI skeleton — three sections + loading/error/ContextIndicator"
```

---

## Task 18: Summary fetch + cache + 3 s throttle + 300 ms dwell trigger

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.2 Summary trigger rule; §3.9 model-isolated cache.

### Step 1: Wire real summary generation

Open `chrome-extension/reader/main.tsx`. Replace the temp stub with a full implementation that:
1. Reads each section's cache on mount; if present, show `kind: 'ready'`.
2. If any section is missing, start a 3 s timer + 300 ms dwell timer; whichever resolves first triggers missing sections.
3. Cancel timers on paper change or component unmount.

Replace the stub block with:

```typescript
  const [summaryState, setSummaryState] = useState<SummaryState>({
    threeLine: { kind: 'idle' },
    keyTerms: { kind: 'idle' },
    detailed: { kind: 'idle' },
  });
  // Exposed as state so the ContextIndicator re-renders when Options page saves.
  const [model, setModel] = useState<string>('');

  const chunks = useMemo(() => {
    const chars = paper.paragraphs.reduce((n, p) => n + p.text.length, 0);
    const tokens = Math.ceil(chars / 4);
    return Math.max(1, Math.ceil(tokens / 500));
  }, [paper]);

  // Load current model on mount + whenever config changes via storage.onChanged.
  useEffect(() => {
    let cancelled = false;
    getConfig().then((c) => { if (!cancelled) setModel(c?.model ?? ''); });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !('config' in changes)) return;
      setModel((changes.config.newValue as AiConfig | undefined)?.model ?? '');
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { cancelled = true; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  // Hydrate each section from cache when paper or model changes.
  useEffect(() => {
    if (!model) return;
    const pk = paperKey(effectivePaper);
    (async () => {
      const next: SummaryState = { threeLine: { kind: 'idle' }, keyTerms: { kind: 'idle' }, detailed: { kind: 'idle' } };
      for (const s of ['threeLine', 'keyTerms', 'detailed'] as SummarySection[]) {
        const cached = await getSummarySection(pk, s, model);
        if (cached) next[s] = { kind: 'ready', body: cached };
      }
      setSummaryState(next);
    })();
  }, [paper, model, effectivePaper]);

  // Fetch + stream one section.
  const fetchSection = useCallback(async (section: SummarySection) => {
    const config = await getConfig();
    if (!config || !config.apiKey) {
      setByokError({
        id: `err-${Date.now()}`,
        paragraphId: paper.paragraphs[0]?.id ?? '',
      });
      return;
    }
    const pk = paperKey(effectivePaper);
    setSummaryState((s) => ({ ...s, [section]: { kind: 'loading' } }));

    const msgs = buildSummaryMessages(section, effectivePaper);
    let accum = '';
    try {
      for await (const chunk of callChatCompletion(config, msgs)) {
        accum += chunk;
        setSummaryState((s) => ({ ...s, [section]: { kind: 'streaming', body: accum } }));
      }
      setSummaryState((s) => ({ ...s, [section]: { kind: 'ready', body: accum } }));
      await setSummarySection(pk, section, config.model, accum);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSummaryState((s) => ({ ...s, [section]: { kind: 'error', message: msg.slice(0, 140) } }));
    }
  }, [effectivePaper, paper]);

  // Trigger missing sections once per paper/model — 3 s throttle + 300 ms dwell.
  useEffect(() => {
    if (!model) return;

    const missing: SummarySection[] = [];
    (['threeLine', 'keyTerms', 'detailed'] as SummarySection[]).forEach((s) => {
      if (summaryState[s].kind === 'idle') missing.push(s);
    });
    if (missing.length === 0) return;

    let cancelled = false;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (cancelled) return;
      for (const s of missing) fetchSection(s);
    };

    // Fallback: 3 s after paper load.
    fallbackTimer = setTimeout(trigger, 3000);

    // Dwell: 300 ms of sustained Summary-tab focus (in Classic variant).
    if (variant === 'classic' && tab === 'summary') {
      dwellTimer = setTimeout(trigger, 300);
    }

    return () => {
      cancelled = true;
      if (dwellTimer) clearTimeout(dwellTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [paper, model, tab, variant, summaryState, fetchSection]);

  // Refresh button handler — clear cache + retrigger.
  const onSummaryRefresh = useCallback(async (section: SummarySection) => {
    const config = await getConfig();
    if (!config || !config.apiKey) return;
    const pk = paperKey(effectivePaper);
    await clearSummarySection(pk, section, config.model);
    setSummaryState((s) => ({ ...s, [section]: { kind: 'idle' } }));
    fetchSection(section);
  }, [effectivePaper, fetchSection]);
```

Add the storage + ai imports:

```typescript
import { getSummarySection, setSummarySection, clearSummarySection } from './lib/storage';
import { buildSummaryMessages } from './lib/ai';
```

Add `SummarySection` to the type import:

```typescript
import type { /* existing */, SummarySection, AiConfig } from './types';
```

Remove the temporary `void summaryState; void onSummaryRefresh; void chunks; void model;` line — they're all consumed now.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. Cold-start with no BYOK: all three sections sit at `idle` and then transition to error-via-byok after trigger. With BYOK, sections transition idle → loading → streaming → ready and persist to cache.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): Summary fetch + cache + 3s throttle + 300ms dwell (§8.2, §3.9)"
```

---

## Task 19: Summary polish — memory-change invalidation

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.7.2 memory injection + §8.2 "summary cache per model" — v1 clarification: when the user patches memory, cached summaries are now stale. Clear them so the next open regenerates with fresh memory injection.

### Step 1: Clear summary cache on memory patch

Open `chrome-extension/reader/main.tsx`. Modify `patchMemory` to invalidate summary cache for the current model:

```typescript
  const patchMemory = async (patch: Partial<Paper['memory']>) => {
    const base = memoryOverlay ?? paper.memory;
    const next = { ...base, ...patch };
    setMemoryOverlay(next);
    await setMemory(paperKey(effectivePaper), next);
    await syncLibraryRow({ ...paper, memory: next }, pages);

    // §3.9 / §3.7.2 — memory edits change the prompt; clear cached Summary
    // sections for this model so the next trigger regenerates with the new
    // memory. Other models' caches are left intact.
    const config = await getConfig();
    if (config?.model) {
      const pk = paperKey(effectivePaper);
      await Promise.all([
        clearSummarySection(pk, 'threeLine', config.model),
        clearSummarySection(pk, 'keyTerms', config.model),
        clearSummarySection(pk, 'detailed', config.model),
      ]);
      setSummaryState({ threeLine: { kind: 'idle' }, keyTerms: { kind: 'idle' }, detailed: { kind: 'idle' } });
    }
  };
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
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): invalidate summary cache on memory patch"
```

---

## Task 20: Final — tests + typecheck + build + manual smoke

**Files:** (no source changes unless fixes required)

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected test counts after Plan 4:
- `ids.test.ts`: 11
- `parse.test.ts`: 3
- `pdf.test.ts`: 9
- `arxiv.test.ts`: 16
- `paper.test.ts`: 21 (Phase 3 had 11; Plan 4 added formatRelative: 8 + getVisibleParagraphs: 2 = 10)
- `storage.test.ts`: 26 (Phase 3 had 17; +4 chat +5 summary)
- `ai.test.ts`: 39 (Phase 3 had 21; Plan 4 added CRLF 1 + CHAT_BASE_PROMPT 2 + buildChatMessages 3 + formatLoc 2 + extractCitations 5 + SUMMARY_PROMPTS 2 + buildSummaryMessages 2 = 17; wait — recount: CRLF +1 added in Task 1; Task 9 added 5 (2 CHAT_BASE_PROMPT + 3 buildChatMessages); Task 10 added 7 (2 formatLoc + 5 extractCitations); Task 16 added 4 (2 SUMMARY_PROMPTS + 2 buildSummaryMessages). 21 + 1 + 5 + 7 + 4 = 38. Abort test was rewritten, not added. Net **38**.)
- `library.test.ts`: 9

Total expected: 11 + 3 + 9 + 16 + 21 + 26 + 38 + 9 = **133** tests.

### Step 2: Typecheck

```bash
npm run typecheck
```

Expected: exit 0.

### Step 3: Build

```bash
npm run build
```

Expected: exit 0. `dist/` layout unchanged from Phase 3 (manifest, rules, sw, content iife, reader, options, assets, and storage-chunk reuse between reader + options).

### Step 4: Manual Chrome smoke test

1. `chrome://extensions` → remove prior PaperFlow → Load unpacked → `chrome-extension/dist/`.
2. Options → paste BYOK (openai-compatible endpoint, key, model) → Save → StatusRail dot forest green.
3. Navigate to `https://arxiv.org/html/2402.18413`.
4. **Summary tab:** switch to Classic → Summary. Three shimmer-loading blocks appear; 3 s or immediately (because we're already on Summary tab): each section streams in. Click `↻` on threeLine → regenerates + re-caches. Switch to Focus, then back to Classic — sections render instantly from cache.
5. **Chat tab:** switch to Chat. Welcome + 3 suggestions. Click a suggestion → user bubble, assistant streams, `[pN]` tokens in-flight visible, `[1][2][3]` superscripts + CitationCards appear on stream-done. Reload paper — chat history restored.
6. **Ask (?):** select text in paper area, press `?`. Variant flips to Classic, Chat tab opens, `SelectionPinnedChip` shows the text. Type a question → send. Message shows "About this passage: > …" wrapper.
7. **Library:** press `⌘L` → drawer opens. Current paper has `NOW` badge + walnut-deep spine. Group by Role/Topic/Recent works. "Has memory" filter hides papers without memory. Memory tab edits flow into the library row (role chip + judgment text update after Save).
8. **CmdK:** press `⌘K` → 10 commands across Paper / Memory / Jump / View groups. Arrow keys + Enter navigate. Paper · Translate current page kicks off translate on visible paragraphs (each streams into a margin note / result card). Paper · Ask focuses chat. Memory · Set role jumps to Memory tab with role in edit mode.
9. **No BYOK:** delete apiKey in Options → Save → StatusRail dot foxglove. Press E in reader → inline error appears at source-paragraph slot in Focus or atop Summary list in Classic — click it → Options page opens.
10. **Model switch:** change model to a different one → Options Save → StatusRail reflects new model → switching to Summary regenerates (different cache key per §3.9).

### Step 5: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 4 automated verification complete (2026-04-21):
- `npm test` → 133 passed across 8 files
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke test (Summary cache + Chat citations + Ask pinned chip + Library NOW badge + CmdK full set + inline BYOK at anchor + model switch) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-21-plan-phase-4-summary-chat-library-ask.md
git commit -m "docs(plan): Phase 4 verification log"
```

---

## Phase 4 Done Criteria

- ✅ Summary tab streams and caches 3 sections per (paperKey, section, model); refresh clears + regenerates; 3 s fallback + 300 ms dwell trigger; ContextIndicator shows current chunks + model
- ✅ Chat tab streams with `[pN]` / `[abs]` citation parsing at stream-done; `<sup>N</sup>` + CitationCard list; welcome + 3 content-section suggestions; history persists per paper
- ✅ Ask (?) wraps selection text in `"About this passage: > …"`, shows `SelectionPinnedChip` above composer, transient-switches variant to Classic, focuses Chat composer
- ✅ Library drawer reads from `chrome.storage.local['library']`; rows show spine (role color) + NOW badge for current paper + role chip + judgment + annotations count + formatRelative(lastRead); search + group-by Topic/Role/Recent + has-memory filter
- ✅ Library row syncs via `syncLibraryRow` on paper open + every mutation (addHighlight / addNote / patchMemory)
- ✅ CmdK v1 lists Paper (Summarize / Translate page / Ask), Memory (Set role / Write judgment / Link), Jump (Open Library), View (3 variants) — handlers wired
- ✅ §3.8 inline BYOK error renders at anchor position (Focus: at paragraph via MarginColumn; Classic: top of Summary body), replaces Plan 3's floating banner
- ✅ Plan 3 review carryovers all resolved: runAction useCallback, abort test with never-resolving body, SSE CRLF tolerance, role quick-select selected styling, nextActions delete-btn CSS hover
- ✅ All unit tests pass (~133); typecheck clean; build green

---

## Verification log

Phase 4 automated verification complete (2026-04-22):
- `npm test` → **134 passed** across 8 files (ids 11, parse 3, pdf 9, arxiv 16, paper 21, storage 26, ai 38, library 10)
- `npm run typecheck` → exit 0
- `npm run build` → green; all four outputs (reader, options, sw, content-IIFE) produced
- Manual Chrome smoke test (Summary cache + Chat citations + Ask pinned chip + Library NOW badge + CmdK full set + inline BYOK at anchor + model switch) is user-driven.

## Next: Plan 5

Plan 5 brings Canvas mode (react-flow + dagre + node types per §8.3), resolves the last Plan 1 review residuals (I3 API title scoping, I4 HTML-OK/API-fail partial load, I5 SW return-false hygiene), adds storage quota toast (§10), dark-mode verification, and final polish (delete buttons for margin notes / highlights / linked cards if scope allows).
