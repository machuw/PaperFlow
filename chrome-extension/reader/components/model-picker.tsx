/**
 * Phase 19 (PICKER-01..09 + A11Y-01..05): unified model picker popover.
 *
 * Three-section render — system models (managed, tier-gated) / BYOK configs
 * (local) / bottom CTAs (+ new / manage). Driven by Phase 18 hooks:
 *   - useActiveModel() — discriminated union for active row indicator
 *   - useManagedModels() — {models} surface, auth-gated, Realtime-aware
 *   - listBYOKConfigs() + subscribeByokConfigsRealtime() — local BYOK list
 *   - byokHealthCache (read-only) — health dot per BYOK row
 *
 * Mutex writes go through setActiveModel() — never setItem directly
 * (MUTEX-02 grep guard). All select handlers wrap in try/catch (T-19-02).
 *
 * 19-02 a11y refinements:
 *   - A11Y-01 ARIA roles: chip aria-haspopup=menu + aria-expanded; panel
 *     role=menu; rows role=menuitemradio + aria-checked + aria-disabled (locked)
 *   - A11Y-02 roving tabindex: a single highlightedIndex drives tabIndex={0|-1}
 *     across the flat focusables array
 *   - A11Y-03 flat keyboard model: ArrowDown/Up/Home/End traverse one
 *     contiguous list (system rows non-locked → BYOK rows → bottom CTAs)
 *   - A11Y-04 focus return: closeAndReturnFocus wraps onClose with a
 *     requestAnimationFrame → chipButtonRef.current?.focus() so screen-reader
 *     virtual-cursor + keyboard users land back on the chip after Esc/select
 *   - A11Y-05 focus trap: existing trapFocus from 19-01 stays; the bottom
 *     CTA buttons are unconditionally rendered → focusable floor (T-19-09)
 *
 * 8 anti-features red lines: see FEATURES.md AF-1..AF-8. (List intentionally
 * not repeated here verbatim so grep audits stay clean — features absent by
 * construction; see Plan 19-01 §eight_anti_features_redlines.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useFloating, flip, shift, autoUpdate, type Placement } from '@floating-ui/react-dom';
import { setActiveModel } from '../lib/active-model';
import { useActiveModel } from '../lib/use-active-model';
import { useManagedModels } from '../lib/use-managed-models';
import {
  listBYOKConfigs,
  subscribeByokConfigsRealtime,
  type BYOKConfigClientView,
} from '../lib/byok-configs';
import {
  checkBYOKHealth,
  isLocalhostURL,
  persistByokHealth,
  type HealthResult,
} from '../lib/byok-health-check';
import { getItem } from '../lib/storage-schema';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { trapFocus } from '../lib/focus-trap';
import { I } from './icons';

// Mirror byok-chip.tsx:39-54 cacheToHealthMap helper — moved from byok-chip
// to ModelPicker so the popover owns the probe lifecycle.
type CacheEntry = { ts: number; healthy: boolean; modelCount?: number; reason?: string };
type HealthMap = Record<string, HealthResult>;

function cacheToHealthMap(cache: Record<string, CacheEntry> | null | undefined): HealthMap {
  const out: HealthMap = {};
  if (!cache) return out;
  for (const [id, entry] of Object.entries(cache)) {
    if (entry.healthy) {
      out[id] = { status: 'healthy', modelCount: entry.modelCount ?? 0 };
    } else {
      out[id] = { status: 'unreachable', error: entry.reason ?? 'unknown' };
    }
  }
  return out;
}

export interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  /**
   * 19-02 A11Y-04: chip button ref so closeAndReturnFocus can RAF the
   * focus back to the chip after the popover closes (Esc / select / outside-click).
   */
  chipButtonRef?: RefObject<HTMLButtonElement | null>;
}

// 19-02 A11Y-03 flat focusables — discriminated union mirrors the row source.
type FocusableItem =
  | { kind: 'managed'; id: string }
  | { kind: 'byok'; id: string }
  | { kind: 'cta'; id: 'new' | 'manage' };

export function ModelPicker({ open, onClose, anchor, chipButtonRef }: ModelPickerProps) {
  const t = useT();
  const active = useActiveModel();
  const { models } = useManagedModels();

  const [byokConfigs, setByokConfigs] = useState<BYOKConfigClientView[]>([]);
  const [healthMap, setHealthMap] = useState<HealthMap>({});
  const [hasSession, setHasSession] = useState<boolean | null>(null); // null = not yet checked

  const panelRef = useRef<HTMLDivElement | null>(null);

  // 19-02 A11Y-02 roving tabindex + A11Y-03 flat keyboard model
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Floating UI shell — verbatim from library-popover.tsx:19-23 BUT placement bottom-end
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end' as Placement, // D-CD-01
    middleware: [flip(), shift({ padding: 8 })], // VERBATIM order (T-19-03)
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (anchor) refs.setReference(anchor);
  }, [anchor, refs]);

  // Focus trap — only when open. Mirror library-popover.tsx:25 but gated on open.
  // 19-02: trapFocus selector matches `button` regardless of tabIndex, so even
  // when roving tabindex marks rows tabIndex=-1, the bottom CTA buttons satisfy
  // the focus-trap floor (T-19-09 mitigation).
  useEffect(() => {
    if (!open || !panelRef.current) return;
    return trapFocus(panelRef.current);
  }, [open]);

  // Auth gate — drives signed-out empty state (D-B7 + PICKER-08).
  useEffect(() => {
    void (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const tokenKey = Object.keys(all).find(
          (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
        );
        setHasSession(!!tokenKey);
      } catch {
        setHasSession(false);
      }
    })();
    const { data: authListener } = supabase.auth.onAuthStateChange((_evt, session) => {
      setHasSession(!!session);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // BYOK list + health cache — moved from byok-chip.tsx:69-104.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listBYOKConfigs();
      if (cancelled) return;
      setByokConfigs(list);
      const cache = await getItem('byokHealthCache');
      if (cancelled) return;
      setHealthMap(cacheToHealthMap(cache));
    })();
    const unsubConfigs = subscribeByokConfigsRealtime((fresh) => setByokConfigs(fresh));
    const onHealthChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== 'local') return;
      if (!('byokHealthCache' in changes)) return;
      const next = changes.byokHealthCache?.newValue as Record<string, CacheEntry> | undefined;
      setHealthMap(cacheToHealthMap(next));
    };
    chrome.storage.onChanged.addListener(onHealthChange);
    return () => {
      cancelled = true;
      unsubConfigs();
      chrome.storage.onChanged.removeListener(onHealthChange);
    };
  }, []);

  // Open-time re-probe of all localhost configs — mirror byok-chip.tsx:117-124
  useEffect(() => {
    if (!open) return;
    for (const c of byokConfigs) {
      if (!isLocalhostURL(c.base_url)) continue;
      void checkBYOKHealth(c.base_url).then((r) => persistByokHealth(c.id, r));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 19-02 A11Y-03 flat focusables array — single indexed list spans:
  //   1. Managed rows that are NOT locked (signed-in only). Locked rows are
  //      skipped from arrow-key nav; the locked row's Upgrade button remains
  //      Tab-reachable as a sibling button (D-B1 exception).
  //   2. BYOK config rows.
  //   3. Bottom `+ new config` CTA (always rendered → T-19-09 floor).
  //   4. Bottom `manage` CTA (always rendered → T-19-09 floor).
  // T-19-09 invariant: list.length >= 2 always (the two CTAs are unconditional).
  const focusables = useMemo<FocusableItem[]>(() => {
    const list: FocusableItem[] = [];
    if (hasSession === true) {
      for (const m of models) {
        if (!m.locked) list.push({ kind: 'managed', id: m.id });
      }
    }
    for (const c of byokConfigs) list.push({ kind: 'byok', id: c.id });
    list.push({ kind: 'cta', id: 'new' });
    list.push({ kind: 'cta', id: 'manage' });
    return list;
  }, [hasSession, models, byokConfigs]);

  // 19-02 A11Y-04: closeAndReturnFocus wraps onClose with RAF focus-return to
  // the chip button. Used by Esc + select handlers + bottom-CTA handlers.
  const closeAndReturnFocus = useCallback(() => {
    onClose();
    requestAnimationFrame(() => {
      chipButtonRef?.current?.focus();
    });
  }, [onClose, chipButtonRef]);

  // Esc-to-close — refined to call closeAndReturnFocus (A11Y-04).
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, closeAndReturnFocus]);

  // 19-02: initial focus on open — jump to active row if it's in the focusables
  // array, else index 0. RAF-defer the .focus() call so the panel is mounted.
  useEffect(() => {
    if (!open) return;
    let initial = 0;
    if (active.kind === 'managed') {
      const i = focusables.findIndex((f) => f.kind === 'managed' && f.id === active.id);
      if (i >= 0) initial = i;
    } else if (active.kind === 'byok') {
      const i = focusables.findIndex((f) => f.kind === 'byok' && f.id === active.id);
      if (i >= 0) initial = i;
    }
    setHighlightedIndex(initial);
    requestAnimationFrame(() => itemRefs.current[initial]?.focus());
    // intentionally not depending on focusables/active — only on the open transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSelectManaged(id: string) {
    try {
      await setActiveModel({ kind: 'managed', id });
      closeAndReturnFocus(); // D-B1 0ms sync close + A11Y-04 focus return
    } catch (e) {
      // T-19-02 — invalid id throws from setActiveModel D-A1.1; do not close so user retries
      // eslint-disable-next-line no-console
      console.error('[ModelPicker] setActiveModel managed failed', e);
    }
  }

  async function onSelectBYOK(id: string) {
    try {
      await setActiveModel({ kind: 'byok', id });
      closeAndReturnFocus();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ModelPicker] setActiveModel byok failed', e);
    }
  }

  async function onUpgrade() {
    // PICKER-07 — verbatim from options/main.tsx:563-572. Does NOT call onClose
    // (D-B1 exception — user is mid-upgrade-flow, popover stays for context).
    const { data, error } = await supabase.functions.invoke<{ url?: string }>(
      'create-checkout-session',
      { body: { tier: 'pro' } },
    );
    if (error || !data?.url) {
      // eslint-disable-next-line no-console
      console.warn('[ModelPicker] upgrade checkout failed', error);
      return;
    }
    chrome.tabs.create({ url: data.url });
  }

  function onNewConfigClick() {
    closeAndReturnFocus();
    const url = chrome.runtime.getURL('options/index.html#new-byok-config');
    const opened = window.open(url);
    if (!opened && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  }

  function onManageClick() {
    closeAndReturnFocus();
    // D-B2 NEW deep-link
    const url = chrome.runtime.getURL('options/index.html#manage-byok-configs');
    const opened = window.open(url);
    if (!opened && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  }

  // 19-02 A11Y-03: panel-level keyboard handler drives the flat focusables array.
  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const n = focusables.length;
    if (n === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (highlightedIndex + 1) % n;
      setHighlightedIndex(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (highlightedIndex - 1 + n) % n;
      setHighlightedIndex(prev);
      itemRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlightedIndex(0);
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlightedIndex(n - 1);
      itemRefs.current[n - 1]?.focus();
    }
  }

  if (!open) return null;

  // Section visibility logic — D-B7 detailed empty-state matrix
  const showSystemSection = hasSession === true; // signed-in: render system rows or locked
  const showSignedOutPrompt = hasSession === false; // signed-out: short login-prompt at top

  // 19-02: precompute focusable indices for bottom CTAs (always present).
  const newIdx = focusables.findIndex((f) => f.kind === 'cta' && f.id === 'new');
  const manageIdx = focusables.findIndex((f) => f.kind === 'cta' && f.id === 'manage');

  return (
    <div
      ref={(el) => {
        refs.setFloating(el);
        panelRef.current = el;
      }}
      style={{
        ...floatingStyles,
        width: 320, // PICKER-06 — fixed width (was maxWidth, smoke 2026-05-06 found it collapsed when content sparse, killing CTA space-between spacing)
        background: 'var(--paper)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-2)',
        zIndex: 300, // < LoginModal z-index (T-19-05)
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 520, // D-B3 total cap
      }}
      role="menu" // A11Y-01
      aria-label={t('topbar.model-picker.aria.menu')}
      onKeyDown={onPanelKeyDown}
    >
      {/* ── Section 1: System models ───────────────────────────────────── */}
      {showSignedOutPrompt && (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-faded)', lineHeight: 1.5 }}>
            {t('topbar.model-picker.system.login-prompt')}
          </div>
        </div>
      )}
      {showSystemSection && (
        <div style={{ padding: '12px 14px' }}>
          <h3
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-faded)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              margin: 0,
              marginBottom: 8,
            }}
          >
            {t('topbar.model-picker.system.heading')}
          </h3>
          {models.map((m) => {
            const isActive = active.kind === 'managed' && active.id === m.id;
            // 19-02 A11Y-02: locked rows are NOT in focusables → idx === -1.
            // Non-locked rows get a roving tabIndex driven by highlightedIndex.
            const idx = focusables.findIndex(
              (f) => f.kind === 'managed' && f.id === m.id,
            );
            const isHighlighted = idx >= 0 && highlightedIndex === idx;
            // Verbatim adapt from options/main.tsx:573-614 row JSX
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  marginBottom: 6,
                  background: 'var(--paper-soft)',
                  border: '0.5px solid var(--rule-soft)',
                  borderLeft: isActive
                    ? '2px solid var(--forest)' // D-B4 visual layer
                    : '0.5px solid var(--rule-soft)',
                  borderRadius: 6,
                  opacity: m.locked ? 0.55 : 1,
                  cursor: m.locked ? 'default' : 'pointer',
                }}
                role="menuitemradio"
                aria-checked={isActive}
                aria-disabled={m.locked || undefined} // A11Y-01 refined
                tabIndex={isHighlighted ? 0 : -1} // A11Y-02 roving tabindex
                ref={(el) => {
                  if (idx >= 0) itemRefs.current[idx] = el;
                }}
                onClick={() => {
                  if (!m.locked) void onSelectManaged(m.id);
                }}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !m.locked) {
                    e.preventDefault();
                    void onSelectManaged(m.id);
                  }
                }}
              >
                <input
                  type="radio"
                  name="active-managed"
                  checked={isActive}
                  readOnly // outer div handles click
                  disabled={m.locked}
                  style={{ pointerEvents: 'none' }}
                  aria-hidden="true"
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={m.display_name}
                  >
                    {m.display_name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-faded)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={m.id}
                  >
                    {m.id}
                  </div>
                </div>
                {m.locked && (
                  // Smoke fix 2026-05-06: removed standalone Pro badge (redundant
                  // with Upgrade CTA + opacity 0.55 already conveys locked state);
                  // Upgrade button compacted to text-link style matching popover
                  // footer CTA aesthetic (was dark filled `var(--ink)` button that
                  // overpowered the row in 320px popover).
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onUpgrade();
                    }}
                    style={{
                      padding: '2px 6px',
                      fontSize: 11,
                      background: 'transparent',
                      color: 'var(--walnut)',
                      border: '0.5px solid var(--walnut)',
                      borderRadius: 'var(--r-sm, 4px)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {t('topbar.model-picker.system.locked-upgrade-cta')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Hairline divider 1 (PICKER-02 / DF-4) ─────────────────────── */}
      <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />

      {/* ── Section 2: BYOK configs (max-height: 280px scroll, D-B3) ──── */}
      <div
        role="region"
        aria-label={t('topbar.model-picker.byok.region-label')} // D-B3.2
        style={{ padding: '12px 14px', maxHeight: 280, overflowY: 'auto' }}
      >
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-faded)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            margin: 0,
            marginBottom: 8,
          }}
        >
          {t('topbar.model-picker.byok.heading')}
        </h3>

        {byokConfigs.length === 0 ? (
          <div
            style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-faded)', padding: '6px 0' }}
          >
            {hasSession === false
              ? t('topbar.model-picker.byok.signed-out-hint')
              : t('topbar.model-picker.byok.empty')}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} role="none">
            {byokConfigs.map((c) => {
              const isActive = active.kind === 'byok' && active.id === c.id;
              const h = healthMap[c.id];
              const showRowDot =
                isLocalhostURL(c.base_url) &&
                (h?.status === 'healthy' || h?.status === 'unreachable');
              const idx = focusables.findIndex(
                (f) => f.kind === 'byok' && f.id === c.id,
              );
              const isHighlighted = idx >= 0 && highlightedIndex === idx;
              return (
                <li
                  key={c.id}
                  role="menuitemradio"
                  aria-checked={isActive}
                  tabIndex={isHighlighted ? 0 : -1} // A11Y-02 roving tabindex
                  ref={(el) => {
                    if (idx >= 0) itemRefs.current[idx] = el;
                  }}
                  className="byok-popover-row"
                  onClick={() => void onSelectBYOK(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      void onSelectBYOK(c.id);
                    }
                  }}
                >
                  <span className="byok-popover-row-radio" aria-hidden="true" />
                  <span className="byok-popover-row-meta">
                    <span className="byok-popover-row-name">{c.name}</span>
                    <span className="byok-popover-row-detail">
                      {c.base_url} · {c.model}
                    </span>
                  </span>
                  {showRowDot && (
                    <span
                      className="byok-popover-row-dot"
                      data-health={h!.status === 'healthy' ? 'healthy' : 'unreachable'}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Hairline divider 2 (PICKER-02 / DF-4) ─────────────────────── */}
      <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />

      {/* ── Section 3: Bottom CTA footer — text-link style (D-B6 revised 2026-05-06 smoke fix) ───
          Original grid 1fr 1fr bordered buttons looked too heavy / boxy for
          PaperFlow warm-paper aesthetic (smoke screenshot showed text wrapping
          + visual noise vs popover's elegant rows). Replaced with footer-style
          text links: no borders, faded ink color, hover → underline + full ink.
          T-19-09 floor preserved: 2 buttons unconditionally rendered so
          focusables.length >= 2 always holds. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
        }}
      >
        <button
          type="button"
          onClick={onNewConfigClick}
          tabIndex={highlightedIndex === newIdx ? 0 : -1} // A11Y-02 roving tabindex
          ref={(el) => {
            if (newIdx >= 0) itemRefs.current[newIdx] = el;
          }}
          style={ctaLinkStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--ink)';
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-faded)';
            e.currentTarget.style.textDecoration = 'none';
          }}
        >
          {t('topbar.model-picker.cta.new-config')}
        </button>
        <button
          type="button"
          onClick={onManageClick}
          tabIndex={highlightedIndex === manageIdx ? 0 : -1} // A11Y-02 roving tabindex
          ref={(el) => {
            if (manageIdx >= 0) itemRefs.current[manageIdx] = el;
          }}
          style={ctaLinkStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--ink)';
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-faded)';
            e.currentTarget.style.textDecoration = 'none';
          }}
        >
          {t('topbar.model-picker.cta.manage')}
          <I.ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

// Footer text-link style (D-B6 revised 2026-05-06 smoke fix; replaces
// previous ctaButtonStyle bordered button design that looked too heavy
// for PaperFlow warm-paper aesthetic).
const ctaLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: 0,
  fontSize: 12,
  background: 'transparent',
  color: 'var(--ink-faded)',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};
