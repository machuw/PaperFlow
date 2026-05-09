# Phase 7 Canvas Mode (react-flow) — Implementation Review

Date: 2026-04-22
Plan: `docs/plans/2026-04-22-plan-phase-7-canvas-mode.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md` §8.3
Base SHA: `6d6e386` (plan commit, pre-implementation)
Head SHA: `67b6ec8` (drop inline edge style + minor polish)

## Summary

Phase 7 delivers a working Canvas via `@xyflow/react` v12 + dagre. Two pure helpers (`buildCanvasGraph`, `applyDagreLayout`) are cleanly separated and well-tested (179/179 pass). Persistence is wired correctly with a 100 ms debounce, paper-scoped cleanup, and graceful fallback on quota errors. The implementation matches the plan's code faithfully; the only real gap is that spec §8.3 lists "3-line summary" as a Note-node source which neither plan nor implementation ever emits — a spec/plan drift the plan silently inherited.

## Critical

None.

## Important

- **Spec §8.3 vs `chrome-extension/reader/lib/canvas-graph.ts:69-77` — 3-line summary node missing.** Spec §8.3 explicitly lists "memory 的 whyItMatters / 3-line summary / linked" as Note-node sources. `buildCanvasGraph` only emits `note:why` (plus per-`MarginResult` notes); the 3-line summary (`paper:{key}:summary:threeLine:{model}`) is never pulled into the graph. `CanvasView` also receives no `summaryState` / `threeLineSummary` prop. The plan itself silently excluded this node (`docs/plans/2026-04-22-plan-phase-7-canvas-mode.md:442-450`). Decide: amend the spec (reasonable — the 3-line summary already has its own SummaryView tab, and surfacing it on Canvas requires plumbing `summaryState.threeLine.body` through), or add a Plan 8 follow-up to plumb it in.

- **`chrome-extension/reader/components/canvas-view.tsx:359` — `defaultEdgeOptions={{ type: 'bezier' }}` uses an unregistered edge type.** xyflow v12 built-ins are `default | straight | step | smoothstep | simplebezier` (no `bezier`). The prop triggers xyflow error 011 (`Edge type "bezier" not found...`) once per unique edge, then falls back to `'default'` (which IS the bezier renderer). Visual output is identical; console is polluted. Fix: drop the prop entirely (bezier is the default) or change to `type: 'default'`. The fix commit `67b6ec8` already touched this section — one-line oversight.

## Minor

- `chrome-extension/reader/lib/canvas-layout.ts:8-14` vs `chrome-extension/reader/components/canvas-view.tsx:223-228` — per-kind node dimensions duplicated in `NODE_SIZE` vs `NODE_FLOW_WIDTH/HEIGHT`. Drift risk if one is tweaked without the other. Extract a shared constant (e.g. export `CANVAS_NODE_SIZE` from `canvas-layout.ts`).
- `canvas-view.tsx:360` + `tokens.css:388` — attribution hidden twice (`proOptions.hideAttribution: true` AND `.react-flow__attribution { display: none }`). Redundant but harmless. Either drop one or add a 1-line comment acknowledging the dual suppression.
- `canvas-view.tsx:277-287` — mount effect runs `applyDagreLayout` synchronously then `await getCanvasLayout`. When a saved layout exists, the entire dagre pass is wasted work, and the effect re-runs on every `graphNodes`/`graphEdges` identity change. Micro-optimization: check `saved` first. Not meaningful at current graph sizes (<200 nodes).
- `canvas-graph.ts:65` — note-to-section fallthrough resolves `sectionByParagraph.get(paragraphId)` without verifying a matching `section:<id>` node was emitted. Latent (upstream parse is consistent), but add an assertion or comment calling out the invariant.
- `canvas-view.tsx:290-299` — `persist` callback uses `useCallback([pk])`, but `saveTimer` is a ref shared across paper-key changes. Theoretical window: paper swap during active drag + cleanup hasn't run → previous key's save fires with previous key's nodes. `current: Node[]` is a snapshot so no shape corruption, but the "late-fired" comment could note the edge case. Consider capturing `pk` in the closure for belt-and-braces.
- `canvas-view.tsx:170-176` ChatNode — user bubble has no truncation. Long prompts overflow or scroll inside the node. Spec says "问题 + 答案片段" — heads-up for real-world prompts.

## Strengths

- **TDD separation is clean:** pure helpers have full test coverage (15 new tests: storage-canvas 3, canvas-graph 8, canvas-layout 4); React glue is thin and deliberately untested.
- **Paper-key-scoped cleanup** in the fix commit (`67b6ec8`) is the right call — prevents cross-paper write races.
- **Graph build is well-commented;** edge ids encode source→target for human debuggability.
- **Spec-consistent details executed well:** chat node is free-floating (no `e:chat->*` edge), fallthrough from missing `sectionId` to paper, trimmed `whyItMatters` guard, empty-assistant-text filter added in the fix commit.
- **No Phase 6 collateral damage** — `git diff` confirms pdf-page / pdf / arxiv untouched.
- **No `any` smuggling** — the `'dots' as any` cast was properly removed in `67b6ec8` in favor of `BackgroundVariant.Dots`.
- **TopBar disabled-state rules** match spec §9 (`sidebarDisabled` in canvas, `workspaceDisabled` outside classic).
- **`CanvasPlaceholder` deletion** confirmed in commit `23aefaa` (-44 lines).
- **Dagre returns center coords; code converts to top-left** via `laid.x - width/2` — correct for react-flow which expects top-left.

## Assessment

**Ready** — address Important #2 (`'bezier'` → `'default'` or drop the prop, one-line fix) before merge; triage Important #1 (3-line summary node) as either a spec amendment or a Plan 8 follow-up.

## Follow-ups for Plan 8

1. **Fix Important:** `canvas-view.tsx:359` edge type `'bezier'` → `'default'` or remove.
2. **Decide + act:** 3-line summary node on Canvas — spec amendment OR plumb `summaryState.threeLine.body` into `CanvasView`.
3. Extract shared `CANVAS_NODE_SIZE` constant (canvas-layout.ts + canvas-view.tsx dedup).
4. Remove one of the two attribution suppressions (or comment the dual suppression).
5. Dagre-skip optimization when saved layout fully covers node set.
6. ChatNode user-bubble truncation for long prompts.
7. Capture `pk` in `persist` closure for belt-and-braces paper-swap safety.
