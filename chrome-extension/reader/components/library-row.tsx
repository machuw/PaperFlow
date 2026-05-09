import { useState, useRef, useEffect } from 'react';
import { useFloating, flip, shift, autoUpdate } from '@floating-ui/react-dom';
import type { LibraryRow, LibraryCatalogEntry, TopicCatalogEntry } from '../types';
import { formatRelative } from '../lib/paper';
import { I } from './icons';
import { LibraryPopover, TopicPopover } from './library-popover';
import { isEditingInput } from '../lib/is-editing-input';

// Role → spine color map per §3.6 (was re-exported from outline-panel before it was deleted).
const ROLE_COLORS: Record<string, string> = {
  'Background': 'var(--walnut-soft)',
  'Method reference': 'var(--sky)',
  'Counter-evidence': 'var(--foxglove)',
  'Tangential': 'var(--ink-ghost)',
  'Central': 'var(--walnut)',
  'Ancestor': 'var(--forest)',
};

interface Props {
  row: LibraryRow;
  isCurrent: boolean;
  libraries?: LibraryCatalogEntry[];
  topics?: TopicCatalogEntry[];
  alsoInTopics?: string[];
  onAssignLibrary?: (rowKey: string, libraryId: string | null) => void;
  onToggleTopic?: (rowKey: string, topicId: string) => void;
  onUnassignTopic?: (rowKey: string, topicId: string) => void;
  onCreateLibraryFromCard?: (name: string, rowKey: string) => void;
  onCreateTopicFromCard?: (name: string, rowKey: string) => void;
  onRemove?: (rowKey: string) => void;
  onPaperClick?: (rowKey: string) => void;
}

function CardMenu({ anchor, onRemove, onClose }: {
  anchor: HTMLElement | null;
  onRemove: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'left-start',
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [onClose, anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{
        ...floatingStyles,
        background: 'var(--paper)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-2)',
        zIndex: 300,
        minWidth: 160,
      }}
      role="menu"
      aria-label="Paper actions"
    >
      <button
        role="menuitem"
        onClick={() => { onRemove(); onClose(); }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '8px 12px', fontSize: 12,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--foxglove)', fontFamily: 'var(--font-mono)',
        }}
      >Remove from library</button>
    </div>
  );
}

export function LibraryRowView({
  row,
  isCurrent,
  libraries = [],
  topics = [],
  alsoInTopics,
  onAssignLibrary = () => {},
  onToggleTopic = () => {},
  onUnassignTopic = () => {},
  onCreateLibraryFromCard,
  onCreateTopicFromCard,
  onRemove,
  onPaperClick,
}: Props) {
  const rowKey = row.id ?? row.urlHash;
  const clickable = !!onPaperClick && !isCurrent;

  // Click anywhere on the card except interactive children (buttons / menus /
  // popovers / inputs) → navigate to that paper. Skipped when this row IS the
  // current paper (no-op jump) or when no handler is provided.
  const handleCardClick = (e: React.MouseEvent) => {
    if (!clickable) return;
    const t = e.target as HTMLElement;
    // The card root itself carries role="button" (see below) — exclude it from
    // the early-return so the closest() walk only catches *child* interactive
    // elements (real buttons/inputs/menus and any nested role=button widgets).
    const interactive = t.closest('button, a, input, [role="button"], [role="menu"], [role="menuitem"]');
    if (interactive && interactive !== e.currentTarget) return;
    // Don't fire when user is selecting text — drag selections produce empty clicks
    // here too, but a quick text selection still ends in a click event.
    if (window.getSelection()?.toString()) return;
    onPaperClick(rowKey);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      // Only if focus is on the card itself, not a nested button/input
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onPaperClick(rowKey);
    }
  };

  const [libPopOpen, setLibPopOpen] = useState(false);
  const [topicPopOpen, setTopicPopOpen] = useState(false);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const libAnchor = useRef<HTMLButtonElement>(null);
  const topicAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);

  const [optimisticLibraryId, setOptimisticLibraryId] = useState<string | null | undefined>(undefined);
  const [libChipState, setLibChipState] = useState<'idle' | 'inflight' | 'failed'>('idle');

  const effectiveLibraryId = optimisticLibraryId !== undefined ? optimisticLibraryId : row.libraryId;

  const tryAssignLibrary = async (id: string | null) => {
    setOptimisticLibraryId(id);
    setLibChipState('inflight');
    try {
      await Promise.resolve(onAssignLibrary(rowKey, id));
      setLibChipState('idle');
      setOptimisticLibraryId(undefined);
    } catch {
      setLibChipState('failed');
      setTimeout(() => {
        setLibChipState('idle');
        setOptimisticLibraryId(undefined);
      }, 320 + 200);
    }
  };

  const spineColor = isCurrent
    ? 'var(--walnut-deep)'
    : ROLE_COLORS[row.role] ?? 'var(--ink-ghost)';

  const whenLabel = formatRelative(row.lastRead);

  const filedLib = libraries.find(l => l.id === effectiveLibraryId);
  const assignedTopics = row.topicIds
    .map(id => topics.find(t => t.id === id))
    .filter(Boolean) as TopicCatalogEntry[];

  // Build "Also in:" text: cap at 3 names + "+N more"
  let alsoInText: string | null = null;
  if (alsoInTopics && alsoInTopics.length > 0) {
    const shown = alsoInTopics.slice(0, 3);
    const extra = alsoInTopics.length - 3;
    alsoInText = 'Also in: ' + shown.join(' · ') + (extra > 0 ? ` · +${extra} more` : '');
  }

  return (
    <div
      data-pid="paper-card"
      data-paper-key={rowKey}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open ${row.title}` : undefined}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      style={{
      display: 'flex',
      flexDirection: 'column',
      padding: '12px 14px 12px 14px',
      background: 'var(--paper-soft)',
      border: `0.5px solid ${isCurrent ? 'var(--walnut-soft)' : 'var(--rule)'}`,
      borderRadius: 6,
      position: 'relative',
      cursor: clickable ? 'pointer' : 'default',
    }}>
      {/* Spine */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
        background: spineColor, borderRadius: '6px 0 0 6px',
      }} />

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, paddingLeft: 6 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13.5, fontWeight: 600,
          color: 'var(--ink)', lineHeight: 1.35,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: 0, flexShrink: 1,
        }}>{row.title}</div>
        {isCurrent && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.08em',
            padding: '1px 5px',
            background: 'var(--walnut)', color: 'var(--paper)',
            borderRadius: 2, flexShrink: 0,
          }}>NOW</span>
        )}
      </div>

      {/* Authors / pages / when */}
      <div style={{
        fontFamily: 'var(--font-serif)', fontStyle: 'italic',
        fontSize: 11, color: 'var(--ink-faded)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        paddingLeft: 6,
      }}>
        {row.authors.join(', ')}
        {row.pages > 0 && ` · ${row.pages}p`}
        {whenLabel && ` · ${whenLabel}`}
      </div>

      {/* Judgment quote */}
      {row.judgment.trim() && (
        <div style={{
          marginTop: 6,
          padding: '2px 0 2px 10px',
          borderLeft: '1.5px solid var(--rule)',
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{row.judgment}</div>
      )}

      {/* Also in: disambiguation */}
      {alsoInText && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', margin: '4px 0 8px 6px',
        }}>{alsoInText}</div>
      )}

      {/* Chip row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap-reverse', gap: 6,
        alignItems: 'center', marginTop: 8, paddingLeft: 6,
      }}>
        {/* Library chip */}
        <button
          ref={libAnchor}
          aria-label={filedLib ? `Library: ${filedLib.name}` : 'Set library'}
          onClick={() => setLibPopOpen(o => !o)}
          className={[
            libChipState === 'failed' ? 'shake-x' : '',
            filedLib ? 'lib-chip-filed' : '',
          ].filter(Boolean).join(' ') || undefined}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 7px', fontSize: 10,
            fontFamily: 'var(--font-mono)',
            background: filedLib ? undefined : 'transparent',
            border: '0.5px solid var(--rule)',
            borderRadius: 3, cursor: 'pointer',
            color: filedLib ? 'var(--ink-soft)' : 'var(--ink-faded)',
            opacity: libChipState === 'inflight' ? 0.7 : 1,
          }}
        >
          <I.Folder size={11} stroke={1.4} />
          {filedLib ? `Library: ${filedLib.name}` : '+ Set library'}
          <I.ChevronDown size={9} stroke={1.5} />
        </button>

        {/* Topic chips */}
        {assignedTopics.map(t => (
          <span
            key={t.id}
            className="topic-chip"
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 7px', fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'color-mix(in oklch, var(--sky) 14%, transparent)',
              border: '0.5px solid color-mix(in oklch, var(--sky) 30%, transparent)',
              borderRadius: 3,
              color: 'var(--ink-soft)',
            }}
          >
            {t.name}
            <button
              aria-label={`Topic: ${t.name}, click to remove`}
              onClick={() => onUnassignTopic(rowKey, t.id)}
              onKeyDown={(e) => {
                if (isEditingInput(e)) return;
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  onUnassignTopic(rowKey, t.id);
                }
              }}
              className="topic-chip-x"
              style={{
                color: 'var(--ink-faded)', marginLeft: 4,
                padding: 0, background: 'transparent', border: 'none',
                cursor: 'pointer', lineHeight: 1,
                display: 'inline-flex', alignItems: 'center',
              }}
            >×</button>
          </span>
        ))}

        {/* + Set topic chip */}
        <button
          ref={topicAnchor}
          aria-label="Set topic"
          onClick={() => setTopicPopOpen(o => !o)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 7px', fontSize: 10,
            fontFamily: 'var(--font-mono)',
            background: 'transparent',
            border: '0.5px dashed var(--rule)',
            borderRadius: 3, cursor: 'pointer',
            color: 'var(--ink-faded)',
          }}
        >
          + Set topic <I.ChevronDown size={9} stroke={1.5} />
        </button>

        {/* Right cluster — pushed right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {row.role && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.02em',
              padding: '2px 7px',
              background: `color-mix(in oklch, ${ROLE_COLORS[row.role] ?? 'var(--ink-ghost)'} 14%, transparent)`,
              color: ROLE_COLORS[row.role] ?? 'var(--ink-faded)',
              borderRadius: 3,
            }}>{row.role}</span>
          )}
          {row.hasMemory && (
            <span title="Has memory" style={{ display: 'inline-flex', color: 'var(--walnut)' }}>
              <I.Memory size={12} stroke={1.4} />
            </span>
          )}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)',
          }}>✎ {row.annotations}</span>
          {onRemove && (
            <button
              ref={moreAnchor}
              aria-label={`More actions for ${row.title}`}
              onClick={(e) => { e.stopPropagation(); setCardMenuOpen(o => !o); }}
              className="icon-btn paper-card-more"
              style={{ width: 20, height: 20 }}
            >
              <I.More size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Popovers */}
      {libPopOpen && (
        <LibraryPopover
          libraries={libraries}
          currentId={effectiveLibraryId}
          onAssign={(id) => { tryAssignLibrary(id); }}
          onCreate={(name) => onCreateLibraryFromCard?.(name, rowKey)}
          onClose={() => setLibPopOpen(false)}
          anchor={libAnchor.current}
        />
      )}
      {topicPopOpen && (
        <TopicPopover
          topics={topics}
          selectedIds={row.topicIds}
          onToggle={(id) => onToggleTopic(rowKey, id)}
          onCreate={(name) => onCreateTopicFromCard?.(name, rowKey)}
          onClose={() => setTopicPopOpen(false)}
          anchor={topicAnchor.current}
        />
      )}
      {cardMenuOpen && onRemove && (
        <CardMenu
          anchor={moreAnchor.current}
          onRemove={() => onRemove(rowKey)}
          onClose={() => setCardMenuOpen(false)}
        />
      )}
    </div>
  );
}
