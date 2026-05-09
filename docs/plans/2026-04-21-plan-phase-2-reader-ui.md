# PaperFlow Chrome Extension — Phase 2: Reader UI Migration + Highlights

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's JSON dump with a fully-browsable reader UI. Migrate the prototype (`PaperFlow Reader.html` + `components/*.jsx`) as typed TypeScript modules. Wire Focus + Classic variant switching, OutlinePanel with scroll spy, TopBar with page counter, TweaksPanel, highlights (H key, yellow). No AI yet — E/S/T/Ask actions show a "Plan 3" toast placeholder.

**Architecture:** React 18 component tree under `chrome-extension/reader/components/`. Per-component inline styles backed by `tokens.css` custom properties (same approach as the prototype — no CSS modules, no Tailwind). Reader shell in `main.tsx` owns variant/theme/tweaks/selection/highlight state; passes props down. Keyboard shortcuts global via `window.addEventListener('keydown', ...)`. Canvas variant is a placeholder pane in Phase 2 (react-flow lands in Plan 5).

**Tech Stack:** React 18, TypeScript 5 strict, CSS custom properties via `tokens.css`, no additional runtime deps (react-flow deferred to Plan 5).

**Spec references:**
- §3.2 arXiv parser refinements (Phase 1 review I1/I2 carryover)
- §3.3 Selection actions + keyboard handler + contenteditable exclusion
- §3.4 Highlight storage schema (`paper:{key}:highlights`)
- §3.5 Memory empty-state rules (affects Focus default margin notes)
- §3.6 Role standard values + `extractRolePrefix`
- §3.8 BYOK未配置 StatusRail dot (foxglove purple in Phase 2)
- §8.1 Focus mode + `findIntroParagraphs()` helper
- §8.2 Classic mode skeleton
- §8.4 OutlinePanel + `resolveOutlineTarget()` + scroll spy
- §9 TopBar + page counter
- §9.1 CmdK v1 command set

**Not in Phase 2:**
- AI features (all §3.7, §3.8 AI error paths, §3.9) — Plan 3
- Real margin note content (§8.1 streaming) — Plan 3; Focus variant renders only the outline defaults from memory, which are empty in Phase 2 (memory seeded by `emptyMemory()`)
- Classic Summary/Chat/Memory tab bodies (§8.2) — Plan 3 (Memory) + Plan 4 (Summary/Chat)
- Library drawer real data (§3.4) — Plan 4
- Canvas view (§8.3) — Plan 5
- CmdK AI commands (§9.1 Paper/Memory groups) — Plan 3/4
- Ask (?) action (§3.7.5) — Plan 4
- Options page BYOK form (§3.8 Configure API key) — Plan 3
- Remaining Plan 1 review items (I3 API `<title>` scoping, I4 API-only-fail partial load, I5 SW `return false`) — Plan 5

**Phase 2 also addresses Plan 1 review carryover:**
- **I1/I2** (Task 1): add a realistic ar5iv HTML fixture and update `parseArxivHtml` to traverse `<div class="ltx_para"><p>` wrapping; handle sections without headings; add tests.

---

## File Map

Files created or modified in Phase 2 (all paths relative to repo root):

| File | Responsibility |
|------|---------------|
| `chrome-extension/reader/lib/arxiv.ts` | **Modify**: handle `ltx_para` wrapping + heading-less sections |
| `chrome-extension/tests/lib/arxiv.test.ts` | **Modify**: new tests against real fixture |
| `chrome-extension/tests/fixtures/arxiv-html-real.html` | **Create**: trimmed real ar5iv HTML |
| `chrome-extension/reader/styles/tokens.css` | **Create**: copy of `/styles/tokens.css` + `--walnut-deep` |
| `chrome-extension/reader/components/icons.tsx` | **Create**: SVG icon components (typed from `/components/icons.jsx`) |
| `chrome-extension/reader/lib/paper.ts` | **Create**: `findIntroParagraphs`, `resolveOutlineTarget`, `extractRolePrefix` |
| `chrome-extension/tests/lib/paper.test.ts` | **Create**: unit tests for the above |
| `chrome-extension/reader/types.ts` | **Modify**: add `Highlight`, `Tweaks`, `ReaderVariant` types |
| `chrome-extension/reader/lib/storage.ts` | **Modify**: add highlight CRUD; reuse existing `keys.highlights` builder |
| `chrome-extension/tests/lib/storage.test.ts` | **Modify**: highlight round-trip test |
| `chrome-extension/reader/components/paper-page.tsx` | **Create**: paper body renderer with highlight injection |
| `chrome-extension/reader/components/selection-toolbar.tsx` | **Create**: floating toolbar on text selection |
| `chrome-extension/reader/components/outline-panel.tsx` | **Create**: left sidebar outline + scroll spy |
| `chrome-extension/reader/components/top-bar.tsx` | **Create**: top navigation bar + variant switcher |
| `chrome-extension/reader/components/status-rail.tsx` | **Create**: bottom status strip |
| `chrome-extension/reader/components/tweaks-panel.tsx` | **Create**: floating Tweaks popover |
| `chrome-extension/reader/components/workspace-panel.tsx` | **Create**: Classic variant right-drawer skeleton |
| `chrome-extension/reader/components/canvas-placeholder.tsx` | **Create**: Canvas variant "coming soon" view |
| `chrome-extension/reader/components/overlays.tsx` | **Create**: Library drawer + CmdK palette (placeholders) |
| `chrome-extension/reader/components/toast.tsx` | **Create**: minimal inline toast for "Plan 3" placeholder |
| `chrome-extension/reader/main.tsx` | **Rewrite**: ViewerApp shell (replace JSON dump) |
| `chrome-extension/reader/index.html` | **Modify**: link `tokens.css` |

**Total new files:** 13 components/helpers; 2 fixtures/tests. **Modified:** 5 (main.tsx, types.ts, storage.ts, arxiv.ts, index.html).

---

## Task 1: ar5iv fixture + parser refinement (Plan 1 I1/I2)

**Files:**
- Create: `chrome-extension/tests/fixtures/arxiv-html-real.html`
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Spec reference:** §3.2 arXiv HTML mode. Real ar5iv output wraps `<p>` inside `<div class="ltx_para">`, and occasionally produces `<section>` elements with no `<h2>/<h3>` heading (e.g. `<section class="ltx_bibliography">`). Plan 1's selector missed both cases.

- [ ] **Step 1: Save a realistic ar5iv fixture**

Create `chrome-extension/tests/fixtures/arxiv-html-real.html` with content that mirrors the ar5iv (LaTeXML) HTML structure — `<div class="ltx_para">` wrappers, nested `<section>` with numeric IDs (`S2.SS1`), and one heading-less section:

```html
<!DOCTYPE html>
<html>
<head><title>Test Paper</title></head>
<body>
<article class="ltx_document">
<section class="ltx_section" id="S1">
  <h2 class="ltx_title">1 Introduction</h2>
  <div class="ltx_para" id="S1.p1">
    <p class="ltx_p">Long-context transformers have become central to agentic workflows.</p>
  </div>
  <div class="ltx_para" id="S1.p2">
    <p class="ltx_p">We revisit the residual memory approach with a lightweight projection.</p>
  </div>
</section>
<section class="ltx_section" id="S2">
  <h2 class="ltx_title">2 Related Work</h2>
  <section class="ltx_subsection" id="S2.SS1">
    <h3 class="ltx_title">2.1 Retrieval-augmented LMs</h3>
    <div class="ltx_para" id="S2.SS1.p1">
      <p class="ltx_p">Retrieval concatenates external chunks into the prompt window.</p>
    </div>
    <div class="ltx_para" id="S2.SS1.p2">
      <p class="ltx_p">This works for QA but degrades on reasoning-heavy tasks.</p>
    </div>
  </section>
  <section class="ltx_subsection" id="S2.SS2">
    <h3 class="ltx_title">2.2 Landmark attention</h3>
    <div class="ltx_para" id="S2.SS2.p1">
      <p class="ltx_p">Landmark tokens anchor long-range attention to discrete positions.</p>
    </div>
  </section>
</section>
<section class="ltx_bibliography" id="bib">
  <div class="ltx_para" id="bib.p1">
    <p class="ltx_p">Khan, Y. et al. Contextual Residuals. 2026.</p>
  </div>
</section>
</article>
</body>
</html>
```

The third `<section id="bib">` has no `<h2>` — the parser must still treat it as a section (level 0, empty label) so its paragraph is captured.

- [ ] **Step 2: Write failing tests against the real fixture**

Append to `chrome-extension/tests/lib/arxiv.test.ts` (above the `loadArxivPaper` describe — right after the existing `parseArxivHtml` describe):

```typescript
const realHtmlFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-html-real.html'), 'utf-8'
);

describe('parseArxivHtml — ar5iv real fixture', () => {
  const { outline, paragraphs } = parseArxivHtml(realHtmlFixture);

  it('extracts paragraphs wrapped in <div class="ltx_para">', () => {
    const texts = paragraphs.map(p => p.text);
    expect(texts).toContain('Long-context transformers have become central to agentic workflows.');
    expect(texts).toContain('Retrieval concatenates external chunks into the prompt window.');
    expect(texts).toContain('Landmark tokens anchor long-range attention to discrete positions.');
  });

  it('produces outline entries for every <section[id]> including heading-less sections', () => {
    // S1, S2, S2.SS1, S2.SS2, bib → 5 items (bib has no heading but still surfaces as an entry)
    expect(outline).toHaveLength(5);
    const bibItem = outline[outline.length - 1];
    expect(bibItem.label).toBe('');
    expect(bibItem.level).toBe(0);
  });

  it('assigns sec{level0Idx}-p{n} ids with continuous counter across subsections', () => {
    // S1: 2 paragraphs → sec0-p0, sec0-p1
    // S2 (has 2 subsections with paragraphs, no direct paragraphs): sec1-p0, sec1-p1, sec1-p2
    // bib: sec2-p0
    const ids = paragraphs.map(p => p.id);
    expect(ids).toEqual(['sec0-p0', 'sec0-p1', 'sec1-p0', 'sec1-p1', 'sec1-p2', 'sec2-p0']);
  });

  it('deepest sectionId populates .section with subsection label', () => {
    const ragPara = paragraphs.find(p => p.text.startsWith('Retrieval concatenates'))!;
    expect(ragPara.section).toBe('2.1 Retrieval-augmented LMs');
    const landmarkPara = paragraphs.find(p => p.text.startsWith('Landmark tokens'))!;
    expect(landmarkPara.section).toBe('2.2 Landmark attention');
  });
});
```

- [ ] **Step 3: Run tests to confirm failures**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: the 4 new tests fail (`Retrieval concatenates...` not in paragraphs, outline length mismatch, etc.) because the current selector skips `<div class="ltx_para">`-wrapped `<p>`.

- [ ] **Step 4: Update `parseArxivHtml` to traverse `ltx_para` wrappers**

Open `chrome-extension/reader/lib/arxiv.ts`. Locate the paragraph-collection block:

```typescript
  // Paragraphs: for each section, take its direct <p> children (not descendants of inner section)
  allSections.forEach(sec => {
    const pEls = Array.from(sec.children).filter(c => c.tagName === 'P') as HTMLParagraphElement[];
    for (const p of pEls) {
      raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: p.textContent?.trim() ?? '' });
    }
  });
```

Replace with:

```typescript
  // Paragraphs: for each section, collect direct <p> children AND <p> elements
  // inside <div class="ltx_para"> direct children (real ar5iv output wraps each
  // paragraph in a <div class="ltx_para"> block). Do NOT descend into nested
  // <section[id]> — those are handled by their own sectionIdMap entry.
  allSections.forEach(sec => {
    for (const child of Array.from(sec.children) as HTMLElement[]) {
      if (child.tagName === 'P') {
        raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: child.textContent?.trim() ?? '' });
        continue;
      }
      // ar5iv wrapper: <div class="ltx_para"> contains exactly one <p class="ltx_p">
      if (child.tagName === 'DIV' && child.classList.contains('ltx_para')) {
        const inner = child.querySelector<HTMLParagraphElement>(':scope > p');
        if (inner) {
          raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: inner.textContent?.trim() ?? '' });
        }
      }
    }
  });
```

Also ensure the outline collection already handles heading-less sections. Look at the existing outline block:

```typescript
  allSections.forEach(sec => {
    const id = `o${counter++}`;
    sectionIdMap.set(sec, id);
    const parentSection = sec.parentElement?.closest('section[id]');
    const level = parentSection ? 1 : 0;
    const titleEl = sec.querySelector(':scope > h2, :scope > h3');
    const label = titleEl?.textContent?.trim() ?? '';
    outline.push({ id, label, level });
  });
```

This already produces `label: ''` when no heading exists — no change needed. The new test verifies this behavior explicitly.

- [ ] **Step 5: Run tests to confirm pass**

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all tests pass (original 12 + 4 new = 16 tests). Full suite should still be 44 passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/fixtures/arxiv-html-real.html \
  chrome-extension/tests/lib/arxiv.test.ts \
  chrome-extension/reader/lib/arxiv.ts
git commit -m "fix(ext): parseArxivHtml traverses ltx_para wrappers + heading-less sections"
```

---

## Task 2: Copy `tokens.css` + add `--walnut-deep` token

**Files:**
- Create: `chrome-extension/reader/styles/tokens.css`
- Modify: `chrome-extension/reader/index.html`

**Spec reference:** §3.6 "当前论文的 spine 不按 role 着色" — `--walnut-deep` token introduced to match Central role without collision.

- [ ] **Step 1: Copy `styles/tokens.css` verbatim**

```bash
mkdir -p /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension/reader/styles
cp /Users/mayuanchao/Workspace/PaperFlow-Design/styles/tokens.css \
   /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension/reader/styles/tokens.css
```

- [ ] **Step 2: Add `--walnut-deep` token to both themes**

Open `chrome-extension/reader/styles/tokens.css`. Inside the `:root {` block (light theme), right after the `--walnut-soft:` line, add:

```css
  --walnut-deep: color-mix(in oklch, var(--walnut) 70%, var(--ink));
```

The spec says this single definition adapts to dark mode automatically via `--walnut` and `--ink` token redefinition — so **do not** duplicate it inside the `[data-theme="dark"] {` block.

- [ ] **Step 3: Link `tokens.css` in reader shell**

Open `chrome-extension/reader/index.html`. Currently:

```html
<head>
  <meta charset="UTF-8" />
  <title>PaperFlow</title>
  <style>
    body { font-family: ui-monospace, monospace; padding: 24px; background: #FBF7EE; color: #1A1812; }
    pre { white-space: pre-wrap; word-wrap: break-word; max-width: 960px; }
    .err { color: #A34; }
    .status { color: #666; font-style: italic; }
  </style>
</head>
```

Replace the entire `<head>` with:

```html
<head>
  <meta charset="UTF-8" />
  <title>PaperFlow</title>
  <link rel="stylesheet" href="./styles/tokens.css"/>
</head>
```

The body's inline styles (background color, error color) are replaced by token-driven styles applied via React components. The `<pre>` styling is no longer needed because Phase 2 removes the JSON dump.

- [ ] **Step 4: Verify build picks up the CSS**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected:
- `dist/reader/styles/tokens.css` exists (or the CSS is inlined into reader HTML / reader-*.js asset — Vite 5 processes `<link>` href automatically)
- No build errors

Verify the token file ended up under `dist/`:

```bash
find dist -name "tokens.css" -o -name "*.css" | head -5
```

Expected: at least one CSS file under `dist/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/styles/tokens.css \
  chrome-extension/reader/index.html
git commit -m "feat(ext): copy tokens.css + add --walnut-deep token"
```

---

## Task 3: Icons module

**Files:**
- Create: `chrome-extension/reader/components/icons.tsx`

**Spec reference:** All reader components depend on SVG icons. The prototype's `components/icons.jsx` exports `I.Sparkle`, `I.Sidebar`, etc. Plan 2 migrates these as typed React components.

- [ ] **Step 1: Write `icons.tsx`**

Create `chrome-extension/reader/components/icons.tsx`:

```typescript
import { CSSProperties, SVGProps, ReactNode } from 'react';

interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
  d?: string;
  children?: ReactNode;
}

function Icon({ d, size = 16, stroke = 1.5, fill = 'none', style, children, ...rest }: IconProps & Omit<SVGProps<SVGSVGElement>, 'fill' | 'stroke' | 'strokeWidth'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill={fill} stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

type IconComponent = (p: Omit<IconProps, 'd' | 'children'>) => ReactNode;

// Subset of prototype icons actually used in Phase 2. More icons can be added
// as later Plans introduce new UI. Do not add icons speculatively.
export const I: Record<string, IconComponent> = {
  Sidebar:   (p) => <Icon {...p}><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></Icon>,
  Library:   (p) => <Icon {...p}><rect x="2.5" y="2.5" width="3" height="11" rx="0.5"/><rect x="6.5" y="2.5" width="3" height="11" rx="0.5"/><path d="M9.5 4.5l2.4-0.7 2.6 9.1-2.4 0.7z"/></Icon>,
  Command:   (p) => <Icon {...p}><path d="M5 5h6v6H5zM5 5a1.5 1.5 0 1 1 0-3M11 5a1.5 1.5 0 1 0 0-3M5 11a1.5 1.5 0 1 0 0 3M11 11a1.5 1.5 0 1 1 0 3"/></Icon>,
  Settings:  (p) => <Icon {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></Icon>,
  Sparkle:   (p) => <Icon {...p}><path d="M8 2.5l1.3 3.2L12.5 7l-3.2 1.3L8 11.5l-1.3-3.2L3.5 7l3.2-1.3z"/><path d="M12 11.5l0.5 1 1 0.5-1 0.5-0.5 1-0.5-1-1-0.5 1-0.5z"/></Icon>,
  Book:      (p) => <Icon {...p}><path d="M2.5 3.5a1 1 0 0 1 1-1H8v11H3.5a1 1 0 0 1-1-1zM13.5 3.5a1 1 0 0 0-1-1H8v11h4.5a1 1 0 0 0 1-1z"/></Icon>,
  Grid:      (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.5"/></Icon>,
  Layers:    (p) => <Icon {...p}><path d="M8 2.5L2 5.5l6 3 6-3zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></Icon>,
  Moon:      (p) => <Icon {...p}><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z"/></Icon>,
  Sun:       (p) => <Icon {...p}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></Icon>,
  Search:    (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></Icon>,
  Close:     (p) => <Icon {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></Icon>,
  Quote:     (p) => <Icon {...p}><path d="M3 6.5c0-2 1-3 2.5-3M3 6.5v3h2.5v-3zM9 6.5c0-2 1-3 2.5-3M9 6.5v3h2.5v-3z"/></Icon>,
  Translate: (p) => <Icon {...p}><path d="M2.5 4h5M5 2.5v1.5M3 4c0 2.5 2 5 4 5"/><path d="M7 9c-1.5 0-2.5-1-2.5-1"/><path d="M8.5 13.5l3-7 3 7M9.5 11.5h4"/></Icon>,
  Highlight: (p) => <Icon {...p}><path d="M10 2.5l3.5 3.5-6.5 6.5-3 0.5 0.5-3z"/><path d="M2.5 14h5"/></Icon>,
  Chat:      (p) => <Icon {...p}><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-0a1.5 1.5 0 0 1-1.5-1.5z"/></Icon>,
};
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/icons.tsx
git commit -m "feat(ext): icons module (typed SVG components)"
```

---

## Task 4: Paper helpers (`findIntroParagraphs`, `resolveOutlineTarget`, `extractRolePrefix`)

**Files:**
- Create: `chrome-extension/reader/lib/paper.ts`
- Create: `chrome-extension/tests/lib/paper.test.ts`

**Spec references:**
- `findIntroParagraphs` — §8.1 Focus default margin note anchoring
- `resolveOutlineTarget` — §8.4 OutlinePanel click-to-scroll
- `extractRolePrefix` — §3.6 Role standard values bridge

- [ ] **Step 1: Write failing tests**

Create `chrome-extension/tests/lib/paper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findIntroParagraphs, resolveOutlineTarget, extractRolePrefix } from '../../reader/lib/paper';
import type { OutlineItem, Paragraph, Paper } from '../../reader/types';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    urlHash: 'h1',
    title: 't',
    authors: [],
    abstract: '',
    outline: [],
    paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('findIntroParagraphs', () => {
  it('returns paragraphs whose sectionId matches an Introduction outline item', () => {
    const outline: OutlineItem[] = [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'intro a' },
      { id: 'sec0-p1', sectionId: 'o0', section: '1 Introduction', text: 'intro b' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'method' },
    ];
    const paper = makePaper({ outline, paragraphs });
    expect(findIntroParagraphs(paper).map(p => p.id)).toEqual(['sec0-p0', 'sec0-p1']);
  });

  it('is case-insensitive on Introduction detection', () => {
    const outline: OutlineItem[] = [{ id: 'o0', label: 'INTRODUCTION', level: 0 }];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: 'INTRODUCTION', text: 'x' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs }))).toHaveLength(1);
  });

  it('falls back to level-0 sectionIndex prefix when Introduction has no direct paragraphs', () => {
    // 1 Introduction (level-0, no direct paragraphs)
    //   1.1 Motivation (level-1, has paragraphs)
    const outline: OutlineItem[] = [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '1.1 Motivation', level: 1 },
      { id: 'o2', label: '2 Method', level: 0 },
    ];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o1', section: '1.1 Motivation', text: 'motiv a' },
      { id: 'sec0-p1', sectionId: 'o1', section: '1.1 Motivation', text: 'motiv b' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2 Method', text: 'm' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs })).map(p => p.id))
      .toEqual(['sec0-p0', 'sec0-p1']);
  });

  it('returns all paragraphs when no Introduction outline item exists', () => {
    const outline: OutlineItem[] = [{ id: 'o0', label: 'Preface', level: 0 }];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: 'Preface', text: 'a' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs }))).toEqual(paragraphs);
  });
});

describe('resolveOutlineTarget', () => {
  const outline: OutlineItem[] = [
    { id: 'o0', label: '1 Introduction', level: 0 },
    { id: 'o1', label: '2 Method', level: 0 },
    { id: 'o2', label: '2.1 Chunk', level: 1 },
  ];

  it('returns the first paragraph with matching sectionId', () => {
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'x' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2.1 Chunk', text: 'y' },
    ];
    const target = resolveOutlineTarget(outline[0], makePaper({ outline, paragraphs }));
    expect(target?.id).toBe('sec0-p0');
  });

  it('falls back to sectionIndex prefix for level-0 with only nested paragraphs', () => {
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'x' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2.1 Chunk', text: 'y' },  // belongs to level-0 "2 Method"
    ];
    // Looking up "2 Method" (level 0, no direct paragraph) should return the sec1-* paragraph
    const target = resolveOutlineTarget(outline[1], makePaper({ outline, paragraphs }));
    expect(target?.id).toBe('sec1-p0');
  });

  it('returns undefined for level-1 item with no matching paragraph', () => {
    const paragraphs: Paragraph[] = [];
    const target = resolveOutlineTarget(outline[2], makePaper({ outline, paragraphs }));
    expect(target).toBeUndefined();
  });
});

describe('extractRolePrefix', () => {
  it('returns standard value when prefix matches before " — "', () => {
    expect(extractRolePrefix('Background — a candidate alternative to RAG')).toBe('Background');
    expect(extractRolePrefix('Counter-evidence — §4 disagrees')).toBe('Counter-evidence');
  });

  it('returns standard value when string is exactly the standard', () => {
    expect(extractRolePrefix('Central')).toBe('Central');
    expect(extractRolePrefix('Ancestor')).toBe('Ancestor');
  });

  it('returns empty string when prefix is not a standard value', () => {
    expect(extractRolePrefix('background — lowercase fails')).toBe('');
    expect(extractRolePrefix('Counter — missing "-evidence"')).toBe('');
    expect(extractRolePrefix('Random text')).toBe('');
  });

  it('returns empty string for empty or whitespace input', () => {
    expect(extractRolePrefix('')).toBe('');
    expect(extractRolePrefix('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/paper.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement `paper.ts`**

Create `chrome-extension/reader/lib/paper.ts`:

```typescript
import type { OutlineItem, Paper, Paragraph } from '../types';

/**
 * Find the paragraphs belonging to the Introduction section (§8.1).
 * Matches the first level-0 outline item whose label contains "introduction"
 * (case-insensitive). If that item has no direct paragraphs (e.g. only
 * subsections), falls back to all paragraphs under the same level-0 range
 * via the sec{level0Index}-* id prefix (§3.2).
 */
export function findIntroParagraphs(paper: Paper): Paragraph[] {
  const introItem = paper.outline.find(
    (o) => o.level === 0 && o.label.toLowerCase().includes('introduction')
  );
  if (!introItem) return paper.paragraphs;

  const direct = paper.paragraphs.filter((p) => p.sectionId === introItem.id);
  if (direct.length > 0) return direct;

  const level0Index = paper.outline
    .filter((o) => o.level === 0)
    .findIndex((o) => o.id === introItem.id);
  return paper.paragraphs.filter((p) => p.id.startsWith(`sec${level0Index}-`));
}

/**
 * Resolve an OutlineItem to the paragraph the UI should scroll to (§8.4).
 * Tries direct sectionId match first; for level-0 items with only nested
 * paragraphs, falls back to the first paragraph whose id begins with
 * `sec{level0Index}-`. Returns undefined when no paragraph can be located.
 */
export function resolveOutlineTarget(
  item: OutlineItem,
  paper: Paper
): Paragraph | undefined {
  const direct = paper.paragraphs.find((p) => p.sectionId === item.id);
  if (direct) return direct;

  if (item.level === 0) {
    const level0Index = paper.outline
      .filter((o) => o.level === 0)
      .findIndex((o) => o.id === item.id);
    return paper.paragraphs.find((p) => p.id.startsWith(`sec${level0Index}-`));
  }
  return undefined;
}

const ROLE_STANDARDS = [
  'Background',
  'Method reference',
  'Counter-evidence',
  'Tangential',
  'Central',
  'Ancestor',
] as const;

/**
 * Extract a standard Role prefix from `PaperMemory.role` free text (§3.6).
 * Memory tab stores "Standard — free text"; Library/OutlinePanel need the
 * standard prefix alone. Returns '' when the prefix is not one of the 6
 * standard values.
 */
export function extractRolePrefix(s: string): string {
  if (!s || !s.trim()) return '';
  const head = s.split(' — ', 1)[0].trim();
  return (ROLE_STANDARDS as readonly string[]).includes(head) ? head : '';
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- tests/lib/paper.test.ts
```

Expected: 10 tests pass (findIntroParagraphs: 4, resolveOutlineTarget: 3, extractRolePrefix: 3).

- [ ] **Step 5: Typecheck full project**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/paper.ts \
  chrome-extension/tests/lib/paper.test.ts
git commit -m "feat(ext): paper helpers — findIntroParagraphs + resolveOutlineTarget + extractRolePrefix"
```

---

## Task 5: Highlight storage + types

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/tests/lib/storage.test.ts`

**Spec reference:** §3.4 Highlight storage schema `{ paragraphId, text, color: 'yellow' }[]`, key `paper:{paperKey}:highlights`. Multi-highlight-per-paragraph allowed; dedupe by `paragraphId + text`.

- [ ] **Step 1: Add `Highlight`, `Tweaks`, `ReaderVariant`, `TextSelection` types**

Open `chrome-extension/reader/types.ts`. Append at the end (after `emptyMemory`):

```typescript
export interface Highlight {
  paragraphId: string;
  text: string;
  color: 'yellow';   // v1: single color; schema reserves the field for future multi-color support (§3.4)
}

export type ReaderVariant = 'focus' | 'classic' | 'canvas';

export interface Tweaks {
  readerFont: 'serif' | 'sans';
  pageWidth: number;    // 560..900 (spec §9)
  margins: boolean;     // show margin notes column in Focus
  grain: boolean;       // paper-grain CSS class
}

export const DEFAULT_TWEAKS: Tweaks = {
  readerFont: 'serif',
  pageWidth: 720,
  margins: true,
  grain: true,
};

/**
 * Transient UI state: a text selection inside PaperPage, captured at mouseup.
 * Named `TextSelection` (not `Selection`) to avoid colliding with the DOM
 * `Selection` global type. Not persisted; lives in ViewerApp state.
 */
export interface TextSelection {
  text: string;
  rect: { left: number; top: number; right: number; bottom: number; width: number };
  paragraphId: string | null;
}
```

- [ ] **Step 2: Append failing highlight tests to `storage.test.ts`**

Open `chrome-extension/tests/lib/storage.test.ts`. Add imports at the top (merge into the existing imports from `storage`):

```typescript
import { getHighlights, setHighlights, addHighlight } from '../../reader/lib/storage';
import type { Highlight } from '../../reader/types';
```

Append a new describe block at the bottom:

```typescript
describe('highlights', () => {
  it('round-trips highlight array', async () => {
    const hs: Highlight[] = [
      { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' },
      { paragraphId: 'sec0-p1', text: 'bar', color: 'yellow' },
    ];
    await setHighlights('k1', hs);
    expect(await getHighlights('k1')).toEqual(hs);
  });

  it('returns empty array when absent', async () => {
    expect(await getHighlights('missing')).toEqual([]);
  });

  it('addHighlight appends and dedupes on paragraphId+text', async () => {
    await addHighlight('k1', { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' });
    await addHighlight('k1', { paragraphId: 'sec0-p1', text: 'bar', color: 'yellow' });
    // Duplicate (same paragraphId + text) — should not be added
    await addHighlight('k1', { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' });
    const got = await getHighlights('k1');
    expect(got).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage.test.ts
```

Expected: `getHighlights`/`setHighlights`/`addHighlight` not exported.

- [ ] **Step 4: Implement highlight wrappers in `storage.ts`**

Open `chrome-extension/reader/lib/storage.ts`. At the top of the file, extend the `types` import:

```typescript
import type { Paper, PaperMemory, Highlight } from '../types';
```

Append at the end of the file (after the existing `export const keys = k;`):

```typescript
export async function getHighlights(paperKey: string): Promise<Highlight[]> {
  return (await get<Highlight[]>(k.highlights(paperKey))) ?? [];
}

export async function setHighlights(paperKey: string, value: Highlight[]): Promise<void> {
  await set(k.highlights(paperKey), value);
}

/**
 * Append a highlight, deduped by paragraphId + text (§3.4).
 * Returns the updated list.
 */
export async function addHighlight(paperKey: string, h: Highlight): Promise<Highlight[]> {
  const existing = await getHighlights(paperKey);
  const isDup = existing.some((e) => e.paragraphId === h.paragraphId && e.text === h.text);
  if (isDup) return existing;
  const next = [...existing, h];
  await setHighlights(paperKey, next);
  return next;
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npm test -- tests/lib/storage.test.ts
```

Expected: 8 tests pass (original 5 + 3 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/storage.ts \
  chrome-extension/tests/lib/storage.test.ts
git commit -m "feat(ext): highlight types + storage wrappers (get/set/add with dedup)"
```

---

## Task 6: ViewerApp shell (replace JSON dump)

**Files:**
- Rewrite: `chrome-extension/reader/main.tsx`
- Create: `chrome-extension/reader/components/toast.tsx`

**Spec reference:** §8 three-variant reader; state owned at top level. Phase 2's shell must load paper data (as Phase 1 already does), but render `<ViewerApp>` instead of `<pre>{JSON}</pre>`. Child components arrive in Tasks 7–17; for this task we render a minimal placeholder for each region so the shell compiles and the page is navigable.

- [ ] **Step 1: Write `toast.tsx` — lightweight "Plan 3 placeholder" toast**

Create `chrome-extension/reader/components/toast.tsx`:

```typescript
import { useEffect, useState } from 'react';

/**
 * Single-slot toast controlled by setToast(). Plan 2 uses this for
 * placeholder messages (E/S/T/Ask "coming in Plan 3"). Replaced by
 * richer notifications in later Plans; keep the API narrow.
 */
interface ToastHandle {
  message: string;
  nonce: number;   // bump to force re-render even when message is same
}

let handle: ((h: ToastHandle) => void) | null = null;
let counter = 0;

export function setToast(message: string) {
  counter += 1;
  if (handle) handle({ message, nonce: counter });
}

export function ToastHost() {
  const [state, setState] = useState<ToastHandle | null>(null);

  useEffect(() => {
    handle = setState;
    return () => { handle = null; };
  }, []);

  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), 2600);
    return () => clearTimeout(t);
  }, [state?.nonce]);

  if (!state) return null;
  return (
    <div
      key={state.nonce}
      role="status"
      style={{
        position: 'fixed', bottom: 34, left: '50%', transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-2)',
        fontSize: 12, fontFamily: 'var(--font-sans)',
        color: 'var(--ink)',
        zIndex: 400,
        animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
    >
      {state.message}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `main.tsx` shell**

Overwrite `chrome-extension/reader/main.tsx` entirely:

```typescript
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
// @ts-ignore — vite ?url suffix
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { loadArxivPaper } from './lib/arxiv';
import { parsePdf } from './lib/pdf';
import { normalizeArxivId, paperKey, urlHash } from './lib/ids';
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory,
  getHighlights,
} from './lib/storage';
import { emptyMemory, DEFAULT_TWEAKS } from './types';
import type { Paper, ReaderVariant, Tweaks, Highlight, TextSelection } from './types';
import { ToastHost } from './components/toast';

// --- src URL extraction (Phase 1 logic preserved) ---
function readSrc(): string | null {
  if (location.hash.startsWith('#src=')) return location.hash.slice('#src='.length);
  return new URLSearchParams(location.search).get('src');
}

async function loadPaper(src: string): Promise<Paper> {
  const arxivId = normalizeArxivId(src);
  const hash = await urlHash(src);
  const key = arxivId ?? hash;

  const cached = await getCachedParsed(key);
  if (cached) {
    const mem = (await getMemory(key)) ?? emptyMemory();
    return {
      id: arxivId ?? undefined,
      urlHash: hash,
      title: cached.title,
      authors: cached.authors,
      abstract: cached.abstract,
      venue: cached.venue,
      outline: cached.outline,
      paragraphs: cached.paragraphs,
      memory: mem,
    };
  }

  if (arxivId) {
    const result = await loadArxivPaper(arxivId);
    if (result.kind === 'ok') {
      const pk = paperKey(result.paper);
      await setCachedParsed(pk, {
        title: result.paper.title,
        authors: result.paper.authors,
        abstract: result.paper.abstract,
        venue: result.paper.venue,
        outline: result.paper.outline,
        paragraphs: result.paper.paragraphs,
      });
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return result.paper;
    }
    if (result.kind === 'fallback-pdf') {
      return loadPdfPath(`https://arxiv.org/pdf/${arxivId}`, arxivId);
    }
    throw new Error(result.message);
  }

  return loadPdfPath(src, undefined);
}

async function loadPdfPath(pdfUrl: string, arxivId: string | undefined): Promise<Paper> {
  let buf: ArrayBuffer;
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = await res.arrayBuffer();
  } catch {
    const proxyRes = await chrome.runtime.sendMessage({ kind: 'pdf-proxy-fetch', url: pdfUrl });
    if (proxyRes?.kind !== 'ok') throw new Error(proxyRes?.message ?? 'SW proxy failed');
    const bin = atob(proxyRes.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buf = bytes.buffer;
  }

  const parsed = await parsePdf(buf);
  const hash = await urlHash(pdfUrl);
  const key = arxivId ?? hash;
  const filename = pdfUrl.split('/').pop()?.split('?')[0] ?? '';
  const venue = filename ? `PDF · ${filename}` : undefined;

  const paper: Paper = {
    id: arxivId,
    urlHash: hash,
    title: parsed.title,
    authors: parsed.authors,
    abstract: '',
    venue,
    outline: parsed.outline,
    paragraphs: parsed.paragraphs,
    memory: emptyMemory(),
  };
  await setCachedParsed(key, {
    title: paper.title, authors: paper.authors, abstract: paper.abstract,
    venue: paper.venue, outline: paper.outline, paragraphs: paper.paragraphs,
  });
  if (!(await getMemory(key))) await setMemory(key, emptyMemory());
  return paper;
}

// --- Persistent UI state (localStorage) ---
function usePersistedState<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const setWrap = (next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
  };
  return [v, setWrap];
}

// --- ViewerApp shell ---
function ViewerApp({ paper }: { paper: Paper }) {
  const [theme, setTheme] = usePersistedState<'light' | 'dark'>('pf-theme', 'light');
  const [variant, setVariant] = usePersistedState<ReaderVariant>('pf-variant', 'focus');
  const [tweaks, setTweaks] = usePersistedState<Tweaks>('pf-tweaks', DEFAULT_TWEAKS);
  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) =>
    setTweaks({ ...tweaks, [k]: v });

  const [outlineOpen, setOutlineOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // Seed highlights from storage on mount
  useEffect(() => {
    let cancelled = false;
    getHighlights(paperKey(paper)).then((hs) => {
      if (!cancelled) setHighlights(hs);
    });
    return () => { cancelled = true; };
  }, [paper]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  // Phase 2 placeholder layout — real components come in Tasks 7-17.
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper-deep)',
      color: 'var(--ink)',
      position: 'relative',
    }}>
      <div style={{
        height: 42, flexShrink: 0, background: 'var(--paper)',
        borderBottom: '0.5px solid var(--rule)',
        display: 'flex', alignItems: 'center', padding: '0 12px',
      }}>
        <span style={{ fontWeight: 600 }}>PaperFlow</span>
        <span style={{ marginLeft: 12, color: 'var(--ink-faded)', fontSize: 12 }}>
          {paper.title}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={toggleTheme} style={{ fontSize: 12, color: 'var(--ink-faded)' }}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ color: 'var(--ink-faded)', fontSize: 12, fontStyle: 'italic' }}>
          Reader shell scaffolded. Variant: {variant}. Outline: {paper.outline.length} items.
          Paragraphs: {paper.paragraphs.length}. Highlights: {highlights.length}.
          (Full UI lands in Tasks 7-17.)
        </div>
      </div>

      <ToastHost />
    </div>
  );
}

// --- Boot ---
function Boot() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; paper: Paper }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    const src = readSrc();
    if (!src) {
      setState({ kind: 'error', message: 'No #src= in URL' });
      return;
    }
    loadPaper(src)
      .then((paper) => setState({ kind: 'ok', paper }))
      .catch((err: Error) => setState({ kind: 'error', message: String(err.message ?? err) }));
  }, []);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--ink-faded)', fontStyle: 'italic' }}>Loading paper…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--foxglove)' }}>Error: {state.message}</div>;
  }
  return <ViewerApp paper={state.paper} />;
}

createRoot(document.getElementById('root')!).render(<Boot />);
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx chrome-extension/reader/components/toast.tsx
git commit -m "feat(ext): ViewerApp shell + Toast host (shell only; components wire in subsequent tasks)"
```

---

## Task 7: PaperPage component

**Files:**
- Create: `chrome-extension/reader/components/paper-page.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render `<PaperPage>`)

**Spec reference:** §3.2 section header rendering rule — group by `Paragraph.section`, no level-0 parent header (see §10.1 diff row "PaperPage section header 层级"). Drop the Figure placeholder (§10 out of scope). Each paragraph has `data-pid={p.id}`.

- [ ] **Step 1: Create `paper-page.tsx`**

Create `chrome-extension/reader/components/paper-page.tsx`:

```typescript
import { CSSProperties, MouseEvent, useRef } from 'react';
import type { Paper, Highlight, Paragraph, TextSelection } from '../types';

interface Props {
  paper: Paper;
  highlights: Highlight[];
  onSelect: (sel: TextSelection | null) => void;
  font: 'serif' | 'sans';
}

export function PaperPage({ paper, highlights, onSelect, font }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = (_e: MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !containerRef.current) {
      onSelect(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) { onSelect(null); return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const parentRect = containerRef.current.getBoundingClientRect();
    const start = range.startContainer;
    const pidEl = (start instanceof Element ? start : start.parentElement)?.closest('[data-pid]');
    onSelect({
      text,
      rect: {
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        right: rect.right - parentRect.left,
        bottom: rect.bottom - parentRect.top,
        width: rect.width,
      },
      paragraphId: pidEl?.getAttribute('data-pid') ?? null,
    });
  };

  const bodyFont: CSSProperties = {
    fontFamily: font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
  };

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} style={{ position: 'relative' }}>
      {/* Title block */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        {paper.venue && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)',
            letterSpacing: '0.04em', marginBottom: 14,
          }}>{paper.venue}</div>
        )}
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600,
          lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 14px',
          color: 'var(--ink)',
        }}>{paper.title}</h1>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-soft)',
          fontStyle: 'italic',
        }}>{paper.authors.join(', ')}</div>
        {paper.affiliations && paper.affiliations.length > 0 && (
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-faded)',
            marginTop: 4,
          }}>{paper.affiliations.join(' · ')}</div>
        )}
      </div>

      {/* Abstract — only render if non-empty (PDF mode leaves abstract = '') */}
      {paper.abstract && (
        <div style={{
          margin: '0 18px 30px', padding: '14px 18px',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faded)',
            letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase',
          }}>Abstract</div>
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
            color: 'var(--ink-soft)',
          }}>{paper.abstract}</div>
        </div>
      )}

      {/* Section headers + paragraphs */}
      {renderBody(paper, highlights, bodyFont)}
    </div>
  );
}

function renderBody(paper: Paper, highlights: Highlight[], bodyFont: CSSProperties) {
  const items: Array<{ type: 'h'; text: string } | { type: 'p'; p: Paragraph }> = [];
  let currentSection: string | null = null;
  for (const p of paper.paragraphs) {
    if (p.section !== currentSection) {
      items.push({ type: 'h', text: p.section });
      currentSection = p.section;
    }
    items.push({ type: 'p', p });
  }
  return items.map((item, i) => {
    if (item.type === 'h') {
      // Skip empty section labels (heading-less sections from §1 bib fixture etc.)
      if (!item.text) return null;
      return (
        <h2 key={i} style={{
          fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600,
          margin: '24px 0 10px', color: 'var(--ink)',
          letterSpacing: '-0.005em',
        }}>{item.text}</h2>
      );
    }
    const pHighlights = highlights.filter((h) => h.paragraphId === item.p.id);
    return (
      <p
        key={i}
        data-pid={item.p.id}
        style={{
          ...bodyFont,
          fontSize: 14, lineHeight: 1.7,
          color: 'var(--ink)', margin: '0 0 14px',
          textAlign: 'justify', hyphens: 'auto',
        }}
      >
        {pHighlights.length === 0 ? item.p.text : renderHighlighted(item.p.text, pHighlights)}
      </p>
    );
  });
}

/**
 * Render a paragraph with one or more highlights.
 * Per §3.4:
 * - Wrap only the first occurrence of each highlight.text in the paragraph.
 * - If two highlights overlap but aren't identical, the one added later is skipped (no wrap emitted).
 * - Non-overlapping highlights all render in source order.
 */
function renderHighlighted(text: string, highlights: Highlight[]): React.ReactNode[] {
  // Compute occupied ranges: for each highlight, find first index; skip if overlaps existing.
  type Seg = { start: number; end: number; color: Highlight['color'] };
  const segs: Seg[] = [];
  for (const h of highlights) {
    const start = text.indexOf(h.text);
    if (start === -1) continue;
    const end = start + h.text.length;
    const overlaps = segs.some((s) => !(end <= s.start || start >= s.end));
    if (overlaps) continue;
    segs.push({ start, end, color: h.color });
  }
  segs.sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  segs.forEach((s, i) => {
    if (cursor < s.start) out.push(text.slice(cursor, s.start));
    out.push(
      <span key={`hl${i}`} className={`hl-${s.color}`}>
        {text.slice(s.start, s.end)}
      </span>
    );
    cursor = s.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
```

- [ ] **Step 2: Wire `<PaperPage>` into ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add to imports:

```typescript
import { PaperPage } from './components/paper-page';
```

Inside the `ViewerApp` component, add selection state:

```typescript
  const [selection, setSelection] = useState<TextSelection | null>(null);
```

Replace the placeholder `<div>` body inside the shell with a real reader column:

```tsx
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        padding: '28px 24px 60px',
        display: 'flex', justifyContent: 'center',
      }}>
        <div
          className={tweaks.grain ? 'paper-grain' : ''}
          style={{
            width: tweaks.pageWidth,
            background: 'var(--paper)',
            border: '0.5px solid var(--rule)',
            borderRadius: 2,
            boxShadow: 'var(--shadow-2)',
            padding: '56px 60px 80px',
            position: 'relative',
            minHeight: 900,
          }}
        >
          <PaperPage
            paper={paper}
            highlights={highlights}
            onSelect={setSelection}
            font={tweaks.readerFont}
          />
        </div>
      </div>
```

Remove the `Reader shell scaffolded...` placeholder div.

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/paper-page.tsx chrome-extension/reader/main.tsx
git commit -m "feat(ext): PaperPage component renders real paragraphs + highlights"
```

---

## Task 8: SelectionToolbar

**Files:**
- Create: `chrome-extension/reader/components/selection-toolbar.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render, wire `onAction`)

**Spec reference:** §3.3 selection actions E/S/T/H/?.

- [ ] **Step 1: Create `selection-toolbar.tsx`**

```typescript
import { CSSProperties } from 'react';
import { I } from './icons';
import type { TextSelection } from '../types';

export type SelectionActionKind = 'explain' | 'summarize' | 'translate' | 'highlight' | 'ask';

interface Props {
  selection: TextSelection | null;
  onAction: (kind: SelectionActionKind, sel: TextSelection) => void;
  onClose: () => void;
}

export function SelectionToolbar({ selection, onAction, onClose }: Props) {
  if (!selection) return null;
  const { rect } = selection;
  const top = Math.max(rect.top - 44, 8);
  const left = Math.min(Math.max(rect.left + rect.width / 2, 120), 540);

  const actions: Array<{ id: SelectionActionKind; label: string; icon: keyof typeof I; kbd: string }> = [
    { id: 'explain',   label: 'Explain',    icon: 'Sparkle',   kbd: 'E' },
    { id: 'summarize', label: 'Summarize',  icon: 'Quote',     kbd: 'S' },
    { id: 'translate', label: 'Translate',  icon: 'Translate', kbd: 'T' },
    { id: 'highlight', label: 'Highlight',  icon: 'Highlight', kbd: 'H' },
    { id: 'ask',       label: 'Ask about…', icon: 'Chat',      kbd: '?' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top, left,
        transform: 'translateX(-50%)',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-2)',
        padding: '4px 4px',
        display: 'flex', alignItems: 'center', gap: 2,
        zIndex: 100,
        animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
      onMouseDown={(e) => e.preventDefault()}  // prevent losing selection on click
    >
      {actions.map((a) => {
        const Ico = I[a.icon];
        return (
          <button
            key={a.id}
            onClick={() => onAction(a.id, selection)}
            title={`${a.label} (${a.kbd})`}
            style={buttonStyle()}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            <Ico size={13} stroke={1.6} />
            {a.label}
          </button>
        );
      })}
      <div style={{ width: 1, height: 14, background: 'var(--rule)', margin: '0 2px' }} />
      <button
        onClick={onClose}
        style={{ ...buttonStyle(), width: 24, height: 24, padding: 0, justifyContent: 'center' }}
      >
        <I.Close size={12} />
      </button>
    </div>
  );
}

function buttonStyle(): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    color: 'var(--ink-soft)',
    fontSize: 12, fontWeight: 500,
    transition: 'background 120ms, color 120ms',
  };
}

function hoverOn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--paper-deep)';
  e.currentTarget.style.color = 'var(--ink)';
}
function hoverOff(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--ink-soft)';
}
```

- [ ] **Step 2: Wire the toolbar into ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add import:

```typescript
import { SelectionToolbar, SelectionActionKind } from './components/selection-toolbar';
import { setToast } from './components/toast';
```

Add `runAction` inside `ViewerApp` (above the `return`):

```typescript
  const runAction = (kind: SelectionActionKind, sel: TextSelection) => {
    if (kind === 'highlight') {
      // Implemented in Task 9 — just toast for now
      setToast('Highlight lands in Task 9.');
    } else {
      setToast('AI actions arrive in Plan 3.');
    }
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const closeSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
```

Inside the paper card (the same div where `<PaperPage>` lives in Task 7), add `<SelectionToolbar>`:

```tsx
        <PaperPage .../>
        <SelectionToolbar
          selection={selection}
          onAction={runAction}
          onClose={closeSelection}
        />
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/selection-toolbar.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): SelectionToolbar (actions stubbed with toast placeholder)"
```

---

## Task 9: Highlight wiring (H key + storage)

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.3 `H` key. `runAction('highlight', sel)` writes a highlight to `paper:{key}:highlights`, updates in-memory `highlights` state, and emits a brief `paragraph-pinged` animation.

- [ ] **Step 1: Replace the highlight toast with real storage wiring**

Open `chrome-extension/reader/main.tsx`. Extend the storage import:

```typescript
import { addHighlight } from './lib/storage';
```

Replace the `runAction` body's highlight branch:

```typescript
    if (kind === 'highlight') {
      if (!sel.paragraphId) {
        setToast('Selection must be inside a paragraph to highlight.');
        setSelection(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      (async () => {
        const next = await addHighlight(paperKey(paper), {
          paragraphId: sel.paragraphId!,
          text: sel.text,
          color: 'yellow',
        });
        setHighlights(next);
      })();
      // Ping animation on source paragraph
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-pid="${sel.paragraphId}"]`);
        if (!el) return;
        el.classList.add('paragraph-pinged');
        setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
      });
    } else {
      setToast('AI actions arrive in Plan 3.');
    }
```

Note: `paperKey` is already imported from `./lib/ids` in Task 6.

- [ ] **Step 2: Manual sanity test**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: exit 0, dist/ rebuilt. No unit tests for this path — it's UI wiring over already-tested primitives (`addHighlight`, `getHighlights`). Full-extension verification is manual at the end of Phase 2.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): H action persists highlight to storage + paragraph ping"
```

---

## Task 10: OutlinePanel (no scroll spy yet)

**Files:**
- Create: `chrome-extension/reader/components/outline-panel.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render when `outlineOpen`)

**Spec reference:** §8.4. Drop Topic chip + reading-time footer (§10 out of scope). Render Role chip from memory via `extractRolePrefix`.

- [ ] **Step 1: Create `outline-panel.tsx`**

```typescript
import { useState } from 'react';
import type { Paper, OutlineItem } from '../types';
import { extractRolePrefix, resolveOutlineTarget } from '../lib/paper';
import { I } from './icons';

interface Props {
  paper: Paper;
  activeSectionId: string | null;   // set by scroll spy (Task 11)
  onJump: (item: OutlineItem) => void;
}

// Role → spine color map per §3.6. Re-exported for Plan 4's Library.
export const ROLE_COLORS: Record<string, string> = {
  'Background': 'var(--walnut-soft)',
  'Method reference': 'var(--sky)',
  'Counter-evidence': 'var(--foxglove)',
  'Tangential': 'var(--ink-ghost)',
  'Central': 'var(--walnut)',
  'Ancestor': 'var(--forest)',
};

export function OutlinePanel({ paper, activeSectionId, onJump }: Props) {
  const [q, setQ] = useState('');
  const filtered = paper.outline.filter(
    (o) => !q || o.label.toLowerCase().includes(q.toLowerCase())
  );

  const role = extractRolePrefix(paper.memory.role);
  const firstAuthor = paper.authors[0]?.split(',')[0]?.trim() ?? '';

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderRight: '0.5px solid var(--rule)',
    }}>
      {/* Paper card */}
      <div style={{ padding: '14px 14px 12px', borderBottom: '0.5px solid var(--rule)' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', letterSpacing: '0.08em',
          textTransform: 'uppercase', marginBottom: 6,
        }}>Currently reading</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600,
          lineHeight: 1.3, color: 'var(--ink)', marginBottom: 6,
        }}>{paper.title}</div>
        {firstAuthor && (
          <div style={{
            fontSize: 11, color: 'var(--ink-faded)',
            fontStyle: 'italic', fontFamily: 'var(--font-serif)',
          }}>
            {firstAuthor}{paper.authors.length > 1 ? ' et al.' : ''}
            {paper.venue ? ` · ${paper.venue.split(' ')[0]}` : ''}
          </div>
        )}
        {role && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <RoleChip label={role} />
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          background: 'var(--paper-deep)',
          borderRadius: 6,
          border: '0.5px solid transparent',
        }}>
          <I.Search size={12} stroke={1.4} style={{ color: 'var(--ink-faded)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to section…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--ink)',
            }}
          />
        </div>
      </div>

      {/* Outline list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0 12px' }}>
        {filtered.map((item) => {
          const isActive = item.id === activeSectionId;
          return (
            <button
              key={item.id}
              onClick={() => onJump(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: `5px 12px 5px ${12 + item.level * 14}px`,
                textAlign: 'left', fontSize: 12,
                color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                fontWeight: isActive ? 600 : 400,
                fontFamily: item.level === 0 ? 'var(--font-sans)' : 'var(--font-serif)',
                position: 'relative', lineHeight: 1.35,
                background: 'transparent',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-deep)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: 6, bottom: 6, width: 2,
                  background: 'var(--walnut)', borderRadius: 2,
                }}/>
              )}
              <span style={{
                flex: 1, textOverflow: 'ellipsis', overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}>{item.label || <em style={{ color: 'var(--ink-ghost)' }}>(unlabeled)</em>}</span>
              {item.page != null && (
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--ink-ghost)',
                }}>{item.page}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoleChip({ label }: { label: string }) {
  const color = ROLE_COLORS[label] ?? 'var(--ink-ghost)';
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)',
      padding: '2px 6px',
      background: `color-mix(in oklch, ${color} 15%, transparent)`,
      color,
      borderRadius: 3,
      letterSpacing: '0.02em',
    }}>{label}</span>
  );
}

/** Scroll-into-view for the paragraph resolved from an outline item. */
export function scrollToOutlineItem(item: OutlineItem, paper: Paper) {
  const target = resolveOutlineTarget(item, paper);
  if (!target) {
    console.warn(`[PaperFlow] outline item has no resolvable paragraph: ${item.id} (${item.label})`);
    return;
  }
  const el = document.querySelector(`[data-pid="${target.id}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
```

- [ ] **Step 2: Render OutlinePanel in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add imports:

```typescript
import { OutlinePanel, scrollToOutlineItem } from './components/outline-panel';
```

Add activeSectionId state in `ViewerApp`:

```typescript
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
```

Replace the reader region (between TopBar placeholder and ToastHost) with a 2-column layout:

```tsx
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {outlineOpen && (
          <div style={{ width: 260, flexShrink: 0 }}>
            <OutlinePanel
              paper={paper}
              activeSectionId={activeSectionId}
              onJump={(item) => scrollToOutlineItem(item, paper)}
            />
          </div>
        )}

        <div style={{
          flex: 1, minWidth: 0, overflow: 'auto',
          padding: '28px 24px 60px',
          display: 'flex', justifyContent: 'center',
        }}>
          <div
            className={tweaks.grain ? 'paper-grain' : ''}
            style={{
              width: tweaks.pageWidth,
              background: 'var(--paper)',
              border: '0.5px solid var(--rule)',
              borderRadius: 2,
              boxShadow: 'var(--shadow-2)',
              padding: '56px 60px 80px',
              position: 'relative',
              minHeight: 900,
            }}
          >
            <PaperPage paper={paper} highlights={highlights} onSelect={setSelection} font={tweaks.readerFont} />
            <SelectionToolbar selection={selection} onAction={runAction} onClose={closeSelection} />
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/outline-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): OutlinePanel (search + role chip + click-to-scroll)"
```

---

## Task 11: Outline scroll spy

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.4 scroll spy rule — viewport-midline paragraph determines active outline item.

- [ ] **Step 1: Add scroll spy effect in ViewerApp**

Open `chrome-extension/reader/main.tsx`. First, give the reader column a ref so the handler can read its scroll position. Refactor the reader column wrapper:

```tsx
      {/* ref on the scrolling container */}
      <div
        ref={readerScrollRef}
        style={{
          flex: 1, minWidth: 0, overflow: 'auto',
          padding: '28px 24px 60px',
          display: 'flex', justifyContent: 'center',
        }}
      >
```

And add the ref declaration at the top of `ViewerApp`:

```typescript
import { useRef } from 'react';
// ...existing imports...

function ViewerApp({ paper }: { paper: Paper }) {
  // ...existing state...
  const readerScrollRef = useRef<HTMLDivElement>(null);
```

Add the scroll spy effect just before the `return (`:

```typescript
  useEffect(() => {
    const container = readerScrollRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const rect = container.getBoundingClientRect();
      const mid = rect.top + container.clientHeight / 2;
      const pEls = Array.from(container.querySelectorAll<HTMLElement>('[data-pid]'));
      if (pEls.length === 0) return;
      // Find the last paragraph whose top is <= viewport mid
      let chosen: HTMLElement | null = pEls[0];
      for (const el of pEls) {
        if (el.getBoundingClientRect().top <= mid) chosen = el;
        else break;
      }
      const pid = chosen?.getAttribute('data-pid');
      if (!pid) return;
      const para = paper.paragraphs.find((p) => p.id === pid);
      if (para) setActiveSectionId(para.sectionId);
    };

    const onScroll = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(compute, 120);
    };
    container.addEventListener('scroll', onScroll);
    // Compute once on mount so the first item is highlighted
    const initial = setTimeout(compute, 200);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(initial);
      container.removeEventListener('scroll', onScroll);
    };
  }, [paper]);
```

- [ ] **Step 2: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): outline scroll spy (viewport-midline paragraph → active sectionId)"
```

---

## Task 12: TopBar (+ page counter)

**Files:**
- Create: `chrome-extension/reader/components/top-bar.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render)

**Spec reference:** §9.

Page counter logic:
- HTML mode (no `page` field on any outline item): show `—/—`
- PDF mode (at least one outline item has `page`): show `p. {current}/{total}` where `total = unique page count`, `current` = page of the `activeSectionId`'s outline item

Note: spec §9's PDF rule (`pages[].offsetTop` scanning over rendered PDF page canvases) assumes rendered PDF canvases exist. Phase 2 does not render PDF page canvases — PDF paragraphs render as text like arXiv. So Phase 2 uses the outline-driven approximation above (current page = active section's page); when the user scrolls far inside a long page-worth of paragraphs, the counter still points to the right page because the scroll-spy tracks the active section. Full offsetTop-based counter is deferred to a later plan if/when PDF canvases are rendered. Document this as a §10.1 prototype diff row in Plan 5.

- [ ] **Step 1: Create `top-bar.tsx`**

```typescript
import { I } from './icons';
import type { Paper, OutlineItem, ReaderVariant } from '../types';

interface Props {
  paper: Paper;
  variant: ReaderVariant;
  setVariant: (v: ReaderVariant) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;

  outlineOpen: boolean;
  workspaceOpen: boolean;
  onToggleOutline: () => void;
  onToggleWorkspace: () => void;

  onOpenLibrary: () => void;
  onOpenCmdK: () => void;
  onOpenTweaks: () => void;

  activeSectionId: string | null;
}

export function TopBar(props: Props) {
  const { paper, variant, theme, outlineOpen, workspaceOpen, activeSectionId } = props;

  // Sidebar + Workspace toggles are disabled in Canvas variant (§9).
  // Workspace toggle is only meaningful in Classic; disable in Focus as well.
  const sidebarDisabled = variant === 'canvas';
  const workspaceDisabled = variant !== 'classic';

  const pageLabel = computePageLabel(paper, activeSectionId);

  return (
    <div style={{
      height: 42, flexShrink: 0,
      background: 'var(--paper)',
      borderBottom: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center', padding: '0 8px', gap: 2,
    }}>
      <IconToggle
        title="Toggle outline (⌘\)"
        active={outlineOpen}
        disabled={sidebarDisabled}
        onClick={props.onToggleOutline}
      ><I.Sidebar size={15} /></IconToggle>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 4px' }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4,
          background: 'var(--ink)', color: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-serif)', fontSize: 12, fontWeight: 700,
          fontStyle: 'italic',
        }}>P</div>
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: '-0.01em' }}>PaperFlow</span>
      </div>

      <div style={{ width: 0.5, height: 18, background: 'var(--rule)', margin: '0 4px' }} />

      <button
        onClick={props.onOpenLibrary}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 5,
          fontSize: 12, color: 'var(--ink-soft)',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <I.Library size={13} stroke={1.4} /> Library
      </button>

      {/* Breadcrumb */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, minWidth: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 12px',
          background: 'var(--paper-soft)',
          border: '0.5px solid var(--rule)',
          borderRadius: 999,
          maxWidth: 520, minWidth: 0,
        }}>
          <I.Book size={12} stroke={1.4} style={{ color: 'var(--ink-faded)', flexShrink: 0 }} />
          <span style={{
            fontSize: 12, color: 'var(--ink-soft)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          }}>{paper.title}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-ghost)', flexShrink: 0,
          }}>{pageLabel}</span>
        </div>
      </div>

      <IconButton title="Command (⌘K)" onClick={props.onOpenCmdK}>
        <I.Command size={14} />
      </IconButton>

      <VariantSwitcher variant={variant} setVariant={props.setVariant} />

      <IconButton title="Toggle theme" onClick={props.toggleTheme}>
        {theme === 'dark' ? <I.Sun size={14} /> : <I.Moon size={14} />}
      </IconButton>

      <IconButton title="Tweaks" onClick={props.onOpenTweaks}>
        <I.Settings size={14} />
      </IconButton>

      <IconToggle
        title="Toggle AI workspace"
        active={workspaceOpen && !workspaceDisabled}
        disabled={workspaceDisabled}
        onClick={props.onToggleWorkspace}
      ><I.Sparkle size={14} /></IconToggle>
    </div>
  );
}

function computePageLabel(paper: Paper, activeSectionId: string | null): string {
  const pages = paper.outline.filter((o) => o.page != null);
  if (pages.length === 0) return '—/—';
  const total = new Set(pages.map((o) => o.page)).size;
  const active: OutlineItem | undefined =
    activeSectionId ? paper.outline.find((o) => o.id === activeSectionId) : undefined;
  // Walk up to the nearest ancestor with a page (outline is flat in PDF mode so
  // this is usually a no-op; for arxiv HTML mode the outer check short-circuits)
  const current = active?.page ?? 1;
  return `p. ${current}/${total}`;
}

function VariantSwitcher({
  variant, setVariant,
}: { variant: ReaderVariant; setVariant: (v: ReaderVariant) => void }) {
  const opts: Array<{ id: ReaderVariant; label: string; icon: 'Book' | 'Grid' | 'Layers' }> = [
    { id: 'focus',   label: 'Focus',   icon: 'Book' },
    { id: 'classic', label: 'Classic', icon: 'Grid' },
    { id: 'canvas',  label: 'Canvas',  icon: 'Layers' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 5, padding: 2, margin: '0 4px',
    }}>
      {opts.map((o) => {
        const Ico = I[o.icon];
        const active = variant === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setVariant(o.id)}
            title={`${o.label} layout`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 3, fontSize: 11,
              color: active ? 'var(--ink)' : 'var(--ink-faded)',
              background: active ? 'var(--paper)' : 'transparent',
              boxShadow: active ? 'var(--shadow-1)' : 'none',
              transition: 'all 120ms', fontWeight: active ? 600 : 400,
            }}
          >
            <Ico size={11} stroke={1.5} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" title={title} onClick={onClick}>{children}</button>
  );
}

function IconToggle({
  title, active, disabled, onClick, children,
}: { title: string; active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="icon-btn"
      title={title}
      onClick={disabled ? undefined : onClick}
      style={{
        color: disabled ? 'var(--ink-ghost)' : active ? 'var(--ink)' : undefined,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >{children}</button>
  );
}
```

- [ ] **Step 2: Render TopBar in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add import:

```typescript
import { TopBar } from './components/top-bar';
```

Replace the placeholder top bar (`<div style={{height: 42, ...}}>` with "PaperFlow" span) with:

```tsx
      <TopBar
        paper={paper}
        variant={variant}
        setVariant={setVariant}
        theme={theme}
        toggleTheme={toggleTheme}
        outlineOpen={outlineOpen}
        workspaceOpen={workspaceOpen}
        onToggleOutline={() => setOutlineOpen(!outlineOpen)}
        onToggleWorkspace={() => setWorkspaceOpen(!workspaceOpen)}
        onOpenLibrary={() => setLibraryOpen(true)}
        onOpenCmdK={() => setCmdKOpen(true)}
        onOpenTweaks={() => setTweaksOpen(!tweaksOpen)}
        activeSectionId={activeSectionId}
      />
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/top-bar.tsx chrome-extension/reader/main.tsx
git commit -m "feat(ext): TopBar (variant switcher + theme + page counter + disabled-state toggles)"
```

---

## Task 13: StatusRail

**Files:**
- Create: `chrome-extension/reader/components/status-rail.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render, skip in Canvas)

**Spec reference:** §8.1 StatusRail layout; §3.8 BYOK dot. Phase 2 has no Options UI — the `config.apiKey` read always returns undefined, so the dot is foxglove purple and the right-side text is `"local memory · not configured · BYOK"`. The dot logic is isolated in this component so Plan 3 only needs to wire real config.

- [ ] **Step 1: Create `status-rail.tsx`**

```typescript
import { useEffect, useState } from 'react';

interface Props {
  /** Hidden in Canvas variant (§8.1). */
  hidden: boolean;
}

interface PaperFlowConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export function StatusRail({ hidden }: Props) {
  const [config, setConfig] = useState<PaperFlowConfig | null>(null);

  useEffect(() => {
    // chrome.storage.local.config holds BYOK config (Plan 3 Options page writes it).
    // In Phase 2 it is always undefined — the dot is foxglove purple.
    (async () => {
      try {
        const rec = await chrome.storage.local.get('config');
        setConfig((rec.config as PaperFlowConfig | undefined) ?? {});
      } catch {
        setConfig({});
      }
    })();
  }, []);

  if (hidden) return null;

  const configured = !!config?.apiKey;
  const dot = configured ? 'var(--forest)' : 'var(--foxglove)';
  const modelText = config?.model ?? 'not configured';

  return (
    <div style={{
      height: 24, flexShrink: 0,
      background: 'var(--paper)',
      borderTop: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 16,
      fontSize: 10, fontFamily: 'var(--font-mono)',
      color: 'var(--ink-faded)',
    }}>
      <span>⌘K commands</span>
      <span>⌘\ outline</span>
      <span>⌘L library</span>
      <span>E·S·T·H on selection</span>
      <div style={{ flex: 1 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: dot }} />
        local memory · {modelText} · BYOK
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Render StatusRail in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add import:

```typescript
import { StatusRail } from './components/status-rail';
```

Add `<StatusRail hidden={variant === 'canvas'} />` as the last child of the `ViewerApp`'s outermost div, immediately before `<ToastHost />`:

```tsx
      <StatusRail hidden={variant === 'canvas'} />
      <ToastHost />
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/status-rail.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): StatusRail (BYOK dot reads chrome.storage.config; hidden in Canvas)"
```

---

## Task 14: Keyboard shortcuts

**Files:**
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §3.3 keydown handler + contenteditable exclusion. Shortcuts:
- `⌘K` / `Ctrl+K` → open CmdK (toggle)
- `⌘\` / `Ctrl+\` → toggle outline
- `⌘L` / `Ctrl+L` → open Library
- Selection + no meta/ctrl:
  - `E/S/T` → AI action (Plan 2: toast)
  - `H` → highlight (implemented in Task 9)
  - `?` (Shift+`/`) → Ask (Plan 2: toast)

- [ ] **Step 1: Add keydown effect**

Open `chrome-extension/reader/main.tsx`. Inside `ViewerApp`, add this effect (any order before the `return`):

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore shortcuts when focus is in editable fields (§3.3 "监听排除可编辑元素").
      // ⌘/Ctrl combos are whitelisted because they don't conflict with typing.
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      // Global combos (always apply, even in editable fields)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdKOpen(true); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault(); setOutlineOpen(!outlineOpen); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault(); setLibraryOpen(true); return;
      }

      if (isEditable) return;
      if (!selection || e.metaKey || e.ctrlKey) return;

      const k = e.key.toLowerCase();
      if (k === 'e') { e.preventDefault(); runAction('explain', selection); }
      else if (k === 's') { e.preventDefault(); runAction('summarize', selection); }
      else if (k === 't') { e.preventDefault(); runAction('translate', selection); }
      else if (k === 'h') { e.preventDefault(); runAction('highlight', selection); }
      else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault(); runAction('ask', selection);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, outlineOpen]);
  // Note: outlineOpen is in deps because the handler flips it — stale closure would toggle wrong value.
  // runAction is defined inline in ViewerApp, so React's lint will accept it; selection identity change
  // will also re-subscribe and is intentional (selection-dependent branch).
```

- [ ] **Step 2: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx
git commit -m "feat(ext): global keydown handler (⌘K/⌘\\/⌘L + E·S·T·H·?)"
```

---

## Task 15: TweaksPanel

**Files:**
- Create: `chrome-extension/reader/components/tweaks-panel.tsx`
- Modify: `chrome-extension/reader/main.tsx` (render)

**Spec reference:** §9 Tweaks panel — Reading font, Page width, Margin notes, Paper grain. Drop Density (§10 out of scope).

- [ ] **Step 1: Create `tweaks-panel.tsx`**

```typescript
import type { Tweaks } from '../types';
import { I } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
}

export function TweaksPanel({ open, onClose, tweaks, setTweak }: Props) {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', top: 50, right: 10, zIndex: 150,
      width: 260,
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      boxShadow: 'var(--shadow-2)',
      padding: '14px 16px',
      animation: 'fade-up 140ms',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Tweaks</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          className="icon-btn"
          style={{ width: 22, height: 22 }}
        ><I.Close size={11} /></button>
      </div>

      <Row label="Reading font">
        <Seg
          value={tweaks.readerFont}
          onChange={(v) => setTweak('readerFont', v as 'serif' | 'sans')}
          options={[{ id: 'serif', label: 'Serif' }, { id: 'sans', label: 'Sans' }]}
        />
      </Row>

      <Row label="Page width">
        <input
          type="range" min={560} max={900} step={20}
          value={tweaks.pageWidth}
          onChange={(e) => setTweak('pageWidth', +e.target.value)}
          style={{ width: '100%', accentColor: 'var(--walnut)' }}
        />
      </Row>

      <Row label="Margin notes">
        <Seg
          value={tweaks.margins ? 'on' : 'off'}
          onChange={(v) => setTweak('margins', v === 'on')}
          options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
        />
      </Row>

      <Row label="Paper grain">
        <Seg
          value={tweaks.grain ? 'on' : 'off'}
          onChange={(v) => setTweak('grain', v === 'on')}
          options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--ink-faded)', marginBottom: 5,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Seg({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }> }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4, padding: 1.5,
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 3,
            color: value === o.id ? 'var(--ink)' : 'var(--ink-faded)',
            background: value === o.id ? 'var(--paper)' : 'transparent',
            fontWeight: value === o.id ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Render TweaksPanel in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add import:

```typescript
import { TweaksPanel } from './components/tweaks-panel';
```

Add `<TweaksPanel>` between the main reader region and `<StatusRail>`:

```tsx
      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        tweaks={tweaks}
        setTweak={setTweak}
      />
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/tweaks-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): TweaksPanel (font · page width · margins · grain)"
```

---

## Task 16: Classic WorkspacePanel skeleton + Canvas placeholder

**Files:**
- Create: `chrome-extension/reader/components/workspace-panel.tsx`
- Create: `chrome-extension/reader/components/canvas-placeholder.tsx`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §8.2 Classic WorkspacePanel tab bar + §8.3 Canvas (placeholder form).

Classic WorkspacePanel in Phase 2 shows a tab bar (Summary / Chat / Memory) but each body is a "Coming soon" card — content lands in Plan 3 (Memory), Plan 4 (Summary/Chat). Tab state lives in ViewerApp (`tab` state, persisted only in memory; no `localStorage` key yet).

- [ ] **Step 1: Create `workspace-panel.tsx`**

```typescript
import { CSSProperties } from 'react';

type Tab = 'summary' | 'chat' | 'memory';

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
}

export function WorkspacePanel({ tab, setTab }: Props) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderLeft: '0.5px solid var(--rule)',
    }}>
      <div style={{
        display: 'flex', borderBottom: '0.5px solid var(--rule)',
        padding: '8px 12px 0', gap: 2,
      }}>
        <TabBtn id="summary" label="Summary" active={tab} onClick={setTab} />
        <TabBtn id="chat"    label="Chat"    active={tab} onClick={setTab} />
        <TabBtn id="memory"  label="Memory"  active={tab} onClick={setTab} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        <Placeholder tab={tab} />
      </div>
    </div>
  );
}

function TabBtn({
  id, label, active, onClick,
}: { id: Tab; label: string; active: Tab; onClick: (t: Tab) => void }) {
  const isActive = active === id;
  const style: CSSProperties = {
    padding: '8px 12px', fontSize: 12,
    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
    borderBottom: isActive ? '2px solid var(--walnut)' : '2px solid transparent',
    marginBottom: -0.5,  // overlap the panel border
    fontWeight: isActive ? 600 : 400,
  };
  return <button onClick={() => onClick(id)} style={style}>{label}</button>;
}

function Placeholder({ tab }: { tab: Tab }) {
  const plan = tab === 'memory' ? 'Plan 3' : 'Plan 4';
  return (
    <div style={{
      padding: 18,
      border: '0.5px dashed var(--rule)',
      borderRadius: 8,
      color: 'var(--ink-faded)',
      fontSize: 12, fontStyle: 'italic',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 6, color: 'var(--ink-faded)',
      }}>{tab}</div>
      Arrives in {plan}.
    </div>
  );
}
```

- [ ] **Step 2: Create `canvas-placeholder.tsx`**

```typescript
import { I } from './icons';

interface Props {
  onBack: () => void;
}

export function CanvasPlaceholder({ onBack }: Props) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      background: 'var(--paper-deep)',
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '0.5px solid var(--rule)',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 999,
            fontSize: 12, color: 'var(--ink-soft)',
          }}
        >← Back to reader</button>
      </div>
      <div style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        color: 'var(--ink-faded)',
      }}>
        <I.Layers size={32} stroke={1.2} />
        <div style={{ fontSize: 14 }}>Canvas mode arrives in Plan 5.</div>
        <div style={{ fontSize: 12, fontStyle: 'italic' }}>
          Node-graph view of outline, margin notes, and linked papers.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire variant branching in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add imports:

```typescript
import { WorkspacePanel } from './components/workspace-panel';
import { CanvasPlaceholder } from './components/canvas-placeholder';
```

Add tab state in `ViewerApp`:

```typescript
  const [tab, setTab] = useState<'summary' | 'chat' | 'memory'>('summary');
```

Replace the reader region (from the outlineOpen-and-reader-column layout added in Task 10) with a variant-aware render:

```tsx
      {variant === 'canvas' ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CanvasPlaceholder onBack={() => setVariant('focus')} />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {outlineOpen && (
            <div style={{ width: 260, flexShrink: 0 }}>
              <OutlinePanel paper={paper} activeSectionId={activeSectionId}
                onJump={(item) => scrollToOutlineItem(item, paper)} />
            </div>
          )}
          <div
            ref={readerScrollRef}
            style={{
              flex: 1, minWidth: 0, overflow: 'auto',
              padding: '28px 24px 60px',
              display: 'flex', justifyContent: 'center',
            }}
          >
            <div
              className={tweaks.grain ? 'paper-grain' : ''}
              style={{
                width: tweaks.pageWidth,
                background: 'var(--paper)',
                border: '0.5px solid var(--rule)',
                borderRadius: 2,
                boxShadow: 'var(--shadow-2)',
                padding: '56px 60px 80px',
                position: 'relative', minHeight: 900,
              }}
            >
              <PaperPage paper={paper} highlights={highlights}
                onSelect={setSelection} font={tweaks.readerFont} />
              <SelectionToolbar selection={selection} onAction={runAction} onClose={closeSelection} />
            </div>
          </div>
          {workspaceOpen && variant === 'classic' && (
            <div style={{ width: 380, flexShrink: 0 }}>
              <WorkspacePanel tab={tab} setTab={setTab} />
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/components/canvas-placeholder.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): variant branching — Classic WorkspacePanel skeleton + Canvas placeholder"
```

---

## Task 17: Library drawer + CmdK placeholders

**Files:**
- Create: `chrome-extension/reader/components/overlays.tsx`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §9.1 CmdK v1 command set (subset in Phase 2: only `View` + `Jump` groups). Library drawer skeleton with "Coming in Plan 4" body.

- [ ] **Step 1: Create `overlays.tsx` with LibraryDrawer + CmdK**

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReaderVariant } from '../types';
import { I } from './icons';

/**
 * Library drawer — Phase 2 shell only. Real storage + row rendering come in Plan 4.
 */
interface LibraryProps {
  open: boolean;
  onClose: () => void;
}

export function LibraryDrawer({ open, onClose }: LibraryProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.35)',
        backdropFilter: 'blur(2px)',
        zIndex: 200, display: 'flex',
        animation: 'fade-in 150ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 80%)', height: '100%',
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'slide-in-right 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '0.5px solid var(--rule)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <I.Library size={16} stroke={1.5} />
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600,
          }}>Library</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="icon-btn"><I.Close size={14} /></button>
        </div>
        <div style={{
          flex: 1, padding: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            padding: 24,
            border: '0.5px dashed var(--rule)', borderRadius: 8,
            color: 'var(--ink-faded)', fontSize: 13, fontStyle: 'italic',
            textAlign: 'center', maxWidth: 420,
          }}>
            Your reading history with role tags, judgment notes, and memory
            links — coming in Plan 4.
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CmdK — Phase 2 v1 supports only View (variant switch) + Jump (Open Library).
 * Paper/Memory groups (AI commands) land in Plan 3/4.
 */
interface CmdKProps {
  open: boolean;
  onClose: () => void;
  variant: ReaderVariant;
  setVariant: (v: ReaderVariant) => void;
  onOpenLibrary: () => void;
}

interface CmdItem {
  id: string;
  group: string;
  label: string;
  kbd?: string;
  action: () => void;
}

export function CmdK({ open, onClose, variant, setVariant, onOpenLibrary }: CmdKProps) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<CmdItem[]>(() => [
    { id: 'view-focus',   group: 'View', label: 'Layout: Focus',   action: () => { setVariant('focus'); onClose(); } },
    { id: 'view-classic', group: 'View', label: 'Layout: Classic', action: () => { setVariant('classic'); onClose(); } },
    { id: 'view-canvas',  group: 'View', label: 'Layout: Canvas',  action: () => { setVariant('canvas'); onClose(); } },
    { id: 'lib',          group: 'Jump', label: 'Open Library', kbd: '⌘L', action: () => { onOpenLibrary(); onClose(); } },
  ], [setVariant, onOpenLibrary, onClose]);

  const filtered = items.filter((it) =>
    !q || it.label.toLowerCase().includes(q.toLowerCase())
  );

  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const grouped: Record<string, CmdItem[]> = {};
  for (const it of filtered) {
    grouped[it.group] = grouped[it.group] ?? [];
    grouped[it.group].push(it);
  }
  // Flat index for keyboard nav
  const flat = filtered;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); flat[cursor]?.action(); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.45)',
        zIndex: 250,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        style={{
          width: 520,
          background: 'var(--paper)',
          border: '0.5px solid var(--rule)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-3)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '10px 14px',
          borderBottom: '0.5px solid var(--rule)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <I.Command size={14} stroke={1.3} style={{ color: 'var(--ink-faded)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--ink)',
            }}
          />
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto', padding: '4px 0 8px' }}>
          {Object.entries(grouped).map(([group, rows]) => (
            <div key={group}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--ink-faded)', padding: '8px 14px 4px',
              }}>{group}</div>
              {rows.map((it) => {
                const i = flat.indexOf(it);
                const isActive = i === cursor;
                return (
                  <button
                    key={it.id}
                    onClick={it.action}
                    onMouseEnter={() => setCursor(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '7px 14px',
                      textAlign: 'left', fontSize: 13,
                      color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                      background: isActive ? 'var(--paper-deep)' : 'transparent',
                    }}
                  >
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.kbd && (
                      <kbd style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        padding: '1px 5px',
                        color: 'var(--ink-faded)',
                        background: 'var(--paper-soft)',
                        border: '0.5px solid var(--rule)',
                        borderRadius: 3,
                      }}>{it.kbd}</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div style={{
              padding: 20, color: 'var(--ink-faded)',
              fontSize: 12, fontStyle: 'italic', textAlign: 'center',
            }}>No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render overlays in ViewerApp**

Open `chrome-extension/reader/main.tsx`. Add import:

```typescript
import { LibraryDrawer, CmdK } from './components/overlays';
```

Add the overlays (before `<StatusRail>`):

```tsx
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <CmdK
        open={cmdKOpen}
        onClose={() => setCmdKOpen(false)}
        variant={variant}
        setVariant={setVariant}
        onOpenLibrary={() => setLibraryOpen(true)}
      />
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/overlays.tsx \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): Library drawer shell + CmdK (View + Jump groups)"
```

---

## Task 18: Final check — tests + typecheck + build + manual smoke

**Files:** (no source changes unless fixes required)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected: all tests pass (Phase 1's 40 + paper.test.ts's 10 + storage.test.ts's +3 + arxiv.test.ts's +4 → **~57 tests**).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0, no type errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit 0, `dist/` populated with `reader/index.html`, `reader/styles/tokens.css` (or hashed CSS asset), `assets/*`, `background/sw.js`, `content/inject.js`, `options/index.html`, `manifest.json`, `rules.json`.

Verify IIFE format for content script:

```bash
head -c 50 dist/content/inject.js
```

Expected: starts with `(function(){` or similar; no top-level `import`/`export`.

- [ ] **Step 4: Manual Chrome smoke test**

1. Open `chrome://extensions`, enable Developer mode, **remove the prior PaperFlow extension** if still loaded from Phase 1, click "Load unpacked" → select `chrome-extension/dist/`.
2. Navigate to `https://arxiv.org/html/2402.18413`. Expected:
   - Redirects to reader page.
   - TopBar shows paper title, `p. —/—` counter (arXiv HTML has no page info).
   - Left column: OutlinePanel with searchable sections; clicking a section scrolls the paper area.
   - Center: paper title, authors, venue, abstract, sections with paragraphs. Selecting text shows floating toolbar.
   - Bottom: StatusRail with foxglove-purple BYOK dot, text "local memory · not configured · BYOK".
3. Select text and press `H` → a highlight appears on the paragraph; ink-ping animation flashes; reloading the page preserves the highlight.
4. Select text and press `E` / `S` / `T` → toast "AI actions arrive in Plan 3." and selection clears.
5. Press `⌘K` → CmdK palette opens. Arrow keys navigate, Enter on "Layout: Classic" switches to Classic.
6. In Classic variant, the WorkspacePanel (right, 380px) shows three tabs with "Arrives in Plan 3/4" placeholders.
7. Press `⌘\` → OutlinePanel toggles closed. In Canvas variant the Sidebar toggle is greyed out. In Focus variant the Workspace toggle (Sparkle) is greyed out.
8. Click the Theme toggle → background/ink colors swap, `data-theme="dark"` is set on `<html>`, persists on reload.
9. Open TweaksPanel → Page width slider changes paper column width; Serif/Sans toggles body font; Margin notes toggle (visual change minimal in Phase 2 — margin column still empty until Plan 3); Paper grain toggle changes noise overlay.
10. Reload `https://arxiv.org/html/2402.18413` — second load hits cache (no network fetch to `arxiv.org/html/…` in DevTools Network tab); highlight state restored.
11. Navigate to a direct PDF URL (e.g. `https://arxiv.org/pdf/2402.18413.pdf`) — PDF mode parses paragraphs into "Page N" outline entries; TopBar shows `p. 1/N` and updates as you scroll past section boundaries.

- [ ] **Step 5: Commit fixes (if any)**

If any step 4 verification failed and required source changes, commit them:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/
git commit -m "chore(ext): Phase 2 smoke-test fixes"
```

If no fixes needed, skip this step.

- [ ] **Step 6: Append verification log to plan doc**

Append to this file (`docs/plans/2026-04-21-plan-phase-2-reader-ui.md`) at the bottom:

```markdown
---

## Verification log

Phase 2 verified against:
- `arxiv.org/html/2402.18413` → reader UI renders outline + paragraphs; scroll spy highlights active section
- `arxiv.org/pdf/2402.18413` → PDF path ok; page counter tracks via outline
- Highlights: H key adds highlight; persists across reloads; multiple highlights per paragraph render independently
- Theme + tweaks persist in localStorage; variant switcher cycles Focus/Classic/Canvas
- CmdK: View + Jump commands work; AI commands absent (correct for Phase 2)
```

Commit:

```bash
git add docs/plans/2026-04-21-plan-phase-2-reader-ui.md
git commit -m "docs(plan): Phase 2 verification log"
```

---

## Phase 2 Done Criteria

- ✅ Phase 1's JSON dump is gone — reader page renders the full UI shell (TopBar + OutlinePanel + PaperPage + SelectionToolbar + StatusRail + TweaksPanel)
- ✅ Variant switching (Focus ↔ Classic ↔ Canvas placeholder) persists across reloads
- ✅ Theme toggle (light/dark) persists via `data-theme` + localStorage
- ✅ Tweaks (font, page width, margins, grain) persist to `pf-tweaks`
- ✅ H key highlights text; highlights persist to `paper:{key}:highlights` and round-trip on reload
- ✅ OutlinePanel has live scroll spy (active section updates as reader scrolls)
- ✅ OutlinePanel click jumps to correct paragraph (uses `resolveOutlineTarget`)
- ✅ TopBar page counter shows `p. current/total` for PDF mode and `—/—` for HTML mode
- ✅ StatusRail BYOK dot is foxglove purple (no Options UI yet); Canvas variant hides StatusRail
- ✅ CmdK palette opens on ⌘K with View + Jump (Open Library) commands; arrow-key navigation + Enter to execute
- ✅ Library drawer opens on ⌘L; body is a "Coming in Plan 4" placeholder
- ✅ Canvas variant renders placeholder with Back-to-reader button
- ✅ Selection actions E/S/T/Ask emit placeholder toast; H key fully works
- ✅ Plan 1 review I1/I2 resolved: real ar5iv fixture passes; `ltx_para` wrappers and heading-less sections parse correctly
- ✅ All unit tests pass (~57); typecheck clean; build green

---

## Verification log

Phase 2 automated verification complete (2026-04-21):
- `npm test` → 58 passed across 6 files (ids 11, arxiv 16, parse 3, pdf 9, storage 8, paper 11)
- `npm run typecheck` → exit 0
- `npm run build` → green; `dist/` contains `manifest.json`, `rules.json`, `reader/index.html`, `reader/styles/…`, `options/index.html`, `background/sw.js`, `content/inject.js` (IIFE-wrapped, verified), `assets/*`
- Manual Chrome smoke test (load unpacked + arXiv/PDF/abs URLs + ⌘K/⌘\\/⌘L + variant switching + highlight persistence + theme) is user-driven and runs after merge.

## Next: Plan 3

Plan 3 introduces the Options page (BYOK form), `reader/lib/ai.ts` (OpenAI-compatible streaming), E/S/T action dispatch rendering real MarginNote components in Focus variant and SelectionResultCard in Classic, margin note persistence to `paper:{key}:notes`, the Memory tab in Classic's WorkspacePanel, and §3.8 error paths (no BYOK / network failures / stream abort).
