import type { OutlineItem, Paragraph, Paper } from '../types';
import { emptyMemory } from '../types';
import { buildParagraphs } from './parse';
import type { RawParagraph } from './parse';
import { urlHash } from './ids';

export interface ArxivApiMeta {
  title: string;
  authors: string[];
  abstract: string;
  primaryCategory: string;
  publishedDate: string;   // YYYY-MM-DD
}

export interface ParseArxivHtmlOptions {
  /** Absolute URL of the source ar5iv page. When supplied, relative <img src> in captured figures/equations/tables is rewritten to absolute. */
  baseUrl?: string;
}

export function parseArxivHtml(
  html: string,
  opts: ParseArxivHtmlOptions = {},
): { outline: OutlineItem[]; paragraphs: Paragraph[] } {
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

  // Paragraphs: for each section, collect direct <p> children AND <p> elements
  // inside <div class="ltx_para"> direct children (real ar5iv output wraps each
  // paragraph in a <div class="ltx_para"> block). Do NOT descend into nested
  // <section[id]> — those are handled by their own sectionIdMap entry.
  allSections.forEach(sec => {
    for (const child of Array.from(sec.children) as HTMLElement[]) {
      if (child.tagName === 'P') {
        raw.push({ outlineItemId: sectionIdMap.get(sec)!, text: child.textContent?.trim() ?? '' });
        continue;
      }
      // ar5iv wrapper: <div class="ltx_para"> usually contains exactly one
      // <p class="ltx_p"> for body text. But some papers (appendix figure
      // examples, minipage panels) put <img>/<figure>/<table> directly under
      // ltx_para with no <p>. Treat that case as a block — capture outerHTML
      // so the nested image renders via dangerouslySetInnerHTML.
      if (child.tagName === 'DIV' && child.classList.contains('ltx_para')) {
        const inner = Array.from(child.children).find(c => c.tagName === 'P') as HTMLParagraphElement | undefined;
        if (inner) {
          raw.push({
            outlineItemId: sectionIdMap.get(sec)!,
            text: inner.textContent?.trim() ?? '',
            html: inner.innerHTML,
          });
        } else {
          const rawHtml = child.outerHTML;
          raw.push({
            outlineItemId: sectionIdMap.get(sec)!,
            text: blockDescriptorText(child),
            html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
          });
        }
        continue;
      }
      // Figure / table / equation blocks — capture outerHTML as a paragraph-like entry.
      if (child.tagName === 'FIGURE' ||
          (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) ||
          child.tagName === 'TABLE') {
        const rawHtml = child.outerHTML;
        raw.push({
          outlineItemId: sectionIdMap.get(sec)!,
          text: blockDescriptorText(child),
          html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
        });
        continue;
      }
    }
  });

  // Appendix floats: some ar5iv papers place figures/tables at the document
  // root (outside any <section[id]>) after the bibliography closes. Attach
  // them to the last outline entry so they render in document order.
  //
  // We also catch `<div class="ltx_para">` at root when it doesn't contain a
  // body <p> — some papers wrap appendix figure images in a bare ltx_para
  // whose sibling <figure> holds only the caption. Dropping these leaves
  // the caption but loses the image.
  //
  // Skip nested blocks — their outer container is captured as a whole.
  const FLOAT_SELECTOR = 'figure, div.ltx_equation, div.ltx_para, table';
  if (outline.length > 0) {
    const tailId = sectionIdMap.get(allSections[allSections.length - 1])!;
    const floats = doc.querySelectorAll<HTMLElement>(FLOAT_SELECTOR);
    for (const block of Array.from(floats)) {
      if (block.closest('section[id]')) continue;
      if (block.parentElement?.closest(FLOAT_SELECTOR)) continue;
      // ltx_para with a direct <p> inner is a body paragraph, not a float —
      // only capture ltx_para when it wraps visual content (no direct <p>).
      if (
        block.tagName === 'DIV' &&
        block.classList.contains('ltx_para') &&
        Array.from(block.children).some((c) => c.tagName === 'P')
      ) continue;
      const rawHtml = block.outerHTML;
      raw.push({
        outlineItemId: tailId,
        text: blockDescriptorText(block),
        html: opts.baseUrl ? rewriteImgSrc(rawHtml, opts.baseUrl) : rawHtml,
      });
    }
  }

  const paragraphs = buildParagraphs(raw, outline);
  return { outline, paragraphs };
}

function entryChildText(entry: Element, localName: string): string {
  for (const child of Array.from(entry.children)) {
    if (child.localName === localName) return child.textContent?.trim() ?? '';
  }
  return '';
}

export function parseArxivApi(xml: string): ArxivApiMeta {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error('arXiv API: no <entry>');

  const title = entryChildText(entry, 'title');
  const abstract = entryChildText(entry, 'summary');
  const publishedIso = entryChildText(entry, 'published');

  const authors = Array.from(entry.querySelectorAll('author name'))
    .map(el => el.textContent?.trim() ?? '')
    .filter(Boolean);
  const primaryCategory = entry.querySelector('category')?.getAttribute('term') ?? '';
  const publishedDate = publishedIso.slice(0, 10);

  return { title, authors, abstract, primaryCategory, publishedDate };
}

/**
 * Produce the `text` field for a captured figure/equation/table block.
 *
 * ar5iv wraps the label/number in `<span class="ltx_tag">` inside the caption
 * (e.g. "Figure 1." / "Table 3."). When present, use it as-is; otherwise fall
 * back to a typed descriptor (`Figure` / `Equation` / `Table`) so the AI and
 * citation UI distinguish non-prose blocks from regular paragraphs.
 *
 * Output always begins with `[descriptor]` (brackets) followed by the block's
 * stripped textContent (caption for figures/tables, MathML-text for equations).
 */
function blockDescriptorText(child: Element): string {
  const rawText = (child.textContent ?? '').replace(/\s+/g, ' ').trim();

  // Detect kind: ltx_equation DIV → Equation; ltx_table figure → Table; plain
  // <table> → Table; other FIGURE → Figure.
  let kind: 'Figure' | 'Equation' | 'Table';
  if (child.tagName === 'DIV' && child.classList.contains('ltx_equation')) {
    kind = 'Equation';
  } else if (
    child.tagName === 'TABLE' ||
    (child.tagName === 'FIGURE' && child.classList.contains('ltx_table'))
  ) {
    kind = 'Table';
  } else {
    kind = 'Figure';
  }

  // Find the first ltx_tag inside a caption (scoped: only figcaption.ltx_caption
  // nested in the block). Strip its trailing period for cleaner brackets.
  // Normalize whitespace the same way rawText is so body.startsWith(rawTag)
  // matches even when the tag contains nested spans with tabs/newlines.
  const tagEl = child.querySelector('figcaption.ltx_caption > .ltx_tag');
  const rawTag = (tagEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const cleanTag = rawTag.replace(/\.$/, '').trim();

  // Build the bracketed descriptor. When a tag is present, it already includes
  // the kind word ("Figure 1", "Table 3"), so use the tag directly. Otherwise
  // use the bare kind.
  const descriptor = cleanTag ? `[${cleanTag}]` : `[${kind}]`;

  // Strip the tag prefix from rawText to avoid "[Figure 1] Figure 1. Architecture…"
  // Assumption: ar5iv emits `<figcaption><span class="ltx_tag">Figure 1.</span>
  // body text</figcaption>`, so rawText (textContent of the whole block) starts
  // with the tag's textContent. If a future fixture puts sibling markup before
  // the .ltx_tag inside the caption, the body-strip silently skips (descriptor
  // still correct, just the double-label it was supposed to prevent).
  let body = rawText;
  if (rawTag && body.startsWith(rawTag)) {
    body = body.slice(rawTag.length).trim();
  }

  return body ? `${descriptor} ${body}` : descriptor;
}

/**
 * Rewrite relative <img src> URLs in an HTML fragment to absolute URLs
 * against baseUrl. Absolute URLs (http/https) and data: URIs are left alone.
 * Returns a new HTML string.
 */
function rewriteImgSrc(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const imgs = doc.querySelectorAll<HTMLImageElement>('img');
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute('src');
    if (!src) continue;
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
    try {
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const absolute = new URL(src, base);
      if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:' && absolute.protocol !== 'data:') continue;
      img.setAttribute('src', absolute.href);
    } catch {
      console.debug('[PaperFlow] img rewrite skipped (invalid URL):', src);
    }
  }
  const wrapper = doc.querySelector('div');
  return wrapper?.innerHTML ?? html;
}

export function buildVenue(id: string, category: string, publishedDate: string): string {
  if (!category) return '';
  // "2026-02-14" → "14 Feb 2026"
  const [y, m, d] = publishedDate.split('-').map(s => parseInt(s, 10));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${d} ${months[(m - 1) | 0]} ${y}`;
  return `arXiv:${id}  [${category}]  ${dateStr}`;
}

export type LoadResult =
  | { kind: 'ok'; paper: Paper }
  | { kind: 'ok-partial'; paper: Paper }     // HTML ok, API failed — authors/abstract empty
  | { kind: 'fallback-pdf' }
  | { kind: 'error'; message: string };

function extractHtmlTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('title')?.textContent?.trim() ?? '';
}

/**
 * ar5iv's relative `<img src>` convention varies by paper:
 *   - Modern (~2026+): src embeds the versioned prefix, e.g.
 *     `src="2604.05015v1/x1.png"` → must resolve against `/html/` (parent).
 *   - Legacy: src is a plain name, e.g. `src="x1.png"` → resolves against
 *     `/html/{id}/` (current directory).
 *
 * Detect by scanning for a versioned-prefix src in the document and return
 * the right baseUrl for Task 8's `rewriteImgSrc` to produce working URLs.
 * Exported for unit testing.
 */
export function pickImgBaseUrl(htmlText: string, id: string): string {
  const idEsc = id.replace(/\./g, '\\.');
  const hasVersionedPrefix = new RegExp(`src=["']${idEsc}v\\d+/`).test(htmlText);
  return hasVersionedPrefix
    ? 'https://arxiv.org/html'
    : `https://arxiv.org/html/${id}`;
}

export async function loadArxivPaper(id: string): Promise<LoadResult> {
  const htmlUrl = `https://arxiv.org/html/${id}`;
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${id}`;

  const [htmlRes, apiRes] = await Promise.all([
    fetch(htmlUrl),
    fetch(apiUrl),
  ]);

  if (htmlRes.status === 404) return { kind: 'fallback-pdf' };
  if (!htmlRes.ok) return { kind: 'error', message: `HTML fetch ${htmlRes.status}` };

  const htmlText = await htmlRes.text();
  const imgBaseUrl = pickImgBaseUrl(htmlText, id);
  const { outline, paragraphs } = parseArxivHtml(htmlText, { baseUrl: imgBaseUrl });
  const hash = await urlHash(htmlUrl);

  if (apiRes.ok) {
    const apiText = await apiRes.text();
    const meta = parseArxivApi(apiText);
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

  const paper: Paper = {
    id,
    urlHash: hash,
    title: extractHtmlTitle(htmlText),
    authors: [],
    abstract: '',
    venue: '',
    outline,
    paragraphs,
    memory: emptyMemory(),
  };
  return { kind: 'ok-partial', paper };
}
