# Phase 9 Highlight Fidelity — Implementation Review

Date: 2026-04-23
Plan: `docs/plans/2026-04-22-plan-phase-9-highlight-fidelity.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `416513e` (plan commit, pre-implementation)
Head SHA: `8869393` (self-review: PDF multi-span highlight unification + dead code cleanup)

## Summary

Phase 9 is a well-scoped transition from the old `renderHighlighted` span-wrap to the **CSS Custom Highlight API**. The pure `findTextRanges` helper is clean and TDD-backed; the self-review commit `8869393` correctly fixes the PDF multi-span case by unifying scopes into one buffer. 202/202 tests pass, typecheck clean, build green. Two items worth resolving before merge: a spec-behavior drift around overlap painting (§3.4), and a stale test count in the verification log.

## Critical

None.

## Important

- **`chrome-extension/reader/lib/highlight-ranges.ts:115-128` — spec drift on overlap painting.** Spec §3.4 (line 84) says two highlights whose text overlaps but isn't identical (e.g. A="foo bar", B="bar baz") should cause B to be "silently ignored" so the overlap region doesn't double-paint. `addHighlight` in `storage.ts:133-142` only dedups by `paragraphId + text` exact equality, never by overlap. The old `renderHighlighted` accidentally enforced the spec (span-wrap used the first match, so B competed for the same slice and no-op'd). Custom Highlight API registers both A's Range AND B's Range against `'hl-yellow'` — the overlap region gets two painted rectangles, producing darker yellow. Two valid paths:
  - (a) **Update spec §3.4** to note that Custom Highlight API renders overlap as darker yellow — probably the right call, since users can't produce overlap without an explicit UI anyway.
  - (b) **Add overlap suppression** either in `registerPaperHighlights` (after collecting ranges, drop ranges intersecting an already-added range) or in `addHighlight` (reject B when B's text overlaps any existing A in the same paragraph).

- **`docs/plans/2026-04-22-plan-phase-9-highlight-fidelity.md:652-656` — verification log count is stale.** Log claims "198 passed" but the self-review commit `8869393` added 4 `registerPaperHighlights` tests; actual count is 202. The log was committed in `2173c87` before `8869393`. Update to 202 and mention the 4 added tests so a future reviewer doesn't mistake this for test regression.

## Minor

- **`docs/plans/2026-04-22-plan-phase-9-highlight-fidelity.md:584,637`** — plan phrasing "9 findTextRanges tests" is out of sync with the post-`8869393` state (13 tests). Cosmetic update.
- **`chrome-extension/reader/styles/tokens.css:216`** — `.hl-yellow` class is orphaned after Task 3 removed `renderHighlighted` (no `className="hl-yellow"` remains in `reader/`). Only `::highlight(hl-yellow)` references the palette. Either delete the `.hl-yellow` rule (and update the comment on lines 219-220 that claims palette consistency "matches `.hl-yellow`") or leave with a TODO annotation.
- **`chrome-extension/reader/main.tsx:563-568`** — ViewerApp cleanup calls `CSS.highlights.delete('hl-yellow')` on every re-register (including every `highlights` state update), producing a one-frame "unpainted → painted" flicker on highlight add. Cleaner: split into two effects — one keyed on `[paper.urlHash]` that delete-cleans only on paper swap / unmount, another keyed on `[highlights, effectivePaper]` that just overwrites the name (atomic in the API).
- **`chrome-extension/reader/lib/highlight-ranges.ts:83-94`** — `locate` does a linear scan of `entries`. For a 50-page PDF with thousands of concatenated text-layer spans × multiple highlights, this becomes O(h × r × e). Fast in practice; binary search on `entries[].start` would be trivial.
- **`chrome-extension/reader/main.tsx:425-431, 555-569`** — paper-swap race: when paper swaps A→B, registration runs once with A's in-memory highlights against B's DOM (`querySelectorAll('[data-pid]')` misses → `delete('hl-yellow')` correctly clears). Seed effect then fetches B's highlights and re-registers with correct paint. Correct by accident; add a one-line comment confirming the clear-first semantics are intentional so a future refactor doesn't break it silently.

## Strengths

- **Clean TDD:** `findTextRanges` has broad coverage (null, empty, cross-element, script/style skip, case-sensitive, boundary-at-start/end, null root). jsdom approach works because the helper uses only standard DOM APIs.
- **Self-review commit `8869393` correctly identified the PDF multi-span hole** and shipped a targeted fix: `collectEntries` + `rangesFromBuffer` shared helpers, with `findTextRanges` preserved as a single-root wrapper so existing tests stay valid. The new "unifies multiple same-paragraphId scopes" test at `tests/lib/highlight-ranges.test.ts:173-197` is exactly the right regression test.
- **ViewerApp-level single registration** correctly resolves the "multiple components setting the same global `'hl-yellow'` name" hazard the plan called out up front.
- **`pf-textlayer-ready` CustomEvent + `closest('[data-reader-scroll]')`** is a clean cross-cutting notification channel without prop drilling into PdfPage.
- **Abstract rejection, paper-swap cleanup, and BYOK flow** are all preserved — no collateral regressions.
- **Dark-mode coverage is automatic** via `--ink-highlight` theme-flip (noted in the plan).
- **Refactor to `RichBlock`** keeps the rich-block render presentational (no state/effects), cleanly decoupling paint from DOM shape.

## Assessment

**Ready** — merge after picking the overlap spec-update path (§3.4) and bumping the verification log count to 202. All other findings are cosmetic and can roll into the next maintenance pass.

## Follow-ups

1. **Fix Important:** pick (a) update spec §3.4 for overlap-as-darker-yellow, OR (b) add overlap suppression in `registerPaperHighlights` / `addHighlight`.
2. **Fix Important:** `docs/plans/2026-04-22-plan-phase-9-highlight-fidelity.md:652-656` — update test count to 202.
3. Plan phrasing "9 findTextRanges tests" → 13 (or split into "9 findTextRanges + 4 registerPaperHighlights").
4. `.hl-yellow` CSS class cleanup or annotate as palette reference.
5. Split ViewerApp effect into two (paper-swap cleanup vs. overwrite register) to eliminate the 1-frame flicker.
6. Binary search in `locate` (future optimization).
7. Comment on intentional clear-first semantics during paper-swap.
