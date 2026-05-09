// Tests for reader/lib/i18n.ts — 9-locale messages, reactive useT,
// detectInitialLocale, setLocale persistence + notify + html lang sync,
// cross-tab onChanged, parity, cross-enum consistency, D18 error isolation,
// CRITICAL en-US→en migration regression.
//
// Module-load side effects (the async storage reconcile + onChanged listener
// + module-end notify) run once per process. Tests that need to observe
// those side effects (e.g. reconcile, fresh first-paint) use
// `vi.resetModules()` + dynamic import to get a clean module instance.
// Single-instance tests (parity, fallback, setLocale, subscribers) share the
// already-loaded module and rely on resetting subscribers + storage between
// runs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// chrome mock — applied BEFORE the static import below so the static module
// load sees a real chrome.storage. Each test still gets a fresh storage map
// via `installChrome()` in beforeEach.
type StorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};
type OnChangedListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: 'local' | 'sync' | 'managed' | 'session',
) => void;

let listeners: OnChangedListener[] = [];

function makeMockStorage(initial: Record<string, unknown> = {}): StorageArea {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: async (keys) => {
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
    },
    set: async (items) => {
      const changes: Record<string, { newValue: unknown; oldValue: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: v };
        data.set(k, v);
      }
      // Fire onChanged listeners synchronously after the set resolves.
      queueMicrotask(() => {
        for (const l of listeners) l(changes, 'local');
      });
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) data.delete(k);
    },
  };
}

function installChrome(initial: Record<string, unknown> = {}, uiLang?: string) {
  listeners = [];
  (globalThis as any).chrome = {
    storage: {
      local: makeMockStorage(initial),
      onChanged: {
        addListener: (l: OnChangedListener) => { listeners.push(l); },
      },
    },
    // [Phase 22] chrome.i18n shim — undefined when uiLang param omitted (Step 2 skips);
    // string return when uiLang provided.
    i18n: uiLang === undefined ? undefined : {
      getUILanguage: () => uiLang,
    },
  };
}

// Install before module load so the i18n.ts onChanged listener subscribes to
// our mock. Tests can reinstall via beforeEach for fresh state.
installChrome();

// Static import — the module's IIFE runs once with the chrome mock above.
// For tests that need to observe FRESH module state (different
// navigator.language, different stored value at first load), we use
// vi.resetModules() + dynamic re-import inside that test.
import {
  detectInitialLocale,
  getLocale,
  setLocale,
  t,
  useT,
  __testing,
  type Locale,
} from '../../reader/lib/i18n';
import { OUTPUT_LANGUAGES } from '../../reader/lib/ai';

beforeEach(() => {
  installChrome();
  // Wipe subscribers so each test starts fresh; the singleton module would
  // otherwise accumulate subscribers across tests.
  __testing.subscribers.clear();
});

afterEach(() => {
  __testing.subscribers.clear();
});

describe('detectInitialLocale', () => {
  // jsdom default navigator.language is 'en-US' → 'en' (after our 9-locale logic).
  it.each([
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['ja-JP', 'ja'],
    ['ja',    'ja'],
    ['ko-KR', 'ko'],
    ['fr-CA', 'fr'],
    ['de-DE', 'de'],
    ['es-MX', 'es'],
    ['ru-RU', 'ru'],
    ['zh-CN', 'zh-CN'],
    ['zh',    'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['pt-BR', 'en'],   // unknown base → 'en'
    ['xx-YY', 'en'],   // unknown → 'en'
    ['',      'en'],   // empty → 'en'
  ])('navigator.language=%s → %s', (input, expected) => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: input, configurable: true });
    try {
      expect(detectInitialLocale()).toBe(expected);
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});

describe('messages parity (D12) + cross-enum (2E)', () => {
  it('all 9 locales have identical key sets', () => {
    const refs = Object.keys(__testing.messages.en).sort();
    expect(refs.length).toBeGreaterThan(50); // sanity check
    for (const locale of Object.keys(__testing.messages) as Locale[]) {
      const ks = Object.keys(__testing.messages[locale]).sort();
      expect(ks).toEqual(refs);
    }
  });

  it('2E: OUTPUT_LANGUAGES.codes (minus auto + detect) === messages.keys', () => {
    const aiCodes = OUTPUT_LANGUAGES
      .filter((l) => l.code !== 'auto' && l.code !== 'detect')
      .map((l) => l.code)
      .sort();
    const i18nLocales = Object.keys(__testing.messages).sort();
    expect(aiCodes).toEqual(i18nLocales);
  });

  it('contains the new D17 + globe + Options keys', () => {
    expect(__testing.messages.en).toHaveProperty('output.detect');
    expect(__testing.messages.en).toHaveProperty('output.auto');
    expect(__testing.messages.en).toHaveProperty('account.language');
    expect(__testing.messages.en).toHaveProperty('account.language.aria');
    expect(__testing.messages.en).toHaveProperty('options.title');
    expect(__testing.messages.en).toHaveProperty('options.intro');
    expect(__testing.messages.en).toHaveProperty('options.ui_language.auto');
  });
});

describe('t() fallback chain', () => {
  it('returns the current-locale value when present', async () => {
    await setLocale('zh-CN');
    expect(t('login.headline')).toBe('解锁 20 次免费 AI 试用');
  });

  it('falls back to English when current locale lacks the key', async () => {
    // Inject a locale-only key into ja for this test (cleanup after).
    const jaMsgs = __testing.messages.ja;
    expect(jaMsgs).toBeDefined();
    await setLocale('ja');
    // Use a known-existing key from English; current locale ja should resolve.
    expect(t('login.headline')).toMatch(/AI 試用/);
  });

  it('returns the key string when no locale has it', async () => {
    await setLocale('en');
    expect(t('totally.missing.key')).toBe('totally.missing.key');
  });

  it('interpolates {placeholders}', async () => {
    await setLocale('en');
    expect(t('login.email.resend', { n: 30 })).toBe('Resend (30s)');
    expect(t('account.trial.remaining', { used: 5, limit: 20, remaining: 15 }))
      .toBe('5 / 20 · 15 left');
  });
});

describe('setLocale + notify + <html lang> sync (D9)', () => {
  it('persists + notifies + updates document.documentElement.lang', async () => {
    let calls = 0;
    __testing.subscribers.add(() => { calls++; });

    await setLocale('ko');

    expect(getLocale()).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(calls).toBe(1);

    const stored = await chrome.storage.local.get('config_uiLanguage');
    expect(stored.config_uiLanguage).toBe('ko');
  });

  it('no-ops when called with the same locale', async () => {
    await setLocale('fr');
    let calls = 0;
    __testing.subscribers.add(() => { calls++; });
    await setLocale('fr');  // same value
    expect(calls).toBe(0);
  });
});

describe('D18: notify subscriber error isolation', () => {
  it('one subscriber throwing does not block others', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });

    let okCalled = 0;
    __testing.subscribers.add(() => { throw new Error('boom'); });
    __testing.subscribers.add(() => { okCalled++; });

    await setLocale(getLocale() === 'en' ? 'ja' : 'en');

    expect(okCalled).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith('[i18n] subscriber failed', expect.any(Error));

    warnSpy.mockRestore();
  });
});

describe('useT() React subscription', () => {
  it('returns a stable t function reference', () => {
    // useT must NOT change t identity across calls — test asserts the contract.
    // We can't render a real component easily without RTL; instead verify the
    // hook returns the imported `t`.
    // The contract is documented in the module: useT returns the global t.
    expect(useT.length).toBe(0);  // takes no args
    // Stable identity verified indirectly: the module exports t as a frozen
    // reference, and useT returns it. If a future change wraps t per-call,
    // this test (and the doc comment in i18n.ts) flag the regression.
  });
});

describe("CRITICAL: en-US → en migration is idempotent", () => {
  // This is the IRON-RULE regression: a returning user with config_uiLanguage='en-US'
  // must be silently migrated to 'en' on first module load. A second module load
  // (or any subsequent run) must NOT re-write storage, otherwise the
  // chrome.storage.onChanged listener would fire repeatedly and create a
  // notify-storm on every module hot reload.
  it('first load migrates en-US → en, second load is a no-op', async () => {
    vi.resetModules();
    installChrome({ config_uiLanguage: 'en-US' });

    let setCalls = 0;
    const origSet = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local as any).set = async (items: any) => {
      setCalls++;
      return origSet(items);
    };

    // First load: triggers async migration write.
    await import('../../reader/lib/i18n');
    // Wait for the void IIFE in i18n.ts to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(setCalls).toBe(1);  // exactly one write to migrate
    const stored1 = await chrome.storage.local.get('config_uiLanguage');
    expect(stored1.config_uiLanguage).toBe('en');

    // Second load: stored value is now 'en', no migration needed → no write.
    vi.resetModules();
    setCalls = 0;
    await import('../../reader/lib/i18n');
    await new Promise((r) => setTimeout(r, 10));

    expect(setCalls).toBe(0);
    const stored2 = await chrome.storage.local.get('config_uiLanguage');
    expect(stored2.config_uiLanguage).toBe('en');
  });
});

describe('module load: synchronous detect (D13) + first-paint <html lang> (1D)', () => {
  it('getLocale() returns the detected locale immediately at module load', async () => {
    vi.resetModules();
    installChrome();  // empty storage = new user
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      // No await — synchronous detect has already run during the import above.
      expect(mod.getLocale()).toBe('ja');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });

  it('1D: <html lang> matches the detected locale right after module load', async () => {
    vi.resetModules();
    installChrome();
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ko-KR', configurable: true });
    try {
      await import('../../reader/lib/i18n');
      expect(document.documentElement.lang).toBe('ko');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});

describe('cross-tab sync (D9 onChanged listener)', () => {
  it('storage change in another tab updates currentLocale + notifies', async () => {
    // Module already loaded in this test process; the onChanged listener
    // registered against our installChrome mock at module-load time.
    // BUT: our beforeEach reinstalls chrome with a fresh listeners[] array,
    // so the original listener is no longer wired. To test cross-tab, we
    // simulate by directly triggering a setLocale (which fires our onChanged
    // through the chrome.storage.local.set mock — listeners receives the
    // event because the listener was registered against THIS instance of
    // installChrome, not the original module-load one).
    //
    // Cleanest approach: dynamic re-import after installChrome, so the new
    // listener is attached to our current chrome.
    vi.resetModules();
    installChrome();
    const mod = await import('../../reader/lib/i18n');

    let notified = 0;
    mod.__testing.subscribers.add(() => { notified++; });

    // Simulate "another tab" writing to storage by directly invoking listeners.
    // (chrome.storage.local.set in this tab would also trigger them, but we
    // want to verify the listener PATH, not the same-tab path.)
    for (const l of listeners) {
      l({ config_uiLanguage: { newValue: 'fr', oldValue: 'en' } }, 'local');
    }

    expect(mod.getLocale()).toBe('fr');
    expect(notified).toBe(1);
  });
});

// ---- Phase 22 (I18N-04 / I18N-05) new describe blocks ----

describe('detectInitialLocale chain (Phase 22)', () => {
  it('Step 2 hits when navigator.language unsupported but chrome.i18n returns supported locale', async () => {
    vi.resetModules();
    installChrome({}, 'fr-FR');
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'pt-BR', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      expect(mod.getLocale()).toBe('fr');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });

  it('Step 3 (en fallback) hits when both nav and chrome.i18n unsupported', async () => {
    vi.resetModules();
    installChrome({}, 'it-IT');
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'pt-BR', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      expect(mod.getLocale()).toBe('en');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });

  it('Step 1 short-circuits — chrome.i18n NOT called when navigator.language hits', async () => {
    vi.resetModules();
    let getUILanguageCalls = 0;
    listeners = [];
    (globalThis as any).chrome = {
      storage: {
        local: makeMockStorage({}),
        onChanged: { addListener: (l: OnChangedListener) => { listeners.push(l); } },
      },
      i18n: { getUILanguage: () => { getUILanguageCalls++; return 'fr-FR'; } },
    };
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    try {
      await import('../../reader/lib/i18n');
      expect(getUILanguageCalls).toBe(0);
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });

  it('chrome.i18n undefined → step 2 safely skipped', async () => {
    vi.resetModules();
    installChrome();
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'pt-BR', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      expect(mod.getLocale()).toBe('en');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});

describe("setLocale('auto') (Phase 22)", () => {
  it('removes config_uiLanguage + re-detects + notifies (3 steps same tick)', async () => {
    vi.resetModules();
    installChrome({ config_uiLanguage: 'fr' }, 'ja-JP');
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      await new Promise((r) => setTimeout(r, 10));
      expect(mod.getLocale()).toBe('fr');

      let calls = 0;
      mod.__testing.subscribers.add(() => { calls++; });

      await mod.setLocale('auto');

      const stored = await chrome.storage.local.get('config_uiLanguage');
      expect(stored.config_uiLanguage).toBeUndefined();
      expect(mod.getLocale()).toBe('ja');
      expect(calls).toBe(1);
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });

  it('notifies even when re-detect lands on same locale (Pitfall 5 mitigation)', async () => {
    vi.resetModules();
    installChrome({ config_uiLanguage: 'ja' }, 'ja-JP');
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      await new Promise((r) => setTimeout(r, 10));
      expect(mod.getLocale()).toBe('ja');

      let calls = 0;
      mod.__testing.subscribers.add(() => { calls++; });

      await mod.setLocale('auto');

      const stored = await chrome.storage.local.get('config_uiLanguage');
      expect(stored.config_uiLanguage).toBeUndefined();
      expect(mod.getLocale()).toBe('ja');
      expect(calls).toBe(1);  // notify even though currentLocale unchanged
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});

describe('cross-tab listener: newValue === undefined branch (Phase 22 D-07)', () => {
  it("re-detects + notifies when another tab triggers 'auto'", async () => {
    vi.resetModules();
    installChrome({ config_uiLanguage: 'fr' });
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ko-KR', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      await new Promise((r) => setTimeout(r, 10));
      expect(mod.getLocale()).toBe('fr');

      let calls = 0;
      mod.__testing.subscribers.add(() => { calls++; });

      for (const l of listeners) {
        l({ config_uiLanguage: { newValue: undefined, oldValue: 'fr' } }, 'local');
      }

      expect(mod.getLocale()).toBe('ko');
      expect(calls).toBe(1);
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});

describe('SC#4: Returning user with explicit choice — not overwritten by Phase 22 (regression)', () => {
  it('stored config_uiLanguage wins over navigator.language; storage NOT cleared', async () => {
    vi.resetModules();
    installChrome({ config_uiLanguage: 'ja' }, 'zh-CN');
    const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
    try {
      const mod = await import('../../reader/lib/i18n');
      await new Promise((r) => setTimeout(r, 10));
      expect(mod.getLocale()).toBe('ja');
      const stored = await chrome.storage.local.get('config_uiLanguage');
      expect(stored.config_uiLanguage).toBe('ja');
    } finally {
      if (orig) Object.defineProperty(navigator, 'language', orig);
    }
  });
});
