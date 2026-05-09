import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { planNavigateToPaper } from '../../../reader/lib/navigate-to-paper';
import type { LibraryRow } from '../../../reader/types';
import type { ParsedCache } from '../../../reader/lib/storage';

// Phase 27 — Library card click dispatcher.
//
// 5-branch contract (C-phase, post-extension):
//   1. rowKey === currentPaperKey       → { kind: 'close-only' }
//   2. row.src present                  → { kind: 'open-tab', url: #src=raw }
//   3. row.id is arxiv-shaped (no src)  → { kind: 'open-tab', url: #src=https://arxiv.org/abs/{id} }
//   4. paperKey cache hit (no src/id)   → { kind: 'open-tab', url: #paperKey=raw }
//   5. all of the above fail            → { kind: 'toast', messageKey }
//
// CRITICAL (A3 regression guard): both #src= and #paperKey= embed values RAW
// (no encodeURIComponent). inject.ts and sw.ts both pass raw URLs; readSrc()
// uses .slice() without decode. Re-encoding breaks fetch() with
// ERR_FILE_NOT_FOUND (verified 2026-05-07 playwright reproduction).

const baseRow: LibraryRow = {
  id: '2604.05015',
  urlHash: 'h-test',
  title: 'Test Paper',
  authors: ['Test'],
  role: '',
  judgment: '',
  addedAt: 0,
  lastRead: 0,
  pages: 12,
  annotations: 0,
  hasMemory: false,
  libraryId: null,
  topicIds: [],
  src: 'https://arxiv.org/pdf/2604.05015',
};

const VALID_HTML_CACHE: ParsedCache = {
  version: 3,
  title: 'Cached Paper',
  authors: ['A'],
  abstract: '',
  outline: [{ id: 's1', label: 'Intro', level: 0 }],
  paragraphs: [],
};

function stubChrome(store: Record<string, unknown> = {}) {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-ext-id/${path}`,
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return out;
          }
          return {};
        }),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  };
}

describe('planNavigateToPaper — Phase 27 C-phase 5-branch fallback chain', () => {
  let originalChrome: typeof globalThis.chrome | undefined;

  beforeEach(() => {
    originalChrome = (globalThis as { chrome?: typeof chrome }).chrome;
    stubChrome();
  });

  afterEach(() => {
    (globalThis as { chrome?: typeof chrome }).chrome = originalChrome as typeof chrome;
  });

  it('1. close-only when rowKey matches currentPaperKey', async () => {
    const result = await planNavigateToPaper({
      row: baseRow,
      rowKey: '2604.05015',
      currentPaperKey: '2604.05015',
    });
    expect(result).toEqual({ kind: 'close-only' });
  });

  it('2. open-tab with RAW src URL when row.src is present', async () => {
    const result = await planNavigateToPaper({
      row: baseRow,
      rowKey: '2604.05015',
      currentPaperKey: 'other-paper',
    });
    expect(result).toEqual({
      kind: 'open-tab',
      url: 'chrome-extension://test-ext-id/reader/index.html#src=https://arxiv.org/pdf/2604.05015',
    });
    if (result.kind === 'open-tab') {
      expect(result.url).not.toContain('%3A');
      expect(result.url).not.toContain('%2F');
    }
  });

  it('3. open-tab with reconstructed /abs/ URL when src missing but id is arxiv-shaped', async () => {
    const arxivOnly: LibraryRow = { ...baseRow, src: undefined };
    const result = await planNavigateToPaper({
      row: arxivOnly,
      rowKey: '2604.05015',
      currentPaperKey: 'other',
    });
    expect(result).toEqual({
      kind: 'open-tab',
      // /abs/ over /pdf/ — matches a fresh visit's HTML-first preference.
      url: 'chrome-extension://test-ext-id/reader/index.html#src=https://arxiv.org/abs/2604.05015',
    });
  });

  it('4. open-tab with #paperKey= when no src, no arxiv id, but cache hit', async () => {
    stubChrome({
      'paper:h-cached:parsed': VALID_HTML_CACHE,
    });
    const cachedOnly: LibraryRow = { ...baseRow, src: undefined, id: undefined, urlHash: 'h-cached' };
    const result = await planNavigateToPaper({
      row: cachedOnly,
      rowKey: 'h-cached',
      currentPaperKey: 'other',
    });
    expect(result).toEqual({
      kind: 'open-tab',
      url: 'chrome-extension://test-ext-id/reader/index.html#paperKey=h-cached',
    });
    if (result.kind === 'open-tab') {
      expect(result.url).not.toContain('%');
    }
  });

  it('5. toast when src missing, id missing, AND no cache', async () => {
    stubChrome({});  // empty cache
    const noFallback: LibraryRow = { ...baseRow, src: undefined, id: undefined, urlHash: 'h-orphan' };
    const result = await planNavigateToPaper({
      row: noFallback,
      rowKey: 'h-orphan',
      currentPaperKey: 'other',
    });
    expect(result).toEqual({
      kind: 'toast',
      messageKey: 'library.jump.needsOriginalUrl',
    });
  });

  it('5b. toast when only a PDF cache exists (PDF cache fallback deferred to v1.6)', async () => {
    stubChrome({
      'paper:h-pdf:parsed': {
        version: 3,
        title: 'PDF only',
        authors: [],
        abstract: '',
        outline: [{ id: 'p1', label: 'Page 1', level: 0, page: 1 }],
        paragraphs: [],
      },
    });
    const pdfOnly: LibraryRow = { ...baseRow, src: undefined, id: undefined, urlHash: 'h-pdf' };
    const result = await planNavigateToPaper({
      row: pdfOnly,
      rowKey: 'h-pdf',
      currentPaperKey: 'other',
    });
    // loadPaperFromCache returns null for PDF cache → fall through to toast.
    expect(result).toEqual({
      kind: 'toast',
      messageKey: 'library.jump.needsOriginalUrl',
    });
  });

  it('priority: src wins over arxiv-id reconstruction', async () => {
    // Even with an arxiv-shaped id, prefer the captured src so the user
    // sees the same URL they originally opened (e.g. /pdf/ vs /abs/).
    const result = await planNavigateToPaper({
      row: baseRow,  // has both src=/pdf/... and id=2604.05015
      rowKey: '2604.05015',
      currentPaperKey: 'other',
    });
    expect(result).toEqual({
      kind: 'open-tab',
      url: 'chrome-extension://test-ext-id/reader/index.html#src=https://arxiv.org/pdf/2604.05015',
    });
  });
});
