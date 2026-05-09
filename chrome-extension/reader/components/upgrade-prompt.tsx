import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { trapFocus } from '../lib/focus-trap';
import { FREE_LIBRARY_CAP } from '../lib/constants';
import { t, useT } from '../lib/i18n';
import '../styles/upgrade-prompt.css';

/**
 * UpgradePrompt — paid-tier CTA modal (spec §6.5, §14.1.2).
 *
 * Opened by a `window.dispatchEvent(new CustomEvent('open-upgrade-prompt',
 * { detail: { trigger } }))` from the AI router when the user hits a quota
 * or library cap. Three triggers produce three different headlines:
 *
 *   - `trial`    — 20 free AI trials used up
 *   - `monthly`  — Pro's 30000 hosted-AI calls/mo exhausted
 *   - `library`  — free Library sync cap hit (FREE_LIBRARY_CAP papers cloud-resident)
 *
 * Tier choice invokes the `create-checkout-session` Supabase edge function
 * and opens the Stripe URL in a new tab. On error we keep the modal open
 * (no toast here — callers decide how to surface recovery).
 */
export type UpgradeTrigger = 'trial' | 'monthly' | 'library';

export function UpgradePrompt({ trigger, onClose }: { trigger: UpgradeTrigger; onClose: () => void }) {
  useT();  // re-render on locale change
  const firstBtn = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { firstBtn.current?.focus(); }, []);
  useEffect(() => {
    if (!panelRef.current) return;
    return trapFocus(panelRef.current);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function choose(tier: 'sync' | 'pro') {
    const { data, error } = await supabase.functions.invoke<{ url?: string }>(
      'create-checkout-session',
      { body: { tier } },
    );
    if (error || !data?.url) {
      console.warn('upgrade checkout failed', error);
      return;
    }
    chrome.tabs.create({ url: data.url });
    onClose();
  }

  const headline =
    trigger === 'trial'   ? t('upgrade.headline.trial')   :
    trigger === 'monthly' ? t('upgrade.headline.monthly') :
                            t('upgrade.headline.library', { limit: FREE_LIBRARY_CAP });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
      className="upgrade-prompt-backdrop"
      onClick={onClose}
    >
      <div ref={panelRef} className="upgrade-prompt-panel" onClick={(e) => e.stopPropagation()}>

        <div className="upgrade-prompt-label">{t('upgrade.label.freeTrialExhausted')}</div>

        <h2 id="upgrade-title" className="upgrade-prompt-headline">{headline}</h2>
        <p className="upgrade-prompt-subhead">{t('upgrade.subheadline')}</p>

        <div className="upgrade-prompt-tier-cards">

          <div className="upgrade-prompt-tier-card upgrade-prompt-tier-card--free">
            <div className="upgrade-prompt-tier-name">{t('upgrade.free.name')}</div>
            <div className="upgrade-prompt-tier-price">{t('upgrade.free.price')}</div>
            <p>{t('upgrade.free.features', { limit: FREE_LIBRARY_CAP })}</p>
            <button
              ref={firstBtn}
              onClick={() => { chrome.runtime.openOptionsPage(); onClose(); }}
              className="upgrade-prompt-tier-cta"
            >
              {t('upgrade.free.cta')}
            </button>
          </div>

          <div className="upgrade-prompt-tier-card">
            <div className="upgrade-prompt-tier-name">{t('upgrade.sync.name')}</div>
            <div className="upgrade-prompt-tier-price">{t('upgrade.sync.price')}</div>
            <p>{t('upgrade.sync.features')}</p>
            <button
              onClick={() => choose('sync')}
              className="upgrade-prompt-tier-cta"
            >
              {t('upgrade.sync.cta')}
            </button>
          </div>

          <div className="upgrade-prompt-tier-card upgrade-prompt-tier-card--recommended">
            <div className="upgrade-prompt-recommended-badge">{t('upgrade.pro.recommended')}</div>
            <div className="upgrade-prompt-tier-name">{t('upgrade.pro.name')}</div>
            <div className="upgrade-prompt-tier-price">{t('upgrade.pro.price')}</div>
            <p>{t('upgrade.pro.features')}</p>
            <button
              onClick={() => choose('pro')}
              className="upgrade-prompt-tier-cta upgrade-prompt-tier-cta--primary"
            >
              {t('upgrade.pro.cta')}
            </button>
          </div>

        </div>

        <div className="upgrade-prompt-diff-row">{t('upgrade.diff')}</div>

        <div className="upgrade-prompt-footer">
          <a
            href="#"
            role="button"
            onClick={(e) => { e.preventDefault(); onClose(); }}
            className="upgrade-prompt-footer-link"
          >
            {t('upgrade.later')}
          </a>
        </div>

      </div>
    </div>
  );
}
