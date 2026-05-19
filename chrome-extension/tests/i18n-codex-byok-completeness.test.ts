// chrome-extension/tests/i18n-codex-byok-completeness.test.ts
//
// Slice 1 #8 i18n completeness static guard. Mirrors the
// i18n-phase{13,15,16,19,28}-completeness.test.ts shape: asserts every Codex
// BYOK preset key × 9 locales resolves via the public `t()` API. Future
// regressions (e.g. a key deleted from one locale) caught here before any UI
// consumer renders. Key count grows as new slices land:
//   - Slice 1 #8 baseline: 12 keys
//   - Slice 3 #12: + 4 error-toast keys
//   - Slice 5 #14: + 1 section label key
//   - Slice 4 #23: + 3 copy-button keys
//   - Slice 3 #25: + 1 model-switched toast key

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
  // Slice 4 #23 — user_code copy button (idle / success / failure labels).
  'options.byok-codex.login.copy',
  'options.byok-codex.login.copied',
  'options.byok-codex.login.copyFailed',
  // Slice 3 #25 — stored-model mismatch self-heal toast (auto-reset notice).
  'codex-error.model-switched',
] as const;

describe('Codex BYOK i18n completeness', () => {
  describe('21 Codex BYOK keys × 9 locales = 189 non-empty values', () => {
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

  it('codex-error.model-switched interpolates both {old} and {new}', async () => {
    for (const locale of LOCALES) {
      await setLocale(locale);
      const out = t('codex-error.model-switched', { old: 'gpt-5.1', new: 'gpt-5.2' });
      expect(out).toContain('gpt-5.1');
      expect(out).toContain('gpt-5.2');
      // Negative: neither raw placeholder should leak through.
      expect(out).not.toContain('{old}');
      expect(out).not.toContain('{new}');
    }
  });
});
