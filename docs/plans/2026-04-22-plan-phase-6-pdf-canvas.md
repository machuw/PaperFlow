# Phase 6 — PDF Canvas + Text-Layer Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render PDFs with canvas + pdfjs `TextLayer` so figures, equations, and tables stay visible while text selection, highlight storage, scroll-spy, and margin-note anchoring keep working through the existing `[data-pid]` contract.

**Architecture:** `parsePdf` returns the `PDFDocumentProxy` alongside metadata. A new `PdfPage` component lazy-renders canvas + text-layer per page via `IntersectionObserver`, tagging each `TextLayer` span with `data-pid` derived from per-page paragraph item-index ranges. `PaperPage` branches: HTML-origin papers keep the current flow; PDF-origin papers render a list of `<PdfPage>` elements. pdfDoc lives in a runtime state (`pdfRuntime`) separate from the serializable `Paper` object so storage stays JSON-clean.

**Tech Stack:** pdfjs-dist v4 (`TextLayer` class), React 18, IntersectionObserver, CSS `mix-blend-mode` / `filter: invert` for warm-paper/dark-mode coherence.

**Scope bundles:** main focus is TODO.md #6 (PDF canvas). Two small Phase 5 review residuals ride along: TODO #11 (trust-boundary comment on `Paragraph.html`) and TODO #12 (explicit `ok-partial` discriminator on `LoadResult`). Explicitly deferred to later plans: TODO #7–10 (quota error test, rich-block AI citations, rich-block highlight wrap) and §8.3 Canvas mode (Plan 7).

---

## Pre-read (engineers skimming into this plan)

1. `chrome-extension/reader/lib/pdf.ts` — current parse pipeline.
2. `chrome-extension/reader/lib/parse.ts` — `buildParagraphs`: assigns `sec{n}-p{m}` ids.
3. `chrome-extension/reader/types.ts` — `Paper`, `Paragraph`, `OutlineItem`.
4. `chrome-extension/reader/components/paper-page.tsx` — current HTML/text renderer.
5. `chrome-extension/reader/main.tsx:91-129` — `loadPdfPath`.
6. Spec `docs/specs/2026-04-20-spec-chrome-extension.md`:
   - §3.1 URL 拦截 (PDF fetch path)
   - §3.2 Paragraph id contract
   - §3.4 PaperPage highlight / selection / data-pid
   - §9 TopBar PDF page breadcrumb (scroll-based inference)
7. TODO.md #6 (PDF canvas blueprint), #11 (trust comment), #12 (LoadResult discriminator).

## File structure

**Create:**
- `chrome-extension/reader/lib/pdf-items.ts` — pure helper: groups text items into paragraph ranges with item-index spans.
- `chrome-extension/reader/components/pdf-page.tsx` — one page: canvas + pdfjs `TextLayer` + `data-pid`-tagged spans.
- `chrome-extension/tests/lib/pdf-items.test.ts` — pure-helper tests.

**Modify:**
- `chrome-extension/reader/lib/pdf.ts` — return `doc` + `pageItemRanges` alongside existing `ParsedPdf`.
- `chrome-extension/reader/lib/arxiv.ts` — `LoadResult.kind: 'ok' | 'ok-partial' | 'fallback-pdf' | 'error'` (TODO #12).
- `chrome-extension/reader/types.ts` — add `PdfRuntime` type; comment on `Paragraph.html` (TODO #11).
- `chrome-extension/reader/main.tsx` — hold `PdfRuntime` state; pass into PaperPage; update partial-cache skip to use the new discriminator.
- `chrome-extension/reader/components/paper-page.tsx` — branch on `pdfRuntime`; render `<PdfPage>` list.
- `chrome-extension/reader/styles/tokens.css` — `.pf-pdf-page`, `.pf-pdf-text-layer`, dark-mode filter.
- `TODO.md` — new entry for deferred visual PDF highlight paint.

**Test data:** reuse `chrome-extension/tests/fixtures/sample.pdf`.

---

## Task 1: `pdf-items.ts` — pure helper that groups text items into paragraph index ranges

**Files:**
- Create: `chrome-extension/reader/lib/pdf-items.ts`
- Create: `chrome-extension/tests/lib/pdf-items.test.ts`

**Rationale:** The existing `splitParagraphsByGap()` returns concatenated strings — enough for AI context, but rendering needs the *item indices* inside each paragraph so `TextLayer`-produced spans can carry the right `data-pid`. This task introduces a parallel helper that preserves index ranges.

### Step 1: Write failing test

Create `chrome-extension/tests/lib/pdf-items.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { splitItemsByGap, type ItemRange } from '../../reader/lib/pdf-items';
import type { TextItemLike } from '../../reader/lib/pdf';

const make = (str: string, y: number): TextItemLike => ({
  str,
  transform: [1, 0, 0, 1, 0, y],
});

describe('splitItemsByGap', () => {
  it('returns one range when items are within gap threshold', () => {
    const items = [make('a', 700), make('b', 686)];  // gap 14 < 18
    const ranges = splitItemsByGap(items);
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'a b' },
    ]);
  });

  it('splits when gap exceeds threshold', () => {
    const items = [
      make('para1 line1', 700),
      make('para1 line2', 686),   // gap 14 — same para
      make('para2 start', 650),   // gap 36 > 18 — new para
    ];
    const ranges = splitItemsByGap(items);
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'para1 line1 para1 line2' },
      { startIdx: 2, endIdx: 3, text: 'para2 start' },
    ]);
  });

  it('ignores empty-string items (they stay in the open range but contribute no text)', () => {
    const items = [make('a', 700), make('', 686), make('b', 684)];
    const ranges = splitItemsByGap(items);
    // All three items belong to one paragraph; text is 'a b'.
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 3, text: 'a b' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(splitItemsByGap([])).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const items = [make('a', 700), make('b', 680)];  // gap 20
    expect(splitItemsByGap(items, 10)).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 1, text: 'a' },
      { startIdx: 1, endIdx: 2, text: 'b' },
    ]);
    expect(splitItemsByGap(items, 25)).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'a b' },
    ]);
  });

  it('drops paragraphs that contain only empty items', () => {
    const items = [make('', 700), make('', 686), make('b', 650)];
    const ranges = splitItemsByGap(items);
    // First two items produce no text before the gap, so nothing flushes.
    // After the gap, the empty-run and 'b' form the second range.
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 2, endIdx: 3, text: 'b' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/pdf-items.test.ts
```

Expected: FAIL — `splitItemsByGap` not defined.

- [ ] **Step 3: Write minimal implementation**

Create `chrome-extension/reader/lib/pdf-items.ts`:

```typescript
import type { TextItemLike } from './pdf';
import { PARAGRAPH_GAP_THRESHOLD } from './pdf';

export interface ItemRange {
  /** Inclusive index of the first text item belonging to this paragraph. */
  startIdx: number;
  /** Exclusive end: `items.slice(startIdx, endIdx)` yields this paragraph's items. */
  endIdx: number;
  /** Normalized concatenated text of all non-empty items in the range. */
  text: string;
}

/**
 * Mirror of `splitParagraphsByGap` but preserves item-index ranges so
 * pdfjs-produced text-layer spans can be tagged with `data-pid` later.
 *
 * Invariants:
 * - Ranges are contiguous in item space (no items are dropped; every index
 *   in [0, items.length) belongs to exactly one range, EXCEPT leading empty
 *   items before the first non-empty contribution may be absorbed into the
 *   next paragraph's range).
 * - Ranges with text === '' are filtered out of the returned array.
 */
export function splitItemsByGap(
  items: TextItemLike[],
  threshold = PARAGRAPH_GAP_THRESHOLD,
): ItemRange[] {
  const out: ItemRange[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let lastY: number | null = null;

  const flush = (endIdx: number) => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ startIdx: currentStart, endIdx, text });
    current = [];
    currentStart = endIdx;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.str) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(lastY - y) > threshold) {
      flush(i);
    }
    current.push(item.str);
    lastY = y;
  }
  flush(items.length);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/lib/pdf-items.test.ts
```

Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/pdf-items.ts chrome-extension/tests/lib/pdf-items.test.ts
git commit -m "feat(ext): splitItemsByGap — paragraph ranges preserve item indices (TDD)"
```

---

## Task 2: `parsePdf` returns `doc` + per-page item ranges

**Files:**
- Modify: `chrome-extension/reader/lib/pdf.ts`
- Modify: `chrome-extension/tests/lib/pdf.test.ts`

**Rationale:** Rendering needs the `PDFDocumentProxy` handle (pdfjs uses it for per-page rendering) and the item-range structure (so we can map spans → paragraphs). `parsePdf` currently drops both after extracting text.

### Step 1: Write failing test

Append to `chrome-extension/tests/lib/pdf.test.ts`:

```typescript
describe('parsePdf runtime handles', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('returns pdfDoc with same numPages as the parsed result', async () => {
    const result = await parsePdf(buf);
    expect(result.doc).toBeDefined();
    expect(result.doc.numPages).toBe(result.parsed.numPages);
  });

  it('returns pageItemRanges length equal to numPages', async () => {
    const result = await parsePdf(buf);
    expect(result.pageItemRanges).toHaveLength(result.parsed.numPages);
  });

  it('pageItemRanges cover the same total paragraph count as parsed.paragraphs', async () => {
    const result = await parsePdf(buf);
    const totalRanges = result.pageItemRanges.reduce((sum, page) => sum + page.length, 0);
    expect(totalRanges).toBe(result.parsed.paragraphs.length);
  });

  it('pageItemRanges[i] ranges are ordered and non-overlapping', async () => {
    const result = await parsePdf(buf);
    for (const pageRanges of result.pageItemRanges) {
      for (let i = 1; i < pageRanges.length; i++) {
        expect(pageRanges[i].startIdx).toBeGreaterThanOrEqual(pageRanges[i - 1].endIdx);
      }
    }
  });
});
```

And update the existing `parsePdf` tests (which currently do `const parsed = await parsePdf(buf)` expecting a flat `ParsedPdf`) to read from `result.parsed`:

```typescript
describe('parsePdf', () => {
  let buf: ArrayBuffer;
  beforeAll(() => { /* unchanged */ });

  it('extracts numPages', async () => {
    const { parsed } = await parsePdf(buf);
    expect(parsed.numPages).toBeGreaterThan(0);
  });

  it('emits at least one paragraph', async () => {
    const { parsed } = await parsePdf(buf);
    expect(parsed.paragraphs.length).toBeGreaterThan(0);
    expect(parsed.paragraphs[0].text.length).toBeGreaterThan(0);
  });

  it('produces per-page outline (Page N labels) with page field set', async () => {
    const { parsed } = await parsePdf(buf);
    expect(parsed.outline).toHaveLength(parsed.numPages);
    expect(parsed.outline[0]).toMatchObject({ label: 'Page 1', level: 0, page: 1 });
    expect(parsed.outline.every((o) => o.level === 0 && o.page)).toBe(true);
  });

  it('assigns paragraphs to their source page via sectionId', async () => {
    const { parsed } = await parsePdf(buf);
    const outlineIds = new Set(parsed.outline.map((o) => o.id));
    for (const p of parsed.paragraphs) {
      expect(outlineIds.has(p.sectionId)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the suite fails**

```bash
npm test -- tests/lib/pdf.test.ts
```

Expected: FAIL — existing tests fail because `parsePdf` currently returns `ParsedPdf` (not `{ parsed, doc, pageItemRanges }`), and the new runtime-handle tests reference undefined fields.

- [ ] **Step 3: Update `parsePdf` to return `{ parsed, doc, pageItemRanges }`**

Open `chrome-extension/reader/lib/pdf.ts`. Near the top, add the import and new types:

```typescript
import { splitItemsByGap, type ItemRange } from './pdf-items';
```

Rename the old return interface to match its new role and add the new top-level shape:

```typescript
/** Serializable parse output — the data that lives on Paper. */
export interface ParsedPdf {
  numPages: number;
  title: string;
  authors: string[];
  outline: OutlineItem[];
  paragraphs: Paragraph[];
}

/** Runtime handles the renderer needs but storage never persists. */
export interface ParsePdfResult {
  parsed: ParsedPdf;
  /** Live pdfjs document handle; caller is responsible for `doc.destroy()`. */
  doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy;
  /** `pageItemRanges[i]` lists paragraph ranges on the (i+1)-th page, in document order. */
  pageItemRanges: ItemRange[][];
}
```

Rewrite the `parsePdf` body to keep the doc alive and collect per-page ranges:

```typescript
export async function parsePdf(data: ArrayBuffer): Promise<ParsePdfResult> {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const numPages = doc.numPages;

  const meta = await doc.getMetadata().catch(() => null);
  const title = ((meta?.info as any)?.Title as string | undefined)?.trim() ?? 'Untitled PDF';
  const authorRaw = ((meta?.info as any)?.Author as string | undefined) ?? '';
  const authors = authorRaw ? authorRaw.split(/[,;]\s*/).filter(Boolean) : [];

  const outline: OutlineItem[] = Array.from({ length: numPages }, (_, i) => ({
    id: `o${i}`,
    label: `Page ${i + 1}`,
    level: 0,
    page: i + 1,
  }));

  const raw: RawParagraph[] = [];
  const pageItemRanges: ItemRange[][] = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const outlineItemId = outline[pageNum - 1].id;

    const items = (content.items as any[])
      .filter((it) => 'str' in it)
      .map((it): TextItemLike => ({ str: it.str, transform: it.transform }));

    const ranges = splitItemsByGap(items);
    pageItemRanges.push(ranges);
    for (const r of ranges) {
      raw.push({ outlineItemId, text: r.text });
    }
  }

  const paragraphs = buildParagraphs(raw, outline);
  const parsed: ParsedPdf = { numPages, title, authors, outline, paragraphs };
  return { parsed, doc, pageItemRanges };
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npm test -- tests/lib/pdf.test.ts
```

Expected: all 9 existing tests + 4 new runtime-handle tests pass.

- [ ] **Step 5: Run full test suite to catch other consumers**

```bash
npm test
```

Expected: 156 tests pass (152 pre + 4 new). If tests outside `pdf.test.ts` regress, it means another file imports `parsePdf` and needs updating — fix them in Task 3 (below).

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/pdf.ts chrome-extension/tests/lib/pdf.test.ts
git commit -m "feat(ext): parsePdf returns { parsed, doc, pageItemRanges } for runtime rendering"
```

---

## Task 3: `PdfRuntime` type + `loadPdfPath` wiring

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/main.tsx`

**Rationale:** `Paper` is serialized to `chrome.storage.local`; it cannot hold a `PDFDocumentProxy`. Introduce a sibling runtime state passed through React (never persisted).

### Step 1: Add `PdfRuntime` to types.ts

Open `chrome-extension/reader/types.ts`. Append at the bottom:

```typescript
/**
 * Runtime-only PDF rendering handles. Held in React state, NEVER persisted.
 * `doc` is a live pdfjs document; `pageItemRanges[i]` is the paragraph
 * item-index ranges for the (i+1)-th page (see `lib/pdf-items.ts`).
 */
export interface PdfRuntime {
  doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy;
  pageItemRanges: import('./lib/pdf-items').ItemRange[][];
}
```

### Step 2: Update `loadPaper` and `loadPdfPath` to return pdfRuntime

Open `chrome-extension/reader/main.tsx`. Current `loadPdfPath` (lines 91–129) returns `Promise<Paper>`. Change the return type so the caller also receives the runtime handles.

Define a new return type right above `loadPaper`:

```typescript
interface LoadedPaper {
  paper: Paper;
  pdfRuntime: PdfRuntime | null;
}
```

Add the import for `PdfRuntime`:

```typescript
import type { AiConfig, Paper, PdfRuntime, /* ... existing */ } from './types';
```

Change `loadPaper`'s signature:

```typescript
async function loadPaper(src: string): Promise<LoadedPaper> {
```

At each return statement inside `loadPaper` and `loadPdfPath`, wrap the Paper:

- For the arXiv-success branch (current line 76 `return result.paper;`) → `return { paper: result.paper, pdfRuntime: null };`
- For the fallback-pdf branch (current line 79) → `return loadPdfPath(...)` — the inner call now returns `LoadedPaper` too.
- For the final fallthrough (current line 84) → `return loadPdfPath(src, undefined);`

In `loadPdfPath`, destructure the parsePdf result:

```typescript
async function loadPdfPath(pdfUrl: string, arxivId: string | undefined): Promise<LoadedPaper> {
  let buf: ArrayBuffer;
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = await res.arrayBuffer();
  } catch {
    const proxyRes = await chrome.runtime.sendMessage({ kind: 'pdf-proxy-fetch', url: pdfUrl });
    if (proxyRes?.kind !== 'ok') throw new Error(proxyRes?.message ?? 'SW proxy failed');
    const bin = atob(proxyRes.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buf = bytes.buffer;
  }

  const { parsed, doc, pageItemRanges } = await parsePdf(buf);
  const hash = await urlHash(pdfUrl);
  const key = arxivId ?? hash;
  const filename = pdfUrl.split('/').pop()?.split('?')[0] ?? '';
  const venue = filename ? `PDF · ${filename}` : undefined;

  const paper: Paper = {
    id: arxivId,
    urlHash: hash,
    title: parsed.title,
    authors: parsed.authors,
    abstract: '',
    venue,
    outline: parsed.outline,
    paragraphs: parsed.paragraphs,
    memory: emptyMemory(),
  };
  await setCachedParsed(key, {
    title: paper.title, authors: paper.authors, abstract: paper.abstract,
    venue: paper.venue, outline: paper.outline, paragraphs: paper.paragraphs,
  });
  if (!(await getMemory(key))) await setMemory(key, emptyMemory());

  return { paper, pdfRuntime: { doc, pageItemRanges } };
}
```

### Step 3: ViewerApp holds `pdfRuntime` state

Inside `ViewerApp` (the React component), add state:

```typescript
const [pdfRuntime, setPdfRuntime] = useState<PdfRuntime | null>(null);
```

Find where `loadPaper` is called (it's inside an effect that hydrates `paper`). Replace the destructure:

```typescript
// existing: const paper = await loadPaper(src);
const loaded = await loadPaper(src);
if (cancelled) return;
setPaper(loaded.paper);
setPdfRuntime(loaded.pdfRuntime);
```

Add a cleanup effect to `doc.destroy()` when unmounting or swapping papers:

```typescript
useEffect(() => {
  return () => { pdfRuntime?.doc.destroy(); };
}, [pdfRuntime]);
```

### Step 4: Cached-PDF re-hydrate case

When a PDF's parsed data is in cache (re-visit), we still need a live pdfDoc for rendering but we can skip parsing. Two options:

1. **Re-fetch and re-parse** on every open (simplest). The cost is one extra parse per open; mitigated because `parsePdf` is already doing the network + decode.
2. **Skip cache for PDFs entirely** (i.e. always re-fetch).

Pick option 1 — least code surface. The cached `paragraphs` / `outline` are still authoritative; when the cache hits, we still call `parsePdf` to get `doc` + `pageItemRanges` but can short-circuit if the cached metadata matches.

For Phase 6, simpler: always call `parsePdf` on PDF opens. Skip the `getCachedParsed` early-return for PDF URLs. Update `loadPdfPath` preamble to just parse.

The existing code already calls `parsePdf` on every open (it doesn't short-circuit on cache). Good — no change needed beyond the fields returned.

### Step 5: Run typecheck + tests

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
npm test
```

Expected: exit 0; 156 tests pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts chrome-extension/reader/main.tsx
git commit -m "feat(ext): PdfRuntime state — hold pdfDoc and pageItemRanges for rendering"
```

---

## Task 4: New `PdfPage` component — canvas + pdfjs `TextLayer`

**Files:**
- Create: `chrome-extension/reader/components/pdf-page.tsx`

**Rationale:** Encapsulate per-page rendering: a `<canvas>` drawn via `page.render()`, a sibling `<div class="pf-pdf-text-layer">` populated by pdfjs's `TextLayer` class, with each span tagged `data-pid` so selection / highlight / scroll-spy / margin-anchoring keep working.

### Step 1: Implement the component

Create `chrome-extension/reader/components/pdf-page.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ItemRange } from '../lib/pdf-items';

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;          // 1-based
  ranges: ItemRange[];         // paragraph ranges for this page
  paragraphIds: string[];      // sec{n}-p{m}, same length as ranges, in document order
  scale?: number;              // default 1.25 — readable at 960px wide viewport
}

/**
 * Renders one PDF page. Skeleton mounts with known dimensions from
 * `page.getViewport()`. An IntersectionObserver triggers the actual
 * `page.render()` + TextLayer hydration when the skeleton enters viewport ±1.
 *
 * After render:
 * - `<canvas>` holds the raster image.
 * - `<div class="pf-pdf-text-layer">` holds pdfjs's <span>s, each tagged
 *   with `data-pid` matching the paragraph it belongs to.
 */
export function PdfPage({ doc, pageNumber, ranges, paragraphIds, scale = 1.25 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [rendered, setRendered] = useState(false);

  // Eagerly fetch page dimensions so the skeleton has correct height (prevents
  // layout jank as pages lazily fill in).
  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((page: PDFPageProxy) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setDims({ width: viewport.width, height: viewport.height });
    });
    return () => { cancelled = true; };
  }, [doc, pageNumber, scale]);

  // IntersectionObserver: render when the skeleton is within viewport ±1 page.
  useEffect(() => {
    if (!rootRef.current || rendered) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRendered(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '200% 0px' },   // trigger when within 2 viewport heights
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [rendered]);

  // Actual render + text layer hydration. Runs when `rendered` flips true.
  useEffect(() => {
    if (!rendered || !dims || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let textLayer: InstanceType<typeof TextLayer> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.scale(dpr, dpr);

      await page.render({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;

      const container = textLayerRef.current!;
      container.innerHTML = '';
      const textContent = await page.getTextContent();
      if (cancelled) return;

      textLayer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;

      // Tag each span with data-pid based on its item index.
      const spans = textLayer.textDivs;
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const rangeIdx = ranges.findIndex((r) => i >= r.startIdx && i < r.endIdx);
        if (rangeIdx !== -1) span.setAttribute('data-pid', paragraphIds[rangeIdx]);
      }
    })();

    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [rendered, dims, doc, pageNumber, scale, ranges, paragraphIds]);

  return (
    <div
      ref={rootRef}
      className="pf-pdf-page"
      data-page={pageNumber}
      style={{
        position: 'relative',
        width: dims?.width,
        height: dims?.height,
        margin: '0 auto 16px',
        background: 'var(--paper)',
      }}
    >
      <canvas ref={canvasRef} className="pf-pdf-canvas" />
      <div
        ref={textLayerRef}
        className="pf-pdf-text-layer textLayer"
      />
    </div>
  );
}
```

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0. If pdfjs types complain about `PDFPageProxy` or the TextLayer import path, import type from the package index instead:

```typescript
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
```

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/pdf-page.tsx
git commit -m "feat(ext): PdfPage component — canvas + pdfjs TextLayer with data-pid tagging"
```

---

## Task 5: `PaperPage` branches on pdfRuntime → render `<PdfPage>` list

**Files:**
- Modify: `chrome-extension/reader/components/paper-page.tsx`
- Modify: `chrome-extension/reader/main.tsx` (pass pdfRuntime down)

**Rationale:** With Task 4 in place, wire the new component into the reader. HTML-origin papers keep the current renderer.

### Step 1: Extend PaperPage props

Open `chrome-extension/reader/components/paper-page.tsx`. Update the `Props` interface and imports:

```typescript
import { CSSProperties, MouseEvent, useRef } from 'react';
import type { Paper, Highlight, Paragraph, TextSelection, PdfRuntime } from '../types';
import { PdfPage } from './pdf-page';

interface Props {
  paper: Paper;
  highlights: Highlight[];
  onSelect: (sel: TextSelection | null) => void;
  font: 'serif' | 'sans';
  pdfRuntime?: PdfRuntime | null;
}
```

### Step 2: Branch inside the render

Replace the current return with a branch. Locate the closing `</div>` of `PaperPage` and wrap the body:

```tsx
  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} style={{ position: 'relative' }}>
      {/* Title block */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        {/* ... existing title block unchanged ... */}
      </div>

      {/* Abstract — only render if non-empty (PDF mode leaves abstract = '') */}
      {paper.abstract && (
        /* ... existing abstract unchanged ... */
      )}

      {pdfRuntime
        ? renderPdfBody(paper, pdfRuntime)
        : renderBody(paper, highlights, bodyFont)}
    </div>
  );
}
```

Add the new helper at the bottom of the file:

```tsx
function renderPdfBody(paper: Paper, runtime: PdfRuntime) {
  // Group paragraphs by source page via outline[].page (PDF mode: 1-based).
  const pageToParaIds: string[][] = runtime.pageItemRanges.map(() => []);
  const outlinePageById = new Map(paper.outline.map((o) => [o.id, o.page]));
  for (const p of paper.paragraphs) {
    const page = outlinePageById.get(p.sectionId);
    if (!page) continue;
    pageToParaIds[page - 1].push(p.id);
  }
  return runtime.pageItemRanges.map((ranges, pageIdx) => (
    <PdfPage
      key={pageIdx}
      doc={runtime.doc}
      pageNumber={pageIdx + 1}
      ranges={ranges}
      paragraphIds={pageToParaIds[pageIdx]}
    />
  ));
}
```

### Step 3: Thread pdfRuntime from main.tsx

Open `chrome-extension/reader/main.tsx`. Find where `<PaperPage />` is rendered (search for `PaperPage` JSX uses). Pass the prop:

```tsx
<PaperPage
  paper={effectivePaper}
  highlights={highlights}
  onSelect={setSelection}
  font={tweaks.readerFont}
  pdfRuntime={pdfRuntime}
/>
```

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. No test regressions (no test imports PaperPage directly).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/paper-page.tsx chrome-extension/reader/main.tsx
git commit -m "feat(ext): PaperPage renders PdfPage list when pdfRuntime is present"
```

---

## Task 6: CSS — `.pf-pdf-page` / `.pf-pdf-text-layer` + theme invert

**Files:**
- Modify: `chrome-extension/reader/styles/tokens.css`

**Rationale:** PDF canvas renders on a white-paper assumption. In light theme we fold whites into `--paper` via `mix-blend-mode: multiply`; in dark theme we invert with hue-rotate so figures stay color-correct. The text layer itself must be invisible (transparent glyphs, real text for selection) but click-through must still work for canvas interactions like link clicks.

### Step 1: Append styles to tokens.css

Open `chrome-extension/reader/styles/tokens.css`. Append at the very end:

```css
/* ========================================================================
   PDF canvas + text-layer rendering (Phase 6)
   ======================================================================== */

.pf-pdf-page {
  /* Width/height come from inline style set by the component. */
  box-shadow: var(--shadow-1);
  border-radius: 3px;
  overflow: hidden;
  background: var(--paper);
}

.pf-pdf-canvas {
  display: block;
  mix-blend-mode: multiply;   /* Fold white paper into --paper in light mode */
}

[data-theme="dark"] .pf-pdf-canvas {
  mix-blend-mode: normal;
  filter: invert(1) hue-rotate(180deg);
}

/* pdfjs's own textLayer CSS uses transparent spans with selectable glyphs.
   Our wrapper needs to sit absolutely over the canvas. */
.pf-pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  line-height: 1;
  opacity: 1;
  /* Glyphs themselves are color: transparent so only the canvas shows. */
}
.pf-pdf-text-layer > span {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
}
.pf-pdf-text-layer > span::selection {
  background: color-mix(in oklch, var(--ink-highlight) 60%, transparent);
  color: transparent;
}

/* In dark mode, selections against the inverted canvas need a contrast-safe
   color. --ink-highlight flips to a dimmer olive (#8A7424) which reads fine. */
[data-theme="dark"] .pf-pdf-text-layer > span::selection {
  background: color-mix(in oklch, var(--ink-highlight) 70%, transparent);
}
```

### Step 2: Typecheck + build (CSS-only change; build validates Vite picks it up)

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/styles/tokens.css
git commit -m "feat(ext): PDF canvas + text-layer CSS — mix-blend-mode light / invert dark"
```

---

## Task 7: Highlight ping on PDF — reuse `paragraph-pinged`

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Rationale:** With Task 5, PDF spans carry `data-pid`. The existing `runAction('highlight', ...)` code already does `document.querySelector(\`[data-pid="${pid}"]\`).classList.add('paragraph-pinged')`. That query picks up the FIRST matching element — for PDF the first span in the paragraph range. The ping effect shows up on that span only; acceptable for v1 (the ping is a 900 ms cue, not a permanent marker). No code change needed to make this work — this task is verification only.

### Step 1: Verify the ping path handles multiple spans acceptably

Open `chrome-extension/reader/main.tsx`. Locate the highlight branch (around `runAction` `if (kind === 'highlight')`). Confirm:

- `setHighlights(next)` persists to storage (works unchanged).
- `syncLibraryRow(effectivePaper, pages).catch(() => {})` still fires (works unchanged).
- The `document.querySelector('[data-pid=…]')` only pings the first matching span. For PDF this is acceptable as a "something happened" cue. No spec requirement says ping covers the full paragraph.

### Step 2: Reject highlights on rich ar5iv blocks AND PDF — unified toast

Currently `main.tsx:runAction` rejects only `abs`:

```typescript
if (sel.paragraphId === 'abs') { setToast("Highlights on the abstract aren't supported yet."); return; }
```

PDF highlights DO work (spans carry `data-pid`, ping fires, storage persists) — the only missing piece is visual yellow paint. That's OK for Phase 6; we persist and ping but don't paint. Do NOT reject PDF highlights.

**No code change required for this task beyond what Task 5 already wired.** Move on.

### Step 3: (Skip — nothing to commit for this task.)

*Verification-only task. If future code review wants an explicit test that the ping fires on PDF, add it under Task 13.*

---

## Task 8: TopBar page breadcrumb — scroll-based page inference (§3.4 / §9)

**Files:**
- Modify: `chrome-extension/reader/main.tsx`
- Modify: `chrome-extension/reader/components/top-bar.tsx`

**Rationale:** Spec §9 requires the TopBar breadcrumb to display `p. {current}/{total}` in PDF mode, computed from container scrollTop + page offsetTop (pdfjs library mode doesn't fire `pageNumber` events).

### Step 1: Compute current page in ViewerApp

Open `chrome-extension/reader/main.tsx`. Near the existing scroll-spy for OutlinePanel (grep for `readerScrollRef`), add or extend the scroll handler to compute PDF page.

```typescript
const [currentPdfPage, setCurrentPdfPage] = useState(1);

useEffect(() => {
  if (!pdfRuntime) { setCurrentPdfPage(1); return; }
  const container = readerScrollRef.current;
  if (!container) return;

  const onScroll = () => {
    const viewportMid = container.scrollTop + container.clientHeight / 2;
    const pages = Array.from(container.querySelectorAll<HTMLElement>('.pf-pdf-page'));
    const idx = pages.findIndex((p) => p.offsetTop + p.offsetHeight > viewportMid);
    const current = Math.max(0, idx) + 1;
    setCurrentPdfPage(current);
  };
  container.addEventListener('scroll', onScroll, { passive: true });
  onScroll();   // fire once on mount
  return () => container.removeEventListener('scroll', onScroll);
}, [pdfRuntime]);
```

### Step 2: Pass page info to TopBar

Find `<TopBar …>` JSX and pass:

```tsx
<TopBar
  /* existing props */
  pageLabel={pdfRuntime
    ? `p. ${currentPdfPage}/${pdfRuntime.doc.numPages}`
    : '—/—'}
/>
```

### Step 3: TopBar renders the label

Open `chrome-extension/reader/components/top-bar.tsx`. Add `pageLabel: string` to its props. Find the breadcrumb element (search for `paper.title`) and append:

```tsx
<span style={{
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-faded)',
  marginLeft: 8,
}}>{pageLabel}</span>
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
git add chrome-extension/reader/main.tsx chrome-extension/reader/components/top-bar.tsx
git commit -m "feat(ext): PDF page breadcrumb via scroll + offsetTop (spec §3.4, §9)"
```

---

## Task 9: TODO #11 — trust-boundary comment on `Paragraph.html`

**Files:**
- Modify: `chrome-extension/reader/types.ts`

**Rationale:** `Paragraph.html` flows into `dangerouslySetInnerHTML`. A future refactor could accidentally wire user input through it. A one-line comment on the type marks the invariant.

### Step 1: Edit the comment on `Paragraph.html`

Open `chrome-extension/reader/types.ts`. Find:

```typescript
export interface Paragraph {
  id: string;             // "sec{sectionIndex}-p{pInSection}"; matches data-pid
  sectionId: string;      // OutlineItem.id, deepest nested (not level-0)
  section: string;        // display, = deepest OutlineItem.label
  text: string;           // AI context always uses this (plain)
  html?: string;          // UI prefers this when present (enriched HTML fragment)
  important?: boolean;
}
```

Replace the `html` comment:

```typescript
  /**
   * UI prefers this when present (enriched HTML fragment). Rendered via
   * React's `dangerouslySetInnerHTML`. Populated ONLY by `parseArxivHtml`
   * from arxiv.org fetches. DO NOT set from user input or other sources —
   * doing so widens the XSS attack surface.
   */
  html?: string;
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
git add chrome-extension/reader/types.ts
git commit -m "docs(ext): trust-boundary comment on Paragraph.html (TODO #11)"
```

---

## Task 10: TODO #12 — `LoadResult.kind: 'ok-partial'` discriminator (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/reader/main.tsx`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Rationale:** The Phase 5 review flagged the implicit heuristic (`authors.length === 0 && !abstract`) for detecting partial Papers. Replace with an explicit discriminator so downstream code doesn't reverse-engineer authority from field emptiness.

### Step 1: Write failing test

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
describe('loadArxivPaper — discriminator', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response(apiFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('returns kind: ok when both HTML and API succeed', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok');
  });

  it('returns kind: ok-partial when HTML succeeds but API fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('rate limited', { status: 429 }));
    }) as any;
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok-partial');
    if (result.kind !== 'ok-partial') throw new Error();
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    expect(result.paper.authors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: FAIL — `kind` is `'ok'` for both cases (current behavior).

- [ ] **Step 3: Update `LoadResult` in `arxiv.ts`**

Open `chrome-extension/reader/lib/arxiv.ts`. Find:

```typescript
export type LoadResult =
  | { kind: 'ok'; paper: Paper }
  | { kind: 'fallback-pdf' }
  | { kind: 'error'; message: string };
```

Replace with:

```typescript
export type LoadResult =
  | { kind: 'ok'; paper: Paper }
  | { kind: 'ok-partial'; paper: Paper }     // HTML ok, API failed — authors/abstract empty
  | { kind: 'fallback-pdf' }
  | { kind: 'error'; message: string };
```

Update the API-fail branch in `loadArxivPaper`:

```typescript
  const paper: Paper = {
    id,
    urlHash: hash,
    title: extractHtmlTitle(htmlText),
    authors: [],
    abstract: '',
    venue: '',
    outline,
    paragraphs,
    memory: emptyMemory(),
  };
  return { kind: 'ok-partial', paper };
```

- [ ] **Step 4: Update `main.tsx` cache-skip logic**

Open `chrome-extension/reader/main.tsx`. Find the arXiv success branch (current Task 3 state):

```typescript
    if (result.kind === 'ok') {
      const pk = paperKey(result.paper);
      const isPartial = result.paper.authors.length === 0 && !result.paper.abstract;
      if (!isPartial) {
        await setCachedParsed(pk, { /* ... */ });
      }
      /* ... */
      return { paper: result.paper, pdfRuntime: null };
    }
```

Rewrite as two branches:

```typescript
    if (result.kind === 'ok') {
      const pk = paperKey(result.paper);
      await setCachedParsed(pk, {
        title: result.paper.title,
        authors: result.paper.authors,
        abstract: result.paper.abstract,
        venue: result.paper.venue,
        outline: result.paper.outline,
        paragraphs: result.paper.paragraphs,
      });
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return { paper: result.paper, pdfRuntime: null };
    }
    if (result.kind === 'ok-partial') {
      // Skip caching: next open retries the API.
      const pk = paperKey(result.paper);
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return { paper: result.paper, pdfRuntime: null };
    }
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all pass including the 2 new tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts chrome-extension/reader/main.tsx chrome-extension/tests/lib/arxiv.test.ts
git commit -m "refactor(ext): LoadResult.kind: 'ok-partial' explicit discriminator (TODO #12)"
```

---

## Task 11: TODO.md — defer visual PDF highlight paint

**Files:**
- Modify: `TODO.md`

**Rationale:** Phase 6 persists and pings PDF highlights but does not paint yellow over the canvas. Record the deferral.

### Step 1: Append entry

Open `TODO.md`. Append at the very end:

```markdown

13. **Visual PDF highlight paint — deferred from Phase 6.** Current PDF path: `H` persists to `chrome.storage.local.highlights` and pings the first paragraph span via the existing `paragraph-pinged` animation. Yellow paint over canvas text is NOT drawn. Approach for a later plan:
    - After pdfjs TextLayer renders, for each stored highlight, iterate text-layer spans for the matching `data-pid`, search the concatenated span text for `highlight.text`, compute a bounding box from the matching spans' `getBoundingClientRect()`, and draw a `<div class="pf-pdf-highlight-overlay">` absolute-positioned behind the text layer (z-index below spans, above canvas).
    - Related: TODO #10 (rich-block HTML highlight wrap). Both are "highlight fidelity" problems on non-text-node content; a single plan could close both.
```

### Step 2: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add TODO.md
git commit -m "docs: defer visual PDF highlight paint (TODO #13)"
```

---

## Task 12: Smoke test — load a PDF end-to-end in tests

**Files:**
- Create: `chrome-extension/tests/lib/pdf-runtime.test.ts`

**Rationale:** The parsePdf → ParsePdfResult round-trip is already covered in Task 2. This task verifies the combined contract that `pageItemRanges` and `paragraphs` are consistent enough for Task 5's `renderPdfBody` helper to work — specifically, that each paragraph's `sectionId` maps to an outline entry with a valid `page` field.

### Step 1: Write the test

Create `chrome-extension/tests/lib/pdf-runtime.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf } from '../../reader/lib/pdf';

describe('parsePdf runtime contract (for PdfPage render)', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('each paragraph maps to an outline entry with a page field', async () => {
    const { parsed } = await parsePdf(buf);
    const outlineById = new Map(parsed.outline.map((o) => [o.id, o]));
    for (const p of parsed.paragraphs) {
      const outline = outlineById.get(p.sectionId);
      expect(outline).toBeDefined();
      expect(outline!.page).toBeGreaterThan(0);
    }
  });

  it('per-page paragraph grouping matches pageItemRanges layout', async () => {
    const { parsed, pageItemRanges } = await parsePdf(buf);
    // Count paragraphs by page from outline mapping
    const outlineById = new Map(parsed.outline.map((o) => [o.id, o]));
    const countByPage = new Map<number, number>();
    for (const p of parsed.paragraphs) {
      const page = outlineById.get(p.sectionId)!.page!;
      countByPage.set(page, (countByPage.get(page) ?? 0) + 1);
    }
    // Compare to pageItemRanges
    for (let i = 0; i < pageItemRanges.length; i++) {
      const page = i + 1;
      expect(countByPage.get(page) ?? 0).toBe(pageItemRanges[i].length);
    }
  });
});
```

### Step 2: Run

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/pdf-runtime.test.ts
```

Expected: PASS.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/pdf-runtime.test.ts
git commit -m "test(ext): parsePdf runtime contract — paragraphs ↔ pageItemRanges consistency"
```

---

## Task 13: Final — full suite + typecheck + build + smoke

**Files:** none (verification only unless fixes required)

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected increments over Phase 5's 152:
- `pdf-items.test.ts`: +6 = 6
- `pdf.test.ts`: +4 (runtime handles) = 13
- `arxiv.test.ts`: +2 (discriminator) = 34
- `pdf-runtime.test.ts`: +2 = 2

Total: 152 + 14 = **~166**.

### Step 2: Typecheck + build

```bash
npm run typecheck
npm run build
```

Expected: exit 0 on both. `dist/` layout unchanged (reader + options + sw + content IIFE).

### Step 3: Manual Chrome smoke test

Load `dist/` via `chrome://extensions` → "Load unpacked". Then:

1. **arXiv HTML path (regression check):** visit `https://arxiv.org/html/2402.18413`. Reader loads, figures/tables render (Phase 5 regression gate).
2. **Native PDF path:** visit any PDF URL, e.g. `https://arxiv.org/pdf/2402.18413`. Reader loads. PDF pages render as canvas with real figures + equations visible.
3. **Dark mode:** toggle theme. Canvas inverts, figures stay color-coherent, text selection still readable.
4. **Selection in PDF:** click-drag a sentence inside a PDF page. SelectionToolbar appears. Press `E` → AI streams; result card anchors to the paragraph location (loc shows `p. {page} · §{Page N} · ¶ p{n}`).
5. **Highlight in PDF:** select text, press `H`. No error toast. Paragraph-pinged animation fires briefly on the first span. Reload page — highlight is persisted (no visible yellow yet — deferred per TODO #13).
6. **Breadcrumb:** scroll the PDF. TopBar breadcrumb updates `p. 3/18`, etc.
7. **Scroll-spy:** outline panel highlights the current page entry.
8. **Big PDF:** try a 30-page paper. Pages lazy-render (IntersectionObserver kicks in), no freeze.
9. **HTML-OK / API-fail:** block `export.arxiv.org` in devtools, reload an arXiv URL. Paper still loads with HTML-derived title. Next reload retries API and populates metadata.

### Step 4: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 6 automated verification complete (YYYY-MM-DD):
- `npm test` → ~166 passed across 9 files
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke (arXiv regression / native PDF canvas render / dark mode invert / selection + highlight + ping / breadcrumb scroll / big-PDF lazy render / HTML-OK-API-fail partial path) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-22-plan-phase-6-pdf-canvas.md
git commit -m "docs(plan): Phase 6 verification log"
```

---

## Phase 6 Done Criteria

- ✅ PDFs render as canvas + pdfjs TextLayer; figures / equations / tables stay visible
- ✅ TextLayer spans carry `data-pid="sec{n}-p{m}"` so selection / highlight / MarginColumn / scroll-spy keep working through the unchanged DOM contract
- ✅ Light theme: canvas `mix-blend-mode: multiply` folds whites into `--paper`
- ✅ Dark theme: canvas `filter: invert(1) hue-rotate(180deg)` keeps figures readable
- ✅ Lazy render via IntersectionObserver — pages beyond viewport ±2× don't block first paint
- ✅ TopBar breadcrumb shows `p. {current}/{total}` computed from scroll + offsetTop
- ✅ `Paragraph.html` type carries trust-boundary comment (TODO #11)
- ✅ `LoadResult.kind: 'ok-partial'` explicit discriminator (TODO #12)
- ✅ Deferred visual PDF highlight paint recorded as TODO #13
- ✅ All unit tests pass (~166); typecheck clean; build green

## Next: Plan 6.5 and Plan 7

**Plan 6.5 — Highlight fidelity on rich content (TODO #10 + #13):** deep-DOM highlight wrap inside ar5iv `.ltx-block` HTML AND overlay-rect highlight paint over PDF text-layer. Both are "highlight on non-text-node content" problems; shared architecture for span-search + bounding-box computation. Estimated 6–8 tasks.

**Plan 7 — Canvas mode (spec §8.3):** `react-flow` + `dagre` for node-graph view of paper + outline + margin notes + linked papers. Node drag persistence to `paper:{key}:canvas`. Chat node as static preview of latest exchange. Estimated 10–14 tasks.

**Plan 8 — Polish (TODO #7, #8, #9):** quota error contract + test, rich-block AI citation prettification. Small bundled polish plan.

---

## Verification log

Phase 6 automated verification complete (2026-04-22):
- `npm test` → **164 passed** across 10 test files (Phase 5 baseline 152 → +12 net: +9 pdf-items edge + ranges + 4 runtime handles − 5 deleted splitParagraphsByGap + 2 discriminator + 2 runtime contract = +12)
- `npm run typecheck` → exit 0
- `npm run build` → green (reader + options + sw + content-IIFE all emit)
- Manual Chrome smoke test (arXiv regression / native PDF canvas render / dark mode invert / selection + highlight + ping / TopBar breadcrumb / lazy render / HTML-OK-API-fail `ok-partial` path) — deferred to user.
- Known Phase 6 polish candidates (documented during reviews, deferred):
  - Scroll-spy `paper.paragraphs.find` is O(n) per scroll event; fine at current test scale, monitor on 30+ page papers.
  - Outline-click scroll-to-page works for rendered pages; far pages (beyond IntersectionObserver rootMargin) will resolve via `[data-pid]` after the page renders — watch for first-time jank.
