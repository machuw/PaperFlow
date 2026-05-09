import { useState, type CSSProperties } from 'react';
import type { Paper, OutlineItem } from '../types';
import { scrollToOutlineItem } from '../lib/scroll-to-outline';
import { t } from '../lib/i18n';

export function OverviewOutline({ paper }: { paper: Paper }) {
  if (paper.outline.length === 0) return null;
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(paper.outline.filter((o) => o.level === 0).map((o) => o.id))
  );
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Number only top-level (level 0) items: 1, 2, 3, ...
  const topLevelSeq = new Map<string, number>();
  let n = 0;
  for (const o of paper.outline) {
    if (o.level === 0) topLevelSeq.set(o.id, ++n);
  }

  // Find children of a level-0 section so we know which top-level items
  // are "expandable" (have at least one child).
  const childrenOf = (parentIdx: number): OutlineItem[] => {
    const out: OutlineItem[] = [];
    for (let i = parentIdx + 1; i < paper.outline.length; i++) {
      if (paper.outline[i].level === 0) break;
      out.push(paper.outline[i]);
    }
    return out;
  };

  return (
    <section>
      <h3 style={headingStyle}>{t('overview.contents.title') || '目录'}</h3>
      <ul style={listStyle}>
        {paper.outline.map((o, idx) => {
          if (o.level !== 0 && !shouldRenderChild(o, paper.outline, idx, expanded)) return null;
          const isLevel0 = o.level === 0;
          const num = isLevel0 ? topLevelSeq.get(o.id) : null;
          const hasChildren = isLevel0 && childrenOf(idx).length > 0;
          const isOpen = expanded.has(o.id);
          const isHover = hoverId === o.id;

          return (
            <li key={o.id} style={liStyle(o.level)}>
              <button
                onClick={() => scrollToOutlineItem(o, paper)}
                onMouseEnter={() => setHoverId(o.id)}
                onMouseLeave={() => setHoverId(null)}
                style={rowStyle(isLevel0, isHover)}
                title={t('overview.contents.jumpHint') || '跳转到这一节'}
              >
                {/* Number column (only for level-0; level-1 leaves it empty for indent) */}
                <span style={numStyle(isLevel0)}>
                  {num != null ? `${num}` : ''}
                </span>
                {/* Title with optional expand/collapse caret on hover */}
                <span style={titleStyle(isLevel0)}>{o.label}</span>
                {/* Dotted leader fills the gap */}
                <span style={leaderStyle} aria-hidden />
                {/* Page number, mono for tabular alignment */}
                <span style={pageStyle}>
                  {o.page != null ? `p. ${o.page}` : ''}
                </span>
              </button>
              {hasChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                      return next;
                    });
                  }}
                  aria-label={isOpen ? '折叠' : '展开'}
                  style={caretStyle(isOpen)}
                >▾</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shouldRenderChild(
  _item: OutlineItem,
  outline: OutlineItem[],
  idx: number,
  expanded: Set<string>,
): boolean {
  // Walk back to find the nearest level-0 ancestor; render only if expanded.
  for (let i = idx - 1; i >= 0; i--) {
    if (outline[i].level === 0) return expanded.has(outline[i].id);
  }
  return false;
}

const headingStyle: CSSProperties = {
  margin: '0 0 8px',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--ink)',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const liStyle = (level: number): CSSProperties => ({
  position: 'relative',
  paddingLeft: level * 18,
});

const rowStyle = (isLevel0: boolean, isHover: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  width: '100%',
  padding: '4px 6px',
  marginLeft: -6,
  marginRight: -6,
  background: isHover ? 'var(--paper-soft)' : 'transparent',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--font-serif)',
  fontSize: isLevel0 ? 13 : 12.5,
  color: isLevel0 ? 'var(--ink)' : 'var(--ink-soft)',
  fontWeight: isLevel0 ? 500 : 400,
  lineHeight: 1.5,
  transition: 'background 80ms',
});

const numStyle = (isLevel0: boolean): CSSProperties => ({
  flexShrink: 0,
  width: 18,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-faded)',
  fontWeight: 400,
  visibility: isLevel0 ? 'visible' : 'hidden',
});

const titleStyle = (_isLevel0: boolean): CSSProperties => ({
  flexShrink: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const leaderStyle: CSSProperties = {
  flex: '1 1 auto',
  alignSelf: 'center',
  height: 0,
  borderTop: '1px dotted var(--rule-soft)',
  margin: '0 4px',
  minWidth: 8,
};

const pageStyle: CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-faded)',
  fontVariantNumeric: 'tabular-nums',
};

const caretStyle = (isOpen: boolean): CSSProperties => ({
  position: 'absolute',
  left: -2,
  top: 4,
  width: 14,
  height: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-faded)',
  fontSize: 9,
  transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
  transition: 'transform 120ms',
});
