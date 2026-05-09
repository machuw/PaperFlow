# Dark-mode audit — Phase 5

Date: 2026-04-22
Reviewer: Claude (static pass)
Base SHA: `c253f00` (end of Task 14)

## Scope

Dark mode has never been systematically audited. This pass is a **static code review** — visual verification in a running browser is flagged separately and requires the user. The scan covers:

1. Hardcoded hex / rgba colors in components (auto-leak candidates)
2. `color-mix` base-color sanity (tokens that flip vs. accents that don't)
3. `[data-theme="dark"]` coverage in `tokens.css`
4. Known affordances that historically break in dark (backdrops, grain overlay, highlighter)

## Static findings

### 1. Hardcoded hex colors in components

`grep '#[0-9A-Fa-f]{3,8}' chrome-extension/reader/components/` — **0 hits**. All component colors route through CSS custom properties, which flip automatically with `[data-theme="dark"]`. ✅

### 2. Hardcoded `rgba(...)` in components

Two occurrences, both drawer/overlay backdrops:

- `library-drawer.tsx:60` — `rgba(20, 16, 8, 0.35)`
- `overlays.tsx:92` — `rgba(20, 16, 8, 0.45)` (CmdK palette)

In **light** mode these produce a warm-brown wash (desired). In **dark** mode the base `RGB(20, 16, 8)` is *darker* than `--paper-deep` (`#0F0E0B`) so the backdrop still darkens the underlay, just more subtly; drawer/palette `--paper` background (`#181613`) provides the contrast step. **Acceptable** — leaving as-is. If user feedback says the CmdK backdrop feels too weak in dark mode, swap to `color-mix(in oklch, black 30%, transparent)` and override in `[data-theme="dark"]`.

### 3. `color-mix` call sites

Seven occurrences across six components. All mix an accent token (`--foxglove`, `--walnut`, role color, tone color) into either `--paper-soft` or `transparent`. Both paper-soft and the accents are theme-tokenized in `tokens.css`, so these auto-flip. ✅

Examples verified:
- `summary-view.tsx:130` — foxglove error banner background
- `workspace-panel.tsx:111` — same pattern
- `memory-view.tsx:31, 231` — walnut tint + tone color quick-select
- `margin-note.tsx:67` — tone color in result card
- `library-row.tsx:85` — role color chip
- `outline-panel.tsx:138` — role color chip variant

### 4. Paper grain overlay

`tokens.css:113-126` — grain uses `mix-blend-mode: multiply` in light, `screen` in dark with opacity dropped to 0.04. ✅ Explicitly dark-theme adjusted.

### 5. ltx_graphics (Phase 5 new)

`tokens.css:259-269` — figure images use `mix-blend-mode: multiply` in light to fold whites into `--paper`; `invert(1) hue-rotate(180deg)` + `screen` in dark to keep figures readable against a dark background. ✅

### 6. Highlighter yellow

`--ink-highlight` flips from `#E8D385` (light, aged yellow) to `#8A7424` (dark, dimmer olive). Selection overlay uses `color-mix(in oklch, var(--ink-highlight) 60%, transparent)` — both values remain legible against their respective page colors. ✅ Static reads OK.

### 7. `::selection` override

`tokens.css:104-107` — selection background is `color-mix(in oklch, var(--ink-highlight) 60%, transparent)`, text color is `--ink`. Flips cleanly. ✅

### 8. Shadow tokens

`--shadow-{1,2,3}` in `[data-theme="dark"]` use darker opacities (0.4–0.7 alpha black) and light-colored rim (`rgba(255, 240, 200, 0.06–0.1)`). Appropriate for dark surfaces. ✅ Static reads OK; visual verification deferred.

### 9. Scrollbar thumb

`::-webkit-scrollbar-thumb` uses `var(--rule)` with a `border: 2px solid var(--paper)`. Both tokens flip. ✅

## Surfaces requiring visual verification (user task)

Static analysis can catch hardcoded colors and obvious token-flip gaps. It **cannot** verify perceived contrast, text legibility, hover-state visibility, or animation ergonomics in dark mode. The following surfaces need a live pass:

- [ ] TopBar: logo + breadcrumb + variant switcher + theme toggle button
- [ ] OutlinePanel: paper card + search + outline entries + active-item left-bar
- [ ] PaperPage: title / venue / authors / affiliations / abstract / section headers / paragraph text
- [ ] Highlight rendering (`hl-yellow`) against dark ink
- [ ] SelectionToolbar: buttons, hover states, icons
- [ ] MarginColumn: MarginNote cards (5 variants — explain / summarize / translate / why / linked / error)
- [ ] SVG leader line (`ink-pen-draw`) visibility
- [ ] StatusRail: shortcut labels, BYOK dot (both foxglove and forest)
- [ ] TweaksPanel: toggles, slider, background
- [ ] WorkspacePanel: tab bar, Summary / Chat / Memory
- [ ] SummaryView: shimmer lines, ready-state text, ContextIndicator, regenerate button
- [ ] ChatView: welcome text, suggestions, user bubble, assistant text, citation superscripts, CitationCard, composer, SelectionPinnedChip
- [ ] MemoryView: whyItMatters headline, EditableField (edit-state border), quick-select buttons, linked cards, NextActionsSection input + delete-hover
- [ ] LibraryDrawer: backdrop / header / toolbar / search / group-by seg / has-memory checkbox / LibraryRow (spine, NOW badge, role chip, judgment quote, annotations counter) / empty state
- [ ] CmdK palette: backdrop / input / group headers / items (cursor vs normal) / kbd hints
- [ ] Options page: form inputs, error banner, save button
- [ ] Inline BYOK error (foxglove) at anchor in MarginColumn + top of Summary tab
- [ ] Toast (ToastHost): background + text contrast
- [ ] Paper grain overlay: subtle vs overwhelming

## Conclusions

No token-leakage bugs found statically. The color architecture routes consistently through CSS custom properties, and the two rgba backdrops are acceptable in both themes. The Phase 5 additions (`.ltx-block figure.ltx_figure img.ltx_graphics` invert/hue-rotate, `.paper-body color: inherit`) are the only new dark-mode risk; both are explicitly handled.

## Remaining concerns

- **Not verified visually.** All surfaces above need a live eye-pass before sign-off. Log as TODO if any fail.
- **Figure inversion heuristic.** `invert(1) hue-rotate(180deg)` works well for line drawings but can produce odd colors for photographs or diagrams with fill tints. If ar5iv papers with photographs surface issues in dark mode, consider a per-paper opt-out toggle or fall back to a grey box background behind the original image.
