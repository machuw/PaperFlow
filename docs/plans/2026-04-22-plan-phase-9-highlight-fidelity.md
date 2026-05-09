# Phase 9 — Highlight Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paint stored highlights over ar5iv rich-block content (figures/equations/tables) AND over pdfjs text-layer spans, so Hl-marked text is visually identifiable everywhere — not just in plain paragraphs (which already work via `renderHighlighted` span-wrap).

**Architecture:** Chrome's CSS Custom Highlight API (`CSS.highlights` + `::highlight(name)` selector) paints via Ranges without DOM mutation — perfect for content we can't wrap in React (`dangerouslySetInnerHTML` content + pdfjs-generated spans). A single pure helper `findTextRanges(root, text)` (jsdom-testable) drives both paths. The plain-HTML `<p>` path keeps its existing `renderHighlighted` span-wrap (stable, tested, no reason to churn).

**Tech Stack:** CSS Custom Highlight API (Chrome 105+, shipped everywhere we target), TypeScript, vitest + jsdom. No new runtime deps.

**Scope:** Two TODO items, one shared pure helper.
1. **TODO #10** — Rich-block HTML highlights: after `<div dangerouslySetInnerHTML>` mounts, register Ranges matching stored highlights' text so `::highlight(hl-yellow)` paints them.
2. **TODO #13** — PDF canvas highlights: after pdfjs `TextLayer.render()` resolves, register Ranges over the text-layer spans matching stored highlights.

**Out of scope (tracked but not touched):**
- Plain HTML paragraph highlights — already render via `renderHighlighted` span-wrap; migration to Custom Highlight API is a separate refactor.
- Highlight deletion UI — still only via storage direct manipulation (future plan).
- Multi-color highlights — schema already supports `color` field but UI is v1 yellow-only.

---

## Pre-read

1. `TODO.md` items #10 and #13 — expected behavior + reasons for deferral.
2. `chrome-extension/reader/components/paper-page.tsx` lines 147-210 — existing highlight handling + `renderHighlighted` helper.
3. `chrome-extension/reader/components/pdf-page.tsx` — PdfPage's render effect (where TextLayer.render resolves); data-pid tagging loop.
4. `chrome-extension/reader/styles/tokens.css:216` — existing `.hl-yellow` class (stays as-is for the plain path).
5. MDN: `CSS.highlights` + `Highlight` (constructor) + `::highlight(name)` pseudo-element.
6. `chrome-extension/reader/types.ts` — `Highlight = { paragraphId; text; color }`.

## File structure

**Create:**
- `chrome-extension/reader/lib/highlight-ranges.ts` — `findTextRanges(root, text): Range[]` pure helper + `registerPaperHighlights(root, highlights, paragraphs): void` orchestrator.
- `chrome-extension/tests/lib/highlight-ranges.test.ts` — TDD for `findTextRanges` (jsdom Range support is sufficient).

**Modify:**
- `chrome-extension/reader/styles/tokens.css` — add `::highlight(hl-yellow)` rule + dark-mode variant.
- `chrome-extension/reader/components/paper-page.tsx` — rich-block branch adds post-mount effect that calls `registerPaperHighlights`.
- `chrome-extension/reader/components/pdf-page.tsx` — after TextLayer.render(), call `registerPaperHighlights` scoped to `textLayerRef.current`.

---

## Task 1: `findTextRanges` pure helper (TDD)

**Files:**
- Create: `chrome-extension/reader/lib/highlight-ranges.ts`
- Create: `chrome-extension/tests/lib/highlight-ranges.test.ts`

**Rationale:** Walks text nodes under a root, finds matches of a target string, returns `Range[]` each spanning the match. Unit-testable because jsdom implements `document.createTreeWalker`, `Range`, and `node.splitText` / index math.

### Step 1: Write failing test

Create `chrome-extension/tests/lib/highlight-ranges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findTextRanges } from '../../reader/lib/highlight-ranges';

function makeRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe('findTextRanges', () => {
  it('returns a single Range for a simple text-node match', () => {
    const root = makeRoot('<p>Hello world.</p>');
    const ranges = findTextRanges(root, 'world');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('world');
  });

  it('returns empty array when text is absent', () => {
    const root = makeRoot('<p>Hello world.</p>');
    expect(findTextRanges(root, 'missing')).toEqual([]);
  });

  it('returns empty array for empty search text', () => {
    const root = makeRoot('<p>Hello.</p>');
    expect(findTextRanges(root, '')).toEqual([]);
  });

  it('matches text that spans across inline elements', () => {
    // "low-rank residual" straddles <em>…</em> boundary
    const root = makeRoot('<p>A <em>low-rank</em> residual approach.</p>');
    const ranges = findTextRanges(root, 'low-rank residual');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('low-rank residual');
  });

  it('returns multiple ranges when text repeats', () => {
    const root = makeRoot('<p>foo bar foo baz foo</p>');
    const ranges = findTextRanges(root, 'foo');
    expect(ranges).toHaveLength(3);
    for (const r of ranges) expect(r.toString()).toBe('foo');
  });

  it('skips matches inside <script> and <style>', () => {
    const root = makeRoot(
      '<p>visible text</p><script>var visible = 1;</script><style>.visible { color: red; }</style>',
    );
    const ranges = findTextRanges(root, 'visible');
    // Only the <p> match counts.
    expect(ranges).toHaveLength(1);
    const r = ranges[0];
    expect(r.startContainer.parentElement?.tagName).toBe('P');
  });

  it('case-sensitive match', () => {
    const root = makeRoot('<p>Hello hello HELLO</p>');
    expect(findTextRanges(root, 'hello')).toHaveLength(1);
    expect(findTextRanges(root, 'Hello')).toHaveLength(1);
    expect(findTextRanges(root, 'HELLO')).toHaveLength(1);
  });

  it('handles text at the exact start and end of a text node', () => {
    const root = makeRoot('<p>abc def ghi</p>');
    const atStart = findTextRanges(root, 'abc');
    expect(atStart[0].toString()).toBe('abc');
    const atEnd = findTextRanges(root, 'ghi');
    expect(atEnd[0].toString()).toBe('ghi');
  });

  it('does not match when root is null-ish', () => {
    // Defensive: most callers pass refs that may be null; helper should no-op.
    const ranges = findTextRanges(null as unknown as HTMLElement, 'anything');
    expect(ranges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/highlight-ranges.test.ts
```

Expected: FAIL — `findTextRanges` not exported.

- [ ] **Step 3: Implement**

Create `chrome-extension/reader/lib/highlight-ranges.ts`:

```typescript
import type { Paper, Highlight } from '../types';

/**
 * Walk text nodes under `root` and return one `Range` per occurrence of
 * `text`. Matches are case-sensitive and include cross-element spans (text
 * that starts in one text node and ends in another). Skips `<script>` and
 * `<style>` subtrees so injected sanitizer tokens don't produce ghost hits.
 *
 * Returns `[]` when `root` is null, when `text` is empty, or when no match.
 *
 * Implementation sketch:
 *   1. Concatenate text nodes under root into a flat string + offset map.
 *   2. For each occurrence of `text` in the flat string, resolve start/end
 *      back to (node, offset) pairs via the offset map.
 *   3. Build a Range per match.
 */
export function findTextRanges(root: HTMLElement | null, text: string): Range[] {
  if (!root || !text) return [];

  // Collect text nodes + their starting offset in the concatenated buffer.
  type Entry = { node: Text; start: number };
  const entries: Entry[] = [];
  let buf = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent) {
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let n: Node | null = walker.nextNode();
  while (n) {
    const tn = n as Text;
    entries.push({ node: tn, start: buf.length });
    buf += tn.data;
    n = walker.nextNode();
  }
  if (entries.length === 0) return [];

  const ranges: Range[] = [];
  let searchFrom = 0;
  while (true) {
    const hit = buf.indexOf(text, searchFrom);
    if (hit === -1) break;
    const endHit = hit + text.length;

    const startLoc = locate(entries, hit);
    const endLoc = locate(entries, endHit);
    if (startLoc && endLoc) {
      const r = document.createRange();
      r.setStart(startLoc.node, startLoc.offset);
      r.setEnd(endLoc.node, endLoc.offset);
      ranges.push(r);
    }
    searchFrom = endHit;
  }
  return ranges;
}

/**
 * Find which text node contains the buffer offset, and what offset within
 * that node. Uses linear scan; entries.length is small (text nodes per
 * paragraph / page), so binary search is overkill.
 */
function locate(entries: { node: Text; start: number }[], bufOffset: number)
  : { node: Text; offset: number } | null {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const next = entries[i + 1];
    const end = next ? next.start : e.start + e.node.data.length;
    if (bufOffset <= end) {
      return { node: e.node, offset: Math.max(0, bufOffset - e.start) };
    }
  }
  return null;
}

/**
 * Register all stored highlights against a rendered DOM root using the CSS
 * Custom Highlight API. Called from a post-mount `useEffect` after the DOM
 * is painted. No-ops if `CSS.highlights` / `Highlight` are not available
 * (defensive: Chrome 105+ required).
 *
 * Scoping: for each Highlight, search only within the subtree that carries
 * its `paragraphId` (via `[data-pid="…"]`). This avoids painting `{highlight.text}`
 * matches in OTHER paragraphs where the same string happens to occur.
 */
export function registerPaperHighlights(
  root: HTMLElement | null,
  highlights: Highlight[],
  _paragraphs: Paper['paragraphs'],
): void {
  if (!root) return;
  // Feature detection — silently no-op on older Chrome.
  const css = (typeof CSS !== 'undefined' ? (CSS as any) : null);
  const HL = (typeof globalThis !== 'undefined' ? (globalThis as any).Highlight : null);
  if (!css || !css.highlights || !HL) return;

  const allRanges: Range[] = [];
  for (const h of highlights) {
    // Scope to the paragraph's subtree (may span multiple spans in PDF mode).
    const scopes = Array.from(
      root.querySelectorAll<HTMLElement>(`[data-pid="${cssEscape(h.paragraphId)}"]`),
    );
    // Treat the whole root as scope if no paragraph-id container is found
    // (e.g., rich block whose data-pid is on the root element itself).
    const searchRoots = scopes.length > 0 ? scopes : [root];
    for (const scope of searchRoots) {
      allRanges.push(...findTextRanges(scope, h.text));
    }
  }

  if (allRanges.length === 0) {
    // Clear any previous registration so stale paints don't linger.
    css.highlights.delete('hl-yellow');
    return;
  }
  css.highlights.set('hl-yellow', new HL(...allRanges));
}

/**
 * CSS.escape polyfill for paragraph ids (they're `sec0-p0` / `abs` — no
 * special chars today, but defensive for future schema changes).
 */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof (CSS as any).escape === 'function') {
    return (CSS as any).escape(s);
  }
  return s.replace(/["\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- tests/lib/highlight-ranges.test.ts
```

Expected: 9/9 pass. Test 9 ("case-sensitive") and test 8 ("start/end of text node") verify the offset math.

**Nuance:** the cross-element test (test 4) relies on jsdom's correct parent traversal via `treeWalker` — if that ever regresses, this test catches it.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/highlight-ranges.ts chrome-extension/tests/lib/highlight-ranges.test.ts
git commit -m "feat(ext): findTextRanges + registerPaperHighlights helpers (TDD)"
```

---

## Task 2: CSS Custom Highlight rule

**Files:**
- Modify: `chrome-extension/reader/styles/tokens.css`

**Rationale:** `CSS.highlights.set('hl-yellow', ...)` paints via the `::highlight(hl-yellow)` pseudo-element. Need a CSS rule so the name actually produces visual highlighting. Match the existing `.hl-yellow` span-wrap color tokens for visual consistency across the two rendering modes.

### Step 1: Append rule

Open `chrome-extension/reader/styles/tokens.css`. Find the existing highlight block (around line 216):

```css
.hl-yellow { background: color-mix(in oklch, var(--ink-highlight) 55%, transparent); padding: 0 1px; border-radius: 1px; }
```

Immediately below it, append:

```css
/* Custom Highlight API (Chrome 105+) — painted via CSS.highlights.set(name, ...)
   for rich ar5iv blocks + PDF text-layer spans where span-wrapping isn't
   viable. Matches .hl-yellow color so both rendering paths look identical. */
::highlight(hl-yellow) {
  background-color: color-mix(in oklch, var(--ink-highlight) 55%, transparent);
  color: inherit;
}
```

No separate dark-mode rule needed — `--ink-highlight` flips with `[data-theme="dark"]` already (`#E8D385` light → `#8A7424` dark).

### Step 2: Build to validate

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/styles/tokens.css
git commit -m "feat(ext): ::highlight(hl-yellow) CSS rule for Custom Highlight API"
```

---

## Task 3: PaperPage — strip span-wrap + extract presentational RichBlock

**Files:**
- Modify: `chrome-extension/reader/components/paper-page.tsx`

**Rationale:** Custom Highlight API (Tasks 1+2) will paint highlights everywhere — plain paragraphs, rich blocks, PDF spans — via one ViewerApp-level registration (Task 4). So `renderHighlighted` span-wrap becomes redundant and inconsistent. Remove it; extract the rich-block render into a tiny presentational `RichBlock` for consistency. Both paragraph types now render plain text/HTML with `data-pid` — highlight paint is added at the ViewerApp level next.

### Step 1: Remove `renderHighlighted` + span-wrap from plain paragraph branch

Open `chrome-extension/reader/components/paper-page.tsx`. Find `renderBody` — the plain-paragraph branch at the bottom of its map callback:

```tsx
    return (
      <p
        key={i}
        data-pid={item.p.id}
        style={{
          ...bodyFont,
          fontSize: 14, lineHeight: 1.7,
          color: 'var(--ink)', margin: '0 0 14px',
          textAlign: 'justify', hyphens: 'auto',
        }}
      >
        {pHighlights.length === 0 ? item.p.text : renderHighlighted(item.p.text, pHighlights)}
      </p>
    );
```

Replace the children expression:

```tsx
        {item.p.text}
```

Remove the `const pHighlights = …` line just above the `if (item.p.html)` branch — no longer used.

### Step 2: Delete the `renderHighlighted` helper function

Grep for `function renderHighlighted` in `paper-page.tsx`. Delete the entire function (~25 lines) + any JSDoc above it. If there's an unused helper it called (e.g. segment-building), check whether it's used elsewhere; if not, delete that too. Also remove the `Highlight` import if `renderBody` no longer references it for the plain path.

### Step 3: Extract `RichBlock` presentational component

Still in `paper-page.tsx`, locate the rich-block branch in `renderBody`:

```tsx
    if (item.p.html) {
      // Rich-block branch drops pHighlights — deep-DOM highlight wrap is
      // deferred. See TODO.md #10.
      return (
        <div
          key={i}
          data-pid={item.p.id}
          className="ltx-block paper-body"
          style={{
            ...bodyFont,
            fontSize: 14, lineHeight: 1.7,
            color: 'var(--ink)', margin: '0 0 14px',
          }}
          dangerouslySetInnerHTML={{ __html: item.p.html }}
        />
      );
    }
```

Replace with a component call:

```tsx
    if (item.p.html) {
      return <RichBlock key={i} paragraph={item.p} bodyFont={bodyFont} />;
    }
```

Add the `RichBlock` component at the bottom of the file (after `renderBody`, where `renderHighlighted` used to live):

```typescript
function RichBlock({
  paragraph, bodyFont,
}: {
  paragraph: Paragraph;
  bodyFont: CSSProperties;
}) {
  return (
    <div
      data-pid={paragraph.id}
      className="ltx-block paper-body"
      style={{
        ...bodyFont,
        fontSize: 14, lineHeight: 1.7,
        color: 'var(--ink)', margin: '0 0 14px',
      }}
      dangerouslySetInnerHTML={{ __html: paragraph.html! }}
    />
  );
}
```

Presentational only — no state, no effects. ViewerApp (Task 4) handles highlight registration for all rendered DOM including this component.

### Step 4: Typecheck + build + test

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
npm run build
npm test
```

Expected: typecheck exit 0; build exit 0; tests **pass** (198 from Task 1 baseline) — BUT verify no test asserts on `<span class="hl-yellow">` in rendered output. Grep:

```bash
grep -rn 'hl-yellow\|renderHighlighted' chrome-extension/tests/ chrome-extension/reader/
```

Expected matches:
- `tokens.css` (.hl-yellow class, ::highlight(hl-yellow) rule) — stays.
- No test file references.
- If any test DOES reference `renderHighlighted` or span-wrap output, update that test to no longer depend on span-wrap (preferred) or delete if it was purely verifying the removed behavior.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/paper-page.tsx
git commit -m "refactor(ext): remove renderHighlighted span-wrap; extract presentational RichBlock"
```

---

## Task 4: ViewerApp-level highlight registration + event-driven refresh

**Files:**
- Modify: `chrome-extension/reader/main.tsx`
- Modify: `chrome-extension/reader/components/pdf-page.tsx`

**Rationale:** The CSS Custom Highlight API uses GLOBAL names (`'hl-yellow'`), so components independently calling `CSS.highlights.set` would overwrite each other. One registration at ViewerApp scope covers the entire reader — PDF pages, rich blocks, plain paragraphs — in a single call against `readerScrollRef`. PDF pages lazy-mount via IntersectionObserver, so PdfPage dispatches a custom event after its text layer is in the DOM; ViewerApp listens and re-registers.

### Step 1: Add a marker attribute to the reader scroll container

Open `chrome-extension/reader/main.tsx`. Find where `readerScrollRef` is attached in the JSX (grep `ref={readerScrollRef}`). Add `data-reader-scroll` attribute so PdfPage can find the container via `closest()`:

```tsx
<div
  ref={readerScrollRef}
  data-reader-scroll
  style={{ /* existing */ }}
>
  {/* existing children */}
</div>
```

### Step 2: Add the registration effect in ViewerApp

Still in main.tsx, add this import near the other `./lib/*` imports:

```typescript
import { registerPaperHighlights } from './lib/highlight-ranges';
```

Find a good location near the other DOM-driven effects in `ViewerApp` (next to scroll-spy / breadcrumb effects). Add:

```typescript
  // CSS Custom Highlight API: one registration covers plain paragraphs, ar5iv
  // rich blocks, and PDF text-layer spans. `pf-textlayer-ready` fires when a
  // lazy-mounted PdfPage's text layer lands in the DOM — re-register so those
  // new spans get paint. Cleanup clears the channel on unmount / paper swap.
  useEffect(() => {
    const container = readerScrollRef.current;
    if (!container) return;
    const register = () => {
      registerPaperHighlights(container, highlights, effectivePaper.paragraphs);
    };
    register();
    container.addEventListener('pf-textlayer-ready', register);
    return () => {
      container.removeEventListener('pf-textlayer-ready', register);
      if (typeof CSS !== 'undefined' && (CSS as any).highlights) {
        (CSS as any).highlights.delete('hl-yellow');
      }
    };
  }, [highlights, effectivePaper]);
```

### Step 3: Dispatch `pf-textlayer-ready` from PdfPage

Open `chrome-extension/reader/components/pdf-page.tsx`. Find the render effect — the `(async () => { … })()` block inside `useEffect` that runs `page.render()` + `new TextLayer(...).render()` + the data-pid tagging loop.

At the END of the async IIFE (after the data-pid tagging loop, before the closing `})()`):

```typescript
      // Notify ViewerApp that this page's text layer is now in the DOM so any
      // pending highlights can be registered against the new spans.
      if (!cancelled) {
        const container = rootRef.current?.closest<HTMLElement>('[data-reader-scroll]');
        container?.dispatchEvent(new CustomEvent('pf-textlayer-ready', { bubbles: false }));
      }
```

No other changes to `pdf-page.tsx` — props stay as-is, no new imports needed (CustomEvent + closest are platform APIs).

### Step 4: Typecheck + test + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
npm test
npm run build
```

Expected: typecheck exit 0; tests 198/198; build exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx chrome-extension/reader/components/pdf-page.tsx
git commit -m "feat(ext): ViewerApp-level Custom Highlight registration + PdfPage ready event (TODO #10 + #13)"
```

---

## Task 5: Final — tests + typecheck + build + verification log

**Files:** none (verification only).

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected: 198/198 (189 baseline + 9 `findTextRanges` tests). If the span-wrap removal in Task 3 broke any test, address inline.

### Step 2: Typecheck + build

```bash
npm run typecheck
npm run build
```

Expected: exit 0 on both.

### Step 3: Manual Chrome smoke test

Load `dist/` via `chrome://extensions` → "Load unpacked". Then:

1. **arXiv HTML plain paragraph:** select a phrase in Introduction, press `H`. Yellow paint appears over the text. Reload page. Highlight persists (via storage) AND visually repaints.
2. **ar5iv figure caption:** select text inside a figure caption, press `H`. Yellow paint appears inside the caption. Reload. Persists.
3. **ar5iv equation textContent:** select a character or two from an equation, press `H`. Yellow appears (or not — depending on whether the equation's textContent rendering survives; MathML serialization is finicky). If it doesn't paint visibly, that's acceptable per spec — the highlight is persisted and pings fire.
4. **PDF text-layer:** open a PDF, select text in a paragraph, press `H`. Yellow paint appears over the canvas-rendered text (via the transparent text-layer spans). Reload. Persists + repaints.
5. **Dark mode:** toggle theme. Yellow paint flips to the dimmer olive `#8A7424` automatically via `--ink-highlight` theme token.
6. **Multiple highlights in same paragraph:** select two non-overlapping phrases in the same paragraph, H-mark each. Both paint.
7. **Highlight in Abstract** (regression from Phase 5 deferral): still rejected with toast "Highlights on the abstract aren't supported yet." — the ViewerApp-level registration is scoped by `[data-pid]`, and `abs` has `data-pid="abs"` but the H action toasts+rejects before the storage write, so nothing to paint. Pre-existing toast UX preserved.
8. **Paper swap:** close paper, open a different one. No leftover yellow paint from the previous paper.

### Step 4: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 9 automated verification complete (YYYY-MM-DD):
- `npm test` → ~198 passed across 14 test files (Plan 8 baseline 189 → +9 findTextRanges tests; span-wrap test removals if any)
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke test (plain / rich-block figure / equation / PDF / dark mode / multi-highlight / abstract regression / paper-swap cleanup) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-22-plan-phase-9-highlight-fidelity.md
git commit -m "docs(plan): Phase 9 verification log"
```

---

## Phase 9 Done Criteria

- ✅ `findTextRanges(root, text): Range[]` pure helper exported from `reader/lib/highlight-ranges.ts`; 9 jsdom tests cover single/multiple/cross-element/script-skip/edge-position matches
- ✅ `registerPaperHighlights(root, highlights, paragraphs): void` orchestrator; feature-detects `CSS.highlights` + `Highlight` for graceful fallback on pre-105 Chrome
- ✅ `::highlight(hl-yellow)` CSS rule in `tokens.css`; palette matches `.hl-yellow` span-wrap
- ✅ ViewerApp runs a single registration effect keyed on `[highlights, effectivePaper]`; listens to `pf-textlayer-ready` custom event from PdfPage so lazy-mounted pages get paint on reveal
- ✅ PaperPage's `renderHighlighted` span-wrap REMOVED; plain paragraphs + rich blocks + PDF spans all paint through the Custom Highlight API
- ✅ All unit tests pass (~198); typecheck clean; build green
- ✅ Abstract rejection UX (Phase 5 Plan) preserved — ViewerApp registration is storage-driven; abstract highlights never enter storage because runAction rejects them upstream

## Next: closes TODO.md

After Phase 9 lands, all items in TODO.md (1–13) are implemented or explicitly documented as deferred-by-design. Future plans would be driven by new requirements, not by existing debt.

---

## Verification log

Phase 9 automated verification complete (2026-04-23):
- `npm test` → **202 passed** across 14 test files (Plan 8 baseline 189 → +9 findTextRanges tests, +4 registerPaperHighlights tests (post-review self-fix commit `8869393`))
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke test (plain / rich-block figure / equation / PDF / dark mode / multi-highlight / abstract regression / paper-swap cleanup) — deferred to user.
