import { CSSProperties, MouseEvent, useMemo, useRef } from 'react';
import type { Paper, Paragraph, TextSelection, PdfRuntime } from '../types';
import { PdfPage } from './pdf-page';

interface Props {
  paper: Paper;
  onSelect: (sel: TextSelection | null) => void;
  font: 'serif' | 'sans';
  pdfRuntime?: PdfRuntime | null;
  /** Reader zoom multiplier. For PDF mode this scales pdfjs's render
   *  scale so canvas stays crisp; HTML mode handles zoom higher up via
   *  CSS `zoom` on the paper card wrapper. */
  zoom?: number;
}

export function PaperPage({ paper, onSelect, font, pdfRuntime, zoom = 1 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = (_e: MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !containerRef.current) {
      onSelect(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) { onSelect(null); return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const parentRect = containerRef.current.getBoundingClientRect();
    const start = range.startContainer;
    const pidEl = (start instanceof Element ? start : start.parentElement)?.closest('[data-pid]');
    onSelect({
      text,
      rect: {
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        right: rect.right - parentRect.left,
        bottom: rect.bottom - parentRect.top,
        width: rect.width,
      },
      paragraphId: pidEl?.getAttribute('data-pid') ?? null,
    });
  };

  const bodyFont: CSSProperties = {
    fontFamily: font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
  };

  // Group paragraph ids by source page (PDF mode). Memoized so the arrays
  // handed to PdfPage are stable across parent re-renders — otherwise PdfPage's
  // render effect tears down and re-runs on every memory / highlight update.
  const pageToParaIds = useMemo(() => {
    if (!pdfRuntime) return null;
    const acc: string[][] = pdfRuntime.pageItemRanges.map(() => []);
    const outlinePageById = new Map(paper.outline.map((o) => [o.id, o.page]));
    for (const p of paper.paragraphs) {
      const page = outlinePageById.get(p.sectionId);
      if (!page) continue;
      acc[page - 1].push(p.id);
    }
    return acc;
  }, [pdfRuntime, paper.outline, paper.paragraphs]);

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} style={{ position: 'relative' }}>
      {/* Title + abstract: skip in PDF canvas mode — page 1 of the PDF
          already renders the same content (logo / title / authors / abstract)
          on the canvas, so our HTML header would duplicate it visually. In
          HTML mode we still render the header because ar5iv's HTML doesn't
          include a visible title block by default. */}
      {!pdfRuntime && (<>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        {paper.venue && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)',
            letterSpacing: '0.04em', marginBottom: 14,
          }}>{paper.venue}</div>
        )}
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600,
          lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 14px',
          color: 'var(--ink)',
        }}>{paper.title}</h1>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-soft)',
          fontStyle: 'italic',
        }}>{paper.authors.join(', ')}</div>
        {paper.affiliations && paper.affiliations.length > 0 && (
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-faded)',
            marginTop: 4,
          }}>{paper.affiliations.join(' · ')}</div>
        )}
      </div>

      {/* Abstract — only render if non-empty (PDF mode leaves abstract = '') */}
      {paper.abstract && (
        <div style={{
          margin: '0 18px 30px', padding: '14px 18px',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faded)',
            letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase',
          }}>Abstract</div>
          <div
            data-pid="abs"
            style={{
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
              color: 'var(--ink-soft)',
            }}
          >{paper.abstract}</div>
        </div>
      )}
      </>)}

      {/* Section headers + paragraphs */}
      {pdfRuntime && pageToParaIds
        ? pdfRuntime.pageItemRanges.map((ranges, pageIdx) => (
            <PdfPage
              key={pageIdx}
              doc={pdfRuntime.doc}
              pageNumber={pageIdx + 1}
              ranges={ranges}
              paragraphIds={pageToParaIds[pageIdx]}
              scale={1.25 * zoom}
            />
          ))
        : renderBody(paper, bodyFont)}
    </div>
  );
}

function renderBody(paper: Paper, bodyFont: CSSProperties) {
  const items: Array<{ type: 'h'; text: string } | { type: 'p'; p: Paragraph }> = [];
  let currentSection: string | null = null;
  for (const p of paper.paragraphs) {
    if (p.section !== currentSection) {
      items.push({ type: 'h', text: p.section });
      currentSection = p.section;
    }
    items.push({ type: 'p', p });
  }
  return items.map((item, i) => {
    if (item.type === 'h') {
      // Skip empty section labels (heading-less sections from §1 bib fixture etc.)
      if (!item.text) return null;
      return (
        <h2 key={i} style={{
          fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600,
          margin: '24px 0 10px', color: 'var(--ink)',
          letterSpacing: '-0.005em',
        }}>{item.text}</h2>
      );
    }
    if (item.p.html) {
      return <RichBlock key={i} paragraph={item.p} bodyFont={bodyFont} />;
    }

    return (
      <p
        key={i}
        data-pid={item.p.id}
        style={{
          ...bodyFont,
          fontSize: 14, lineHeight: 1.7,
          color: 'var(--ink)', margin: '0 0 14px',
          textAlign: 'justify', hyphens: 'auto',
        }}
      >
        {item.p.text}
      </p>
    );
  });
}

/**
 * Presentational renderer for ar5iv rich blocks (figure / equation / table).
 * Highlights are painted by ViewerApp's CSS Custom Highlight API registration
 * over the data-pid-scoped subtree — no per-block highlight logic needed here.
 */
function RichBlock({
  paragraph, bodyFont,
}: {
  paragraph: Paragraph;
  bodyFont: CSSProperties;
}) {
  return (
    <div
      data-pid={paragraph.id}
      className="ltx-block paper-body"
      style={{
        ...bodyFont,
        fontSize: 14, lineHeight: 1.7,
        color: 'var(--ink)', margin: '0 0 14px',
      }}
      dangerouslySetInnerHTML={{ __html: paragraph.html! }}
    />
  );
}
