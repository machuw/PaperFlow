# Phase 1 Implementation Review

**Reviewed:** 2026-04-21
**Branch:** `feat/phase-1-scaffolding`
**Range:** `1fdefe7..69d2f7f` (16 commits)
**Scope:** Phase 1 scaffolding + URL routing + content parsing. UI migration / AI / Library / Memory views deferred to Plans 2-5.

**Verdict: Ready to merge.** Phase 1 meets every "Done Criteria" in the plan, all 40 tests pass, build is green, and the acceptance path (dump `Paper` JSON) is verified. Important issues are real but are refinements Plan 2 will address anyway.

---

## Strengths

- **Plan fidelity is excellent.** Every file in the plan's File Map exists with the prescribed shape. Commits follow the 17-task breakdown one-to-one; TDD discipline is visible. `npm test` 40/40, `tsc --noEmit` clean, `npm run build` produces a loadable `dist/` with correct IIFE content script and ESM service worker.
- **Data model is verbatim §5.** `reader/types.ts` matches the spec line-for-line. The `Paragraph` contract (`id`, `sectionId`=deepest, `section`=deepest label) matches what the prototype's `paper-page.jsx:86-94` grouping and `[data-pid="…"]` lookup will consume in Phase 2. No Phase-2 corners painted.
- **Paragraph-id rule correct and well-tested.** `parse.ts` implements `sec{level-0-index}-p{pInLevel0}` with the hard case (continuous counter across `2.1 → 2.2`) covered in both `parse.test.ts` and `arxiv.test.ts` (real HTML yielding `sec1-p0/p1/p2`).
- **DNR rationale is thoughtful.** Fragment-based redirect (`#src=\0` not `?src=\0`) with the inline comment explaining query-param `&`-splitting prevents a real class of bugs in signed CDN PDF URLs. `excludedRequestDomains: ['arxiv.org']` correctly separates arxiv from generic-PDF rules. Dynamic `updateDynamicRules` at `onInstalled`/`onStartup` is the right approach (static `rules.json` can't embed `chrome-extension://{id}`).
- **Parser isolation is clean.** `splitParagraphsByGap` is extracted as a pure function with 5 unit tests; `parsePdf` is a thin orchestrator. The `Uint8Array` copy-before-pdfjs is a real fix for buffer-detachment, not defensive noise.
- **Architectural boundaries honored.** `chrome.*` is confined to reader (storage/messaging), SW (DNR + onMessage), content (runtime.getURL). No `chrome.storage` in content; no uncontrolled `fetch` paths.

---

## Issues

### Critical

None. Phase 1 builds, tests pass, and the Phase-1 contract (dump parsed JSON) is met.

### Important

**I1. arXiv HTML parser coverage is a single hand-crafted fixture.** `arxiv.ts:28-37`'s level heuristic ("has parent `section[id]`" → level 1, else level 0) hasn't been tested against real ar5iv output. The fixture hits only the happy path; it doesn't test sections without headings, sections deeper than 2 levels, or wrapper elements like `<article>`/`<div class="ltx_page_content">`. Phase 1 scope permits this, but the `Paper` shape Phase 1 writes to `paper:{key}:parsed` will be re-read by Phase 2. **Fix:** before Plan 2 starts, add a test fixture sampled from real ar5iv HTML to lock the contract.

**I2. `parseArxivHtml` drops paragraphs not direct children of `<section[id]>`.** `arxiv.ts:40-45` does `Array.from(sec.children).filter(c => c.tagName === 'P')`. Real ar5iv output wraps paragraphs in `<div class="ltx_para"><p>…</p></div>`, which this skips. Phase 1 scope permits this but add a `<div class="ltx_para">` test case (or a `section > p, section > .ltx_para > p` selector extension) to avoid invisible drift.

**I3. arXiv API `<title>` parse may pick up feed title on malformed responses.** `parseArxivApi` at `arxiv.ts:56` does `entry.querySelector('title')`. `querySelector` is scoped to `entry` so it should be fine in practice, but the test fixture doesn't include the feed-level `<title>` that a real API response carries right above `<entry>`. Low probability but add a realistic full-feed test to lock behavior.

**I4. `loadArxivPaper` fails the whole load if API fails while HTML is 200.** `arxiv.ts:91-93`: returns `{kind:'error'}` on any API non-2xx. Spec §3.2 doesn't specify this fallback behavior. Consider: in "HTML OK, API failed" case, return a Paper using title from HTML `<title>` and empty abstract. Either fix it or explicitly document the behavior in the spec as intentional.

**I5. SW PDF proxy message handler lacks explicit `return false` for non-matching branches.** `sw.ts:56-86`. Not a bug today (single listener), but Chrome logs warnings when multiple listeners exist and none returns true. Add `return false;` at the end of the listener for hygiene and to document the contract for future additions.

### Minor

- **M1.** `splitParagraphsByGap` uses `Math.abs(lastY - y) > threshold`. Correct today because `parsePdf` calls it per-page, but if a caller ever unions pages, `Math.abs` would wrongly join top-of-page-N+1 with bottom-of-page-N. Clarify with `(lastY - y) > threshold` and a comment on PDF Y-axis direction. (`pdf.ts:50`)
- **M2.** PDF title fallback is hardcoded `'Untitled PDF'` (`pdf.ts:71`). When metadata is missing (most wild PDFs), title reads "Untitled PDF" while venue correctly shows the filename. Consider filename-derived title fallback in Phase 2.
- **M3.** `main.tsx:117-121` uses manual `atob` + charCode loop for base64 → bytes. `Uint8Array.from(atob(x), c => c.charCodeAt(0))` is shorter and equivalent. Cosmetic.
- **M4.** `main.tsx:39-153` useEffect has no cancellation path. Phase 1 acceptable (page mounts once); flag for Phase 2 when streams/results appear.
- **M5.** `loadArxivPaper(id)` assumes `id` is pre-normalized. A future caller passing a URL would break silently. Consider `normalizeArxivId(id) ?? id` at entry.
- **M6.** `@types/chrome` pin `^0.0.260` in package.json but lockfile resolved `0.1.40` — `^0.0.260` shouldn't match `0.1.x`. Flag for next scaffold-hygiene pass.
- **M7.** `inject.ts` uses `absUrl.replace('/abs/', '/html/')`. Consider regex `/\/abs\/([^/?#]+)/, '/html/$1'` for robustness against weird mirror URLs.
- **M8.** `manifest.json` `web_accessible_resources.matches: <all_urls>` is overbroad. The actual need is narrower. Tighten in Plan 2/3 when threat model is concrete.
- **M9.** `vite.config.ts` uses `copyFileSync` for `options/index.html`. Works because it's static, but Plan 3 (BYOK form) will need to add `options` as a Vite `input:` entry instead. Note for future.
- **M10.** `tests/lib/storage.test.ts:69` uses `as any` cast on partial `ParsedCache`. Acknowledged in committed comment. Cleanest Phase-2 fix: fill missing fields or make `clearPaper` test use a minimal valid `ParsedCache`.

---

## Recommendations

1. **Before Plan 2:** add a real-arXiv-HTML fixture (`tests/fixtures/arxiv-html-real.html` from ar5iv) + a test asserting outline length > 0 and at least one `ltx_para`-wrapped `<p>` is extracted. Catches I1/I2 cheaply and locks the contract.
2. **Document Phase-1 parser limitations in the Plan 2 spec** so they aren't rediscovered when the Focus variant renders its first real paper: (a) `ltx_para` div-wrapping not traversed; (b) real pdfjs `getOutline()` not yet consumed; (c) multi-column layouts not respected; (d) API-only failure fails whole load.
3. **Optional Plan 3 security pass:** tighten `web_accessible_resources` matches.
4. **Leave the 558 KB reader bundle** — Phase 2 dynamic-imports pdfjs as part of UI split; no point double-working.

---

## Phase-2 Readiness

The data model + storage layer fully support Plan 2's UI needs. `Paragraph.id` matches the prototype's `data-pid` convention; `Paragraph.section` carries the label `paper-page.jsx` groups on; `PaperMemory` shape covers every field `chat-memory.jsx` reads; `ParsedCache` Pick-type hides mode-specific `id`/`urlHash`/`memory` correctly; key builders (`keys.notes/highlights/chat/canvas/summary`) are ready for Plans 2-5 to import.

No Phase-1 choice paints Phase 2 into a corner.

---

## Assessment

**Ready to merge: Yes.**

**Reasoning:** Phase 1 meets every "Done Criteria" in the plan, all 40 tests pass, build is green, and the acceptance path (dump `Paper` JSON) is verified. Important issues are real but out-of-scope for Phase 1's contract (spec §3.1 / §3.2 / §3.4 / §5) — refinements Plan 2's richer-HTML parsing will address anyway. Recommend merging now and opening a single follow-up ticket for the real-arXiv fixture (I1/I2) to block Plan 2 kickoff.
