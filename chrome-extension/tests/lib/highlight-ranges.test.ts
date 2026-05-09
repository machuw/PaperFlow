import { describe, it, expect } from 'vitest';
import { findTextRanges } from '../../reader/lib/highlight-ranges';

function makeRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe('findTextRanges', () => {
  it('returns a single Range for a simple text-node match', () => {
    const root = makeRoot('<p>Hello world.</p>');
    const ranges = findTextRanges(root, 'world');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('world');
  });

  it('returns empty array when text is absent', () => {
    const root = makeRoot('<p>Hello world.</p>');
    expect(findTextRanges(root, 'missing')).toEqual([]);
  });

  it('returns empty array for empty search text', () => {
    const root = makeRoot('<p>Hello.</p>');
    expect(findTextRanges(root, '')).toEqual([]);
  });

  it('matches text that spans across inline elements', () => {
    // "low-rank residual" straddles <em>…</em> boundary
    const root = makeRoot('<p>A <em>low-rank</em> residual approach.</p>');
    const ranges = findTextRanges(root, 'low-rank residual');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('low-rank residual');
  });

  it('returns multiple ranges when text repeats', () => {
    const root = makeRoot('<p>foo bar foo baz foo</p>');
    const ranges = findTextRanges(root, 'foo');
    expect(ranges).toHaveLength(3);
    for (const r of ranges) expect(r.toString()).toBe('foo');
  });

  it('skips matches inside <script> and <style>', () => {
    const root = makeRoot(
      '<p>visible text</p><script>var visible = 1;</script><style>.visible { color: red; }</style>',
    );
    const ranges = findTextRanges(root, 'visible');
    // Only the <p> match counts.
    expect(ranges).toHaveLength(1);
    const r = ranges[0];
    expect(r.startContainer.parentElement?.tagName).toBe('P');
  });

  it('case-sensitive match', () => {
    const root = makeRoot('<p>Hello hello HELLO</p>');
    expect(findTextRanges(root, 'hello')).toHaveLength(1);
    expect(findTextRanges(root, 'Hello')).toHaveLength(1);
    expect(findTextRanges(root, 'HELLO')).toHaveLength(1);
  });

  it('handles text at the exact start and end of a text node', () => {
    const root = makeRoot('<p>abc def ghi</p>');
    const atStart = findTextRanges(root, 'abc');
    expect(atStart[0].toString()).toBe('abc');
    const atEnd = findTextRanges(root, 'ghi');
    expect(atEnd[0].toString()).toBe('ghi');
  });

  it('does not match when root is null-ish', () => {
    const ranges = findTextRanges(null as unknown as HTMLElement, 'anything');
    expect(ranges).toEqual([]);
  });
});

import { registerPaperHighlights } from '../../reader/lib/highlight-ranges';

describe('registerPaperHighlights', () => {
  // Helper: swap in a mock CSS.highlights + Highlight constructor for the
  // duration of a single test, return call log + reset fn. jsdom ships without
  // a `CSS` global at all, so we install the whole object when missing.
  function mockCustomHighlightApi() {
    const calls: { method: 'set' | 'delete'; args: unknown[] }[] = [];
    const highlightArgs: unknown[][] = [];

    class MockHighlight {
      constructor(...ranges: unknown[]) {
        highlightArgs.push(ranges);
      }
    }

    const prevCss = (globalThis as any).CSS;
    const prevHighlights = prevCss ? prevCss.highlights : undefined;
    const prevHighlightCtor = (globalThis as any).Highlight;

    if (!prevCss) (globalThis as any).CSS = {};
    (globalThis as any).CSS.highlights = {
      set: (name: string, hl: unknown) => { calls.push({ method: 'set', args: [name, hl] }); },
      delete: (name: string) => { calls.push({ method: 'delete', args: [name] }); },
    };
    (globalThis as any).Highlight = MockHighlight as any;

    return {
      calls,
      highlightArgs,
      restore: () => {
        if (prevCss === undefined) {
          delete (globalThis as any).CSS;
        } else {
          if (prevHighlights === undefined) delete prevCss.highlights;
          else prevCss.highlights = prevHighlights;
          (globalThis as any).CSS = prevCss;
        }
        if (prevHighlightCtor === undefined) delete (globalThis as any).Highlight;
        else (globalThis as any).Highlight = prevHighlightCtor;
      },
    };
  }

  it('no-ops silently when CSS.highlights is absent', () => {
    // No mock — jsdom baseline has neither CSS.highlights nor Highlight.
    const root = document.createElement('div');
    root.innerHTML = '<p data-pid="sec0-p0">Hello world.</p>';
    document.body.appendChild(root);

    // Should not throw.
    expect(() =>
      registerPaperHighlights(root, [
        { paragraphId: 'sec0-p0', text: 'world', color: 'yellow' },
      ]),
    ).not.toThrow();
  });

  it('calls CSS.highlights.set with one Highlight containing one Range per single-scope match', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-pid="sec0-p0">Hello world.</p>';
    document.body.appendChild(root);

    const { calls, highlightArgs, restore } = mockCustomHighlightApi();
    try {
      registerPaperHighlights(root, [
        { paragraphId: 'sec0-p0', text: 'world', color: 'yellow' },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('set');
      expect(calls[0].args[0]).toBe('hl-yellow');
      expect(highlightArgs).toHaveLength(1);
      expect(highlightArgs[0]).toHaveLength(1);   // one Range
    } finally {
      restore();
    }
  });

  it('calls CSS.highlights.delete when no highlights produce any range', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-pid="sec0-p0">Hello world.</p>';
    document.body.appendChild(root);

    const { calls, restore } = mockCustomHighlightApi();
    try {
      // paragraphId doesn't exist in the DOM → no scopes → no ranges.
      registerPaperHighlights(root, [
        { paragraphId: 'missing', text: 'world', color: 'yellow' },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('delete');
      expect(calls[0].args[0]).toBe('hl-yellow');
    } finally {
      restore();
    }
  });

  it('unifies multiple same-paragraphId scopes into one buffer (PDF multi-span case)', () => {
    // Simulate PDF text-layer: many sibling spans all carrying the same
    // data-pid. Authored as a single line so there are no whitespace text
    // nodes BETWEEN the spans (pdfjs text-layer has none either).
    const root = document.createElement('div');
    root.innerHTML = '<div><span data-pid="sec0-p0">low-</span><span data-pid="sec0-p0">rank</span><span data-pid="sec0-p0"> residual</span></div>';
    document.body.appendChild(root);

    const { calls, highlightArgs, restore } = mockCustomHighlightApi();
    try {
      // Text "low-rank residual" crosses span boundaries — a naive per-span
      // indexOf would miss it. Unified buffer catches it as one Range.
      registerPaperHighlights(root, [
        { paragraphId: 'sec0-p0', text: 'low-rank residual', color: 'yellow' },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('set');
      expect(highlightArgs[0]).toHaveLength(1);
      // Verify the Range's textContent spans all three spans.
      const range = highlightArgs[0][0] as Range;
      expect(range.toString()).toBe('low-rank residual');
    } finally {
      restore();
    }
  });

  it('skips later highlights whose text overlaps an earlier highlight (spec §3.4)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-pid="sec0-p0">foo bar baz qux</p>';
    document.body.appendChild(root);

    const { highlightArgs, restore } = mockCustomHighlightApi();
    try {
      // A = "foo bar" (0..7), B = "bar baz" (4..11) → overlaps at "bar".
      // Expected: only A's range is registered.
      registerPaperHighlights(root, [
        { paragraphId: 'sec0-p0', text: 'foo bar', color: 'yellow' },
        { paragraphId: 'sec0-p0', text: 'bar baz', color: 'yellow' },
      ]);
      expect(highlightArgs).toHaveLength(1);
      expect(highlightArgs[0]).toHaveLength(1);
      const range = highlightArgs[0][0] as Range;
      expect(range.toString()).toBe('foo bar');
    } finally {
      restore();
    }
  });

  it('keeps non-overlapping highlights in the same paragraph', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-pid="sec0-p0">foo bar baz qux</p>';
    document.body.appendChild(root);

    const { highlightArgs, restore } = mockCustomHighlightApi();
    try {
      // "foo" (0..3) and "qux" (12..15) — no overlap.
      registerPaperHighlights(root, [
        { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' },
        { paragraphId: 'sec0-p0', text: 'qux', color: 'yellow' },
      ]);
      expect(highlightArgs).toHaveLength(1);
      expect(highlightArgs[0]).toHaveLength(2);
      const texts = (highlightArgs[0] as Range[]).map((r) => r.toString()).sort();
      expect(texts).toEqual(['foo', 'qux']);
    } finally {
      restore();
    }
  });
});
