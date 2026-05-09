# Phase 6 PDF Canvas + Text-Layer — Implementation Review

Date: 2026-04-22
Plan: `docs/plans/2026-04-22-plan-phase-6-pdf-canvas.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `2d8937e` (plan commit, pre-implementation)
Head SHA: `5631ab2` (post-verification scroll-spy + outline polish)

## Summary

Phase 6 is a clean, well-scoped implementation: canvas + `TextLayer` PDF rendering with the `data-pid` contract preserved, item-index alignment tightened to match pdfjs's own filter, lifecycle cleanup handled across three failure modes (parse-throw, Boot cancel-before-ready, ViewerApp unmount), and the O(n*m) span tagging collapsed to a monotonic walk. Tests 164 pass, typecheck clean, build green. One correctness bug around eager-`getPage` promise leakage and one cache leak (cached PDFs re-open as plain text) are worth fixing before merge; everything else is polish.

## Critical

- **`chrome-extension/reader/components/pdf-page.tsx:35-43`** — the "eager dims" effect calls `doc.getPage(pageNumber).then(...)` but never attaches `.catch` and has no guard against `doc` being destroyed. When `pdfRuntime` swaps (new paper load), ViewerApp's `useEffect(() => () => pdfRuntime?.doc.destroy(), [pdfRuntime])` cleanup runs **before** the old tree's `PdfPage` unmounts, so the in-flight `getPage()` on the old doc rejects → unhandled rejection. Minimum fix: `.catch(() => {})`; better: propagate the `cancelled` flag as the render effect already does. The `getPage()` at line 72 is inside try/catch, so that path is safe.

## Important

- **`chrome-extension/reader/main.tsx:53-70` — cache-hit branch leaks PDFs into the HTML renderer.** `loadPaper` short-circuits on `getCachedParsed` and returns `pdfRuntime: null`, so a cached PDF paper re-opens without canvas and shows as plain text paragraphs. Plan Task 3 Step 4 explicitly chose "PDFs always re-parse," but the cache hit occurs **before** `loadPdfPath` is reached, bypassing that rule. Fix options:
  - Detect PDF origin heuristically: `!paper.abstract && paper.outline.every(o => o.label.startsWith('Page '))` → call `loadPdfPath(src, …)` instead of returning from cache
  - Cleaner: add an `originKind: 'html' | 'pdf'` field on the cached record so the routing is explicit
- **`chrome-extension/reader/components/pdf-page.tsx:64-129` — future-zoom effect rebuild.** Effect deps `[rendered, dims, doc, pageNumber, scale, ranges, paragraphIds]`; `scale` is a literal default today, but once a zoom control lands, any `scale` change tears down the entire canvas + TextLayer and rebuilds. Add a comment or key re-render off a dedicated dirty flag. Not blocking.
- **`chrome-extension/reader/components/pdf-page.tsx:111-116` — span/item alignment is an implicit contract with pdfjs.** `textLayer.textDivs.length` must equal `textContent.items.filter(typeof str === 'string').length`, and the order must match. Today the filter in `pdf.ts:81` matches the `PdfPage` walk (aligned by commit `5631ab2`), but a future pdfjs upgrade could silently drift — `data-pid` wanders by one item. Add a dev-mode assertion: `if (spans.length !== totalNonEmptyItems) console.warn(...)`.
- **`chrome-extension/reader/main.tsx:498-524` — PDF scroll-spy re-queries the DOM on every scroll event.** 60ms debounce runs `querySelectorAll('.pf-pdf-page')` + array allocation every compute. On 30 pages it's tolerable; 50+ pages likely show jank. Cache the page element list + their `offsetTop` in a ref keyed on `pdfRuntime`. Already tracked in the plan's "Known polish" list.

## Minor

- `chrome-extension/reader/lib/pdf.ts:94-97` — `doc.destroy().catch(() => {})` silently swallows failures. Consider `console.debug` for diagnosis.
- `chrome-extension/reader/main.tsx:533-548` — PDF highlight ping fires on the **first** span only (`querySelector`, not `querySelectorAll`). Plan Task 7 accepted this for v1; add a short code comment near the `querySelector` call so the choice is visible in-context.
- `chrome-extension/reader/components/pdf-page.tsx:155-166` — error overlay renders raw error string (`Failed to render page ${pageNumber}: ${error}`). Harmless but off-brand for the warm-paper palette.
- `chrome-extension/reader/styles/tokens.css:358-379` — `.pf-pdf-text-layer > span::selection` uses `color: transparent` deliberately (glyphs stay invisible, only the selection rectangle shows). The plan explains why; the CSS itself should have a one-line comment so a future edit doesn't "fix" this incorrectly.
- `chrome-extension/reader/lib/pdf-items.ts:54-56` — the leading-empty-absorb mechanism advances `currentStart`, but the top-of-file docstring still says empties are "dropped." Tighten the wording.
- `chrome-extension/reader/components/pdf-page.tsx:2-3` — two imports from `'pdfjs-dist/legacy/build/pdf.mjs'` (types + value). Consistent with `pdf.ts`; minor grouping nit.

## Strengths

- **TDD visible across the commit history:** test → impl → pass for every non-trivial change.
- **Lifecycle correctness is thorough:** three destroy owners (parse-throw in `pdf.ts`, Boot-cancel, ViewerApp-unmount) with clear in-code comments.
- **pdfjs item-filter alignment** (`typeof it.str === 'string'`) is duplicated with a load-bearing docstring in `pdf.ts` — exactly the defensive coding this boundary needs, and it matches the `PdfPage` monotonic pointer walk.
- **IntersectionObserver one-shot pattern** (disconnect after fire, no re-observe) is appropriate and documented.
- **Test coverage hits edge cases:** empty input, single item, all-empty paragraphs, whitespace-only, custom threshold, and full `parsePdf` runtime contract (paragraphs ↔ `pageItemRanges` consistency).
- **`pageToParaIds` memoized in `paper-page.tsx:49-59`** with the exact right explanatory comment ("otherwise PdfPage's render effect tears down and re-runs") — right level of detail.
- **Spec §9 breadcrumb** matches the spec code block essentially verbatim, with one genuine improvement: clamp-to-last-page on `findIndex === -1` (scroll-past-end case the spec didn't cover).
- **Outline-click scroll** prefers `data-page` over `data-pid`, correctly handling "far page not yet rendered" — the skeleton has known dimensions from Step 1 of `PdfPage`, so `scrollIntoView` works before the canvas renders.

## Assessment

**Needs fixes** — Critical (`.catch` or `cancelled` guard on eager `getPage`) + Important #1 (cached PDF re-open via `loadPdfPath`) are small localized edits that should land before merge. The other Important items and all Minors can ride into Plan 6.5 / Plan 7.

## Follow-ups for later plans

1. **Critical fix:** `.catch` or `cancelled` guard on `PdfPage` eager-dims `getPage`.
2. **Important fix:** cached PDF origin detection in `loadPaper` (or `originKind` field on cache).
3. Future-zoom effect rebuild — dirty flag or re-key.
4. pdfjs span/item dev-mode alignment assertion.
5. Scroll-spy page-element cache for 50+ page papers.
6. PDF highlight ping code comment referencing plan Task 7.
7. `pdf-items.ts` leading-empty docstring tightening.
8. (Plan 6.5) Visual PDF highlight paint overlay — tracked as TODO #13; ties to TODO #10 (rich-block highlight wrap).
