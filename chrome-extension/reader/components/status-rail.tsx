import { useEffect, useState } from 'react';
import { getConfig } from '../lib/storage';
import type { AiConfig } from '../types';

interface Props {
  /** Hidden in Canvas variant (§8.1). */
  hidden: boolean;
}

export function StatusRail({ hidden }: Props) {
  const [config, setConfig] = useState<AiConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      // Phase 17: v1.1 keys (config_apikey / config_prefs) retired — listener
      // watches only Phase 12+13 multi-config keys plus config_outputLanguage.
      if (
        !('config_outputLanguage' in changes) &&
        !('config_byok_configs' in changes) &&
        !('config_apikeys' in changes) &&
        !('config_active_byok_config_id' in changes)
      ) return;
      getConfig().then((c) => {
        if (!cancelled) setConfig(c);
      });
    };
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  if (hidden) return null;

  // All three fields must be present for AI calls to work (§3.8).
  // apiKey-only was a green dot that mis-signaled readiness when the user had
  // direct-written storage bypassing Options validation.
  const configured = !!(config?.apiKey && config?.baseURL && config?.model);
  const dot = configured ? 'var(--forest)' : 'var(--foxglove)';
  const modelText = config?.model || 'not configured';
  // Routing label mirrors callAI: presence of apiKey is the BYOK switch
  // (callAI: `if (apiKey) return streamBYOK(...)`). Without an apiKey we
  // route to the managed proxy regardless of session state — the dot color
  // already signals whether that route can actually serve a request.
  const modeText = config?.apiKey ? 'BYOK' : 'Managed';

  return (
    <div style={{
      height: 24, flexShrink: 0,
      background: 'var(--paper)',
      borderTop: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 16,
      fontSize: 10, fontFamily: 'var(--font-mono)',
      color: 'var(--ink-faded)',
    }}>
      <span>⌘K commands</span>
      <span>⌘\ outline</span>
      <span>⌘⇧\ chat</span>
      <span>⌘L library</span>
      <span>E·S·T·H on selection</span>
      <div style={{ flex: 1 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: dot }} />
        local memory · {modelText} · {modeText}
      </span>
    </div>
  );
}
