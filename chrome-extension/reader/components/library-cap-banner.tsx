// chrome-extension/reader/components/library-cap-banner.tsx
//
// Phase F · Task F1 — Free-tier library cap banner.
// Spec §6.5 / §14.1.2. Mounts at the top of LibraryDrawer.
//
// Visibility rules:
//   - Only for authenticated users on tier === 'free'.
//   - Paper count in cloud >= FREE_LIBRARY_CAP (free-tier cross-device sync cap).
//   - User has not dismissed it (libraryCapBannerDismissed timestamp unset).
//
// Dismiss stamps the dismiss timestamp. enqueueLibraryRowSync clears the
// dismiss timestamp when it skips a cloud sync because of the cap, so the
// banner reappears the next time LibraryDrawer mounts.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getItem, setItem } from '../lib/storage-schema';
import { FREE_LIBRARY_CAP } from '../lib/constants';
import { t, useT } from '../lib/i18n';
import '../styles/library-cap-banner.css';

export function LibraryCapBanner({ onUpgrade }: { onUpgrade: () => void }) {
  useT();  // re-render on locale change
  const [visible, setVisible] = useState(false);
  const [paperCount, setPaperCount] = useState(0);

  useEffect(() => {
    void (async () => {
      // .maybeSingle() — fresh users have no subscriptions row; .single()
      // would error on 0 rows. Matches the Phase D/E convention.
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('tier')
        .maybeSingle();
      if (sub?.tier !== 'free') return;
      const { count } = await supabase
        .from('papers')
        .select('*', { count: 'exact', head: true });
      const n = count ?? 0;
      if (n < FREE_LIBRARY_CAP) return;
      const dismissed = await getItem('libraryCapBannerDismissed');
      if (dismissed) return;
      setPaperCount(n);
      setVisible(true);
    })();
  }, []);

  async function dismiss() {
    await setItem('libraryCapBannerDismissed', Date.now());
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <div className="library-cap-banner" role="alert">
      <div className="library-cap-banner-text">
        <strong>{t('libraryCap.text', { used: paperCount, limit: FREE_LIBRARY_CAP })}</strong>
        <div className="library-cap-banner-hint">{t('libraryCap.hint')}</div>
      </div>
      <button onClick={onUpgrade} className="library-cap-banner-upgrade">
        {t('libraryCap.upgrade')}
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="library-cap-banner-dismiss">
        ×
      </button>
    </div>
  );
}
