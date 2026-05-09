import { describe, it, expect } from 'vitest';
import { splitItemsByGap, type ItemRange } from '../../reader/lib/pdf-items';
import type { TextItemLike } from '../../reader/lib/pdf';

const make = (str: string, y: number): TextItemLike => ({
  str,
  transform: [1, 0, 0, 1, 0, y],
});

describe('splitItemsByGap', () => {
  it('returns one range when items are within gap threshold', () => {
    const items = [make('a', 700), make('b', 686)];  // gap 14 < 18
    const ranges = splitItemsByGap(items);
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'a b' },
    ]);
  });

  it('splits when gap exceeds threshold', () => {
    const items = [
      make('para1 line1', 700),
      make('para1 line2', 686),   // gap 14 — same para
      make('para2 start', 650),   // gap 36 > 18 — new para
    ];
    const ranges = splitItemsByGap(items);
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'para1 line1 para1 line2' },
      { startIdx: 2, endIdx: 3, text: 'para2 start' },
    ]);
  });

  it('ignores empty-string items (they stay in the open range but contribute no text)', () => {
    const items = [make('a', 700), make('', 686), make('b', 684)];
    const ranges = splitItemsByGap(items);
    // All three items belong to one paragraph; text is 'a b'.
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 3, text: 'a b' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(splitItemsByGap([])).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const items = [make('a', 700), make('b', 680)];  // gap 20
    expect(splitItemsByGap(items, 10)).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 1, text: 'a' },
      { startIdx: 1, endIdx: 2, text: 'b' },
    ]);
    expect(splitItemsByGap(items, 25)).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 2, text: 'a b' },
    ]);
  });

  it('drops paragraphs that contain only empty items', () => {
    const items = [make('', 700), make('', 686), make('b', 650)];
    const ranges = splitItemsByGap(items);
    // First two items produce no text before the gap, so nothing flushes.
    // After the gap, the empty-run and 'b' form the second range.
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 2, endIdx: 3, text: 'b' },
    ]);
  });

  it('returns empty array when every item is empty', () => {
    const items = [make('', 0), make('', 1), make('', 2)];
    expect(splitItemsByGap(items)).toEqual<ItemRange[]>([]);
  });

  it('handles a single non-empty item', () => {
    const items = [make('hello', 700)];
    expect(splitItemsByGap(items)).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 1, text: 'hello' },
    ]);
  });

  it('includes whitespace-only items in the range and strips them from text', () => {
    const items = [make('a', 700), make(' ', 686), make('b', 684)];
    const ranges = splitItemsByGap(items);
    expect(ranges).toEqual<ItemRange[]>([
      { startIdx: 0, endIdx: 3, text: 'a b' },
    ]);
  });
});
