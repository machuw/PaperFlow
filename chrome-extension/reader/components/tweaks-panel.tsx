import { useEffect, useRef } from 'react';
import type { Tweaks } from '../types';
import { I } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
}

export function TweaksPanel({ open, onClose, tweaks, setTweak }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // mousedown (not click) — fires before the trigger button's click handler,
    // so toggling the gear icon won't first close-then-reopen the panel. We
    // exclude the trigger by its `title="Tweaks"` (stable; defined in top-bar.tsx).
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || !rootRef.current) return;
      if (rootRef.current.contains(target)) return;
      if (target.closest('[title="Tweaks"]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={rootRef} style={{
      position: 'absolute', top: 50, right: 10, zIndex: 150,
      width: 260,
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      boxShadow: 'var(--shadow-2)',
      padding: '14px 16px',
      animation: 'fade-up 140ms',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Tweaks</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          className="icon-btn"
          style={{ width: 22, height: 22 }}
        ><I.Close size={11} /></button>
      </div>

      <Row label="Reading font">
        <Seg
          value={tweaks.readerFont}
          onChange={(v) => setTweak('readerFont', v as 'serif' | 'sans')}
          options={[{ id: 'serif', label: 'Serif' }, { id: 'sans', label: 'Sans' }]}
        />
      </Row>

      <Row label="Page width">
        <input
          type="range" min={560} max={900} step={20}
          value={tweaks.pageWidth}
          onChange={(e) => setTweak('pageWidth', +e.target.value)}
          style={{ width: '100%', accentColor: 'var(--walnut)' }}
        />
      </Row>

      <Row label="Margin notes">
        <Seg
          value={tweaks.margins ? 'on' : 'off'}
          onChange={(v) => setTweak('margins', v === 'on')}
          options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
        />
      </Row>

      <Row label="Paper grain">
        <Seg
          value={tweaks.grain ? 'on' : 'off'}
          onChange={(v) => setTweak('grain', v === 'on')}
          options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--ink-faded)', marginBottom: 5,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Seg({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }> }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4, padding: 1.5,
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 3,
            color: value === o.id ? 'var(--ink)' : 'var(--ink-faded)',
            background: value === o.id ? 'var(--paper)' : 'transparent',
            fontWeight: value === o.id ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
