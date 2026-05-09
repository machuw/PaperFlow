# Phase 2 Reader UI — Implementation Review

Date: 2026-04-21
Plan: `docs/plans/2026-04-21-plan-phase-2-reader-ui.md`
Spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Base SHA: `4d12db6` (pre-implementation)
Head SHA: `9677e6a` (Phase 2 verification log)

## Summary

Phase 2 is a disciplined migration: 58 tests pass, typecheck clean, build green. The 18 task commits line up 1:1 with the plan. The implementation stays faithful to the spec's §10.1 deliberate deviations from the prototype (figure placeholder dropped, multi-highlight-per-paragraph allowed, mono-uppercase note titles, `—/—` HTML page counter, `--walnut-deep` single-definition token, `sec{n}-p{m}` paragraph ids).

One correctness nit on the selection toolbar clamp plus a handful of minor polish items. Nothing blocks Plan 3.

## Critical

None.

## Important

- **`chrome-extension/reader/components/selection-toolbar.tsx:17`** — `left: Math.min(Math.max(rect.left + rect.width / 2, 120), 540)` hardcodes a 120–540px range. The toolbar is rendered inside the absolute-positioned paper card (not document-relative), so the clamp values are only meaningful around a ~640px page. At `pageWidth=900` (TweaksPanel max) the toolbar hugs the left third. Clamp against paper card width, or drop the clamp.

## Minor

- **`chrome-extension/reader/components/top-bar.tsx:122–130` — `computePageLabel` fallback `active?.page ?? 1`.** When `activeSectionId` resolves to a level-1 subsection whose `page` is undefined (possible from pdf.ts output), counter stays at `p. 1/{total}` regardless of scroll. Plan 5 is already on the hook for real offsetTop tracking; as a cheap improvement, walk up to the level-0 parent's page when the active item has none.

- **`chrome-extension/reader/components/icons.tsx:31` — `export const I: Record<string, IconComponent>` widens the type** so `I.FooTypo` type-checks. A literal-union keyed record or `as const satisfies Record<…>` would catch typos at compile time. Connected: `selection-toolbar.tsx:44` `icon: keyof typeof I` degrades to `string` because of this.

- **`chrome-extension/reader/main.tsx:139` — `usePersistedState<ReaderVariant>('pf-variant', 'focus')`.** Spec §3.7.5 requires a transient variant switch path for Ask in Plan 3. Leave a TODO comment at this call site so Plan 3 remembers to split into `variant` vs `persistedVariant`.

- **`chrome-extension/reader/components/paper-page.tsx:142–153` — highlight `<span>` keys use sorted index (`hl${i}`).** Adding a highlight earlier in a paragraph than existing ones remounts existing spans. Content-derived key (`hl-${s.start}-${s.end}`) would be stable. Cosmetic.

- **`chrome-extension/reader/lib/storage.ts:69–76` — `addHighlight` reads + writes non-atomically.** Two concurrent H-keypresses could race and lose one. v1 highlights are one-at-a-time so unlikely, but Plan 3's AI write path will share the pattern — worth a comment or a write queue when that lands.

- **`chrome-extension/reader/main.tsx:245–274` — keydown handler omits `libraryOpen`/`cmdKOpen`/`tweaksOpen` from deps.** By design ⌘L/⌘K/⌘\\ are always-on (spec §3.3), so this is spec-compliant. Consideration: pressing ⌘L while Library is open re-calls `setLibraryOpen(true)` — no bug, but a toggle would match outline/cmdK semantics better.

- **`chrome-extension/reader/components/overlays.tsx:92–98` — `setTimeout(() => inputRef.current?.focus(), 0)`.** Works; `requestAnimationFrame` is idiomatic for focus-after-mount. Nit.

- **`chrome-extension/reader/main.tsx:158–164` — `getHighlights` effect dep `[paper]` (object identity).** Swapping papers remounts everything anyway, so harmless. Noting for future.

## Strengths

- **Test coverage hits the right spots:** ar5iv real fixture with `ltx_para` wrappers + heading-less `bib` section; Introduction fallback when level-0 has only subsections; `extractRolePrefix` standard-value edge cases (lowercase fails, "Counter" without "-evidence" fails); highlight dedupe.
- **Spec §10.1 deviations honored consistently** — no `FigurePlaceholder`, `sec{n}-p{m}` paragraph ids, mono-uppercase "WHY THIS MATTERS" intent baked into types, `--walnut-deep` as single-definition oklch mix that auto-adapts across themes, `—/—` page counter for HTML mode.
- **Scroll spy implementation matches plan verbatim** (viewport-midline + 120ms debounce + initial compute at 200ms post-mount).
- **Keydown handler's editable-element exclusion is correctly ordered** (spec §3.3): `isEditable` check sits *after* the ⌘K/⌘\\/⌘L global branch, preserving global shortcuts inside editable fields.
- **`resolveOutlineTarget` + `scrollToOutlineItem`** cleanly encapsulate the level-0 fallback rule, with a quiet `console.warn` rather than a throw on unresolvable items.
- **Storage layer is defensively typed** (`ParsedCache = Pick<Paper, …>`) and exposes a `keys` builder for downstream plans; `clearPaper` correctly sweeps by prefix.

## Assessment

**Ready** — ship to main. All Done Criteria are met. The Important issue on the selection toolbar clamp and the minor items can be rolled into Plan 3 polish.

## Follow-ups for Plan 3

1. Fix `SelectionToolbar` clamp to use paper card width (Important above).
2. Split `variant` state into `variant` (in-memory) + `persistedVariant` (localStorage) — required by §3.7.5 Ask.
3. Tighten `icons.tsx` typing (literal-union key).
4. Consider a write queue or mutex for storage writes when AI actions land (to neutralize the `addHighlight` race class).
