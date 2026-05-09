# Phase 8 Polish Bundle — Implementation Review

Date: 2026-04-22
Plan: `docs/plans/2026-04-22-plan-phase-8-polish-bundle.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `d9e379b` (plan commit, pre-implementation)
Head SHA: `adca449` (Phase 8 self-review: ltx_tag whitespace + QuotaError on highlight/chat-persist)

## Summary

Phase 8 is a tight, well-scoped polish bundle. All four planned changes landed with test coverage (189/189), clean typecheck, and green build. The self-review commit (`adca449`) caught two real bugs: ltx_tag whitespace breaking the body-strip in `blockDescriptorText`, and two missing `QuotaError` guards (highlight path + chat-persist path). The descriptor introduction is safe against `extractCitations` because that regex is anchored to `[pN|abs]` — `[Figure 1]` cannot be confused for a citation token.

## Critical

None.

## Important

- **`chrome-extension/reader/main.tsx:769` — `onChatSend` pre-stream catch re-throws non-`QuotaError` errors.** `onChatSend` is wired directly to ChatComposer as an event handler (no external await/catch), so the `throw err;` becomes an unhandled promise rejection with no user-visible toast. The other three catch sites (stream catch in `runAction`, highlight branch, chat-stream catch) set a toast + cleanup for non-quota errors; this one is inconsistent. Near-unreachable in practice (non-quota `chrome.storage.local.set` failures are rare), but asymmetric error handling is a footgun. Mirror the stream-catch pattern: `setToast('AI request failed: ...'); setChatMessages(prev => prev.filter(...)); setChatStreamingId(null); return;`.

## Minor

- **`chrome-extension/reader/lib/arxiv.ts:154` — `body.startsWith(rawTag)` depends on normalized `rawTag` appearing as a prefix of `rawText`.** ar5iv HTML is well-behaved, but if a future fixture puts sibling markup before `<span class="ltx_tag">` inside `<figcaption>` (e.g. an anchor), `rawText` starts with that sibling, the strip skips, and output becomes `[Figure 1] <anchor-text> Figure 1. Architecture…` (the double-label this helper is supposed to prevent). Current tests cover real ar5iv output; add a comment pinning the assumption.
- **`chrome-extension/reader/main.tsx:566` — highlight catch logs non-`QuotaError` via `console.error` but doesn't toast.** Comment says "unreachable in practice" — true given storage.ts's throw surface, but silently swallowing an error from the user-initiated H-key action is a small UX regression vs. a toast. Low priority.
- **`chrome-extension/reader/main.tsx:521` — cache invalidation keyed on `cached.length === expected` only.** If a skeleton ever unmounts mid-scroll the cache would retain stale detached nodes (their `offsetTop`/`offsetHeight` would be 0) for that tick. `PdfPage` mounts `.pf-pdf-page` unconditionally and never unmounts, so this is theoretical — add a short comment pinning the invariant.
- **`chrome-extension/reader/components/canvas-view.tsx:176-180` — `WebkitLineClamp: 3` + `wordBreak: 'break-word'` is correct for Chrome,** but a glyph taller than `fontSize: 11 * line-height × 3` (e.g. CJK with tall diacritics) can slightly exceed the implicit max-height. Not an issue today; noted for the `CANVAS_NODE_SIZE.chat.height = 260` budget.
- **`docs/plans/2026-04-22-plan-phase-8-polish-bundle.md:741-748`** — final verification log appended correctly, but Task 6 Step 4's template `## Verification log` block at lines 699-708 is left verbatim. Minor tidiness — annotate as template to avoid confusion when reading the plan later.

## Strengths

- **Self-review commit (`adca449`) caught two real bugs** (ltx_tag whitespace + two missing QuotaError guards) and explicitly normalized `rawTag` alongside `rawText` so `startsWith` works across ar5iv's whitespace quirks. The kind of second-pass discipline the plan calls for.
- **`QuotaError` ordering correct** — handler fires **before** the throw (`storage.ts:80-81`). Quota toast lands regardless of whether callers catch or propagate.
- **`extractCitations` regex `/\[(p\d+|abs)\]/g` is strict enough** that `[Figure 1]`, `[Equation]`, `[Table 3]` cannot be mis-parsed as citation tokens. The anticipated ambiguity between `[pN]` citations and `[Figure N]` descriptors is a non-issue.
- **Cache invalidation keyed on `pdfRuntime.doc.numPages`** (not a naive "cache once and forget") is defensively correct for partial skeleton mount during scroll.
- **Test coverage math matches exactly:** 181 baseline + 3 (storage QuotaError) + 5 (arxiv descriptors) = 189. No accounting gap.
- **Rich-block descriptor lives only in `text`** (AI context + citation quote). UI rendering uses `html` via `dangerouslySetInnerHTML`, so the descriptor is invisible in the reader — clean separation of concerns.

## Assessment

**Ready** — the one Important finding (`main.tsx:769` inconsistent non-quota re-throw) is a polish fix that doesn't block shipping this bundle; worth addressing as a one-line follow-up in Plan 9 or a Phase 8.1 hotfix.

## Follow-ups for Plan 9

1. **Fix Important:** `main.tsx:769` `onChatSend` pre-stream catch — mirror the stream-catch's non-quota handling (toast + cleanup + return).
2. `arxiv.ts:154` add comment pinning `rawText.startsWith(rawTag)` assumption.
3. `main.tsx:566` highlight catch — consider a toast for non-quota errors.
4. `main.tsx:521` cache — comment pinning the "PdfPage never unmounts" invariant.
5. Plan 9 template cleanup — annotate or rename the Task 6 Step 4 scaffold to disambiguate from the real verification log below.
