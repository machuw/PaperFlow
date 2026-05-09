# PaperFlow Chrome Extension — Phase 1: Scaffolding + URL Routing + Content Parsing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome extension shell, redirect arXiv/PDF URLs into a reader page, and parse paper content into the `Paper` data model. No UI migration, no AI — Phase 1 ends with a reader page that dumps parsed JSON for verification.

**Architecture:** `declarativeNetRequest` handles redirects to `chrome-extension://{id}/reader/index.html?url=...`. A minimal React reader page reads `?url=` param, dispatches to `lib/arxiv.ts` or `lib/pdf.ts`, and renders `<pre>{JSON.stringify(paper, null, 2)}</pre>`. Storage utilities (`lib/storage.ts`) + `paperKey()` + cache read/write are wired so Plan 2/3 can bolt UI/AI on top. Service worker exists only as a PDF CORS-proxy fallback.

**Tech Stack:** Vite 5 (multi-entry), React 18, TypeScript 5, pdfjs-dist 4.x, Chrome MV3. Test runner: Vitest + jsdom.

**Spec reference:** `docs/specs/2026-04-20-spec-chrome-extension.md` — §3.1, §3.2, §3.4 (paperKey + cache only), §5 data model.

**Not in Phase 1:** UI components, tokens.css migration, AI (§3.3, §3.7, §3.8, §3.9), Library UI, Memory UI, variants (Focus/Classic/Canvas), TopBar, OutlinePanel, Options BYOK form, highlight/notes features. All handled in Plan 2–5.

---

## File Map

Files created or modified in Phase 1:

| File | Responsibility |
|------|---------------|
| `chrome-extension/package.json` | npm deps |
| `chrome-extension/tsconfig.json` | TS config (strict) |
| `chrome-extension/vite.config.ts` | Main build: reader (React ESM) + sw (ESM); copies manifest/rules/options |
| `chrome-extension/vite.content.config.ts` | Content script build: IIFE output (§7 spec requirement) |
| `chrome-extension/vitest.config.ts` | Vitest config (jsdom env) |
| `chrome-extension/manifest.json` | MV3 manifest |
| `chrome-extension/rules.json` | Static DNR rules file (empty; dynamic rules registered in SW) |
| `chrome-extension/content/inject.ts` | abs page injects "Open in PaperFlow" button (bundled as IIFE) |
| `chrome-extension/background/sw.ts` | Dynamic DNR rule registration + PDF CORS proxy fallback |
| `chrome-extension/reader/index.html` | Reader page shell |
| `chrome-extension/reader/main.tsx` | React entry; reads `#src=`, dispatches, renders JSON |
| `chrome-extension/reader/types.ts` | `Paper`, `OutlineItem`, `Paragraph`, `Figure`, `PaperMemory` types |
| `chrome-extension/reader/lib/ids.ts` | `normalizeArxivId()`, `urlHash()`, `paperKey()` |
| `chrome-extension/reader/lib/storage.ts` | Typed chrome.storage.local wrappers + `ParsedCache` type |
| `chrome-extension/reader/lib/arxiv.ts` | Fetch + parse arXiv HTML + arXiv API |
| `chrome-extension/reader/lib/pdf.ts` | pdfjs-dist wrapper: per-page outline, y-coordinate paragraph split |
| `chrome-extension/reader/lib/parse.ts` | Shared paragraph-id / section helpers |
| `chrome-extension/options/index.html` | Static placeholder page (BYOK form comes in Plan 3) |
| `chrome-extension/tests/lib/ids.test.ts` | Unit tests for normalizeArxivId, urlHash, paperKey |
| `chrome-extension/tests/lib/storage.test.ts` | storage wrapper round-trip tests (mock chrome.storage) |
| `chrome-extension/tests/lib/parse.test.ts` | Paragraph id generation, sectionIndex, sectionId |
| `chrome-extension/tests/lib/arxiv.test.ts` | HTML + API parsing against fixtures |
| `chrome-extension/tests/lib/pdf.test.ts` | pdfjs outline/text fixture tests |
| `chrome-extension/tests/fixtures/arxiv-html.html` | Trimmed real arXiv HTML sample |
| `chrome-extension/tests/fixtures/arxiv-api.xml` | Trimmed arXiv API response |

---

## Task 1: Project Scaffold

**Files:**
- Create: `chrome-extension/package.json`
- Create: `chrome-extension/tsconfig.json`
- Create: `chrome-extension/.gitignore`

- [ ] **Step 1: Create chrome-extension directory and init npm**

Run:
```bash
mkdir -p /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm init -y
```

Expected: creates `package.json` with default fields.

- [ ] **Step 2: Install dependencies**

Run (inside `chrome-extension/`):
```bash
npm install react@18 react-dom@18 pdfjs-dist@4
npm install -D typescript@5 vite@5 @vitejs/plugin-react@4 \
  @types/react@18 @types/react-dom@18 @types/chrome \
  vitest@1 jsdom@24 @vitest/ui@1
```

Expected: installs without peer-dep errors.

- [ ] **Step 3: Write package.json scripts**

Overwrite `chrome-extension/package.json`:

```json
{
  "name": "paperflow-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "pdfjs-dist": "^4.0.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.260",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "@vitest/ui": "^1.0.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["reader/**/*", "content/**/*", "background/**/*", "options/**/*", "tests/**/*"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 6: Verify typecheck passes with no source files**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exits 0 (no .ts files yet, tsc accepts empty project).

- [ ] **Step 7: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/package.json chrome-extension/package-lock.json \
  chrome-extension/tsconfig.json chrome-extension/.gitignore
git commit -m "chore(ext): scaffold npm + ts config"
```

---

## Task 2: Data Model Types

**Files:**
- Create: `chrome-extension/reader/types.ts`

- [ ] **Step 1: Write types.ts with spec §5 data model verbatim**

```typescript
export interface Paper {
  id?: string;            // arXiv ID, version-stripped; undefined in PDF mode
  urlHash: string;        // SHA-256(url).hex.slice(0,12); present in both modes
  title: string;
  authors: string[];
  affiliations?: string[];
  venue?: string;
  abstract: string;
  outline: OutlineItem[];
  paragraphs: Paragraph[];
  figures?: Figure[];
  memory: PaperMemory;
}

export interface OutlineItem {
  id: string;
  label: string;
  level: number;          // 0 = section, 1 = subsection
  page?: number;
}

export interface Paragraph {
  id: string;             // "sec{sectionIndex}-p{pInSection}"; matches data-pid
  sectionId: string;      // OutlineItem.id, deepest nested (not level-0)
  section: string;        // display, = deepest OutlineItem.label
  text: string;
  important?: boolean;
}

export interface Figure {
  id: string;
  label: string;
  caption: string;
  page?: number;
}

export interface PaperMemory {
  whyItMatters: string;
  role: string;           // free-text, format "{standard} — {freeform}"
  judgment: string;
  linked: { title: string; why: string; role: string }[];
  nextActions: { text: string; done: boolean }[];
}

export function emptyMemory(): PaperMemory {
  return {
    whyItMatters: '',
    role: '',
    judgment: '',
    linked: [],
    nextActions: [],
  };
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/types.ts
git commit -m "feat(ext): add Paper data model types"
```

---

## Task 3: normalizeArxivId (TDD)

**Files:**
- Create: `chrome-extension/tests/lib/ids.test.ts`
- Create: `chrome-extension/reader/lib/ids.ts`
- Create: `chrome-extension/vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Write failing test for normalizeArxivId**

Create `chrome-extension/tests/lib/ids.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeArxivId } from '../../reader/lib/ids';

describe('normalizeArxivId', () => {
  it('extracts id from /pdf/', () => {
    expect(normalizeArxivId('https://arxiv.org/pdf/2402.18413')).toBe('2402.18413');
  });

  it('strips version suffix', () => {
    expect(normalizeArxivId('https://arxiv.org/pdf/2402.18413v2')).toBe('2402.18413');
    expect(normalizeArxivId('https://arxiv.org/html/2402.18413v3')).toBe('2402.18413');
  });

  it('handles /abs/ path', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/2402.18413')).toBe('2402.18413');
  });

  it('handles trailing .pdf', () => {
    expect(normalizeArxivId('https://arxiv.org/pdf/2402.18413v2.pdf')).toBe('2402.18413');
  });

  it('returns null for non-matching urls', () => {
    expect(normalizeArxivId('https://example.com/paper.pdf')).toBeNull();
    expect(normalizeArxivId('https://arxiv.org/abs/hep-th/0601001')).toBeNull();
  });

  it('accepts 5-digit ids', () => {
    expect(normalizeArxivId('https://arxiv.org/pdf/1805.12345')).toBe('1805.12345');
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test -- tests/lib/ids.test.ts
```

Expected: fails with "Cannot find module '../../reader/lib/ids'".

- [ ] **Step 4: Implement ids.ts**

Create `chrome-extension/reader/lib/ids.ts`:

```typescript
const ARXIV_ID_RE = /(\d{4}\.\d{4,5})(v\d+)?/;

export function normalizeArxivId(url: string): string | null {
  if (!url.includes('arxiv.org/')) return null;
  const m = url.match(ARXIV_ID_RE);
  return m ? m[1] : null;
}
```

- [ ] **Step 5: Run test to confirm pass**

Run:
```bash
npm test -- tests/lib/ids.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/vitest.config.ts chrome-extension/tests/lib/ids.test.ts \
  chrome-extension/reader/lib/ids.ts
git commit -m "feat(ext): normalizeArxivId with version stripping"
```

---

## Task 4: urlHash + paperKey (TDD)

**Files:**
- Modify: `chrome-extension/tests/lib/ids.test.ts`
- Modify: `chrome-extension/reader/lib/ids.ts`

- [ ] **Step 1: Add failing tests for urlHash and paperKey**

Append to `chrome-extension/tests/lib/ids.test.ts`:

```typescript
import { urlHash, paperKey } from '../../reader/lib/ids';
import type { Paper } from '../../reader/types';

describe('urlHash', () => {
  it('returns 12-char hex for a url', async () => {
    const h = await urlHash('https://example.com/foo.pdf');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic', async () => {
    const a = await urlHash('https://example.com/foo.pdf');
    const b = await urlHash('https://example.com/foo.pdf');
    expect(a).toBe(b);
  });

  it('differs for different urls', async () => {
    const a = await urlHash('https://example.com/foo.pdf');
    const b = await urlHash('https://example.com/bar.pdf');
    expect(a).not.toBe(b);
  });
});

describe('paperKey', () => {
  const basePaper: Omit<Paper, 'id' | 'urlHash'> = {
    title: '', authors: [], abstract: '', outline: [], paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
  };

  it('returns paper.id when present (arXiv mode)', () => {
    const p = { ...basePaper, id: '2402.18413', urlHash: 'abc123def456' } as Paper;
    expect(paperKey(p)).toBe('2402.18413');
  });

  it('returns urlHash when id is undefined (PDF mode)', () => {
    const p = { ...basePaper, urlHash: 'abc123def456' } as Paper;
    expect(paperKey(p)).toBe('abc123def456');
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run:
```bash
npm test -- tests/lib/ids.test.ts
```

Expected: fails with "urlHash is not exported" or similar.

- [ ] **Step 3: Implement urlHash and paperKey**

Append to `chrome-extension/reader/lib/ids.ts`:

```typescript
export async function urlHash(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 12);
}

export function paperKey(paper: { id?: string; urlHash: string }): string {
  return paper.id ?? paper.urlHash;
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run:
```bash
npm test -- tests/lib/ids.test.ts
```

Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/ids.test.ts chrome-extension/reader/lib/ids.ts
git commit -m "feat(ext): urlHash + paperKey"
```

---

## Task 5: Storage Wrappers (TDD)

**Files:**
- Create: `chrome-extension/tests/lib/storage.test.ts`
- Create: `chrome-extension/reader/lib/storage.ts`

- [ ] **Step 1: Write test with chrome.storage mock**

Create `chrome-extension/tests/lib/storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCachedParsed, setCachedParsed, getMemory, setMemory, clearPaper } from '../../reader/lib/storage';
import type { ParsedCache } from '../../reader/lib/storage';

type StorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function makeMockStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) data.delete(k);
    },
  };
}

beforeEach(() => {
  const local = makeMockStorage();
  (globalThis as any).chrome = { storage: { local } };
});

describe('parsed cache', () => {
  it('round-trips title/authors/abstract/venue/outline/paragraphs', async () => {
    const parsed: ParsedCache = {
      title: 'Contextual Residuals',
      authors: ['Khan, Y.', 'Voigt, R.'],
      abstract: 'We propose…',
      venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
      outline: [{ id: 'o1', label: 'Introduction', level: 0 }],
      paragraphs: [{ id: 'sec0-p0', sectionId: 'o1', section: 'Introduction', text: 'foo' }],
    };
    await setCachedParsed('2402.18413', parsed);
    const got = await getCachedParsed('2402.18413');
    expect(got).toEqual(parsed);
  });

  it('returns null when key absent', async () => {
    expect(await getCachedParsed('missing-key')).toBeNull();
  });
});

describe('memory', () => {
  it('round-trips memory', async () => {
    await setMemory('k1', { whyItMatters: 'foo', role: '', judgment: '', linked: [], nextActions: [] });
    const got = await getMemory('k1');
    expect(got?.whyItMatters).toBe('foo');
  });

  it('returns null when absent', async () => {
    expect(await getMemory('missing')).toBeNull();
  });
});

describe('clearPaper', () => {
  it('removes all paper:{key}:* entries', async () => {
    await setCachedParsed('k1', { outline: [], paragraphs: [] });
    await setMemory('k1', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    await clearPaper('k1');
    expect(await getCachedParsed('k1')).toBeNull();
    expect(await getMemory('k1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run:
```bash
npm test -- tests/lib/storage.test.ts
```

Expected: fails — module not found.

- [ ] **Step 3: Implement storage.ts**

Create `chrome-extension/reader/lib/storage.ts`:

```typescript
import type { Paper, PaperMemory } from '../types';

// Cache everything except `memory` (stored separately) and mode-specific fields
// (id/urlHash — those come from the URL at load time, not storage).
// Per spec §3.4: "再次打开同一论文直接读缓存，跳过 fetch/parse" requires all
// user-visible metadata to be cached, not just outline+paragraphs.
export type ParsedCache = Pick<
  Paper,
  'title' | 'authors' | 'abstract' | 'venue' | 'outline' | 'paragraphs'
>;

const k = {
  parsed: (key: string) => `paper:${key}:parsed`,
  memory: (key: string) => `paper:${key}:memory`,
  notes: (key: string) => `paper:${key}:notes`,
  highlights: (key: string) => `paper:${key}:highlights`,
  chat: (key: string) => `paper:${key}:chat`,
  canvas: (key: string) => `paper:${key}:canvas`,
  summary: (key: string, section: 'threeLine' | 'keyTerms' | 'detailed', model: string) =>
    `paper:${key}:summary:${section}:${model}`,
};

async function get<T>(key: string): Promise<T | null> {
  const rec = await chrome.storage.local.get(key);
  return (rec[key] as T) ?? null;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getCachedParsed(paperKey: string): Promise<ParsedCache | null> {
  return get<ParsedCache>(k.parsed(paperKey));
}

export async function setCachedParsed(paperKey: string, value: ParsedCache): Promise<void> {
  await set(k.parsed(paperKey), value);
}

export async function getMemory(paperKey: string): Promise<PaperMemory | null> {
  return get<PaperMemory>(k.memory(paperKey));
}

export async function setMemory(paperKey: string, value: PaperMemory): Promise<void> {
  await set(k.memory(paperKey), value);
}

export async function clearPaper(paperKey: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter(x => x.startsWith(`paper:${paperKey}:`));
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

// Key builders exposed for Plan 2-5 (notes/highlights/chat/canvas/summary)
export const keys = k;
```

- [ ] **Step 4: Run test to confirm pass**

Run:
```bash
npm test -- tests/lib/storage.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/storage.test.ts chrome-extension/reader/lib/storage.ts
git commit -m "feat(ext): chrome.storage.local typed wrappers + key builders"
```

---

## Task 6: parse.ts — Paragraph ID + Section Index Helpers (TDD)

**Files:**
- Create: `chrome-extension/tests/lib/parse.test.ts`
- Create: `chrome-extension/reader/lib/parse.ts`

**Spec reference:** §3.2 "Paragraph.id 生成规则" — `sec{sectionIndex}-p{p}`, sectionIndex = level-0 serial; p is continuous across subsections within same level-0.

- [ ] **Step 1: Write tests for buildParagraphs**

Create `chrome-extension/tests/lib/parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildParagraphs } from '../../reader/lib/parse';
import type { OutlineItem } from '../../reader/types';

const outline: OutlineItem[] = [
  { id: 'o0', label: 'Abstract', level: 0 },
  { id: 'o1', label: '1 Introduction', level: 0 },
  { id: 'o2', label: '2 Related', level: 0 },
  { id: 'o3', label: '2.1 RAG', level: 1 },
  { id: 'o4', label: '2.2 Long-context', level: 1 },
  { id: 'o5', label: '3 Method', level: 0 },
];

describe('buildParagraphs', () => {
  it('assigns sec{level0Idx}-p{n} ids and populates sectionId/section', () => {
    const raw = [
      { outlineItemId: 'o0', text: 'abs p0' },
      { outlineItemId: 'o1', text: 'intro p0' },
      { outlineItemId: 'o1', text: 'intro p1' },
      { outlineItemId: 'o3', text: '2.1 p0' },
      { outlineItemId: 'o3', text: '2.1 p1' },
      { outlineItemId: 'o4', text: '2.2 p0' },
      { outlineItemId: 'o5', text: 'method p0' },
    ];

    const result = buildParagraphs(raw, outline);

    expect(result.map(p => p.id)).toEqual([
      'sec0-p0',       // Abstract
      'sec1-p0', 'sec1-p1',  // 1 Intro
      'sec2-p0', 'sec2-p1', 'sec2-p2',  // 2 Related (includes 2.1 + 2.2 cumulative)
      'sec3-p0',       // 3 Method
    ]);

    expect(result[3].sectionId).toBe('o3');          // 2.1 RAG (deepest)
    expect(result[3].section).toBe('2.1 RAG');
    expect(result[5].sectionId).toBe('o4');          // 2.2 Long-context
    expect(result[5].section).toBe('2.2 Long-context');
    expect(result[1].sectionId).toBe('o1');          // 1 Intro (level-0, direct)
  });

  it('handles empty paragraphs array', () => {
    expect(buildParagraphs([], outline)).toEqual([]);
  });

  it('throws on paragraph referencing unknown outline item', () => {
    const raw = [{ outlineItemId: 'ghost', text: 'x' }];
    expect(() => buildParagraphs(raw, outline)).toThrow(/unknown outline/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run:
```bash
npm test -- tests/lib/parse.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement buildParagraphs**

Create `chrome-extension/reader/lib/parse.ts`:

```typescript
import type { OutlineItem, Paragraph } from '../types';

export interface RawParagraph {
  outlineItemId: string;
  text: string;
}

/**
 * Assign Paragraph.id using sec{level0Index}-p{pInLevel0} format (spec §3.2).
 * pInLevel0 is continuous across subsections within the same level-0 section.
 */
export function buildParagraphs(raw: RawParagraph[], outline: OutlineItem[]): Paragraph[] {
  const level0Items = outline.filter(o => o.level === 0);
  const level0IndexById = new Map<string, number>();
  const level0AncestorOf = new Map<string, string>();

  // Build ancestor map: for each outline item, find its level-0 ancestor id.
  // Algorithm: walk outline in document order, track the current level-0 item.
  let currentLevel0: string | null = null;
  for (const item of outline) {
    if (item.level === 0) {
      currentLevel0 = item.id;
      level0IndexById.set(item.id, level0Items.findIndex(o => o.id === item.id));
    }
    if (currentLevel0) level0AncestorOf.set(item.id, currentLevel0);
  }

  const outlineById = new Map(outline.map(o => [o.id, o]));
  const pCounter = new Map<string, number>();  // level0 id → next p index

  return raw.map((r): Paragraph => {
    const outlineItem = outlineById.get(r.outlineItemId);
    if (!outlineItem) throw new Error(`unknown outline item: ${r.outlineItemId}`);

    const level0Id = level0AncestorOf.get(r.outlineItemId);
    if (!level0Id) throw new Error(`no level-0 ancestor for ${r.outlineItemId}`);

    const sectionIdx = level0IndexById.get(level0Id)!;
    const pIdx = pCounter.get(level0Id) ?? 0;
    pCounter.set(level0Id, pIdx + 1);

    return {
      id: `sec${sectionIdx}-p${pIdx}`,
      sectionId: outlineItem.id,      // deepest
      section: outlineItem.label,
      text: r.text,
    };
  });
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run:
```bash
npm test -- tests/lib/parse.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/parse.test.ts chrome-extension/reader/lib/parse.ts
git commit -m "feat(ext): buildParagraphs with level-0 sectionIndex + deepest sectionId"
```

---

## Task 7: arXiv HTML + API Fixtures

**Files:**
- Create: `chrome-extension/tests/fixtures/arxiv-html.html`
- Create: `chrome-extension/tests/fixtures/arxiv-api.xml`

- [ ] **Step 1: Create trimmed arXiv HTML fixture**

Create `chrome-extension/tests/fixtures/arxiv-html.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Contextual Residuals</title></head>
<body>
<section class="ltx_section" id="S1">
  <h2 class="ltx_title">1 Introduction</h2>
  <p>Transformer decoders struggle to carry information across long distances.</p>
  <p>We argue for a different decomposition of long-context.</p>
</section>
<section class="ltx_section" id="S2">
  <h2 class="ltx_title">2 Related Work</h2>
  <section class="ltx_subsection" id="S2.SS1">
    <h3 class="ltx_title">2.1 Retrieval-augmented LMs</h3>
    <p>RAG systems concatenate retrieved tokens into the prompt.</p>
  </section>
  <section class="ltx_subsection" id="S2.SS2">
    <h3 class="ltx_title">2.2 Long-context attention</h3>
    <p>Landmark attention uses discrete anchor tokens.</p>
    <p>Mamba replaces attention with state-space models.</p>
  </section>
</section>
<section class="ltx_section" id="S3">
  <h2 class="ltx_title">3 Method</h2>
  <p>We store a low-rank projection of each past chunk.</p>
</section>
</body>
</html>
```

- [ ] **Step 2: Create arXiv API XML fixture**

Create `chrome-extension/tests/fixtures/arxiv-api.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2402.18413v2</id>
    <title>Contextual Residuals: A Lightweight Memory for Long-Horizon Transformers</title>
    <summary>We propose a lightweight per-chunk residual memory that injects past context as an attention bias, closing most of the gap to a 128k baseline with 1/8 the FLOPs.</summary>
    <author><name>Khan, Y.</name></author>
    <author><name>Voigt, R.</name></author>
    <published>2026-02-14T00:00:00Z</published>
    <category term="cs.LG"/>
  </entry>
</feed>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/fixtures/
git commit -m "test(ext): add arXiv HTML + API fixtures"
```

---

## Task 8: arxiv.ts — HTML + API Parsing (TDD)

**Files:**
- Create: `chrome-extension/tests/lib/arxiv.test.ts`
- Create: `chrome-extension/reader/lib/arxiv.ts`

**Spec reference:** §3.2 arXiv mode — parse `<section>` → outline, `<p>` → paragraphs; venue = `arXiv:{id}  [{category}]  {date}`.

- [ ] **Step 1: Write HTML parsing test**

Create `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArxivHtml, parseArxivApi, buildVenue } from '../../reader/lib/arxiv';

const htmlFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-html.html'), 'utf-8'
);
const apiFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-api.xml'), 'utf-8'
);

describe('parseArxivHtml', () => {
  const { outline, paragraphs } = parseArxivHtml(htmlFixture);

  it('extracts outline with correct levels', () => {
    expect(outline.map(o => ({ label: o.label, level: o.level }))).toEqual([
      { label: '1 Introduction', level: 0 },
      { label: '2 Related Work', level: 0 },
      { label: '2.1 Retrieval-augmented LMs', level: 1 },
      { label: '2.2 Long-context attention', level: 1 },
      { label: '3 Method', level: 0 },
    ]);
  });

  it('assigns unique stable ids to outline items', () => {
    const ids = outline.map(o => o.id);
    expect(new Set(ids).size).toBe(outline.length);
  });

  it('produces paragraphs with sec{idx}-p{n} ids', () => {
    const ids = paragraphs.map(p => p.id);
    expect(ids).toEqual([
      'sec0-p0', 'sec0-p1',              // 1 Introduction (level-0 idx 0)
      'sec1-p0', 'sec1-p1', 'sec1-p2',   // 2 Related (2.1 + 2.2, continuous)
      'sec2-p0',                          // 3 Method
    ]);
  });

  it('sets deepest sectionId for nested paragraphs', () => {
    const ragPara = paragraphs.find(p => p.text.startsWith('RAG systems'))!;
    expect(ragPara.section).toBe('2.1 Retrieval-augmented LMs');

    const mambaPara = paragraphs.find(p => p.text.startsWith('Mamba'))!;
    expect(mambaPara.section).toBe('2.2 Long-context attention');
  });
});

describe('parseArxivApi', () => {
  const meta = parseArxivApi(apiFixture);

  it('extracts title', () => {
    expect(meta.title).toMatch(/Contextual Residuals/);
  });

  it('extracts authors as array', () => {
    expect(meta.authors).toEqual(['Khan, Y.', 'Voigt, R.']);
  });

  it('extracts abstract (trimmed)', () => {
    expect(meta.abstract).toMatch(/^We propose/);
  });

  it('extracts primaryCategory and publishedDate', () => {
    expect(meta.primaryCategory).toBe('cs.LG');
    expect(meta.publishedDate).toBe('2026-02-14');
  });
});

describe('buildVenue', () => {
  it('formats arXiv venue string', () => {
    expect(buildVenue('2402.18413', 'cs.LG', '2026-02-14')).toBe(
      'arXiv:2402.18413  [cs.LG]  14 Feb 2026'
    );
  });

  it('returns empty string when category missing', () => {
    expect(buildVenue('2402.18413', '', '2026-02-14')).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement arxiv.ts**

Create `chrome-extension/reader/lib/arxiv.ts`:

```typescript
import type { OutlineItem } from '../types';
import { buildParagraphs, RawParagraph } from './parse';

export interface ArxivApiMeta {
  title: string;
  authors: string[];
  abstract: string;
  primaryCategory: string;
  publishedDate: string;   // YYYY-MM-DD
}

export function parseArxivHtml(html: string): {
  outline: OutlineItem[];
  paragraphs: ReturnType<typeof buildParagraphs>;
} {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const outline: OutlineItem[] = [];
  const raw: RawParagraph[] = [];

  // Section + paragraph extraction. Walk in document order.
  const allSections = doc.querySelectorAll<HTMLElement>('section[id]');
  const sectionIdMap = new Map<HTMLElement, string>();
  let counter = 0;

  allSections.forEach(sec => {
    const id = `o${counter++}`;
    sectionIdMap.set(sec, id);
    // Level: parent <section> makes it nested
    const parentSection = sec.parentElement?.closest('section[id]');
    const level = parentSection ? 1 : 0;
    const titleEl = sec.querySelector(':scope > h2, :scope > h3');
    const label = titleEl?.textContent?.trim() ?? '';
    outline.push({ id, label, level });
  });

  // Paragraphs: for each section, take its direct <p> children (not descendants of inner section)
  allSections.forEach(sec => {
    const pEls = Array.from(sec.children).filter(c => c.tagName === 'P') as HTMLParagraphElement[];
    for (const p of pEls) {
      raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: p.textContent?.trim() ?? '' });
    }
  });

  const paragraphs = buildParagraphs(raw, outline);
  return { outline, paragraphs };
}

export function parseArxivApi(xml: string): ArxivApiMeta {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error('arXiv API: no <entry>');

  const title = entry.querySelector('title')?.textContent?.trim() ?? '';
  const authors = Array.from(entry.querySelectorAll('author name'))
    .map(el => el.textContent?.trim() ?? '')
    .filter(Boolean);
  const abstract = entry.querySelector('summary')?.textContent?.trim() ?? '';
  const primaryCategory = entry.querySelector('category')?.getAttribute('term') ?? '';
  const publishedIso = entry.querySelector('published')?.textContent ?? '';
  const publishedDate = publishedIso.slice(0, 10);

  return { title, authors, abstract, primaryCategory, publishedDate };
}

export function buildVenue(id: string, category: string, publishedDate: string): string {
  if (!category) return '';
  // "2026-02-14" → "14 Feb 2026"
  const [y, m, d] = publishedDate.split('-').map(s => parseInt(s, 10));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${d} ${months[(m - 1) | 0]} ${y}`;
  return `arXiv:${id}  [${category}]  ${dateStr}`;
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run:
```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: all 10 tests pass (parseArxivHtml: 4 + parseArxivApi: 4 + buildVenue: 2).

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/arxiv.test.ts chrome-extension/reader/lib/arxiv.ts
git commit -m "feat(ext): arXiv HTML + API parsing"
```

---

## Task 9: arxiv.ts — fetch orchestrator (TDD)

**Files:**
- Modify: `chrome-extension/tests/lib/arxiv.test.ts`
- Modify: `chrome-extension/reader/lib/arxiv.ts`

**Spec reference:** §3.2 arXiv mode — parallel fetch HTML + API; fallback to PDF on 404.

- [ ] **Step 1: Add test for loadArxivPaper (mocked fetch)**

Append to `chrome-extension/tests/lib/arxiv.test.ts`:

```typescript
import { vi, beforeEach } from 'vitest';
import { loadArxivPaper } from '../../reader/lib/arxiv';

describe('loadArxivPaper', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response(apiFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('fetches html + api in parallel and returns Paper', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error();
    expect(result.paper.id).toBe('2402.18413');
    expect(result.paper.title).toMatch(/Contextual Residuals/);
    expect(result.paper.authors).toEqual(['Khan, Y.', 'Voigt, R.']);
    expect(result.paper.outline.length).toBeGreaterThan(0);
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    expect(result.paper.venue).toMatch(/^arXiv:2402\.18413/);
  });

  it('returns fallback-to-pdf when html 404s', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response(apiFixture, { status: 200 }));
    }) as any;
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('fallback-pdf');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: `loadArxivPaper` not exported.

- [ ] **Step 3: Implement loadArxivPaper**

Append to `chrome-extension/reader/lib/arxiv.ts`:

```typescript
import type { Paper } from '../types';
import { emptyMemory } from '../types';
import { urlHash } from './ids';

export type LoadResult =
  | { kind: 'ok'; paper: Paper }
  | { kind: 'fallback-pdf' }
  | { kind: 'error'; message: string };

export async function loadArxivPaper(id: string): Promise<LoadResult> {
  const htmlUrl = `https://arxiv.org/html/${id}`;
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${id}`;

  const [htmlRes, apiRes] = await Promise.all([
    fetch(htmlUrl),
    fetch(apiUrl),
  ]);

  if (htmlRes.status === 404) return { kind: 'fallback-pdf' };
  if (!htmlRes.ok) return { kind: 'error', message: `HTML fetch ${htmlRes.status}` };
  if (!apiRes.ok) return { kind: 'error', message: `API fetch ${apiRes.status}` };

  const [htmlText, apiText] = await Promise.all([htmlRes.text(), apiRes.text()]);
  const { outline, paragraphs } = parseArxivHtml(htmlText);
  const meta = parseArxivApi(apiText);
  const hash = await urlHash(htmlUrl);

  const paper: Paper = {
    id,
    urlHash: hash,
    title: meta.title,
    authors: meta.authors,
    abstract: meta.abstract,
    venue: buildVenue(id, meta.primaryCategory, meta.publishedDate),
    outline,
    paragraphs,
    memory: emptyMemory(),
  };
  return { kind: 'ok', paper };
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run:
```bash
npm test -- tests/lib/arxiv.test.ts
```

Expected: 12 tests pass (previous 10 + loadArxivPaper: 2).

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/arxiv.test.ts chrome-extension/reader/lib/arxiv.ts
git commit -m "feat(ext): loadArxivPaper with html+api parallel fetch and 404 fallback"
```

---

## Task 10: pdf.ts — pdfjs-dist Wrapper (TDD)

**Files:**
- Create: `chrome-extension/tests/lib/pdf.test.ts`
- Create: `chrome-extension/reader/lib/pdf.ts`

**Spec reference:** §3.2 PDF mode — `getOutline` → outline (fallback to per-page), `getTextContent` → paragraphs, `getMetadata` → title/authors.

This task uses pdfjs-dist's built-in `getDocument` loader. Tests use `pdfjs-dist/legacy/build/pdf.mjs` directly (it supports node + jsdom).

- [ ] **Step 1: Install pdf fixture**

Pick a small public-domain PDF (2–3 pages) and save it:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension/tests/fixtures
curl -L -o sample.pdf https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
```

- [ ] **Step 2: Write test**

Create `chrome-extension/tests/lib/pdf.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf, splitParagraphsByGap, type TextItemLike } from '../../reader/lib/pdf';

describe('splitParagraphsByGap (pure)', () => {
  const make = (str: string, y: number): TextItemLike => ({
    str,
    transform: [1, 0, 0, 1, 0, y],
  });

  it('joins items within the gap threshold as one paragraph', () => {
    const items = [make('line 1', 700), make('line 2', 686)];  // gap 14 < 18
    expect(splitParagraphsByGap(items)).toEqual(['line 1 line 2']);
  });

  it('splits when gap exceeds threshold', () => {
    const items = [
      make('para1 line1', 700),
      make('para1 line2', 686),   // gap 14 — same para
      make('para2 start', 650),   // gap 36 > 18 — new para
    ];
    expect(splitParagraphsByGap(items)).toEqual(['para1 line1 para1 line2', 'para2 start']);
  });

  it('ignores empty strings', () => {
    const items = [make('a', 700), make('', 686), make('b', 684)];
    expect(splitParagraphsByGap(items)).toEqual(['a b']);
  });

  it('returns empty array for empty input', () => {
    expect(splitParagraphsByGap([])).toEqual([]);
  });

  it('respects custom threshold', () => {
    const items = [make('a', 700), make('b', 680)];  // gap 20
    expect(splitParagraphsByGap(items, 10)).toEqual(['a', 'b']);
    expect(splitParagraphsByGap(items, 25)).toEqual(['a b']);
  });
});

describe('parsePdf', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('extracts numPages', async () => {
    const parsed = await parsePdf(buf);
    expect(parsed.numPages).toBeGreaterThan(0);
  });

  it('emits at least one paragraph', async () => {
    const parsed = await parsePdf(buf);
    expect(parsed.paragraphs.length).toBeGreaterThan(0);
    expect(parsed.paragraphs[0].text.length).toBeGreaterThan(0);
  });

  it('produces per-page outline (Page N labels) with page field set', async () => {
    const parsed = await parsePdf(buf);
    expect(parsed.outline).toHaveLength(parsed.numPages);
    expect(parsed.outline[0]).toMatchObject({ label: 'Page 1', level: 0, page: 1 });
    expect(parsed.outline.every(o => o.level === 0 && o.page)).toBe(true);
  });

  it('assigns paragraphs to their source page via sectionId', async () => {
    const parsed = await parsePdf(buf);
    const outlineIds = new Set(parsed.outline.map(o => o.id));
    for (const p of parsed.paragraphs) {
      expect(outlineIds.has(p.sectionId)).toBe(true);
    }
  });
});
```

Note: the dummy PDF fixture may have sparse text (no natural paragraph gaps), so `parsePdf`'s paragraph count might be 1 per page — the `splitParagraphsByGap` unit tests above cover the threshold logic without relying on a rich PDF. For richer multi-paragraph fixture coverage, Plan 2 will swap in a multi-column arXiv PDF.

- [ ] **Step 3: Run to confirm failure**

Run:
```bash
npm test -- tests/lib/pdf.test.ts
```

Expected: module not found.

- [ ] **Step 4: Implement pdf.ts**

Create `chrome-extension/reader/lib/pdf.ts`:

```typescript
// Use legacy build (mjs) for node+jsdom compatibility in tests.
// Worker configuration lives in reader/main.tsx (the only runtime that needs it).
// Tests run without worker (pdfjs falls back to fake worker when workerSrc='').
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineItem } from '../types';
import { buildParagraphs, RawParagraph } from './parse';

export interface ParsedPdf {
  numPages: number;
  title: string;
  authors: string[];
  outline: OutlineItem[];
  paragraphs: ReturnType<typeof buildParagraphs>;
}

export interface TextItemLike {
  str: string;
  transform: number[];  // [a, b, c, d, e, f] — f is y in user space
}

// Phase 1 paragraph split threshold. If the vertical gap between the bottom of
// the previous text item and the top of the next one exceeds this many units
// (PDF user-space), start a new paragraph. ~1.5× typical line height (12pt
// body is ~14pt line height) for common research-paper layout.
export const PARAGRAPH_GAP_THRESHOLD = 18;

/**
 * Pure helper, exported for unit testing.
 * Splits a flat list of PDF text items into paragraphs by vertical gap.
 * Items are assumed to arrive in reading order (top-to-bottom).
 */
export function splitParagraphsByGap(
  items: TextItemLike[],
  threshold = PARAGRAPH_GAP_THRESHOLD,
): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let lastY: number | null = null;

  const flush = () => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    current = [];
  };

  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(lastY - y) > threshold) {
      flush();
    }
    current.push(item.str);
    lastY = y;
  }
  flush();
  return paragraphs;
}

export async function parsePdf(data: ArrayBuffer): Promise<ParsedPdf> {
  const doc = await pdfjs.getDocument({ data }).promise;
  const numPages = doc.numPages;

  // Metadata
  const meta = await doc.getMetadata().catch(() => null);
  const title = ((meta?.info as any)?.Title as string | undefined)?.trim() ?? 'Untitled PDF';
  const authorRaw = ((meta?.info as any)?.Author as string | undefined) ?? '';
  const authors = authorRaw ? authorRaw.split(/[,;]\s*/).filter(Boolean) : [];

  // Phase 1 outline strategy: ALWAYS use per-page fallback.
  // pdfjs `getOutline()` returns items with `dest` that need resolving via
  // `getPageIndex(dest[0])` — that work + level nesting + page-range tracking
  // for paragraph assignment is Plan 2 scope. Phase 1 goal is just to produce
  // a correct Paper.outline/paragraphs shape that round-trips through storage.
  const outline: OutlineItem[] = Array.from({ length: numPages }, (_, i) => ({
    id: `o${i}`,
    label: `Page ${i + 1}`,
    level: 0,
    page: i + 1,
  }));

  // Paragraphs: group text items within each page by vertical gap.
  const raw: RawParagraph[] = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const outlineItemId = outline[pageNum - 1].id;  // Page N → o{N-1}

    const items = (content.items as any[])
      .filter((it) => 'str' in it)
      .map((it): TextItemLike => ({ str: it.str, transform: it.transform }));

    for (const text of splitParagraphsByGap(items)) {
      raw.push({ outlineItemId, text });
    }
  }

  const paragraphs = buildParagraphs(raw, outline);
  return { numPages, title, authors, outline, paragraphs };
}
```

Note for Plan 2: real `getOutline()` parsing (nested sections + `getPageIndex(dest[0])` → page mapping) and horizontal-column awareness (multi-column layouts) live in Plan 2's refinement of `parsePdf`. Phase 1 intentionally produces a flat per-page outline so the data model is valid end-to-end.

- [ ] **Step 5: Run tests to confirm pass**

Run:
```bash
npm test -- tests/lib/pdf.test.ts
```

Expected: 3 tests pass. (Note: worker warnings in jsdom are expected and OK.)

If the dummy fixture doesn't cover the parsing path well, skip `it.skip()` the paragraph test and rely on manual extension-runtime verification in Task 15.

- [ ] **Step 6: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/tests/lib/pdf.test.ts chrome-extension/reader/lib/pdf.ts \
  chrome-extension/tests/fixtures/sample.pdf
git commit -m "feat(ext): pdfjs-dist wrapper with outline fallback"
```

---

## Task 11: manifest.json + rules.json

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/rules.json`

**Spec reference:** §3.1 URL 拦截 + §3.8 (manifest declares options_ui).

- [ ] **Step 1: Write manifest.json**

Create `chrome-extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "PaperFlow",
  "version": "0.1.0",
  "description": "AI-assisted paper reader for arXiv and PDFs.",
  "permissions": ["storage", "declarativeNetRequest"],
  "host_permissions": [
    "https://arxiv.org/*",
    "https://export.arxiv.org/*",
    "*://*/*.pdf"
  ],
  "background": {
    "service_worker": "background/sw.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://arxiv.org/abs/*"],
      "js": ["content/inject.js"],
      "run_at": "document_idle"
    }
  ],
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "paperflow_rules",
        "enabled": true,
        "path": "rules.json"
      }
    ]
  },
  "web_accessible_resources": [
    {
      "resources": ["reader/index.html", "reader/*", "assets/*"],
      "matches": ["<all_urls>"]
    }
  ],
  "options_ui": {
    "page": "options/index.html",
    "open_in_tab": true
  },
  "action": {
    "default_title": "PaperFlow"
  }
}
```

- [ ] **Step 2: Write rules.json (empty — actual rules are injected by SW)**

Create `chrome-extension/rules.json`:

```json
[]
```

Rationale: `declarativeNetRequest` static rules can't expand `chrome-extension://{ext-id}/` (the id is only known at install time). Task 13's SW calls `chrome.declarativeNetRequest.updateDynamicRules` with `chrome.runtime.getURL(...)` on `onInstalled` / `onStartup`, which substitutes the real extension URL.

- [ ] **Step 3: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/manifest.json chrome-extension/rules.json
git commit -m "feat(ext): manifest + empty rules.json (dynamic rules added at SW install)"
```

---

## Task 12: content/inject.ts — abs Page Button

**Files:**
- Create: `chrome-extension/content/inject.ts`

**Spec reference:** §2 Scenario C, §3.1 — abs page is not auto-redirected; inject "Open in PaperFlow" button.

- [ ] **Step 1: Write inject.ts**

Create `chrome-extension/content/inject.ts`:

```typescript
// Runs on arxiv.org/abs/* at document_idle. Bundled as IIFE (see vite.content.config.ts).
(function injectPaperFlowButton() {
  if (document.querySelector('.pf-open-btn')) return;

  // Pick the first matching insertion point. arXiv's abs page class/id names
  // have churned over the years; cover the common ones plus `main` as a catch-all.
  const header =
    document.querySelector<HTMLElement>('.extra-services') ||
    document.querySelector<HTMLElement>('.abstract') ||
    document.querySelector<HTMLElement>('.full-text') ||
    document.querySelector<HTMLElement>('#abs') ||
    document.querySelector<HTMLElement>('main') ||
    document.body;
  if (!header) return;

  const btn = document.createElement('button');
  btn.className = 'pf-open-btn';
  btn.textContent = 'Open in PaperFlow →';
  Object.assign(btn.style, {
    display: 'inline-block',
    padding: '6px 14px',
    margin: '8px 0',
    background: '#8B6B3E',
    color: '#FBF7EE',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  });

  btn.addEventListener('click', () => {
    const absUrl = location.href;
    const htmlUrl = absUrl.replace('/abs/', '/html/');
    // Use #src= (fragment) to match DNR rules — avoids URL & splitting.
    // No encoding needed because fragment survives as-is.
    const readerUrl = chrome.runtime.getURL(`reader/index.html#src=${htmlUrl}`);
    location.href = readerUrl;
  });

  header.prepend(btn);
})();
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/content/inject.ts
git commit -m "feat(ext): abs page inject 'Open in PaperFlow' button"
```

---

## Task 13: background/sw.ts — Dynamic Rules + PDF CORS Proxy

**Files:**
- Create: `chrome-extension/background/sw.ts`

**Spec reference:** §3.1 (redirect), §3.2 (SW CORS proxy for PDF > 30MB warning).

- [ ] **Step 1: Write sw.ts**

Create `chrome-extension/background/sw.ts`:

```typescript
/// <reference types="chrome" />

const READER_URL = chrome.runtime.getURL('reader/index.html');

// On install, register dynamic rules that redirect arxiv + pdf URLs to the reader page.
//
// Note: we use `#src=\0` (URL fragment) instead of `?src=\0` because
// DNR's regexSubstitution does NOT url-encode the matched group. A PDF URL
// like `https://cdn.example.com/paper.pdf?token=abc&exp=123` embedded as
// `?src=...` would be parsed by URLSearchParams as `src=...&exp=...` — the
// `&` splits the original URL. Fragments don't participate in query parsing,
// so `#src=<raw url>` survives intact and reader reads via `location.hash`.
async function registerRules() {
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${READER_URL}#src=\\0` },
      },
      condition: {
        regexFilter: '^https://arxiv\\.org/(html|pdf)/.+',
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
      },
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${READER_URL}#src=\\0` },
      },
      condition: {
        regexFilter: '^https?://.+\\.pdf(\\?.*)?$',
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        // excludedRequestDomains filters by *target* domain (the domain being
        // loaded), which is what we want — Rule 1 already handles arxiv.org.
        // excludedInitiatorDomains filters by the *source* page, which is
        // unreliable for address-bar navigation (no initiator).
        excludedRequestDomains: ['arxiv.org'],
      },
    },
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: rules,
  });
}

chrome.runtime.onInstalled.addListener(registerRules);
chrome.runtime.onStartup.addListener(registerRules);

// PDF CORS fallback — reader page messages SW with url, SW fetches and returns bytes.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'pdf-proxy-fetch' && typeof msg.url === 'string') {
    (async () => {
      try {
        const res = await fetch(msg.url);
        if (!res.ok) {
          sendResponse({ kind: 'error', message: `HTTP ${res.status}` });
          return;
        }
        const buf = await res.arrayBuffer();
        const size = buf.byteLength;
        if (size > 30 * 1024 * 1024) {
          sendResponse({
            kind: 'error',
            message: `PDF is ${(size / 1024 / 1024).toFixed(1)} MB — exceeds 30 MB SW proxy limit.`,
          });
          return;
        }
        // Return as transferable — but chrome.runtime.sendResponse can't transfer ArrayBuffer directly.
        // Convert to base64 for the reader to decode.
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        sendResponse({ kind: 'ok', base64: btoa(bin), size });
      } catch (err) {
        sendResponse({ kind: 'error', message: String(err) });
      }
    })();
    return true;  // keep sendResponse alive for async
  }
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/background/sw.ts
git commit -m "feat(ext): SW dynamic rules + PDF CORS proxy"
```

---

## Task 14: vite.config.ts — Multi-Entry Build

**Files:**
- Create: `chrome-extension/vite.config.ts`
- Create: `chrome-extension/vite.content.config.ts`
- Modify: `chrome-extension/package.json` (add second build script)

MV3 SW runs as ESM (manifest.background.type = "module"). React entries (reader/options) run as ESM. **Content script must be IIFE** (§7 spec note)—Chrome injects it as a plain script, ESM imports syntax-error immediately. Use a second Vite config to emit IIFE for inject.ts.

- [ ] **Step 1: Write main vite.config.ts (reader + sw, ESM; options copied verbatim)**

Create `chrome-extension/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-static',
      writeBundle() {
        mkdirSync('dist', { recursive: true });
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('rules.json', 'dist/rules.json');
        mkdirSync('dist/options', { recursive: true });
        copyFileSync('options/index.html', 'dist/options/index.html');
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        reader: resolve(__dirname, 'reader/index.html'),
        sw: resolve(__dirname, 'background/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'sw') return 'background/sw.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
```

- [ ] **Step 2: Write vite.content.config.ts (content script, IIFE)**

Create `chrome-extension/vite.content.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,  // main build cleared; don't re-clear
    lib: {
      entry: resolve(__dirname, 'content/inject.ts'),
      name: 'PaperFlowInject',
      formats: ['iife'],
      fileName: () => 'content/inject.js',
    },
    rollupOptions: {
      // inject.ts is self-contained; no externals.
      output: {
        extend: true,
      },
    },
  },
});
```

- [ ] **Step 3: Update package.json build script to run both**

Modify `chrome-extension/package.json` scripts:

```json
"scripts": {
  "build": "vite build && vite build --config vite.content.config.ts",
  "dev": "vite build --watch & vite build --config vite.content.config.ts --watch",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

**Platform note:** the `dev` script uses POSIX `&` to background the first watcher. This works on macOS/Linux only. Windows users should either:
- Open two terminals and run each `vite build --watch` / `vite build --config vite.content.config.ts --watch` separately, OR
- Add `npm-run-all` as a devDependency and replace with `"dev": "run-p dev:*"` + two sub-scripts `dev:main` / `dev:content`.

Phase 1 target env is macOS (per CLAUDE.md), so the `&`-form is fine as-is.

- [ ] **Step 4: Verify both configs build**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected:
- First `vite build` produces `dist/reader/`, `dist/options/`, `dist/background/sw.js`, `dist/manifest.json`, `dist/rules.json`
- Second `vite build --config vite.content.config.ts` produces `dist/content/inject.js` in IIFE form (file starts with `(function()`/`!function()`)

Verify IIFE format:
```bash
head -c 50 dist/content/inject.js
```

Expected: no `import`/`export` keywords at top-level; IIFE wrapper present.

- [ ] **Step 5: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/vite.config.ts chrome-extension/vite.content.config.ts \
  chrome-extension/package.json
git commit -m "feat(ext): vite multi-entry build; content script as IIFE"
```

---

## Task 15: Reader Page Shell (JSON Dump)

**Files:**
- Create: `chrome-extension/reader/index.html`
- Create: `chrome-extension/reader/main.tsx`
- Create: `chrome-extension/options/index.html`

- [ ] **Step 1: Create reader/index.html**

Create `chrome-extension/reader/index.html`:

```html
<!DOCTYPE html>
<html>
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
<body>
  <div id="root">Loading…</div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create reader/main.tsx**

Create `chrome-extension/reader/main.tsx`:

```typescript
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
// pdfjs worker setup must run BEFORE any parsePdf import chain uses it.
// @ts-ignore — vite ?url suffix
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { loadArxivPaper } from './lib/arxiv';
import { parsePdf } from './lib/pdf';
import { normalizeArxivId, paperKey, urlHash } from './lib/ids';
import { getCachedParsed, setCachedParsed, getMemory, setMemory } from './lib/storage';
import { emptyMemory } from './types';
import type { Paper } from './types';

// Read src from hash (#src=...) per DNR redirect convention; fall back to
// ?src= for backward compat with manual test links.
//
// Hash path is NOT url-decoded because DNR's regexSubstitution inserts the
// raw \0 match without encoding, and content script (Task 12) also writes
// #src=${htmlUrl} raw. Reading must stay symmetric — calling
// decodeURIComponent here would corrupt any literal %XX sequences in the
// original URL (e.g. CDN signed URLs with %2B / %2F / %3D).
function readSrc(): string | null {
  if (location.hash.startsWith('#src=')) {
    return location.hash.slice('#src='.length);
  }
  const qs = new URLSearchParams(location.search);
  return qs.get('src');
}

function App() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; paper: Paper }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        const src = readSrc();
        if (!src) {
          setState({ kind: 'error', message: 'No #src= in URL' });
          return;
        }

        const arxivId = normalizeArxivId(src);
        const hash = await urlHash(src);
        const key = arxivId ?? hash;

        // Cache hit?
        const cached = await getCachedParsed(key);
        if (cached) {
          const mem = (await getMemory(key)) ?? emptyMemory();
          setState({
            kind: 'ok',
            paper: {
              id: arxivId ?? undefined,
              urlHash: hash,
              title: cached.title,
              authors: cached.authors,
              abstract: cached.abstract,
              venue: cached.venue,
              outline: cached.outline,
              paragraphs: cached.paragraphs,
              memory: mem,
            },
          });
          return;
        }

        // Fresh load
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
            setState({ kind: 'ok', paper: result.paper });
            return;
          }
          if (result.kind === 'fallback-pdf') {
            await loadPdfMode(`https://arxiv.org/pdf/${arxivId}`, arxivId);
            return;
          }
          setState({ kind: 'error', message: result.message });
          return;
        }

        // Direct PDF
        await loadPdfMode(src, undefined);
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    })();

    async function loadPdfMode(pdfUrl: string, arxivId: string | undefined) {
      let buf: ArrayBuffer;
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = await res.arrayBuffer();
      } catch {
        const proxyRes = await chrome.runtime.sendMessage({ kind: 'pdf-proxy-fetch', url: pdfUrl });
        if (proxyRes?.kind !== 'ok') {
          setState({ kind: 'error', message: proxyRes?.message ?? 'SW proxy failed' });
          return;
        }
        const bin = atob(proxyRes.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        buf = bytes.buffer;
      }

      const parsed = await parsePdf(buf);
      const hash = await urlHash(pdfUrl);
      const key = arxivId ?? hash;

      // spec §3.2 PDF mode venue: "PDF · {filename}" or undefined if no filename.
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
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        venue: paper.venue,
        outline: paper.outline,
        paragraphs: paper.paragraphs,
      });
      if (!(await getMemory(key))) await setMemory(key, emptyMemory());
      setState({ kind: 'ok', paper });
    }
  }, []);

  if (state.kind === 'loading') return <div className="status">Loading paper…</div>;
  if (state.kind === 'error') return <div className="err">Error: {state.message}</div>;

  return (
    <div>
      <h1>{state.paper.title}</h1>
      <div className="status">
        {state.paper.authors.join(', ')}
        {state.paper.venue ? ` · ${state.paper.venue}` : ''}
        {' · '}
        {state.paper.outline.length} sections · {state.paper.paragraphs.length} paragraphs
      </div>
      <pre>{JSON.stringify(state.paper, null, 2)}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 3: Create options/index.html (static placeholder, no script)**

Phase 1 does not implement BYOK config (that's Plan 3). Keep Options as a static HTML stub so the extension's "Options" menu item opens a visible page without a fake React entry point that would later confuse Plan 3. `vite.config.ts` (Task 14) already copies this file verbatim to `dist/options/index.html`.

Create `chrome-extension/options/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>PaperFlow Options</title>
  <style>
    body { font-family: ui-sans-serif, system-ui; padding: 32px; max-width: 640px; color: #1A1812; background: #FBF7EE; }
    h1 { font-family: ui-serif, Georgia, serif; }
  </style>
</head>
<body>
  <h1>PaperFlow</h1>
  <p>BYOK configuration (baseURL, API key, model) will be added in Plan 3.</p>
  <p>In Phase 1 the reader works without AI features enabled.</p>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/reader/index.html chrome-extension/reader/main.tsx \
  chrome-extension/options/index.html
git commit -m "feat(ext): reader page renders parsed Paper JSON; static options stub"
```

---

## Task 16: Build + Manual Verification in Chrome

**Files:** (no source changes)

- [ ] **Step 1: Run build**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm run build
```

Expected: `dist/` contains `manifest.json`, `rules.json`, `reader/index.html`, `options/index.html`, `content/inject.js`, `background/sw.js`, `assets/*`.

- [ ] **Step 2: Load unpacked in Chrome**

1. Open `chrome://extensions`
2. Toggle "Developer mode" on
3. Click "Load unpacked" → select `chrome-extension/dist/`
4. Extension should appear as "PaperFlow" with no manifest errors.

**Dev workflow**: after the initial load, subsequent changes need a rebuild (`npm run dev` rebuilds on file change in the background) plus a reload on `chrome://extensions` (click the ↻ reload icon on the PaperFlow card). The page you're testing also needs a refresh. There is no hot-reload — the extension runtime doesn't watch the dist dir.

- [ ] **Step 3: Test arXiv HTML redirect**

1. Navigate to `https://arxiv.org/html/2402.18413` (use an arxiv id that has HTML)
2. Expected: URL redirects to `chrome-extension://<id>/reader/index.html#src=https://arxiv.org/html/2402.18413`
3. Page shows: title, authors, "N sections · M paragraphs" status line, and full JSON dump of `Paper` below
4. Verify `outline[]` has reasonable section labels, `paragraphs[]` has `id: "sec0-p0"` etc., `abstract` has content, `venue` = `arXiv:2402.18413  [cs.LG]  14 Feb 2026` format

- [ ] **Step 4: Test arXiv PDF redirect (fallback to html first)**

1. Navigate to `https://arxiv.org/pdf/2402.18413`
2. Expected: reader page loads; paper loads via html first (loadArxivPaper uses html URL not pdf). JSON dump looks identical to Step 3.

- [ ] **Step 5: Test PDF mode (non-arXiv)**

1. Navigate to a public PDF URL, e.g. `https://arxiv.org/pdf/2402.18413.pdf` or any web PDF
2. If fetch CORS works, reader loads directly; otherwise SW proxy kicks in
3. Verify JSON dump has `id: undefined`, `urlHash: "..."`, `outline` with either real or `Page N` fallback entries

- [ ] **Step 6: Test abs page injection**

1. Navigate to `https://arxiv.org/abs/2402.18413`
2. Expected: page does NOT auto-redirect. A walnut-colored "Open in PaperFlow →" button appears in the abstract area
3. Click button → redirects to reader page

- [ ] **Step 7: Test cache hit**

1. Reload the reader page for an arxiv URL already visited
2. Open DevTools Network tab; second load should **not** fetch `arxiv.org/html/...` or `export.arxiv.org/api/...` (cache-only path)
3. JSON dump should show identical `title` / `authors` / `abstract` / `venue` as first load — cache covers all fields per §3.4 "跳过 fetch/parse"
4. **Version-sharing check**: open `arxiv.org/pdf/2402.18413v1` first, then `arxiv.org/pdf/2402.18413v2` — second load should be cache-hit (no network), same JSON, because `normalizeArxivId` strips `vN` to share the `paper.id` cache key. This is by-design per spec §3.4

- [ ] **Step 8: Commit verification notes (optional)**

Add a short note to `docs/plans/2026-04-21-plan-phase-1-scaffolding.md` at the bottom:

```markdown
---

## Verification log

Phase 1 verified against:
- `arxiv.org/html/2402.18413` → ok
- `arxiv.org/pdf/2402.18413` → html-first ok
- `arxiv.org/abs/2402.18413` → button injection ok
- direct PDF URL → ok (or SW proxy if noted)
```

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add docs/plans/2026-04-21-plan-phase-1-scaffolding.md
git commit -m "docs(plan): Phase 1 verification log"
```

---

## Task 17: Final Check — All Tests + Typecheck

- [ ] **Step 1: Run full test suite**

Run:
```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension
npm test
```

Expected: all tests pass (ids: 11, storage: 5, parse: 3, arxiv: 12, pdf: 9 → **~40 tests**).

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```

Expected: exits 0, no type errors.

- [ ] **Step 3: Build**

Run:
```bash
npm run build
```

Expected: exits 0, `dist/` populated.

- [ ] **Step 4: Final commit**

If any fixes needed from the last 3 steps, commit them:

```bash
cd /Users/mayuanchao/Workspace/PaperFlow-Design
git add chrome-extension/
git commit -m "chore(ext): Phase 1 complete — all tests + typecheck + build green"
```

---

## Phase 1 Done Criteria

- ✅ `dist/` loads cleanly as Chrome extension (no manifest errors)
- ✅ arXiv HTML/PDF URLs auto-redirect to reader page via declarativeNetRequest
- ✅ arXiv abs page gets "Open in PaperFlow" injected button
- ✅ Reader page dumps `Paper` JSON matching §5 data model exactly
- ✅ `paperKey` / `urlHash` / `normalizeArxivId` tested and working
- ✅ Storage wrappers write + read `paper:{key}:parsed` and `paper:{key}:memory`
- ✅ Cache hit on second load of same paper

## Next: Plan 2

Phase 2 picks up with tokens.css migration + prototype component conversion + Focus variant rendering on top of the parsed data. It will replace the JSON dump with a real PaperPage + OutlinePanel + TopBar.
