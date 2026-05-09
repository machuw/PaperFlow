# Phase 3 AI Core — Implementation Review

Date: 2026-04-21
Plan: `docs/plans/2026-04-21-plan-phase-3-ai-core.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `37daf3c` (plan commit, pre-implementation)
Head SHA: `379561e` (Phase 3 verification log)

## Summary

Phase 3 is solid and ships the full AI-core happy path: 88 tests pass, typecheck clean, §3.7.1–3 contracts match the spec essentially word-for-word, persistence/abort semantics are right, and the Plan 2 carryovers (toolbar clamp, icon literal keys, variant split, storage write queue) are properly resolved.

Substantive issues: (1) a React-rules violation in `EditableField` (state update during render), (2) a divergence from §3.8 on where the BYOK error renders (floating banner instead of inline at anchor), (3) a stale-closure hazard in the keydown handler after the variant split, and (4) a StatusRail green dot on partial config. None block Plan 4 conceptually; (1) and (4) are cheap fixes worth landing before merge.

## Critical

- **`chrome-extension/reader/components/memory-view.tsx:153-155` — `EditableField` calls `setDraft(value)` in the render body** when `!editing && draft !== value`. This is a React rule violation; it works today because React short-circuits to a second render but triggers "Cannot update a component while rendering" warnings under StrictMode. Move the sync to `useEffect([value, editing])`, or replace with a canonical `key={paper.id + label}` remount pattern.

## Important

- **`chrome-extension/reader/main.tsx:502-518` vs spec §3.8 — BYOK error renders as a fixed-position banner** at `bottom: 64; left: 50%`, not at the target position (Focus margin-note slot / Classic SelectionResultCard slot) as §3.8 prescribes. `pendingError.paragraphId` is stored but never used for anchoring. Click-through to `chrome.runtime.openOptionsPage()` and foxglove tone are correct. Plan Task 20 explicitly chose the shortcut; track as a Plan 4 follow-up to replace with a real inline error node inside MarginColumn / SelectionResultCard.

- **`chrome-extension/reader/main.tsx:287` — keydown effect deps `[selection, outlineOpen]`** but the handler closes over `runAction`, which in turn captures `variant`, `effectivePaper`, `memoryOverlay`, `tab`. When any of those change between renders where `selection`/`outlineOpen` are stable, the installed handler references a stale `runAction`. Low-probability real-world failure, but violates the invariant that `runAction` always uses latest state. Either `useCallback`-memoize `runAction` with correct deps, or use a ref written every render and read in the handler.

- **`chrome-extension/reader/components/status-rail.tsx:37` — `configured = !!config?.apiKey`** treats apiKey-only as "configured" even if `baseURL` or `model` are empty. Options-page validation prevents this in normal flow, but direct storage writes bypass it. Cheap fix: `configured = !!(config?.apiKey && config?.baseURL && config?.model)`.

- **`chrome-extension/reader/lib/ai.ts:114-129` — eager-fetch-before-iterate** + `resPromise.catch(() => {})` pattern. The abort test in `tests/lib/ai.test.ts:251-263` passes because the mock `fetch` synchronously resolves with `[DONE]`; it does not verify AbortError actually propagates. Tighten the test (inject a never-resolving body so `abort()` actually produces a rejection), or document the trade-off in the function's doc comment.

## Minor

- `chrome-extension/reader/components/margin-column.tsx:86` — `document.querySelector('.margin-column-root')` is global; fragile if a future layout renders two MarginColumns. Use a ref.
- `chrome-extension/reader/components/selection-result-card.tsx:65` — Copy button uses `I.ArrowRight`; no real `Copy` icon in `icons.tsx` despite the Task 11 plan note. Add a real Copy glyph.
- `chrome-extension/reader/main.tsx:181` — `patchMemory` calls `paperKey(paper)` while every render path uses `effectivePaper`. Same key today, but swap for consistency.
- `chrome-extension/reader/main.tsx:502` — banner auto-dismiss uses bare `setTimeout(6500ms)` with no cleanup on unmount / re-error. React warns but it's not harmful; store timer id and clear.
- `chrome-extension/reader/components/margin-column.tsx:38` — `?? paper.paragraphs[0]` fallback is redundant: `findIntroParagraphs` already returns `paper.paragraphs` when no intro item found.
- `chrome-extension/reader/lib/ai.ts:151-172` — SSE parser only splits on `\n\n`. OpenAI is fine; some proxies emit `\r\n\r\n`. Consider both when Plan 4 broadens providers.
- `chrome-extension/reader/components/memory-view.tsx:202-215` — role quick-select buttons have no distinct "selected" styling when the draft already starts with one of the standards. Pure UX nit.
- `chrome-extension/options/main.tsx:22-25` — `onChange` constructs `{ ...cfg, ...patch }` from closure; React batches fine here, but `setCfg((prev) => ({ ...prev, ...patch }))` is the safer pattern.
- `chrome-extension/reader/components/memory-view.tsx:285-292` — delete button visibility uses imperative `onMouseEnter/Leave` mutating `style.opacity`. Re-render during hover resets it. CSS `:hover` + `data-nx-del` attribute selector would be simpler.
- `chrome-extension/reader/main.tsx:293` — `window.getSelection()?.removeAllRanges()` fires before the AI branch validates `sel.paragraphId`, so an early return still costs the user their selection. Low-impact UX nit.

## Strengths

- **`ai.ts` spec fidelity is excellent:** `buildPaperContext` / `buildMemoryInjection` / `PROMPTS` match §3.7.1–3 essentially word-for-word; tests cover the tricky cases (empty venue, empty abstract preserving `[abs]` hint, filtered `nextActions`, Translate omitting the LANG_SUFFIX).
- **`withKeyLock` + matching `set()`-latency in the mock** — the test is a true guard for the race, a genuinely good testing instinct.
- **SSE streaming parser correct** — buffer-until-`\n\n`, handles `[DONE]`, survives mid-frame splits, skips delta-less frames, throws on non-2xx with truncated error body.
- **Variant split (`variant` vs `persistedVariant`) is clean;** `setVariant(v, { transient: true })` will drop in cleanly for Plan 4's Ask flow.
- **`effectivePaper` overlay is threaded to every consumer** (`TopBar`, `OutlinePanel`, `PaperPage`, `MarginColumn`, `WorkspacePanel`, `runAction`'s `buildMessages`). No stale-paper leaks detected.
- **`onStreamDone` persistence correctly scoped to the success branch:** failed streams remove the placeholder AND do not persist, matching §3.8.

## Assessment

**Needs fixes** — the `EditableField` render-time setState and the StatusRail partial-config green dot are small, real correctness bugs worth fixing in this branch. The §3.8 inline-error-location shortcut and keydown stale-closure are follow-up items that don't block Plan 4 but should be tracked.

## Follow-ups for Plan 4

1. **Fix Critical:** `EditableField` setState-in-render → `useEffect` or key-remount.
2. **Fix Important:** StatusRail `configured` predicate includes all three fields.
3. **Inline BYOK error at anchor position** — replace the floating banner with a real inline node in MarginColumn / SelectionResultCard, then use `pendingError.paragraphId`.
4. **`runAction` stale-closure hardening** — `useCallback` with full deps, or ref-latest pattern.
5. **Abort test teeth** — have the mock SSE body suspend so `abort()` actually produces a rejection.
6. **Copy icon** — add a real `Copy` glyph to `icons.tsx`; SelectionResultCard uses it.
7. **SSE CRLF** — accept `\r\n\r\n` frame separators when Plan 4 broadens provider coverage (optional).
