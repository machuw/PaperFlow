# Phase 5 Polish + HTML Fidelity — Implementation Review

Date: 2026-04-22
Plan: `docs/plans/2026-04-22-plan-phase-5-polish-and-html-fidelity.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `845c867` (plan commit, pre-implementation)
Head SHA: `9793956` (Phase 5 review follow-ups doc)

## Summary

Phase 5 implements all 17 plan tasks cleanly. 151/151 tests pass, typecheck and build are green, and the three Plan 1 residuals (I3/I4/I5) are correctly closed. The AI-contract invariant (§3.7.1 — plain `.text` for AI, enriched `.html` UI-only) is preserved. Ready to merge after addressing one Important race condition and one silent-drop UX nit.

## Critical

None.

## Important

- **`chrome-extension/reader/main.tsx:362-382` — `onSummaryRefreshAll` races with the auto-trigger effect.** The refresh handler (a) clears the 3 summary cache keys, (b) sets all three section states to `idle`, then (c) immediately calls `fetchSection × 3`. Step (b)'s state change re-triggers the auto-trigger effect (deps include `summaryState`), which schedules 300ms dwell + 3s fallback timers. Step (c)'s `fetchSection` then flips state to `loading`, cancelling the timers. In practice the loading-state writes win, but any delay widens the window — a double-trigger would cause duplicate in-flight AI calls and double-debit the user's BYOK key. No test covers this path. Fix: add a ref guard to skip the trigger effect when the caller is `onSummaryRefreshAll`, or skip `idle` and drive straight to `loading` before calling `fetchSection`.

- **`chrome-extension/reader/main.tsx:461-475` — Abstract highlights are silently dropped.** Selecting text in the Abstract produces `paragraphId: 'abs'`; `addHighlight` stores it, but `renderBody` only iterates `paper.paragraphs` (no `abs` entry), so the yellow never paints. User sees a successful `H` press with no visible effect. Fix: either add a separate highlight pass on the Abstract block in `PaperPage`, or reject `H` on `abs` with `setToast('Highlights on the abstract aren't supported yet.')`.

## Minor

- **`chrome-extension/reader/lib/arxiv.ts:124-127`** — `rewriteImgSrc` silently swallows invalid-URL cases. A broken relative `src=` will then 404 in the extension origin. Add `console.debug('[PaperFlow] img rewrite skipped:', src)` for breadcrumbs.
- **`chrome-extension/reader/lib/arxiv.ts:116-134`** — `DOMParser` wrapper may normalize `<table>` (insert implicit `<tbody>`). Low risk in practice; a regression test for `<table>` structure through `rewriteImgSrc` would catch surprises.
- **`chrome-extension/reader/components/paper-page.tsx:122-135`** — rich-block branch drops `pHighlights` calculation. Matches plan + tracked as TODO #10. Add a code comment pointing to TODO #10 so future readers don't re-discover.
- **`chrome-extension/reader/styles/tokens.css:330-335`** — `.paper-body *` `color: inherit` has low specificity (0,1,1); a third-party `ltx_*` class with `!important` color would win. Optional: `!important` for defensiveness.
- **`chrome-extension/reader/main.tsx` scroll-spy with `data-pid="abs"`** — `paper.paragraphs.find(p => p.id === 'abs')` returns undefined, so `activeSectionId` doesn't update while Abstract is topmost. Outline has no "Abstract" entry, so this is acceptable; noted for completeness.
- **`chrome-extension/reader/lib/arxiv.ts:48-80`** — section-walk branch ordering is clean (`P` → `DIV.ltx_para` → block-capture); `FIGURE` inside the `P` branch is unreachable (figures aren't `<p>`). Not a bug — just worth noting for future refactors.
- **`docs/reviews/2026-04-22-review-dark-mode-audit.md`** — static audit claim ("no token leaks found") is well-supported by grep; "visual pass deferred to user" explicit. Acceptable as documented.

## Strengths

- **Plan-to-implementation alignment is tight.** Each commit maps to its task; the `244f28a` hardening commit for `rewriteImgSrc` adds a protocol allowlist + slash normalization with test coverage (`//cdn` protocol-relative, `javascript:` blocked, trailing-slash base, absolute passthrough).
- **AI-contract invariant preserved** — `reader/lib/ai.ts:24` `buildPaperContext` reads `p.text` only, never `p.html`. §3.7.1 honored.
- **Plan 1 residuals closed with targeted tests:** I3 `entryChildText` direct-child walk, I4 HTML-OK/API-fail fallback with `main.tsx` explicitly refusing to cache partials (next reload retries API), I5 SW `return false` on non-matching kinds.
- **`Paragraph.id` contiguity across mixed rich/plain content** is tested at `tests/lib/arxiv.test.ts:70-76` and in the end-to-end round-trip guard.
- **`data-pid` present on both `<p>` and `<div dangerouslySetInnerHTML>` branches in `PaperPage`,** so selection / highlight (plain path) / scroll-spy / MarginColumn anchoring keep working through the rich-block addition.
- **Storage-quota handler** is singleton-registered, cleaned up on unmount, toast wording verbatim with spec §10.
- **Dark-mode audit** used grep-based static checks to verify no hardcoded colors slipped in, with explicit scope listing + visual-pass deferral caveat.

## Assessment

**Ready** — merge after fixing the `onSummaryRefreshAll` race (or explicitly accepting with a TODO entry); Abstract-highlight silent-drop can merge with a one-line toast rejection.

## Follow-ups for Plan 6 / 7

1. **Fix Important:** `onSummaryRefreshAll` race — ref guard or skip idle state.
2. **Fix Important:** Abstract highlights — render on Abstract block or reject with toast.
3. `rewriteImgSrc` breadcrumb `console.debug`.
4. `<table>` structural passthrough regression test.
5. Rich-block highlight wrap (deep-DOM surgery) — tracked as TODO #10.
6. Code comment in `paper-page.tsx` pointing to TODO #10 for the richblock highlight gap.
