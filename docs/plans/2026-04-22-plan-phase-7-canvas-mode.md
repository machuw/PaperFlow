# Phase 7 — Canvas Mode (react-flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `CanvasPlaceholder` with a real Canvas variant (§8.3): a full-screen react-flow graph that shows the paper as a central node with outline sections, margin notes, memory (whyItMatters + 3-line summary + linked), and a static preview of the last Chat exchange — all draggable, persisted per-paper.

**Architecture:** Two pure helpers produce graph shape: `buildCanvasGraph(paper, notes, chat)` returns `{ nodes, edges }` from current state; `applyDagreLayout(nodes, edges)` runs dagre to assign initial positions. The `CanvasView` component uses `@xyflow/react` with our custom node components, hydrates layout from `chrome.storage.local` (`paper:{key}:canvas`) on mount, writes back on drag-stop (100 ms debounce). Warm-paper styling via CSS overrides.

**Tech Stack:** `@xyflow/react` (v12+), `dagre` (v0.8+), existing React 18 + TypeScript + vitest + pdfjs-dist + vite.

**Scope:** Only §8.3 Canvas mode. Explicitly **out of scope** (defer to a later Plan 8 polish bundle):
- TODO #7 quota error contract decision
- TODO #8 quota path test coverage
- TODO #9 rich-block AI citation prettification
- TODO #10 / #13 highlight fidelity (ar5iv rich-block + PDF canvas paint)
- Phase 6 follow-ups: future-zoom effect rebuild, scroll-spy page-element cache (both PdfPage/reader concerns, not Canvas)
- Canvas-internal Chat input (spec §8.3: "v1 仅静态预览最近一次对话")
- Canvas-side highlight rendering, selection actions, TOC-click-to-scroll

---

## Pre-read

1. `chrome-extension/reader/components/canvas-placeholder.tsx` — current stub to delete.
2. `chrome-extension/reader/main.tsx:839-842` — Canvas variant branch.
3. `components/canvas-view.jsx` (prototype) — visual reference; we reimplement with react-flow while keeping the visual grammar.
4. `chrome-extension/reader/lib/storage.ts` — `keys.canvas(paperKey)` is already defined (line 18); we add get/set helpers.
5. `chrome-extension/reader/types.ts` — `Paper`, `OutlineItem`, `PaperMemory`, `MarginResult`, `ChatMessage`.
6. Spec: `docs/specs/2026-04-20-spec-chrome-extension.md` §8.3 (Canvas mode), §3.4 (memory data), §3.7 (chat history shape).

## File structure

**Create:**
- `chrome-extension/reader/lib/canvas-graph.ts` — pure: `buildCanvasGraph(paper, notes, chat): { nodes: CanvasNode[]; edges: CanvasEdge[] }`.
- `chrome-extension/reader/lib/canvas-layout.ts` — pure: `applyDagreLayout(nodes, edges): CanvasNode[]` — returns nodes with `position` filled.
- `chrome-extension/reader/components/canvas-view.tsx` — react-flow wrapper; also exports the 5 custom node components inline (Paper, Section, Note, Linked, Chat).
- `chrome-extension/tests/lib/canvas-graph.test.ts` — pure unit tests (6–8 assertions).
- `chrome-extension/tests/lib/canvas-layout.test.ts` — pure unit tests (3–4 assertions).

**Modify:**
- `chrome-extension/package.json` — add `@xyflow/react` + `dagre` + `@types/dagre` deps.
- `chrome-extension/reader/types.ts` — add `CanvasLayout`, `CanvasNode`, `CanvasEdge` types.
- `chrome-extension/reader/lib/storage.ts` — add `getCanvasLayout` / `setCanvasLayout`.
- `chrome-extension/reader/main.tsx` — replace `CanvasPlaceholder` import + render with `CanvasView`.
- `chrome-extension/reader/styles/tokens.css` — react-flow CSS overrides for warm-paper coherence + dark-mode.

**Delete:**
- `chrome-extension/reader/components/canvas-placeholder.tsx`.

---

## Task 1: Install `@xyflow/react` + `dagre` dependencies

**Files:**
- Modify: `chrome-extension/package.json`

### Step 1: Install runtime deps

Run from `chrome-extension/`:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm install @xyflow/react@^12 dagre@^0.8
npm install --save-dev @types/dagre
```

Expected: three packages appear in `package.json`. `@xyflow/react` is the modern name for react-flow; the legacy `react-flow-renderer` / `reactflow` names are outdated.

### Step 2: Verify imports resolve

Write a throwaway one-liner to confirm the modules are reachable:

```bash
node -e "import('@xyflow/react').then(m => console.log('xyflow OK:', typeof m.ReactFlow)); import('dagre').then(m => console.log('dagre OK:', typeof m.graphlib));"
```

Expected output: `xyflow OK: function` and `dagre OK: object`.

### Step 3: Run tests to confirm no regressions

```bash
npm test
```

Expected: **164/164 pass** (Plan 6 baseline), no new tests yet.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/package.json chrome-extension/package-lock.json
git commit -m "feat(ext): add @xyflow/react + dagre deps for Canvas mode"
```

---

## Task 2: Add `CanvasLayout` type + storage helpers (TDD)

**Files:**
- Modify: `chrome-extension/reader/types.ts`
- Modify: `chrome-extension/reader/lib/storage.ts`
- Create: `chrome-extension/tests/lib/storage-canvas.test.ts`

### Step 1: Add the type

Open `chrome-extension/reader/types.ts`. Append at the bottom (after `PdfRuntime`):

```typescript
/**
 * Per-paper Canvas layout persistence (§8.3). Only node positions are stored;
 * node identities and structure are re-derived from Paper/notes/chat on every
 * Canvas open. If nothing is persisted, dagre lays out the graph.
 */
export interface CanvasLayout {
  nodes: { id: string; x: number; y: number }[];
}
```

### Step 2: Write failing test

Create `chrome-extension/tests/lib/storage-canvas.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getCanvasLayout, setCanvasLayout } from '../../reader/lib/storage';

// Minimal chrome.storage.local mock (same shape as existing tests use).
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

describe('canvas layout storage', () => {
  it('returns null when no layout is saved', async () => {
    const layout = await getCanvasLayout('pk1');
    expect(layout).toBeNull();
  });

  it('round-trips through set/get', async () => {
    await setCanvasLayout('pk1', { nodes: [{ id: 'paper', x: 100, y: 200 }] });
    const layout = await getCanvasLayout('pk1');
    expect(layout).toEqual({ nodes: [{ id: 'paper', x: 100, y: 200 }] });
  });

  it('isolates layouts by paper key', async () => {
    await setCanvasLayout('pk1', { nodes: [{ id: 'paper', x: 10, y: 10 }] });
    await setCanvasLayout('pk2', { nodes: [{ id: 'paper', x: 99, y: 99 }] });
    expect(await getCanvasLayout('pk1')).toEqual({ nodes: [{ id: 'paper', x: 10, y: 10 }] });
    expect(await getCanvasLayout('pk2')).toEqual({ nodes: [{ id: 'paper', x: 99, y: 99 }] });
  });
});
```

### Step 3: Run to confirm failure

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/storage-canvas.test.ts
```

Expected: FAIL — `getCanvasLayout` and `setCanvasLayout` not exported.

### Step 4: Add helpers to `storage.ts`

Open `chrome-extension/reader/lib/storage.ts`. Find the imports block at the top — add `CanvasLayout` to the `types` import:

```typescript
import type { /* existing types */, CanvasLayout } from '../types';
```

Append the helpers near the other per-paper helpers (look for `getMemory` / `setMemory` as style reference):

```typescript
export async function getCanvasLayout(paperKey: string): Promise<CanvasLayout | null> {
  return get<CanvasLayout>(k.canvas(paperKey));
}

export async function setCanvasLayout(paperKey: string, value: CanvasLayout): Promise<void> {
  await set(k.canvas(paperKey), value);
}
```

`k.canvas` is already defined (line 18 of storage.ts). No new key builder needed.

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/storage-canvas.test.ts
```

Expected: 3/3 pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts chrome-extension/reader/lib/storage.ts chrome-extension/tests/lib/storage-canvas.test.ts
git commit -m "feat(ext): CanvasLayout type + get/set storage helpers (TDD)"
```

---

## Task 3: `canvas-graph.ts` — pure node/edge builder (TDD)

**Files:**
- Create: `chrome-extension/reader/lib/canvas-graph.ts`
- Create: `chrome-extension/tests/lib/canvas-graph.test.ts`
- Modify: `chrome-extension/reader/types.ts` — add `CanvasNode` / `CanvasEdge`.

**Rationale:** Keeping graph construction in a pure helper means the `CanvasView` component stays focused on rendering, and graph correctness is fully unit-testable without a DOM.

### Step 1: Define node/edge types

Open `chrome-extension/reader/types.ts`. Append after `CanvasLayout`:

```typescript
export type CanvasNodeKind =
  | 'paper'
  | 'section'
  | 'note'      // margin notes + memory.whyItMatters + 3-line summary
  | 'linked'
  | 'chat';

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  /** Arbitrary per-kind payload: title, body, metadata. Rendered by the node component. */
  data: Record<string, unknown>;
  position?: { x: number; y: number };   // filled by applyDagreLayout or storage-hydrated
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}
```

### Step 2: Write failing test

Create `chrome-extension/tests/lib/canvas-graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCanvasGraph } from '../../reader/lib/canvas-graph';
import type { Paper, MarginResult, ChatMessage } from '../../reader/types';
import { emptyMemory } from '../../reader/types';

function fakePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    urlHash: 'h1',
    title: 'A Paper',
    authors: ['Alice', 'Bob'],
    abstract: 'An abstract.',
    outline: [
      { id: 'o0', label: '1 Intro', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ],
    paragraphs: [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'intro text' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'method text' },
    ],
    memory: {
      whyItMatters: 'because',
      role: 'Central',
      judgment: '',
      linked: [{ title: 'Prior Work', why: 'earlier result', role: 'Prior' }],
      nextActions: [],
    },
    ...overrides,
  };
}

describe('buildCanvasGraph', () => {
  it('emits one paper node as the graph root', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], []);
    const paperNodes = nodes.filter((n) => n.kind === 'paper');
    expect(paperNodes).toHaveLength(1);
    expect(paperNodes[0].id).toBe('paper');
    expect(paperNodes[0].data.title).toBe('A Paper');
  });

  it('emits one section node per outline entry with a section→paper edge', () => {
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [], []);
    const secs = nodes.filter((n) => n.kind === 'section');
    expect(secs.map((n) => n.id)).toEqual(['section:o0', 'section:o1']);
    // Each section has an edge to paper.
    for (const sec of secs) {
      const edge = edges.find((e) => e.source === sec.id && e.target === 'paper');
      expect(edge).toBeDefined();
    }
  });

  it('emits one note node per MarginResult, edged to its paragraph section', () => {
    const note: MarginResult = {
      id: 'r-1', kind: 'explain', source: 'foo',
      body: 'explanation', paragraphId: 'sec0-p0', createdAt: 0,
    };
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [note], []);
    const noteNode = nodes.find((n) => n.kind === 'note' && n.id === 'note:r-1');
    expect(noteNode).toBeDefined();
    expect(edges.find((e) => e.source === 'note:r-1' && e.target === 'section:o0')).toBeDefined();
  });

  it('emits a note node for memory.whyItMatters when non-empty', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], []);
    const why = nodes.find((n) => n.id === 'note:why');
    expect(why).toBeDefined();
    expect(why!.data.body).toBe('because');
  });

  it('skips whyItMatters node when memory.whyItMatters is blank', () => {
    const paper = fakePaper({ memory: { ...emptyMemory(), whyItMatters: '   ' } });
    const { nodes } = buildCanvasGraph(paper, [], []);
    expect(nodes.find((n) => n.id === 'note:why')).toBeUndefined();
  });

  it('emits one linked node per memory.linked entry, edged to paper', () => {
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [], []);
    const linked = nodes.filter((n) => n.kind === 'linked');
    expect(linked).toHaveLength(1);
    expect(linked[0].data.title).toBe('Prior Work');
    expect(edges.find((e) => e.source === linked[0].id && e.target === 'paper')).toBeDefined();
  });

  it('emits a chat node with the most recent assistant message when chat has content', () => {
    const chat: ChatMessage[] = [
      { id: 'u-1', role: 'user', text: 'Where does it fail?', createdAt: 0 },
      {
        id: 'a-1', role: 'assistant',
        text: 'On repetition-sensitive tasks [p5].',
        citations: [{ n: 1, kind: 'paragraph', quote: 'fails here', loc: '§2 Method · ¶ p5' }],
        createdAt: 1,
      },
    ];
    const { nodes } = buildCanvasGraph(fakePaper(), [], chat);
    const chatNode = nodes.find((n) => n.kind === 'chat');
    expect(chatNode).toBeDefined();
    expect(chatNode!.data.question).toBe('Where does it fail?');
    expect(chatNode!.data.answer).toBe('On repetition-sensitive tasks [p5].');
    expect((chatNode!.data.citations as unknown[]).length).toBe(1);
  });

  it('emits no chat node when chat history is empty', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], []);
    expect(nodes.find((n) => n.kind === 'chat')).toBeUndefined();
  });
});
```

### Step 3: Run to confirm failure

```bash
npm test -- tests/lib/canvas-graph.test.ts
```

Expected: FAIL — `buildCanvasGraph` not defined.

### Step 4: Implement

Create `chrome-extension/reader/lib/canvas-graph.ts`:

```typescript
import type {
  Paper, MarginResult, ChatMessage,
  CanvasNode, CanvasEdge,
} from '../types';

/**
 * Build a Canvas graph from the current Paper state + margin notes + chat history.
 *
 * Nodes emitted:
 *   - 'paper' — always; the root.
 *   - 'section:<outlineId>' — one per outline entry.
 *   - 'note:<marginResultId>' — one per margin note.
 *   - 'note:why' — from memory.whyItMatters (if non-empty after trim).
 *   - 'linked:<index>' — one per memory.linked entry.
 *   - 'chat' — shows most recent user/assistant exchange (if any assistant message exists).
 *
 * Edges:
 *   - section → paper
 *   - note → section (anchored via paragraph's sectionId; falls through to paper if unknown)
 *   - linked → paper
 *   - chat → (no edge — free-floating per spec §8.3)
 */
export function buildCanvasGraph(
  paper: Paper,
  notes: MarginResult[],
  chat: ChatMessage[],
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  nodes.push({
    id: 'paper',
    kind: 'paper',
    data: {
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue ?? '',
    },
  });

  for (const o of paper.outline) {
    const id = `section:${o.id}`;
    nodes.push({
      id,
      kind: 'section',
      data: { label: o.label, level: o.level, page: o.page },
    });
    edges.push({ id: `e:${id}->paper`, source: id, target: 'paper' });
  }

  // Lookup: paragraphId → sectionId (for margin note anchoring).
  const sectionByParagraph = new Map(paper.paragraphs.map((p) => [p.id, p.sectionId]));

  for (const note of notes) {
    const id = `note:${note.id}`;
    nodes.push({
      id,
      kind: 'note',
      data: {
        kind: note.kind,         // 'explain' | 'summarize' | 'translate'
        source: note.source,
        body: note.body,
      },
    });
    const sectionId = sectionByParagraph.get(note.paragraphId);
    const target = sectionId ? `section:${sectionId}` : 'paper';
    edges.push({ id: `e:${id}->${target}`, source: id, target });
  }

  const why = paper.memory.whyItMatters.trim();
  if (why) {
    nodes.push({
      id: 'note:why',
      kind: 'note',
      data: { kind: 'why', body: why },
    });
    edges.push({ id: 'e:note:why->paper', source: 'note:why', target: 'paper' });
  }

  paper.memory.linked.forEach((l, i) => {
    const id = `linked:${i}`;
    nodes.push({
      id,
      kind: 'linked',
      data: { title: l.title, why: l.why, role: l.role },
    });
    edges.push({ id: `e:${id}->paper`, source: id, target: 'paper' });
  });

  // Chat node: last user question + last assistant answer, if any.
  const lastAssistant = [...chat].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) {
    // Find the most recent user message before that assistant message.
    const assistantIdx = chat.findIndex((m) => m.id === lastAssistant.id);
    const priorUser = [...chat.slice(0, assistantIdx)].reverse().find((m) => m.role === 'user');
    nodes.push({
      id: 'chat',
      kind: 'chat',
      data: {
        question: priorUser?.text ?? '',
        answer: lastAssistant.text,
        citations: lastAssistant.citations ?? [],
      },
    });
  }

  return { nodes, edges };
}
```

### Step 5: Run tests to confirm pass

```bash
npm test -- tests/lib/canvas-graph.test.ts
```

Expected: 8/8 pass.

### Step 6: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts chrome-extension/reader/lib/canvas-graph.ts chrome-extension/tests/lib/canvas-graph.test.ts
git commit -m "feat(ext): buildCanvasGraph — pure node/edge builder from paper/notes/chat (TDD)"
```

---

## Task 4: `canvas-layout.ts` — dagre wrapper (TDD)

**Files:**
- Create: `chrome-extension/reader/lib/canvas-layout.ts`
- Create: `chrome-extension/tests/lib/canvas-layout.test.ts`

**Rationale:** dagre assigns `{x, y}` positions based on graph structure. We wrap it so the `CanvasView` component doesn't touch dagre directly and the layout math is testable.

### Step 1: Write failing test

Create `chrome-extension/tests/lib/canvas-layout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyDagreLayout } from '../../reader/lib/canvas-layout';
import type { CanvasNode, CanvasEdge } from '../../reader/types';

describe('applyDagreLayout', () => {
  it('assigns a position to every input node', () => {
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'section:o0', kind: 'section', data: {} },
      { id: 'note:n0', kind: 'note', data: {} },
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'section:o0', target: 'paper' },
      { id: 'e2', source: 'note:n0', target: 'section:o0' },
    ];
    const out = applyDagreLayout(nodes, edges);
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(n.position).toBeDefined();
      expect(typeof n.position!.x).toBe('number');
      expect(typeof n.position!.y).toBe('number');
    }
  });

  it('produces distinct x coordinates for nodes at different depths (LR layout)', () => {
    // Paper ← section ← note chain; each level should be at a different x.
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'section:o0', kind: 'section', data: {} },
      { id: 'note:n0', kind: 'note', data: {} },
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'section:o0', target: 'paper' },
      { id: 'e2', source: 'note:n0', target: 'section:o0' },
    ];
    const out = applyDagreLayout(nodes, edges);
    const paper = out.find((n) => n.id === 'paper')!;
    const section = out.find((n) => n.id === 'section:o0')!;
    const note = out.find((n) => n.id === 'note:n0')!;
    // LR: source (note) is on the left, sink (paper) on the right.
    expect(note.position!.x).toBeLessThan(section.position!.x);
    expect(section.position!.x).toBeLessThan(paper.position!.x);
  });

  it('handles an orphan node (no edges) by giving it a valid position', () => {
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'chat', kind: 'chat', data: {} },
    ];
    const out = applyDagreLayout(nodes, []);
    const chat = out.find((n) => n.id === 'chat')!;
    expect(chat.position).toBeDefined();
    expect(Number.isFinite(chat.position!.x)).toBe(true);
    expect(Number.isFinite(chat.position!.y)).toBe(true);
  });

  it('returns a new array; does not mutate input', () => {
    const nodes: CanvasNode[] = [{ id: 'paper', kind: 'paper', data: {} }];
    const out = applyDagreLayout(nodes, []);
    expect(out).not.toBe(nodes);
    expect(nodes[0].position).toBeUndefined();
  });
});
```

### Step 2: Run to confirm failure

```bash
npm test -- tests/lib/canvas-layout.test.ts
```

Expected: FAIL — `applyDagreLayout` not defined.

### Step 3: Implement

Create `chrome-extension/reader/lib/canvas-layout.ts`:

```typescript
import dagre from 'dagre';
import type { CanvasNode, CanvasEdge } from '../types';

/**
 * Per-kind width/height hints for dagre (approximation — real nodes may
 * differ after render but this is good enough for initial placement).
 */
const NODE_SIZE: Record<string, { width: number; height: number }> = {
  paper:   { width: 360, height: 420 },
  section: { width: 220, height: 60 },
  note:    { width: 280, height: 150 },
  linked:  { width: 260, height: 120 },
  chat:    { width: 320, height: 260 },
};

/**
 * Apply a dagre auto-layout to the given node/edge graph. Returns a new
 * node array with `position: { x, y }` filled. Direction is left-to-right
 * (LR) so source nodes (notes, sections) appear to the left of the paper.
 *
 * Input is not mutated.
 */
export function applyDagreLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 28,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const size = NODE_SIZE[n.kind] ?? { width: 200, height: 100 };
    g.setNode(n.id, size);
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const laid = g.node(n.id);
    // dagre returns center coords; react-flow expects top-left.
    const size = NODE_SIZE[n.kind] ?? { width: 200, height: 100 };
    return {
      ...n,
      position: {
        x: laid.x - size.width / 2,
        y: laid.y - size.height / 2,
      },
    };
  });
}
```

### Step 4: Run tests to confirm pass

```bash
npm test -- tests/lib/canvas-layout.test.ts
```

Expected: 4/4 pass.

### Step 5: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/lib/canvas-layout.ts chrome-extension/tests/lib/canvas-layout.test.ts
git commit -m "feat(ext): applyDagreLayout — pure LR graph layout with per-kind sizes (TDD)"
```

---

## Task 5: Custom node components inside `canvas-view.tsx`

**Files:**
- Create: `chrome-extension/reader/components/canvas-view.tsx`

**Rationale:** Define the 5 visual node components now so Task 6 can wire them into the react-flow `nodeTypes` map. Each is a pure presentational React component; no state or effects inside.

### Step 1: Create the file with node components + empty default export

Create `chrome-extension/reader/components/canvas-view.tsx`:

```typescript
import { I } from './icons';
import type { Citation, MarginResult } from '../types';

/* ---------- Shared Head element for all node kinds ---------- */

type HeadProps = {
  icon: keyof typeof I;
  label: string;
  accent?: string;
};

function Head({ icon, label, accent }: HeadProps) {
  const Ico = I[icon];
  return (
    <div
      className="pf-canvas-node-head"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 12px',
        borderBottom: '0.5px solid var(--rule)',
        background: 'var(--paper-soft)',
        userSelect: 'none',
        cursor: 'grab',
      }}
    >
      <Ico size={12} stroke={1.5} style={{ color: accent ?? 'var(--ink-faded)' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: accent ?? 'var(--ink-faded)',
        fontWeight: 600,
      }}>{label}</span>
    </div>
  );
}

const baseNodeStyle: React.CSSProperties = {
  width: '100%', height: '100%',
  background: 'var(--paper)',
  border: '0.5px solid var(--rule)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-1)',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
};

/* ---------- 5 node components ---------- */

export function PaperNode({ data }: { data: { title: string; authors: string[]; venue: string } }) {
  return (
    <div style={baseNodeStyle}>
      <Head icon="Book" label="Paper" />
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600,
          lineHeight: 1.3, color: 'var(--ink)',
        }}>{data.title}</div>
        <div style={{
          fontSize: 10, color: 'var(--ink-faded)',
          fontStyle: 'italic', marginTop: 6,
        }}>{data.authors.slice(0, 3).join(', ')}{data.authors.length > 3 ? ' et al.' : ''}</div>
        {data.venue && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-ghost)', marginTop: 4,
          }}>{data.venue}</div>
        )}
      </div>
    </div>
  );
}

export function SectionNode({ data }: { data: { label: string; level: number; page?: number } }) {
  return (
    <div style={{
      ...baseNodeStyle,
      padding: '10px 14px', justifyContent: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13,
        fontWeight: data.level === 0 ? 600 : 400,
        color: 'var(--ink)',
      }}>{data.label}</div>
      {data.page != null && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', marginTop: 2,
        }}>p. {data.page}</div>
      )}
    </div>
  );
}

const NOTE_TONE: Record<string, string> = {
  explain:   'var(--sky)',
  summarize: 'var(--walnut)',
  translate: 'var(--forest)',
  why:       'var(--walnut)',
};

export function NoteNode({ data }: { data: { kind: string; source?: string; body: string } }) {
  const accent = NOTE_TONE[data.kind] ?? 'var(--ink-faded)';
  const labelMap: Record<string, string> = {
    explain: 'Explain', summarize: 'Summarize', translate: 'Translate',
    why: 'Why this matters',
  };
  return (
    <div style={baseNodeStyle}>
      <Head icon={data.kind === 'why' ? 'Sparkle' : 'Quote'} label={labelMap[data.kind] ?? data.kind} accent={accent} />
      <div style={{
        flex: 1, overflow: 'auto', padding: '10px 14px',
        fontFamily: 'var(--font-serif)', fontSize: 12, lineHeight: 1.55,
        color: 'var(--ink)',
      }}>
        {data.source && (
          <blockquote style={{
            margin: '0 0 8px', padding: '2px 8px',
            borderLeft: '2px solid var(--walnut-soft)',
            fontStyle: 'italic', fontSize: 11, color: 'var(--ink-faded)',
          }}>"{data.source}"</blockquote>
        )}
        <div>{data.body}</div>
      </div>
    </div>
  );
}

export function LinkedNode({ data }: { data: { title: string; why: string; role: string } }) {
  return (
    <div style={baseNodeStyle}>
      <Head icon="Link" label="Linked context" />
      <div style={{ flex: 1, padding: '10px 14px' }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 12, fontWeight: 600,
          color: 'var(--ink)', marginBottom: 4,
        }}>→ {data.title}</div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', marginBottom: 6,
        }}>{data.role}</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 11,
          color: 'var(--ink-soft)', lineHeight: 1.5,
        }}>{data.why}</div>
      </div>
    </div>
  );
}

export function ChatNode({ data }: { data: { question: string; answer: string; citations: Citation[] } }) {
  const firstCite = data.citations[0];
  return (
    <div style={baseNodeStyle}>
      <Head icon="Chat" label="Chat" accent="var(--sky)" />
      <div style={{
        flex: 1, overflow: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '6px 10px',
          background: 'var(--paper-deep)',
          borderRadius: '8px 8px 2px 8px',
          fontSize: 11,
        }}>{data.question}</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 11.5,
          lineHeight: 1.55, color: 'var(--ink)',
        }}>{data.answer}</div>
        {firstCite && (
          <div style={{
            padding: '6px 8px',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 4,
            fontSize: 10,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--walnut)', fontWeight: 600,
            }}>{firstCite.n} · {firstCite.loc}</div>
            <div style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              color: 'var(--ink-faded)',
            }}>"{firstCite.quote}"</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0 — no errors. `I` icons referenced (`Book`, `Quote`, `Sparkle`, `Link`, `Chat`) all exist in `components/icons.tsx` (verify with `grep export icons.tsx` if unsure).

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/canvas-view.tsx
git commit -m "feat(ext): Canvas node components — Paper / Section / Note / Linked / Chat"
```

---

## Task 6: `CanvasView` component — react-flow wrapper

**Files:**
- Modify: `chrome-extension/reader/components/canvas-view.tsx`

**Rationale:** Now wire the react-flow shell. Props accept `paper`, `notes`, `chat`, `onBack`. On mount, build the graph, hydrate saved positions (if any) or apply dagre layout, render react-flow with our node types.

### Step 1: Extend the file with the main CanvasView export

Open `chrome-extension/reader/components/canvas-view.tsx`. At the top, add these imports (combine with the existing `import { I }` line):

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls,
  type Node, type Edge, type NodeProps,
  applyNodeChanges, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { I } from './icons';
import type { Paper, MarginResult, ChatMessage, Citation, CanvasNode, CanvasLayout } from '../types';
import { buildCanvasGraph } from '../lib/canvas-graph';
import { applyDagreLayout } from '../lib/canvas-layout';
import { getCanvasLayout, setCanvasLayout } from '../lib/storage';
import { paperKey } from '../lib/ids';
```

At the bottom of the file (after `ChatNode`), add:

```typescript
/* ---------- nodeTypes map: wires our components to react-flow ---------- */

const nodeTypes = {
  paper: PaperNode,
  section: SectionNode,
  note: NoteNode,
  linked: LinkedNode,
  chat: ChatNode,
} as const;

/* ---------- CanvasView — top-level react-flow shell ---------- */

interface Props {
  paper: Paper;
  notes: MarginResult[];
  chat: ChatMessage[];
  onBack: () => void;
}

/**
 * Merge initial dagre-laid positions with any user-saved overrides.
 * Unknown saved node ids are ignored (graph shape changed since save).
 */
function applySavedLayout(
  nodes: CanvasNode[],
  saved: CanvasLayout | null,
): CanvasNode[] {
  if (!saved) return nodes;
  const byId = new Map(saved.nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const override = byId.get(n.id);
    if (!override) return n;
    return { ...n, position: { x: override.x, y: override.y } };
  });
}

/** Convert our CanvasNode → react-flow Node. */
function toFlowNodes(nodes: CanvasNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data,
    // Default node wrappers; dagre sizes hinted in canvas-layout.ts only
    // guide *layout*, not render size — rendered size comes from the node
    // component's CSS. Match dagre's width hints for handles/edges alignment.
    width: NODE_FLOW_WIDTH[n.kind],
    height: NODE_FLOW_HEIGHT[n.kind],
  }));
}

const NODE_FLOW_WIDTH: Record<string, number> = {
  paper: 360, section: 220, note: 280, linked: 260, chat: 320,
};
const NODE_FLOW_HEIGHT: Record<string, number> = {
  paper: 420, section: 60, note: 150, linked: 120, chat: 260,
};

export function CanvasView({ paper, notes, chat, onBack }: Props) {
  const pk = paperKey(paper);

  // Build graph (pure) once per (paper, notes, chat) identity.
  const { graphNodes, graphEdges } = useMemo(() => {
    const { nodes, edges } = buildCanvasGraph(paper, notes, chat);
    return { graphNodes: nodes, graphEdges: edges };
  }, [paper, notes, chat]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const edges = useMemo<Edge[]>(
    () => graphEdges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      style: { stroke: 'var(--walnut-soft)', strokeDasharray: '3 4' },
    })),
    [graphEdges],
  );

  // Hydrate positions on mount / graph change: saved layout overrides dagre.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getCanvasLayout(pk);
      if (cancelled) return;
      const laid = applyDagreLayout(graphNodes, graphEdges);
      const merged = applySavedLayout(laid, saved);
      setNodes(toFlowNodes(merged));
    })();
    return () => { cancelled = true; };
  }, [pk, graphNodes, graphEdges]);

  // Persist positions after drag (100 ms debounce).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((current: Node[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layout: CanvasLayout = {
        nodes: current.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
      };
      setCanvasLayout(pk, layout).catch(() => { /* quota handled globally */ });
    }, 100);
  }, [pk]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      // Only save on drag-stop (change.type === 'position' && !dragging).
      const dragStopped = changes.some(
        (c) => c.type === 'position' && c.dragging === false,
      );
      if (dragStopped) persist(next);
      return next;
    });
  }, [persist]);

  // Cleanup pending save on unmount so a late-fired setCanvasLayout doesn't
  // race a paper-swap in storage.
  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  const cardCount = graphNodes.length;
  const linkCount = graphEdges.length;

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: 'var(--paper-deep)',
    }}>
      {/* Left toolbar: Back + counts */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', gap: 6, alignItems: 'center',
        padding: '6px 10px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-1)',
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, color: 'var(--ink-soft)',
        }}>
          <span style={{ fontSize: 12, lineHeight: 1 }}>←</span> Back to reader
        </button>
        <div style={{ width: 0.5, height: 12, background: 'var(--rule)' }} />
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--ink-faded)',
        }}>{cardCount} cards · {linkCount} links</div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.6}
        defaultEdgeOptions={{ type: 'bezier' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={'dots' as any} gap={24} size={0.6} color="var(--ink-ghost)" />
        <Controls
          position="top-right"
          showInteractive={false}
          showFitView={false}
          style={{
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 20,
          }}
        />
      </ReactFlow>
    </div>
  );
}
```

### Step 2: Typecheck

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exit 0. If the `Background variant` prop complains, use the literal string `'dots'` (react-flow v12 accepts it).

### Step 3: Build

```bash
npm run build
```

Expected: exit 0. The bundle grows by ~80 KB gzipped for react-flow; that's expected.

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/canvas-view.tsx
git commit -m "feat(ext): CanvasView — react-flow shell with dagre layout + position persistence"
```

---

## Task 7: Wire `CanvasView` into `main.tsx`, delete placeholder

**Files:**
- Modify: `chrome-extension/reader/main.tsx`
- Delete: `chrome-extension/reader/components/canvas-placeholder.tsx`

### Step 1: Replace imports + render

Open `chrome-extension/reader/main.tsx`.

Find the import:

```typescript
import { CanvasPlaceholder } from './components/canvas-placeholder';
```

Replace with:

```typescript
import { CanvasView } from './components/canvas-view';
```

Find the Canvas variant branch (around line 839):

```tsx
      {variant === 'canvas' ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CanvasPlaceholder onBack={() => setVariant('focus')} />
        </div>
      ) : (
```

Replace with:

```tsx
      {variant === 'canvas' ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CanvasView
            paper={effectivePaper}
            notes={results}
            chat={chatMessages}
            onBack={() => setVariant('focus')}
          />
        </div>
      ) : (
```

`results` and `chatMessages` are already state in `ViewerApp` — verify with grep:

```bash
grep -n "setResults\|setChatMessages" chrome-extension/reader/main.tsx | head
```

Should show useState declarations near the top of the component.

### Step 2: Delete the placeholder file

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
rm reader/components/canvas-placeholder.tsx
```

### Step 3: Typecheck + build + test

```bash
npm run typecheck
npm run build
npm test
```

Expected: typecheck exit 0, build exit 0, tests 180/180 (164 baseline + Tasks 2+3+4 = 3 + 8 + 4 = 15 new → 179; if you have 180 you added one extra, fine).

### Step 4: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/main.tsx chrome-extension/reader/components/canvas-placeholder.tsx
git commit -m "feat(ext): wire CanvasView into Canvas variant; remove placeholder"
```

---

## Task 8: Warm-paper CSS overrides for react-flow

**Files:**
- Modify: `chrome-extension/reader/styles/tokens.css`

**Rationale:** react-flow's default theme uses bluish accent colors and light grey backgrounds. Override to the PaperFlow palette and provide dark-mode parity.

### Step 1: Append overrides

Open `chrome-extension/reader/styles/tokens.css`. Append at the very end:

```css
/* ========================================================================
   Canvas mode — react-flow warm-paper overrides (Phase 7)
   ======================================================================== */

.react-flow__attribution { display: none; }

.react-flow__node {
  font-family: var(--font-sans);
  color: var(--ink);
}

/* Our custom nodes render their own borders; disable react-flow's default
   selection outline box so hover/focus states don't double up. */
.react-flow__node.selected > div,
.react-flow__node:focus > div,
.react-flow__node:focus-visible > div {
  outline: 1px solid var(--walnut);
  outline-offset: 2px;
}

.react-flow__edge-path {
  stroke: var(--walnut-soft);
  stroke-width: 1;
  stroke-dasharray: 3 4;
  opacity: 0.7;
}

/* Hide the default edge-connection circle handles on our nodes — our graph
   is read-only in v1 (no user-driven edge creation). */
.react-flow__handle { display: none; }

/* Controls pill */
.react-flow__controls {
  box-shadow: var(--shadow-1);
  overflow: hidden;
}
.react-flow__controls button {
  background: transparent;
  color: var(--ink-faded);
  border: none;
  border-right: 0.5px solid var(--rule);
}
.react-flow__controls button:last-child { border-right: 0; }
.react-flow__controls button:hover {
  background: var(--paper-deep);
  color: var(--ink);
}
.react-flow__controls button svg { fill: currentColor; }

/* Background dots — react-flow draws with its own color; we override. */
.react-flow__background { color: var(--ink-ghost); }

[data-theme="dark"] .react-flow__edge-path {
  stroke: var(--walnut);
  opacity: 0.6;
}
```

### Step 2: Build to validate CSS

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: exit 0.

### Step 3: Commit

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/styles/tokens.css
git commit -m "feat(ext): react-flow CSS overrides — warm-paper palette, hidden handles, dark mode"
```

---

## Task 9: Outline + Workspace button disabled in Canvas variant (§9)

**Files:**
- Modify: `chrome-extension/reader/components/top-bar.tsx`

**Rationale:** Spec §9: "Sidebar toggle ... Canvas variant 下按钮置灰不响应"; "Workspace toggle ... 仅在 Classic variant 下可点击". These existed before Phase 7 but are worth verifying since Canvas is now a real variant. If the current code already handles both: no change.

### Step 1: Inspect the current TopBar

```bash
grep -n "variant === 'canvas'\|disabled" chrome-extension/reader/components/top-bar.tsx
```

Expected: both the Sidebar button and the Workspace-toggle button should reference `variant === 'canvas'` (or use an `opacity` + `pointerEvents: 'none'` style) to disable themselves.

If either button does NOT disable in Canvas:
- **Sidebar toggle:** add `disabled={variant === 'canvas'}` AND visually indicate disabled state (opacity 0.4).
- **Workspace toggle:** add `disabled={variant !== 'classic'}`.

If both already handle it: this task is verification-only, no commit.

### Step 2 (conditional): Commit if changes were needed

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/top-bar.tsx
git commit -m "fix(ext): TopBar buttons disabled in Canvas variant per §9"
```

If no changes were needed, skip the commit.

---

## Task 10: StatusRail hidden in Canvas (§8.3)

**Files:**
- Modify: `chrome-extension/reader/components/status-rail.tsx` OR `chrome-extension/reader/main.tsx`

**Rationale:** Spec §8.3: "Canvas 模式下 StatusRail 隐藏". Already wired in `main.tsx:960` as `<StatusRail hidden={variant === 'canvas'} />`. Verify StatusRail honors the `hidden` prop and actually renders nothing when true.

### Step 1: Inspect StatusRail

```bash
grep -n "hidden" chrome-extension/reader/components/status-rail.tsx
```

Expected: props include `hidden?: boolean`; render returns `null` early when `hidden` is true.

If not: add the prop + early return:

```typescript
interface Props {
  // ...existing...
  hidden?: boolean;
}

export function StatusRail({ /* existing */, hidden }: Props) {
  if (hidden) return null;
  // ...existing render...
}
```

### Step 2 (conditional): Commit if changes were needed

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/status-rail.tsx
git commit -m "fix(ext): StatusRail honors hidden prop in Canvas variant"
```

If already correct: skip.

---

## Task 11: CmdK Layout → Canvas command wires up

**Files:**
- Verify: `chrome-extension/reader/components/overlays.tsx` (CmdK is defined here)
- Verify: `chrome-extension/reader/main.tsx` (handles the CmdK action)

**Rationale:** Spec §9.1 lists "View → Layout: Focus / Classic / Canvas" as a v1 CmdK command. Plan 4 wired this up in CmdK; verify that selecting "Layout: Canvas" does `setVariant('canvas')` in `main.tsx`.

### Step 1: Inspect CmdK

```bash
grep -n "setVariant\|Layout" chrome-extension/reader/components/overlays.tsx chrome-extension/reader/main.tsx | head -20
```

Expected: CmdK emits actions like `{ kind: 'variant', variant: 'canvas' }` (or similar) which `main.tsx` dispatches via `setVariant(...)`.

If the Canvas option is missing: add it to the CmdK command list and wire the dispatch. If present: no change.

### Step 2 (conditional): Commit if wiring was missing

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/components/overlays.tsx chrome-extension/reader/main.tsx
git commit -m "fix(ext): CmdK 'Layout: Canvas' action wired to setVariant"
```

If already wired: skip.

---

## Task 12: Final — tests + typecheck + build + smoke

**Files:** none (verification only unless fixes required)

### Step 1: Full test suite

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected increments over Plan 6's 164:
- `storage-canvas.test.ts`: +3
- `canvas-graph.test.ts`: +8
- `canvas-layout.test.ts`: +4

Total: 164 + 15 = **~179**.

### Step 2: Typecheck + build

```bash
npm run typecheck
npm run build
```

Expected: exit 0 on both. Bundle size grows ~80 KB gzipped (react-flow + dagre).

### Step 3: Manual Chrome smoke test

Load `dist/` via `chrome://extensions` → "Load unpacked". Then:

1. **arXiv paper regression check:** open any arXiv URL; Reader loads in Focus, figures/equations render (Phase 6 regression gate).
2. **Switch to Canvas (TopBar layers icon):** full-screen graph appears. Paper node is in the center; outline sections, note nodes, linked nodes, and chat node are visible. Edges are walnut-soft dashed.
3. **Drag a node:** it moves; release. Reload page. Node stays where you dropped it (persistence works).
4. **Back button:** top-left "← Back to reader" returns to Focus (or Classic — whichever was active before).
5. **Zoom controls:** top-right `+` / `−` work. `fitView` centers the graph on initial mount.
6. **CmdK → Layout: Canvas:** also switches to Canvas variant.
7. **Chat node content:** shows most recent user question + AI answer + first citation. If no chat exists, chat node is absent.
8. **Dark mode:** toggle theme; dot-grid background + edges stay readable.
9. **Big PDF:** open a 30+ page PDF; switch to Canvas. Sections render fast (one per page). Performance acceptable.
10. **Second paper:** open a different arXiv ID. Canvas shows only that paper's nodes. Layout persistence is scoped per-paper.

### Step 4: Append verification log

Append to this plan file:

```markdown
---

## Verification log

Phase 7 automated verification complete (YYYY-MM-DD):
- `npm test` → ~179 passed across 12+ files
- `npm run typecheck` → exit 0
- `npm run build` → green (bundle +80 KB gzipped for react-flow)
- Manual Chrome smoke test (arXiv regression / Canvas render / drag+persist / Back / Zoom / CmdK / Chat preview / dark mode / big PDF / per-paper isolation) — user-driven.
```

Commit:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-22-plan-phase-7-canvas-mode.md
git commit -m "docs(plan): Phase 7 verification log"
```

---

## Phase 7 Done Criteria

- ✅ Canvas variant renders a real react-flow graph (no placeholder)
- ✅ Nodes: Paper, Section (per outline entry), Note (per margin note + memory.whyItMatters), Linked (per memory.linked), Chat (static preview of last exchange)
- ✅ Edges: section → paper, note → section, linked → paper, walnut-soft dashed
- ✅ Initial layout via dagre (LR), nodes draggable, positions persisted to `chrome.storage.local` under `paper:{key}:canvas`
- ✅ Toolbar: left (Back + card/link counts), right (zoom + − in a styled Controls pill)
- ✅ Dot-grid background matches the prototype
- ✅ Light + dark theme coherent
- ✅ TopBar Sidebar button + Workspace button disabled in Canvas variant (§9)
- ✅ StatusRail hidden in Canvas (§8.3)
- ✅ CmdK "Layout: Canvas" switches variant
- ✅ All unit tests pass (~179); typecheck clean; build green

## Next: Plan 8

**Plan 8 — Polish + deferred highlight fidelity:**
- TODO #7 / #8: quota error contract (swallow vs typed `QuotaError`) + stubbed test coverage
- TODO #9: rich-block AI citation prettification (figures/equations/tables emit descriptor text like `[Figure 1]` instead of raw textContent)
- TODO #10 / #13: highlight fidelity — deep-DOM wrap inside ar5iv rich blocks AND overlay-rect paint over PDF text-layer (shared "highlight on non-text-node content" architecture)
- Phase 6 polish follow-ups: future-zoom effect rebuild in PdfPage (don't cancel RenderTask on pure scale change), scroll-spy page-element cache for 50+ page papers
- Plan 7 polish candidates (after smoke): re-run dagre if node dimensions settle differently from the hints, add fitView animation, surface "unsaved layout" indicator if writes fail under quota

---

## Verification log

Phase 7 automated verification complete (2026-04-22):
- `npm test` → **179 passed** across 13 test files (Plan 6 baseline 164 → +15: storage-canvas +3, canvas-graph +8, canvas-layout +4)
- `npm run typecheck` → exit 0
- `npm run build` → green (reader bundle +80 KB gzipped for react-flow)
- Integration tasks 9/10/11 were verification-only (TopBar canvas-disabled, StatusRail hidden, CmdK Canvas action already wired from earlier phases); no commits needed.
- Manual Chrome smoke test (arXiv regression / Canvas render / drag+persist / Back / Zoom / CmdK / Chat preview / dark mode / big PDF / per-paper isolation) — deferred to user.
