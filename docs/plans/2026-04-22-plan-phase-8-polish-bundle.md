# Phase 8 — Polish Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the outstanding TODO.md debt and Phase 6/7 review follow-ups that don't fit the upcoming Highlight Fidelity plan: quota error contract + test coverage, rich-block AI citation prettification, PDF scroll-spy page-element cache, Canvas ChatNode user-bubble truncation.

**Architecture:** Surgical changes across storage / parsing / main.tsx / canvas-view.tsx. One new error class (`QuotaError`), one small test-only fixture assertion, one ref-keyed DOM cache, and one CSS rule. No new components; no new files in `reader/components/`.

**Tech Stack:** TypeScript, vitest, no new runtime deps.

**Scope:** Four items.
1. **TODO #7 + #8** — quota error contract: typed `QuotaError` thrown by storage.set, callers that have generic AI try/catch explicitly skip double-toast.
2. **TODO #9** — rich-block AI citation prettification: parseArxivHtml prepends a descriptor (`[Figure 1]`, `[Equation]`, `[Table 1]`) to the `text` of figure/equation/table blocks so AI context + citation UI distinguish non-prose.
3. **Phase 6 #5** — PDF scroll-spy page-element cache: avoid `querySelectorAll('.pf-pdf-page')` on every 60 ms scroll debounce.
4. **Phase 7 #6** — Canvas ChatNode user-bubble truncation: CSS `line-clamp: 3` so long pinned questions don't blow out the node.

**Explicitly out of scope** (deferred to Plan 9 Highlight Fidelity):
- TODO #10 — rich-block HTML highlight wrap (deep-DOM span wrap inside ar5iv blocks)
- TODO #13 — visual PDF highlight paint (overlay rects over text-layer)

Both are a single architectural problem ("highlight on non-text-node content") and deserve their own plan.

---

## Pre-read

1. `TODO.md` — items #7, #8, #9 (items #10 + #13 are Plan 9).
2. `docs/reviews/2026-04-22-review-phase-6-pdf-canvas.md` — "Scroll-spy page-element cache" in Follow-ups.
3. `docs/reviews/2026-04-22-review-phase-7-canvas-mode.md` — "ChatNode user-bubble truncation" in Follow-ups.
4. `chrome-extension/reader/lib/storage.ts:53-73` — current `set()` + `QuotaHandler`.
5. `chrome-extension/reader/lib/arxiv.ts:67-78` — current block-capture branch in `parseArxivHtml`.
6. `chrome-extension/reader/main.tsx:487-500` — PDF scroll-spy + breadcrumb effects.
7. `chrome-extension/reader/components/canvas-view.tsx` — ChatNode user-bubble styling.
8. `chrome-extension/reader/lib/ai.ts:11-29` — `buildPaperContext` — how paragraph text flows into AI prompts.

## File structure

**Create:** none. Every change is a modification.

**Modify:**
- `chrome-extension/reader/lib/storage.ts` — export `QuotaError` class; `set()` throws it for quota errors.
- `chrome-extension/tests/lib/storage.test.ts` — new test for `QuotaError` path.
- `chrome-extension/reader/main.tsx` — AI catch blocks detect `QuotaError` and skip the generic "AI request failed" toast; PDF scroll-spy + breadcrumb share a cached `.pf-pdf-page` ref.
- `chrome-extension/reader/lib/arxiv.ts` — block-capture branch prepends descriptor to `text` field.
- `chrome-extension/tests/lib/arxiv.test.ts` — add assertions for descriptor-prefixed text.
- `chrome-extension/tests/fixtures/arxiv-html-real.html` — (no change needed; existing fixture has `ltx_tag` spans to validate).
- `chrome-extension/reader/components/canvas-view.tsx` — ChatNode user bubble gets line-clamp CSS.

---

## Task 1: `QuotaError` typed class + storage.set throws it (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Rationale:** TODO #7 flagged that `storage.set()` currently re-throws the raw quota error. Callers with generic AI try/catch blocks (`main.tsx` stream paths) then show a second misleading "AI request failed: QUOTA_BYTES..." toast on top of the correct quota toast. Typed error lets callers distinguish quota from other errors.

### Step 1: Write failing test

Open `chrome-extension/tests/lib/storage.test.ts`. Verify at the top of the file that `chrome.storage.local.set` is mocked (existing tests mock it). Then append to the end of the file:

```typescript
import { QuotaError, setQuotaHandler } from '../../reader/lib/storage';

describe('storage set — QuotaError + handler', () => {
  // Handler is module-level state; reset between tests so ordering doesn't matter.
  beforeEach(() => setQuotaHandler(null));

  it('throws QuotaError when chrome.storage.local.set rejects with a QUOTA message', async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    let captured: unknown;
    try {
      // Any exported setter hits the internal `set()`. `setMemory` is a good proxy.
      const { setMemory } = await import('../../reader/lib/storage');
      await setMemory('pk-quota', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(QuotaError);
    expect((captured as QuotaError).message).toContain('QUOTA_BYTES');
  });

  it('fires the registered handler on QuotaError', async () => {
    const calls: number[] = [];
    setQuotaHandler(() => calls.push(1));
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM exceeded')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    const { setMemory } = await import('../../reader/lib/storage');
    try {
      await setMemory('pk-handler', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch { /* expected */ }
    expect(calls).toEqual([1]);
    setQuotaHandler(null);
  });

  it('passes non-quota errors through as the raw error (not QuotaError)', async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('Unknown disk failure')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    let captured: unknown;
    try {
      const { setMemory } = await import('../../reader/lib/storage');
      await setMemory('pk-other', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeInstanceOf(QuotaError);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('Unknown disk failure');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: FAIL on the first two tests — `QuotaError` not exported from storage.ts. Third passes trivially (non-quota error is whatever gets thrown, which is the raw Error).

- [ ] **Step 3: Add `QuotaError` + wrap in `set()`**

Open `chrome-extension/reader/lib/storage.ts`. Replace the existing `set` + handler block (lines ~53-73) with:

```typescript
type QuotaHandler = () => void;
let onQuotaExceeded: QuotaHandler | null = null;

export function setQuotaHandler(fn: QuotaHandler | null): void {
  onQuotaExceeded = fn;
}

/**
 * Sentinel error for `chrome.storage.local` quota failures. Callers that
 * have a generic AI try/catch (e.g. `main.tsx` stream paths) can check
 * `err instanceof QuotaError` and skip their own error UI — the quota
 * toast from `setQuotaHandler` has already fired.
 */
export class QuotaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'QuotaError';
  }
}

async function set(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('QUOTA') || msg.toLowerCase().includes('quota')) {
      console.warn('[PaperFlow] storage quota exceeded:', msg);
      onQuotaExceeded?.();
      throw new QuotaError(msg, err);
    }
    console.error('[PaperFlow] storage set failed:', err);
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: 3/3 new tests pass. All pre-existing storage tests also pass (unchanged behavior for non-quota paths).

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/storage.ts chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): QuotaError sentinel thrown by storage.set on quota-exceed (TODO #7/#8)"
```

---

## Task 2: main.tsx AI catch blocks skip double-toast on `QuotaError`

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Rationale:** With Task 1 in place, catch blocks that wrap storage-writing operations (appendChatMessage inside chat stream finalization; addNote inside AI stream finalization) can distinguish quota from other errors. The quota toast already fired from `setQuotaHandler`; the generic "AI request failed" toast is misleading when quota is the cause.

### Step 1: Import `QuotaError`

Open `chrome-extension/reader/main.tsx`. Find the import from `./lib/storage` (around line 12-18):

```typescript
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory,
  getHighlights, addHighlight, getNotes, addNote, getConfig,
  getChat, appendChatMessage,
  getSummarySection, setSummarySection, clearSummarySection,
  setQuotaHandler,
} from './lib/storage';
```

Add `QuotaError`:

```typescript
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory,
  getHighlights, addHighlight, getNotes, addNote, getConfig,
  getChat, appendChatMessage,
  getSummarySection, setSummarySection, clearSummarySection,
  setQuotaHandler, QuotaError,
} from './lib/storage';
```

### Step 2: Skip double-toast in the AI-action stream catch

Find the `runAction` catch block for E/S/T (grep for `setToast(\`AI request failed`). It looks like:

```typescript
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
    }
```

Replace with:

```typescript
    } catch (err) {
      if (err instanceof QuotaError) {
        // setQuotaHandler already fired the quota toast; swallow here.
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
    }
```

### Step 3: Same treatment for chat send catch

Find the `onChatSend` catch block (grep again for the SAME `setToast(\`AI request failed` pattern — there are two occurrences, one in `runAction` and one in `onChatSend`). Apply the same edit:

```typescript
    } catch (err) {
      if (err instanceof QuotaError) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
    }
```

### Step 4: Typecheck + test

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
npm test
```

Expected: typecheck exit 0; tests pass (new count = pre + 3 storage tests = 184).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "fix(ext): AI try/catch swallows QuotaError — avoid double-toast"
```

---

## Task 3: Rich-block AI citation prettification — descriptor prefix (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Rationale:** TODO #9. Currently `parseArxivHtml`'s block-capture branch sets `text: child.textContent?.trim()` for figures/equations/tables. In ar5iv that's something like `"Figure 1. Architecture overview."` (caption text), or for equations just the raw MathML textContent which reads like `"y=Wx+b"`. This text flows into `buildPaperContext` verbatim. The AI sees it as a regular paragraph and can cite it as `[p4]` — the user then sees a citation whose "quote" is `"y=Wx+b"` with loc `§1 Introduction · ¶ p4`. Prepend a typed descriptor so the model and the citation UI both know "this is non-prose."

### Step 1: Write failing test

Open `chrome-extension/tests/lib/arxiv.test.ts`. Find the existing `describe('parseArxivHtml — end-to-end HTML fidelity', …)` block. Just above it, insert a NEW describe:

```typescript
describe('parseArxivHtml — rich-block descriptor prefix (TODO #9)', () => {
  it('prepends "[Figure <tag>]" to figure captions when ltx_tag is present', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img class="ltx_graphics" src="f.png"/>
          <figcaption class="ltx_caption"><span class="ltx_tag">Figure 1.</span> Architecture overview.</figcaption>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<figure'));
    expect(fig?.text).toMatch(/^\[Figure 1\]/);
    expect(fig?.text).toContain('Architecture overview');
  });

  it('prepends "[Figure]" when no ltx_tag span is present', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F2">
          <img class="ltx_graphics" src="f2.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<figure'));
    expect(fig?.text).toMatch(/^\[Figure\]/);
  });

  it('prepends "[Equation]" to ltx_equation blocks', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_equation" id="S1.E1"><math><mi>y</mi><mo>=</mo><mi>x</mi></math></div>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const eq = paragraphs.find((p) => p.html?.includes('ltx_equation'));
    expect(eq?.text).toMatch(/^\[Equation\]/);
  });

  it('prepends "[Table <tag>]" when ltx_tag is present on a ltx_table figure', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_table" id="S1.T1">
          <table class="ltx_tabular"><tr><td>1</td></tr></table>
          <figcaption class="ltx_caption"><span class="ltx_tag">Table 1.</span> Results.</figcaption>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const tbl = paragraphs.find((p) => p.html?.includes('ltx_table'));
    expect(tbl?.text).toMatch(/^\[Table 1\]/);
    expect(tbl?.text).toContain('Results');
  });

  it('prepends "[Table]" to raw <table> (no ltx_table wrapper, no ltx_tag)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <table><tr><td>a</td></tr></table>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const tbl = paragraphs.find((p) => p.html?.includes('<table'));
    expect(tbl?.text).toMatch(/^\[Table\]/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: 5 new tests FAIL — current text is raw textContent without descriptor.

- [ ] **Step 3: Implement descriptor prefix in the block-capture branch**

Open `chrome-extension/reader/lib/arxiv.ts`. Find the block-capture branch (around lines 67-78):

```typescript
      // Figure / table / equation blocks — capture outerHTML as a paragraph-like entry.
      if (child.tagName === 'FIGURE' ||
          (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) ||
          child.tagName === 'TABLE') {
        const rawHtml = child.outerHTML;
        raw.push({
          outlineItemId: sectionIdMap.get(sec)!,
          text: child.textContent?.trim() ?? '',
          html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
        });
        continue;
      }
```

Replace with:

```typescript
      // Figure / table / equation blocks — capture outerHTML as a paragraph-like entry.
      if (child.tagName === 'FIGURE' ||
          (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) ||
          child.tagName === 'TABLE') {
        const rawHtml = child.outerHTML;
        raw.push({
          outlineItemId: sectionIdMap.get(sec)!,
          text: blockDescriptorText(child),
          html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
        });
        continue;
      }
```

Add the `blockDescriptorText` helper near the bottom of the file (just above `buildVenue` or `rewriteImgSrc`):

```typescript
/**
 * Produce the `text` field for a captured figure/equation/table block.
 *
 * ar5iv wraps the label/number in `<span class="ltx_tag">` inside the caption
 * (e.g. "Figure 1." / "Table 3."). When present, use it as-is; otherwise fall
 * back to a typed descriptor (`Figure` / `Equation` / `Table`) so the AI and
 * citation UI distinguish non-prose blocks from regular paragraphs.
 *
 * Output always begins with `[descriptor]` (brackets) followed by the block's
 * stripped textContent (caption for figures/tables, MathML-text for equations).
 */
function blockDescriptorText(child: Element): string {
  const rawText = (child.textContent ?? '').replace(/\s+/g, ' ').trim();

  // Detect kind: ltx_equation DIV → Equation; ltx_table figure → Table; plain
  // <table> → Table; other FIGURE → Figure.
  let kind: 'Figure' | 'Equation' | 'Table';
  if (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) {
    kind = 'Equation';
  } else if (
    child.tagName === 'TABLE' ||
    (child.tagName === 'FIGURE' && child.classList.contains('ltx_table'))
  ) {
    kind = 'Table';
  } else {
    kind = 'Figure';
  }

  // Find the first ltx_tag inside a caption (scoped: only figcaption.ltx_caption
  // nested in the block). Strip its trailing period for cleaner brackets.
  const tagEl = child.querySelector('figcaption.ltx_caption > .ltx_tag');
  const rawTag = tagEl?.textContent?.trim() ?? '';
  const cleanTag = rawTag.replace(/\.$/, '').trim();

  // Build the bracketed descriptor. When a tag is present, it already includes
  // the kind word ("Figure 1", "Table 3"), so use the tag directly. Otherwise
  // use the bare kind.
  const descriptor = cleanTag ? `[${cleanTag}]` : `[${kind}]`;

  // Strip the tag prefix from rawText to avoid "[Figure 1] Figure 1. Architecture…"
  let body = rawText;
  if (rawTag && body.startsWith(rawTag)) {
    body = body.slice(rawTag.length).trim();
  }

  return body ? `${descriptor} ${body}` : descriptor;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all arxiv tests pass including the 5 new ones. Also check that the existing end-to-end round-trip test still passes — its assertions on `p.text.startsWith('Retrieval concatenates')` are plain-paragraph text, unaffected by this change.

- [ ] **Step 5: Verify AI context reflects the descriptors**

This is a sanity check, not a new test. Read `chrome-extension/reader/lib/ai.ts:11-29` (`buildPaperContext`). Confirm it concatenates `paper.paragraphs.forEach((p, idx) => parts.push(\`[p${idx + 1}] §${p.section} · ${p.text}\`))`. Yes — `p.text` flows verbatim. So a figure becomes `[p4] §2 Method · [Figure 1] Architecture overview.` in the AI context. Good.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts chrome-extension/tests/lib/arxiv.test.ts
git commit -m "feat(ext): rich-block AI citation descriptors ([Figure N]/[Equation]/[Table N]) (TODO #9)"
```

---

## Task 4: PDF scroll-spy page-element cache

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Rationale:** Phase 6 review: the breadcrumb scroll handler runs `querySelectorAll('.pf-pdf-page')` + forces layout via `offsetTop` reads every 60 ms during scroll. On 50+ page PDFs this shows up. Cache the element list in a ref, invalidate when `pdfRuntime` swaps.

### Step 1: Add cache ref + invalidation

Open `chrome-extension/reader/main.tsx`. Find the breadcrumb effect (grep for `.pf-pdf-page` — there are two effects around lines 487-525, the breadcrumb-page effect and the PDF scroll-spy effect added in Phase 6 fixes). The breadcrumb effect looks like:

```typescript
  useEffect(() => {
    if (!pdfRuntime) { setCurrentPdfPage(1); return; }
    const container = readerScrollRef.current;
    if (!container) return;

    let t: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const viewportMid = container.scrollTop + container.clientHeight / 2;
      const pages = Array.from(container.querySelectorAll<HTMLElement>('.pf-pdf-page'));
      const idx = pages.findIndex((p) => p.offsetTop + p.offsetHeight > viewportMid);
      const current = idx === -1 ? Math.max(1, pages.length) : idx + 1;
      setCurrentPdfPage(current);
    };
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(compute, 60);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => {
      if (t) clearTimeout(t);
      container.removeEventListener('scroll', onScroll);
    };
  }, [pdfRuntime]);
```

Replace with a cache-backed version:

```typescript
  useEffect(() => {
    if (!pdfRuntime) { setCurrentPdfPage(1); return; }
    const container = readerScrollRef.current;
    if (!container) return;

    // Cache: `<.pf-pdf-page>` NodeList is stable once all page skeletons
    // mount (PdfPage sets dims eagerly, before IntersectionObserver triggers
    // the render). Invalidate when length differs from `doc.numPages`.
    const expected = pdfRuntime.doc.numPages;
    let cached: HTMLElement[] | null = null;
    const getPages = (): HTMLElement[] => {
      if (cached && cached.length === expected) return cached;
      cached = Array.from(container.querySelectorAll<HTMLElement>('.pf-pdf-page'));
      return cached;
    };

    let t: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const pages = getPages();
      const viewportMid = container.scrollTop + container.clientHeight / 2;
      const idx = pages.findIndex((p) => p.offsetTop + p.offsetHeight > viewportMid);
      const current = idx === -1 ? Math.max(1, pages.length) : idx + 1;
      setCurrentPdfPage(current);
    };
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(compute, 60);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => {
      if (t) clearTimeout(t);
      container.removeEventListener('scroll', onScroll);
    };
  }, [pdfRuntime]);
```

Key changes:
- `cached: HTMLElement[] | null` is effect-local (reset when the effect re-runs on `pdfRuntime` change).
- `getPages()` re-queries only when cache is empty OR length differs from `doc.numPages`.
- Once all skeletons mount (typically within 300 ms of Canvas/Reader load), the cache locks in.

### Step 2: Typecheck + test + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
npm test
npm run build
```

Expected: typecheck exit 0; tests 184/184 unchanged (no new test — perf optimization is not unit-testable without a layout framework); build exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "perf(ext): cache .pf-pdf-page NodeList in breadcrumb scroll effect"
```

---

## Task 5: ChatNode user-bubble truncation (CSS line-clamp)

**Files:**
- Modify: `chrome-extension/reader/components/canvas-view.tsx`

**Rationale:** Phase 7 review: ChatNode shows the last user question as a chat bubble in the top-right of the node. Long pinned questions (e.g. pasted paragraphs) overflow the node or force it to scroll awkwardly. Line-clamp to 3 lines with ellipsis — matches the spec's "问题 + 答案片段" framing (preview, not full text).

### Step 1: Add line-clamp to the user bubble

Open `chrome-extension/reader/components/canvas-view.tsx`. Find `ChatNode`. The user bubble div has inline style like:

```tsx
        <div style={{
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '6px 10px',
          background: 'var(--paper-deep)',
          borderRadius: '8px 8px 2px 8px',
          fontSize: 11,
        }}>{data.question}</div>
```

Replace with:

```tsx
        <div style={{
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '6px 10px',
          background: 'var(--paper-deep)',
          borderRadius: '8px 8px 2px 8px',
          fontSize: 11,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}>{data.question}</div>
```

This uses CSS `-webkit-line-clamp` (well-supported in Chrome/Chromium — the only browser class that matters for a Chrome extension).

### Step 2: Build to validate CSS

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/canvas-view.tsx
git commit -m "fix(ext): Canvas ChatNode user-bubble line-clamp(3) — prevent overflow"
```

---

## Task 6: Final — tests + typecheck + build + verification log

**Files:** none (verification only unless fixes required).

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected increments over Plan 7's 181:
- `storage.test.ts`: +3 (QuotaError path)
- `arxiv.test.ts`: +5 (descriptor prefix)

Total: 181 + 8 = **~189**.

### Step 2: Typecheck + build

```bash
npm run typecheck
npm run build
```

Expected: exit 0 on both. `dist/` layout unchanged (reader + options + sw + content-IIFE).

### Step 3: Manual Chrome smoke test

Load `dist/` via `chrome://extensions` → "Load unpacked". Then:

1. **arXiv regression check:** open any arXiv HTML paper, confirm figures/equations/tables still render.
2. **Rich-block citation check:** in Summary tab, trigger "Summarize" (or Chat-ask "explain Figure 1"). Confirm citation chip shows descriptor like `[Figure 1]` as a recognizable label, not `"y=Wx+b"` or raw textContent.
3. **Quota UX check (hard to reproduce without filling storage):** open devtools → Application → Storage → Extension storage → fill quota manually, then try to chat. Expect exactly ONE toast ("Storage is full...") — no second "AI request failed" toast.
4. **Big PDF scroll-spy:** open a 50+ page PDF, scroll rapidly. TopBar breadcrumb updates smoothly; no visible jank from per-tick `querySelectorAll`.
5. **Canvas long-question:** open a paper, ask a long pinned-selection question in Chat (paste ~3 sentences as the selection), switch to Canvas. ChatNode user-bubble shows at most 3 lines with ellipsis — not overflowing the node.
6. **Dark mode:** toggle theme, re-verify 1, 2, 5 read correctly.

### Step 4: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 8 automated verification complete (YYYY-MM-DD):
- `npm test` → ~189 passed across 13+ files
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke test (arXiv regression / rich-block citation / quota UX / PDF scroll-spy perf / Canvas long-question truncation / dark mode) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-22-plan-phase-8-polish-bundle.md
git commit -m "docs(plan): Phase 8 verification log"
```

---

## Phase 8 Done Criteria

- ✅ `QuotaError` class exported from `storage.ts`; `set()` throws it for quota failures (TODO #7)
- ✅ Quota path has dedicated test coverage (3 tests in storage.test.ts) (TODO #8)
- ✅ `main.tsx` AI try/catch blocks skip the generic "AI request failed" toast when the underlying cause is `QuotaError`
- ✅ `parseArxivHtml` block-capture branch prepends `[Figure N]` / `[Equation]` / `[Table N]` descriptors to `text` (TODO #9)
- ✅ PDF scroll-spy breadcrumb effect caches the `.pf-pdf-page` NodeList; invalidates on `pdfRuntime` swap or skeleton-count mismatch
- ✅ Canvas ChatNode user-bubble has `line-clamp: 3` + ellipsis
- ✅ All unit tests pass (~189); typecheck clean; build green

## Next: Plan 9

**Plan 9 — Highlight Fidelity (TODO #10 + #13):**
- **HTML path (TODO #10):** deep-DOM highlight wrap inside ar5iv `.ltx-block` content — search for `highlight.text` across text nodes, split-and-wrap matching text spans with `<mark class="hl-yellow">` while preserving the existing structure. Skip ranges that cross `<figure>` / `<math>` boundaries.
- **PDF path (TODO #13):** overlay-rect highlight paint. After pdfjs `TextLayer` renders, for each stored highlight: find the spans with matching `data-pid`, reconstruct the visual range via `Range.getBoundingClientRect()`, draw a `<div class="pf-pdf-highlight-overlay">` absolute-positioned behind the text layer (z-index below spans, above canvas).
- Shared architecture: `findTextInNodes(root, text): Range[]` helper used by both paths; test against DOM fixtures.
- Estimated 6–9 tasks.

---

## Verification log

Phase 8 automated verification complete (2026-04-22):
- `npm test` → **189 passed** across 13 test files (Plan 7 baseline 181 → +8: storage-QuotaError +3, arxiv-descriptors +5)
- `npm run typecheck` → exit 0
- `npm run build` → green (reader + options + sw + content-IIFE all emit)
- Manual Chrome smoke test (arXiv regression / rich-block citation / quota UX / PDF scroll-spy perf / Canvas long-question truncation / dark mode) — deferred to user.
