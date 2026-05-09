// chrome-extension/tests/tool-description-audit.test.ts
//
// EVAL-04 D-D1 — static-grep lint asserting all 5 v1.2 tool files keep the
// 4-element-group description discipline (tool name / purpose / param+type / when-not-to-use).
//
// C-7 (cross-AI review iter 2): the conceptual unit is "element-group", not raw
// `it()` block count. Element-groups can produce >1 it() block (e.g. multi-keyword
// Element 1 for read-paper-section requires both 'Read' AND 'paragraph' = 2 it()
// blocks). Live-file it() count acceptance is `>=20` (lower bound), not `==20`.
//
// C-8 (cross-AI review iter 2): missing tool file is a HARD FAIL via existsSync
// precondition (NOT a silent skip-marker — that would let a deleted tool pass audit).
//
// C-9 (cross-AI review iter 3): Element 3 strengthened to require BOTH arg
// keyword AND a type-indication regex anchored to the canonical
// `Argument: <kw> (string).` form (or `(string[])` for plural). The Task 1
// description amendment in this same plan establishes this canonical form.
//
// W-04 revision iter 1 — the regression test is non-destructive: instead of
// mutating real production tool files via destructive shell rewrites (which
// leave the repo in a broken state if any subsequent step fails), it injects
// a STUB source string into the assertion helper and asserts the helper
// THROWS. Zero filesystem side effects.
//
// Pattern mirrors chrome-extension/tests/byok-leak-grep.test.ts and
// chrome-extension/tests/no-anthropic-sdk-grep.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const TOOLS_DIR = resolve(REPO_ROOT, 'supabase/functions/agent-run/tools');

type ToolSpec = {
  file: string;
  /** Element 1 — tool name / domain word that must appear (case-sensitive unless noted). */
  nameMustContain: Array<{ value: string; caseInsensitive?: boolean }>;
  /** Element 2 — verb-led opener: regex matched against the START of the description string. */
  purposeOpenerRegex: RegExp;
  /** Element 3 (C-9) — parameter keywords; ALL keywords must appear in description body. */
  paramKeywordsAllOf: string[];
  /** Element 3 (C-9 iter 3) — canonical type-indication regex anchored to `Argument: <kw> (string).` form. */
  paramTypeIndicationRegex: RegExp;
  /** Element 4 — fixed phrase for the when-not-to-use reverse example. */
  whenNotToUsePhrase: string;
};

const TOOLS: ToolSpec[] = [
  {
    file: 'search-arxiv.ts',
    nameMustContain: [{ value: 'arXiv' }],
    purposeOpenerRegex: /^Search arXiv for/,
    paramKeywordsAllOf: ['query'],
    paramTypeIndicationRegex: /Argument:\s*query\s*\(string\)/,
    whenNotToUsePhrase: 'WHEN NOT TO USE',
  },
  {
    file: 'fetch-semantic-scholar.ts',
    nameMustContain: [{ value: 'Semantic Scholar' }],
    purposeOpenerRegex: /^Look up paper metadata/,
    paramKeywordsAllOf: ['paperId'],
    paramTypeIndicationRegex: /Argument:\s*paperId\s*\(string\)/,
    whenNotToUsePhrase: 'WHEN NOT TO USE',
  },
  {
    file: 'screenshot-paragraph.ts',
    nameMustContain: [{ value: 'screenshot', caseInsensitive: true }],
    purposeOpenerRegex: /^Capture a screenshot/,
    paramKeywordsAllOf: ['paragraphId'],
    paramTypeIndicationRegex: /Argument:\s*paragraphId\s*\(string\)/,
    whenNotToUsePhrase: 'WHEN NOT TO USE',
  },
  {
    file: 'read-paper-section.ts',
    nameMustContain: [{ value: 'Read' }, { value: 'paragraph', caseInsensitive: true }],
    purposeOpenerRegex: /^Read the plain-text content/,
    paramKeywordsAllOf: ['paragraphId'],
    paramTypeIndicationRegex: /Argument:\s*paragraphId\s*\(string\)/,
    whenNotToUsePhrase: 'WHEN NOT TO USE',
  },
  {
    file: 'write-canvas.ts',
    nameMustContain: [{ value: 'canvas', caseInsensitive: true }],
    purposeOpenerRegex: /^Append a single node/,
    paramKeywordsAllOf: ['nodeType', 'nodeTitle'],
    paramTypeIndicationRegex: /Arguments:\s*nodeType\s*\(string\)\s*,\s*nodeTitle\s*\(string\)/,
    whenNotToUsePhrase: 'WHEN NOT TO USE',
  },
];

/**
 * Extract the description string literal from a tool file.
 * Tool definition pattern (per Phase 11 11-04 ship):
 *
 *   export const xxxTool = tool({
 *     description:
 *       'Foo bar... ' +
 *       'WHEN NOT TO USE: ...' +
 *       'GOOD INPUTS: ...' +
 *       'Argument: kw (string).',
 *     inputSchema: ...
 *   });
 *
 * Exported as a pure function so the W-04 negative-mutation test can pass
 * arbitrary source strings (NOT real file contents) and exercise the parser
 * without touching disk.
 *
 * IMPORTANT (revision iter 3): the regex anchors to `,\s*inputSchema\s*:` so
 * everything inside the description literal is captured BUT `z.string()` schema
 * lines (which appear AFTER inputSchema:) are excluded from the result. This
 * is what made C-9 require Task 1 — type info must live in the description
 * body itself, not in the inputSchema z.string() lines.
 */
export function extractDescription(source: string): string {
  // Match `description:\n    'foo' +\n    'bar' +\n    'baz',\n  inputSchema:`
  const m = source.match(/description\s*:\s*([\s\S]*?)\s*,\s*inputSchema\s*:/);
  if (!m) throw new Error('description block not found — tool file structure changed?');
  // m[1] is the raw block. Strip JS string concatenation markers.
  const chunks: string[] = [];
  const literalRx = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let lit;
  while ((lit = literalRx.exec(m[1])) !== null) {
    chunks.push(lit[2]);
  }
  return chunks.join('');
}

/**
 * Assert all 4 D-D1 element-groups are present in `description` for `spec`.
 * Pure function — does NOT touch the filesystem. Used by both the live-file
 * audit (real tool files) and the W-04 negative-mutation regression test
 * (stub source strings).
 *
 * Throws an Error with a descriptive message if any element-group is missing.
 *
 * C-9 (iter 3): Element 3 enforces BOTH the arg keyword presence AND the
 * type-indication regex anchored to `Argument: <kw> (string).` form.
 */
export function assertFourElements(spec: ToolSpec, description: string): void {
  // Element 1 — tool name / domain word(s)
  for (const { value, caseInsensitive } of spec.nameMustContain) {
    const haystack = caseInsensitive ? description.toLowerCase() : description;
    const needle = caseInsensitive ? value.toLowerCase() : value;
    if (!haystack.includes(needle)) {
      throw new Error(`[${spec.file}] Element 1 (tool name) missing ${JSON.stringify(value)}`);
    }
  }
  // Element 2 — verb-led opener
  if (!spec.purposeOpenerRegex.test(description)) {
    throw new Error(`[${spec.file}] Element 2 (one-sentence purpose) does not match ${spec.purposeOpenerRegex}`);
  }
  // Element 3 (C-9) — arg keyword presence
  for (const kw of spec.paramKeywordsAllOf) {
    if (!description.includes(kw)) {
      throw new Error(`[${spec.file}] Element 3 (parameter keyword) missing arg ${JSON.stringify(kw)}`);
    }
  }
  // Element 3 (C-9 iter 3) — canonical type-indication sentence
  if (!spec.paramTypeIndicationRegex.test(description)) {
    throw new Error(`[${spec.file}] Element 3 (parameter type indication) missing — expected canonical sentence matching ${spec.paramTypeIndicationRegex}`);
  }
  // Element 4 (case-sensitive!)
  if (!description.includes(spec.whenNotToUsePhrase)) {
    throw new Error(`[${spec.file}] Element 4 (WHEN NOT TO USE) missing exact phrase ${JSON.stringify(spec.whenNotToUsePhrase)}`);
  }
}

describe('EVAL-04 D-D1 tool description audit (5 tools × 4 element-groups; C-7 framing; lower-bound 20 it() blocks)', () => {
  for (const spec of TOOLS) {
    const abs = resolve(TOOLS_DIR, spec.file);

    describe(spec.file, () => {
      // C-8 — HARD FAIL on missing tool file (replaces a previous skip-marker).
      it('tool file exists (C-8 hard-fail on deletion)', () => {
        expect(existsSync(abs)).toBe(true);
      });

      // The remaining element-group assertions only run if the file exists.
      // They share a single readFileSync to avoid 4 redundant disk reads.
      // If the file doesn't exist, this block crashes loudly on first read —
      // which is exactly what C-8 wants (a deleted tool MUST NOT silently pass).
      const source = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      const description = source ? extractDescription(source) : '';

      // Element 1 — tool name / domain word(s) (one it() per nameMustContain entry)
      for (const { value, caseInsensitive } of spec.nameMustContain) {
        it(`Element 1 (tool name) — description contains ${JSON.stringify(value)}`, () => {
          expect(existsSync(abs)).toBe(true);  // Re-assert C-8 in case file deleted between describe + it eval (paranoid)
          const haystack = caseInsensitive ? description.toLowerCase() : description;
          const needle = caseInsensitive ? value.toLowerCase() : value;
          expect(haystack).toContain(needle);
        });
      }

      // Element 2 — verb-led opener (1 it())
      it(`Element 2 (one-sentence purpose) — description starts with ${spec.purposeOpenerRegex}`, () => {
        expect(existsSync(abs)).toBe(true);
        expect(description).toMatch(spec.purposeOpenerRegex);
      });

      // Element 3 (C-9) — parameter keyword presence (1 it() per kw)
      for (const kw of spec.paramKeywordsAllOf) {
        it(`Element 3a (parameter keyword) — description references arg ${JSON.stringify(kw)}`, () => {
          expect(existsSync(abs)).toBe(true);
          expect(description).toContain(kw);
        });
      }

      // Element 3 (C-9 iter 3) — canonical type-indication sentence (1 it() per spec)
      it(`Element 3b (parameter type indication) — canonical sentence ${spec.paramTypeIndicationRegex}`, () => {
        expect(existsSync(abs)).toBe(true);
        expect(description).toMatch(spec.paramTypeIndicationRegex);
      });

      // Element 4 — when-not-to-use reverse example (1 it())
      it(`Element 4 (WHEN NOT TO USE) — description contains the exact phrase ${JSON.stringify(spec.whenNotToUsePhrase)}`, () => {
        expect(existsSync(abs)).toBe(true);
        expect(description).toContain(spec.whenNotToUsePhrase);
      });
    });
  }

  it('TOOLS spec covers exactly 5 tools (D-D1 5 tool files)', () => {
    expect(TOOLS).toHaveLength(5);
  });
});

// ----------------------------------------------------------------------
// W-04 revision iter 1 — non-destructive negative-mutation regression test.
//
// Goal: prove that if a future PR removes any of the 4 elements from a real
// tool description, this test would fail. Achieved by injecting STUB source
// strings into assertFourElements and asserting it throws — NEVER touches
// real production tool files.
// ----------------------------------------------------------------------
describe('EVAL-04 negative-mutation regression (stubbed source — no FS mutation)', () => {
  // A "good" stub source containing all 4 elements for search-arxiv.ts shape.
  // C-9 (iter 3): includes the canonical `Argument: query (string).` sentence.
  const GOOD_SEARCH_ARXIV_STUB = `
    export const searchArxivTool = tool({
      description:
        'Search arXiv for papers matching a keyword query. ' +
        'GOOD INPUTS: query="attention transformer". ' +
        'WHEN NOT TO USE: When the user just wants metadata for a known arxivId — use fetchSemanticScholar instead. ' +
        'Argument: query (string).',
      inputSchema: z.object({ query: z.string() }),
    });
  `;
  const SEARCH_ARXIV_SPEC = TOOLS.find(t => t.file === 'search-arxiv.ts')!;

  it('GOOD stub passes all 4 element-groups (positive control)', () => {
    const desc = extractDescription(GOOD_SEARCH_ARXIV_STUB);
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).not.toThrow();
  });

  it('BAD stub — Element 4 removed (no WHEN NOT TO USE) → assertion throws', () => {
    const bad = GOOD_SEARCH_ARXIV_STUB.replace('WHEN NOT TO USE', 'when--removed');
    const desc = extractDescription(bad);
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).toThrowError(/Element 4 \(WHEN NOT TO USE\)/);
  });

  it('BAD stub — Element 1 removed (no `arXiv` token) → assertion throws', () => {
    const bad = GOOD_SEARCH_ARXIV_STUB
      .replace('Search arXiv for', 'Search the corpus for')
      .replace('arXiv', 'the corpus');
    const desc = extractDescription(bad);
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).toThrowError(/Element 1 \(tool name\)/);
  });

  it('BAD stub — Element 2 opener changed → assertion throws', () => {
    const bad = GOOD_SEARCH_ARXIV_STUB.replace('Search arXiv for', 'Find papers in arXiv for');
    const desc = extractDescription(bad);
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).toThrowError(/Element 2 \(one-sentence purpose\)/);
  });

  it('BAD stub — Element 3a param keyword `query` removed → assertion throws', () => {
    // Drop the literal token "query" from anywhere in the description prose.
    // (The inputSchema arg is preserved separately — the description body
    // is what the lint checks for arg-keyword visibility.)
    const bad = GOOD_SEARCH_ARXIV_STUB
      .replace('keyword query', 'keyword search')
      .replace('query="attention transformer"', 'search-string="attention transformer"')
      .replace('Argument: query (string).', 'Argument: search (string).');  // also rename in canonical sentence
    const desc = extractDescription(bad);
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).toThrowError(/Element 3 \(parameter keyword\)/);
  });

  it('BAD stub (C-9 iter 3) — Element 3b canonical sentence removed (`query` mentioned but no `Argument: query (string).`) → assertion throws', () => {
    // Strip the canonical type-indication sentence but keep the keyword present.
    // This isolates C-9: bare keyword without canonical sentence must NOT pass.
    // Replace ONLY the literal (without the trailing comma) so the description
    // block still terminates with `,\s*inputSchema:` — extractDescription needs
    // that boundary. The stripped literal becomes `''`, which still mentions
    // `query` earlier in the prose (so Element 3a stays satisfied) but no longer
    // contains the canonical `Argument: query (string).` sentence (so Element 3b fails).
    const bad = GOOD_SEARCH_ARXIV_STUB
      .replace(`'Argument: query (string).'`, `''`);  // drop the canonical sentence literal but keep the trailing comma
    const desc = extractDescription(bad);
    // Element 3a still passes (keyword 'query' still in description prose), but Element 3b should fail.
    expect(() => assertFourElements(SEARCH_ARXIV_SPEC, desc)).toThrowError(/Element 3 \(parameter type indication\)/);
  });
});
