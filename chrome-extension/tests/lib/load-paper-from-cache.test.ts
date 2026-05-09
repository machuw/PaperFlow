import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadPaperFromCache } from '../../reader/lib/load-paper-from-cache';
import type { ParsedCache } from '../../reader/lib/storage';
import type { PaperMemory } from '../../reader/types';

// Phase 27 / Task C2+C5 — pure helper that rebuilds a LoadedPaper from
// chrome.storage.local-cached `paper:{key}:parsed` + `paper:{key}:memory`.
// No fetch, no pdfjs.
//
// Behavior matrix:
//   - HTML cache hit  → { paper, pdfRuntime: null }, paper.id set if key looks
//                        arxiv-shaped, else only urlHash
//   - PDF cache hit   → null (pdfjs cannot resume without bytes; PDF fallback
//                       is deferred to v1.6 per SPEC §9 Q3)
//   - cache miss      → null

// PARSE_CACHE_VERSION is bumped when parseArxivHtml / parsePdf change shape;
// loaders treat older versions as misses. Test fixtures must keep this in
// sync with chrome-extension/reader/lib/storage.ts (currently v3).
const HTML_CACHE: ParsedCache = {
  version: 3,
  title: 'A Sample Paper',
  authors: ['Alice', 'Bob'],
  abstract: 'An abstract.',
  venue: 'NeurIPS 2026',
  outline: [
    { id: 's1', label: 'Introduction', level: 0 },
    { id: 's2', label: 'Method', level: 0 },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 's1', section: 'Introduction', text: 'Para 1.' },
  ],
};

const PDF_CACHE: ParsedCache = {
  version: 3,
  title: 'PDF Paper',
  authors: ['Carol'],
  abstract: '',
  outline: [
    { id: 'p1', label: 'Page 1', level: 0, page: 1 },
    { id: 'p2', label: 'Page 2', level: 0, page: 2 },
  ],
  paragraphs: [],
};

const MEMORY: PaperMemory = {
  whyItMatters: 'It matters.',
  role: 'Central — pivotal for argument',
  judgment: 'Strong',
  linked: [],
  nextActions: [],
};

function fakeStorage(initial: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...initial };
  return {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return out;
          }
          // Object with defaults — return overrides + defaults
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(keys as Record<string, unknown>)) {
            out[k] = k in store ? store[k] : (keys as Record<string, unknown>)[k];
          }
          return out;
        }),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  };
}

describe('loadPaperFromCache — Phase 27 C2', () => {
  let originalChrome: typeof globalThis.chrome | undefined;

  beforeEach(() => {
    originalChrome = (globalThis as { chrome?: typeof chrome }).chrome;
  });

  afterEach(() => {
    (globalThis as { chrome?: typeof chrome }).chrome = originalChrome as typeof chrome;
  });

  it('rebuilds a Paper from HTML cache + memory; arxiv-shaped key sets paper.id', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeStorage({
      'paper:2401.12345:parsed': HTML_CACHE,
      'paper:2401.12345:memory': MEMORY,
    });

    const result = await loadPaperFromCache('2401.12345');

    expect(result).not.toBeNull();
    expect(result!.pdfRuntime).toBeNull();
    expect(result!.paper.id).toBe('2401.12345');
    expect(result!.paper.urlHash).toBe('2401.12345');
    expect(result!.paper.title).toBe('A Sample Paper');
    expect(result!.paper.authors).toEqual(['Alice', 'Bob']);
    expect(result!.paper.outline).toHaveLength(2);
    expect(result!.paper.memory).toEqual(MEMORY);
  });

  it('uses key as urlHash and leaves id undefined for non-arxiv key (urlHash shape)', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeStorage({
      'paper:abcdef123456:parsed': HTML_CACHE,
      'paper:abcdef123456:memory': MEMORY,
    });

    const result = await loadPaperFromCache('abcdef123456');

    expect(result).not.toBeNull();
    expect(result!.paper.id).toBeUndefined();
    expect(result!.paper.urlHash).toBe('abcdef123456');
  });

  it('falls back to emptyMemory when memory key is missing', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeStorage({
      'paper:2401.12345:parsed': HTML_CACHE,
      // no :memory key
    });

    const result = await loadPaperFromCache('2401.12345');

    expect(result).not.toBeNull();
    expect(result!.paper.memory).toEqual({
      whyItMatters: '',
      role: '',
      judgment: '',
      linked: [],
      nextActions: [],
    });
  });

  it('returns null when the cache is a PDF cache (every outline entry has page)', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeStorage({
      'paper:2401.12345:parsed': PDF_CACHE,
    });

    const result = await loadPaperFromCache('2401.12345');

    // PDF rendering needs a live pdfDoc — without bytes we cannot resume.
    // Falling closed lets the caller toast or retry from the original URL.
    expect(result).toBeNull();
  });

  it('returns null when cache is missing entirely', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeStorage({});

    const result = await loadPaperFromCache('non-existent');

    expect(result).toBeNull();
  });
});
