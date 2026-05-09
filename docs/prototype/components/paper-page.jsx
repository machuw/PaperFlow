// PDF mock — renders paragraphs as a paper page with text selection
const { useState, useRef, useEffect, useMemo, useCallback } = React;

function PaperPage({ paper, onSelect, highlights, onScrollPos, scrollRef }) {
  const containerRef = useRef(null);

  const handleMouseUp = (e) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (text.length < 3) { onSelect(null); return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const parentRect = containerRef.current.getBoundingClientRect();
    onSelect({
      text,
      rect: {
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        right: rect.right - parentRect.left,
        bottom: rect.bottom - parentRect.top,
        width: rect.width,
      },
      paragraphId: range.startContainer?.parentElement?.closest('[data-pid]')?.getAttribute('data-pid'),
    });
  };

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      style={{ position: 'relative' }}
    >
      {/* Title block */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)', letterSpacing: '0.04em', marginBottom: 14 }}>
          {paper.venue}
        </div>
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600,
          lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 14px',
          color: 'var(--ink)',
        }}>{paper.title}</h1>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
          {paper.authors.join(', ')}
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: 'var(--ink-faded)', marginTop: 4 }}>
          {paper.affiliations.join(' · ')}
        </div>
      </div>

      {/* Abstract */}
      <div style={{
        margin: '0 18px 30px',
        padding: '14px 18px',
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faded)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
          Abstract
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
          {paper.abstract}
        </div>
      </div>

      {/* Section headers + paragraphs */}
      {renderParagraphs(paper, highlights)}

      {/* Figure 1 placeholder */}
      <figure style={{ margin: '30px 0', border: '1px solid var(--rule)', padding: 16, background: 'var(--paper-soft)' }}>
        <FigurePlaceholder label="Chunk residuals — φ projection + retrieval bias" />
        <figcaption style={{ fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic', color: 'var(--ink-soft)', marginTop: 12, textAlign: 'center' }}>
          <strong style={{ fontStyle: 'normal' }}>Figure 1.</strong> {paper.figures[0].caption}
        </figcaption>
      </figure>

      {/* Page number */}
      <div style={{ textAlign: 'center', marginTop: 36, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-ghost)' }}>
        — 1 —
      </div>
    </div>
  );
}

function renderParagraphs(paper, highlights) {
  const grouped = [];
  let currentSection = null;
  for (const p of paper.paragraphs) {
    if (p.section !== currentSection) {
      grouped.push({ type: 'h', text: p.section });
      currentSection = p.section;
    }
    grouped.push({ type: 'p', ...p });
  }
  return grouped.map((item, i) => {
    if (item.type === 'h') {
      return (
        <h2 key={i} style={{
          fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600,
          margin: '24px 0 10px', color: 'var(--ink)',
          letterSpacing: '-0.005em',
        }}>{item.text}</h2>
      );
    }
    const hl = highlights.find(h => h.paragraphId === item.id);
    return (
      <p
        key={i}
        data-pid={item.id}
        style={{
          fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.7,
          color: 'var(--ink)', margin: '0 0 14px', textAlign: 'justify',
          hyphens: 'auto',
        }}
      >
        {hl ? renderHighlighted(item.text, hl) : item.text}
      </p>
    );
  });
}

function renderHighlighted(text, hl) {
  const idx = text.indexOf(hl.text);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={`hl-${hl.color || 'yellow'}`}>{hl.text}</span>
      {text.slice(idx + hl.text.length)}
    </>
  );
}

function FigurePlaceholder({ label }) {
  return (
    <div style={{
      height: 180,
      background: `repeating-linear-gradient(45deg, transparent, transparent 6px, var(--rule-soft) 6px, var(--rule-soft) 7px)`,
      border: '1px dashed var(--rule)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)',
      letterSpacing: '0.05em',
    }}>
      {label}
    </div>
  );
}

window.PaperPage = PaperPage;
