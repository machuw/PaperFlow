import { useEffect, useRef } from 'react';
import { trapFocus } from '../lib/focus-trap';
import '../styles/conflict-modal.css';

interface Props {
  open: boolean;
  title: string;
  body: string | React.ReactNode;
  dangerLabel: string;
  inFlight?: boolean;
  inlineError?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, body, dangerLabel, inFlight, inlineError, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  useEffect(() => { if (open && panelRef.current) return trapFocus(panelRef.current); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !inFlight) onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, inFlight, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="conflict-modal-backdrop"
      onClick={(e) => { if (!inFlight && e.target === e.currentTarget) onCancel(); }}
    >
      <div ref={panelRef} className="conflict-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="conflict-modal-title">{title}</h2>
        <div className="conflict-modal-stats">{body}</div>
        {inlineError && <div style={{ color: 'var(--foxglove)', fontSize: 12, padding: '4px 0' }}>{inlineError}</div>}
        <div className="conflict-modal-secondary-actions">
          <button ref={cancelRef} onClick={onCancel} className="conflict-modal-primary">Cancel</button>
          <button onClick={onConfirm} disabled={inFlight} className="conflict-modal-destructive">
            {inFlight ? 'Deleting…' : dangerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
