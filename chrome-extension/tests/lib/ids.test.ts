import { describe, it, expect } from 'vitest';
import { normalizeArxivId, normalizePdfFetchUrl, urlHash, paperKey, prefersPdfForArxiv, reconstructUrlForArxivRow } from '../../reader/lib/ids';
import type { Paper } from '../../reader/types';

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

describe('prefersPdfForArxiv', () => {
  it('returns true for /pdf/ urls (user explicitly wants PDF)', () => {
    expect(prefersPdfForArxiv('https://arxiv.org/pdf/2604.05015')).toBe(true);
    expect(prefersPdfForArxiv('https://arxiv.org/pdf/2604.05015v1')).toBe(true);
    expect(prefersPdfForArxiv('https://arxiv.org/pdf/2402.18413v2.pdf')).toBe(true);
  });

  it('returns false for /abs/ urls (HTML-first is fine)', () => {
    expect(prefersPdfForArxiv('https://arxiv.org/abs/2604.05015')).toBe(false);
  });

  it('returns false for /html/ urls', () => {
    expect(prefersPdfForArxiv('https://arxiv.org/html/2604.05015')).toBe(false);
  });

  it('returns false for non-arxiv urls', () => {
    expect(prefersPdfForArxiv('https://example.com/pdf/foo.pdf')).toBe(false);
    expect(prefersPdfForArxiv('https://arxiv-mirror.org/pdf/2604.05015')).toBe(false);
  });

  it('word-boundary: does not match "arxiv.org" inside another domain', () => {
    // Defense: the regex anchors 'arxiv.org' with a word boundary so
    // "myarxiv.org/pdf/..." doesn't get a false positive.
    expect(prefersPdfForArxiv('https://myarxiv.org/pdf/foo')).toBe(false);
  });
});

describe('normalizePdfFetchUrl', () => {
  it('rewrites Hugging Face /blob/ to /resolve/', () => {
    expect(
      normalizePdfFetchUrl(
        'https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/DeepSeek_V4.pdf',
      ),
    ).toBe(
      'https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/DeepSeek_V4.pdf',
    );
  });

  it('rewrites the hf.co short mirror too', () => {
    expect(
      normalizePdfFetchUrl('https://hf.co/foo/bar/blob/main/paper.pdf'),
    ).toBe('https://hf.co/foo/bar/resolve/main/paper.pdf');
  });

  it('is idempotent on already-resolved HF urls', () => {
    const resolved =
      'https://huggingface.co/foo/bar/resolve/main/paper.pdf';
    expect(normalizePdfFetchUrl(resolved)).toBe(resolved);
  });

  it('passes arxiv PDF urls through unchanged', () => {
    const url = 'https://arxiv.org/pdf/2402.18413v2.pdf';
    expect(normalizePdfFetchUrl(url)).toBe(url);
  });

  it('passes arbitrary PDF urls through unchanged', () => {
    const url = 'https://example.com/papers/foo/blob/main/file.pdf';
    expect(normalizePdfFetchUrl(url)).toBe(url);
  });
});

describe('reconstructUrlForArxivRow — Phase 27 C1', () => {
  // Rebuilds an /abs/ URL from a library row whose `src` was lost (legacy
  // entry from before the src column existed). Used by planNavigateToPaper as
  // the second-priority fallback before the paperKey cache route.
  //
  // /abs/ over /pdf/ on purpose: matches a fresh visit's preferred path
  // (HTML-first → richer selection, faster first paint).
  it('rebuilds /abs/ URL from new-style 5-digit id', () => {
    expect(reconstructUrlForArxivRow({ id: '2401.12345' })).toBe(
      'https://arxiv.org/abs/2401.12345',
    );
  });

  it('rebuilds /abs/ URL from new-style 4-digit id', () => {
    expect(reconstructUrlForArxivRow({ id: '2604.0501' })).toBe(
      'https://arxiv.org/abs/2604.0501',
    );
  });

  it('strips a version suffix before rebuilding', () => {
    expect(reconstructUrlForArxivRow({ id: '2401.12345v3' })).toBe(
      'https://arxiv.org/abs/2401.12345',
    );
  });

  it('returns null for undefined / empty id', () => {
    expect(reconstructUrlForArxivRow({ id: undefined })).toBeNull();
    expect(reconstructUrlForArxivRow({ id: '' })).toBeNull();
  });

  it('returns null for urlHash-shaped id (non-arxiv)', () => {
    expect(reconstructUrlForArxivRow({ id: 'h-abcdef123456' })).toBeNull();
  });

  it('returns null for old-style cross-listed ids (cs/0512345 — out of scope)', () => {
    // ARXIV_ID_RE only matches new-style YYMM.NNNNN form. Old-style ids would
    // need an `arxiv.org/abs/cs/0512345` URL, which the loader does not
    // currently support either — fall through to the next fallback / toast.
    expect(reconstructUrlForArxivRow({ id: 'cs/0512345' })).toBeNull();
  });
});
