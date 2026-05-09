import { CSSProperties } from 'react';
import { I } from './icons';
import type { IconName } from './icons';
import type { TextSelection } from '../types';

export type SelectionActionKind = 'explain' | 'highlight' | 'note' | 'translate';

interface Props {
  selection: TextSelection | null;
  onAction: (kind: SelectionActionKind, sel: TextSelection) => void;
  onClose: () => void;
  paperCardWidth: number;
}

export function SelectionToolbar({ selection, onAction, onClose, paperCardWidth }: Props) {
  if (!selection) return null;
  const { rect } = selection;
  const top = Math.max(rect.top - 44, 8);
  // Clamp inside the paper card. 60px = the card's horizontal padding (spec §8.1 reader column),
  // so the toolbar stays within the reading area rather than drifting into the margin notes column.
  const minX = 60;
  const maxX = Math.max(paperCardWidth - 60, minX + 1);
  const left = Math.min(Math.max(rect.left + rect.width / 2, minX), maxX);

  const actions: Array<{ id: SelectionActionKind; label: string; icon: IconName; kbd: string }> = [
    { id: 'explain',   label: 'Explain',   icon: 'Sparkle',   kbd: 'E' },
    { id: 'highlight', label: 'Highlight', icon: 'Highlight', kbd: 'H' },
    { id: 'note',      label: 'Note',      icon: 'Edit',      kbd: 'N' },
    { id: 'translate', label: 'Translate', icon: 'Translate', kbd: 'T' },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'absolute',
        top, left,
        transform: 'translateX(-50%)',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-2)',
        padding: '4px 4px',
        display: 'flex', alignItems: 'center', gap: 2,
        zIndex: 100,
        animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
      onMouseDown={(e) => e.preventDefault()}  // prevent losing selection on click
    >
      {actions.map((a) => {
        const Ico = I[a.icon];
        return (
          <button
            key={a.id}
            onClick={() => onAction(a.id, selection)}
            title={`${a.label} (${a.kbd})`}
            style={buttonStyle()}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            <Ico size={13} stroke={1.6} />
            {a.label}
          </button>
        );
      })}
      <div style={{ width: 1, height: 14, background: 'var(--rule)', margin: '0 2px' }} />
      <button
        onClick={onClose}
        style={{ ...buttonStyle(), width: 24, height: 24, padding: 0, justifyContent: 'center' }}
      >
        <I.Close size={12} />
      </button>
    </div>
  );
}

function buttonStyle(): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    color: 'var(--ink-soft)',
    fontSize: 12, fontWeight: 500,
    transition: 'background 120ms, color 120ms',
  };
}

function hoverOn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--paper-deep)';
  e.currentTarget.style.color = 'var(--ink)';
}
function hoverOff(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--ink-soft)';
}
