import { useEffect, useState } from 'react';
import type { ToastConfig } from '../lib/toast-helpers';

/**
 * Single-slot toast. Two paths:
 *   - setToast(string) — legacy direct call, 2600ms auto-dismiss
 *   - pf-show-toast CustomEvent — action toasts with optional handler button
 */
type ToastState =
  | { kind: 'message'; message: string; nonce: number }
  | { kind: 'action'; message: string; action: NonNullable<ToastConfig['action']>; timeoutMs: number; nonce: number };

let handle: ((s: ToastState) => void) | null = null;
let counter = 0;

export function setToast(message: string) {
  counter += 1;
  if (handle) handle({ kind: 'message', message, nonce: counter });
}

/** Show a toast with an optional action button. durationMs defaults to 5000. */
export function showUndoToast({ text, onUndo, durationMs = 5000 }: {
  text: string;
  onUndo: () => void;
  durationMs?: number;
}) {
  counter += 1;
  if (handle) {
    handle({
      kind: 'action',
      message: text,
      action: { label: 'Undo', handler: onUndo },
      timeoutMs: durationMs,
      nonce: counter,
    });
  }
}

export function ToastHost() {
  const [state, setState] = useState<ToastState | null>(null);

  // Legacy direct-call path
  useEffect(() => {
    handle = setState;
    return () => { handle = null; };
  }, []);

  // Event-driven toast path (action-aware: degrades to plain 'message'
  // kind when the caller doesn't supply an action button — without the
  // narrow, the renderer would read `state.action.label` on undefined and
  // crash. Phase 27 NAV-01 is the first caller exercising the no-action
  // form; previously this path only fired for undo-style affordances).
  useEffect(() => {
    function onShowToast(e: Event) {
      const { message, action, timeoutMs } = (e as CustomEvent<ToastConfig>).detail;
      counter += 1;
      if (action) {
        setState({
          kind: 'action',
          message,
          action,
          timeoutMs: timeoutMs ?? 5000,
          nonce: counter,
        });
      } else {
        setState({ kind: 'message', message, nonce: counter });
      }
    }
    window.addEventListener('pf-show-toast', onShowToast);
    return () => window.removeEventListener('pf-show-toast', onShowToast);
  }, []);

  // Auto-dismiss — timeout depends on toast kind
  useEffect(() => {
    if (!state) return;
    const ms = state.kind === 'action' ? state.timeoutMs : 2600;
    const t = setTimeout(() => setState(null), ms);
    return () => clearTimeout(t);
  }, [state?.nonce]);

  if (!state) return null;

  const sharedStyle: React.CSSProperties = {
    position: 'fixed', bottom: 34, left: '50%', transform: 'translateX(-50%)',
    padding: '8px 14px',
    background: 'var(--paper-soft)',
    border: '0.5px solid var(--rule)',
    borderRadius: 6,
    boxShadow: 'var(--shadow-2)',
    fontSize: 12, fontFamily: 'var(--font-sans)',
    color: 'var(--ink)',
    zIndex: 400,
    animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
    display: 'flex', alignItems: 'center', gap: 10,
  };

  return (
    <div key={state.nonce} role="status" style={sharedStyle}>
      <span>{state.message}</span>
      {state.kind === 'action' && (
        <button
          onClick={() => {
            state.action.handler();
            setState(null);
          }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
            fontSize: 12, fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--walnut)', fontWeight: 600,
          }}
        >
          {state.action.label}
        </button>
      )}
    </div>
  );
}
