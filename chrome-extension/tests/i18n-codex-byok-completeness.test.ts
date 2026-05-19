// chrome-extension/tests/i18n-codex-byok-completeness.test.ts
//
// Slice 1 #8 i18n completeness static guard. Mirrors the
// i18n-phase{13,15,16,19,28}-completeness.test.ts shape: asserts the 12 new
// Codex BYOK preset keys × 9 locales = 108 entries all resolve via the
// public `t()` API. Future regressions (e.g. a key deleted from one locale)
// caught here before any UI consumer renders.

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const CODEX_KEYS = [
  'options.byok-codex.login.btn',
  'options.byok-codex.login.helpText',
  'options.byok-codex.login.pending.instructions',
  'options.byok-codex.login.cancel',
  'options.byok-codex.loggedIn.label',
  'options.byok-codex.logout.btn',
  'options.byok-codex.error.startFailed',
  'options.byok-codex.error.reloginRequired',
  'options.byok-codex.onboarding.title',
  'options.byok-codex.onboarding.body',
  'options.byok-codex.onboarding.openSettings',
  'options.byok-codex.onboarding.dismiss',
  // Slice 3 #12 — surfaceCodexError toast copy.
  'codex-error.relogin',
  'codex-error.api-changed',
  'codex-error.open-options',
  // PR #15 review fix — distinct network-error toast copy.
  'codex-error.network',
  // Slice 5 #14 — section label wrapping the panel into a Field shell.
  'options.byok-codex.section.label',
] as const;

describe('Codex BYOK i18n completeness', () => {
  describe('17 Codex BYOK keys × 9 locales = 153 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of CODEX_KEYS) {
        it(`${locale} → ${key} resolves to non-empty string`, async () => {
          await setLocale(locale);
          const v = t(key);
          expect(typeof v).toBe('string');
          expect(v.length).toBeGreaterThan(0);
          expect(v).not.toBe(key);
        });
      }
    }
  });

  it('loggedIn.label interpolates the {email} placeholder', async () => {
    for (const locale of LOCALES) {
      await setLocale(locale);
      const out = t('options.byok-codex.loggedIn.label', { email: 'someone@example.com' });
      expect(out).toContain('someone@example.com');
      // Negative: should NOT echo the raw placeholder
      expect(out).not.toContain('{email}');
    }
  });
});
