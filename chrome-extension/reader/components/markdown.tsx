import { type CSSProperties, type ReactNode } from 'react';
import type { Citation } from '../types';
import { READER_BODY_STYLE } from '../lib/typography';

/**
 * Minimal markdown rendering for AI-generated bodies (chat responses,
 * summary cards). Handles the handful of constructs the AI actually
 * emits: headings (`#`, `##`), unordered bullets (`- `, `* `), ordered
 * bullets (`1. `), paragraph breaks, and inline **bold** / *italic* /
 * `code` / citations.
 *
 * Why a hand-rolled parser: pulling in marked/react-markdown for the
 * few constructs we need would add ~30kB gzipped. This is ~1kB and
 * understands exactly what we care about.
 */

const INLINE_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[(?:abs|p\d+|[a-z]+\d+)\])/g;

const CITATION_SCROLL_BREATHING_PX = 16;

/**
 * Scroll the reader's paragraph (or abstract) into view when a citation
 * superscript is clicked.
 *
 * Citation tokens use the AI's 1-based index into `paper.paragraphs` (e.g.
 * `[p3]` is the third entry). The DOM, on the other hand, tags paragraphs
 * with composite ids like `sec0-p2` (see lib/parse.ts) — so we can't just
 * `querySelector('[data-pid="p3"]')`. We walk all `[data-pid]` nodes in
 * document order, dedupe by their pid value (PDF text-layer spans share a
 * pid within the same paragraph), skip the abstract sentinel, and take the
 * Nth distinct paragraph.
 */
function findCitationTarget(tok: string): HTMLElement | null {
  if (tok === 'abs') {
    return document.querySelector<HTMLElement>('[data-pid="abs"]');
  }
  if (!/^p\d+$/.test(tok)) return null;
  const n = parseInt(tok.slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  const seen = new Set<string>();
  let count = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-pid]')) {
    const pid = el.getAttribute('data-pid');
    if (!pid || pid === 'abs' || seen.has(pid)) continue;
    seen.add(pid);
    count++;
    if (count === n) return el;
  }
  return null;
}

// Module-level state for the currently highlighted citation target. PDF mode
// has many spans sharing one data-pid (one paragraph spans multiple text-layer
// fragments), so we track an array and apply the class to all of them so the
// whole paragraph lights up — not just the first span the walker found.
let activeCitationEls: HTMLElement[] = [];
let outsideListenerInstalled = false;

function clearActiveCitationHighlight() {
  for (const el of activeCitationEls) el.classList.remove('pf-citation-active');
  activeCitationEls = [];
}

function ensureOutsideListener() {
  if (outsideListenerInstalled) return;
  outsideListenerInstalled = true;
  // pointerdown (not click) so the highlight clears the moment the user
  // starts interacting elsewhere — feels snappier than waiting for click.
  document.addEventListener('pointerdown', (e) => {
    if (activeCitationEls.length === 0) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // Don't clear if the user is clicking another citation sup — its onClick
    // will set a new active set right after, and pre-clearing would cause a
    // visible flash. The data-citation-jump attribute marks our sups.
    if (t.closest('[data-citation-jump]')) return;
    // Don't clear if click is inside the currently highlighted region.
    if (activeCitationEls.some((el) => el.contains(t))) return;
    clearActiveCitationHighlight();
  });
}

function scrollContainerToTarget(target: HTMLElement, container: HTMLElement) {
  const tRect = target.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  // Center the target vertically inside the reader container. For paragraphs
  // taller than the viewport (long blocks, full PDF pages), centering would
  // push the top off-screen — fall back to top-aligned with a breathing gap
  // so the user still sees the start of the cited region.
  const tHeight = tRect.height;
  const cHeight = cRect.height;
  const fitsInViewport = tHeight < cHeight - CITATION_SCROLL_BREATHING_PX * 2;
  const delta = fitsInViewport
    ? (tRect.top + tHeight / 2) - (cRect.top + cHeight / 2)
    : tRect.top - cRect.top - CITATION_SCROLL_BREATHING_PX;
  const next = Math.max(0, container.scrollTop + delta);
  container.scrollTo({ top: next, behavior: 'smooth' });
}

function applyCitationHighlight(target: HTMLElement) {
  // Apply the persistent highlight to ALL DOM nodes sharing this paragraph's
  // pid so PDF text-layer paragraphs (which split across many spans) light
  // up as one block. Falls back to just the target for the abstract sentinel.
  const pid = target.getAttribute('data-pid');
  const els = pid
    ? Array.from(document.querySelectorAll<HTMLElement>(`[data-pid="${CSS.escape(pid)}"]`))
    : [target];
  clearActiveCitationHighlight();
  for (const el of els) el.classList.add('pf-citation-active');
  activeCitationEls = els;
  ensureOutsideListener();
}

function jumpToCitation(tok: string, fallbackPage: number | null) {
  const container = document.querySelector<HTMLElement>('[data-reader-scroll]');
  if (!container) return;

  let target = findCitationTarget(tok);
  if (target) {
    scrollContainerToTarget(target, container);
    applyCitationHighlight(target);
    return;
  }

  // PDF lazy-render fallback: text-layer spans for the cited paragraph
  // haven't been hydrated yet (page is far from current scroll). Scroll to
  // the page skeleton (always mounted with known dimensions), let the
  // IntersectionObserver hydrate the spans, then retry the walk to refine
  // the scroll target and paint the highlight.
  if (fallbackPage == null) return;
  const pageEl = document.querySelector<HTMLElement>(`.pf-pdf-page[data-page="${fallbackPage}"]`);
  if (!pageEl) return;
  scrollContainerToTarget(pageEl, container);

  // Poll briefly for the span to appear. IntersectionObserver fires async +
  // pdfjs textLayer render takes a few hundred ms. Cap at ~2s so a missing
  // page (deleted, render failed) doesn't loop forever. Retry every rAF + a
  // floor so we don't burn CPU on instant resolutions.
  const startTs = Date.now();
  const tryFind = () => {
    const t = findCitationTarget(tok);
    if (t) {
      // Refine scroll position now that the actual span exists, then highlight.
      scrollContainerToTarget(t, container);
      applyCitationHighlight(t);
      return;
    }
    if (Date.now() - startTs > 2000) return;
    setTimeout(tryFind, 100);
  };
  setTimeout(tryFind, 200);
}

export interface InlineOpts {
  /** If set, citation tokens resolve to superscript n via this map. */
  citationMap?: Map<string, CitationMapEntry>;
  /** Style for rendered inline code chunks. */
  codeStyle?: CSSProperties;
}

export function renderInlineMarkdown(text: string, opts: InlineOpts = {}): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > lastIdx) nodes.push(text.slice(lastIdx, start));
    const token = m[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} style={{ fontWeight: 600, color: 'var(--ink)' }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      const content = token.slice(1, -1);
      if (content.includes('=') && content.length > 12) {
        nodes.push(
          <div key={key++} style={{
            fontFamily: 'var(--font-mono)', fontSize: 13,
            color: 'var(--ink)', textAlign: 'center',
            padding: '4px 10px', margin: '6px 0',
          }}>{content}</div>,
        );
      } else {
        nodes.push(
          <code key={key++} style={opts.codeStyle ?? {
            fontFamily: 'var(--font-mono)', fontSize: '0.92em',
            color: 'var(--walnut)',
          }}>{content}</code>,
        );
      }
    } else {
      // Citation token [p5] / [abs] / [xyz7]
      const inner = token.slice(1, -1);
      const entry = opts.citationMap?.get(inner);
      if (entry != null) {
        const fallbackPage = entry.page ?? null;
        nodes.push(
          <sup
            key={key++}
            role="button"
            tabIndex={0}
            data-citation-jump="true"
            title={`Jump to ${inner === 'abs' ? 'Abstract' : `paragraph ${inner.slice(1)}`}`}
            onClick={() => jumpToCitation(inner, fallbackPage)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToCitation(inner, fallbackPage); } }}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--walnut)', padding: '0 2px', fontWeight: 600,
              cursor: 'pointer', userSelect: 'none',
            }}
          >{entry.n}</sup>,
        );
      } else {
        nodes.push(
          <span key={key++} style={{
            display: 'inline-block', fontSize: 10,
            fontFamily: 'var(--font-mono)', color: 'var(--ink-ghost)',
            padding: '0 4px', marginLeft: 2, borderRadius: 3,
            background: 'var(--paper-soft)', verticalAlign: 1,
            letterSpacing: 0, userSelect: 'none',
          }}>{inner}</span>,
        );
      }
    }
    lastIdx = start + token.length;
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return nodes;
}

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

function parseBlocks(body: string): Block[] {
  const lines = body.split('\n');
  const out: Block[] = [];
  let pBuf: string[] = [];
  let ulBuf: string[] = [];
  let olBuf: string[] = [];

  const flushP = () => {
    if (pBuf.length) { out.push({ kind: 'p', text: pBuf.join(' ') }); pBuf = []; }
  };
  const flushUl = () => {
    if (ulBuf.length) { out.push({ kind: 'ul', items: ulBuf }); ulBuf = []; }
  };
  const flushOl = () => {
    if (olBuf.length) { out.push({ kind: 'ol', items: olBuf }); olBuf = []; }
  };
  const flushAll = () => { flushP(); flushUl(); flushOl(); };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flushAll(); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^### +(.+)$/.exec(t))) {
      flushAll(); out.push({ kind: 'h3', text: m[1] });
    } else if ((m = /^## +(.+)$/.exec(t))) {
      flushAll(); out.push({ kind: 'h2', text: m[1] });
    } else if ((m = /^# +(.+)$/.exec(t))) {
      flushAll(); out.push({ kind: 'h1', text: m[1] });
    } else if ((m = /^[-*] +(.+)$/.exec(t))) {
      flushP(); flushOl(); ulBuf.push(m[1]);
    } else if ((m = /^\d+\. +(.+)$/.exec(t))) {
      flushP(); flushUl(); olBuf.push(m[1]);
    } else {
      flushUl(); flushOl(); pBuf.push(t);
    }
  }
  flushAll();
  return out;
}

/**
 * Per-citation metadata threaded through to the inline renderer. `n` is the
 * display superscript number; `page` is the PDF page number (when known) so
 * jumpToCitation can fall back to a page-level scroll when the paragraph's
 * text-layer span hasn't been hydrated by the lazy IntersectionObserver yet.
 */
export interface CitationMapEntry {
  n: number;
  page?: number | null;
}

export interface MarkdownBodyProps {
  body: string;
  citationMap?: Map<string, CitationMapEntry>;
  /** Styles applied to the outer container. */
  style?: CSSProperties;
}

export function MarkdownBody({ body, citationMap, style }: MarkdownBodyProps) {
  const blocks = parseBlocks(body);
  const inline = (t: string) => renderInlineMarkdown(t, { citationMap });
  // Inline styles on p/li override .md-content CSS so any container that uses
  // that legacy class can't drift the typography. Heading colors deliberately
  // stay var(--ink) (h1/h2) and var(--ink-soft) (h3); body inherits from style.
  const pStyle: CSSProperties = { margin: '0', fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' };
  const liStyle: CSSProperties = { margin: '4px 0', fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' };
  return (
    <div style={{ ...READER_BODY_STYLE, ...style }}>
      {blocks.map((b, i) => {
        const topSpace = i === 0 ? 0 : 8;
        switch (b.kind) {
          case 'h1':
            return (
              <div key={i} style={{
                fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600,
                color: 'var(--ink)', margin: `${i === 0 ? 0 : 16}px 0 6px`,
              }}>{inline(b.text)}</div>
            );
          case 'h2':
            return (
              <div key={i} style={{
                fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600,
                color: 'var(--ink)', margin: `${i === 0 ? 0 : 14}px 0 4px`,
              }}>{inline(b.text)}</div>
            );
          case 'h3':
            return (
              <div key={i} style={{
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
                color: 'var(--ink-soft)', margin: `${i === 0 ? 0 : 12}px 0 4px`,
              }}>{inline(b.text)}</div>
            );
          case 'p':
            return <p key={i} style={{ ...pStyle, marginTop: topSpace }}>{inline(b.text)}</p>;
          case 'ul':
            return (
              <ul key={i} style={{
                margin: `${topSpace}px 0 0`, paddingLeft: 18,
              }}>
                {b.items.map((item, j) => (
                  <li key={j} style={liStyle}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} style={{
                margin: `${topSpace}px 0 0`, paddingLeft: 18,
              }}>
                {b.items.map((item, j) => (
                  <li key={j} style={liStyle}>{inline(item)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}

/** Build citation lookup map from a Citation[] list (chat-view shape).
 *  Also extracts the PDF page number from `loc` (formatLoc emits
 *  `'p. {N} · §{section} · ¶ p{M}'` in PDF mode) so jumpToCitation can
 *  fall back to a page-level scroll for paragraphs whose text-layer span
 *  hasn't been hydrated yet by the lazy IntersectionObserver. */
export function buildCitationMap(
  citations: Citation[] | undefined,
  paragraphIndexFromLoc: (c: Citation) => number,
): Map<string, CitationMapEntry> {
  const map = new Map<string, CitationMapEntry>();
  if (!citations) return map;
  for (const c of citations) {
    const tok = c.kind === 'abstract' ? 'abs' : `p${paragraphIndexFromLoc(c)}`;
    const pageMatch = c.loc.match(/^p\. (\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1], 10) : null;
    map.set(tok, { n: c.n, page });
  }
  return map;
}
