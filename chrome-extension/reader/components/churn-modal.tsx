import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getItem, setItem } from '../lib/storage-schema';
import { trapFocus } from '../lib/focus-trap';
import { t, useT } from '../lib/i18n';
import '../styles/churn-modal.css';

/**
 * ChurnModal — one-shot Pro→Free downgrade notice (spec §14.3.3.1).
 *
 * Self-mounting: on mount, reads `churnModalSeen` from chrome.storage.local
 * and the user's current `subscriptions` row. Shows iff:
 *   - not seen before
 *   - tier === 'free'
 *   - canceled_at is set (Stripe cancel-at-period-end pathway, see E4)
 *   - within 7 days of canceled_at
 *
 * Dismiss sets `churnModalSeen: true` permanently. Restore opens the
 * Stripe Billing Portal via the `create-portal-session` edge function.
 */
export function ChurnModal() {
  useT();  // re-render on locale change
  const [visible, setVisible] = useState(false);
  const restoreBtn = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const seen = await getItem('churnModalSeen');
      if (seen) return;
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('tier, canceled_at')
        .maybeSingle();
      if (sub?.tier !== 'free') return;
      if (!sub.canceled_at) return;
      const daysSince = (Date.now() - new Date(sub.canceled_at).getTime()) / 86400000;
      if (daysSince > 7) return;
      setVisible(true);
    })();
  }, []);

  useEffect(() => {
    if (!visible) return;
    restoreBtn.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible || !panelRef.current) return;
    return trapFocus(panelRef.current);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') void close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [visible]);

  async function close() {
    await setItem('churnModalSeen', true);
    setVisible(false);
  }

  async function restore() {
    await close();
    const { data } = await supabase.functions.invoke<{ url?: string }>('create-portal-session');
    if (data?.url) chrome.tabs.create({ url: data.url });
  }

  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="churn-title"
      className="churn-modal-backdrop"
      onClick={close}
    >
      <div ref={panelRef} className="churn-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 id="churn-title" className="churn-modal-title">{t('churn.headline')}</h2>
        <p className="churn-modal-body">{t('churn.body')}</p>
        <div className="churn-modal-actions">
          <button ref={restoreBtn} className="churn-modal-restore" onClick={restore}>
            {t('churn.restore')}
          </button>
          <button className="churn-modal-later" onClick={close}>
            {t('churn.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
