import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { getConfig } from '../reader/lib/storage';
import { getItem, setItem } from '../reader/lib/storage-schema';
import type { AiConfig } from '../reader/types';
import { EMPTY_AI_CONFIG } from '../reader/types';
import { OUTPUT_LANGUAGES } from '../reader/lib/ai';
import { getLocale, setLocale, useT, detectInitialLocale, type UiLocale } from '../reader/lib/i18n';
// C-4 fix (cross-AI review): module-level static `t` import — required because
// HealthChip is defined at module scope (OUTSIDE OptionsApp closure) and the
// closure variable from `const t = useT()` is not visible there. i18n.ts:2345
// exports a top-level `t` function with identical signature. Inside OptionsApp,
// `const t = useT()` shadows this module binding (React-component pattern);
// both forms call the same underlying translator.
import { t } from '../reader/lib/i18n';
import {
  listBYOKConfigs,
  createBYOKConfig,
  updateBYOKConfig,
  deleteBYOKConfig,
  type BYOKConfigClientView,
} from '../reader/lib/byok-configs';
import { BYOK_PRESETS, applyPreset, type BYOKPresetId } from '../reader/lib/byok-presets';
// Phase 16 D-B1 / D-B2 / D-B3: openai-compatible template chip data + pure
// handler (extracted to its own module for unit testability — see PATTERNS.md
// Section 7.4 + tests/byok-template-chip.test.ts).
import {
  OPENAI_COMPAT_TEMPLATES,
  applyTemplatePure,
  type OpenAICompatTemplate,
} from './openai-compat-templates';
import { checkBYOKHealth, isLocalhostURL, persistByokHealth, type HealthResult } from '../reader/lib/byok-health-check';
// Phase 20 OPT-01 / OPT-02: Options page lifted onto Phase 18 shared hooks.
// useManagedModels owns the 4-effect block (auth gate / mount fetch /
// cache subscriber / Realtime UPDATE) — D-CD-03 retires the duplicate
// subscriptions Realtime channel. setActiveModel replaces direct
// chrome.storage writes (MUTEX-02 single-writer invariant).
// Mirror reader/components/model-picker.tsx:35-37 verbatim.
import { setActiveModel } from '../reader/lib/active-model';
import { useManagedModels } from '../reader/lib/use-managed-models';
import { useActiveModel } from '../reader/lib/use-active-model';
import { supabase } from '../reader/lib/supabase';

function OptionsApp() {
  // useT() subscribes the component to currentLocale changes via
  // useSyncExternalStore. The async storage reconcile (i18n.ts module load)
  // calls notify() if a stored locale differs from the synchronous detect,
  // and that notify drives this component to re-render with the stored value.
  const t = useT();

  const [cfg, setCfg] = useState<AiConfig>(EMPTY_AI_CONFIG);
  const [loaded, setLoaded] = useState(false);

  // [Phase 22 I18N-05] storedUi tracks chrome.storage's config_uiLanguage value
  // for the UI-language dropdown's controlled value. undefined = user is in
  // 'auto' mode (key absent). Hydrated inside the same loaded gate to
  // prevent first-render flicker (Pitfall 3).
  const [storedUi, setStoredUi] = useState<UiLocale | undefined>(undefined);

  // Phase 12 D-D1: BYOK Configs section state.
  const [configs, setConfigs] = useState<BYOKConfigClientView[]>([]);
  const [editing, setEditing] = useState<null | {
    id?: string;  // undefined for new
    name: string;
    preset: BYOKPresetId;
    baseURL: string;
    model: string;
    apiKey: string;
  }>(null);
  const [configsErr, setConfigsErr] = useState<string>('');
  const [configsLoading, setConfigsLoading] = useState(true);

  // Plan 08 (D-C1 / D-C2): cached health-probe result per configId.
  // Hydrated once on mount from chrome.storage.local; updated only by
  // saveConfig's on-save re-probe. NO bulk-probe useEffect (BLK-4
  // invariant — D-C1 says "保存时一次, NOT runtime re-check, NOT polling").
  const [healthByConfigId, setHealthByConfigId] = useState<Record<string, HealthResult>>({});

  // Phase 20 OPT-01: managedModels lifted to useManagedModels hook (HOOK-02).
  // active is derived from useActiveModel (HOOK-01) — radio `isActive` checks
  // become `active.kind === 'managed' && active.id === m.id` (Option B per
  // 20-PATTERNS.md § 1.D recommendation: less state, fewer races).
  const { models: managedModels } = useManagedModels();
  const active = useActiveModel();

  // Phase 15 D-A1 / D-A2: managed-models section visibility still gated by
  // `hasSession` for T-20-06 anonymous-user JSX gate. useManagedModels does
  // NOT expose hasSession (D-A3 minimum surface), so EFFECT 1 below keeps
  // its own auth scan.
  const [hasSession, setHasSession] = useState<boolean>(false);
  // Bug fix (2026-05-05): the System Models section gates on `hasSession`.
  // We can't gate on `await supabase.auth.getSession()` directly — that path
  // goes through supabase.ts:102 chromiumLock (navigator.locks) which can
  // contend with sw.ts's 30-min auth-refresh alarm and stall indefinitely.
  // Instead we read the session token directly from chrome.storage (the
  // SDK's storage adapter persists it under sb-{ref}-auth-token) — single
  // sync-style read, no lock involvement. `sessionChecked=false` defers the
  // section heading by a few ms (until the storage read returns), avoiding
  // the false-positive anonymous flash.
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);

  useEffect(() => {
    getConfig().then((c) => {
      if (c) setCfg(c);
      setLoaded(true);
    });
    // [Phase 22 I18N-05] hydrate storedUi from storage in the same gate as
    // the cfg load — first non-loading render already knows storage state.
    void getItem('config_uiLanguage').then((v) => setStoredUi(v ?? undefined));
  }, []);

  // [Phase 22 I18N-05] cross-tab sync for storedUi — when another tab triggers
  // setLocale('auto') (key removed) or setLocale(Locale) (key written), this
  // tab's dropdown selected state stays in sync. Mirrors the i18n.ts module-
  // level onChanged listener; this listener runs in the OptionsApp React tree
  // to drive React state. READ-ONLY (no setLocale invocation) — cascade-safe.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) return;
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes.config_uiLanguage) return;
      const v = changes.config_uiLanguage.newValue as UiLocale | undefined;
      setStoredUi(v ?? undefined);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => { chrome.storage.onChanged.removeListener(handler); };
  }, []);

  // Plan 08 mount-time hydrate: read last-known health from typed
  // byokHealthCache (Plan 02 storage-schema; MED-5 cross-AI review).
  // No fetch fired here — D-C1 forbids polling / runtime re-check.
  useEffect(() => {
    void (async () => {
      try {
        const cache = (await getItem('byokHealthCache')) ?? {};
        const mapped: Record<string, HealthResult> = {};
        for (const [id, entry] of Object.entries(cache)) {
          if (entry.healthy) {
            mapped[id] = { status: 'healthy', modelCount: entry.modelCount ?? 0 };
          } else {
            mapped[id] = { status: 'unreachable', error: entry.reason ?? 'unknown' };
          }
        }
        setHealthByConfigId(mapped);
      } catch {
        // empty cache is fine; chips simply don't render until next save
      }
    })();
  }, []);

  // Phase 12 D-D1: load multi-config list on mount.
  // Phase 13 D-B3 #1: ALSO fire-and-forget re-probe for every localhost
  // config so health chips reflect current state without waiting for the
  // user to click Save. Remote URLs are gated by isLocalhostURL (no fetch).
  // No polling — D-C1 invariant intact (mount + popover-open + on-save are
  // the only 3 enumerated trigger points; popover-open lives in byok-chip.tsx).
  // Persistence flows through persistByokHealth (Plan 13-02 Task 3) — same
  // helper saveConfig now uses (WARN-5).
  useEffect(() => {
    void (async () => {
      try {
        const list = await listBYOKConfigs();
        setConfigs(list);
        // D-B3 #1: probe each localhost config; do NOT await (fire-and-forget).
        for (const c of list) {
          if (!isLocalhostURL(c.base_url)) continue;
          void checkBYOKHealth(c.base_url).then((r) => {
            // Mirror to React state (drives in-page chip render).
            setHealthByConfigId((prev) => ({ ...prev, [c.id]: r }));
            // Mirror to chrome.storage.local via the shared helper.
            void persistByokHealth(c.id, r);
          });
        }
      } catch (e) {
        setConfigsErr(String(e));
      } finally {
        setConfigsLoading(false);
      }
    })();
  }, []);

  // Phase 13 C-5 (cross-AI review consensus): live-subscribe to byokHealthCache.
  // The top-bar BYOKChip writes the cache from a different React tree (and
  // potentially a different extension context — popover open in reader tab,
  // Options page open in another tab). Without this listener, Options rows
  // would NOT re-render when the cache updates from outside this page. Mirror
  // the chip's onHealthChange listener pattern (byok-chip.tsx, Plan 13-02).
  //
  // Cascade safety: this listener is READ-ONLY — it calls setHealthByConfigId
  // but does NOT invoke checkBYOKHealth or persistByokHealth (which would
  // create a write→event→write loop). D-C1 invariant intact (no new probe
  // call sites — this is a pure subscriber).
  useEffect(() => {
    type CacheEntry = { ts: number; healthy: boolean; modelCount?: number; reason?: string };
    const onHealthChange = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== 'local') return;
      if (!('byokHealthCache' in changes)) return;
      const next = changes.byokHealthCache?.newValue as Record<string, CacheEntry> | undefined;
      if (!next) {
        setHealthByConfigId({});
        return;
      }
      // Round-trip the disk shape back to the in-page HealthResult union.
      const result: Record<string, HealthResult> = {};
      for (const [id, entry] of Object.entries(next)) {
        if (entry.healthy) {
          result[id] = { status: 'healthy', modelCount: entry.modelCount ?? 0 };
        } else {
          result[id] = { status: 'unreachable', error: entry.reason ?? 'unknown' };
        }
      }
      setHealthByConfigId(result);
    };
    chrome.storage.onChanged.addListener(onHealthChange);
    return () => chrome.storage.onChanged.removeListener(onHealthChange);
  }, []);

  // ─── Phase 15 System Models section: auth gate effect ─────────────
  // (Phase 20 OPT-01: EFFECTS 2/3/4 retired — useManagedModels owns them.)
  // EFFECT 1 — D-A2 / D-D2 auth gate: drives section visibility. Anonymous
  // users see no managed-models heading; the conditional render in JSX
  // depends on `hasSession`. Deps `[]`, cleanup unsubscribes the auth listener.
  useEffect(() => {
    // Initial sync: scan chrome.storage for the SDK's session token. Avoids
    // the navigator.locks deadlock path that hung the page on second open.
    void (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const tokenKey = Object.keys(all).find(
          (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
        );
        setHasSession(!!tokenKey);
      } finally {
        setSessionChecked(true);
      }
    })();
    // Live updates (sign-in/out during the page's lifetime). The SDK's
    // listener is safe — it doesn't acquire the auth lock just to dispatch.
    const { data: authListener } = supabase.auth.onAuthStateChange((_evt, session) => {
      setHasSession(!!session);
      setSessionChecked(true);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // Phase 20 OPT-01 (D-CD-03): EFFECTS 2/3/4 retired — useManagedModels hook
  // owns mount-time fetch + post-login refetch + cache live-subscribe +
  // Realtime UPDATE force refetch. Active id hydration moved to useActiveModel
  // (D-A6 read separation). EFFECT 1 above (auth gate) UNCHANGED — drives
  // hasSession + sessionChecked for T-20-06 anonymous JSX gate.

  // T-12-07-01 SSRF mitigation: only https:// or http://localhost / 127.0.0.1.
  function isValidBaseURL(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') return true;
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
      return false;
    } catch {
      return false;
    }
  }

  // D-D1 + Claude's Discretion: 1-32 chars; letters/digits/spaces/hyphens/
  // underscores/dots (dots needed for version-suffixed model nicknames like
  // "gpt-5.4" / "claude-3.5-sonnet").
  function isValidName(name: string): boolean {
    return /^[\w \-.]{1,32}$/.test(name);
  }

  const startNewConfig = () => {
    setEditing({
      id: undefined,
      name: '',
      preset: 'openai-compatible',
      baseURL: '',
      model: '',
      apiKey: '',
    });
    setConfigsErr('');
  };

  const startEditConfig = (c: BYOKConfigClientView) => {
    setEditing({
      id: c.id,
      name: c.name,
      preset: 'openai-compatible',
      baseURL: c.base_url,
      model: c.model,
      apiKey: c.apiKey,
    });
    setConfigsErr('');
  };

  const onPresetChange = (presetId: BYOKPresetId) => {
    if (!editing) return;
    const filled = applyPreset(presetId, {
      baseURL: editing.baseURL,
      model: editing.model,
      apiKey: editing.apiKey,
    });
    setEditing({ ...editing, preset: presetId, ...filled });
  };

  // Phase 16 D-C1 / D-C2 / D-C3: template chip click state.
  // - lastClickedTemplate drives the 1s active-flash visual on the chip
  //   (data-active + walnut tint via inline style; see chip JSX below).
  // - activeHelpTextKey is rendered as a one-line description below the
  //   baseURL field, updated to the chip's helpTextKey on click. Defaults
  //   to the 'custom' helpText so the area is non-empty before any chip
  //   click (matching baseURL='' + model='' default for openai-compatible).
  const [lastClickedTemplate, setLastClickedTemplate] = useState<
    OpenAICompatTemplate['id'] | null
  >(null);
  const [activeHelpTextKey, setActiveHelpTextKey] = useState<string>(
    'options.byok-presets.openai-compatible.helpText.custom',
  );

  const applyTemplate = (tpl: OpenAICompatTemplate) => {
    if (!editing) return;
    // D-B2: chip overwrites baseURL + model (explicit user intent), but the
    // pure helper preserves the existing key — the caller's secret value is
    // never touched (see openai-compat-templates.ts JSDoc for the invariant).
    // D-B3: Custom (tpl.baseURL===''/'') is reset semantics.
    setEditing({ ...editing, ...applyTemplatePure(editing, tpl) });
    setActiveHelpTextKey(tpl.helpTextKey);
    setLastClickedTemplate(tpl.id);
    // D-C2: 1s active flash, then revert.
    window.setTimeout(() => setLastClickedTemplate(null), 1000);
  };

  const saveConfig = async () => {
    if (!editing) return;
    setConfigsErr('');
    if (!isValidName(editing.name)) {
      setConfigsErr(t('options.byok-configs.error.name'));
      return;
    }
    if (!isValidBaseURL(editing.baseURL)) {
      setConfigsErr(t('options.byok-configs.error.baseURL'));
      return;
    }
    if (!editing.model.trim()) {
      setConfigsErr(t('options.byok-configs.error.model'));
      return;
    }
    if (!editing.apiKey.trim()) {
      setConfigsErr(t('options.byok-configs.error.apiKey'));
      return;
    }
    // WARN-3: capture editable fields BEFORE the await chain so the
    // post-save .then() handler is racing-immune (`editing` may be set
    // to null by the time the async probe resolves).
    const savedBaseURL = editing.baseURL;
    const savedName = editing.name;
    try {
      if (editing.id) {
        await updateBYOKConfig(editing.id, {
          name: editing.name,
          baseURL: editing.baseURL,
          model: editing.model,
          apiKey: editing.apiKey,
        });
      } else {
        await createBYOKConfig({
          name: editing.name,
          baseURL: editing.baseURL,
          model: editing.model,
          apiKey: editing.apiKey,
          isActive: configs.length === 0,  // first config auto-active
        });
      }
      const list = await listBYOKConfigs();
      setConfigs(list);
      setEditing(null);

      // Plan 08 D-C1: async re-probe — non-blocking, fires after save
      // completes. Only for localhost URLs (isLocalhostURL gate).
      // Phase 13 WARN-5 dedupe: persistence flows through the shared
      // persistByokHealth helper from byok-health-check.ts (Plan 13-02
      // Task 3) — same writer used by the top-bar BYOKChip mount/open
      // probes. The helper handles read-modify-write serialization (C-3
      // race-safe pendingWrite chain).
      if (isLocalhostURL(savedBaseURL)) {
        void checkBYOKHealth(savedBaseURL).then((r) => {
          // Locate the just-saved row by name + base_url match.
          const saved = list.find((c) => c.base_url === savedBaseURL && c.name === savedName);
          if (!saved) return;
          // Mirror to React state (drives in-page chip render).
          setHealthByConfigId((prev) => ({ ...prev, [saved.id]: r }));
          // Mirror to chrome.storage.local via the shared helper.
          void persistByokHealth(saved.id, r);
        });
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('name-conflict') || msg.includes('23505')) {
        setConfigsErr(t('options.byok-configs.error.name-conflict'));
      } else {
        setConfigsErr(msg);
      }
    }
  };

  const onSetActive = async (id: string) => {
    setConfigsErr('');
    try {
      // Phase 20 OPT-02: route through MUTEX-02. Mirror model-picker.tsx:252-260.
      // Behavioral delta vs Phase 12 direct byok-config write: setActiveModel
      // ALSO clears config_active_managed_model_id (clear-loser-first per
      // active-model.ts:77-78). Switching from a managed model to BYOK now
      // correctly drops the managed key in the same atomic chain step.
      await setActiveModel({ kind: 'byok', id });
      const list = await listBYOKConfigs();
      setConfigs(list);
    } catch (e) {
      // T-20-02: setActiveModel D-A1.1 throws on stale id (deleted between
      // list fetch and click). Surface to existing error banner UI.
      setConfigsErr(String(e));
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(t('options.byok-configs.confirm.delete', { name }))) return;
    setConfigsErr('');
    try {
      await deleteBYOKConfig(id);
      const list = await listBYOKConfigs();
      setConfigs(list);
    } catch (e) {
      setConfigsErr(String(e));
    }
  };

  // Globe-icon deep-link from AccountMenu: window.open(...#language) lands here.
  // Wait one frame so React has committed the Field row before scrollIntoView.
  useEffect(() => {
    if (!loaded) return;
    if (typeof window === 'undefined' || window.location.hash !== '#language') return;
    requestAnimationFrame(() => {
      const el = document.getElementById('language-row');
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        (el.querySelector('select') as HTMLSelectElement | null)?.focus();
      }
    });
  }, [loaded]);

  // Phase 13 D-A2: BYOKChip popover '+ New config' deep-links here via URL
  // hash #new-byok-config. Mirrors the existing #language deep-link pattern.
  // Fires once after `loaded` becomes true so the form state is ready to
  // receive startNewConfig.
  useEffect(() => {
    if (!loaded) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#new-byok-config') return;
    const raf = requestAnimationFrame(() => {
      startNewConfig();
      // Clear hash so reloads don't re-trigger.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  // Phase 19 D-B2.1: ModelPicker '管理' button deep-links here via #manage-byok-configs.
  // Mirror the existing #new-byok-config + #language patterns: wait one frame so React
  // has committed the BYOK Configs section before scrollIntoView. Clear the hash so
  // page reloads don't re-trigger.
  useEffect(() => {
    if (!loaded) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#manage-byok-configs') return;
    const raf = requestAnimationFrame(() => {
      document.getElementById('byok-configs-section')?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
      history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  // Phase 17 17-02 Task 1: legacy <details> JSX block deleted (the only
  // consumer of the prior save() handler + saveState/err state). The output
  // language picker now persists on change directly via setItem, which is
  // the only field still requiring storage write from this handler — see
  // outputLang <select> onChange below.
  const onChange = (patch: Partial<AiConfig>) => {
    setCfg((prev) => ({ ...prev, ...patch }));
  };

  if (!loaded) {
    return <div style={{ padding: 32, fontStyle: 'italic', color: 'var(--ink-faded)' }}>{t('options.loading')}</div>;
  }

  // D14: picker order — detected first (if differs), then current, then rest in declaration order.
  const currentUi = getLocale();
  const detected = detectInitialLocale();
  const uiOrder = uiLocaleOrder(detected, currentUi);

  // [Phase 22 I18N-05] dynamic 'auto' label + dropdownValue derivation.
  // currentNative resolves currentLocale → its native name (e.g., 'English',
  // '中文（简体）', '日本語') for the {locale} placeholder. dropdownValue is
  // 'auto' when storage key is absent (storedUi === undefined), else the
  // current Locale — drives the controlled <select value={...}>.
  const currentNative = OUTPUT_LANGUAGES.find((l) => l.code === currentUi)?.label ?? 'English';
  const dropdownValue: 'auto' | UiLocale = storedUi === undefined ? 'auto' : currentUi;

  // D17 + dynamic Auto label. 'auto' shows native UI name; 'detect' is its own option.
  const uiNative = OUTPUT_LANGUAGES.find((l) => l.code === currentUi)?.label ?? 'English';
  const outputOptions: Array<{ code: string; label: string }> = [
    { code: 'auto',   label: t('output.auto', { ui: uiNative }) },
    { code: 'detect', label: t('output.detect') },
    ...OUTPUT_LANGUAGES
      .filter((l) => l.code !== 'auto' && l.code !== 'detect')
      .map((l) => ({ code: l.code, label: l.label })),
  ];

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{
        fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600,
        color: 'var(--ink)', marginBottom: 6,
      }}>{t('options.title')}</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-faded)', marginBottom: 28, lineHeight: 1.5 }}>
        {t('options.intro')}
      </p>

      <Field
        id="language-row"
        label={t('options.ui_language.label')}
        hint={t('options.ui_language.hint')}
      >
        <select
          value={dropdownValue}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'auto') {
              void setLocale('auto');
            } else {
              void setLocale(next as UiLocale);
            }
          }}
          style={{ ...input(), minWidth: 220, fontFamily: 'var(--font-i18n-fallback)' }}
        >
          <option key="auto" value="auto" style={{ fontFamily: 'var(--font-i18n-fallback)' }}>
            {t('options.ui_language.auto', { locale: currentNative })}
          </option>
          {uiOrder.map((code) => (
            <option key={code} value={code} style={{ fontFamily: 'var(--font-i18n-fallback)' }}>
              {OUTPUT_LANGUAGES.find((l) => l.code === code)?.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t('options.outputLang.label')}
        hint={t('options.outputLang.hint')}
      >
        <select
          value={cfg.outputLanguage ?? 'auto'}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ outputLanguage: v });
            // Phase 17 17-02 Task 1: auto-persist on change. The legacy save
            // button (deleted with the v1.1 <details> block) was the prior
            // trigger; output language is now the only AiConfig field still
            // owning storage so on-change write is the simplest preservation.
            void setItem('config_outputLanguage', v);
          }}
          style={{ ...input(), minWidth: 220, fontFamily: 'var(--font-i18n-fallback)' }}
        >
          {outputOptions.map((opt) => (
            <option key={opt.code} value={opt.code} style={{ fontFamily: 'var(--font-i18n-fallback)' }}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Phase 15 D-A1: System Models section. D-A2 / D-D2: rendered only when
          user is signed in. Above BYOK Configs section per UI placement decision.
          `sessionChecked` gate avoids a "logged-in user briefly sees no section"
          flash while the chrome.storage token scan is in flight (~50ms). */}
      {sessionChecked && hasSession && (
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '0.5px solid var(--rule)' }}>
          <h2 style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--t-md)', fontWeight: 600,
            color: 'var(--ink)', marginBottom: 4,
          }}>{t('options.managed-models.heading')}</h2>
          <p style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-faded)', marginBottom: 16, lineHeight: 1.5 }}>
            {t('options.managed-models.description')}
          </p>

          {managedModels.map((m) => {
            // Phase 20 OPT-01 (Option B): isActive derived from useActiveModel
            // (single source of truth; useActiveModel re-renders this row via
            // useSyncExternalStore on chrome.storage.onChanged — D-CD-05).
            const isActive = active.kind === 'managed' && active.id === m.id;
            const onSelect = async () => {
              if (m.locked) return;
              try {
                // Phase 20 OPT-02: route through MUTEX-02 single-source writer.
                // Mirror model-picker.tsx:241-250 (T-19-02 / T-20-02 try/catch idiom).
                await setActiveModel({ kind: 'managed', id: m.id });
                // No local active-id setter needed — useActiveModel re-renders
                // this row automatically via useSyncExternalStore (D-CD-05).
              } catch (e) {
                // T-20-02: setActiveModel D-A1.1 throws on stale id (cache
                // mid-refresh). Log only — do NOT toast / close UI. User retries.
                // eslint-disable-next-line no-console
                console.error('[options] setActiveModel managed failed', e);
              }
            };
            const onUpgrade = async () => {
              const { data, error } = await supabase.functions.invoke<{ url?: string }>(
                'create-checkout-session', { body: { tier: 'pro' } },
              );
              if (error || !data?.url) {
                console.warn('upgrade checkout failed', error);
                return;
              }
              chrome.tabs.create({ url: data.url });
            };
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', marginBottom: 8,
                background: 'var(--paper-soft)',
                border: '0.5px solid var(--rule-soft)',
                borderLeft: isActive ? '2px solid var(--forest)' : '0.5px solid var(--rule-soft)',
                borderRadius: 6,
                opacity: m.locked ? 0.55 : 1,
              }}>
                <input
                  type="radio"
                  name="active-managed"
                  checked={isActive}
                  onChange={onSelect}
                  disabled={m.locked}
                  style={{ pointerEvents: m.locked ? 'none' : 'auto' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    {m.display_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faded)', fontFamily: 'var(--font-mono)' }}>
                    {m.id}
                  </div>
                </div>
                {m.locked && (
                  <>
                    <span style={{
                      padding: '2px 8px', fontSize: 11, borderRadius: 4,
                      background: 'color-mix(in oklch, var(--walnut) 12%, transparent)',
                      color: 'var(--walnut)',
                    }}>{t('options.managed-models.locked.badge')}</span>
                    <button
                      onClick={onUpgrade}
                      style={{ padding: '4px 10px', fontSize: 12, background: 'var(--ink)',
                        color: 'var(--paper)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                    >{t('options.managed-models.locked.upgrade-cta')}</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase 13 D-B1 + UI-SPEC §4: BYOK Configs section visual redesign — sans heading
          aligns with v1.1 [界面语言+输出语言] Field block hierarchy. */}
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: '0.5px solid var(--rule)' }}>
        <h2
          id="byok-configs-section"
          style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--t-md)', fontWeight: 600,
            color: 'var(--ink)', marginBottom: 4,
          }}
        >{t('options.byok-configs.heading')}</h2>
        <p style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-faded)', marginBottom: 16, lineHeight: 1.5 }}>
          {t('options.byok-configs.description')}
        </p>

        {configsLoading && <div style={{ fontSize: 12, color: 'var(--ink-faded)' }}>{t('options.byok-configs.loading')}</div>}

        {!configsLoading && configs.length === 0 && !editing && (
          <div style={{ fontSize: 13, color: 'var(--ink-faded)', marginBottom: 16 }}>
            {t('options.byok-configs.empty')}
          </div>
        )}

        {/* Config list */}
        {!editing && configs.map((c) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', marginBottom: 8,
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule-soft)',
            borderLeft: c.is_active ? '2px solid var(--forest)' : '0.5px solid var(--rule-soft)',
            borderRadius: 6,
          }}>
            <input
              type="radio"
              name="active-byok"
              checked={c.is_active}
              onChange={() => onSetActive(c.id)}
              title={t('options.byok-configs.set-active.aria')}
              aria-label={t('options.byok-configs.set-active.aria')}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{c.name} {c.is_active && <span style={{ color: 'var(--forest)', fontSize: 11 }}>{t('options.byok-configs.active-suffix')}</span>}</span>
                {/* Plan 08 D-C2: chip renders only for cached health entries.
                    Rows the user has not yet saved (or 'unchecked' remote URLs)
                    show nothing. NO bulk-probe — D-C1 forbids polling. */}
                {healthByConfigId[c.id] && healthByConfigId[c.id].status !== 'unchecked' && (
                  <HealthChip result={healthByConfigId[c.id]} />
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-faded)', fontFamily: 'var(--font-mono)' }}>
                {c.base_url} · {c.model}
              </div>
            </div>
            <button
              onClick={() => startEditConfig(c)}
              style={{ padding: '4px 10px', fontSize: 12, background: 'transparent', color: 'var(--ink)', border: '0.5px solid var(--rule)', borderRadius: 4, cursor: 'pointer' }}
            >{t('options.byok-configs.btn.edit')}</button>
            <button
              onClick={() => onDelete(c.id, c.name)}
              style={{ padding: '4px 10px', fontSize: 12, background: 'transparent', color: 'var(--foxglove)', border: '0.5px solid var(--foxglove)', borderRadius: 4, cursor: 'pointer' }}
            >{t('options.byok-configs.btn.delete')}</button>
          </div>
        ))}

        {/* New / edit form */}
        {editing && (
          <div style={{ padding: 16, background: 'var(--paper)', border: '0.5px solid var(--rule)', borderRadius: 6, marginBottom: 12 }}>
            <Field label={t('options.byok-configs.field.preset.label')} hint={t('options.byok-configs.field.preset.hint')}>
              <select
                value={editing.preset}
                onChange={(e) => onPresetChange(e.target.value as BYOKPresetId)}
                style={{ ...input(), minWidth: 220 }}
              >
                {BYOK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {/* Phase 16 D-E1: 'OpenAI compatible' label is i18n-translated
                        (CONTEXT D-E1 9-locale table). Quick task 260507 reduced
                        the registry to a single preset so this conditional is
                        currently always true; left as-is for forward-compat
                        when new presets are added. */}
                    {p.id === 'openai-compatible'
                      ? t('options.byok-presets.openai-compatible.label')
                      : p.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('options.byok-configs.field.name.label')} hint={t('options.byok-configs.field.name.hint')}>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="My BYOK config"
                style={input()}
              />
            </Field>

            {/* Phase 16 D-C1: 6 template chip row, only rendered while editing
                is non-null (saved configs do NOT render chips). D-C4: flex-wrap
                so 760px+ is single row, narrower wraps. D-C2: 1s active flash
                via lastClickedTemplate + walnut tint. D-E2: provider names
                (OpenAI/OpenRouter/Together/Groq/DeepSeek) NOT translated;
                'Custom' chip label routed through i18n. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 6,
              }}
            >
              {OPENAI_COMPAT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  data-active={lastClickedTemplate === tpl.id}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    background:
                      lastClickedTemplate === tpl.id
                        ? 'color-mix(in oklch, var(--walnut) 12%, transparent)'
                        : 'transparent',
                    color: 'var(--ink)',
                    border: '0.5px solid var(--rule)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'background 80ms ease',
                  }}
                >
                  {tpl.id === 'custom'
                    ? t('options.byok-presets.openai-compatible.chip.custom')
                    : tpl.label}
                </button>
              ))}
            </div>

            <Field label={t('options.byok-configs.field.baseURL.label')} hint={t('options.byok-configs.field.baseURL.hint')}>
              <input
                type="url"
                value={editing.baseURL}
                onChange={(e) => setEditing({ ...editing, baseURL: e.target.value })}
                placeholder={BYOK_PRESETS.find((p) => p.id === editing.preset)?.defaultBaseURL || 'https://...'}
                style={input()}
              />
            </Field>

            {/* Phase 16 D-C3: helpText area — last-clicked template description.
                Defaults to 'custom' helpText so the area is never empty even
                before any chip click. */}
            <p
              style={{
                fontSize: 'var(--t-xs)',
                color: 'var(--ink-faded)',
                marginTop: 4,
                marginBottom: 8,
              }}
            >
              {t(activeHelpTextKey)}
            </p>

            <Field label={t('options.byok-configs.field.apiKey.label')} hint={t('options.byok-configs.field.apiKey.hint')}>
              <input
                type="password"
                value={editing.apiKey}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                placeholder={BYOK_PRESETS.find((p) => p.id === editing.preset)?.apiKeyPlaceholder || 'sk-...'}
                style={input()}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field label={t('options.byok-configs.field.model.label')} hint={t('options.byok-configs.field.model.hint')}>
              <input
                type="text"
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder={BYOK_PRESETS.find((p) => p.id === editing.preset)?.defaultModel || 'gpt-4o'}
                style={input()}
              />
            </Field>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={saveConfig}
                style={{ padding: '8px 18px', background: 'var(--ink)', color: 'var(--paper)', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >{t('options.byok-configs.btn.save')}</button>
              <button
                onClick={() => { setEditing(null); setConfigsErr(''); }}
                style={{ padding: '8px 18px', background: 'transparent', color: 'var(--ink)', border: '0.5px solid var(--rule)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >{t('options.byok-configs.btn.cancel')}</button>
            </div>
          </div>
        )}

        {!editing && (
          <button
            onClick={startNewConfig}
            style={{ padding: '8px 14px', background: 'transparent', color: 'var(--walnut)', border: '0.5px dashed var(--walnut)', borderRadius: 6, fontSize: 13, cursor: 'pointer', marginTop: 4 }}
          >{t('options.byok-configs.btn.new')}</button>
        )}

        {configsErr && (
          <div style={{
            padding: '8px 12px', marginTop: 12,
            background: 'color-mix(in oklch, var(--foxglove) 10%, transparent)',
            border: '0.5px solid var(--foxglove)', borderRadius: 6,
            color: 'var(--foxglove)', fontSize: 12,
          }}>{configsErr}</div>
        )}
      </div>

    </div>
  );
}

/**
 * D14: detected first (if differs from current), then current, then the rest in
 * OUTPUT_LANGUAGES declaration order. 'auto' / 'detect' are excluded — they
 * never appear in the UI-language picker.
 */
function uiLocaleOrder(detected: UiLocale, current: UiLocale): UiLocale[] {
  const all = OUTPUT_LANGUAGES
    .filter((l) => l.code !== 'auto' && l.code !== 'detect')
    .map((l) => l.code) as UiLocale[];
  const order: UiLocale[] = [];
  if (detected !== current) order.push(detected);
  order.push(current);
  for (const code of all) {
    if (!order.includes(code)) order.push(code);
  }
  return order;
}

function Field({
  id, label, hint, children,
}: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginBottom: 18 }}>
      <label style={{
        display: 'block',
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 5,
      }}>{label}</label>
      {children}
      {hint && (
        <div style={{
          fontSize: 11, color: 'var(--ink-faded)',
          fontStyle: 'italic', marginTop: 4,
        }}>{hint}</div>
      )}
    </div>
  );
}

function input(): React.CSSProperties {
  return {
    width: '100%', padding: '8px 10px',
    background: 'var(--paper)', color: 'var(--ink)',
    border: '0.5px solid var(--rule)', borderRadius: 6,
    fontSize: 13, fontFamily: 'var(--font-sans)',
    outline: 'none',
  };
}

// Phase 13 (D-E + UI-SPEC §Cross-Phase Constraints row 7): HealthChip is now
// i18n-driven. The Phase 12 12-08 NIT-6 deliberate hard-code is overridden
// because (a) Phase 13 顶栏 chip + popover already use the same string set
// (D-A3 inline dot tooltip), and (b) the row chip is no longer "dev-tool
// diagnostic" — it is the user-facing settings page final state.
//
// C-4 fix (cross-AI review consensus): HealthChip is module-level (NOT inside
// OptionsApp), so the closure variable `t` from useT() is not in scope here.
// We import `t` directly from i18n.ts (which has a top-level export at line
// 2345). Inside OptionsApp the existing `const t = useT()` shadows the static
// import for React-component callers — both forms call the same underlying
// translator, so there is no behavior split.
//
// Color: 'unreachable' uses --amber (warning) NOT --foxglove (destructive,
// reserved for delete buttons + error banner per UI-SPEC §Color §Destructive).
//
// 'checking' state is added for the brief window between probe-in-flight
// and probe-resolved (D-B3 mount probe + popover-open probe). Caller may
// pass the synthetic { status: 'checking' } variant; HealthResult itself
// is NOT extended (keeps byok-health-check.ts as the source of truth).
function HealthChip({ result }: { result: HealthResult | { status: 'checking' } }) {
  if (result.status === 'healthy') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', fontSize: 11, fontWeight: 500,
        background: 'color-mix(in oklch, var(--forest) 12%, transparent)',
        color: 'var(--forest)',
        border: '0.5px solid var(--forest)', borderRadius: 999,
      }} title={t('topbar.byok-popover.row.health.healthy', { n: result.modelCount })}>
        ● {t('topbar.byok-popover.row.health.healthy', { n: result.modelCount })}
      </span>
    );
  }
  if (result.status === 'unreachable') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', fontSize: 11, fontWeight: 500,
        background: 'var(--amber-soft)',
        color: 'var(--amber)',
        border: '0.5px solid var(--amber)', borderRadius: 999,
      }} title={result.error}>
        ● {t('options.byok-configs.row.health.unreachable')}
      </span>
    );
  }
  if (result.status === 'checking') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', fontSize: 11, fontWeight: 400,
        background: 'transparent',
        color: 'var(--ink-faded)',
        border: '0.5px dashed var(--rule)', borderRadius: 999,
      }}>
        {t('options.byok-configs.row.health.checking')}
      </span>
    );
  }
  // 'unchecked' — caller pre-gates; render nothing.
  return null;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
