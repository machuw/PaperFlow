// Use legacy build (mjs) for node+jsdom compatibility in tests.
// Worker configuration lives in reader/main.tsx (the only runtime that needs it).
// Tests run without worker (pdfjs falls back to fake worker when workerSrc='').
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineItem, Paragraph } from '../types';
import { buildParagraphs } from './parse';
import type { RawParagraph } from './parse';
import { splitItemsByGap, type ItemRange } from './pdf-items';

/** Serializable parse output — the data that lives on Paper. */
export interface ParsedPdf {
  numPages: number;
  title: string;
  authors: string[];
  outline: OutlineItem[];
  paragraphs: Paragraph[];
}

/** Runtime handles the renderer needs but storage never persists. */
export interface ParsePdfResult {
  parsed: ParsedPdf;
  /** Live pdfjs document handle; caller is responsible for `doc.destroy()`. */
  doc: PDFDocumentProxy;
  /** `pageItemRanges[i]` lists paragraph ranges on the (i+1)-th page, in document order. */
  pageItemRanges: ItemRange[][];
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

export async function parsePdf(data: ArrayBuffer): Promise<ParsePdfResult> {
  // pdfjs requires a TypedArray and transfers/detaches the underlying buffer
  // during loading. Copy into a fresh Uint8Array so callers can reuse `data`
  // (important in tests that share one fixture ArrayBuffer across cases).
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const numPages = doc.numPages;

    // Metadata
    const meta = await doc.getMetadata().catch(() => null);
    const title = ((meta?.info as any)?.Title as string | undefined)?.trim() ?? 'Untitled PDF';
    const authorRaw = ((meta?.info as any)?.Author as string | undefined) ?? '';
    const authors = authorRaw ? authorRaw.split(/[,;]\s*/).filter(Boolean) : [];

    // Prefer the PDF's own bookmarks tree (document outline) for section
    // navigation — that gives real labels like "1 Introduction" / "3.2
    // Method" instead of generic page numbers. arXiv preprints almost
    // always ship with a usable outline. For PDFs without one (scanned
    // docs, older exports), fall back to per-page stubs.
    const rawOutline = await doc.getOutline().catch(() => null);
    const resolvedOutline = rawOutline && rawOutline.length > 0
      ? await resolveDocOutline(doc, rawOutline)
      : [];
    const outline: OutlineItem[] = resolvedOutline.length > 0
      ? resolvedOutline
      : Array.from({ length: numPages }, (_, i) => ({
          id: `o${i}`,
          label: `Page ${i + 1}`,
          level: 0,
          page: i + 1,
        }));

    // Paragraphs: group text items within each page by vertical gap.
    const raw: RawParagraph[] = [];
    const pageItemRanges: ItemRange[][] = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const outlineItemId = outlineItemIdForPage(outline, pageNum);

      // Match pdfjs's TextLayer._processItems exactly: only items where `str`
      // is a string contribute. The looser `'str' in it` check would include
      // items with `str: undefined`, drifting from pdfjs and breaking the
      // pointer-walk invariant in pdf-page.tsx.
      const items = (content.items as any[])
        .filter((it) => typeof it.str === 'string')
        .map((it): TextItemLike => ({ str: it.str, transform: it.transform }));

      const ranges = splitItemsByGap(items);
      pageItemRanges.push(ranges);
      for (const r of ranges) {
        raw.push({ outlineItemId, text: r.text });
      }
    }

    const paragraphs = buildParagraphs(raw, outline);
    const parsed: ParsedPdf = { numPages, title, authors, outline, paragraphs };
    return { parsed, doc, pageItemRanges };
  } catch (err) {
    await doc.destroy().catch((e) => {
      console.debug('[PaperFlow] pdfjs doc.destroy failed after parse error:', e);
    });
    throw err;
  }
}

/** Raw pdfjs outline node shape (subset of what we use). */
interface RawOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineNode[];
}

/**
 * Walk the PDF's bookmarks tree and produce a flat OutlineItem[] in
 * document order, resolving each entry's destination to a 1-indexed page.
 * Returns [] when nothing is resolvable (caller then falls back to the
 * per-page stub outline).
 *
 * Invariant: the first returned item is always level 0, because
 * buildParagraphs requires every outline item to have a level-0 ancestor
 * that appears earlier in document order.
 */
async function resolveDocOutline(
  doc: PDFDocumentProxy,
  nodes: RawOutlineNode[],
): Promise<OutlineItem[]> {
  const result: OutlineItem[] = [];

  async function resolvePage(dest: RawOutlineNode['dest']): Promise<number | null> {
    try {
      let ref: unknown = dest;
      if (typeof ref === 'string') {
        ref = await doc.getDestination(ref);
      }
      if (!Array.isArray(ref) || ref.length === 0) return null;
      const pageIdx = await doc.getPageIndex(ref[0] as never);
      return pageIdx + 1;
    } catch {
      return null;
    }
  }

  async function walk(nodes: RawOutlineNode[], level: number): Promise<void> {
    for (const n of nodes) {
      const page = await resolvePage(n.dest);
      const title = n.title?.trim();
      if (page !== null && title) {
        result.push({
          id: `o${result.length}`,
          label: title,
          level,
          page,
        });
      }
      if (n.items && n.items.length > 0) {
        await walk(n.items, level + 1);
      }
    }
  }

  await walk(nodes, 0);

  // Clamp levels so the first item is level 0 (required by buildParagraphs).
  if (result.length > 0 && result[0].level > 0) {
    const baseLevel = result[0].level;
    for (const it of result) it.level = Math.max(0, it.level - baseLevel);
  }

  return result;
}

/**
 * Find which outline item owns a given 1-indexed page. Walks outline in
 * document order and picks the latest entry whose page ≤ pageNum and
 * page ≥ the currently chosen entry's page — so a malformed outline that
 * points an early page after a later one can't drag the selection
 * backward. Pages before the first outline entry get assigned to
 * outline[0] so front-matter paragraphs still have a valid sectionId.
 */
function outlineItemIdForPage(outline: OutlineItem[], pageNum: number): string {
  let chosen = outline[0];
  // OutlineItem.page is nominally optional on the type, but every entry
  // emitted by parsePdf sets one. Default missing pages to 0 so the
  // comparisons degrade gracefully instead of throwing NaN around.
  const pageOf = (o: OutlineItem) => o.page ?? 0;
  for (const it of outline) {
    if (pageOf(it) <= pageNum && pageOf(it) >= pageOf(chosen)) {
      chosen = it;
    }
  }
  return chosen.id;
}
