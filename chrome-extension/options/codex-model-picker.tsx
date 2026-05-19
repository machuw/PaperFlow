// chrome-extension/options/codex-model-picker.tsx
//
// Slice 2 #24 — MODEL <select> for the openai-codex BYOK preset. Reads the
// live model list from chrome.storage.local['codex_available_models'] (kept
// in sync by codex-auth's loginPoll + getValidAccessToken refresh per
// ADR-0002). Renders nothing if no list is present so it can be placed
// unconditionally in the Options form.

import { useEffect, useRef, useState } from 'react';
import { getItem } from '../reader/lib/storage-schema';
import { t } from '../reader/lib/i18n';

interface Props {
  value:    string;
  onChange: (model: string) => void;
}

export function CodexModelPicker({ value, onChange }: Props) {
  const [models, setModels] = useState<string[] | null>(null);

  useEffect(() => {
    let mounted = true;
    // PR #29 review fix MED-A: subscribe BEFORE awaiting getItem so a fast
    // onChanged tick during the initial hydrate isn't lost. The two paths
    // race to populate `models`; the listener wins because the getItem
    // resolution is gated through a functional setState that only writes
    // when state is still `null` (i.e. the listener hasn't already
    // observed a fresh value).
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const handler = (
        changes: { [key: string]: chrome.storage.StorageChange },
        area: string,
      ) => {
        if (area !== 'local' || !changes.codex_available_models) return;
        setModels((changes.codex_available_models.newValue as string[] | undefined) ?? null);
      };
      chrome.storage.onChanged.addListener(handler);
      void getItem('codex_available_models').then((m) => {
        if (!mounted) return;
        // Only seed from the initial read if the listener hasn't already
        // populated a fresh value — otherwise we'd clobber it with the
        // stale value getItem captured before the onChanged fire.
        setModels((prev) => (prev === null ? m ?? null : prev));
      });
      return () => {
        mounted = false;
        chrome.storage.onChanged.removeListener(handler);
      };
    }

    // Non-extension context (e.g. unit tests without a chrome shim) —
    // just hydrate once.
    void getItem('codex_available_models').then((m) => {
      if (mounted) setModels(m ?? null);
    });
    return () => { mounted = false; };
  }, []);

  // PR #29 review fix MED-B + re-review: silently auto-correct `value` to
  // models[0] when the stored model id is missing from (or absent in) the
  // live list. Without this the native <select> displays the first option
  // visually but the controlled `value` prop keeps the stale (or empty) id
  // — Save would persist an invisible mismatch. Sibling to Slice 3 #25's
  // storage-side reconcile; covers the window before that fires AND the
  // multi-config case where an inactive config opens with a stale value.
  //
  // PR #29 re-review CRITICAL: parent (main.tsx) passes an inline arrow
  // for onChange, so its identity changes every parent render. Capture the
  // latest onChange in a ref and keep it OUT of the effect's deps — that
  // way only [models, value] drive the self-heal and parent re-renders
  // alone can't re-trigger it.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => {
    if (!models || models.length === 0) return;
    if (!models.includes(value)) onChangeRef.current(models[0]);
  }, [models, value]);

  if (!models || models.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: 'block',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-faded)',
          marginBottom: 5,
        }}
      >
        {t('options.byok-configs.field.model.label')}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          background: 'var(--paper)',
          color: 'var(--ink)',
          border: '0.5px solid var(--rule)',
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          outline: 'none',
        }}
      >
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}
