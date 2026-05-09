# TODO

Running list of issues found during manual use that need fixing.

**Status (2026-04-23): all 13 items shipped.** Retained below as historical record of what each phase delivered. When new items surface, append them and drop the "all shipped" note.

## Summary tab (Classic Workspace)

1. **Section order.** Current render order is `threeLine → keyTerms → detailed`. Should be `keyTerms → threeLine → detailed`. ✅ **Shipped in Phase 5** (`summary-view.tsx:60`).
   - Source: `chrome-extension/reader/components/summary-view.tsx` — the map over `['threeLine', 'keyTerms', 'detailed']` array controls render order; swap to `['keyTerms', 'threeLine', 'detailed']`.
   - `SECTION_TITLES` + `REFRESHABLE` remain keyed by section name, so only the iteration array needs reordering.

2. **Single refresh button covering all sections** (drop per-section refresh). ✅ **Shipped in Phase 5** (`summary-view.tsx:27,82` — `onRefreshAll` prop).
   - Current: `REFRESHABLE = ['threeLine', 'detailed']` renders a `↻` on each refreshable section header.
   - Want: one refresh control (probably next to the section group header or in a toolbar row) that clears all three cached sections for the current model and retriggers generation.
   - Touches:
     - `summary-view.tsx`: remove per-section refresh buttons; add a single "Regenerate all" button (likely near the ContextIndicator or at the top of the section stack).
     - `main.tsx`: expose a new `onSummaryRefreshAll` handler that `clearSummarySection` × 3 then kicks off three `fetchSection` calls in parallel. Can probably replace `onSummaryRefresh` entirely and drop the `section` arg everywhere.

3. **Streaming flicker during regeneration is visually noisy.** ✅ **Shipped in Phase 5** via option 2 (skeleton-until-done): `summary-view.tsx:117` folds `loading` and `streaming` into the same shimmer.
   - Current: while a summary section streams, its `kind: 'streaming'` state re-renders the text on every chunk — the growing `<div>` content flashes visibly, especially on fast connections.
   - Root cause candidates:
     - Per-chunk `setSummaryState` triggers a full re-render of the whole SummaryView subtree.
     - No subtle CSS transition / fade — just raw text replacement.
     - ink-streaming cursor animation combined with the text churn amplifies the noise.
   - Ideas for a better wait experience (pick one or combine):
     - **Buffer + fade-in per-paragraph**: accumulate chunks into a buffer; only reveal completed paragraph/sentence boundaries with a short `fade-up` animation.
     - **Skeleton → full swap**: keep the shimmer-line skeleton for the entire streaming duration and only replace with real content on `kind: 'ready'`. Simpler, fewer visual changes.
     - **Targeted DOM updates**: use a ref-based direct text append (e.g. `el.textContent += chunk`) instead of React state updates — avoids React reconciliation between chunks.
     - **Debounce the state setter**: batch chunks into ~200ms flushes so text grows in larger steps.
   - Recommended first attempt: **skeleton-until-done** (option 2) — simplest, least code, no animation complexity. Revisit if user wants to see progress.
   - Touches:
     - `summary-view.tsx`: collapse `streaming` + `loading` render paths so both show the shimmer skeleton; only reveal content at `ready`. Drop `ink-streaming` class here.
     - `main.tsx`: no state-machine change needed — just the view treats `streaming` like `loading` visually.

## Selection actions

4. **Abstract block rejects selections with "Selection must be inside a paragraph."** ✅ **Shipped in Phase 5** (`paper-page.tsx:99` — `data-pid="abs"`). `formatLoc` emits `Abstract` label.
   - Repro: in reader, select text inside the Abstract card (venue/title/authors block also affected) → press E/S/T → toast/error fires. Selections in the body (Introduction onward) work fine.
   - Root cause: `chrome-extension/reader/components/paper-page.tsx` renders the Abstract `<div>` without a `data-pid` attribute, so `range.startContainer.parentElement?.closest('[data-pid]')` returns null; `runAction` then short-circuits at `if (!sel.paragraphId)` because only real paragraphs carry the attribute.
   - Fix: add `data-pid="abs"` to the Abstract content `<div>` in `paper-page.tsx`. The sentinel `"abs"` aligns with the §3.7.1 / §3.7.4 citation token — no further special-casing needed for AI calls (selected text is what actually gets sent; paragraphId only tracks the anchor).
     - `margin-column.tsx` anchors notes to `[data-pid="{id}"]` — the Abstract block will already be present as an anchor target once the attribute is added. Ping animation works the same way.
     - `selection-result-card.tsx`'s `formatLoc(paper, 'abs')` will not find a matching paragraph and return `¶ ?` — acceptable for v1, or swap to emit `Abstract` when the paragraphId is `abs` (tiny follow-up polish).
   - Title / authors / venue blocks at the top of the paper card are NOT useful for AI actions; leave them selection-blocking (intentional — title selection doesn't help the model).

## Reading-area fidelity (figures / formulas / tables)

Current state: both arXiv-HTML and PDF modes strip everything except plain paragraph text. `parseArxivHtml` in `reader/lib/arxiv.ts` takes `textContent` only; `parsePdf` in `reader/lib/pdf.ts` takes `getTextContent` only. No figures, no MathML/equations, no tables in either. Two separate fixes needed:

5. **arXiv HTML mode: preserve ar5iv's rich content.** ✅ **Shipped in Phase 5** (`arxiv.ts` — `ltx_para` innerHTML capture + figure/equation/table block capture + `Paragraph.html` field; rendered via `RichBlock` in `paper-page.tsx`). Low-cost, high-yield because ar5iv already compiles LaTeX to HTML with MathML / `<img>` / `<table>`; we just need to stop discarding it.
   - **Data model:** add `Paragraph.html?: string` (keep existing `text` for AI context injection — prompts shouldn't carry HTML).
   - **Parser:** `parseArxivHtml()` captures `innerHTML` alongside `textContent` for each `<div class="ltx_para">`; also picks up `<figure>`, `<div class="ltx_equation">`, `<table>` as standalone paragraph-like blocks with ar5iv's `id` as `sectionId`.
   - **Renderer:** `PaperPage` prefers `html` via `<div data-pid dangerouslySetInnerHTML={{__html}} />` (safe — source is the fetched ar5iv page, already sandboxed in the extension + host-permission-gated).
   - **Styles:** load ar5iv's CSS so `ltx_*` classes work — either `<link>` to `https://ar5iv.labs.arxiv.org/html/main.css` (CSP allowlist required) or extract the subset we use (math / figure / caption / table) into `tokens.css`. Prefer the latter for offline-safe + smaller surface.
   - **Theme coherence:** scope rules `.paper-body * { color: inherit !important; }` + `figure img { mix-blend-mode: multiply; }` to fold ar5iv colors into `--ink` / `--paper`.
   - **Existing systems:** selection / highlight / MarginColumn anchoring / scroll-spy all depend on `[data-pid]`, which still works on the enriched `<div>`s — no downstream rewrites.
   - **Estimated effort:** 2–3 days.

6. **PDF mode: canvas + text-layer rendering.** ✅ **Shipped in Phase 6** (`reader/components/pdf-page.tsx` — `page.render()` + pdfjs `TextLayer` class; lazy-render via IntersectionObserver; dark-mode invert). No shortcut — pdfjs has to actually render each page.
   - **Render:** for each page, `page.render({canvasContext, viewport})` draws a `<canvas>`; `page.getTextContent()` positions an absolute-positioned text layer (`<div class="text-layer"><span>…</span></div>`) on top so selection / copy / search work.
   - **`data-pid` mapping:** our existing `splitParagraphsByGap()` already groups text items into paragraphs — apply the same grouping at render time so all spans inside one paragraph carry the same `data-pid="sec{idx}-p{n}"`. Existing selection / highlight / MarginColumn logic then keeps working unchanged.
   - **Theme (light):** `.pdf-page { background: var(--paper); } .pdf-page canvas { mix-blend-mode: multiply; }` — white paper becomes `--paper`, black ink stays readable.
   - **Theme (dark):** `[data-theme="dark"] .pdf-page canvas { filter: invert(1) hue-rotate(180deg); }` — reversible inversion that preserves saturated colors in figures.
   - **Refactor surface:**
     - `parsePdf()` currently discards `pdfDoc` after extraction; needs to return (or hold) the doc reference for later page-level rendering.
     - New component `reader/components/pdf-page-canvas.tsx` encapsulates per-page render + text-layer.
     - `PaperPage` branches: `paper.id && paper.venue?.startsWith('arXiv:')` → HTML path (current); else → loop `1..numPages` rendering `<PdfPageCanvas>`. Outline, scroll-spy, selection stay DOM-driven via `data-pid`.
   - **Known costs:** pdfjs canvas render is ~30–100 ms per page; memory grows with page count. Consider virtualization (only render pages within viewport ±1) if papers over ~30 pages drop frames.
   - **Estimated effort:** 1–2 weeks.

Suggested ordering: 5a first (covers 80% of reading: ar5iv-available arXiv papers), 5b second (native PDFs + arXiv papers without ar5iv HTML).

## Phase 5 review follow-ups (from whole-branch review 2026-04-22)

7. **Quota-error contract — decide swallow vs typed error.** ✅ **Shipped in Phase 8** via option (b) — `QuotaError` class (`storage.ts:66`); `main.tsx` AI catches + chat persist + highlight path all `instanceof QuotaError` check to suppress double-toast.

8. **Quota path has no test coverage.** ✅ **Shipped in Phase 8** (`tests/lib/storage.test.ts:250` — 3 tests covering `QuotaError` thrown, handler fires, non-quota passthrough).

9. **Rich-block AI citations show raw concatenated textContent.** ✅ **Shipped in Phase 8** via option (b) — `blockDescriptorText` helper in `arxiv.ts:122` prepends `[Figure N]` / `[Equation]` / `[Table N]` to the `text` field (using ar5iv's `ltx_tag` when present; fallback to type name).

10. **Highlights inside rich blocks are silently dropped.** ✅ **Shipped in Phase 9** via CSS Custom Highlight API (`reader/lib/highlight-ranges.ts`). `registerPaperHighlights` paints over any DOM — plain paragraphs, rich blocks, and PDF text-layer spans — with per-paragraph scoping and §3.4 overlap suppression. Supersedes the earlier deep-DOM span-wrap approach.

11. **Trust-boundary comment on `Paragraph.html`.** ✅ **Shipped in Phase 6** (`reader/types.ts:31-33` — docstring explicitly warns against populating from user input; invokes `dangerouslySetInnerHTML` XSS context).

12. **`LoadResult` partial Paper is a heuristic.** ✅ **Shipped in Phase 6** (`reader/lib/arxiv.ts:202` — `LoadResult` now has explicit `'ok-partial'` variant; `main.tsx:98` branches on it to skip caching).

13. **Visual PDF highlight paint — deferred from Phase 6.** ✅ **Shipped in Phase 9** via CSS Custom Highlight API (unified with TODO #10). `PdfPage` dispatches `pf-textlayer-ready` after text-layer hydration; `ViewerApp` listens and calls `registerPaperHighlights` to paint over matching text-layer spans via `::highlight(hl-yellow)`. No overlay rects needed — the API paints directly onto Ranges.

## Appendix float capture (reported 2026-04-23)

14. **`parseArxivHtml` missed figures/tables at document root** (outside any `<section[id]>`). Some ar5iv papers emit appendix figures after `</section>` of the bibliography — they sit loose at the top level. Parser only walked direct children of `section[id]`, so these fell through. Reported against arXiv:2604.05015 which has 4 appendix blocks (A0.F9/F10/F11 + A0.T4) at the document root. ✅ **Shipped 2026-04-23** (`reader/lib/arxiv.ts` — post-section pass collects top-level floats, skips nested panels, attaches to last outline entry). 3 new tests cover: loose figure capture, nested-panel dedup, no-double-capture for in-section figures.

## User-login launch checklist (2026-04-24)

All code for Phases A–F is merged (`phase-a-complete` → `phase-f-complete` tags, then merged into main via commit `f109330`). Free-tier + BYOK paths work immediately against local Supabase — below is what **remains blocked on external setup** before the paid tier can go live.

### E1 · paperflow.app domain + Vercel landing pages

- [ ] Buy `paperflow.app` (any registrar, ~$12/yr)
- [ ] Create Vercel static site (separate repo is fine). Inline paperflow tokens (`--paper`, `--ink`, `--walnut`, `--foxglove`, `--forest` from `chrome-extension/reader/styles/tokens.css`). Three routes:
  - `/billing/success` — "支付成功 · 订阅已激活 · 关闭此标签页返回 PaperFlow，新 tier 将在几秒内显示"
  - `/billing/cancel` — "本次支付未完成 · 你可以随时再次尝试"
  - `/pricing` — static tier comparison (visually mirror the in-extension UpgradePrompt)
- [ ] Point DNS → Vercel, verify HTTPS
- [ ] Add `docs/plans/2026-04-24-plan-user-login-landing.md` noting: landing repo URL, Vercel deploy URL, route list

### E2 · Stripe Dashboard config (test mode first)

- [ ] Product "PaperFlow Sync" → recurring $4/mo → copy `price_...` → store as `STRIPE_PRICE_SYNC`
- [ ] Product "PaperFlow Pro" → recurring $12/mo → copy `price_...` → store as `STRIPE_PRICE_PRO`
- [ ] Webhook endpoint:
  - URL: `https://<supabase-project>.supabase.co/functions/v1/stripe-webhook` (hosted Supabase required; for local dev use `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook`)
  - Events: `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted`
  - Copy signing secret → store as `STRIPE_WEBHOOK_SECRET`
- [ ] Copy Stripe Secret Key → store as `STRIPE_SECRET_KEY`
- [ ] Fill 4 secrets into:
  - `supabase/.env` (local CLI stack)
  - Supabase Hosted → Project Settings → Edge Functions → Secrets (production)

### Live acceptance (blocked on E1 + E2)

- [ ] **F6 — E2E 12-step checklist** (spec §14.7.7.7): install → login → migrate → exhaust trial → upgrade → Pro → cancel → "ending" state → multi-device sync → realtime ≤5s → offline queue drain → logout clean state → multi-user isolation
- [ ] **E7 step 1-2** — Stripe test card `4242 4242 4242 4242` end-to-end + Billing Portal cancel flow
- [ ] **Production deploy**: Supabase project creation + migration push + `supabase functions deploy` × 4 + Chrome Web Store listing

### Not blocked (safe to ship / use now)

- ✅ BYOK entire path (Options page key → `callAI` detects `config_apikey` → `streamBYOK`, never touches proxy)
- ✅ Login + magic-link OTP + RLS isolation against local Supabase + Mailpit
- ✅ Migration + conflict-merge (C1-C4)
- ✅ Cross-device sync of highlights / notes / memory / chat via realtime
- ✅ All modals + dark mode + focus management (F1-F5)

## E2E test bootstrap (deferred — L5-4, 2026-04-25)

Playwright E2E for the Chrome MV3 extension was deferred from the ui-redesign-260424 branch
because bootstrapping `launchPersistentContext` + stable extension ID handling + build
prerequisite costs ~1–2 hours before any spec can run, which exceeds the task scope at this
stage of the redesign.

- [ ] **Bootstrap Playwright** — install `@playwright/test`, add `playwright.config.ts`,
  add `tests/e2e/fixtures.ts` with `launchPersistentContext`. Full runbook in
  `chrome-extension/tests/e2e/README.md`.
- [ ] **5 E2E specs** — promote `selection-explain-flow.spec.todo.ts` (fill `it.todo` bodies)
  and add the remaining 4: `selection-highlight`, `selection-note`, `selection-translate`,
  `chat-session-mgmt`. See `tests/e2e/README.md` for planned assertions.
- [ ] **CI integration** — add `test:e2e` script + Playwright browser install step in
  GitHub Actions workflow.

### Plan debt (non-blocking, open whenever)

From the Phase F sweep retrospective, deferred cleanups that don't affect correctness:

- [ ] `MarginNote` component: remove unreachable `'error'` variant (dead after byokError removal in commit `184390b`)
- [ ] Options page: remove legacy `setConfig(cfg)` alongside new split writes (`config_apikey` + `config_prefs`)
- [ ] `library.ts`: wire papers-table cloud inserts so the F1 `LibraryCapBanner` re-enable-on-cap-error hook can fire
- [ ] Chat shape divergence (C1 one-way only) — cloud→local direction still deferred
- [x] Portal return URL hardcoded → env-driven (`STRIPE_PORTAL_RETURN_URL` + `STRIPE_SUCCESS_URL` + `STRIPE_CANCEL_URL`)

## DESIGN.md sync (deferred — L6 per spec §18.1)

Per spec §18.1, the DESIGN.md rewrite ships as a **separate PR** so the ui-redesign-260424 PR
stays focused on code changes. The file (`DESIGN.md` in the repo root) still reflects the
pre-redesign architecture; the following sections are stale and need rewriting once the redesign
PR is merged.

- [ ] **§4.3 AI 功能 (E/S/T/H 操作)** — Still describes the old 5-action set
  (`explain | summarize | translate | highlight | ask`) routed through `generateBody()` into
  `MarginNote` streaming. Rewrite to: 4-action set (`Explain | Highlight | Note | Translate`),
  `runSelectionAction()` dispatch in `lib/selection-actions.ts`, dual-write to Chat + Note store,
  no `MarginNote` involvement.

- [ ] **§4.5 Memory (研究上下文)** — Still says Memory is edited via "Chat 面板 (`WorkspacePanel`
  的 chat tab)". After redesign, Chat is a standalone left panel; Memory is its own tab in the
  right `WorkspacePanel` (not nested inside a Chat tab). Rewrite to reflect the new tab
  structure: `Overview | Note | Memory`.

- [ ] **§5.1 Focus 模式 — 侧边 Margin Notes** — Entire section is stale. The focus variant
  (`MarginColumn`, `MarginNote`, SVG connector lines, `ink-pen-draw` animation, overlap-push
  logic) was deleted in L4-1/L4-2. Focus variant no longer exists; the shell is now
  `[Chat Panel][Reader][Right Panel]` across Classic/Summary/Canvas. Section should be removed
  or replaced with the new Chat panel layout spec (§1 of the redesign spec).

- [ ] **§5.2 Classic 模式 — WorkspacePanel** — Describes the old three-tab structure
  (Summary / Chat / Memory). Summary tab (threeLine / keyTerms / detailed) is gone; Chat is now
  the left panel; right panel tabs are `Overview | Note | Memory`. Rewrite to document Overview
  tab (paper info, AI contributions, outline, keywords), Note tab (4 sub-tabs with NoteCard),
  and Memory tab (unchanged).

- [ ] **§6 TopBar 控件** — States that the right-sidebar toggle controls "outline 面板" in Focus
  mode, and that `⌘\` toggles the outline. After redesign: outline panel is removed; `⌘\` now
  toggles the right panel; a new "切 Chat" button in TopBar controls Chat panel visibility. The
  keyboard shortcut table also still lists `S` (Summarize) and `⌘\` (切换大纲) with stale
  semantics. Rewrite to reflect the new button layout and shortcut meanings.

## UI redesign launch checklist (2026-04-25)

Cross-spec follow-up items from `/plan-eng-review` of `docs/specs/2026-04-24-spec-ui-redesign-chat-notes.md`. **Not blocking** the UI redesign PR itself; pick up after v1 ships.

- [ ] **NoteCard list virtualization (v2)**.
  - **Why**: Spec §17.C.1 ships v1 with full-list render. Performance fine ≤ ~100 cards but degrades at 200+ (markdown re-parse + reflow on each scroll).
  - **Trigger**: production console emits `[Note list >200 cards, consider virtualization]` warn (sentinel added in v1).
  - **Scope**: wrap `note-view.tsx` list with `react-window` `<VariableSizeList>`. Variable-height because Layout A (explain/translate/note) and Layout B (highlight) differ in card height. Add `scrollToIndex` API for chat→note flash highlight jumps.
  - **Cons**: variable-height virtual lists complicate jump-to-card UX; integration tests need updates because not-in-DOM cards aren't queryable.
  - **Depends on**: v1 ships first; wait for actual prod warn signal.

- [ ] **AI eval CI harness**.
  - **Why**: Spec §17.B.4 added 3 LLM eval suites (`contributions / keywords / explain`). Without CI integration they're dead files. Prompt drift would land silently.
  - **Scope**: GitHub Actions step that runs `vitest --run eval/` only on `main` push or release tag (NOT every PR — cost). Baseline outputs at `chrome-extension/tests/eval/baselines/{suite}.json`. Diff against current output, fail if absolute drift > 30% words. For prompt-change PRs the dev manually regenerates baseline + commits.
  - **Cost estimate**: $1-3 per CI run × ~5 runs/week ≈ $60/month.
  - **Cons**: false positives on intentional prompt changes; baseline maintenance.
  - **Depends on**: eval files written as part of v1 implementation per §17.B.4. CI integration is post-ship.

- [ ] **DESIGN.md sync rewrite (separate PR)**.
  - **Why**: Spec §14 noted DESIGN.md §4.3 / §4.5 / §5.1 / §5.2 / §6 are now stale (describe deprecated MarginNote / SelectionResultCard / focus variant). New devs reading DESIGN.md will get outdated mental model. Spec was explicit: "PR landing 时同步重写 DESIGN.md 这几节; 不允许'代码改了文档没改'".
  - **Scope**: ~150 lines rewrite. Replace §5.1-5.3 with Chat panel + Overview tab + Note tab + selection toolbar; rewrite §6 for new TopBar (§17 + Pass 1.7 layout); delete focus-variant references entirely (already deprecated by `f8e69bd`); add pointer to spec §17 for engineering decisions.
  - **Why separate PR**: keep redesign code PR focused on code review; DESIGN.md rewrite is a doc PR, easier to land + review independently.
  - **Depends on**: UI redesign PR lands first.

## Library v2 follow-ups (2026-04-25)

Post-v1 items. v1 (catalog model + sidebar + chip row + SW-resilient undo + responsive + 9 phases of tests) shipped; these are deferred features called out in `/plan-design-review`.

- [ ] **Library v1.1: bulk paper assignment**.
  - **What**: shift-click multi-select on paper cards. Multi-selected cards reveal a sticky bulk-action bar above the group header with Library + Topic dropdowns. One write applies to all selected.
  - **Why**: design review Pass 3 identified this as the single largest source of v1 friction. Filing 30 papers in v1 takes ~60 popover clicks; v1.1 takes ~4. 1500% reduction for the most realistic onboarding case (importing existing reading list).
  - **Pros**: directly addresses what will be the #1 v1 user complaint. Catalog write infrastructure already exists.
  - **Cons**: card multi-select UX (anchor + range), sticky bar positioning in scroll container, lock strategy for one-write-to-N-rows, undo coverage for bulk delete-from-topic. Mid-weight feature, ~3-5 days.
  - **Trigger**: ship v1, watch for "tedious to file" feedback (likely in week 2 of beta). Promote to v1.05 if feedback strong.
  - **Spec reference**: `2026-04-25-spec-library-v2.md` § "Out of Scope → v1.1".

- [ ] **Toast UI listener visual polish**.
  - **What**: the Library v2 delete-with-undo flow dispatches `pf-show-toast` events with action handlers. The `ToastHost` component renders these with an Undo button and 5s auto-dismiss (commit `28690e8`). Visual polish remaining: walnut-toned button, slide-in animation matching other toasts, dark-mode contrast pass.
  - **Why**: the undo flow works (verified by E2E in `library-v2-flow.spec.ts`) but the toast looks utilitarian. Polish before public beta.
  - **Cons**: low priority — functional.

- [ ] **`window.prompt()` audit**.
  - **What**: Library v2 sidebar now uses inline create/rename inputs (commit `1f209f6`). Run a sweep for any other `window.prompt`/`window.alert` callers in the extension that should also become inline UX.
  - **Cons**: low priority — only matters if there are other native dialogs in the extension surface.

- [ ] **Migration 009 (renamed from 007) production deploy note**.
  - **What**: `delete_topic_atomic` was initially landed in migration 008 (renamed from 006 during merge) without `revoke from public`, exposing a privilege escalation (any authenticated user could pass arbitrary `p_user_id` and delete another user's topics). Fix landed in migration `009_lock_delete_topic_atomic.sql`. Deploy must apply 008 + 009 in the same session — split deployments leave a window where the gap exists.
  - **Trigger**: `supabase db push` for production should run both migrations atomically.

- [ ] **Topic chip optimistic state symmetric with Library chip**.
  - **What**: Library chip has full optimistic lifecycle (`opacity:0.7` inflight → `shake-x` on lock failure → revert; commit `9b7d13d`). Topic chips don't — toggling a topic visually waits for canonical state. The toggle-add path is non-trivial (the chip doesn't exist in `row.topicIds` until canonical state catches up; would need synthesizing a phantom chip).
  - **Cons**: visual nicety; functional behavior is correct.
