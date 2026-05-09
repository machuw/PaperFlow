import type { TextItemLike } from './pdf';
import { PARAGRAPH_GAP_THRESHOLD } from './pdf';

export interface ItemRange {
  /** Inclusive index of the first text item belonging to this paragraph. */
  startIdx: number;
  /** Exclusive end: `items.slice(startIdx, endIdx)` yields this paragraph's items. */
  endIdx: number;
  /** Normalized concatenated text of all non-empty items in the range. */
  text: string;
}

/**
 * Groups PDF text items into paragraph ranges by vertical-gap heuristic,
 * preserving item-index ranges so pdfjs-produced text-layer spans can be
 * tagged with `data-pid` later.
 *
 * Invariants:
 * - Ranges are contiguous in item space — every index in [0, items.length)
 *   belongs to exactly one range, EXCEPT leading empty items before the
 *   first non-empty contribution, which are dropped (not covered by any
 *   range).
 * - Ranges with text === '' are filtered out of the returned array.
 * - Whitespace-only items (e.g. str: ' ') are treated as non-empty for
 *   range purposes and update lastY; they are stripped from text by the
 *   join/normalize pass.
 */
export function splitItemsByGap(
  items: TextItemLike[],
  threshold = PARAGRAPH_GAP_THRESHOLD,
): ItemRange[] {
  const out: ItemRange[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let lastY: number | null = null;

  const flush = (endIdx: number) => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ startIdx: currentStart, endIdx, text });
    current = [];
    currentStart = endIdx;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.str) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(lastY - y) > threshold) {
      flush(i);
    }
    // If no paragraph has opened yet (only empty items seen so far), advance
    // currentStart to the first non-empty item's index so leading empties are
    // not absorbed into the first range.
    if (lastY === null) {
      currentStart = i;
    }
    current.push(item.str);
    lastY = y;
  }
  flush(items.length);
  return out;
}
