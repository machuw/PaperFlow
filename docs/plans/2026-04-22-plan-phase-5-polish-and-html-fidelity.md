# PaperFlow Chrome Extension — Phase 5: Reading Polish + arXiv HTML Fidelity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Summary-tab polish items reported in `TODO.md` (#1–#4), give arXiv HTML mode full rich-content fidelity (TODO #5: preserve figures / MathML / tables from ar5iv), close the remaining Plan 1 review residuals (I3 API title scoping, I4 HTML-OK/API-fail partial load, I5 SW return-false hygiene), and add the §10 `chrome.storage.local` quota toast with a dark-mode audit pass.

**Architecture:** Summary fixes are a thin pass over `summary-view.tsx` + `main.tsx`. arXiv HTML fidelity extends `Paragraph` with an optional `html` field, widens `parseArxivHtml` to capture `innerHTML` / `<figure>` / `<div class="ltx_equation">` / `<table>` + rewrite relative `<img src>` to absolute arXiv URLs; `PaperPage` renders those blocks via `dangerouslySetInnerHTML` (safe — source is the extension's own fetch from the manifest host-permission whitelist). A small `ltx_*` CSS subset lives in `tokens.css` so LaTeXML output reads correctly without loading ar5iv's entire stylesheet. Storage quota handling wraps `chrome.storage.local.set` at a single choke point so every writer benefits.

**Tech Stack:** React 18, TypeScript 5 strict, Vitest. No new runtime deps — MathML is browser-native.

**Spec references:**
- §3.2 arXiv parser (extended with block capture)
- §3.8 AI error paths (no change — inline banner stays; quota toast is §10)
- §3.9 model-isolated Summary cache (no change)
- §8.2 Classic Summary tab (UX polish)
- §10 `chrome.storage.local` quota toast ("Storage is full. Clear some notes in Library.")

**TODO.md items addressed:** #1 (section order) · #2 (single refresh) · #3 (skeleton-until-done streaming) · #4 (abstract `data-pid="abs"`) · #5 (arXiv HTML fidelity).

**Plan 1 review residuals addressed:** I3 (parseArxivApi entry-scoped `<title>`) · I4 (HTML-OK/API-fail partial Paper construction) · I5 (SW `onMessage` non-matching branch `return false`).

**Not in Phase 5:**
- PDF canvas + text-layer rendering (TODO #6) — Plan 6
- Canvas mode (§8.3) — Plan 7
- Margin-note delete UI, highlight delete UI, `linked` edit UI (§10 v1 scope-out)
- Translate target language configurability (§10 v1.1)

---

## File Map

| File | Responsibility | Action |
|------|---|---|
| `chrome-extension/reader/components/summary-view.tsx` | Reorder sections; collapse streaming into skeleton; drop per-section refresh | Modify |
| `chrome-extension/reader/components/workspace-panel.tsx` | Drop per-section refresh prop; accept one `onSummaryRefreshAll` | Modify |
| `chrome-extension/reader/main.tsx` | Replace `onSummaryRefresh(section)` → `onSummaryRefreshAll()` | Modify |
| `chrome-extension/reader/components/paper-page.tsx` | `data-pid="abs"` on Abstract; render `html` blocks | Modify |
| `chrome-extension/reader/types.ts` | `Paragraph.html?: string` | Modify |
| `chrome-extension/reader/lib/arxiv.ts` | Capture `innerHTML`, figure / equation / table blocks; rewrite img URLs; entry-scoped title (I3); partial Paper on API fail (I4) | Modify |
| `chrome-extension/tests/fixtures/arxiv-html-real.html` | Extend with figure / equation / table blocks + `<img>` | Modify |
| `chrome-extension/tests/lib/arxiv.test.ts` | New tests for HTML capture + img rewrite + I3 + I4 | Modify |
| `chrome-extension/reader/styles/tokens.css` | `ltx_*` subset + theme coherence overrides | Modify |
| `chrome-extension/background/sw.ts` | `return false` on non-matching onMessage branches (I5) | Modify |
| `chrome-extension/reader/lib/storage.ts` | Wrap `set()` with quota-error detection; expose a toast hook | Modify |
| `chrome-extension/reader/main.tsx` | Register the quota-toast hook on mount | Modify |
| `docs/reviews/2026-04-22-review-dark-mode-audit.md` | Dark-mode visual pass results | Create |

---

## Task 1: Summary — reorder sections (TODO #1)

**Files:**
- Modify: `chrome-extension/reader/components/summary-view.tsx`

### Step 1: Change render order

Open `chrome-extension/reader/components/summary-view.tsx`. Find the iteration:

```tsx
      {(['threeLine', 'keyTerms', 'detailed'] as SummarySection[]).map((s) => (
        <SummarySectionView .../>
      ))}
```

Replace with:

```tsx
      {(['keyTerms', 'threeLine', 'detailed'] as SummarySection[]).map((s) => (
        <SummarySectionView .../>
      ))}
```

`SECTION_TITLES` and `REFRESHABLE` are keyed by section name, so they need no change.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/summary-view.tsx
git commit -m "fix(ext): reorder Summary sections — keyTerms → threeLine → detailed (TODO #1)"
```

---

## Task 2: Summary — single "Regenerate all" button (TODO #2)

**Files:**
- Modify: `chrome-extension/reader/components/summary-view.tsx`
- Modify: `chrome-extension/reader/components/workspace-panel.tsx`
- Modify: `chrome-extension/reader/main.tsx`

### Step 1: Replace per-section refresh with a single button in `summary-view.tsx`

Open `chrome-extension/reader/components/summary-view.tsx`.

Remove the `REFRESHABLE` constant and the per-section refresh button from `SummarySectionView`. The section header becomes title-only:

```tsx
function SummarySectionView({
  title, state,
}: { title: string; state: SectionState }) {
  return (
    <section>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--ink-faded)',
        marginBottom: 8,
      }}>{title}</div>

      {/* ...existing state-based body render, unchanged (state.kind branches)... */}
    </section>
  );
}
```

Change `Props.onRefresh: (section: SummarySection) => void` to `onRefreshAll: () => void`, destructure it, and drop the `onRefresh={() => onRefresh(s)}` prop from the `SummarySectionView` render. Keep the single top-of-stack regenerate button next to the ContextIndicator at the bottom:

```tsx
      <div style={{
        padding: '10px 12px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: 'var(--ink-faded)',
      }}>
        <I.Layers size={12} stroke={1.4} />
        <span style={{ flex: 1 }}>
          Generated from <strong style={{ color: 'var(--ink-soft)' }}>full paper</strong> · {chunks} chunks · via{' '}
          <span style={{ fontFamily: 'var(--font-mono)' }}>{model || '—'}</span>
        </span>
        <button
          onClick={onRefreshAll}
          disabled={isStreamingAny(state)}
          title="Regenerate all sections"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '3px 8px', borderRadius: 3,
            background: 'var(--paper)', color: 'var(--ink-soft)',
            border: '0.5px solid var(--rule)',
            opacity: isStreamingAny(state) ? 0.4 : 1,
            cursor: isStreamingAny(state) ? 'default' : 'pointer',
          }}
        >
          <I.Refresh size={10} stroke={1.4} /> Regenerate
        </button>
      </div>
```

Add the helper near the top of the file (below the type defs):

```typescript
function isStreamingAny(s: SummaryState): boolean {
  return s.threeLine.kind === 'streaming' || s.threeLine.kind === 'loading'
      || s.keyTerms.kind === 'streaming'  || s.keyTerms.kind === 'loading'
      || s.detailed.kind === 'streaming'  || s.detailed.kind === 'loading';
}
```

### Step 2: Update `workspace-panel.tsx` props

Open `chrome-extension/reader/components/workspace-panel.tsx`. Replace:

```typescript
  onSummaryRefresh: (section: SummarySection) => void;
```

with:

```typescript
  onSummaryRefreshAll: () => void;
```

Remove the now-unused `SummarySection` type import if it was imported only for this prop. Pass the new prop through to `SummaryView`:

```tsx
      <SummaryView
        paper={paper}
        state={summaryState}
        onRefreshAll={onSummaryRefreshAll}
        /* ...rest unchanged... */
      />
```

### Step 3: Replace `onSummaryRefresh` in `main.tsx`

Open `chrome-extension/reader/main.tsx`. Find the existing `onSummaryRefresh` useCallback and replace:

```typescript
  const onSummaryRefreshAll = useCallback(async () => {
    const config = await getConfig();
    if (!config || !config.apiKey) {
      setByokError({ id: `err-${Date.now()}`, paragraphId: paper.paragraphs[0]?.id ?? '' });
      return;
    }
    const pk = paperKey(effectivePaper);
    // Clear all three section caches for the current model, then re-trigger.
    await Promise.all([
      clearSummarySection(pk, 'threeLine', config.model),
      clearSummarySection(pk, 'keyTerms', config.model),
      clearSummarySection(pk, 'detailed', config.model),
    ]);
    setSummaryState({
      threeLine: { kind: 'idle' },
      keyTerms:  { kind: 'idle' },
      detailed:  { kind: 'idle' },
    });
    // Kick off all three fetches immediately (in parallel).
    fetchSection('threeLine');
    fetchSection('keyTerms');
    fetchSection('detailed');
  }, [effectivePaper, paper, fetchSection]);
```

Update the `<WorkspacePanel>` render prop from `onSummaryRefresh={onSummaryRefresh}` to `onSummaryRefreshAll={onSummaryRefreshAll}`.

### Step 4: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/summary-view.tsx \
  chrome-extension/reader/components/workspace-panel.tsx \
  chrome-extension/reader/main.tsx
git commit -m "fix(ext): single Regenerate button for all Summary sections (TODO #2)"
```

---

## Task 3: Summary — skeleton-until-done streaming (TODO #3)

**Files:**
- Modify: `chrome-extension/reader/components/summary-view.tsx`

### Step 1: Collapse streaming into the skeleton renderer

Open `chrome-extension/reader/components/summary-view.tsx`. Current logic in `SummarySectionView`:

```tsx
      {state.kind === 'loading' && <ShimmerLines />}
      {(state.kind === 'streaming' || state.kind === 'ready') && (
        <div className={state.kind === 'streaming' ? 'ink-streaming' : ''} ...>
          {state.body}
        </div>
      )}
```

Replace with a version that shows shimmer lines for both `loading` AND `streaming`, and only reveals content on `ready`:

```tsx
      {(state.kind === 'loading' || state.kind === 'streaming') && <ShimmerLines />}
      {state.kind === 'ready' && (
        <div
          style={{
            fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
            color: 'var(--ink-soft)', whiteSpace: 'pre-wrap',
            animation: 'fade-up 180ms ease-out',
          }}
        >{state.body}</div>
      )}
```

The `ink-streaming` class is removed here — the skeleton is the whole loading signal. The `fade-up` animation on `ready` gives a soft reveal instead of a flash.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/summary-view.tsx
git commit -m "fix(ext): skeleton-until-done for Summary streaming (TODO #3)"
```

---

## Task 4: Abstract — add `data-pid="abs"` (TODO #4)

**Files:**
- Modify: `chrome-extension/reader/components/paper-page.tsx`
- Modify: `chrome-extension/reader/components/selection-result-card.tsx`

### Step 1: Tag the Abstract block

Open `chrome-extension/reader/components/paper-page.tsx`. Find the Abstract render:

```tsx
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
```

Add `data-pid="abs"` to the inner content `<div>` so the selection resolver finds a parent anchor:

```tsx
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
          <div
            data-pid="abs"
            style={{
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
              color: 'var(--ink-soft)',
            }}
          >{paper.abstract}</div>
        </div>
      )}
```

### Step 2: Make `formatLoc` friendly to the `abs` sentinel in SelectionResultCard

Open `chrome-extension/reader/components/selection-result-card.tsx`. Find `formatLoc`:

```typescript
function formatLoc(paper: Paper, paragraphId: string): string {
  const idx = paper.paragraphs.findIndex((p) => p.id === paragraphId);
  if (idx === -1) return '¶ ?';
  /* ... */
}
```

Make the `abs` sentinel render as `Abstract`:

```typescript
function formatLoc(paper: Paper, paragraphId: string): string {
  if (paragraphId === 'abs') return 'Abstract';
  const idx = paper.paragraphs.findIndex((p) => p.id === paragraphId);
  if (idx === -1) return '¶ ?';
  const p = paper.paragraphs[idx];
  const outlineItem = paper.outline.find((o) => o.id === p.sectionId);
  const parts: string[] = [];
  if (outlineItem?.page != null) parts.push(`p. ${outlineItem.page}`);
  parts.push(`§${p.section}`);
  parts.push(`¶ p${idx + 1}`);
  return parts.join(' · ');
}
```

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/paper-page.tsx \
  chrome-extension/reader/components/selection-result-card.tsx
git commit -m "fix(ext): Abstract block is selectable (data-pid=abs) + formatLoc(Abstract) (TODO #4)"
```

---

## Task 5: Paragraph type — add optional `html` field

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/parse.ts`
- Modify: `chrome-extension/tests/lib/parse.test.ts`

**Spec reference:** TODO #5 data model extension. `html` is UI-only; AI callers (buildPaperContext, extractCitations) continue to use `text`.

### Step 1: Write a failing test

Open `chrome-extension/tests/lib/parse.test.ts`. Append:

```typescript
describe('buildParagraphs html passthrough', () => {
  const outline: OutlineItem[] = [
    { id: 'o0', label: '1 Intro', level: 0 },
  ];

  it('passes the optional html field through when provided', () => {
    const raw = [
      { outlineItemId: 'o0', text: 'plain text', html: '<p class="ltx_p">plain text</p>' },
    ];
    const out = buildParagraphs(raw, outline);
    expect(out[0].html).toBe('<p class="ltx_p">plain text</p>');
    expect(out[0].text).toBe('plain text');
  });

  it('leaves html undefined when absent from raw', () => {
    const raw = [{ outlineItemId: 'o0', text: 'plain' }];
    const out = buildParagraphs(raw, outline);
    expect(out[0].html).toBeUndefined();
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/parse.test.ts
```

Expected: fails — `html` property missing on `RawParagraph` type.

### Step 3: Extend the type + buildParagraphs

Open `chrome-extension/reader/types.ts`. Find `Paragraph`:

```typescript
export interface Paragraph {
  id: string;
  sectionId: string;
  section: string;
  text: string;
  important?: boolean;
}
```

Add `html`:

```typescript
export interface Paragraph {
  id: string;
  sectionId: string;
  section: string;
  text: string;       // AI context always uses this (plain)
  html?: string;      // UI prefers this when present (enriched HTML fragment)
  important?: boolean;
}
```

Open `chrome-extension/reader/lib/parse.ts`. Extend `RawParagraph`:

```typescript
export interface RawParagraph {
  outlineItemId: string;
  text: string;
  html?: string;
}
```

Update `buildParagraphs` to forward `html` when present:

```typescript
  return raw.map((r): Paragraph => {
    /* ...existing id / sectionId / section lookup... */
    const base: Paragraph = {
      id: `sec${sectionIdx}-p${pIdx}`,
      sectionId: outlineItem.id,
      section: outlineItem.label,
      text: r.text,
    };
    return r.html ? { ...base, html: r.html } : base;
  });
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/parse.test.ts
```

Expected: 5 tests pass (previous 3 + 2 new).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts \
  chrome-extension/reader/lib/parse.ts \
  chrome-extension/tests/lib/parse.test.ts
git commit -m "feat(ext): Paragraph.html? — optional enriched HTML for UI render (TODO #5 prep)"
```

---

## Task 6: parseArxivHtml — capture `innerHTML` on `ltx_para` (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`
- Modify: `chrome-extension/tests/fixtures/arxiv-html-real.html`

### Step 1: Extend the real fixture with inline math

Open `chrome-extension/tests/fixtures/arxiv-html-real.html`. In the first `<div class="ltx_para" id="S1.p1">`, replace the plain paragraph with one containing an inline `<math>` element:

```html
  <div class="ltx_para" id="S1.p1">
    <p class="ltx_p">Long-context transformers <math alttext="x^2"><msup><mi>x</mi><mn>2</mn></msup></math> have become central to agentic workflows.</p>
  </div>
```

The rest of the fixture stays as-is.

### Step 2: Write failing tests

Append to `chrome-extension/tests/lib/arxiv.test.ts` inside the existing `describe('parseArxivHtml — ar5iv real fixture', …)` block:

```typescript
  it('captures innerHTML of ltx_para paragraphs (preserves MathML)', () => {
    const first = paragraphs.find((p) => p.text.startsWith('Long-context transformers'));
    expect(first?.html).toBeTruthy();
    expect(first?.html).toContain('<math');
    expect(first?.html).toContain('<msup>');
    // text still plain
    expect(first?.text).toContain('Long-context transformers');
    expect(first?.text).not.toContain('<math');
  });

  it('leaves html undefined when the source is a bare <p> (no ltx_para wrapper)', () => {
    // Add a bare <p> case — uses the existing arxiv-html.html fixture from Phase 1
    const { paragraphs: bareParas } = parseArxivHtml(htmlFixture);
    // None of the Phase 1 fixture paragraphs use ltx_para wrappers.
    expect(bareParas.every((p) => p.html === undefined)).toBe(true);
  });
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: the new `captures innerHTML…` test fails — `first?.html` is undefined.

### Step 4: Capture `innerHTML` in parseArxivHtml

Open `chrome-extension/reader/lib/arxiv.ts`. Find the `ltx_para` branch inside the section-walking loop:

```typescript
      if (child.tagName === 'DIV' && child.classList.contains('ltx_para')) {
        const inner = Array.from(child.children).find(c => c.tagName === 'P') as HTMLParagraphElement | undefined;
        if (inner) {
          raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: inner.textContent?.trim() ?? '' });
        }
      }
```

Replace with:

```typescript
      if (child.tagName === 'DIV' && child.classList.contains('ltx_para')) {
        const inner = Array.from(child.children).find(c => c.tagName === 'P') as HTMLParagraphElement | undefined;
        if (inner) {
          raw.push({
            outlineItemId: sectionIdMap.get(sec)!,
            text: inner.textContent?.trim() ?? '',
            html: inner.innerHTML,
          });
        }
      }
```

The bare-`<p>` branch stays as-is (`html` not set → test 2 passes).

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all tests pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts \
  chrome-extension/tests/lib/arxiv.test.ts \
  chrome-extension/tests/fixtures/arxiv-html-real.html
git commit -m "feat(ext): parseArxivHtml captures ltx_para innerHTML (preserves MathML)"
```

---

## Task 7: parseArxivHtml — capture figure / equation / table blocks (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`
- Modify: `chrome-extension/tests/fixtures/arxiv-html-real.html`

### Step 1: Extend the fixture with figure / equation / table

Open `chrome-extension/tests/fixtures/arxiv-html-real.html`. Inside `<section class="ltx_section" id="S1">`, after the two existing `ltx_para` divs, add:

```html
  <figure class="ltx_figure" id="S1.F1">
    <img class="ltx_graphics" src="figures/overview.png" alt="Overview"/>
    <figcaption class="ltx_caption"><span class="ltx_tag">Figure 1.</span> Architecture overview.</figcaption>
  </figure>
  <div class="ltx_equation ltx_eqn_table" id="S1.E1">
    <math alttext="y=Wx+b"><mi>y</mi><mo>=</mo><mi>W</mi><mi>x</mi><mo>+</mo><mi>b</mi></math>
  </div>
  <figure class="ltx_table" id="S1.T1">
    <table class="ltx_tabular">
      <tr><td class="ltx_td">Baseline</td><td class="ltx_td">12.3</td></tr>
      <tr><td class="ltx_td">Ours</td><td class="ltx_td">7.1</td></tr>
    </table>
    <figcaption class="ltx_caption"><span class="ltx_tag">Table 1.</span> Results.</figcaption>
  </figure>
```

### Step 2: Write failing tests

Append to `chrome-extension/tests/lib/arxiv.test.ts` inside the same `describe('parseArxivHtml — ar5iv real fixture', …)`:

```typescript
  it('captures a <figure class="ltx_figure"> as its own paragraph-like block with html', () => {
    const fig = paragraphs.find((p) => p.html?.includes('<img class="ltx_graphics"'));
    expect(fig).toBeTruthy();
    expect(fig?.text).toContain('Architecture overview');
    expect(fig?.html).toContain('<figure');
    expect(fig?.html).toContain('Figure 1.');
  });

  it('captures a <div class="ltx_equation"> block with MathML preserved', () => {
    const eq = paragraphs.find((p) => p.html?.includes('ltx_equation'));
    expect(eq).toBeTruthy();
    expect(eq?.html).toContain('<math');
    expect(eq?.html).toContain('<mo>=</mo>');
    expect(eq?.text).toContain('y'); // textContent is just the symbol concat
  });

  it('captures a <figure class="ltx_table"> with nested table', () => {
    const tab = paragraphs.find((p) => p.html?.includes('ltx_table'));
    expect(tab).toBeTruthy();
    expect(tab?.html).toContain('<table');
    expect(tab?.html).toContain('Baseline');
    expect(tab?.html).toContain('Ours');
  });
```

### Step 3: Run to confirm failure

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: the three new tests fail — blocks not captured.

### Step 4: Extend parseArxivHtml's section loop

Open `chrome-extension/reader/lib/arxiv.ts`. Inside the `allSections.forEach(sec => { for (const child of …) { … } })` loop, after the existing `<p>` and `ltx_para` branches, add a block-capture branch:

```typescript
      // Figure / table / equation blocks — capture outerHTML as a paragraph-like entry.
      if (child.tagName === 'FIGURE' ||
          (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) ||
          child.tagName === 'TABLE') {
        raw.push({
          outlineItemId: sectionIdMap.get(sec)!,
          text: child.textContent?.trim() ?? '',
          html: child.outerHTML,
        });
        continue;
      }
```

Order: put this branch AFTER the `ltx_para` div check but BEFORE the loop continues, so `ltx_figure` and `ltx_table` (which are both `<figure>`) are caught here. `ltx_equation` is a `<div>` with that class — the check handles that specifically.

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all ar5iv tests pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts \
  chrome-extension/tests/lib/arxiv.test.ts \
  chrome-extension/tests/fixtures/arxiv-html-real.html
git commit -m "feat(ext): parseArxivHtml captures figure / equation / table blocks"
```

---

## Task 8: parseArxivHtml — rewrite relative `<img src>` to absolute (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Rationale:** ar5iv's figure `<img src>` is relative to the article URL (e.g. `figures/foo.png`). Once our reader HTML renders the fragment inside `chrome-extension://…`, relative URLs resolve against the extension origin — broken. Rewrite to absolute at parse time.

### Step 1: Write failing test

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
describe('parseArxivHtml img URL rewrite', () => {
  it('rewrites relative <img src> to absolute when baseUrl is supplied', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img class="ltx_graphics" src="figures/a.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/2402.18413v2' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://arxiv.org/html/2402.18413v2/figures/a.png"');
  });

  it('leaves absolute http/https <img src> alone', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="https://example.com/b.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://example.com/b.png"');
  });

  it('leaves data: <img src> alone', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="data:image/png;base64,iVBORw=="/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="data:image/png;base64,iVBORw=="');
  });

  it('skips rewriting when baseUrl is omitted (back-compat)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="figures/a.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="figures/a.png"');
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: fails — `parseArxivHtml` doesn't accept an options arg.

### Step 3: Add optional `baseUrl` and URL rewriting

Open `chrome-extension/reader/lib/arxiv.ts`. Change `parseArxivHtml`'s signature:

```typescript
export interface ParseArxivHtmlOptions {
  /** Absolute URL of the source ar5iv page. When supplied, relative <img src> in captured figures/equations/tables is rewritten to absolute. */
  baseUrl?: string;
}

export function parseArxivHtml(
  html: string,
  opts: ParseArxivHtmlOptions = {},
): { outline: OutlineItem[]; paragraphs: Paragraph[] } {
  /* existing body... */
}
```

Where the block-capture branch sets `html: child.outerHTML`, wrap with a rewrite when `opts.baseUrl` is present:

```typescript
      if (child.tagName === 'FIGURE' ||
          (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) ||
          child.tagName === 'TABLE') {
        const rawHtml = child.outerHTML;
        raw.push({
          outlineItemId: sectionIdMap.get(sec)!,
          text: child.textContent?.trim() ?? '',
          html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
        });
        continue;
      }
```

Add the helper at the bottom of `arxiv.ts`:

```typescript
/**
 * Rewrite relative <img src> URLs in an HTML fragment to absolute URLs
 * against baseUrl. Absolute URLs (http/https) and data: URIs are left alone.
 * Returns a new HTML string.
 */
function rewriteImgSrc(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const imgs = doc.querySelectorAll<HTMLImageElement>('img');
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute('src');
    if (!src) continue;
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
    try {
      const absolute = new URL(src, baseUrl + '/').href;
      img.setAttribute('src', absolute);
    } catch {
      // Invalid URL — leave as-is.
    }
  }
  const wrapper = doc.querySelector('div');
  // Unwrap: outerHTML of the first child (the original root element).
  return wrapper?.innerHTML ?? html;
}
```

Note on `new URL(src, baseUrl + '/')`: we append a trailing slash so relative paths resolve from the article directory (`.../2402.18413v2/figures/a.png`), not from the sibling file level. For `baseUrl = 'https://arxiv.org/html/2402.18413v2'`, the final is `'https://arxiv.org/html/2402.18413v2/figures/a.png'`.

### Step 4: Wire baseUrl in `loadArxivPaper`

Still in `chrome-extension/reader/lib/arxiv.ts`. Find `loadArxivPaper`:

```typescript
  const htmlUrl = `https://arxiv.org/html/${id}`;
  /* ... */
  const { outline, paragraphs } = parseArxivHtml(htmlText);
```

Pass the htmlUrl as baseUrl:

```typescript
  const { outline, paragraphs } = parseArxivHtml(htmlText, { baseUrl: htmlUrl });
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all tests pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts \
  chrome-extension/tests/lib/arxiv.test.ts
git commit -m "feat(ext): rewrite relative <img src> in ar5iv HTML to absolute URLs"
```

---

## Task 9: PaperPage — render enriched HTML when present

**Files:**
- Modify: `chrome-extension/reader/components/paper-page.tsx`

### Step 1: Branch on `Paragraph.html` in the body renderer

Open `chrome-extension/reader/components/paper-page.tsx`. Find `renderBody`, specifically the paragraph render:

```tsx
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
```

Replace with a version that prefers `html` for UI (highlights are skipped for HTML blocks — highlights over rich content would need DOM surgery, out of scope for this task). Keep the text branch intact for plain paragraphs:

```tsx
    const pHighlights = highlights.filter((h) => h.paragraphId === item.p.id);

    if (item.p.html) {
      // Enriched ar5iv HTML: render as-is. Highlights on rich blocks are
      // visual-only in v1 (TODO: deep-DOM highlight wrap is a later concern).
      return (
        <div
          key={i}
          data-pid={item.p.id}
          className="ltx-block paper-body"
          style={{
            ...bodyFont,
            fontSize: 14, lineHeight: 1.7,
            color: 'var(--ink)', margin: '0 0 14px',
          }}
          dangerouslySetInnerHTML={{ __html: item.p.html }}
        />
      );
    }

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
```

Selection / highlight / scroll-spy / MarginColumn anchoring all depend on `[data-pid]`, which is present on both branches.

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/paper-page.tsx
git commit -m "feat(ext): PaperPage renders ar5iv HTML blocks via dangerouslySetInnerHTML"
```

---

## Task 10: `ltx_*` CSS subset in tokens.css

**Files:**
- Modify: `chrome-extension/reader/styles/tokens.css`

### Step 1: Append ltx subset styles

Open `chrome-extension/reader/styles/tokens.css`. Append at the end:

```css
/* ========================================================================
   ar5iv / LaTeXML block rendering (Phase 5)
   Minimal subset of ltx_* classes needed for figures, equations, tables,
   and inline citations. MathML is rendered by the browser natively — no
   extra CSS needed for <math>.
   ======================================================================== */

.ltx-block figure.ltx_figure {
  margin: 24px 0;
  text-align: center;
}
.ltx-block figure.ltx_figure img.ltx_graphics {
  max-width: 100%;
  height: auto;
  mix-blend-mode: multiply;  /* Fold figure whites into --paper under light theme */
}
[data-theme="dark"] .ltx-block figure.ltx_figure img.ltx_graphics {
  mix-blend-mode: screen;
  filter: invert(1) hue-rotate(180deg);
}

.ltx-block figcaption.ltx_caption {
  margin-top: 10px;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.55;
}
.ltx-block figcaption.ltx_caption .ltx_tag {
  font-style: normal;
  font-weight: 600;
  color: var(--ink);
  margin-right: 4px;
}

.ltx-block div.ltx_equation,
.ltx-block table.ltx_eqn_table {
  margin: 18px 0;
  text-align: center;
  font-size: 14px;
  color: var(--ink);
  overflow-x: auto;   /* Wide equations scroll rather than overflow */
}

.ltx-block figure.ltx_table {
  margin: 24px 0;
}
.ltx-block table.ltx_tabular {
  margin: 0 auto;
  border-collapse: collapse;
  font-family: var(--font-serif);
  font-size: 12.5px;
  color: var(--ink-soft);
}
.ltx-block table.ltx_tabular td.ltx_td,
.ltx-block table.ltx_tabular th.ltx_th {
  padding: 4px 10px;
  border-top: 0.5px solid var(--rule);
  border-bottom: 0.5px solid var(--rule);
}

.ltx-block cite.ltx_cite {
  color: var(--walnut);
  font-style: normal;
  font-size: 0.92em;
}

.ltx-block a.ltx_ref {
  color: var(--walnut);
  text-decoration: none;
}
.ltx-block a.ltx_ref:hover { text-decoration: underline; }

/* Hide pagination / headers ar5iv sometimes injects inside sections */
.ltx-block .ltx_pagination,
.ltx-block .ltx_authors_ititle,
.ltx-block .ltx_dates { display: none; }
```

### Step 2: Theme coherence override for the paper body

Append immediately after the block above:

```css
/* Paper body: force inherited colors so ar5iv inline colors don't break
   the warm-paper palette. Applied to every child regardless of depth. */
.paper-body,
.paper-body * {
  color: inherit;
}
/* Preserve walnut accent on citation / ref links (override inherit). */
.paper-body .ltx_cite,
.paper-body .ltx_ref { color: var(--walnut); }
```

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0. `dist/assets/reader-*.css` should include the new rules.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/styles/tokens.css
git commit -m "feat(ext): ltx_* CSS subset + theme coherence for ar5iv blocks"
```

---

## Task 11: parseArxivApi — entry-scoped `<title>` (Plan 1 review I3) (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Spec reference:** Plan 1 review I3. The current `entry.querySelector('title')` inside `parseArxivApi` usually works, but a feed-level `<feed><title>…</title><entry>…</entry></feed>` can confuse certain XML parsers when entries appear in odd orders. Use an explicitly scoped child walk.

### Step 1: Write failing test

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
describe('parseArxivApi — I3 feed-title scoping', () => {
  it('picks the <entry><title> value, not the outer <feed><title>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=id_list:2402.18413</title>
  <entry>
    <id>http://arxiv.org/abs/2402.18413v2</id>
    <title>Contextual Residuals: A Lightweight Memory</title>
    <summary>We propose…</summary>
    <author><name>Khan, Y.</name></author>
    <published>2026-02-14T00:00:00Z</published>
    <category term="cs.LG"/>
  </entry>
</feed>`;
    const meta = parseArxivApi(xml);
    expect(meta.title).toBe('Contextual Residuals: A Lightweight Memory');
    expect(meta.title).not.toContain('ArXiv Query');
  });
});
```

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: the test **may pass already** — `entry.querySelector('title')` scopes to `entry`'s subtree. But we want to harden against edge cases by walking direct children. If the test already passes, that proves the existing behavior. If it fails, we fix it. Either way, Step 3 hardens the code with a clearer child walk.

### Step 3: Replace with direct child walk

Open `chrome-extension/reader/lib/arxiv.ts`. Find `parseArxivApi`:

```typescript
export function parseArxivApi(xml: string): ArxivApiMeta {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error('arXiv API: no <entry>');

  const title = entry.querySelector('title')?.textContent?.trim() ?? '';
  /* ... */
}
```

Add a helper and use it for fields that have a feed-level counterpart (`title`, potentially `published`):

```typescript
/**
 * First direct child with this tag name, text-content. Namespace-insensitive
 * (strips the xmlns prefix that atom feeds carry). Returns '' when absent.
 */
function entryChildText(entry: Element, localName: string): string {
  for (const child of Array.from(entry.children)) {
    // Atom feeds parsed as application/xml expose .localName; .tagName may
    // carry the namespace prefix. Prefer localName.
    if (child.localName === localName) return child.textContent?.trim() ?? '';
  }
  return '';
}

export function parseArxivApi(xml: string): ArxivApiMeta {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error('arXiv API: no <entry>');

  const title = entryChildText(entry, 'title');
  const abstract = entryChildText(entry, 'summary');
  const publishedIso = entryChildText(entry, 'published');

  const authors = Array.from(entry.querySelectorAll('author name'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
  const primaryCategory = entry.querySelector('category')?.getAttribute('term') ?? '';
  const publishedDate = publishedIso.slice(0, 10);

  return { title, authors, abstract, primaryCategory, publishedDate };
}
```

`authors` and `category` still use `querySelectorAll` because they're descendants (author/name is nested, category is a flat sibling). Those are already scoped to `entry` via the method receiver.

### Step 4: Run tests

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all tests pass (existing 20+ + 1 new).

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts \
  chrome-extension/tests/lib/arxiv.test.ts
git commit -m "fix(ext): parseArxivApi uses direct-child walk for title/summary/published (Plan 1 review I3)"
```

---

## Task 12: loadArxivPaper — HTML-OK / API-fail partial Paper (Plan 1 review I4) (TDD)

**Files:**
- Modify: `chrome-extension/reader/lib/arxiv.ts`
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Spec reference:** Plan 1 review I4. Current behavior: if the arXiv API fails but the HTML is fine, `loadArxivPaper` returns `{ kind: 'error' }` and the user sees a failure screen even though the paper text is available. Fix: fall back to HTML-derived title (from `<title>`) + empty abstract + empty authors + minimal venue.

### Step 1: Write failing test

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
describe('loadArxivPaper — I4 HTML-OK / API-fail fallback', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response('rate limited', { status: 429 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('returns ok with partial Paper when HTML loads but API fails', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error();
    // HTML extracted paragraphs — ok
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    // API-derived fields default to safe empty values
    expect(result.paper.authors).toEqual([]);
    expect(result.paper.abstract).toBe('');
    // Title comes from <title> in the HTML fixture or the paper's own h1
    expect(result.paper.title).toBeTruthy();
    // Venue is derived without category — spec says empty string in that case
    expect(result.paper.venue).toBe('');
  });
});
```

`htmlFixture` is the existing variable loaded from `arxiv-html.html` at the top of the test file.

### Step 2: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: `result.kind === 'error'` — existing code returns error on API fail.

### Step 3: Extract HTML title helper + partial-paper fallback

Open `chrome-extension/reader/lib/arxiv.ts`. Add a helper that pulls `<title>` out of the HTML string:

```typescript
/** Extract the `<title>` text from an HTML document for HTML-only fallback. */
function extractHtmlTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('title')?.textContent?.trim() ?? '';
}
```

Find `loadArxivPaper`'s error branch:

```typescript
  if (!htmlRes.ok) return { kind: 'error', message: `HTML fetch ${htmlRes.status}` };
  if (!apiRes.ok) return { kind: 'error', message: `API fetch ${apiRes.status}` };

  const [htmlText, apiText] = await Promise.all([htmlRes.text(), apiRes.text()]);
  const { outline, paragraphs } = parseArxivHtml(htmlText, { baseUrl: htmlUrl });
  const meta = parseArxivApi(apiText);
  const hash = await urlHash(htmlUrl);

  const paper: Paper = {
    id, urlHash: hash,
    title: meta.title,
    authors: meta.authors,
    abstract: meta.abstract,
    venue: buildVenue(id, meta.primaryCategory, meta.publishedDate),
    outline, paragraphs,
    memory: emptyMemory(),
  };
  return { kind: 'ok', paper };
```

Restructure so API failure becomes a degraded-but-OK path:

```typescript
  // HTML is the primary requirement. If it 404s, caller falls back to PDF.
  if (htmlRes.status === 404) return { kind: 'fallback-pdf' };
  if (!htmlRes.ok) return { kind: 'error', message: `HTML fetch ${htmlRes.status}` };

  const htmlText = await htmlRes.text();
  const { outline, paragraphs } = parseArxivHtml(htmlText, { baseUrl: htmlUrl });
  const hash = await urlHash(htmlUrl);

  // API is optional — on failure we still return ok with HTML-derived title
  // and empty author/abstract (spec §10.1 deviation + Plan 1 review I4).
  if (apiRes.ok) {
    const apiText = await apiRes.text();
    const meta = parseArxivApi(apiText);
    const paper: Paper = {
      id, urlHash: hash,
      title: meta.title,
      authors: meta.authors,
      abstract: meta.abstract,
      venue: buildVenue(id, meta.primaryCategory, meta.publishedDate),
      outline, paragraphs,
      memory: emptyMemory(),
    };
    return { kind: 'ok', paper };
  }

  // API-fail fallback
  const paper: Paper = {
    id, urlHash: hash,
    title: extractHtmlTitle(htmlText),
    authors: [],
    abstract: '',
    venue: '',
    outline, paragraphs,
    memory: emptyMemory(),
  };
  return { kind: 'ok', paper };
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all tests pass, including the new I4 fallback test.

### Step 5: Guard against caching the partial Paper in main.tsx

Open `chrome-extension/reader/main.tsx`. Find `loadPaper`:

```typescript
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
```

Skip the `setCachedParsed` call when the returned Paper is clearly partial (empty authors AND empty abstract — the API-fail fallback signature from Step 3). The paper still renders this session; the next reload will retry the API:

```typescript
    if (result.kind === 'ok') {
      const pk = paperKey(result.paper);
      // Skip caching when the API-fail fallback produced a partial Paper
      // (empty authors AND empty abstract) — next open retries the API.
      const isPartial = result.paper.authors.length === 0 && !result.paper.abstract;
      if (!isPartial) {
        await setCachedParsed(pk, {
          title: result.paper.title,
          authors: result.paper.authors,
          abstract: result.paper.abstract,
          venue: result.paper.venue,
          outline: result.paper.outline,
          paragraphs: result.paper.paragraphs,
        });
      }
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return result.paper;
    }
```

### Step 6: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 7: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/arxiv.ts \
  chrome-extension/tests/lib/arxiv.test.ts \
  chrome-extension/reader/main.tsx
git commit -m "fix(ext): loadArxivPaper returns partial Paper when API fails; main.tsx skips caching partials (Plan 1 I4)"
```

---

## Task 13: SW onMessage `return false` hygiene (Plan 1 review I5)

**Files:**
- Modify: `chrome-extension/background/sw.ts`

### Step 1: Explicit `return false` on non-matching branches

Open `chrome-extension/background/sw.ts`. Find the `onMessage` listener:

```typescript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'pdf-proxy-fetch' && typeof msg.url === 'string') {
    /* async handler */
    return true;  // keep sendResponse alive
  }
});
```

Append an explicit `return false` for non-matching kinds so future listeners or Chrome-side warnings don't hit an implicit `undefined` return:

```typescript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'pdf-proxy-fetch' && typeof msg.url === 'string') {
    /* async handler, unchanged */
    return true;
  }
  // Non-matching message — acknowledge synchronously (no async reply).
  // Returning false tells Chrome the port is closed for this message.
  return false;
});
```

### Step 2: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/background/sw.ts
git commit -m "fix(ext): SW onMessage returns false on non-matching kinds (Plan 1 I5)"
```

---

## Task 14: Storage quota toast (§10)

**Files:**
- Modify: `chrome-extension/reader/lib/storage.ts`
- Modify: `chrome-extension/reader/main.tsx`

**Spec reference:** §10 scope-out item — "write failures should toast 'Storage is full. Clear some notes in Library.'" The extension storage cap is ~10 MB; v1 doesn't provide eviction UI, just the toast.

### Step 1: Wrap `set()` with quota detection

Open `chrome-extension/reader/lib/storage.ts`. Find the private `set` helper:

```typescript
async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
```

Replace with a version that catches quota errors and forwards them to a registered callback:

```typescript
type QuotaHandler = () => void;
let onQuotaExceeded: QuotaHandler | null = null;

/**
 * Register a global callback for chrome.storage quota errors. Reader calls
 * this on mount with a toast-firing function. Only the latest registration
 * wins (there's only one reader instance at a time).
 */
export function setQuotaHandler(fn: QuotaHandler | null): void {
  onQuotaExceeded = fn;
}

async function set(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // chrome.storage throws with "QUOTA_BYTES" or "QUOTA_BYTES_PER_ITEM" in
    // the error text when it hits the 10 MB / 8 KB-per-item caps.
    if (msg.includes('QUOTA') || msg.toLowerCase().includes('quota')) {
      console.warn('[PaperFlow] storage quota exceeded:', msg);
      onQuotaExceeded?.();
    } else {
      console.error('[PaperFlow] storage set failed:', err);
    }
    // Re-throw so writers can catch + retry if they want. Most writers are
    // already fire-and-forget; the toast has already fired.
    throw err;
  }
}
```

### Step 2: Register the handler in main.tsx

Open `chrome-extension/reader/main.tsx`. Extend the storage import:

```typescript
import {
  /* existing list */,
  setQuotaHandler,
} from './lib/storage';
```

Inside `ViewerApp`, register once on mount:

```typescript
  useEffect(() => {
    setQuotaHandler(() => {
      setToast('Storage is full. Clear some notes in Library.');
    });
    return () => setQuotaHandler(null);
  }, []);
```

### Step 3: Typecheck + build

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck && npm run build
```

Expected: exit 0.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/storage.ts \
  chrome-extension/reader/main.tsx
git commit -m "feat(ext): toast on chrome.storage.local quota exceeded (§10)"
```

---

## Task 15: Dark-mode audit pass

**Files:**
- Create: `docs/reviews/2026-04-22-review-dark-mode-audit.md`
- Possibly modify: components / tokens.css if issues are found

**Rationale:** Phases 1–4 built out lots of surface area; dark mode has never had a systematic walk-through. This task runs a checklist and records findings. Fixes for anything that fails the pass are tiny one-line edits that ride with the audit commit (not their own tasks).

### Step 1: Load the extension and walk the checklist

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Load `dist/` in `chrome://extensions`. Open any arXiv paper. Toggle theme to dark (moon button in TopBar). For each surface below, note if text is legible, if borders/backgrounds combine cleanly, if color-mix-driven tints (highlights, margin note tones) still read. Record a pass/fail for each.

**Checklist surfaces:**
- [ ] TopBar: logo / Library button / breadcrumb / variant switcher / theme toggle / tweaks / workspace toggle
- [ ] OutlinePanel: paper card (title, authors, role chip) / search / outline entries / active-item bar
- [ ] PaperPage: title / venue / authors / affiliations / abstract / section headers / paragraph text
- [ ] Highlight rendering (`hl-yellow`) readability against dark ink
- [ ] SelectionToolbar: buttons, hover states, icons
- [ ] MarginColumn: MarginNote cards (all 5 variants — explain / summarize / translate / why / linked / error)
- [ ] SVG leader line (`ink-pen-draw`) visibility
- [ ] StatusRail: shortcut labels, BYOK dot (both foxglove and forest)
- [ ] TweaksPanel: toggles, slider, background
- [ ] WorkspacePanel: tab bar, Summary / Chat / Memory
- [ ] SummaryView: shimmer lines, ready-state text, ContextIndicator, regenerate button
- [ ] ChatView: welcome text, suggestions, user bubble, assistant text, citation superscripts, CitationCard, composer, SelectionPinnedChip
- [ ] MemoryView: whyItMatters headline, EditableField (role + judgment) — including edit-state border, quick-select buttons (both selected and unselected), linked cards, NextActionsSection add input + delete-hover
- [ ] LibraryDrawer: backdrop / header / toolbar / search / group-by seg / has-memory checkbox / LibraryRow (spine, NOW badge, role chip, judgment quote, annotations counter) / "no papers" empty state
- [ ] CmdK palette: backdrop / input / group headers / items (both cursor-highlighted and normal) / keyboard hint kbd
- [ ] Options page: form inputs, error banner, save button
- [ ] Inline BYOK error (foxglove) at anchor in MarginColumn + top of Summary tab
- [ ] Toast (ToastHost): background + text contrast
- [ ] Paper grain overlay: subtle vs overwhelming

### Step 2: Fix anything that failed

Most dark-mode issues fall in two buckets:

1. **A token reads wrong in dark.** Check `tokens.css` `[data-theme="dark"]` block — common miss is a hardcoded color (e.g. `#1A1812`) that should be `var(--ink)`.
2. **A `color-mix` produces invisible tint in dark.** Either use `--ink-faded` / `--walnut-soft` as the mix base OR guard with a `[data-theme="dark"]` override.

Edit the offending component or `tokens.css` directly — don't open new tasks for single-line fixes.

### Step 3: Write the audit document

Create `docs/reviews/2026-04-22-review-dark-mode-audit.md`:

```markdown
# Dark-mode audit — Phase 5

Date: 2026-04-22
Reviewer: (initials)
Base SHA: (pre-audit HEAD)

## Surfaces verified

(Paste the checklist above with ✅ / ❌ per item)

## Issues found + fixes

(For each ❌, describe the bug, root cause, and the one-line fix committed
alongside this audit)

## Remaining concerns

(Anything too big for a drive-by fix — log as a TODO.md entry)
```

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/reviews/2026-04-22-review-dark-mode-audit.md \
  chrome-extension/reader/styles/tokens.css \
  chrome-extension/reader/components/
git commit -m "docs(review): dark-mode audit + any token fixes"
```

---

## Task 16: Extended fixture — ensure the full HTML fidelity path round-trips

**Files:**
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`

**Rationale:** Tasks 6–8 each added narrow tests. This task adds an end-to-end guard that the full pipeline (`parseArxivHtml → buildParagraphs → PaperPage data model`) preserves `.html` on rich blocks and drops it on plain ones — so a future refactor can't silently regress.

### Step 1: Write the end-to-end test

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
describe('parseArxivHtml — end-to-end HTML fidelity', () => {
  it('round-trips rich blocks with html set and plain paragraphs with html unset', () => {
    const { paragraphs } = parseArxivHtml(realHtmlFixture, {
      baseUrl: 'https://arxiv.org/html/test/v1',
    });

    // Plain paragraphs in the fixture (ltx_para → <p class="ltx_p">):
    // those now get html set to the <p> innerHTML (after Task 6).
    const plainPara = paragraphs.find((p) => p.text.startsWith('Retrieval concatenates'));
    expect(plainPara?.html).toBeTruthy();
    expect(plainPara?.html).not.toContain('<figure');  // not a block

    // Figure / equation / table are their own entries with outerHTML preserved.
    expect(paragraphs.some((p) => p.html?.includes('<figure'))).toBe(true);
    expect(paragraphs.some((p) => p.html?.includes('ltx_equation'))).toBe(true);
    expect(paragraphs.some((p) => p.html?.includes('<table'))).toBe(true);

    // Figure <img src> is absolute.
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toMatch(/src="https:\/\/arxiv\.org\/html\/test\/v1\//);

    // sec{n}-p{m} ids remain contiguous + correct — MathML/figure/equation/
    // table didn't disrupt the numbering.
    expect(paragraphs[0].id).toBe('sec0-p0');
    expect(paragraphs.map((p) => p.id)).toEqual([...new Set(paragraphs.map((p) => p.id))]);
  });
});
```

### Step 2: Run

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/arxiv.test.ts
```

Expected: passes. (If ids have duplicates, Tasks 6/7 mis-ordered the loop — investigate.)

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/arxiv.test.ts
git commit -m "test(ext): end-to-end HTML fidelity round-trip guard"
```

---

## Task 17: Final — tests + typecheck + build + smoke

**Files:** (no source changes unless fixes required)

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected increments over Phase 4's 134:
- `parse.test.ts`: +2 (buildParagraphs html passthrough) → 5
- `arxiv.test.ts`: +2 (ltx_para innerHTML) +3 (figure/equation/table) +4 (img rewrite) +1 (I3) +1 (I4) +1 (end-to-end) → 16+12 = 28
Total: 134 + 14 = **~148**.

### Step 2: Typecheck + build

```bash
npm run typecheck
npm run build
```

Expected: exit 0 on both. `dist/` layout unchanged (reader / options / sw / content-IIFE).

### Step 3: Manual Chrome smoke test

Load `dist/` in `chrome://extensions`:

1. Navigate to `https://arxiv.org/html/2402.18413` (or any ar5iv-published paper).
2. Verify figures / equations / tables render inline in the paper column.
3. Confirm `<math>` elements display correctly (browsers render MathML natively).
4. Toggle dark mode — figures invert; text stays readable.
5. Select text inside the Abstract card → press `E` → AI call fires.
6. Open Classic → Summary tab. Verify order is **Key terms → Three-line summary → Detailed summary**.
7. Trigger Regenerate — single button at bottom next to ContextIndicator. All three sections re-show shimmer skeleton (no flicker), then swap to content with fade-up.
8. Throttle by filling storage (add 500+ highlights via devtools if necessary) → toast "Storage is full. Clear some notes in Library." fires.
9. Simulate API failure (block `export.arxiv.org` via devtools) → reload → paper still loads with HTML-derived title and empty abstract.

### Step 4: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 5 automated verification complete (2026-04-22):
- `npm test` → ~148 passed across 8 files
- `npm run typecheck` → exit 0
- `npm run build` → green
- Manual Chrome smoke test (ar5iv figures / equations / tables / Abstract selection / Summary order + single refresh + skeleton streaming / HTML-OK-API-fail fallback / quota toast / dark mode) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-22-plan-phase-5-polish-and-html-fidelity.md
git commit -m "docs(plan): Phase 5 verification log"
```

---

## Phase 5 Done Criteria

- ✅ Summary sections render in order **Key terms → Three-line summary → Detailed summary**
- ✅ A single "Regenerate" button replaces per-section refresh; disables while any section streams
- ✅ Streaming summary shows the shimmer skeleton for the entire duration, only revealing content with a `fade-up` on completion
- ✅ Abstract block is a valid selection anchor (`data-pid="abs"`); SelectionResultCard formatLoc renders `Abstract` for it
- ✅ arXiv HTML mode preserves MathML / `<img>` / `<table>` / equations via `Paragraph.html`; `parseArxivHtml` captures figure / equation / table blocks; relative image URLs rewritten to absolute
- ✅ `.paper-body` CSS coerces inherited colors + ltx subset styles figures/captions/tables/references
- ✅ Plan 1 I3 resolved: `parseArxivApi` uses direct-child walk for title / summary / published
- ✅ Plan 1 I4 resolved: `loadArxivPaper` returns partial Paper with HTML-derived title when API fails but HTML succeeds
- ✅ Plan 1 I5 resolved: SW `onMessage` returns `false` on non-matching branches
- ✅ §10 quota toast fires on `chrome.storage.local.set` failures
- ✅ Dark-mode audit complete; any trivial token fixes landed
- ✅ All unit tests pass (~148); typecheck clean; build green

## Next: Plan 6 and Plan 7

**Plan 6 — PDF canvas + text-layer rendering (TODO #6):** Replace the current text-only PDF path with full-fidelity `page.render()` + `text-layer` overlay. Map our `sec{n}-p{m}` paragraph ids onto the text-layer spans so existing selection / highlight / MarginColumn logic keeps working. CSS `mix-blend-mode: multiply` for light theme; `filter: invert(1) hue-rotate(180deg)` for dark. Estimated 1–2 weeks.

**Plan 7 — Canvas mode (§8.3):** `react-flow` + `dagre` for node-graph view of paper + outline + margin notes + linked papers. Node drag persistence to `paper:{key}:canvas`. Chat node as static preview of latest exchange. Estimated 10–14 tasks.

---

## Verification log

Phase 5 automated verification complete (2026-04-22):
- `npm test` → **151 passed** across 8 files (Phase 4 baseline 134 → +17 from Phase 5)
- `npm run typecheck` → exit 0
- `npm run build` → green (reader + options + sw + content-IIFE all emit)
- Manual Chrome smoke test (ar5iv figures / equations / tables / Abstract selection / Summary order + single refresh + skeleton streaming / HTML-OK-API-fail fallback / quota toast / dark mode) — deferred to user.
