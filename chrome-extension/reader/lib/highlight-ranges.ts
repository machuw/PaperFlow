import type { Highlight } from '../types';

/**
 * Collect text-node entries from one or more DOM subtrees into a single
 * ordered buffer. Skips SCRIPT/STYLE. Used by both `findTextRanges` (single
 * root) and the multi-scope PDF path (many sibling spans sharing a data-pid).
 */
function collectEntries(roots: Iterable<HTMLElement>): { entries: { node: Text; start: number }[]; buf: string } {
  const entries: { node: Text; start: number }[] = [];
  let buf = '';
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (parent) {
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null = walker.nextNode();
    while (n) {
      const tn = n as Text;
      entries.push({ node: tn, start: buf.length });
      buf += tn.data;
      n = walker.nextNode();
    }
  }
  return { entries, buf };
}

/**
 * Search a flat buffer (with offset map back to Text nodes) for every
 * occurrence of `text` and return one Range per match.
 */
function rangesFromBuffer(
  entries: { node: Text; start: number }[],
  buf: string,
  text: string,
): Range[] {
  const ranges: Range[] = [];
  let searchFrom = 0;
  while (true) {
    const hit = buf.indexOf(text, searchFrom);
    if (hit === -1) break;
    const endHit = hit + text.length;

    const startLoc = locate(entries, hit);
    const endLoc = locate(entries, endHit);
    if (startLoc && endLoc) {
      const r = document.createRange();
      r.setStart(startLoc.node, startLoc.offset);
      r.setEnd(endLoc.node, endLoc.offset);
      ranges.push(r);
    }
    searchFrom = endHit;
  }
  return ranges;
}

/**
 * Walk text nodes under `root` and return one `Range` per occurrence of
 * `text`. Matches are case-sensitive and include cross-element spans (text
 * that starts in one text node and ends in another). Skips `<script>` and
 * `<style>` subtrees so injected sanitizer tokens don't produce ghost hits.
 *
 * Returns `[]` when `root` is null, when `text` is empty, or when no match.
 *
 * Implementation sketch:
 *   1. Concatenate text nodes under root into a flat string + offset map.
 *   2. For each occurrence of `text` in the flat string, resolve start/end
 *      back to (node, offset) pairs via the offset map.
 *   3. Build a Range per match.
 */
export function findTextRanges(root: HTMLElement | null, text: string): Range[] {
  if (!root || !text) return [];
  const { entries, buf } = collectEntries([root]);
  if (entries.length === 0) return [];
  return rangesFromBuffer(entries, buf, text);
}

function locate(entries: { node: Text; start: number }[], bufOffset: number)
  : { node: Text; offset: number } | null {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const next = entries[i + 1];
    const end = next ? next.start : e.start + e.node.data.length;
    if (bufOffset <= end) {
      return { node: e.node, offset: Math.max(0, bufOffset - e.start) };
    }
  }
  return null;
}

/**
 * Register all stored highlights against a rendered DOM root using the CSS
 * Custom Highlight API. Called from a post-mount `useEffect` after the DOM
 * is painted. No-ops if `CSS.highlights` / `Highlight` are not available
 * (defensive: Chrome 105+ required).
 *
 * Scoping: for each Highlight, search only within subtrees that carry its
 * `paragraphId` (via `[data-pid="…"]`). This avoids painting `highlight.text`
 * matches in OTHER paragraphs where the same string happens to occur.
 */
export function registerPaperHighlights(
  root: HTMLElement | null,
  highlights: Highlight[],
): void {
  if (!root) return;
  const css = (typeof CSS !== 'undefined' ? (CSS as any) : null);
  const HL = (typeof globalThis !== 'undefined' ? (globalThis as any).Highlight : null);
  if (!css || !css.highlights || !HL) return;

  // Group highlights by paragraphId so overlap-suppression (§3.4) runs
  // per-paragraph. Highlights from different paragraphs can never produce
  // overlapping Ranges because their scope subtrees are disjoint.
  const byParagraph = new Map<string, Highlight[]>();
  for (const h of highlights) {
    if (!h.text) continue;
    const arr = byParagraph.get(h.paragraphId);
    if (arr) arr.push(h);
    else byParagraph.set(h.paragraphId, [h]);
  }

  const allRanges: Range[] = [];
  for (const [paragraphId, paragraphHighlights] of byParagraph) {
    const scopes = Array.from(
      root.querySelectorAll<HTMLElement>(`[data-pid="${cssEscape(paragraphId)}"]`),
    );
    if (scopes.length === 0) continue;
    const { entries, buf } = collectEntries(scopes);
    if (entries.length === 0) continue;

    // Collect candidate ranges per highlight, annotated with their buffer
    // span so we can detect overlaps via plain interval arithmetic.
    type Candidate = { start: number; end: number; range: Range };
    const candidates: Candidate[] = [];
    for (const h of paragraphHighlights) {
      let searchFrom = 0;
      while (true) {
        const hit = buf.indexOf(h.text, searchFrom);
        if (hit === -1) break;
        const endHit = hit + h.text.length;
        const startLoc = locate(entries, hit);
        const endLoc = locate(entries, endHit);
        if (startLoc && endLoc) {
          const r = document.createRange();
          r.setStart(startLoc.node, startLoc.offset);
          r.setEnd(endLoc.node, endLoc.offset);
          candidates.push({ start: hit, end: endHit, range: r });
        }
        searchFrom = endHit;
      }
    }

    // Spec §3.4: two highlights whose text overlaps but isn't identical
    // cause the later one to be skipped. First-wins by source order within
    // each paragraph. Identical-text dedup is already handled upstream by
    // `addHighlight`, so identical spans won't appear twice here.
    const accepted: Candidate[] = [];
    for (const c of candidates) {
      const overlaps = accepted.some((a) => !(c.end <= a.start || c.start >= a.end));
      if (overlaps) continue;
      accepted.push(c);
    }
    for (const a of accepted) allRanges.push(a.range);
  }

  if (allRanges.length === 0) {
    css.highlights.delete('hl-yellow');
    return;
  }
  css.highlights.set('hl-yellow', new HL(...allRanges));
}

/**
 * Re-run the same paragraph-scoped, multi-scope range search that
 * `registerPaperHighlights` uses, but for a single highlight. Used by the
 * paper-side click hit-test (main.tsx) to figure out which `(paragraphId,
 * text)` pair the user clicked on, since CSS Custom Highlight ranges are
 * not directly hit-testable.
 *
 * Returns one Range per occurrence inside the named paragraph. Empty array
 * if the paragraph or text isn't found.
 */
export function findHighlightRangesForParagraph(
  root: HTMLElement | null,
  paragraphId: string,
  text: string,
): Range[] {
  if (!root || !text) return [];
  const scopes = Array.from(
    root.querySelectorAll<HTMLElement>(`[data-pid="${cssEscape(paragraphId)}"]`),
  );
  if (scopes.length === 0) return [];
  const { entries, buf } = collectEntries(scopes);
  if (entries.length === 0) return [];
  return rangesFromBuffer(entries, buf, text);
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof (CSS as any).escape === 'function') {
    return (CSS as any).escape(s);
  }
  return s.replace(/["\\]/g, '\\$&');
}
