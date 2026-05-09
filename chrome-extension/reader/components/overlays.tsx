import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReaderVariant } from '../types';
import { I } from './icons';

/**
 * CmdK v1 (§9.1) — full command set: Paper (AI) + Memory + Jump + View.
 */
interface CmdKProps {
  open: boolean;
  onClose: () => void;
  variant: ReaderVariant;
  setVariant: (v: ReaderVariant) => void;
  onOpenLibrary: () => void;

  // New for Plan 4 — Paper and Memory actions.
  onSummarizePaper: () => void;
  onTranslatePage: () => void;
  onAskAboutPaper: () => void;
  onSetRole: () => void;
  onWriteJudgment: () => void;
  onLinkPaper: () => void;
}

interface CmdItem {
  id: string;
  group: string;
  label: string;
  kbd?: string;
  action: () => void;
}

export function CmdK({
  open, onClose, setVariant, onOpenLibrary,
  onSummarizePaper, onTranslatePage, onAskAboutPaper,
  onSetRole, onWriteJudgment, onLinkPaper,
}: CmdKProps) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<CmdItem[]>(() => [
    { id: 'paper-summarize', group: 'Paper',  label: 'Summarize whole paper',    action: () => { onSummarizePaper(); onClose(); } },
    { id: 'paper-translate', group: 'Paper',  label: 'Translate current page',   action: () => { onTranslatePage(); onClose(); } },
    { id: 'paper-ask',       group: 'Paper',  label: 'Ask question about paper', action: () => { onAskAboutPaper(); onClose(); } },

    // Memory CmdK group hidden — handlers retained (260427).

    { id: 'lib',          group: 'Jump',   label: 'Open Library', kbd: '⌘L',    action: () => { onOpenLibrary(); onClose(); } },

    { id: 'view-classic', group: 'View',   label: 'Layout: Classic',           action: () => { setVariant('classic'); onClose(); } },
    { id: 'view-summary', group: 'View',   label: 'Layout: Summary',           action: () => { setVariant('summary'); onClose(); } },
    // Canvas entry hidden — code path retained but no UI surface (260427).
  ], [setVariant, onClose, onOpenLibrary, onSummarizePaper, onTranslatePage, onAskAboutPaper, onSetRole, onWriteJudgment, onLinkPaper]);

  const filtered = items.filter((it) =>
    !q || it.label.toLowerCase().includes(q.toLowerCase())
  );

  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const grouped: Record<string, CmdItem[]> = {};
  for (const it of filtered) {
    grouped[it.group] = grouped[it.group] ?? [];
    grouped[it.group].push(it);
  }
  const flat = filtered;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); flat[cursor]?.action(); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.45)',
        zIndex: 250,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        style={{
          width: 520,
          background: 'var(--paper)',
          border: '0.5px solid var(--rule)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-3)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '10px 14px',
          borderBottom: '0.5px solid var(--rule)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <I.Command size={14} stroke={1.3} style={{ color: 'var(--ink-faded)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--ink)',
            }}
          />
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto', padding: '4px 0 8px' }}>
          {Object.entries(grouped).map(([group, rows]) => (
            <div key={group}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--ink-faded)', padding: '8px 14px 4px',
              }}>{group}</div>
              {rows.map((it) => {
                const i = flat.indexOf(it);
                const isActive = i === cursor;
                return (
                  <button
                    key={it.id}
                    onClick={it.action}
                    onMouseEnter={() => setCursor(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '7px 14px',
                      textAlign: 'left', fontSize: 13,
                      color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                      background: isActive ? 'var(--paper-deep)' : 'transparent',
                    }}
                  >
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.kbd && (
                      <kbd style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        padding: '1px 5px',
                        color: 'var(--ink-faded)',
                        background: 'var(--paper-soft)',
                        border: '0.5px solid var(--rule)',
                        borderRadius: 3,
                      }}>{it.kbd}</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div style={{
              padding: 20, color: 'var(--ink-faded)',
              fontSize: 12, fontStyle: 'italic', textAlign: 'center',
            }}>No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
